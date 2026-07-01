import { api } from './api'
import type { RangeKey, CustomRange } from '../components/layout/RangeSelector'
import { rangeQuery } from './range'

export interface DashKpi {
  label: string
  value: number
  format: 'number' | 'percent'
  delta: number
  caption?: string
}

export interface DashTrendPoint {
  label: string
  value: number
  target?: number
}

export interface DashSubmission {
  id: string
  name: string
  status: 'SUBMITTED' | 'PENDING' | 'ON_LEAVE'
  metricLabel: string
  metricValue: number
}

export interface TeamDashboard {
  department: 'ITAD' | 'LEAD_GEN' | 'MARKETING'
  range: { startDate: string; endDate: string; key: RangeKey }
  kpis: DashKpi[]
  trend: { metricLabel: string; points: DashTrendPoint[] }
  breakdown: { name: string; value: number }[]
  improvement: string
  todaySubmissions: DashSubmission[]
  counts: { submitted: number; total: number }
}

export function getTeamDashboard(range: RangeKey, custom?: CustomRange | null) {
  return api.get<TeamDashboard>(`/dashboard/team?${rangeQuery(range, custom)}`)
}

// --- Executive (Super Admin) ---
export interface ExecDeptCard {
  type: 'ITAD' | 'LEAD_GEN' | 'MARKETING' | 'CSR' | 'ECOMMERCE'
  name: string
  members: number
  subtitle: string
  route: string | null
  headline: DashKpi[]
  improvement: string
}

export interface ExecBenchmarkRow {
  department: string
  members: number
  submitted: string
  primaryLabel: string
  primaryValue: number
  secondary: string
  delta: number
}

export interface ExecSummary {
  employees: number
  departments: number
  submittedToday: number
  formMembers: number
  onTimeRate: number
  pendingApprovals: number
  notSubmitted: number
  stockRequested: number
  coachingNeeded: number
  alerts: number
}

export interface ExecutiveDashboardData {
  range: { startDate: string; endDate: string; key: RangeKey }
  summary: ExecSummary
  departments: ExecDeptCard[]
  combinedTrend: { metricLabel: string; points: DashTrendPoint[] }
  benchmark: ExecBenchmarkRow[]
  insights: string[]
}

export function getExecutiveDashboard(range: RangeKey, custom?: CustomRange | null) {
  return api.get<ExecutiveDashboardData>(`/dashboard/executive?${rangeQuery(range, custom)}`)
}
