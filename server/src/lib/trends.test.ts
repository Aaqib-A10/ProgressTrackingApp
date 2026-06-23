import { describe, it, expect } from 'vitest'
import { bucketMode, enumerateBuckets, buildSeries, pctDelta, improvementLine } from './trends'

const week = { startDate: '2026-06-15', endDate: '2026-06-19' } // Mon–Fri
const quarter = { startDate: '2026-03-18', endDate: '2026-06-17' }

describe('bucketMode', () => {
  it('uses days for short ranges and weeks for long ones', () => {
    expect(bucketMode(week)).toBe('day')
    expect(bucketMode(quarter)).toBe('week')
  })
})

describe('enumerateBuckets', () => {
  it('zero-fills every day in a short range', () => {
    expect(enumerateBuckets(week)).toHaveLength(5)
  })
})

describe('buildSeries', () => {
  it('buckets by day, zero-fills gaps, and excludes leave', () => {
    const rows = [
      { date: '2026-06-15', value: 100 },
      { date: '2026-06-15', value: 20 }, // same day sums
      { date: '2026-06-17', value: 50, status: 'ON_LEAVE' }, // excluded
      { date: '2026-06-19', value: 80 },
    ]
    const series = buildSeries(week, rows, 100)
    expect(series).toHaveLength(5)
    expect(series[0].value).toBe(120) // Mon
    expect(series[2].value).toBe(0) // Wed (leave excluded)
    expect(series[4].value).toBe(80) // Fri
    expect(series[0].target).toBe(100)
  })
})

describe('pctDelta', () => {
  it('is relative, and 0 with no baseline', () => {
    expect(pctDelta(110, 100)).toBeCloseTo(0.1)
    expect(pctDelta(10, 0)).toBe(0)
  })
})

describe('improvementLine', () => {
  it('reads as plain language', () => {
    expect(improvementLine([{ label: 'Connect rate', delta: 0.06 }, { label: 'Closed', delta: -0.04 }])).toBe(
      'Connect rate up 6%; Closed down 4%',
    )
  })
})
