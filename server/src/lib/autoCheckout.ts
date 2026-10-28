import cron from 'node-cron'
import { DateTime } from 'luxon'
import { prisma } from './prisma'
import { companyTz, dbDateFromString, dateStringFromDb } from './time'
import { shiftDayString, isOvernight, timesForWeekday, weekdayOfDate, type ShiftWindow, type DayTimes } from './shiftDay'
import { shiftSpanMin, autoCheckoutAt, clockAt, OVERTIME_MAX_MIN } from './overtime'
import { pickShift, type ReminderShift } from './attendanceReminders'
import { runTracked } from './health/jobs'
import { forEachCompany } from './company'

/**
 * Automatic check-out.
 *
 * Rule: once someone has been checked in for their shift's length (9 hours for a 9 hour
 * shift, breaks included) PulseTrack checks them out at that exact moment, unless they
 * pressed "Start overtime". With overtime on they stay checked in and check out
 * themselves; a forgotten clock is closed after OVERTIME_MAX_MIN of overtime. Any break
 * still running is closed at the same moment, the day is noted for audit, and the person
 * gets a notice in the bell.
 *
 * Same shift model as the reminders: each person's shift (personal, then department,
 * then company) gives the shift length for the day the session belongs to.
 */

export const AUTO_CHECKOUT_NOTE = 'Auto-checked out when the shift hours were complete'
export const AUTO_CHECKOUT_OVERTIME_NOTE = `Auto-checked out after ${OVERTIME_MAX_MIN / 60} hours of overtime`

/** The instant a shift ends for an attendance day whose stored date is `dateStr`
 *  (the date the shift STARTED — an overnight shift ends on the next calendar day). */
export function shiftEndForDate(shift: ShiftWindow & { dayTimes?: DayTimes }, dateStr: string): Date {
  const zone = shift.timeZone || companyTz()
  const t = timesForWeekday(shift, shift.dayTimes, weekdayOfDate(dateStr)) // per-day end
  const [h, m] = t.endTime.split(':').map(Number)
  let end = DateTime.fromISO(dateStr, { zone }).set({ hour: h, minute: m, second: 0, millisecond: 0 })
  if (isOvernight({ startTime: t.startTime, endTime: t.endTime, timeZone: shift.timeZone })) end = end.plus({ days: 1 })
  return end.toJSDate()
}

/** The instant the shift ends for the shift-instance in progress at `now`. */
export function shiftEndInstant(shift: ShiftWindow, now: Date): Date {
  return shiftEndForDate(shift, shiftDayString(shift, now))
}

/** Pure: when (if at all) should this open session be closed, given `now`? */
export function autoCheckoutDueAt(
  shift: { startTime: string; endTime: string; dayTimes?: DayTimes },
  dateStr: string,
  day: { checkInAt: Date | null; checkOutAt: Date | null; overtimeAt: Date | null },
  now: Date,
): Date | null {
  if (!day.checkInAt || day.checkOutAt) return null
  const at = autoCheckoutAt(day.checkInAt, shiftSpanMin(shift, dateStr), day.overtimeAt)
  return now.getTime() >= at.getTime() ? at : null
}

/**
 * One sweep: closes every open session whose shift hours (or overtime limit) are up,
 * at that exact moment. `dryRun` reports what would close without changing anything.
 */
export async function runAutoCheckoutTick(
  opts: { now?: Date; sinceDate?: string; dryRun?: boolean } = {},
): Promise<{ closed: number; rows: { userId: string; date: string; checkOutAt: string; overtime: boolean }[] }> {
  const now = opts.now ?? new Date()
  const open = await prisma.attendanceDay.findMany({
    where: {
      checkInAt: { not: null },
      checkOutAt: null,
      ...(opts.sinceDate ? { date: { gte: dbDateFromString(opts.sinceDate) } } : {}),
    },
    select: { id: true, userId: true, date: true, checkInAt: true, checkOutAt: true, overtimeAt: true },
  })
  if (!open.length) return { closed: 0, rows: [] }

  const [users, shifts] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: [...new Set(open.map((d) => d.userId))] } }, select: { id: true, departmentId: true } }),
    prisma.attendanceShift.findMany({ select: { userId: true, departmentId: true, startTime: true, endTime: true, dayTimes: true, graceMin: true, workingDays: true, timeZone: true } }),
  ])
  const shiftByUser = new Map<string, ReminderShift>(users.map((u) => [u.id, pickShift(shifts, u.id, u.departmentId)]))

  const rows: { userId: string; date: string; checkOutAt: string; overtime: boolean }[] = []
  for (const day of open) {
    const shift = shiftByUser.get(day.userId)
    if (!shift) continue
    const dateStr = dateStringFromDb(day.date)
    const at = autoCheckoutDueAt(shift, dateStr, day, now)
    if (!at) continue
    const overtime = !!day.overtimeAt
    rows.push({ userId: day.userId, date: dateStr, checkOutAt: at.toISOString(), overtime })
    if (opts.dryRun) continue
    const zone = shift.timeZone || companyTz()
    await prisma.$transaction([
      // A break still running ends at the same moment (one that "started" later is dropped).
      prisma.breakEntry.updateMany({ where: { dayId: day.id, endAt: null, startAt: { lt: at } }, data: { endAt: at } }),
      prisma.breakEntry.deleteMany({ where: { dayId: day.id, endAt: null, startAt: { gte: at } } }),
      prisma.attendanceDay.update({ where: { id: day.id }, data: { checkOutAt: at, note: overtime ? AUTO_CHECKOUT_OVERTIME_NOTE : AUTO_CHECKOUT_NOTE } }),
      prisma.notification.create({
        data: {
          userId: day.userId,
          type: 'AUTO_CHECKOUT',
          title: 'You were checked out',
          body: overtime
            ? `Checked out at ${clockAt(at, zone)} after ${OVERTIME_MAX_MIN / 60} hours of overtime.`
            : `Your shift hours were complete, so you were checked out at ${clockAt(at, zone)}. Next time press "Start overtime" to keep working.`,
          link: '/app/attendance/me',
        },
      }),
    ])
  }
  return { closed: rows.length, rows }
}

/** Start the auto-checkout sweep (every minute, so the check-out lands on time). Call once on server boot. */
export function startAutoCheckout(): void {
  cron.schedule('* * * * *', () => {
    runTracked('auto-checkout', () => forEachCompany(() => runAutoCheckoutTick())).catch((e) => {
      // eslint-disable-next-line no-console
      console.error('[auto-checkout] tick failed:', e)
    })
  })
  // eslint-disable-next-line no-console
  console.log('[auto-checkout] auto check-out started (shift hours, overtime aware, every minute)')
}
