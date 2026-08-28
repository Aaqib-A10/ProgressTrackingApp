import { DateTime } from 'luxon'
import { COMPANY_TZ, type DateString } from './time'

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
 * The calendar date — in the shift's OWN timezone — that the shift instance
 * currently in progress belongs to. For an overnight shift the post-midnight
 * hours still belong to the date the shift STARTED, so a check-out or break
 * taken after midnight resolves to the same attendance day as the evening
 * check-in (instead of silently starting a new, unfindable day).
 *
 * Day shift, tz Pacific, 02:00 local  -> that day (normal).
 * Night shift 19:00–04:00, 21:00 local -> that day (shift started this evening).
 * Night shift 19:00–04:00, 02:00 local -> yesterday (still the evening's shift).
 */
export function shiftDayString(shift: ShiftWindow, now: Date = new Date()): DateString {
  const zone = shift.timeZone || COMPANY_TZ
  const local = DateTime.fromJSDate(now).setZone(zone)
  const nowMin = local.hour * 60 + local.minute
  if (isOvernight(shift) && nowMin < shiftMinutes(shift.startTime)) {
    return local.minus({ days: 1 }).toISODate()!
  }
  return local.toISODate()!
}
