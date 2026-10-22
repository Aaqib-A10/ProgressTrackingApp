import { api } from './api'

/** System Health (Super Admins and developers). */

export type ErrorSource = 'SERVER' | 'BROWSER' | 'JOB' | 'SLOW'
export type ErrorState = 'OPEN' | 'RESOLVED' | 'IGNORED'
export type CheckResult = 'PASS' | 'WARN' | 'FAIL' | 'SKIP'
export type RunState = 'RUNNING' | 'PASSED' | 'WARN' | 'FAILED'

export interface AuditRunView {
  id: string; trigger: string; state: RunState; startedAt: string; finishedAt: string | null; durationMs: number | null
  total: number; passed: number; warned: number; failed: number; skipped: number; newProblems: number; fixed: number
}
export interface CheckView { id: string; category: string; name: string; result: CheckResult; ms: number | null; status: number | null; detail: string | null; isNew: boolean; fixed: boolean }
export interface JobView { name: string; label: string; everyMs: number | null; lastRunAt: string | null; lastOkAt: string | null; lastError: string | null; lastDurationMs: number | null; runs: number; failures: number; state: 'ok' | 'failing' | 'stopped' | 'waiting' }
type Pick = { name: string; result: CheckResult; detail: string | null } | null

export interface HealthSummary {
  status: 'ok' | 'warn' | 'fail'
  lastRun: AuditRunView | null
  running: { id: string; startedAt: string } | null
  nextRunAt: string | null
  errors: { open: number; new24h: number; seen24h: number; slow24h: number; bySource: Partial<Record<ErrorSource, number>> }
  api: { read: { total: number; passed: number; failed: number }; write: { total: number; passed: number; failed: number } }
  jobs: JobView[]
  server: { uptimeSec: number; rss: number; freemem: number; totalmem: number; load: number; cpus: number; node: string; disk: Pick; ssl: Pick; db: Pick; migrations: Pick }
  uptime: { configured: boolean; lastPingAt: string | null; outages: { id: string; downAt: string; upAt: string; minutes: number; detail: string | null }[] }
  alertsTo: 'developers' | 'super-admins'
  developers: number
  canManageDevelopers: boolean
}

export interface ErrorRow { id: string; source: ErrorSource; message: string; route: string | null; status: number | null; count: number; people: number; state: ErrorState; firstSeenAt: string; lastSeenAt: string; reopenedAt: string | null }
export interface ErrorDetail extends Omit<ErrorRow, 'people'> {
  stack: string | null; resolvedAt: string | null; resolvedBy: string | null
  people: { id: string; name: string }[]
  hours: number[]
  events: { id: string; at: string; user: { id: string; name: string } | null; url: string | null; status: number | null; durationMs: number | null; meta: { browser?: string | null; kind?: string; release?: string | null } | null }[]
}

const q = (o: Record<string, string | undefined>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(o)) if (v) p.set(k, v)
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const healthApi = {
  summary: () => api.get<HealthSummary>('/system-health/summary'),
  errors: (f: { state?: string; source?: string; q?: string }) => api.get<{ errors: ErrorRow[] }>(`/system-health/errors${q(f)}`),
  error: (id: string) => api.get<{ error: ErrorDetail }>(`/system-health/errors/${id}`),
  setState: (id: string, state: ErrorState) => api.patch(`/system-health/errors/${id}`, { state }),
  brief: (id: string) => api.get<{ text: string }>(`/system-health/errors/${id}/brief`),
  ticket: (id: string, project: string, assigneeIds: string[]) => api.post<{ code: string }>(`/system-health/errors/${id}/ticket`, { project, assigneeIds }),
  runs: () => api.get<{ runs: AuditRunView[] }>('/system-health/audits'),
  run: (id: string) => api.get<{ run: AuditRunView; checks: CheckView[] }>(`/system-health/audits/${id}`),
  startRun: () => api.post<{ runId: string; already: boolean }>('/system-health/audits/run'),
  developers: () => api.get<{ users: { id: string; name: string; email: string; role: string; isDeveloper: boolean }[] }>('/system-health/developers'),
  setDeveloper: (userId: string, isDeveloper: boolean) => api.patch(`/system-health/developers/${userId}`, { isDeveloper }),
}
