import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronRight, ClipboardCheck } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Badge } from '../../../components/ui/Badge'
import { ListToolbar } from '../../../components/ListToolbar'
import { useToast } from '../../../components/ui/Toast'
import { fromNow } from '../../../lib/datetime'
import { listEvaluations, type EvaluationSummary } from '../../../lib/qaApi'
import { BAND_TONE } from './QaEvaluate'

export default function QaEvaluationsList() {
  const { addToast } = useToast()
  const [params] = useSearchParams()
  const agentId = params.get('agentId') || undefined
  const [evals, setEvals] = useState<EvaluationSummary[] | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    setEvals(null)
    listEvaluations(agentId)
      .then((r) => setEvals(r.evaluations))
      .catch(() => { setEvals([]); addToast({ type: 'error', message: 'Could not load evaluations.' }) })
  }, [agentId, addToast])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return !q ? evals ?? [] : (evals ?? []).filter((e) => [e.agentName, e.evaluatorName, e.scorecardName].some((f) => f.toLowerCase().includes(q)))
  }, [evals, query])

  const agentName = agentId && evals && evals.length ? evals[0].agentName : null

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-headline-lg text-ink">{agentName ? `Evaluations — ${agentName}` : 'QA Evaluations'}</h1>
        <p className="mt-0.5 text-body-md text-ink-muted">Every evaluation — who was scored, by whom, and the result.</p>
      </div>

      {evals === null ? (
        <div className="text-body-md text-ink-muted">Loading…</div>
      ) : evals.length === 0 ? (
        <Card><div className="flex flex-col items-center gap-2 py-12 text-center"><ClipboardCheck size={26} className="text-primary" /><p className="text-body-md text-ink-muted">No evaluations yet.</p></div></Card>
      ) : (
        <Card flush>
          <div className="border-b border-line px-4 py-2.5">
            <ListToolbar query={query} onQuery={setQuery} placeholder="Search by agent, evaluator or scorecard…" />
          </div>
          <ul className="divide-y divide-line">
            {filtered.length === 0 && <li className="px-5 py-6 text-center text-body-md text-ink-muted">No evaluations match your search.</li>}
            {filtered.map((e) => (
              <li key={e.id}>
                <Link to={`/app/qa/evaluations/${e.id}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-body-sm font-semibold text-primary">{initials(e.agentName)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body-md font-medium text-ink">{e.agentName}</p>
                    <p className="truncate text-body-sm text-ink-muted">{e.scorecardName} · by {e.evaluatorName} · {fromNow(e.createdAt)}</p>
                  </div>
                  <Badge tone={e.criticalFailTriggered ? 'danger' : BAND_TONE[e.band] ?? 'neutral'}>{e.totalScore}%</Badge>
                  <ChevronRight size={16} className="shrink-0 text-ink-muted" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

function initials(name: string): string {
  return name.split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
}
