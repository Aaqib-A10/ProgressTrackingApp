import { api } from './api'
import type { RangeKey, CustomRange } from '../components/layout/RangeSelector'
import { rangeQuery } from './range'

export type ItadStatus = 'SUBMITTED' | 'ON_LEAVE' | 'HOLIDAY' | 'OFF'
export type PerfFlag = 'EXCEEDING' | 'OPTIMAL' | 'ATTENTION' | 'BELOW'

export const ITAD_METRICS = [
  { key: 'callsDialed', label: 'Calls Dialed' },
  { key: 'connected', label: 'Connected' },
  { key: 'voicemail', label: 'Voicemail' },
  { key: 'emailsSent', label: 'Emails Sent' },
  { key: 'interested', label: 'Interested' },
  { key: 'workingOn', label: 'Working On' },
  { key: 'closed', label: 'Closed' },
  { key: 'rfqs', label: 'RFQs' },
] as const

export type ItadMetricKey = (typeof ITAD_METRICS)[number]['key']
export type ItadTotals = Record<ItadMetricKey, number>

export interface ItadEntry extends ItadTotals {
  id: string
  date: string
  status: ItadStatus
  notes: string
}

export interface ItadEntryResponse {
  date: string
  entry: ItadEntry | null
  stats: { dailyDialTarget: number; avgConnectRate: number; avgDials: number; avgConnected: number }
}

export interface ItadKpis {
  connectRate: number
  voicemailRate: number
  interestRate: number
  rfqConversion: number
  closeRate: number
}

export interface ItadAgentRow {
  id: string
  name: string
  status: 'SUBMITTED' | 'PENDING' | 'ON_LEAVE'
  onLeaveToday: boolean
  flag: PerfFlag
  totals: ItadTotals
  kpis: ItadKpis
}

export interface ItadTeamResponse {
  range: { startDate: string; endDate: string; key: RangeKey }
  target: { dailyDials: number }
  entryCount: number
  team: { totals: ItadTotals; kpis: ItadKpis }
  deltas: { callsDialed: number; connectRate: number; interested: number; closed: number }
  agents: ItadAgentRow[]
  topAgents: { id: string; name: string; dials: number }[]
}

export interface UpsertItadInput extends Partial<ItadTotals> {
  status: ItadStatus
  notes?: string
  date?: string
}

export function getMyItadEntry(date?: string) {
  return api.get<ItadEntryResponse>(`/itad/entries${date ? `?date=${date}` : ''}`)
}

export function upsertItadEntry(input: UpsertItadInput) {
  return api.put<{ entry: ItadEntry }>('/itad/entries', input)
}

export function getItadTeam(range: RangeKey, custom?: CustomRange | null) {
  return api.get<ItadTeamResponse>(`/itad/team?${rangeQuery(range, custom)}`)
}

// --- Analytics ---
export interface AnalyticsKpi {
  label: string
  value: number
  format: 'percent' | 'number'
  delta: number
}
export interface AnalyticsTrendPoint {
  label: string
  value: number
  target?: number
}
export interface ItadPeriodRow {
  label: string
  dials: number
  connectRate: number
  interested: number
  closed: number
}
export interface ItadAnalyticsData {
  range: { startDate: string; endDate: string; key: RangeKey }
  target: { dailyDials: number }
  kpis: AnalyticsKpi[]
  periodComparison: ItadPeriodRow[]
  lifecycle: { stage: string; value: number }[]
  trends: {
    dials: { metricLabel: string; points: AnalyticsTrendPoint[] }
    connectRate: { metricLabel: string; points: AnalyticsTrendPoint[] }
  }
}

export function getItadAnalytics(range: RangeKey, custom?: CustomRange | null) {
  return api.get<ItadAnalyticsData>(`/itad/analytics?${rangeQuery(range, custom)}`)
}
