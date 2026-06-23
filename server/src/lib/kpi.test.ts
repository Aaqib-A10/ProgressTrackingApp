import { describe, it, expect } from 'vitest'
import {
  rate,
  asPercent,
  connectRate,
  interestRate,
  mqlToSql,
  periodDelta,
} from './kpi'

describe('rate', () => {
  it('divides normally', () => {
    expect(rate(7, 100)).toBeCloseTo(0.07)
  })
  it('returns 0 on zero denominator', () => {
    expect(rate(5, 0)).toBe(0)
  })
})

describe('ITAD KPIs', () => {
  it('connect rate = connected / dialed', () => {
    expect(connectRate(8, 100)).toBeCloseTo(0.08)
  })
  it('interest rate = interested / connected', () => {
    expect(interestRate(3, 12)).toBeCloseTo(0.25)
  })
})

describe('Lead Gen KPIs', () => {
  it('MQL -> SQL = handed / qualified', () => {
    expect(mqlToSql(4, 20)).toBeCloseTo(0.2)
  })
})

describe('periodDelta', () => {
  it('computes signed change', () => {
    expect(periodDelta(106, 100)).toBeCloseTo(0.06)
    expect(periodDelta(96, 100)).toBeCloseTo(-0.04)
  })
  it('returns 0 when previous is 0', () => {
    expect(periodDelta(10, 0)).toBe(0)
  })
})

describe('asPercent', () => {
  it('formats fractions', () => {
    expect(asPercent(0.075)).toBe('7.5%')
  })
})
