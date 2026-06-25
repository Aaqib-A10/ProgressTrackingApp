import { useEffect, useState } from 'react'
import { Plus, Trash2, ClipboardList } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { TextField } from '../../../components/ui/Input'
import { useToast } from '../../../components/ui/Toast'
import {
  listScorecards, getScorecard, createScorecard, updateScorecard, archiveScorecard,
  type ScorecardSummary, type QaQuestionType, type ScorecardInput,
} from '../../../lib/qaApi'

interface QEdit { text: string; type: QaQuestionType; maxScore: number; criticalFail: boolean; allowNA: boolean }
interface CEdit { name: string; questions: QEdit[] }
interface Editor { id?: string; name: string; description: string; departmentType: '' | 'ITAD' | 'CSR'; passThreshold: number; bandGood: number; bandExcellent: number; categories: CEdit[] }

const blankQ = (): QEdit => ({ text: '', type: 'RATING', maxScore: 10, criticalFail: false, allowNA: true })
const blankC = (): CEdit => ({ name: '', questions: [blankQ()] })
const blankEditor = (): Editor => ({ name: '', description: '', departmentType: '', passThreshold: 50, bandGood: 64, bandExcellent: 82, categories: [blankC()] })

const sel = 'h-9 rounded-btn border border-line bg-card px-2 text-body-sm text-ink focus:border-primary focus:outline-none'

