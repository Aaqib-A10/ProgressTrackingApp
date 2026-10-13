import { DateTime } from 'luxon'
import { timesForWeekday, weekdayOfDate, type DayTimes } from './shiftDay'

/**
 * Shift hours and overtime.
 *
 * When someone has been checked in for their shift's length (9 hours for a 09:00 to 18:00
 * shift, breaks included) PulseTrack checks them out by itself. If they want to keep
 * working they press "Start overtime": then they stay checked in, the time after the
 * shift's hours counts as overtime, and they check out themselves (or are checked out
 * after OVERTIME_MAX_MIN of overtime, so a forgotten clock never runs all night).
 */

export const OVERTIME_MAX_MIN = 4 * 60
const DEFAULT_SPAN_MIN = 9 * 60

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + (m || 0)
}

/** Length of the shift (start to end, breaks included) on the weekday of `dateStr`. */
export function shiftSpanMin(shift: { startTime: string; endTime: string; dayTimes?: DayTimes }, dateStr: string): number {
  const t = timesForWeekday(shift, shift.dayTimes, weekdayOfDate(dateStr))
  let span = toMin(t.endTime) - toMin(t.startTime)
  if (span <= 0) span += 24 * 60 // overnight
  return span > 0 && span <= 16 * 60 ? span : DEFAULT_SPAN_MIN
}

/** The moment the shift's hours are complete for a session that started at `checkInAt`. */
export function shiftCompleteAt(checkInAt: Date, spanMin: number): Date {
  return new Date(checkInAt.getTime() + spanMin * 60_000)
}

/** When PulseTrack will check this session out by itself. */
export function autoCheckoutAt(checkInAt: Date, spanMin: number, overtimeAt: Date | null): Date {
  return new Date(checkInAt.getTime() + (spanMin + (overtimeAt ? OVERTIME_MAX_MIN : 0)) * 60_000)
}

/** Overtime worked: time after the shift's hours were complete, minus breaks taken in that time. */
export function overtimeMinutes(
  day: { checkInAt: Date | null; checkOutAt: Date | null; overtimeAt: Date | null; breaks: { startAt: Date; endAt: Date | null }[] },
  spanMin: number,
  now: Date,
): number {
  if (!day.checkInAt || !day.overtimeAt) return 0
  const from = shiftCompleteAt(day.checkInAt, spanMin).getTime()
  const to = (day.checkOutAt ?? now).getTime()
  if (to <= from) return 0
  let breakMs = 0
  for (const b of day.breaks) {
    const s = Math.max(b.startAt.getTime(), from)
    const e = Math.min((b.endAt ?? now).getTime(), to)
    if (e > s) breakMs += e - s
  }
  return Math.max(0, Math.round((to - from - breakMs) / 60000))
}

/** "6:36 PM" in the shift's timezone. */
export function clockAt(d: Date, zone: string): string {
  return DateTime.fromJSDate(d).setZone(zone).toFormat('h:mm a')
}
