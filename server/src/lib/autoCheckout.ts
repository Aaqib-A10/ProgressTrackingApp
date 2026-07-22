import cron from 'node-cron'
import { DateTime } from 'luxon'
import { prisma } from './prisma'
import { COMPANY_TZ, dbDateFromString, dateStringFromDb } from './time'
import { shiftDayString, isOvernight, type ShiftWindow } from './shiftDay'
import { pickShift, type ReminderShift } from './attendanceReminders'

/**
 * Auto check-out for members who forget to clock out.
 *
 * Rule: once a member's shift is over, they get a grace window; if they're still
 * checked in one hour after shift end, the system closes the day for them. The
 * recorded check-out is the SHIFT END time (the completed-shift mark), not the
 * moment the sweep runs — so worked hours reflect the actual shift and the
 * forgotten idle time is not credited. Any still-open break is closed at the
 * same instant, and the day is stamped with a note for audit.
 *
 * Same shift model as the reminder scheduler: each member's effective shift
 * (personal → department → company) and its timezone decide "shift end", and the
 * attendance day is matched in that timezone so overnight shifts resolve to the
 * evening they started.
 */

/** Grace after shift end before a forgotten check-out is auto-closed. */
export const AUTO_CHECKOUT_GRACE_MIN = 60

export const AUTO_CHECKOUT_NOTE = 'Auto-checked out at shift end (no manual check-out)'

/** The instant a shift ends for an attendance day whose stored date is `dateStr`
 *  (the date the shift STARTED — an overnight shift ends on the next calendar day). */
export function shiftEndForDate(shift: ShiftWindow, dateStr: string): Date {
  const zone = shift.timeZone || COMPANY_TZ
  const [h, m] = shift.endTime.split(':').map(Number)
  let end = DateTime.fromISO(dateStr, { zone }).set({ hour: h, minute: m, second: 0, millisecond: 0 })
  if (isOvernight(shift)) end = end.plus({ days: 1 })
  return end.toJSDate()
}

/** The instant the shift ends for the shift-instance in progress at `now`. */
export function shiftEndInstant(shift: ShiftWindow, now: Date): Date {
  return shiftEndForDate(shift, shiftDayString(shift, now))
}

/**
 * Pure: is an open (checked-in, not-out) day due for auto-close? Due when we're
 * past shift-end + grace AND the check-in was actually before shift end (guards
 * against a stray after-hours check-in whose "shift end" precedes it, which would
 * otherwise record a check-out earlier than the check-in).
 */
export function autoCheckoutDue(shift: ShiftWindow, shiftEnd: Date, now: Date, checkInAt: Date | null, checkOutAt: Date | null): boolean {
  if (!checkInAt || checkOutAt) return false
  if (checkInAt.getTime() >= shiftEnd.getTime()) return false
  return now.getTime() >= shiftEnd.getTime() + AUTO_CHECKOUT_GRACE_MIN * 60_000
}

/**
 * One sweep. Closes every open (checked-in, not-out) session whose shift ended
 * more than the grace window ago, at that session's own shift-end time.
 *
 * `sinceDate` (inclusive 'YYYY-MM-DD') bounds how far back to look — pass a recent
 * date to only apply the rule going forward and leave historical rows untouched.
 * `dryRun` reports what would close without mutating.
 */
export async function runAutoCheckoutTick(
  opts: { now?: Date; sinceDate?: string; dryRun?: boolean } = {},
): Promise<{ closed: number; rows: { userId: string; date: string; shiftEnd: string }[] }> {
  const now = opts.now ?? new Date()
  const [users, shifts] = await Promise.all([
    prisma.user.findMany({ where: { isActive: true, status: 'ACTIVE' }, select: { id: true, departmentId: true } }),
    prisma.attendanceShift.findMany({ select: { userId: true, departmentId: true, startTime: true, endTime: true, graceMin: true, workingDays: true, timeZone: true } }),
  ])
  const shiftByUser = new Map<string, ReminderShift>(users.map((u) => [u.id, pickShift(shifts, u.id, u.departmentId)]))

  const open = await prisma.attendanceDay.findMany({
    where: {
      checkInAt: { not: null },
      checkOutAt: null,
      ...(opts.sinceDate ? { date: { gte: dbDateFromString(opts.sinceDate) } } : {}),
    },
    select: { id: true, userId: true, date: true, checkInAt: true, checkOutAt: true },
  })

  const rows: { userId: string; date: string; shiftEnd: string }[] = []
  let closed = 0
  for (const day of open) {
    const shift = shiftByUser.get(day.userId)
    if (!shift) continue // inactive user or no resolvable shift
    const dateStr = dateStringFromDb(day.date)
    const end = shiftEndForDate(shift, dateStr)
    if (!autoCheckoutDue(shift, end, now, day.checkInAt, day.checkOutAt)) continue

    rows.push({ userId: day.userId, date: dateStr, shiftEnd: end.toISOString() })
    if (!opts.dryRun) {
      await prisma.$transaction([
        prisma.breakEntry.updateMany({ where: { dayId: day.id, endAt: null }, data: { endAt: end } }),
        prisma.attendanceDay.update({ where: { id: day.id }, data: { checkOutAt: end, note: AUTO_CHECKOUT_NOTE } }),
      ])
    }
    closed++
  }
  return { closed, rows }
}

/** Start the auto-checkout cron (every 5 minutes). Call once on server boot. */
export function startAutoCheckout(): void {
  cron.schedule('*/5 * * * *', () => {
    runAutoCheckoutTick().catch((e) => {
      // eslint-disable-next-line no-console
      console.error('[auto-checkout] tick failed:', e)
    })
  })
  // eslint-disable-next-line no-console
  console.log('[auto-checkout] auto check-out scheduler started (every 5 min)')
}
