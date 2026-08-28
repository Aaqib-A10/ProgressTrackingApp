import { describe, it, expect } from 'vitest'
import { breakMinutesByType, brbOverrunDue, breakOverrunDue, lateSigninDue, type ViolationShift } from './attendanceViolations'

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
