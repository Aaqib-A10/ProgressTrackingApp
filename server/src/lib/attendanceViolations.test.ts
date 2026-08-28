import { describe, it, expect } from 'vitest'
import { breakMinutesByType, brbOverrunDue, breakOverrunDue, lateSigninDue, type ViolationShift } from './attendanceViolations'
import { timesForWeekday } from './shiftDay'

const shift: ViolationShift = { startTime: '09:00', endTime: '18:00', graceMin: 10, brbAllowanceMin: 20, breakAllowanceMin: 65, workingDays: [1, 2, 3, 4, 5], timeZone: 'UTC' }
// A Wednesday in UTC.
const at = (hhmm: string) => new Date(`2026-08-26T${hhmm}:00.000Z`)

describe('breakMinutesByType', () => {
  it('sums only the matching type; open break counted to now', () => {
    const breaks = [
      { type: 'BRB' as const, startAt: at('10:00'), endAt: at('10:08') },
      { type: 'BRB' as const, startAt: at('11:00'), endAt: null }, // open, now=11:15 → 15m
      { type: 'BREAK' as const, startAt: at('13:00'), endAt: at('13:45') },
    ]
    expect(breakMinutesByType(breaks, 'BRB', at('11:15'))).toBe(23)
    expect(breakMinutesByType(breaks, 'BREAK', at('11:15'))).toBe(45)
  })
})

describe('overrun rules', () => {
  it('BRB over 20', () => {
    expect(brbOverrunDue(20, 20)).toBe(false)
    expect(brbOverrunDue(21, 20)).toBe(true)
  })
  it('break over 65', () => {
    expect(breakOverrunDue(65, 65)).toBe(false)
    expect(breakOverrunDue(66, 65)).toBe(true)
  })
})

describe('lateSigninDue', () => {
  it('not late before start+grace', () => {
    expect(lateSigninDue(shift, at('09:05'), null)).toBe(false) // within grace, no check-in yet
  })
  it('late when past grace and not checked in', () => {
    expect(lateSigninDue(shift, at('09:11'), null)).toBe(true)
  })
  it('late when checked in after grace', () => {
    expect(lateSigninDue(shift, at('09:30'), at('09:25'))).toBe(true)
  })
  it('not late when checked in within grace', () => {
    expect(lateSigninDue(shift, at('09:30'), at('09:08'))).toBe(false)
  })
  it('not late on a non-working day (Sunday)', () => {
    expect(lateSigninDue(shift, new Date('2026-08-30T09:30:00.000Z'), null)).toBe(false)
  })
  it('not evaluated after shift end', () => {
    expect(lateSigninDue(shift, at('18:30'), null)).toBe(false)
  })
})

describe('per-weekday custom times', () => {
  const base = { startTime: '09:00', endTime: '18:00' }
  const dayTimes = { '2': { startTime: '12:00', endTime: '21:00' } } // Tuesday only

  it('timesForWeekday returns override for Tue, base otherwise', () => {
    expect(timesForWeekday(base, dayTimes, 2)).toEqual({ startTime: '12:00', endTime: '21:00' })
    expect(timesForWeekday(base, dayTimes, 1)).toEqual(base) // Monday inherits base
    expect(timesForWeekday(base, null, 2)).toEqual(base)
  })

  const perDay: ViolationShift = { ...shift, dayTimes }
  const tueAt = (hhmm: string) => new Date(`2026-08-25T${hhmm}:00.000Z`) // a Tuesday
  const monAt = (hhmm: string) => new Date(`2026-08-24T${hhmm}:00.000Z`) // a Monday

  it('Tuesday uses the 12:00 start: 12:05 not late, 12:30 late', () => {
    expect(lateSigninDue(perDay, tueAt('12:05'), null)).toBe(false)
    expect(lateSigninDue(perDay, tueAt('12:30'), null)).toBe(true)
  })
  it('Monday still uses the 09:00 base: 09:05 not late, 09:30 late', () => {
    expect(lateSigninDue(perDay, monAt('09:05'), null)).toBe(false)
    expect(lateSigninDue(perDay, monAt('09:30'), null)).toBe(true)
  })
  it('Tuesday before its (later) start is not yet evaluated', () => {
    expect(lateSigninDue(perDay, tueAt('09:30'), null)).toBe(false) // base would flag, per-day 12:00 does not
  })
})
