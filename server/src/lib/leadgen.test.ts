import { describe, it, expect } from 'vitest'
import {
  sumLeadGen,
  leadGenKpis,
  leadGenFlag,
  aggregateAgent,
  funnelStages,
  type LeadGenEntryLike,
} from './leadgen'

function entry(p: Partial<LeadGenEntryLike>): LeadGenEntryLike {
  return {
    status: 'SUBMITTED',
    leadsGenerated: 0,
    accountsResearched: 0,
    contactsFound: 0,
    qualifiedMql: 0,
    handedToSql: 0,
    ...p,
  }
}

describe('sumLeadGen — leave exclusion', () => {
  it('excludes non-SUBMITTED days', () => {
    const t = sumLeadGen([
      entry({ leadsGenerated: 40, qualifiedMql: 18 }),
      entry({ leadsGenerated: 30, qualifiedMql: 12 }),
      entry({ status: 'ON_LEAVE', leadsGenerated: 0 }),
    ])
    expect(t.leadsGenerated).toBe(70)
    expect(t.qualifiedMql).toBe(30)
  })
})

describe('leadGenKpis', () => {
  it('computes lead→qualified, MQL→SQL, contact discovery', () => {
    const k = leadGenKpis(
      sumLeadGen([entry({ leadsGenerated: 40, qualifiedMql: 20, handedToSql: 5, contactsFound: 60, accountsResearched: 120 })]),
    )
    expect(k.leadToQualified).toBeCloseTo(0.5)
    expect(k.mqlToSql).toBeCloseTo(0.25)
    expect(k.contactDiscovery).toBeCloseTo(0.5)
  })
})

describe('leadGenFlag', () => {
  it('flags BELOW under target volume', () => {
    expect(leadGenFlag({ avgLeads: 3, leadToQualified: 0.5, dailyLeadTarget: 8 })).toBe('BELOW')
  })
  it('flags ATTENTION when volume ok but quality low', () => {
    expect(leadGenFlag({ avgLeads: 10, leadToQualified: 0.1, dailyLeadTarget: 8 })).toBe('ATTENTION')
  })
  it('flags EXCEEDING at/above target with good quality', () => {
    expect(leadGenFlag({ avgLeads: 9, leadToQualified: 0.45, dailyLeadTarget: 8 })).toBe('EXCEEDING')
  })
})

describe('aggregateAgent — leave-aware averages', () => {
  it('averages leads over working days only', () => {
    const agg = aggregateAgent(
      [entry({ leadsGenerated: 40 }), entry({ leadsGenerated: 40 }), entry({ status: 'ON_LEAVE' })],
      8,
    )
    expect(agg.workingDays).toBe(2)
    expect(agg.avgLeads).toBe(40)
  })
})

describe('funnelStages', () => {
  it('orders the pipeline widest-to-narrowest', () => {
    const stages = funnelStages(
      sumLeadGen([entry({ accountsResearched: 100, contactsFound: 70, leadsGenerated: 40, qualifiedMql: 18, handedToSql: 5 })]),
    )
    expect(stages.map((s) => s.value)).toEqual([100, 70, 40, 18, 5])
  })
})
