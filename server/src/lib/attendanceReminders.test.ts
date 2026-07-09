import { describe, it, expect } from 'vitest'
import { reminderDue, type ReminderShift, type ReminderState } from './attendanceReminders'

// Fixed reference: 2026-07-08 is a Wednesday. Times below are UTC; the default
// shift has no timezone so it evaluates in COMPANY_TZ (Asia/Karachi, +5) unless
// APP_TIMEZONE overrides. Tests set an explicit UTC timezone to stay deterministic.
const utcShift = (over: Partial<ReminderShift> = {}): ReminderShift => ({
  startTime: '09:00',
  endTime: '17:00',
  graceMin: 10,
  workingDays: [1, 2, 3, 4, 5],
  timeZone: 'UTC',
  ...over,
})
const fresh: ReminderState = { checkedIn: false, checkedOut: false, checkInSent: false, checkOutSent: false }
const at = (iso: string) => new Date(iso) // ISO with Z = UTC

describe('reminderDue — check-in', () => {
  it('is due after start+grace when not checked in', () => {
    expect(reminderDue(utcShift(), at('2026-07-08T09:15:00Z'), fresh)).toBe('CHECK_IN')
  })
  it('is NOT due before start+grace', () => {
    expect(reminderDue(utcShift(), at('2026-07-08T09:05:00Z'), fresh)).toBeNull()
  })
  it('is NOT due once checked in', () => {
    expect(reminderDue(utcShift(), at('2026-07-08T09:15:00Z'), { ...fresh, checkedIn: true })).toBeNull()
  })
  it('is NOT sent twice', () => {
    expect(reminderDue(utcShift(), at('2026-07-08T09:15:00Z'), { ...fresh, checkInSent: true })).toBeNull()
  })
  it('is NOT due on a non-working day (Saturday)', () => {
    expect(reminderDue(utcShift(), at('2026-07-11T09:15:00Z'), fresh)).toBeNull()
  })
})

describe('reminderDue — check-out', () => {
  it('is due at shift end when clocked in but not out', () => {
    expect(reminderDue(utcShift(), at('2026-07-08T17:05:00Z'), { ...fresh, checkedIn: true })).toBe('CHECK_OUT')
  })
  it('is NOT due if already checked out', () => {
    expect(reminderDue(utcShift(), at('2026-07-08T17:05:00Z'), { ...fresh, checkedIn: true, checkedOut: true })).toBeNull()
  })
  it('stops nagging well after the window', () => {
    expect(reminderDue(utcShift(), at('2026-07-08T21:00:00Z'), { ...fresh, checkedIn: true })).toBeNull()
  })
})

describe('reminderDue — overnight shift', () => {
  const night = utcShift({ startTime: '22:00', endTime: '06:00' })
  it('check-in nudge just after 22:00', () => {
    expect(reminderDue(night, at('2026-07-08T22:15:00Z'), fresh)).toBe('CHECK_IN')
  })
  it('check-out nudge just after 06:00 next morning', () => {
    expect(reminderDue(night, at('2026-07-09T06:05:00Z'), { ...fresh, checkedIn: true })).toBe('CHECK_OUT')
  })
  it('no check-in nudge at 07:00 (shift already over)', () => {
    expect(reminderDue(night, at('2026-07-09T07:00:00Z'), fresh)).toBeNull()
  })
})

describe('reminderDue — timezone', () => {
  it('honors the shift timezone (NY start 09:00 = 13:00 UTC in summer)', () => {
    const ny = utcShift({ timeZone: 'America/New_York' })
    // 13:15 UTC = 09:15 New York → due
    expect(reminderDue(ny, at('2026-07-08T13:15:00Z'), fresh)).toBe('CHECK_IN')
    // 09:15 UTC = 05:15 New York → not yet
    expect(reminderDue(ny, at('2026-07-08T09:15:00Z'), fresh)).toBeNull()
  })
})
