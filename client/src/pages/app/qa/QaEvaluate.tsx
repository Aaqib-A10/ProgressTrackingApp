import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, ClipboardCheck, Upload, AlertTriangle } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { TextField, TextArea } from '../../../components/ui/Input'
import { Badge } from '../../../components/ui/Badge'
import { useToast } from '../../../components/ui/Toast'
import { formatPercent } from '../../../lib/format'
import {
  listQaAgents, listScorecards, getScorecard, listEvaluations, createEvaluation, uploadRecording,
  type QaAgentRow, type ScorecardSummary, type ScorecardFull, type EvaluationSummary,
} from '../../../lib/qaApi'
import type { BadgeTone } from '../../../components/ui/Badge'
import { computeLiveScore, type AnswerState } from '../../../lib/qaScore'

type Dept = 'ITAD' | 'CSR'

export const BAND_TONE: Record<string, BadgeTone> = { Unacceptable: 'danger', Acceptable: 'warning', Good: 'primary', Excellent: 'success' }

export default function QaEvaluate() {
  const { addToast } = useToast()
  const [dept, setDept] = useState<Dept>('ITAD')
  const [agents, setAgents] = useState<QaAgentRow[] | null>(null)
  const [agent, setAgent] = useState<QaAgentRow | null>(null)

  useEffect(() => {
    setAgents(null)
    setAgent(null)
    listQaAgents(dept)
      .then((r) => setAgents(r.agents))
      .catch(() => { setAgents([]); addToast({ type: 'error', message: 'Could not load agents.' }) })
  }, [dept, addToast])

  if (agent) return <AgentEvaluation dept={dept} agent={agent} onBack={() => setAgent(null)} />

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-headline-lg text-ink">QA — Evaluate Agents</h1>
        <p className="mt-0.5 text-body-md text-ink-muted">Pick a department, choose an agent, and score a call.</p>
      </div>

      <div className="inline-flex gap-1.5">
        {(['ITAD', 'CSR'] as Dept[]).map((d) => (
          <button
            key={d}
            onClick={() => setDept(d)}
            className={'rounded-full px-4 py-1.5 text-body-md font-medium transition-colors ' + (dept === d ? 'bg-primary text-white' : 'bg-slate-100 text-ink-muted hover:bg-slate-200')}
          >
            {d}
          </button>
        ))}
      </div>

      <Card title={`${dept} Agents`} flush>
        {agents === null ? (
          <div className="p-5 text-body-md text-ink-muted">Loading…</div>
        ) : agents.length === 0 ? (
          <div className="p-8 text-center text-body-md text-ink-muted">No active agents in {dept}.</div>
        ) : (
          <ul className="divide-y divide-line">
            {agents.map((a) => (
              <li key={a.id}>
                <button onClick={() => setAgent(a)} className="flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-slate-50">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-body-sm font-semibold text-primary">{initials(a.name)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body-md font-medium text-ink">{a.name}</p>
                    <p className="truncate text-body-sm text-ink-muted">{a.email}</p>
                  </div>
                  <div className="text-right text-body-sm">
                    <p className="font-semibold tabular-nums text-ink">{a.avgScore !== null ? `${a.avgScore}%` : '—'}</p>
                    <p className="text-ink-muted">{a.evaluations} eval{a.evaluations === 1 ? '' : 's'}</p>
                  </div>
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

/** Agent detail: their past QA scores + a new evaluation form. */
function AgentEvaluation({ dept, agent, onBack }: { dept: Dept; agent: QaAgentRow; onBack: () => void }) {
  const { addToast } = useToast()
  const navigate = useNavigate()
  const [past, setPast] = useState<EvaluationSummary[]>([])
  const [scorecards, setScorecards] = useState<ScorecardSummary[]>([])
  const [scorecardId, setScorecardId] = useState('')
  const [card, setCard] = useState<ScorecardFull | null>(null)

  const [answers, setAnswers] = useState<Record<string, AnswerState>>({})
  const [comments, setComments] = useState<Record<string, string>>({}) // categoryId -> comment
  const [callRef, setCallRef] = useState('')
  const [customerNo, setCustomerNo] = useState('')
  const [overall, setOverall] = useState('')
  const [recording, setRecording] = useState<{ id: string; name: string } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    listEvaluations(agent.id).then((r) => setPast(r.evaluations)).catch(() => undefined)
    listScorecards().then((r) => {
      const usable = r.scorecards.filter((s) => !s.departmentType || s.departmentType === dept)
      setScorecards(usable)
      if (usable[0]) setScorecardId(usable[0].id)
    }).catch(() => undefined)
  }, [agent.id, dept])

  useEffect(() => {
    if (!scorecardId) { setCard(null); return }
    getScorecard(scorecardId).then((r) => {
      setCard(r.scorecard)
      const init: Record<string, AnswerState> = {}
      r.scorecard.categories.forEach((c) => c.questions.forEach((q) => { init[q.id] = { score: null, isNA: false } }))
      setAnswers(init)
      setComments({})
    }).catch(() => undefined)
  }, [scorecardId])

  const live = useMemo(
    () => (card ? computeLiveScore(card.categories, answers, { passThreshold: card.passThreshold, bandGood: card.bandGood, bandExcellent: card.bandExcellent }) : null),
    [card, answers],
  )

  function setAnswer(qid: string, next: AnswerState) {
    setAnswers((a) => ({ ...a, [qid]: next }))
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const r = await uploadRecording(file)
      setRecording({ id: r.attachmentId, name: r.name })
      addToast({ type: 'success', message: 'Recording uploaded.' })
    } catch {
      addToast({ type: 'error', message: 'Recording upload failed (audio only, ≤50 MB).' })
    } finally {
      setUploading(false)
    }
  }

  async function submit() {
    if (!card || saving) return
    setSaving(true)
    try {
      const res = await createEvaluation({
        scorecardId: card.id,
        agentId: agent.id,
        callReference: callRef.trim() || undefined,
        customerNumber: customerNo.trim() || undefined,
        recordingAttachmentId: recording?.id,
        overallComments: overall.trim() || undefined,
        sections: card.categories.map((c) => ({
          categoryId: c.id,
          comment: (comments[c.id] || '').trim() || undefined,
          answers: c.questions.map((q) => ({ questionId: q.id, score: answers[q.id]?.isNA ? null : answers[q.id]?.score ?? null, isNA: !!answers[q.id]?.isNA })),
        })),
      })
      addToast({ type: 'success', message: `Saved — ${res.totalScore}% (${res.band}).` })
      navigate(`/app/qa/evaluations/${res.id}`)
    } catch {
      addToast({ type: 'error', message: 'Could not save the evaluation.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <button onClick={onBack} className="text-body-md font-medium text-ink-muted hover:text-ink">← Back to {dept} agents</button>

      <Card>
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-headline-md font-semibold text-primary">{initials(agent.name)}</span>
          <div className="flex-1">
            <h1 className="text-headline-md text-ink">{agent.name}</h1>
            <p className="text-body-sm text-ink-muted">{agent.email} · {dept}</p>
          </div>
          <div className="text-right">
            <p className="text-label-md uppercase text-ink-muted">Avg QA</p>
            <p className="text-headline-md font-semibold tabular-nums text-ink">{agent.avgScore !== null ? `${agent.avgScore}%` : '—'}</p>
          </div>
        </div>
        {past.length > 0 && (
          <div className="mt-4 border-t border-line pt-3">
            <p className="mb-2 text-body-sm font-semibold text-ink-muted">Past evaluations</p>
            <ul className="space-y-1">
              {past.slice(0, 5).map((e) => (
                <li key={e.id}>
                  <button onClick={() => navigate(`/app/qa/evaluations/${e.id}`)} className="flex w-full items-center justify-between rounded-btn px-2 py-1.5 text-left hover:bg-slate-50">
                    <span className="text-body-sm text-ink">{e.scorecardName} · {new Date(e.createdAt).toLocaleDateString()}</span>
                    <Badge tone={e.passed ? 'success' : 'danger'}>{e.totalScore}%</Badge>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {/* Evaluation form */}
      <Card title="New Evaluation" action={
        <select value={scorecardId} onChange={(e) => setScorecardId(e.target.value)} className="h-9 rounded-btn border border-line bg-card px-2 text-body-sm text-ink">
          {scorecards.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      }>
        {!card ? (
          <p className="py-6 text-center text-body-sm text-ink-muted">Select a scorecard to begin.</p>
        ) : (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <TextField label="Call reference (optional)" value={callRef} onChange={(e) => setCallRef(e.target.value)} placeholder="e.g. CR-10293" />
              <TextField label="Customer number (optional)" value={customerNo} onChange={(e) => setCustomerNo(e.target.value)} placeholder="e.g. 0345-..." />
              <div>
                <label className="mb-1 block text-body-sm font-semibold text-ink">Call recording (audio)</label>
                <label className="flex h-10 cursor-pointer items-center gap-2 rounded-btn border border-dashed border-line px-3 text-body-sm text-ink-muted hover:border-primary/40">
                  <Upload size={15} /> {uploading ? 'Uploading…' : recording ? recording.name : 'Upload audio'}
                  <input type="file" accept="audio/*" className="hidden" onChange={onUpload} disabled={uploading} />
                </label>
              </div>
            </div>

            {card.categories.map((c) => (
              <div key={c.id} className="rounded-card border border-line p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-headline-md text-ink">{c.name}</h3>
                  <span className="text-body-sm tabular-nums text-ink-muted">{live?.categoryPoints[c.id]?.earned ?? 0} / {live?.categoryPoints[c.id]?.max ?? 0} pts</span>
                </div>
                <div className="space-y-3">
                  {c.questions.map((q) => (
                    <div key={q.id}>
                      <p className="mb-1.5 text-body-md text-ink">
                        {q.text}
                        {q.criticalFail && <span className="ml-2 inline-flex items-center gap-1 text-body-sm font-semibold text-danger"><AlertTriangle size={12} /> critical</span>}
                      </p>
                      <ScoreInput question={q} value={answers[q.id]} onChange={(v) => setAnswer(q.id, v)} />
                    </div>
                  ))}
                </div>
                <TextArea className="mt-3" rows={2} placeholder={`Comment for ${c.name} (optional)`} value={comments[c.id] || ''} onChange={(e) => setComments((m) => ({ ...m, [c.id]: e.target.value }))} />
              </div>
            ))}

            <TextArea label="Overall comments" rows={3} value={overall} onChange={(e) => setOverall(e.target.value)} placeholder="Summary feedback for the agent…" />
          </div>
        )}
      </Card>

      {/* Live total + submit (sticky bar) */}
      {card && live && (
        <div className="sticky bottom-4 flex items-center justify-between rounded-card border border-line bg-card p-4 shadow-overlay">
          <div className="flex items-center gap-3">
            <ClipboardCheck size={20} className="text-primary" />
            <div>
              <p className="text-label-md uppercase text-ink-muted">Total · {live.totalEarned} / {live.totalMax} pts</p>
              <p className="text-headline-lg font-bold tabular-nums text-ink">{formatPercent(live.totalScore / 100)}</p>
            </div>
            {live.criticalFailTriggered ? <Badge tone="danger" dot>Critical fail — 0%</Badge> : <Badge tone={BAND_TONE[live.band]} dot>{live.band}</Badge>}
          </div>
          <Button onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Submit evaluation'}</Button>
        </div>
      )}
    </div>
  )
}

function ScoreInput({ question, value, onChange }: { question: ScorecardFull['categories'][number]['questions'][number]; value?: AnswerState; onChange: (v: AnswerState) => void }) {
  const isNA = !!value?.isNA
  const score = value?.score ?? null
  const btn = (active: boolean) =>
    'h-8 min-w-8 rounded-btn px-2 text-body-sm font-medium transition-colors ' + (active ? 'bg-primary text-white' : 'bg-slate-100 text-ink-muted hover:bg-slate-200')

  if (question.type === 'YES_NO') {
    return (
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={btn(!isNA && score === 1)} onClick={() => onChange({ score: 1, isNA: false })}>Yes</button>
        <button type="button" className={btn(!isNA && score === 0)} onClick={() => onChange({ score: 0, isNA: false })}>No</button>
        {question.allowNA && <button type="button" className={btn(isNA)} onClick={() => onChange({ score: null, isNA: true })}>N/A</button>}
      </div>
    )
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {Array.from({ length: question.maxScore }, (_, i) => i + 1).map((n) => (
        <button key={n} type="button" className={btn(!isNA && score === n)} onClick={() => onChange({ score: n, isNA: false })}>{n}</button>
      ))}
      {question.allowNA && <button type="button" className={btn(isNA)} onClick={() => onChange({ score: null, isNA: true })}>N/A</button>}
    </div>
  )
}

function initials(name: string): string {
  return name.split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
}
