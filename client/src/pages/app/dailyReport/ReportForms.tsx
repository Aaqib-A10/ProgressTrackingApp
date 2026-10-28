import { useEffect, useState } from 'react'
import { Plus, Trash2, ArrowUp, ArrowDown, Pencil, ClipboardList } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { Toggle } from '../../../components/ui/Toggle'
import { useToast } from '../../../components/ui/Toast'
import { useAuth } from '../../../lib/auth'
import { cn } from '../../../lib/cn'
import { companyApi, type CompanyDepartment } from '../../../lib/companyApi'
import { dailyReportApi, FIELD_TYPE_LABEL, type FieldInput, type FieldType, type ReportForm } from '../../../lib/dailyReportApi'
import { errMsg, inputCls, FieldInputRow } from './MyDailyReport'

/**
 * Report Forms (Phase 1, step 5): build the daily form a department (or everyone) fills in.
 * Questions can be numbers with a daily target, text, choices, yes/no, ratings or links.
 */

const TYPES = Object.keys(FIELD_TYPE_LABEL) as FieldType[]
const blankField = (type: FieldType = 'NUMBER'): FieldInput => ({ label: '', type, options: type === 'CHOICE' || type === 'MULTI_CHOICE' ? ['', ''] : [], required: false, target: null, targetDir: 'MIN', unit: null })
const STARTER: FieldInput[] = [
  { ...blankField('NUMBER'), label: 'Tasks finished', required: true, target: 5 },
  { ...blankField('LONG_TEXT'), label: 'What did you work on?' },
  { ...blankField('LONG_TEXT'), label: 'Anything blocking you?' },
]

