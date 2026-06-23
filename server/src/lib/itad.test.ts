import { describe, it, expect } from 'vitest'
import { sumItad, itadKpis, perfFlag, aggregateAgent, type ItadEntryLike } from './itad'

function entry(partial: Partial<ItadEntryLike>): ItadEntryLike {
  return {
    status: 'SUBMITTED',
    callsDialed: 0,
    connected: 0,
    voicemail: 0,
    emailsSent: 0,
    interested: 0,
    workingOn: 0,
    closed: 0,
    rfqs: 0,
    ...partial,
  }
}

describe('sumItad — leave exclusion', () => {
  it('excludes non-SUBMITTED days from totals', () => {
    const entries = [
      entry({ callsDialed: 100, connected: 30 }),
      entry({ callsDialed: 120, connected: 36 }),
      entry({ status: 'ON_LEAVE', callsDialed: 0 }),
    ]
    const t = sumItad(entries)
    expect(t.callsDialed).toBe(220)
    expect(t.connected).toBe(66)
  })
})

describe('itadKpis', () => {
  it('computes connect and interest rates', () => {
    const k = itadKpis(sumItad([entry({ callsDialed: 100, connected: 30, interested: 9 })]))
    expect(k.connectRate).toBeCloseTo(0.3)
    expect(k.interestRate).toBeCloseTo(0.3)
  })
})

describe('perfFlag', () => {
  const target = 100
  it('flags BELOW when avg dials far under target', () => {
    expect(perfFlag({ avgDials: 50, connectRate: 0.3, dailyDialTarget: target })).toBe('BELOW')
  })
  it('flags ATTENTION when dialing hard but low connect rate', () => {
    expect(perfFlag({ avgDials: 120, connectRate: 0.1, dailyDialTarget: target })).toBe('ATTENTION')
  })
  it('flags EXCEEDING when at/above target with healthy connect rate', () => {
    expect(perfFlag({ avgDials: 110, connectRate: 0.35, dailyDialTarget: target })).toBe('EXCEEDING')
  })
  it('flags OPTIMAL otherwise', () => {
    expect(perfFlag({ avgDials: 90, connectRate: 0.28, dailyDialTarget: target })).toBe('OPTIMAL')
  })
})

describe('aggregateAgent — leave-aware averages', () => {
  it('averages over working days only', () => {
    const entries = [
      entry({ callsDialed: 100 }),
      entry({ callsDialed: 100 }),
      entry({ callsDialed: 100 }),
      entry({ callsDialed: 100 }),
      entry({ status: 'ON_LEAVE' }),
    ]
    const agg = aggregateAgent(entries, 100)
    expect(agg.workingDays).toBe(4)
    expect(agg.avgDials).toBe(100) // 400 / 4, not 400 / 5
  })
})
