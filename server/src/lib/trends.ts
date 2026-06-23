import { DateTime } from 'luxon'
import type { DateRange } from './time'

export interface TrendPoint {
  label: string
  value: number
  target?: number
}

export type BucketMode = 'day' | 'week'

/** Per-day buckets for ranges up to ~a month, per-week for longer (e.g. rolling 3m). */
export function bucketMode(range: DateRange): BucketMode {
  const span =
    Math.round(DateTime.fromISO(range.endDate, { zone: 'utc' }).diff(DateTime.fromISO(range.startDate, { zone: 'utc' }), 'days').days) + 1
  return span <= 31 ? 'day' : 'week'
}

function bucketKey(dateStr: string, mode: BucketMode): string {
  const d = DateTime.fromISO(dateStr, { zone: 'utc' })
  return mode === 'week' ? d.startOf('week').toISODate()! : dateStr
}

/** Every bucket spanning the range (so the trend line is zero-filled, not gappy). */
export function enumerateBuckets(range: DateRange): { key: string; label: string }[] {
  const mode = bucketMode(range)
  const end = DateTime.fromISO(range.endDate, { zone: 'utc' })
  let d = DateTime.fromISO(range.startDate, { zone: 'utc' })
  if (mode === 'week') d = d.startOf('week')
  const out: { key: string; label: string }[] = []
  while (d <= end) {
    out.push({ key: d.toISODate()!, label: d.toFormat('LLL d') })
    d = mode === 'week' ? d.plus({ weeks: 1 }) : d.plus({ days: 1 })
  }
  return out
}

export interface SeriesRow {
  date: string
  value: number
  status?: string
}

/**
 * Zero-filled bucketed trend series with an optional per-bucket target line.
 * Non-SUBMITTED (leave) rows are skipped (leave-aware).
 */
export function buildSeries(range: DateRange, rows: SeriesRow[], perDayTarget = 0): TrendPoint[] {
  const mode = bucketMode(range)
  const sums = new Map<string, number>()
  for (const r of rows) {
    if (r.status && r.status !== 'SUBMITTED') continue
    const key = bucketKey(r.date, mode)
    sums.set(key, (sums.get(key) ?? 0) + r.value)
  }
  const target = mode === 'week' ? perDayTarget * 5 : perDayTarget
  return enumerateBuckets(range).map((b) => ({
    label: b.label,
    value: sums.get(b.key) ?? 0,
    ...(perDayTarget ? { target } : {}),
  }))
}

/** Signed relative change; 0 when there's no prior value to compare against. */
export function pctDelta(current: number, previous: number): number {
  return previous ? (current - previous) / previous : 0
}

/** Plain-language "are we improving?" line, e.g. "Connect rate up 6%; closed down 4%". */
export function improvementLine(parts: { label: string; delta: number }[]): string {
  if (!parts.length) return 'Not enough data yet to show a trend.'
  return parts
    .map((p) => {
      const dir = p.delta > 0 ? 'up' : p.delta < 0 ? 'down' : 'flat'
      const pct = Math.abs(Math.round(p.delta * 100))
      return dir === 'flat' ? `${p.label} flat` : `${p.label} ${dir} ${pct}%`
    })
    .join('; ')
}
