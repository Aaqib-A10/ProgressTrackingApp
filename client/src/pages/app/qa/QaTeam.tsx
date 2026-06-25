import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Users } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Badge } from '../../../components/ui/Badge'
import { useToast } from '../../../components/ui/Toast'
import { useAuth } from '../../../lib/auth'
import { listQaAgents, type QaAgentRow, type QaTeamLead } from '../../../lib/qaApi'
import { BAND_TONE } from './QaEvaluate'

type Dept = 'ITAD' | 'CSR'

function band(score: number | null): string {
  if (score === null) return 'neutral'
  if (score >= 82) return 'Excellent'
  if (score >= 64) return 'Good'
  if (score >= 50) return 'Acceptable'
  return 'Unacceptable'
}

export default function QaTeam() {
  const { user } = useAuth()
  const { addToast } = useToast()
  const navigate = useNavigate()
  // QA/Admin choose a department; a Team Lead is fixed to their own.
  const canPick = user?.role === 'QA' || user?.role === 'QA_LEAD' || user?.role === 'SUPER_ADMIN'
  const [dept, setDept] = useState<Dept>('ITAD')
  const [lead, setLead] = useState<QaTeamLead | null>(null)
  const [agents, setAgents] = useState<QaAgentRow[] | null>(null)
  const [deptLabel, setDeptLabel] = useState('')

  useEffect(() => {
    setAgents(null)
    listQaAgents(canPick ? dept : undefined)
      .then((r) => { setAgents(r.agents); setLead(r.teamLead); setDeptLabel(r.department) })
      .catch(() => { setAgents([]); addToast({ type: 'error', message: 'Could not load the team.' }) })
  }, [dept, canPick, addToast])

  const teamAvg = agents && agents.length
    ? Math.round((agents.filter((a) => a.avgScore !== null).reduce((s, a) => s + (a.avgScore ?? 0), 0) / Math.max(1, agents.filter((a) => a.avgScore !== null).length)) * 10) / 10
    : null

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">Team QA</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">A department’s lead and team, with their call-quality scores.</p>
        </div>
        {canPick && (
          <div className="inline-flex gap-1.5">
            {(['ITAD', 'CSR'] as Dept[]).map((d) => (
              <button key={d} onClick={() => setDept(d)} className={'rounded-full px-3.5 py-1.5 text-body-md font-medium transition-colors ' + (dept === d ? 'bg-primary text-white' : 'bg-slate-100 text-ink-muted hover:bg-slate-200')}>{d}</button>
            ))}
          </div>
        )}
      </div>

      {/* Lead + team summary */}
      <Card>
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary"><Users size={22} /></span>
          <div className="flex-1">
            <p className="text-label-md uppercase text-ink-muted">{deptLabel || dept} · Team Lead</p>
            <p className="text-headline-md text-ink">{lead ? lead.name : 'No team lead assigned'}</p>
          </div>
          <div className="text-right">
            <p className="text-label-md uppercase text-ink-muted">Team avg QA</p>
            <p className="text-headline-md font-bold tabular-nums text-ink">{teamAvg !== null ? `${teamAvg}%` : '—'}</p>
          </div>
        </div>
      </Card>

      <Card title="Team members" subtitle="Click a member to see their evaluations" flush>
        {agents === null ? (
          <div className="p-5 text-body-md text-ink-muted">Loading…</div>
        ) : agents.length === 0 ? (
          <div className="p-8 text-center text-body-md text-ink-muted">No active members in this team.</div>
        ) : (
          <ul className="divide-y divide-line">
            {agents.map((a) => (
              <li key={a.id}>
                <button onClick={() => navigate(`/app/qa/evaluations?agentId=${a.id}`)} className="flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-slate-50">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-body-sm font-semibold text-primary">{initials(a.name)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body-md font-medium text-ink">{a.name}</p>
                    <p className="truncate text-body-sm text-ink-muted">{a.evaluations} evaluation{a.evaluations === 1 ? '' : 's'}{a.lastScore !== null ? ` · last ${a.lastScore}%` : ''}</p>
                  </div>
                  {a.avgScore !== null ? <Badge tone={BAND_TONE[band(a.avgScore)] ?? 'neutral'}>{a.avgScore}%</Badge> : <span className="text-body-sm text-ink-muted">no scores</span>}
                  <ChevronRight size={16} className="shrink-0 text-ink-muted" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function initials(name: string): string {
  return name.split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
}