export default function QaScorecards() {
  const { addToast } = useToast()
  const [cards, setCards] = useState<ScorecardSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [saving, setSaving] = useState(false)

  const reload = () => listScorecards().then((r) => setCards(r.scorecards)).catch(() => undefined)
  useEffect(() => { reload().finally(() => setLoading(false)) }, [])

  async function openEdit(id: string) {
    try {
      const { scorecard } = await getScorecard(id)
      setEditor({
        id: scorecard.id,
        name: scorecard.name,
        description: scorecard.description ?? '',
        departmentType: scorecard.departmentType === 'ITAD' || scorecard.departmentType === 'CSR' ? scorecard.departmentType : '',
        passThreshold: scorecard.passThreshold,
        bandGood: scorecard.bandGood,
        bandExcellent: scorecard.bandExcellent,
        categories: scorecard.categories.map((c) => ({ name: c.name, questions: c.questions.map((q) => ({ text: q.text, type: q.type, maxScore: q.maxScore, criticalFail: q.criticalFail, allowNA: q.allowNA })) })),
      })
    } catch { addToast({ type: 'error', message: 'Could not load scorecard.' }) }
  }

  async function save() {
    if (!editor || saving) return
    if (!editor.name.trim()) { addToast({ type: 'error', message: 'Name is required.' }); return }
    if (!(editor.passThreshold <= editor.bandGood && editor.bandGood <= editor.bandExcellent)) {
      addToast({ type: 'error', message: 'Thresholds must increase: Acceptable ≤ Good ≤ Excellent.' }); return
    }
    const payload: ScorecardInput = {
      name: editor.name.trim(),
      description: editor.description.trim() || undefined,
      departmentType: editor.departmentType || null,
      passThreshold: editor.passThreshold,
      bandGood: editor.bandGood,
      bandExcellent: editor.bandExcellent,
      categories: editor.categories.map((c) => ({ name: c.name.trim(), questions: c.questions.filter((q) => q.text.trim()).map((q) => ({ ...q, text: q.text.trim() })) })),
    }
    if (payload.categories.some((c) => !c.name || c.questions.length === 0)) { addToast({ type: 'error', message: 'Each section needs a name and at least one question.' }); return }
    setSaving(true)
    try {
      if (editor.id) await updateScorecard(editor.id, payload)
      else await createScorecard(payload)
      addToast({ type: 'success', message: 'Scorecard saved.' })
      setEditor(null)
      reload()
    } catch (e) {
      addToast({ type: 'error', message: e instanceof Error && e.message ? e.message : 'Could not save.' })
    } finally { setSaving(false) }
  }

  async function archive(id: string) {
    try { await archiveScorecard(id); setCards((cs) => cs.filter((c) => c.id !== id)) } catch { addToast({ type: 'error', message: 'Could not archive.' }) }
  }

  const setE = (p: Partial<Editor>) => setEditor((e) => (e ? { ...e, ...p } : e))
  const setCat = (ci: number, p: Partial<CEdit>) => setEditor((e) => e ? { ...e, categories: e.categories.map((c, i) => i === ci ? { ...c, ...p } : c) } : e)
  const setQ = (ci: number, qi: number, p: Partial<QEdit>) => setEditor((e) => e ? { ...e, categories: e.categories.map((c, i) => i === ci ? { ...c, questions: c.questions.map((q, j) => j === qi ? { ...q, ...p } : q) } : c) } : e)

  if (editor) {
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <button onClick={() => setEditor(null)} className="text-body-md font-medium text-ink-muted hover:text-ink">← Back to scorecards</button>
        <Card title={editor.id ? 'Edit scorecard' : 'New scorecard'}>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="Name" value={editor.name} onChange={(e) => setE({ name: e.target.value })} />
              <div>
                <label className="mb-1 block text-body-sm font-semibold text-ink">Applies to</label>
                <select className={sel + ' h-10 w-full'} value={editor.departmentType} onChange={(e) => setE({ departmentType: e.target.value as Editor['departmentType'] })}>
                  <option value="">Any department</option>
                  <option value="ITAD">ITAD</option>
                  <option value="CSR">CSR</option>
                </select>
              </div>
            </div>
            <TextField label="Description (optional)" value={editor.description} onChange={(e) => setE({ description: e.target.value })} />
            <div>
              <label className="mb-1 block text-body-sm font-semibold text-ink">Result bands (%)</label>
              <div className="grid grid-cols-3 gap-3">
                <TextField label="Acceptable ≥" type="number" value={editor.passThreshold} onChange={(e) => setE({ passThreshold: parseInt(e.target.value, 10) || 0 })} />
                <TextField label="Good ≥" type="number" value={editor.bandGood} onChange={(e) => setE({ bandGood: parseInt(e.target.value, 10) || 0 })} />
                <TextField label="Excellent ≥" type="number" value={editor.bandExcellent} onChange={(e) => setE({ bandExcellent: parseInt(e.target.value, 10) || 0 })} />
              </div>
              <p className="mt-1 text-body-sm text-ink-muted">Below Acceptable = “Unacceptable – work needed”. Total = points earned ÷ max possible.</p>
            </div>
          </div>
        </Card>

        {editor.categories.map((c, ci) => (
          <Card key={ci}>
            <div className="mb-3 flex items-center gap-2">
              <TextField className="flex-1" placeholder="Section name (e.g. Greeting)" value={c.name} onChange={(e) => setCat(ci, { name: e.target.value })} />
              <button onClick={() => setEditor((e) => e ? { ...e, categories: e.categories.filter((_, i) => i !== ci) } : e)} className="rounded-btn p-2 text-ink-muted hover:bg-danger/10 hover:text-danger" title="Remove section"><Trash2 size={16} /></button>
            </div>
            <div className="space-y-2">
              {c.questions.map((q, qi) => (
                <div key={qi} className="flex flex-wrap items-center gap-2 rounded-btn border border-line p-2">
                  <input className="min-w-[12rem] flex-1 rounded-btn border border-line px-2 py-1.5 text-body-sm" placeholder="Question text" value={q.text} onChange={(e) => setQ(ci, qi, { text: e.target.value })} />
                  <select className={sel} value={q.type} onChange={(e) => setQ(ci, qi, { type: e.target.value as QaQuestionType, maxScore: e.target.value === 'YES_NO' ? 1 : 10 })}>
                    <option value="RATING">Rating 1–10</option>
                    <option value="YES_NO">Yes / No</option>
                  </select>
                  <label className="flex items-center gap-1 text-body-sm text-ink-muted"><input type="checkbox" checked={q.criticalFail} onChange={(e) => setQ(ci, qi, { criticalFail: e.target.checked })} /> Critical</label>
                  <label className="flex items-center gap-1 text-body-sm text-ink-muted"><input type="checkbox" checked={q.allowNA} onChange={(e) => setQ(ci, qi, { allowNA: e.target.checked })} /> N/A</label>
                  <button onClick={() => setCat(ci, { questions: c.questions.filter((_, j) => j !== qi) })} className="rounded p-1 text-ink-muted hover:text-danger" title="Remove question"><Trash2 size={14} /></button>
                </div>
              ))}
              <Button variant="ghost" size="sm" leadingIcon={<Plus size={14} />} onClick={() => setCat(ci, { questions: [...c.questions, blankQ()] })}>Add question</Button>
            </div>
          </Card>
        ))}

        <div className="flex items-center justify-between">
          <Button variant="secondary" leadingIcon={<Plus size={16} />} onClick={() => setEditor((e) => e ? { ...e, categories: [...e.categories, blankC()] } : e)}>Add section</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save scorecard'}</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-headline-lg text-ink">QA Scorecards</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">Build the call-quality scorecards QA uses (Yes/No + 1–10, scored by points).</p>
        </div>
        <Button leadingIcon={<Plus size={16} />} onClick={() => setEditor(blankEditor())}>New scorecard</Button>
      </div>

      <Card flush>
        {loading ? <div className="p-5 text-body-md text-ink-muted">Loading…</div> : cards.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center"><ClipboardList size={26} className="text-primary" /><p className="text-body-md text-ink-muted">No scorecards yet — create your first.</p></div>
        ) : (
          <ul className="divide-y divide-line">
            {cards.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body-md font-medium text-ink">{c.name}</p>
                  <p className="truncate text-body-sm text-ink-muted">{c.departmentType ?? 'Any dept'} · {c.categoryCount} sections · {c.evaluationCount} evaluations · acceptable ≥ {c.passThreshold}%</p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => openEdit(c.id)}>Edit</Button>
                <button onClick={() => archive(c.id)} className="rounded-btn p-2 text-ink-muted hover:bg-danger/10 hover:text-danger" title="Archive"><Trash2 size={16} /></button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
