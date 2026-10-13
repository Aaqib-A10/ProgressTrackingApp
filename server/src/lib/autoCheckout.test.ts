import { describe, it, expect } from 'vitest'
import { autoCheckoutDueAt, shiftEndForDate, shiftEndInstant } from './autoCheckout'
import { shiftSpanMin, overtimeMinutes, OVERTIME_MAX_MIN } from './overtime'
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

describe('shift length', () => {
  it('is the start-to-end span, overnight included', () => {
    expect(shiftSpanMin(day(), '2026-07-08')).toBe(8 * 60)
    expect(shiftSpanMin({ startTime: '09:00', endTime: '18:00' }, '2026-07-08')).toBe(9 * 60)
    expect(shiftSpanMin(night(), '2026-07-08')).toBe(9 * 60)
  })
})

describe('autoCheckoutDueAt: checked out when the shift hours are complete', () => {
  const nine = { startTime: '09:00', endTime: '18:00', timeZone: 'UTC' }
  const checkInAt = at('2026-07-08T09:30:00Z') // came in late
  const open = { checkInAt, checkOutAt: null, overtimeAt: null }

  it('not before 9 hours on the clock', () => {
    expect(autoCheckoutDueAt(nine, '2026-07-08', open, at('2026-07-08T18:29:00Z'))).toBeNull()
  })
  it('at 9 hours, at that exact moment (not at shift end, not when the sweep runs)', () => {
    expect(autoCheckoutDueAt(nine, '2026-07-08', open, at('2026-07-08T18:31:00Z'))?.toISOString()).toBe('2026-07-08T18:30:00.000Z')
  })
  it('with overtime on: keeps going, closed only after the overtime limit', () => {
    const ot = { ...open, overtimeAt: at('2026-07-08T18:00:00Z') }
    expect(autoCheckoutDueAt(nine, '2026-07-08', ot, at('2026-07-08T21:00:00Z'))).toBeNull()
    const limit = new Date(checkInAt.getTime() + (9 * 60 + OVERTIME_MAX_MIN) * 60_000)
    expect(autoCheckoutDueAt(nine, '2026-07-08', ot, new Date(limit.getTime() + 60_000))?.toISOString()).toBe(limit.toISOString())
  })
  it('never for a session already closed or never opened', () => {
    expect(autoCheckoutDueAt(nine, '2026-07-08', { ...open, checkOutAt: at('2026-07-08T17:00:00Z') }, at('2026-07-09T09:00:00Z'))).toBeNull()
    expect(autoCheckoutDueAt(nine, '2026-07-08', { checkInAt: null, checkOutAt: null, overtimeAt: null }, at('2026-07-09T09:00:00Z'))).toBeNull()
  })
})

describe('overtimeMinutes', () => {
  const checkInAt = at('2026-07-08T09:00:00Z')
  it('counts the time after the 9 hours, minus breaks in that time', () => {
    const d = { checkInAt, checkOutAt: at('2026-07-08T20:30:00Z'), overtimeAt: at('2026-07-08T17:55:00Z'), breaks: [{ startAt: at('2026-07-08T19:00:00Z'), endAt: at('2026-07-08T19:20:00Z') }] }
    expect(overtimeMinutes(d, 9 * 60, at('2026-07-08T21:00:00Z'))).toBe(150 - 20)
  })
  it('is zero without overtime', () => {
    expect(overtimeMinutes({ checkInAt, checkOutAt: at('2026-07-08T20:00:00Z'), overtimeAt: null, breaks: [] }, 9 * 60, at('2026-07-08T21:00:00Z'))).toBe(0)
  })
})
