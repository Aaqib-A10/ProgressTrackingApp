import { describe, it, expect } from 'vitest'
import { autoCheckoutDue, shiftEndForDate, shiftEndInstant, AUTO_CHECKOUT_GRACE_MIN } from './autoCheckout'
import type { ShiftWindow } from './shiftDay'

// 2026-07-08 is a Wednesday. Shifts pin an explicit UTC timezone for determinism.
const day = (over: Partial<ShiftWindow> = {}): ShiftWindow => ({ startTime: '09:00', endTime: '17:00', timeZone: 'UTC', ...over })
const night = (over: Partial<ShiftWindow> = {}): ShiftWindow => ({ startTime: '19:00', endTime: '04:00', timeZone: 'UTC', ...over })
const at = (iso: string) => new Date(iso)

describe('shiftEndForDate', () => {
  it('day shift ends on the same date', () => {
    expect(shiftEndForDate(day(), '2026-07-08').toISOString()).toBe('2026-07-08T17:00:00.000Z')
  })
  it('overnight shift ends on the following date', () => {
    expect(shiftEndForDate(night(), '2026-07-08').toISOString()).toBe('2026-07-09T04:00:00.000Z')
  })
})

describe('shiftEndInstant', () => {
  it('overnight: after-midnight now still resolves to the evening shift end', () => {
    expect(shiftEndInstant(night(), at('2026-07-09T02:00:00Z')).toISOString()).toBe('2026-07-09T04:00:00.000Z')
  })
})

describe('autoCheckoutDue', () => {
  const end = shiftEndForDate(day(), '2026-07-08') // 17:00Z
  const checkIn = at('2026-07-08T09:00:00Z')

  it('is NOT due before shift end', () => {
    expect(autoCheckoutDue(day(), end, at('2026-07-08T16:30:00Z'), checkIn, null)).toBe(false)
  })
  it('is NOT due within the grace window after shift end', () => {
    expect(autoCheckoutDue(day(), end, at('2026-07-08T17:30:00Z'), checkIn, null)).toBe(false)
  })
  it('is due exactly at shift end + grace', () => {
    const t = at(`2026-07-08T${17 + AUTO_CHECKOUT_GRACE_MIN / 60}:00:00Z`) // 18:00
    expect(autoCheckoutDue(day(), end, t, checkIn, null)).toBe(true)
  })
  it('is due well after shift end + grace', () => {
    expect(autoCheckoutDue(day(), end, at('2026-07-08T21:00:00Z'), checkIn, null)).toBe(true)
  })
  it('is NOT due when not checked in', () => {
    expect(autoCheckoutDue(day(), end, at('2026-07-08T21:00:00Z'), null, null)).toBe(false)
  })
  it('is NOT due when already checked out', () => {
    expect(autoCheckoutDue(day(), end, at('2026-07-08T21:00:00Z'), checkIn, at('2026-07-08T17:00:00Z'))).toBe(false)
  })
  it('is NOT due when check-in was AFTER shift end (would record a negative duration)', () => {
    expect(autoCheckoutDue(day(), end, at('2026-07-08T21:00:00Z'), at('2026-07-08T18:53:00Z'), null)).toBe(false)
  })
  it('overnight: not due at 04:30 (within grace), due at 05:00 (end + 1h)', () => {
    const nEnd = shiftEndForDate(night(), '2026-07-08') // 2026-07-09 04:00Z
    const nIn = at('2026-07-08T19:00:00Z')
    expect(autoCheckoutDue(night(), nEnd, at('2026-07-09T04:30:00Z'), nIn, null)).toBe(false)
    expect(autoCheckoutDue(night(), nEnd, at('2026-07-09T05:00:00Z'), nIn, null)).toBe(true)
  })
})
