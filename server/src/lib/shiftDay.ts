import { DateTime } from 'luxon'
import { companyTz, type DateString } from './time'

/**
 * The subset of a shift needed to decide which calendar date a moment belongs
 * to. `timeZone` is an IANA zone; null falls back to the company timezone.
 */
export interface ShiftWindow {
  startTime: string // "HH:mm"
  endTime: string // "HH:mm"
  timeZone: string | null
}

/** Minutes-after-local-midnight for a shift "HH:mm". */
export function shiftMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

/** Per-weekday start/end overrides (0=Sun..6=Sat → times); weekdays absent inherit the base. */
export type DayTimes = Record<string, { startTime: string; endTime: string }> | null | undefined

/** 0=Sun..6=Sat weekday of a bare "YYYY-MM-DD" (timezone-independent). */
export function weekdayOfDate(dateStr: string): number {
  return DateTime.fromISO(dateStr).weekday % 7
}

/** The start/end times worked on `weekday` — the per-day override if set, else the base pair. */
export function timesForWeekday(base: { startTime: string; endTime: string }, dayTimes: DayTimes, weekday: number): { startTime: string; endTime: string } {
  const o = dayTimes?.[String(weekday)]
  return o && o.startTime && o.endTime ? { startTime: o.startTime, endTime: o.endTime } : { startTime: base.startTime, endTime: base.endTime }
}

/** A shift is overnight when its end time is at or before its start (crosses midnight). */
export function isOvernight(shift: ShiftWindow): boolean {
  return shiftMinutes(shift.endTime) <= shiftMinutes(shift.startTime)
}

/**
 * For an overnight shift: the local minute that splits "still last night's
 * shift" from "tonight's shift". It is the middle of the off-duty gap
 * (19:00–04:00 → 11:30), so a check-out or an auto check-out after 04:00 still
 * lands on last night, while an EARLY check-in (18:30 for a 19:00 start) already
 * counts for tonight. Using the start time itself as the split sent every early
 * check-in to the previous day: the widget showed yesterday's finished shift and
 * the check-in was refused.
 */
export function overnightCutoffMinutes(shift: Pick<ShiftWindow, 'startTime' | 'endTime'>): number {
  const end = shiftMinutes(shift.endTime)
  const start = shiftMinutes(shift.startTime)
  return end + Math.floor((start - end) / 2)
}

/**
 * For a day shift: the local minute after midnight before which work still belongs to the
 * previous day. It is the middle of the off-duty gap (11:00 to 20:00 -> 03:30; 09:00 to 18:00
 * -> 01:30), so someone who worked past midnight (in 00:19, out 04:05) is filed on the day that
 * shift belonged to, and the next morning's check-in is not blocked by a finished "today".
 * 0 when the gap's middle falls before midnight (a very early shift): nothing moves back.
 */
export function dayCutoffMinutes(shift: Pick<ShiftWindow, 'startTime' | 'endTime'>): number {
  const end = shiftMinutes(shift.endTime)
  const start = shiftMinutes(shift.startTime)
  const mid = end + Math.floor((start + 1440 - end) / 2)
  return mid >= 1440 ? mid - 1440 : 0
}

/** Does local minute `nowMin` still belong to the shift that began the day before? */
export function belongsToPreviousShift(shift: ShiftWindow, nowMin: number): boolean {
  return isOvernight(shift) ? nowMin < overnightCutoffMinutes(shift) : nowMin < dayCutoffMinutes(shift)
}

/**
 * The calendar date — in the shift's OWN timezone — that the shift instance
 * currently in progress belongs to. For an overnight shift the post-midnight
 * hours still belong to the date the shift STARTED, so a check-out or break
 * taken after midnight resolves to the same attendance day as the evening
 * check-in (instead of silently starting a new, unfindable day).
 *
 * Day shift 09:00–17:00, 02:00 local  -> that day (after the 01:00 split).
 * Day shift 11:00–20:00, 00:19 local  -> yesterday (worked past midnight).
 * Night shift 19:00–04:00, 21:00 local -> that day (shift started this evening).
 * Night shift 19:00–04:00, 02:00 local -> yesterday (still the evening's shift).
 * Night shift 19:00–04:00, 18:30 local -> that day (early check-in for tonight).
 */
export function shiftDayString(shift: ShiftWindow, now: Date = new Date()): DateString {
  const zone = shift.timeZone || companyTz()
  const local = DateTime.fromJSDate(now).setZone(zone)
  const nowMin = local.hour * 60 + local.minute
  if (belongsToPreviousShift(shift, nowMin)) {
    return local.minus({ days: 1 }).toISODate()!
  }
  return local.toISODate()!
}
