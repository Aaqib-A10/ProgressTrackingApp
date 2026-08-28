import cron from 'node-cron'
import { DateTime } from 'luxon'
import { prisma } from './prisma'
import { COMPANY_TZ, dbDateFromString, dateStringFromDb } from './time'
import { shiftDayString } from './shiftDay'
import { notifyAttendance } from './notify'

/**
 * Attendance policy violations — evaluated every few minutes:
 *  - BRB break total over its per-agent allowance (default 20m).
 *  - Regular break total over its allowance (default 65m; open break counts live,
 *    so a forgotten break trips it in near real-time).
 *  - Late sign-in: past start+grace on a working day, not checked in on time.
 *  - >3 late sign-ins in a calendar month → limit flag.
 *
 * Each (user, day, kind) is claimed once in AttendanceViolation (unique key) so a
 * notification fires exactly once. Notifications go to the agent + their
 * department Team Leads. Pure helpers below are unit-tested.
 */

export interface ViolationShift {
  startTime: string
  endTime: string
  graceMin: number
  brbAllowanceMin: number
  breakAllowanceMin: number
  workingDays: number[] // 0=Sun … 6=Sat
  timeZone: string | null
}
type BreakLike = { type: 'BREAK' | 'BRB'; startAt: Date; endAt: Date | null }

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** Break minutes for a type; an open break is counted up to `now`. Pure. */
export function breakMinutesByType(breaks: BreakLike[], type: 'BREAK' | 'BRB', now: Date): number {
  let ms = 0
  for (const b of breaks) {
    if (b.type !== type) continue
    ms += (b.endAt ?? now).getTime() - b.startAt.getTime()
  }
  return Math.max(0, Math.round(ms / 60000))
}

export const brbOverrunDue = (brbMin: number, allowance: number) => allowance > 0 && brbMin > allowance
export const breakOverrunDue = (regularMin: number, allowance: number) => allowance > 0 && regularMin > allowance

/**
 * Is a late-sign-in violation due at `now`? True when, on a working day and
 * within the shift window, the agent is past start+grace and either hasn't
 * checked in or checked in after grace. Overnight-aware. Pure.
 */
export function lateSigninDue(shift: ViolationShift, now: Date, checkInAt: Date | null): boolean {
  const tz = shift.timeZone || COMPANY_TZ
  const zoned = DateTime.fromJSDate(now).setZone(tz)
  const weekday = zoned.weekday % 7 // Luxon 1=Mon..7=Sun → 0=Sun..6=Sat
  if (!shift.workingDays.includes(weekday)) return false
  const start = toMin(shift.startTime)
  const end = toMin(shift.endTime)
  const overnight = end <= start
  const endAxis = overnight ? end + 1440 : end
  let nowMin = zoned.hour * 60 + zoned.minute
  if (overnight && nowMin < start) nowMin += 1440
  // Only evaluate once we're past grace and still within the shift window.
  if (nowMin < start + shift.graceMin || nowMin >= endAxis) return false
  if (checkInAt) {
    const ci = DateTime.fromJSDate(checkInAt).setZone(tz)
    let ciMin = ci.hour * 60 + ci.minute
    if (overnight && ciMin < start) ciMin += 1440
    return ciMin > start + shift.graceMin
  }
  return true // past grace, not checked in
}

const LATE_MONTHLY_LIMIT = 3

type ShiftRow = {
  userId: string | null
  departmentId: string | null
  startTime: string
  endTime: string
  graceMin: number
  brbAllowanceMin: number
  breakAllowanceMin: number
  workingDays: number[]
  timeZone: string | null
}
const DEFAULT_SHIFT: ViolationShift = { startTime: '09:00', endTime: '18:00', graceMin: 10, brbAllowanceMin: 20, breakAllowanceMin: 65, workingDays: [1, 2, 3, 4, 5], timeZone: null }

