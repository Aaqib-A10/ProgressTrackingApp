import { api } from './api'
import type { RangeKey, CustomRange } from '../components/layout/RangeSelector'
import { rangeQuery } from './range'
import type { PerfFlag } from './itadApi'

export type LeadGenStatus = 'SUBMITTED' | 'ON_LEAVE' | 'HOLIDAY' | 'OFF'

export const LEADGEN_METRICS = [
  { key: 'leadsGenerated', label: 'Leads Generated' },
  { key: 'accountsResearched', label: 'Accounts Researched' },
  { key: 'contactsFound', label: 'Contacts Found' },
  { key: 'qualifiedMql', label: 'Qualified (MQL)' },
  { key: 'handedToSql', label: 'Handed to Sales (SQL)' },
] as const

export type LeadGenMetricKey = (typeof LEADGEN_METRICS)[number]['key']
export type LeadGenTotals = Record<LeadGenMetricKey, number>

export interface VerticalTag {
  id: string
  name: string
}

export interface LeadGenEntry extends LeadGenTotals {
  id: string
  date: string
  status: LeadGenStatus
  dataSource: string
  notes: string
  verticalCounts: { tagId: string; count: number }[]
}

export interface LeadGenEntryResponse {
  date: string
  entry: LeadGenEntry | null
  verticals: VerticalTag[]
  leadTypes: VerticalTag[]
  stats: { weeklyLeadTarget: number; avgLeads: number; leadToQualified: number }
}

export interface LeadGenKpis {
  leadToQualified: number
  mqlToSql: number
  contactDiscovery: number
}

export interface LeadGenAgentRow {
  id: string
  name: string
  status: 'SUBMITTED' | 'PENDING' | 'ON_LEAVE'
  onLeaveToday: boolean
  flag: PerfFlag
  totals: LeadGenTotals
  kpis: LeadGenKpis
}

export interface LeadGenTeamResponse {
  range: { startDate: string; endDate: string; key: RangeKey }
  target: { weeklyLeads: number }
  team: { totals: LeadGenTotals; kpis: LeadGenKpis }
  deltas: { leadsGenerated: number; qualifiedMql: number; mqlToSql: number; contactsFound: number }
  funnel: { stage: string; value: number }[]
  byVertical: {
    series: { key: string; label: string }[]
    data: Record<string, string | number>[]
  }
  agents: LeadGenAgentRow[]
  topAgents: { id: string; name: string; leads: number }[]
}

export interface UpsertLeadGenInput extends Partial<LeadGenTotals> {
  status: LeadGenStatus
  notes?: string
  dataSource?: string
  verticalCounts?: { tagId: string; count: number }[]
  leadTypeCounts?: { tagId: string; count: number }[]
  date?: string
}

export function getMyLeadGenEntry(date?: string) {
  return api.get<LeadGenEntryResponse>(`/leadgen/entries${date ? `?date=${date}` : ''}`)
}

export function upsertLeadGenEntry(input: UpsertLeadGenInput) {
  return api.put<{ entry: LeadGenEntry }>('/leadgen/entries', input)
}

/** Add an industry/vertical inline from the daily form. */
export function createLeadGenVertical(name: string) {
  return api.post<{ vertical: VerticalTag }>('/leadgen/verticals', { name })
}

export function getLeadGenTeam(range: RangeKey, custom?: CustomRange | null) {
  return api.get<LeadGenTeamResponse>(`/leadgen/team?${rangeQuery(range, custom)}`)
}

// --- Analytics ---
export interface LeadGenAnalyticsKpi {
  label: string
  value: number
  format: 'percent' | 'number'
  delta: number
}
export interface LeadGenTrendPoint {
  label: string
  value: number
  target?: number
}
export interface LeadGenPeriodRow {
  label: string
  leads: number
  qualified: number
  mqlToSql: number
  contacts: number
}
export interface LeadGenAnalyticsData {
  range: { startDate: string; endDate: string; key: RangeKey }
  target: { weeklyLeads: number }
  kpis: LeadGenAnalyticsKpi[]
  periodComparison: LeadGenPeriodRow[]
  funnel: { stage: string; value: number }[]
  trends: {
    leads: { metricLabel: string; points: LeadGenTrendPoint[] }
    leadToQualified: { metricLabel: string; points: LeadGenTrendPoint[] }
  }
}

export function getLeadGenAnalytics(range: RangeKey, custom?: CustomRange | null) {
  return api.get<LeadGenAnalyticsData>(`/leadgen/analytics?${rangeQuery(range, custom)}`)
}
