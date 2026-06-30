import { api } from './api'
import type { RangeKey, CustomRange } from '../components/layout/RangeSelector'
import { rangeQuery } from './range'
import type { Department } from './types'

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api'

export type QaQuestionType = 'RATING' | 'YES_NO'

// ---------- Scorecards ----------
export interface ScorecardSummary {
  id: string
  name: string
  description: string | null
  departmentType: Department | null
  passThreshold: number
  categoryCount: number
  evaluationCount: number
}
export interface ScorecardQuestion {
  id: string
  text: string
  type: QaQuestionType
  maxScore: number
  criticalFail: boolean
  allowNA: boolean
}
export interface ScorecardCategory {
  id: string
  name: string
  questions: ScorecardQuestion[]
}
export interface ScorecardFull {
  id: string
  name: string
  description: string | null
  departmentType: Department | null
  passThreshold: number
  bandGood: number
  bandExcellent: number
  categories: ScorecardCategory[]
}
export interface ScorecardInput {
  name: string
  description?: string
  departmentType?: Department | null
  passThreshold: number
  bandGood: number
  bandExcellent: number
  categories: {
    name: string
    questions: { text: string; type: QaQuestionType; maxScore: number; criticalFail: boolean; allowNA: boolean }[]
  }[]
}

export const listScorecards = () => api.get<{ scorecards: ScorecardSummary[] }>('/qa/scorecards')
export const getScorecard = (id: string) => api.get<{ scorecard: ScorecardFull }>(`/qa/scorecards/${id}`)
export const createScorecard = (input: ScorecardInput) => api.post<{ scorecard: ScorecardFull }>('/qa/scorecards', input)
export const updateScorecard = (id: string, input: ScorecardInput) => api.put<{ scorecard: ScorecardFull }>(`/qa/scorecards/${id}`, input)
export const archiveScorecard = (id: string) => api.del<void>(`/qa/scorecards/${id}`)

// ---------- Agents ----------
export interface QaAgentRow {
  id: string
  name: string
  email: string
  evaluations: number
  lastScore: number | null
  avgScore: number | null
}
export interface QaTeamLead { id: string; name: string; email: string }
export const listQaAgents = (department?: 'ITAD' | 'CSR') =>
  api.get<{ department: string; teamLead: QaTeamLead | null; agents: QaAgentRow[] }>(`/qa/agents${department ? `?department=${department}` : ''}`)

// QA team (evaluator productivity) — for QA Team Lead / Admin.
export interface QaEvaluatorRow {
  id: string
  name: string
  email: string
  role: string
  completed: number
  avgScoreGiven: number | null
  lastActivity: string | null
}
export const listQaEvaluators = () => api.get<{ evaluators: QaEvaluatorRow[] }>('/qa/evaluators')

// ---------- Evaluations ----------
export interface EvaluationInput {
  scorecardId: string
  agentId: string
  callReference?: string
  customerNumber?: string
  callDate?: string
  recordingAttachmentId?: string
  overallComments?: string
  sections: {
    categoryId: string
    comment?: string
    answers: { questionId: string; score: number | null; isNA: boolean }[]
  }[]
}
export interface EvaluationSummary {
  id: string
  scorecardName: string
  evaluatorName: string
  agentName: string
  agentId: string
  totalScore: number
  band: string
  passed: boolean
  criticalFailTriggered: boolean
  coachingNeeded: boolean
  acknowledged: boolean
  unread: boolean
  createdAt: string
}
export interface EvaluationBands { passThreshold: number; bandGood: number; bandExcellent: number }
export interface EvaluationDetail {
  id: string
  scorecardId: string | null
  scorecardName: string
  bands: EvaluationBands
  canEdit: boolean
  evaluator: { id: string; name: string; email: string; role: string }
  agent: { id: string; name: string; email: string; role: string }
  callReference: string | null
  customerNumber: string | null
  callDate: string | null
  recording: { id: string; name: string; mimeType: string } | null
  totalScore: number
  band: string
  passed: boolean
  criticalFailTriggered: boolean
  coachingNeeded: boolean
  overallComments: string | null
  agentAcknowledgedAt: string | null
  agentRebuttal: string | null
  createdAt: string
  categories: { name: string; earned: number; maxPossible: number; scorePct: number; comment: string | null }[]
  answers: { order: number; categoryName: string; questionText: string; type: QaQuestionType; maxScore: number; criticalFail: boolean; score: number | null; isNA: boolean }[]
}

export interface EvaluationUpdateInput {
  callReference?: string | null
  customerNumber?: string | null
  overallComments?: string | null
  sectionComments: { name: string; comment: string | null }[]
  answers: { order: number; score: number | null; isNA: boolean }[]
}
export const createEvaluation = (input: EvaluationInput) =>
  api.post<{ id: string; totalScore: number; band: string; passed: boolean; criticalFailTriggered: boolean }>('/qa/evaluations', input)