function pickShift(rows: ShiftRow[], userId: string, departmentId: string | null): ViolationShift {
  const row =
    rows.find((r) => r.userId === userId) ??
    (departmentId ? rows.find((r) => r.departmentId === departmentId && r.userId === null) : undefined) ??
    rows.find((r) => r.userId === null && r.departmentId === null)
  return row
    ? { startTime: row.startTime, endTime: row.endTime, graceMin: row.graceMin, brbAllowanceMin: row.brbAllowanceMin, breakAllowanceMin: row.breakAllowanceMin, workingDays: row.workingDays, timeZone: row.timeZone }
    : DEFAULT_SHIFT
}

const fmt = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`

/** One evaluation pass. Returns counts by kind (for logging/tests). */
export async function runAttendanceViolationTick(now: Date = new Date()): Promise<{ brb: number; break: number; late: number; limit: number }> {
  const [users, shifts, tls] = await Promise.all([
    prisma.user.findMany({ where: { isActive: true, status: 'ACTIVE' }, select: { id: true, name: true, departmentId: true } }),
    prisma.attendanceShift.findMany({ select: { userId: true, departmentId: true, startTime: true, endTime: true, graceMin: true, brbAllowanceMin: true, breakAllowanceMin: true, workingDays: true, timeZone: true } }),
    prisma.user.findMany({ where: { role: 'TEAM_LEAD', isActive: true, status: 'ACTIVE' }, select: { id: true, departmentId: true } }),
  ])
  const tlByDept = new Map<string, string[]>()
  for (const t of tls) if (t.departmentId) tlByDept.set(t.departmentId, [...(tlByDept.get(t.departmentId) ?? []), t.id])

  const shiftByUser = new Map(users.map((u) => [u.id, pickShift(shifts, u.id, u.departmentId)]))
  const dayStrByUser = new Map(users.map((u) => [u.id, shiftDayString(shiftByUser.get(u.id)!, now)]))
  const dateValues = [...new Set(dayStrByUser.values())].map(dbDateFromString)
  const monthStartStr = DateTime.fromJSDate(now).setZone(COMPANY_TZ).startOf('month').toISODate()!
  const monthStartValue = dbDateFromString(monthStartStr)

  const [days, leaves, holidays, todayViol, lateViol] = await Promise.all([
    prisma.attendanceDay.findMany({
      where: { date: { in: dateValues } },
      select: { userId: true, date: true, checkInAt: true, breaks: { select: { type: true, startAt: true, endAt: true } } },
    }),
    prisma.leaveDay.findMany({ where: { date: { in: dateValues } }, select: { userId: true, date: true } }),
    prisma.holiday.findMany({ where: { date: { in: dateValues } }, select: { date: true } }),
    prisma.attendanceViolation.findMany({ where: { date: { in: dateValues } }, select: { userId: true, date: true, kind: true } }),
    prisma.attendanceViolation.findMany({ where: { kind: 'LATE_SIGNIN', date: { gte: monthStartValue } }, select: { userId: true, date: true } }),
  ])

  const dayByUser = new Map(days.filter((d) => dateStringFromDb(d.date) === dayStrByUser.get(d.userId)).map((d) => [d.userId, d]))
  const onLeave = new Set(leaves.filter((l) => dateStringFromDb(l.date) === dayStrByUser.get(l.userId)).map((l) => l.userId))
  const holidayDates = new Set(holidays.map((h) => dateStringFromDb(h.date)))
  const claimedToday = new Set(todayViol.filter((v) => dateStringFromDb(v.date) === dayStrByUser.get(v.userId)).map((v) => `${v.userId}:${v.kind}`))
  const limitClaimed = new Set(todayViol.filter((v) => v.kind === 'LATE_LIMIT').map((v) => v.userId))
  const lateByUser = new Map<string, Set<string>>()
  for (const v of lateViol) lateByUser.set(v.userId, (lateByUser.get(v.userId) ?? new Set()).add(dateStringFromDb(v.date)))

  const out = { brb: 0, break: 0, late: 0, limit: 0 }

  const claim = async (userId: string, dateStr: string, kind: 'LATE_SIGNIN' | 'BREAK_OVERRUN' | 'BRB_OVERRUN' | 'LATE_LIMIT', minutes?: number) => {
    try {
      await prisma.attendanceViolation.create({ data: { userId, date: dbDateFromString(dateStr), kind, minutes } })
      return true
    } catch {
      return false // concurrent tick claimed it
    }
  }

  for (const u of users) {
    const dayStr = dayStrByUser.get(u.id)!
    if (onLeave.has(u.id) || holidayDates.has(dayStr)) continue
    const shift = shiftByUser.get(u.id)!
    const day = dayByUser.get(u.id)
    const recipients = [u.id, ...(u.departmentId ? tlByDept.get(u.departmentId) ?? [] : [])]

    // Break overruns (only meaningful once there are breaks logged today).
    if (day) {
      const brbMin = breakMinutesByType(day.breaks, 'BRB', now)
      if (brbOverrunDue(brbMin, shift.brbAllowanceMin) && !claimedToday.has(`${u.id}:BRB_OVERRUN`)) {
        if (await claim(u.id, dayStr, 'BRB_OVERRUN', brbMin)) {
          out.brb++
          await notifyAttendance({ recipientIds: recipients, type: 'BRB_OVERRUN', title: 'BRB break over limit', body: `${u.name} used ${brbMin}m of BRB (limit ${shift.brbAllowanceMin}m) today.` })
        }
      }
      const regMin = breakMinutesByType(day.breaks, 'BREAK', now)
      if (breakOverrunDue(regMin, shift.breakAllowanceMin) && !claimedToday.has(`${u.id}:BREAK_OVERRUN`)) {
        if (await claim(u.id, dayStr, 'BREAK_OVERRUN', regMin)) {
          out.break++
          await notifyAttendance({ recipientIds: recipients, type: 'BREAK_OVERRUN', title: 'Break exceeded limit', body: `${u.name}'s break is ${fmt(regMin)} (limit ${fmt(shift.breakAllowanceMin)}) today.` })
        }
      }
    }

    // Late sign-in.
    if (lateSigninDue(shift, now, day?.checkInAt ?? null) && !claimedToday.has(`${u.id}:LATE_SIGNIN`)) {
      if (await claim(u.id, dayStr, 'LATE_SIGNIN')) {
        out.late++
        lateByUser.set(u.id, (lateByUser.get(u.id) ?? new Set()).add(dayStr))
        await notifyAttendance({ recipientIds: recipients, type: 'GRACE_EXCEEDED', title: 'Late sign-in', body: `${u.name} exceeded the ${shift.graceMin}m sign-in grace today.` })
      }
    }

    // Monthly 3-day limit.
    const lateCount = lateByUser.get(u.id)?.size ?? 0
    if (lateCount > LATE_MONTHLY_LIMIT && !limitClaimed.has(u.id)) {
      if (await claim(u.id, monthStartStr, 'LATE_LIMIT', lateCount)) {
        out.limit++
        limitClaimed.add(u.id)
        const tlOnly = u.departmentId ? tlByDept.get(u.departmentId) ?? [] : []
        await notifyAttendance({ recipientIds: [...tlOnly, u.id], type: 'GRACE_LIMIT', title: 'Late sign-in limit exceeded', body: `${u.name} has ${lateCount} late sign-ins this month (limit ${LATE_MONTHLY_LIMIT}).` })
      }
    }
  }
  return out
}

/** Start the cron scheduler (every 5 minutes). Call once on server boot. */
export function startAttendanceViolations(): void {
  cron.schedule('*/5 * * * *', () => {
    runAttendanceViolationTick().catch((e) => {
      // eslint-disable-next-line no-console
      console.error('[violations] tick failed:', e)
    })
  })
  // eslint-disable-next-line no-console
  console.log('[violations] attendance violation scheduler started (every 5 min)')
}
