import { api } from './api'

export type BreakdownKind = 'CAMPAIGN' | 'INDUSTRY'
export interface BreakdownRow {
  category: string
  kind: BreakdownKind
  count: number
}
export interface LeadGenBreakdown {
  month: string
  leadsGenerated: number
  rows: BreakdownRow[]
  campaigns: BreakdownRow[]
  industries: BreakdownRow[]
  bbr: number
  rtlg: number
  topIndustry: BreakdownRow | null
  industriesTotal: number
  campaignsTotal: number
}

export const getLeadGenBreakdown = (month?: string) =>
  api.get<LeadGenBreakdown>(`/leadgen/breakdown${month ? `?month=${month}` : ''}`)

export const saveLeadGenBreakdown = (month: string, items: BreakdownRow[]) =>
  api.put<LeadGenBreakdown>('/leadgen/breakdown', { month, items })
