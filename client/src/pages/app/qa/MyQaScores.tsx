import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, ClipboardCheck } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { StatCard } from '../../../components/StatCard'
import { Badge } from '../../../components/ui/Badge'
import { TrendLineChart } from '../../../components/charts/TrendLineChart'
import { useToast } from '../../../components/ui/Toast'
import { fromNow } from '../../../lib/datetime'
import { myEvaluations, type EvaluationSummary } from '../../../lib/qaApi'

export default function MyQaScores() {
  const { addToast } = useToast()
  const [evals, setEvals] = useState<EvaluationSummary[] | null>(null)

  useEffect(() => {
    myEvaluations()
      .then((r) => setEvals(r.evaluations))
      .catch(() => { setEvals([]); addToast({ type: 'error', message: 'Could not load your QA scores.' }) })
  }, [addToast])

  const avg = evals && evals.length ? Math.round((evals.reduce((s, e) => s + e.totalScore, 0) / evals.length) * 10) / 10 : null
  const last = evals && evals.length ? evals[0].totalScore : null
  // Oldest → newest for the trend line.
  const trend = (evals ?? []).slice().reverse().map((e) => ({ label: new Date(e.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), value: e.totalScore }))

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-headline-lg text-ink">My QA Scores</h1>
        <p className="mt-0.5 text-body-md text-ink-muted">Your call-quality evaluations and feedback.</p>
      </div>

      {evals === null ? (
        <div className="text-body-md text-ink-muted">Loading…</div>
      ) : evals.length === 0 ? (
        <Card><div className="flex flex-col items-center gap-2 py-12 text-center"><ClipboardCheck size={26} className="text-primary" /><p className="text-body-md text-ink-muted">No QA evaluations yet.</p></div></Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="Latest score" value={last !== null ? `${last}%` : '—'} />
            <StatCard label="Average score" value={avg !== null ? `${avg}%` : '—'} />
            <StatCard label="Evaluations" value={evals.length} />
          </div>

          {trend.length > 1 && (
            <Card title="Score trend"><TrendLineChart data={trend} /></Card>
          )}

          <Card title="All evaluations" flush>
            <ul className="divide-y divide-line">
              {evals.map((e) => (
                <li key={e.id}>
                  <Link to={`/app/qa/evaluations/${e.id}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50">
                    {e.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-danger" />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body-md font-medium text-ink">{e.scorecardName}</p>
                      <p className="truncate text-body-sm text-ink-muted">by {e.evaluatorName} · {fromNow(e.createdAt)}{e.acknowledged ? ' · acknowledged' : ''}</p>
                    </div>
                    <Badge tone={e.criticalFailTriggered ? 'danger' : e.passed ? 'success' : 'warning'}>{e.totalScore}%</Badge>
                    <ChevronRight size={16} className="shrink-0 text-ink-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  )
}
