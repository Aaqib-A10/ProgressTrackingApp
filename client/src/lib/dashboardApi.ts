import { api } from './api'
import type { RangeKey, CustomRange } from '../components/layout/RangeSelector'
import { rangeQuery } from './range'
import type { Department } from './types'

export interface DashKpi {
  label: string
  value: number
  format: 'number' | 'percent'
  delta: number
  caption?: string
  /** A count of how things stand right now: no "vs previous period" arrow. */
  now?: boolean
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
  department: Department
  range: { startDate: string; endDate: string; key: RangeKey }
  kpis: DashKpi[]
  trend: { metricLabel: string; points: DashTrendPoint[] }
  breakdown: { name: string; value: number }[]
  /** Title of the breakdown card (default "Activity Breakdown"). */
  breakdownTitle?: string
  improvement: string
  todaySubmissions: DashSubmission[]
  counts: { submitted: number; total: number }
  /** Departments without a daily form: the people table shows a number instead of a submitted badge. */
  people?: { title: string; subtitle: string; showStatus: boolean }
}

// --- Top Achiever (one per department, judged on what that department does) ---
export interface TopAchiever {
  department: Department
  label: string
  basis: string
  winner: { name: string; value: number; display: string } | null
  note?: string
}

export function getTopAchievers(month?: string) {
  return api.get<{ month: string; winners: TopAchiever[] }>(`/dashboard/top-achiever${month ? `?month=${month}` : ''}`)
}

export function getTeamDashboard(range: RangeKey, custom?: CustomRange | null) {
  return api.get<TeamDashboard>(`/dashboard/team?${rangeQuery(range, custom)}`)
}

// --- Executive (Super Admin) ---
export interface ExecDeptCard {
  type: Department
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

export interface ExecQaHealth {
  avgScore: number
  passRate: number
  evaluations: number
  coachingNeeded: number
}

export interface ExecTopPerformer {
  department: string
  name: string
  metric: string
}
export interface ExecActivity {
  type: string
  text: string
  at: string
}

export interface ExecutiveDashboardData {
  range: { startDate: string; endDate: string; key: RangeKey }
  summary: ExecSummary
  qa: ExecQaHealth
  topPerformers: ExecTopPerformer[]
  recentActivity: ExecActivity[]
  departments: ExecDeptCard[]
  combinedTrend: { metricLabel: string; points: DashTrendPoint[] }
  benchmark: ExecBenchmarkRow[]
  insights: string[]
}

export function getExecutiveDashboard(range: RangeKey, custom?: CustomRange | null) {
  return api.get<ExecutiveDashboardData>(`/dashboard/executive?${rangeQuery(range, custom)}`)
}
