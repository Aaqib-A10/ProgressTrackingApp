import { describe, it, expect } from 'vitest'
import { DateTime } from 'luxon'
import { companyToday, dbDateFromString, dateStringFromDb, periodRange } from './time'

describe('companyToday — night rollover', () => {
  // 01:30 local on June 18 in a UTC+5 office is still 20:30 June 17 in UTC.
  const now = DateTime.fromISO('2026-06-18T01:30:00', { zone: 'Asia/Karachi' }).toJSDate()

  it('uses the company day, not the UTC day', () => {
    expect(companyToday(now, 'Asia/Karachi')).toBe('2026-06-18')
    // Sanity: naive UTC would have rolled the day backwards.
    expect(companyToday(now, 'utc')).toBe('2026-06-17')
  })
})

describe('@db.Date round-trip is stable', () => {
  it('string -> db date -> string keeps the calendar day', () => {
    const stored = dbDateFromString('2026-06-17')
    expect(stored.toISOString()).toBe('2026-06-17T00:00:00.000Z')
    expect(dateStringFromDb(stored)).toBe('2026-06-17')
  })
})

describe('periodRange', () => {
  const now = DateTime.fromISO('2026-06-17T10:00:00', { zone: 'Asia/Karachi' }).toJSDate()
  const opts = { now, zone: 'Asia/Karachi' }

  it('today is a single day', () => {
    expect(periodRange('today', opts)).toEqual({ startDate: '2026-06-17', endDate: '2026-06-17' })
  })
  it('month starts on the 1st', () => {
    expect(periodRange('month', opts)).toEqual({ startDate: '2026-06-01', endDate: '2026-06-17' })
  })
  it('rolling3m spans ~3 months back', () => {
    const r = periodRange('rolling3m', opts)
    expect(r.startDate).toBe('2026-03-18')
    expect(r.endDate).toBe('2026-06-17')
  })
  it('custom echoes given bounds', () => {
    expect(periodRange('custom', { ...opts, start: '2026-01-01', end: '2026-01-31' })).toEqual({
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    })
  })
})
