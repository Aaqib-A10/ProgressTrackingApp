import { DateTime } from 'luxon'

/**
 * Single source of truth for "what day is it" and period windows.
 *
 * Why this module exists: the one-entry-per-day upsert key and all daily
 * averages must agree on which calendar date a moment belongs to. If that were
 * derived in UTC, a submission after local midnight (e.g. 01:30 local in a
 * UTC+5 office) would be filed under the previous UTC day. So every date
 * decision is made in the COMPANY timezone, and both the entry API and the KPI
 * lib import from here.
 *
 * Storage note: `date` columns are Prisma `@db.Date` (calendar date only). We
 * write/read them as UTC-midnight of the intended day so the stored value never
 * shifts with server timezone — see dbDateFromString / dateStringFromDb.
 */

/** Company-local timezone (IANA). Override with APP_TIMEZONE env var. */
export const COMPANY_TZ = process.env.APP_TIMEZONE || 'Asia/Karachi'

/** A pure calendar date in ISO form, 'YYYY-MM-DD'. */
export type DateString = string

export type RangeKey = 'today' | 'week' | 'month' | 'rolling3m' | 'custom'

export interface DateRange {
  /** inclusive start calendar date */
  startDate: DateString
  /** inclusive end calendar date */
  endDate: DateString
}

/** Today's calendar date in the company timezone. */
export function companyToday(now: Date = new Date(), zone: string = COMPANY_TZ): DateString {
  return DateTime.fromJSDate(now).setZone(zone).toISODate()!
}

/**
 * Convert a 'YYYY-MM-DD' string to the JS Date to store in a `@db.Date` column.
 * Uses UTC midnight so the persisted calendar date is exactly this day.
 */
export function dbDateFromString(date: DateString): Date {
  return DateTime.fromISO(date, { zone: 'utc' }).startOf('day').toJSDate()
}

/**
 * Convert a value read back from a `@db.Date` column to its 'YYYY-MM-DD'
 * string. Read in UTC (Prisma returns UTC-midnight) so it doesn't shift.
 */
export function dateStringFromDb(value: Date): DateString {
  return DateTime.fromJSDate(value, { zone: 'utc' }).toISODate()!
}

/**
 * Resolve a named range into inclusive [startDate, endDate] calendar dates,
 * computed in the company timezone. `custom` echoes the dates you pass in.
 */
export function periodRange(
  range: RangeKey,
  opts: { now?: Date; zone?: string; start?: DateString; end?: DateString } = {},
): DateRange {
  const zone = opts.zone ?? COMPANY_TZ
  const today = DateTime.fromJSDate(opts.now ?? new Date()).setZone(zone).startOf('day')

  switch (range) {
    case 'today':
      return { startDate: today.toISODate()!, endDate: today.toISODate()! }
    case 'week':
      // Luxon weeks start Monday.
      return { startDate: today.startOf('week').toISODate()!, endDate: today.toISODate()! }
    case 'month':
      return { startDate: today.startOf('month').toISODate()!, endDate: today.toISODate()! }
    case 'rolling3m':
      // Last 3 calendar months up to today (e.g. the "are we improving?" view).
      return { startDate: today.minus({ months: 3 }).plus({ days: 1 }).toISODate()!, endDate: today.toISODate()! }
    case 'custom': {
      if (!opts.start || !opts.end) throw new Error('custom range requires start and end')
      return { startDate: opts.start, endDate: opts.end }
    }
  }
}

/**
 * The equal-length window immediately preceding `range` — used for
 * period-over-period (▲/▼ %) comparisons.
 */
export function previousRange(range: DateRange): DateRange {
  const start = DateTime.fromISO(range.startDate, { zone: 'utc' })
  const end = DateTime.fromISO(range.endDate, { zone: 'utc' })
  const days = Math.round(end.diff(start, 'days').days) + 1
  const prevEnd = start.minus({ days: 1 })
  const prevStart = prevEnd.minus({ days: days - 1 })
  return { startDate: prevStart.toISODate()!, endDate: prevEnd.toISODate()! }
}
