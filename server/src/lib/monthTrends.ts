import { DateTime } from 'luxon'
import type { TrendPoint } from './trends'

/** "YYYY-MM" one month before the given month. */
export function prevMonth(ym: string): string {
  return DateTime.fromISO(`${ym}-01`, { zone: 'utc' }).minus({ months: 1 }).toFormat('yyyy-MM')
}

/** Ascending list of the `n` months ending at (and including) `ym`. */
export function monthsBack(ym: string, n: number): string[] {
  const end = DateTime.fromISO(`${ym}-01`, { zone: 'utc' })
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) out.push(end.minus({ months: i }).toFormat('yyyy-MM'))
  return out
}

/** Human month label, e.g. "Jul '26". */
export function monthLabel(ym: string): string {
  return DateTime.fromISO(`${ym}-01`, { zone: 'utc' }).toFormat("LLL ''yy")
}

/**
 * Build a month-bucketed trend series. Deliberately NOT `buildSeries` (which is
 * day/week bucketed and leave-aware) — monthly stats are not attendance-linked.
 */
export function monthSeries<T>(
  rows: T[],
  months: string[],
  monthOf: (r: T) => string,
  pick: (r: T) => number,
  target?: number,
): TrendPoint[] {
  const byMonth = new Map<string, number>()
  for (const r of rows) byMonth.set(monthOf(r), (byMonth.get(monthOf(r)) ?? 0) + pick(r))
  return months.map((m) => ({ label: monthLabel(m), value: byMonth.get(m) ?? 0, ...(target != null ? { target } : {}) }))
}