export default function ReportForms() {
  const { addToast } = useToast()
  const [forms, setForms] = useState<ReportForm[] | null>(null)
  const [editing, setEditing] = useState<ReportForm | 'new' | null>(null)
  const load = () => dailyReportApi.forms().then((r) => setForms(r.forms.filter((f) => f.canManage))).catch((e) => { setForms([]); addToast({ type: 'error', message: errMsg(e, 'Could not load the forms.') }) })
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (editing) return <FormEditor form={editing === 'new' ? null : editing} onDone={() => { setEditing(null); void load() }} />
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">Report Forms</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">The daily form your people fill in. Choose the questions, and give the numbers a daily target.</p>
        </div>
        <Button leadingIcon={<Plus size={16} />} onClick={() => setEditing('new')}>New form</Button>
      </div>
      {!forms ? <Card><p className="text-body-md text-ink-muted">Loading…</p></Card> : forms.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <ClipboardList className="text-ink-faint" size={28} />
            <p className="text-body-md font-semibold text-ink">No forms yet</p>
            <p className="max-w-sm text-body-sm text-ink-muted">Start with a simple one: a few numbers with targets and a question about the day. You can change it any time.</p>
            <Button size="sm" className="mt-2" onClick={() => setEditing('new')}>Make the first form</Button>
          </div>
        </Card>
      ) : (
        <Card flush>
          <ul className="divide-y divide-line">
            {forms.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-body-md font-semibold text-ink">{f.name}</p>
                    <Badge tone={f.active ? 'success' : 'neutral'}>{f.active ? 'In use' : 'Switched off'}</Badge>
                  </div>
                  <p className="mt-0.5 text-body-sm text-ink-muted">{f.department ? `For ${f.department}` : 'For everyone'} · {f.fields.length} question{f.fields.length === 1 ? '' : 's'}</p>
                </div>
                <Button size="sm" variant="secondary" leadingIcon={<Pencil size={14} />} onClick={() => setEditing(f)}>Edit</Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

function FormEditor({ form, onDone }: { form: ReportForm | null; onDone: () => void }) {
  const { addToast } = useToast()
  const { user } = useAuth()
  const [name, setName] = useState(form?.name ?? '')
  const [description, setDescription] = useState(form?.description ?? '')
  const [departmentId, setDepartmentId] = useState<string | null>(form ? form.departmentId : user?.role === 'SUPER_ADMIN' ? null : user?.activeDepartmentId ?? null)
  const [active, setActive] = useState(form?.active ?? true)
  const [fields, setFields] = useState<FieldInput[]>(form ? form.fields.map((f) => ({ id: f.id, label: f.label, help: f.help, type: f.type, options: f.options, required: f.required, target: f.target, targetDir: f.targetDir, unit: f.unit })) : STARTER)
  const [depts, setDepts] = useState<CompanyDepartment[]>([])
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState(false)
  useEffect(() => { companyApi.departments().then((r) => setDepts(r.departments)).catch(() => undefined) }, [])
  const isAdmin = user?.role === 'SUPER_ADMIN' || !!user?.permissions?.includes('company.settings')

  const set = (i: number, p: Partial<FieldInput>) => setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...p } : f)))
  const move = (i: number, d: -1 | 1) => setFields((fs) => { const n = [...fs]; const t = n[i + d]; if (!t) return fs; n[i + d] = n[i]; n[i] = t; return n })
  async function save() {
    setSaving(true)
    try {
      const input = { name: name.trim(), description: description.trim() || null, departmentId, active, fields: fields.map((f) => ({ ...f, options: f.options.map((o) => o.trim()).filter(Boolean) })) }
      if (form) await dailyReportApi.update(form.id, input)
      else await dailyReportApi.create(input)
      addToast({ type: 'success', message: form ? 'Form saved.' : 'Form made. Your people see it in My Daily Report now.' })
      onDone()
    } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not save the form.') }) } finally { setSaving(false) }
  }
  async function remove() {
    if (!form) return
    setSaving(true)
    try { await dailyReportApi.remove(form.id); addToast({ type: 'success', message: 'Form removed.' }); onDone() }
    catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not remove the form.') }) } finally { setSaving(false) }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <button type="button" onClick={onDone} className="text-body-sm text-ink-muted hover:text-ink">← Report Forms</button>
          <h1 className="text-headline-lg text-ink">{form ? `Edit ${form.name}` : 'New daily form'}</h1>
        </div>
        <Button variant="secondary" onClick={() => setPreview((p) => !p)}>{preview ? 'Back to editing' : 'Preview'}</Button>
      </div>

      {preview ? (
        <Card title={name || 'Untitled form'} subtitle={description || undefined}>
          <div className="space-y-5">{fields.map((f, i) => <FieldInputRow key={i} field={{ id: String(i), label: f.label || 'Untitled question', help: f.help ?? null, type: f.type, options: f.options.filter(Boolean), required: f.required, target: f.target ?? null, targetDir: f.targetDir, unit: f.unit ?? null }} value={undefined} onChange={() => undefined} />)}</div>
        </Card>
      ) : (
        <>
          <Card title="The form">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block sm:col-span-2"><span className="mb-1 block text-body-sm font-semibold text-ink">Name</span><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sales daily" maxLength={80} /></label>
              <label className="block sm:col-span-2"><span className="mb-1 block text-body-sm font-semibold text-ink">A line for your people (optional)</span><input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Send it before you check out" maxLength={500} /></label>
              <label className="block"><span className="mb-1 block text-body-sm font-semibold text-ink">Who fills it in</span>
                <select className={inputCls} value={departmentId ?? ''} onChange={(e) => setDepartmentId(e.target.value || null)}>
                  {isAdmin && <option value="">Everyone</option>}
                  {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
              <div className="flex items-end justify-between gap-3 rounded-btn border border-line px-3 py-2">
                <span className="text-body-md text-ink">{active ? 'In use' : 'Switched off (nobody fills it in)'}</span>
                <Toggle checked={active} onChange={setActive} label="Form in use" />
              </div>
            </div>
          </Card>

          <Card title="Questions" subtitle="People answer them in this order.">
            <div className="space-y-3">
              {fields.map((f, i) => (
                <div key={f.id ?? `new-${i}`} className="rounded-btn border border-line p-3.5">
                  <div className="flex flex-wrap items-start gap-2">
                    <input className={inputCls + ' min-w-[200px] flex-1'} value={f.label} onChange={(e) => set(i, { label: e.target.value })} placeholder="The question" maxLength={120} aria-label="Question" />
                    <select className={inputCls + ' !w-auto'} value={f.type} disabled={!!f.id} title={f.id ? 'The kind of answer cannot change once the form is in use' : undefined}
                      onChange={(e) => { const t = e.target.value as FieldType; set(i, { type: t, options: t === 'CHOICE' || t === 'MULTI_CHOICE' ? (f.options.length >= 2 ? f.options : ['', '']) : [] }) }} aria-label="Kind of answer">
                      {TYPES.map((t) => <option key={t} value={t}>{FIELD_TYPE_LABEL[t]}</option>)}
                    </select>
                    <div className="flex items-center">
                      <Button size="sm" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"><ArrowUp size={15} /></Button>
                      <Button size="sm" variant="ghost" onClick={() => move(i, 1)} disabled={i === fields.length - 1} aria-label="Move down"><ArrowDown size={15} /></Button>
                      <Button size="sm" variant="ghost" onClick={() => setFields((fs) => fs.filter((_, j) => j !== i))} disabled={fields.length === 1} aria-label="Remove question"><Trash2 size={15} /></Button>
                    </div>
                  </div>
                  {(f.type === 'CHOICE' || f.type === 'MULTI_CHOICE') && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      {f.options.map((o, k) => (
                        <span key={k} className="inline-flex items-center gap-1 rounded-full border border-line bg-slate-50 pl-2.5 pr-1">
                          <input className="w-28 bg-transparent py-1 text-body-sm text-ink focus:outline-none" value={o} placeholder={`Choice ${k + 1}`} maxLength={80} onChange={(e) => set(i, { options: f.options.map((x, m) => (m === k ? e.target.value : x)) })} aria-label={`Choice ${k + 1}`} />
                          <button type="button" className="rounded-full p-1 text-ink-muted hover:text-danger" onClick={() => set(i, { options: f.options.filter((_, m) => m !== k) })} aria-label="Remove choice"><Trash2 size={12} /></button>
                        </span>
                      ))}
                      <button type="button" className="rounded-full border border-dashed border-line px-2.5 py-1 text-body-sm text-ink-muted hover:text-ink" onClick={() => set(i, { options: [...f.options, ''] })}>+ Choice</button>
                    </div>
                  )}
                  <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-2">
                    <label className="inline-flex items-center gap-2 text-body-sm text-ink"><input type="checkbox" className="h-4 w-4 accent-primary" checked={f.required} onChange={(e) => set(i, { required: e.target.checked })} />Must be answered</label>
                    {f.type === 'NUMBER' && (
                      <>
                        <label className="inline-flex items-center gap-2 text-body-sm text-ink">Daily target
                          <input type="number" min={0} className={cn(inputCls, '!h-8 !w-24 tabular-nums')} value={f.target ?? ''} onChange={(e) => set(i, { target: e.target.value === '' ? null : Number(e.target.value) })} aria-label="Daily target" />
                        </label>
                        <select className={cn(inputCls, '!h-8 !w-auto')} value={f.targetDir} onChange={(e) => set(i, { targetDir: e.target.value as 'MIN' | 'MAX' })} aria-label="Target direction">
                          <option value="MIN">or more is good</option>
                          <option value="MAX">or less is good</option>
                        </select>
                        <input className={cn(inputCls, '!h-8 !w-24')} value={f.unit ?? ''} placeholder="unit" maxLength={20} onChange={(e) => set(i, { unit: e.target.value || null })} aria-label="Unit" />
                      </>
                    )}
                  </div>
                </div>
              ))}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {TYPES.map((t) => <button key={t} type="button" onClick={() => setFields((fs) => [...fs, blankField(t)])} className="rounded-full border border-dashed border-line px-3 py-1.5 text-body-sm text-ink-muted hover:border-primary/50 hover:text-ink">+ {FIELD_TYPE_LABEL[t]}</button>)}
              </div>
            </div>
          </Card>
        </>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={saving || name.trim().length < 2 || fields.some((f) => !f.label.trim())}>{saving ? 'Saving…' : form ? 'Save form' : 'Make form'}</Button>
        <Button variant="secondary" onClick={onDone}>Cancel</Button>
        {form && <Button variant="ghost" className="ml-auto text-danger" onClick={remove} disabled={saving}>Remove form</Button>}
      </div>
    </div>
  )
}
