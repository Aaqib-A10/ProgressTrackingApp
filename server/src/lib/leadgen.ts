import { leadToQualified, mqlToSql, contactDiscovery } from './kpi'
import type { PerfFlag } from './itad'

export const LEADGEN_METRIC_KEYS = [
  'leadsGenerated',
  'accountsResearched',
  'contactsFound',
  'qualifiedMql',
  'handedToSql',
] as const

export type LeadGenMetricKey = (typeof LEADGEN_METRIC_KEYS)[number]
export type LeadGenTotals = Record<LeadGenMetricKey, number>

export type LeadGenEntryLike = { status: string } & Record<LeadGenMetricKey, number>

export function emptyTotals(): LeadGenTotals {
  return { leadsGenerated: 0, accountsResearched: 0, contactsFound: 0, qualifiedMql: 0, handedToSql: 0 }
}

/** Sum metrics; non-SUBMITTED (leave) days contribute nothing. */
export function sumLeadGen(entries: LeadGenEntryLike[]): LeadGenTotals {
  const out = emptyTotals()
  for (const e of entries) {
    if (e.status !== 'SUBMITTED') continue
    for (const k of LEADGEN_METRIC_KEYS) out[k] += e[k] ?? 0
  }
  return out
}

export interface LeadGenKpis {
  leadToQualified: number
  mqlToSql: number
  contactDiscovery: number
}

export function leadGenKpis(t: LeadGenTotals): LeadGenKpis {
  return {
    leadToQualified: leadToQualified(t.qualifiedMql, t.leadsGenerated),
    mqlToSql: mqlToSql(t.handedToSql, t.qualifiedMql),
    contactDiscovery: contactDiscovery(t.contactsFound, t.accountsResearched),
  }
}

/** Lead Gen performance flag — mirrors the ITAD integrity matrix on lead volume + quality. */
export function leadGenFlag(args: {
  avgLeads: number
  leadToQualified: number
  dailyLeadTarget: number
}): PerfFlag {
  const { avgLeads, leadToQualified, dailyLeadTarget } = args
  if (dailyLeadTarget > 0 && avgLeads < dailyLeadTarget * 0.6) return 'BELOW'
  if (avgLeads > 0 && leadToQualified < 0.25) return 'ATTENTION'
  if ((dailyLeadTarget === 0 || avgLeads >= dailyLeadTarget) && leadToQualified >= 0.4) return 'EXCEEDING'
  return 'OPTIMAL'
}

export interface LeadGenAggregate {
  totals: LeadGenTotals
  kpis: LeadGenKpis
  workingDays: number
  avgLeads: number
  flag: PerfFlag
}

export function aggregateAgent(entries: LeadGenEntryLike[], dailyLeadTarget: number): LeadGenAggregate {
  const submitted = entries.filter((e) => e.status === 'SUBMITTED')
  const totals = sumLeadGen(submitted)
  const workingDays = submitted.length
  const kpis = leadGenKpis(totals)
  const avgLeads = workingDays ? totals.leadsGenerated / workingDays : 0
  return {
    totals,
    kpis,
    workingDays,
    avgLeads,
    flag: leadGenFlag({ avgLeads, leadToQualified: kpis.leadToQualified, dailyLeadTarget }),
  }
}

/** Funnel stages for the team pipeline view (plan §5.3). */
export function funnelStages(t: LeadGenTotals): { stage: string; value: number }[] {
  return [
    { stage: 'Researched', value: t.accountsResearched },
    { stage: 'Contacts', value: t.contactsFound },
    { stage: 'Leads', value: t.leadsGenerated },
    { stage: 'Qualified', value: t.qualifiedMql },
    { stage: 'Handed to Sales', value: t.handedToSql },
  ]
}