export const updateEvaluation = (id: string, input: EvaluationUpdateInput) =>
  api.put<{ id: string; totalScore: number; band: string; passed: boolean; criticalFailTriggered: boolean }>(`/qa/evaluations/${id}`, input)
export const getEvaluation = (id: string) => api.get<{ evaluation: EvaluationDetail }>(`/qa/evaluations/${id}`)

// ---------- Agent call activity (ITAD daily logs) ----------
export interface AgentActivityPeriod {
  key: string
  label: string
  startDate: string
  endDate: string
  daysLogged: number
  callsDialed: number
  connected: number
  voicemail: number
  emailsSent: number
  interested: number
  closed: number
  rfqs: number
}
export interface AgentActivity {
  hasData: boolean
  department: string | null
  periods: AgentActivityPeriod[]
}
export const getAgentActivity = (agentId: string) => api.get<AgentActivity>(`/qa/agents/${agentId}/activity`)
export const listEvaluations = (agentId?: string) =>
  api.get<{ evaluations: EvaluationSummary[] }>(`/qa/evaluations${agentId ? `?agentId=${agentId}` : ''}`)
export const myEvaluations = () => api.get<{ evaluations: EvaluationSummary[] }>('/qa/my-evaluations')
export const acknowledgeEvaluation = (id: string, rebuttal?: string) =>
  api.post<{ ok: true }>(`/qa/evaluations/${id}/acknowledge`, rebuttal ? { rebuttal } : {})
export const getQaUnreadCount = () => api.get<{ count: number }>('/qa/unread-count')

// ---------- Analytics + Top Achiever ----------
export interface QaAnalytics {
  range: { startDate: string; endDate: string; key: RangeKey }
  totals: { evaluations: number; avgScore: number; passRate: number }
  distribution: { name: string; value: number }[]
  passFail: { name: string; value: number }[]
  agents: { name: string; avg: number; count: number }[]
  categories: { name: string; avg: number }[]
  trend: { label: string; value: number }[]
}
export const getQaAnalytics = (department: 'ITAD' | 'CSR' | '' , range: RangeKey, custom?: CustomRange | null) =>
  api.get<QaAnalytics>(`/qa/analytics?${department ? `department=${department}&` : ''}${rangeQuery(range, custom)}`)

// ---------- Team Lead QA dashboard (rich per-agent analytics) ----------
export interface QaDashAgent {
  id: string
  name: string
  initials: string
  avg: number
  evals: number
  passCalls: number
  failCalls: number
  cats: Record<string, number>
  flag: 'good' | 'warn' | 'coach'
}
export interface QaTeamDashboard {
  range: { startDate: string; endDate: string; key: RangeKey }
  department: string
  teamLead: { id: string; name: string } | null
  scorecard: string | null
  bands: { good: number; excellent: number; target: number }
  totals: {
    evaluations: number
    avgScore: number
    passRate: number
    coachingCount: number
    topPerformer: { name: string; avg: number } | null
    agentCount: number
  }
  qualityDistribution: { band: string; count: number }[]
  scoreBands: { label: string; count: number }[]
  passFail: { pass: number; fail: number }
  categoryNames: string[]
  categories: { name: string; avg: number }[]
  catGap: { name: string; avg: number; gap: number; weakest: { name: string; score: number } | null }[]
  agents: QaDashAgent[]
  weekly: { week: string; scores: Record<string, number> }[]
}
export const getQaTeamDashboard = (department: 'ITAD' | 'CSR' | '', range: RangeKey, custom?: CustomRange | null) =>
  api.get<QaTeamDashboard>(`/qa/team-dashboard?${department ? `department=${department}&` : ''}${rangeQuery(range, custom)}`)

export interface EmployeeOfMonth {
  month: string
  minEvaluations: number
  /** Top Achiever benchmark — agents must average at least this score to qualify. */
  minScore: number
  /** `topScore` is set when a leading agent exists but fell below the benchmark. */
  winners: { department: string; winner: { name: string; avg: number; count: number } | null; topScore?: number }[]
}
export const getEmployeeOfMonth = (month?: string) =>
  api.get<EmployeeOfMonth>(`/qa/employee-of-month${month ? `?month=${month}` : ''}`)

// ---------- Recording upload (raw audio body) ----------
export async function uploadRecording(file: File): Promise<{ attachmentId: string; name: string; downloadUrl: string }> {
  const res = await fetch(`${BASE_URL}/qa/recordings?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': file.type || 'audio/mpeg' },
    body: file,
  })
  if (!res.ok) throw new Error((await res.text().catch(() => '')) || 'Upload failed')
  return res.json()
}

export const recordingUrl = (attachmentId: string) => `${BASE_URL}/qa/recordings/${attachmentId}`
