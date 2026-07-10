import cron from 'node-cron'
import { DateTime } from 'luxon'
import { prisma } from './prisma'
import { COMPANY_TZ, dbDateFromString, dateStringFromDb } from './time'
import { shiftDayString } from './shiftDay'
import { sendAttendanceReminderEmail } from './mail'

/**
 * Scheduled check-in / check-out email reminders.
 *
 * The scheduler ticks every few minutes and, for each active employee, uses
 * their effective shift (working days, timezone, start/grace/end — same model as
 * the attendance module) to decide whether a reminder is due right now. A
 * per-user-per-day-per-kind row in AttendanceReminder guarantees each reminder
 * is sent at most once. Emails are best-effort (no-op without RESEND_API_KEY),
 * so the selection logic runs the same with or without email configured.
 */

export type ReminderKind = 'CHECK_IN' | 'CHECK_OUT'

export interface ReminderShift {
  startTime: string // "HH:mm"
  endTime: string
  graceMin: number
  workingDays: number[] // 0=Sun … 6=Sat
  timeZone: string | null
}

export interface ReminderState {
  checkedIn: boolean
  checkedOut: boolean
  checkInSent: boolean
  checkOutSent: boolean
}

/** How long after shift end we still nudge someone who forgot to check out. */
const CHECKOUT_WINDOW_MIN = 180

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/**
 * Is a reminder due for this shift at `now`? Pure and unit-tested. Evaluates the
 * clock in the shift's timezone and is overnight-aware. Returns the kind or null.
 */
export function reminderDue(shift: ReminderShift, now: Date, state: ReminderState): ReminderKind | null {
  const zoned = DateTime.fromJSDate(now).setZone(shift.timeZone || COMPANY_TZ)
  // Luxon weekday: 1=Mon … 7=Sun → 0=Sun … 6=Sat
  const weekday = zoned.weekday % 7
  if (!shift.workingDays.includes(weekday)) return null

  const start = toMin(shift.startTime)
  const end = toMin(shift.endTime)
  const overnight = end <= start
  const endAxis = overnight ? end + 1440 : end
  let nowMin = zoned.hour * 60 + zoned.minute
  if (overnight && nowMin < start) nowMin += 1440

  // Check-in: past start+grace, still within the shift, not yet in, not yet nudged.
  if (!state.checkedIn && !state.checkInSent && nowMin >= start + shift.graceMin && nowMin < endAxis) {
    return 'CHECK_IN'
  }
  // Check-out: at/after end (within a window), clocked in but not out, not yet nudged.
  if (state.checkedIn && !state.checkedOut && !state.checkOutSent && nowMin >= endAxis && nowMin < endAxis + CHECKOUT_WINDOW_MIN) {
    return 'CHECK_OUT'
  }
  return null
}

type ShiftRow = { userId: string | null; departmentId: string | null; startTime: string; endTime: string; graceMin: number; workingDays: number[]; timeZone: string | null }
const DEFAULT_SHIFT: ReminderShift = { startTime: '09:00', endTime: '18:00', graceMin: 10, workingDays: [1, 2, 3, 4, 5], timeZone: null }

function pickShift(rows: ShiftRow[], userId: string, departmentId: string | null): ReminderShift {
  const row = rows.find((r) => r.userId === userId) ?? (departmentId ? rows.find((r) => r.departmentId === departmentId && r.userId === null) : undefined) ?? rows.find((r) => r.userId === null && r.departmentId === null)
  return row ? { startTime: row.startTime, endTime: row.endTime, graceMin: row.graceMin, workingDays: row.workingDays, timeZone: row.timeZone } : DEFAULT_SHIFT
}

const shiftLabel = (s: ReminderShift) => `${s.startTime}–${s.endTime}`

