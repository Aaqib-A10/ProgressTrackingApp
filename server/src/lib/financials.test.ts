import { describe, it, expect } from 'vitest'
import { activeMonths } from './financials'

const d = (s: string) => new Date(`${s}T00:00:00.000Z`)

describe('activeMonths', () => {
  it('counts every month when active for the whole range', () => {
    expect(activeMonths(d('2026-01-01'), null, '2026-01', '2026-06')).toBe(6)
  })
  it('excludes months before the start date', () => {
    // Started 6 Apr → active Apr, May, Jun of an Jan–Jun range = 3
    expect(activeMonths(d('2026-04-06'), null, '2026-01', '2026-06')).toBe(3)
  })
  it('includes the start month even if mid-month', () => {
    expect(activeMonths(d('2026-02-15'), null, '2026-02', '2026-02')).toBe(1)
  })
  it('excludes months after the end date', () => {
    // Left end of March → active Jan, Feb, Mar = 3
    expect(activeMonths(d('2026-01-01'), d('2026-03-31'), '2026-01', '2026-06')).toBe(3)
  })
  it('is 0 when the window is entirely outside the range', () => {
    expect(activeMonths(d('2026-07-01'), null, '2026-01', '2026-06')).toBe(0)
    expect(activeMonths(d('2025-01-01'), d('2025-12-31'), '2026-01', '2026-06')).toBe(0)
  })
  it('spans year boundaries', () => {
    expect(activeMonths(d('2025-11-01'), null, '2025-11', '2026-02')).toBe(4)
  })
})
