import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ClipboardCheck, AlertTriangle } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { TextField, TextArea } from '../../../components/ui/Input'
import { Badge } from '../../../components/ui/Badge'
import { useToast } from '../../../components/ui/Toast'
import { formatPercent } from '../../../lib/format'
import { getEvaluation, updateEvaluation, type EvaluationDetail, type ScorecardCategory } from '../../../lib/qaApi'
import { computeLiveScore, type AnswerState } from '../../../lib/qaScore'
import { BAND_TONE, ScoreInput } from './QaEvaluate'

export default function QaEvaluationEdit() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { addToast } = useToast()
  const [data, setData] = useState<EvaluationDetail | null>(null)
  const [denied, setDenied] = useState(false)

  // Editable state
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({})
  const [comments, setComments] = useState<Record<string, string>>({}) // categoryName -> comment
  const [callRef, setCallRef] = useState('')
  const [customerNo, setCustomerNo] = useState('')
  const [overall, setOverall] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getEvaluation(id)
      .then((r) => {
        const e = r.evaluation
        if (!e.canEdit) { setDenied(true); return }
        setData(e)
        const a: Record<string, AnswerState> = {}
        for (const ans of e.answers) a[String(ans.order)] = { score: ans.score, isNA: ans.isNA }
        setAnswers(a)
        const c: Record<string, string> = {}
        for (const cat of e.categories) c[cat.name] = cat.comment ?? ''
        setComments(c)
        setCallRef(e.callReference ?? '')
        setCustomerNo(e.customerNumber ?? '')
        setOverall(e.overallComments ?? '')
      })
      .catch((err) => { if (err?.status === 403 || err?.status === 404) setDenied(true); else addToast({ type: 'error', message: 'Could not load evaluation.' }) })
  }, [id, addToast])

  // Rebuild a scorecard-shaped tree from the (immutable) answer snapshots, keyed by answer order.
  const categories = useMemo<ScorecardCategory[]>(() => {
    if (!data) return []
    const byName: { name: string; questions: ScorecardCategory['questions'] }[] = []
    const index = new Map<string, number>()
    for (const ans of data.answers) {
      if (!index.has(ans.categoryName)) { index.set(ans.categoryName, byName.length); byName.push({ name: ans.categoryName, questions: [] }) }
      byName[index.get(ans.categoryName)!].questions.push({
        id: String(ans.order),
        text: ans.questionText,
        type: ans.type,
        maxScore: ans.maxScore,
        criticalFail: ans.criticalFail,
        allowNA: true,
      })
    }
    return byName.map((c, i) => ({ id: `cat-${i}`, name: c.name, questions: c.questions }))
  }, [data])

  const live = useMemo(
    () => (data ? computeLiveScore(categories, answers, data.bands) : null),
    [data, categories, answers],
  )

  async function submit() {
    if (!data || saving) return
    setSaving(true)
    try {
      const res = await updateEvaluation(id, {
        callReference: callRef.trim() || null,
        customerNumber: customerNo.trim() || null,
        overallComments: overall.trim() || null,
        sectionComments: categories.map((c) => ({ name: c.name, comment: (comments[c.name] || '').trim() || null })),
        answers: Object.entries(answers).map(([order, a]) => ({ order: Number(order), score: a.isNA ? null : a.score, isNA: a.isNA })),
      })
      addToast({ type: 'success', message: `Updated — ${res.totalScore}% (${res.band}).` })
      navigate(`/app/qa/evaluations/${id}`)
    } catch {
      addToast({ type: 'error', message: 'Could not save changes.' })
    } finally {
      setSaving(false)
    }
  }

  if (denied) return <div className="mx-auto max-w-3xl space-y-4"><Back id={id} /><Card><p className="py-10 text-center text-body-md text-ink-muted">You can’t edit this evaluation.</p></Card></div>
  if (!data) return <div className="mx-auto max-w-3xl space-y-4"><Back id={id} /><div className="text-body-md text-ink-muted">Loading…</div></div>

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Back id={id} />

      <Card>
        <h1 className="text-headline-md text-ink">Edit evaluation — {data.agent.name}</h1>
        <p className="text-body-sm text-ink-muted">{data.scorecardName}</p>
      </Card>

      <Card title="Details">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Call reference" value={callRef} onChange={(e) => setCallRef(e.target.value)} placeholder="e.g. CR-10293" />
          <TextField label="Customer number" value={customerNo} onChange={(e) => setCustomerNo(e.target.value)} placeholder="e.g. 0345-..." />
        </div>
      </Card>

      {categories.map((c) => (
        <Card key={c.id} title={c.name} action={<span className="text-body-sm tabular-nums text-ink-muted">{live?.categoryPoints[c.id]?.earned ?? 0} / {live?.categoryPoints[c.id]?.max ?? 0} pts</span>}>
          <div className="space-y-3">
            {c.questions.map((q) => (
              <div key={q.id}>
                <p className="mb-1.5 text-body-md text-ink">
                  {q.text}
                  {q.criticalFail && <span className="ml-2 inline-flex items-center gap-1 text-body-sm font-semibold text-danger"><AlertTriangle size={12} /> critical</span>}
                </p>
                <ScoreInput question={q} value={answers[q.id]} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />
              </div>
            ))}
          </div>
          <TextArea className="mt-3" rows={2} placeholder={`Comment for ${c.name} (optional)`} value={comments[c.name] || ''} onChange={(e) => setComments((m) => ({ ...m, [c.name]: e.target.value }))} />
        </Card>
      ))}

      <Card title="Overall comments">
        <TextArea rows={3} value={overall} onChange={(e) => setOverall(e.target.value)} placeholder="Summary feedback for the agent…" />
      </Card>

      {live && (
        <div className="sticky bottom-4 flex items-center justify-between rounded-card border border-line bg-card p-4 shadow-overlay">
          <div className="flex items-center gap-3">
            <ClipboardCheck size={20} className="text-primary" />
            <div>
              <p className="text-label-md uppercase text-ink-muted">Total · {live.totalEarned} / {live.totalMax} pts</p>
              <p className="text-headline-lg font-bold tabular-nums text-ink">{formatPercent(live.totalScore / 100)}</p>
            </div>
            {live.criticalFailTriggered ? <Badge tone="danger" dot>Critical fail — 0%</Badge> : <Badge tone={BAND_TONE[live.band]} dot>{live.band}</Badge>}
          </div>
          <Button onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
        </div>
      )}
    </div>
  )
}

function Back({ id }: { id: string }) {
  return <Link to={`/app/qa/evaluations/${id}`} className="inline-flex items-center gap-1.5 text-body-md font-medium text-ink-muted hover:text-ink"><ArrowLeft size={16} /> Back to evaluation</Link>
}
