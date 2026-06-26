import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, AlertTriangle, CheckCircle2, Pencil } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { TextArea } from '../../../components/ui/Input'
import { Badge } from '../../../components/ui/Badge'
import { useAuth } from '../../../lib/auth'
import { useToast } from '../../../components/ui/Toast'
import { formatDateTime } from '../../../lib/datetime'
import { getEvaluation, acknowledgeEvaluation, recordingUrl, type EvaluationDetail } from '../../../lib/qaApi'
import { BAND_TONE } from './QaEvaluate'

export default function QaEvaluationDetail() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const { addToast } = useToast()
  const [data, setData] = useState<EvaluationDetail | null>(null)
  const [denied, setDenied] = useState(false)
  const [rebuttal, setRebuttal] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getEvaluation(id)
      .then((r) => setData(r.evaluation))
      .catch((e) => { if (e?.status === 403 || e?.status === 404) setDenied(true); else addToast({ type: 'error', message: 'Could not load evaluation.' }) })
  }, [id, addToast])

  async function acknowledge() {
    if (saving) return
    setSaving(true)
    try {
      await acknowledgeEvaluation(id, rebuttal.trim() || undefined)
      const r = await getEvaluation(id)
      setData(r.evaluation)
      addToast({ type: 'success', message: 'Acknowledged.' })
    } catch {
      addToast({ type: 'error', message: 'Could not acknowledge.' })
    } finally {
      setSaving(false)
    }
  }

  if (denied) return <div className="mx-auto max-w-3xl space-y-4"><Back /><Card><p className="py-10 text-center text-body-md text-ink-muted">You don’t have access to this evaluation.</p></Card></div>
  if (!data) return <div className="mx-auto max-w-3xl space-y-4"><Back /><div className="text-body-md text-ink-muted">Loading…</div></div>

  const isAgent = user?.id === data.agent.id
  const acknowledged = !!data.agentAcknowledgedAt

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center justify-between">
        <Back />
        {data.canEdit && (
          <Link
            to={`/app/qa/evaluations/${data.id}/edit`}
            className="inline-flex items-center gap-1.5 rounded-btn border border-line bg-card px-3 py-1.5 text-body-sm font-semibold text-ink hover:bg-slate-50"
          >
            <Pencil size={14} /> Edit
          </Link>
        )}
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex-1">
            <h1 className="text-headline-lg text-ink">{data.agent.name}</h1>
            <p className="text-body-sm text-ink-muted">{data.scorecardName} · by {data.evaluator.name} · {formatDateTime(data.createdAt)}</p>
            {(data.callReference || data.customerNumber) && (
              <p className="mt-0.5 text-body-sm text-ink-muted">
                {data.callReference && <>Call ref: {data.callReference}</>}
                {data.callReference && data.customerNumber && ' · '}
                {data.customerNumber && <>Customer: {data.customerNumber}</>}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-display-lg font-bold tabular-nums text-ink">{data.totalScore}%</p>
            {data.criticalFailTriggered ? <Badge tone="danger" dot>Critical fail</Badge> : <Badge tone={BAND_TONE[data.band]} dot>{data.band}</Badge>}
          </div>
        </div>
        {data.recording && (
          <div className="mt-4 border-t border-line pt-3">
            <p className="mb-1.5 text-body-sm font-semibold text-ink-muted">Call recording</p>
            <audio controls preload="none" className="w-full" src={recordingUrl(data.recording.id)} />
          </div>
        )}
      </Card>

      {/* Category breakdown */}
      <Card title="Category breakdown" flush>
        <div className="divide-y divide-line">
          {data.categories.map((c) => (
            <div key={c.name} className="px-5 py-3">
              <div className="flex items-center justify-between">
                <span className="text-body-md font-medium text-ink">{c.name}</span>
                <span className="text-body-sm tabular-nums text-ink-muted">{c.earned} / {c.maxPossible} pts · {c.scorePct}%</span>
              </div>
              {c.comment && <p className="mt-1 text-body-sm text-ink-muted">{c.comment}</p>}
            </div>
          ))}
        </div>
      </Card>

      {/* Per-question answers */}
      <Card title="Answers" flush>
        <div className="divide-y divide-line">
          {data.answers.map((a, i) => (
            <div key={i} className="flex items-start justify-between gap-3 px-5 py-2.5">
              <div className="min-w-0">
                <p className="text-body-sm text-ink-muted">{a.categoryName}{a.criticalFail ? ' · critical' : ''}</p>
                <p className="text-body-md text-ink">{a.questionText}</p>
              </div>
              <span className="shrink-0 text-body-md font-semibold tabular-nums text-ink">
                {a.isNA ? 'N/A' : a.type === 'YES_NO' ? (a.score === 1 ? 'Yes' : 'No') : `${a.score}/${a.maxScore}`}
              </span>
            </div>
          ))}
        </div>
      </Card>

      {data.overallComments && (
        <Card title="Overall comments"><p className="whitespace-pre-wrap text-body-md text-ink">{data.overallComments}</p></Card>
      )}

      {/* Agent acknowledgement / rebuttal */}
      {acknowledged ? (
        <Card>
          <p className="flex items-center gap-2 text-body-md font-medium text-success"><CheckCircle2 size={18} /> Acknowledged by {data.agent.name}</p>
          {data.agentRebuttal && <p className="mt-2 text-body-md text-ink"><span className="font-semibold">Rebuttal:</span> {data.agentRebuttal}</p>}
        </Card>
      ) : isAgent ? (
        <Card title="Acknowledge this review">
          <TextArea rows={3} placeholder="Optional rebuttal / your perspective…" value={rebuttal} onChange={(e) => setRebuttal(e.target.value)} />
          <div className="mt-3 flex justify-end">
            <Button onClick={acknowledge} disabled={saving}>{saving ? 'Saving…' : 'Acknowledge'}</Button>
          </div>
        </Card>
      ) : (
        <p className="flex items-center gap-2 px-1 text-body-sm text-ink-muted"><AlertTriangle size={14} /> Awaiting the agent’s acknowledgement.</p>
      )}
    </div>
  )
}

function Back() {
  return <Link to="/app/qa/my" className="inline-flex items-center gap-1.5 text-body-md font-medium text-ink-muted hover:text-ink"><ArrowLeft size={16} /> Back</Link>
}