/** One evaluation pass. Returns how many reminders were sent, by kind. */
export async function runAttendanceReminderTick(now: Date = new Date()): Promise<{ checkIn: number; checkOut: number }> {
  const [users, shifts] = await Promise.all([
    prisma.user.findMany({ where: { isActive: true, status: 'ACTIVE' }, select: { id: true, name: true, email: true, departmentId: true } }),
    prisma.attendanceShift.findMany({ select: { userId: true, departmentId: true, startTime: true, endTime: true, graceMin: true, workingDays: true, timeZone: true } }),
  ])

  // Each employee's records are keyed by the date of their current shift instance
  // resolved in their own timezone, so a night shift past midnight matches the
  // evening's day rather than a fresh (empty) calendar date.
  const shiftByUser = new Map(users.map((u) => [u.id, pickShift(shifts, u.id, u.departmentId)]))
  const dayStrByUser = new Map(users.map((u) => [u.id, shiftDayString(shiftByUser.get(u.id)!, now)]))
  const dateValues = [...new Set(dayStrByUser.values())].map(dbDateFromString)

  const [days, leaves, holidays, sent] = await Promise.all([
    prisma.attendanceDay.findMany({ where: { date: { in: dateValues } }, select: { userId: true, date: true, checkInAt: true, checkOutAt: true } }),
    prisma.leaveDay.findMany({ where: { date: { in: dateValues } }, select: { userId: true, date: true } }),
    prisma.holiday.findMany({ where: { date: { in: dateValues } }, select: { date: true } }),
    prisma.attendanceReminder.findMany({ where: { date: { in: dateValues } }, select: { userId: true, date: true, kind: true } }),
  ])

  // Match each record to the user whose shift day it belongs to.
  const dayByUser = new Map(days.filter((d) => dateStringFromDb(d.date) === dayStrByUser.get(d.userId)).map((d) => [d.userId, d]))
  const onLeave = new Set(leaves.filter((l) => dateStringFromDb(l.date) === dayStrByUser.get(l.userId)).map((l) => l.userId))
  const sentSet = new Set(sent.filter((s) => dateStringFromDb(s.date) === dayStrByUser.get(s.userId)).map((s) => `${s.userId}:${s.kind}`))
  const holidayDates = new Set(holidays.map((h) => dateStringFromDb(h.date)))

  let checkIn = 0
  let checkOut = 0
  for (const u of users) {
    if (!u.email || onLeave.has(u.id)) continue
    const dayStr = dayStrByUser.get(u.id)!
    // Holiday on this employee's own shift day → no nudge.
    if (holidayDates.has(dayStr)) continue
    const shift = shiftByUser.get(u.id)!
    const day = dayByUser.get(u.id)
    const kind = reminderDue(shift, now, {
      checkedIn: !!day?.checkInAt,
      checkedOut: !!day?.checkOutAt,
      checkInSent: sentSet.has(`${u.id}:CHECK_IN`),
      checkOutSent: sentSet.has(`${u.id}:CHECK_OUT`),
    })
    if (!kind) continue

    // Claim the reminder first (unique constraint prevents double-send across ticks).
    try {
      await prisma.attendanceReminder.create({ data: { userId: u.id, date: dbDateFromString(dayStr), kind } })
    } catch {
      continue // already claimed by a concurrent tick
    }
    await sendAttendanceReminderEmail({ to: u.email, name: u.name, kind, shiftLabel: shiftLabel(shift) })
    if (kind === 'CHECK_IN') checkIn++
    else checkOut++
  }
  return { checkIn, checkOut }
}

/** Start the cron scheduler (every 5 minutes). Call once on server boot. */
export function startAttendanceReminders(): void {
  cron.schedule('*/5 * * * *', () => {
    runAttendanceReminderTick().catch((e) => {
      // eslint-disable-next-line no-console
      console.error('[reminders] tick failed:', e)
    })
  })
  // eslint-disable-next-line no-console
  console.log('[reminders] attendance reminder scheduler started (every 5 min)')
}
