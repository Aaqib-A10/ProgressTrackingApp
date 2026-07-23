import { api } from './api'

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api'

export interface ItadAgentRow {
  id: string
  name: string
  email: string
  weeklyQa: { week: number; label: string; avg: number | null; count: number }[]
  monthQaAvg: number | null
  qaCount: number
  daysLogged: number
  callsDialed: number
  connected: number
  voicemail: number
  emailsSent: number
  interested: number
  closed: number
  rfqs: number
}
export interface ItadTeamTotals {
  agents: number
  qaAvg: number | null
  qaCount: number
  callsDialed: number
  connected: number
  closed: number
  rfqs: number
  connectRate: number // 0..1
}
export interface ItadDeltas {
  qaAvg: number
  callsDialed: number
  connected: number
  closed: number
  rfqs: number
  connectRate: number
}
export interface ItadReport {
  department: 'ITAD'
  month: string
  monthLabel: string
  weeks: number
  team: ItadTeamTotals
  prev: Omit<ItadTeamTotals, 'agents'> | null
  deltas: ItadDeltas
  topAgent: { name: string; avg: number } | null
  agents: ItadAgentRow[]
}

export interface LeadGenAgentRow {
  id: string
  name: string
  email: string
  daysLogged: number
  leads: number
  accountsResearched: number
  contactsFound: number
  mql: number
  sql: number
  verticals: { name: string; count: number }[]
}
export interface LeadGenReport {
  department: 'LEAD_GEN'
  month: string
  monthLabel: string
  team: { agents: number; leads: number; mql: number; sql: number; mqlToSqlRate: number | null }
  topVerticals: { name: string; count: number }[]
  topAgent: { name: string; leads: number } | null
  agents: LeadGenAgentRow[]
}

export type MonthlyReport = ItadReport | LeadGenReport

export const getMonthlyReport = (department: 'ITAD' | 'LEAD_GEN', month?: string) =>
  api.get<{ report: MonthlyReport }>(`/reports/monthly?department=${department}${month ? `&month=${month}` : ''}`)

export const sendMonthlyReport = (department: 'ITAD' | 'LEAD_GEN', month: string, to?: string) =>
  api.post<{ sent: boolean; recipients: string[] }>('/reports/monthly/send', { department, month, ...(to ? { to } : {}) })

/** Standalone printable report HTML (opens in a new tab → print / Save as PDF). Cookie-authed. */
export const monthlyPreviewUrl = (department: 'ITAD' | 'LEAD_GEN', month: string) =>
  `${BASE_URL}/reports/monthly/preview?department=${department}&month=${month}`

// ---------- Consolidated management report (ITAD + Bid Tracker + Marketing) ----------
export const managementPreviewUrl = (month: string) => `${BASE_URL}/reports/management/preview?month=${month}`
export const sendManagementReport = (month: string, to?: string) =>
  api.post<{ sent: boolean; recipients: string[] }>('/reports/management/send', { month, ...(to ? { to } : {}) })
