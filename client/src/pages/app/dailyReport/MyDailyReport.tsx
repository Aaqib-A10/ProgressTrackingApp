import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, CheckCircle2, ClipboardList, Star } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { useToast } from '../../../components/ui/Toast'
import { cn } from '../../../lib/cn'
import { dailyReportApi, type MyEntry, type ReportField, type ReportForm, type Values, type Answer } from '../../../lib/dailyReportApi'

/**
 * My Daily Report (Phase 1, step 5): the company's own daily form. One report a day (sending
 * again updates it); the last seven days can still be sent or changed.
 */

export function errMsg(e: unknown, fallback: string): string {
  const m = (e as { message?: string })?.message
  if (!m) return fallback
  try { return (JSON.parse(m) as { error?: string }).error || fallback } catch { return m }
}
export const inputCls = 'h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink placeholder:text-ink-muted focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'
const fmtDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
function lastDays(today: string, n: number): string[] {
  const out: string[] = []
  const d = new Date(`${today}T12:00:00`)
  for (let i = 0; i < n; i++) { out.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() - 1) }
  return out
}

export default function MyDailyReport() {
  const { addToast } = useToast()
  const [forms, setForms] = useState<ReportForm[] | null>(null)
  const [canCreate, setCanCreate] = useState(false)
  const [formId, setFormId] = useState<string | null>(null)
  useEffect(() => {
    dailyReportApi.forms().then((r) => {
      const mine = r.forms.filter((f) => f.fills)
      setForms(mine); setCanCreate(r.canCreate); setFormId((id) => id ?? mine[0]?.id ?? null)
    }).catch((e) => { setForms([]); addToast({ type: 'error', message: errMsg(e, 'Could not load your daily report.') }) })
  }, [addToast])

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-headline-lg text-ink">My Daily Report</h1>
        <p className="mt-0.5 text-body-md text-ink-muted">Fill it in once a day. You can send it again to change it, and catch up on the last seven days.</p>
      </div>
      {!forms ? <Card><p className="text-body-md text-ink-muted">Loading…</p></Card> : forms.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <ClipboardList className="text-ink-faint" size={28} />
            <p className="text-body-md font-semibold text-ink">No daily form for you yet</p>
            <p className="max-w-sm text-body-sm text-ink-muted">{canCreate ? 'Make one for your team: choose the questions, and set daily targets for the numbers.' : 'Your team lead makes it. It shows up here as soon as they do.'}</p>
            {canCreate && <Link to="/app/daily-report/forms"><Button size="sm" className="mt-2">Make a daily form</Button></Link>}
          </div>
        </Card>
      ) : (
        <>
          {forms.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {forms.map((f) => (
                <button key={f.id} type="button" onClick={() => setFormId(f.id)} className={cn('rounded-full px-3.5 py-1.5 text-body-sm font-medium', formId === f.id ? 'bg-ink text-card' : 'bg-slate-100 text-ink-muted hover:bg-slate-200')}>{f.name}</button>
              ))}
            </div>
          )}
          {formId && <ReportFiller key={formId} formId={formId} />}
        </>
      )}
    </div>
  )
}

function ReportFiller({ formId }: { formId: string }) {
  const { addToast } = useToast()
  const [data, setData] = useState<MyEntry | null>(null)
  const [date, setDate] = useState<string | undefined>(undefined)
  const [values, setValues] = useState<Values>({})
  const [saving, setSaving] = useState(false)
  const load = useCallback((d?: string) => {
    dailyReportApi.entry(formId, d).then((r) => { setData(r); setDate(r.date); setValues(r.entry?.values ?? {}) }).catch((e) => addToast({ type: 'error', message: errMsg(e, 'Could not load the report.') }))
  }, [formId, addToast])
  useEffect(() => { load() }, [load])
  if (!data) return <Card><p className="text-body-md text-ink-muted">Loading…</p></Card>
  const f = data.form
  const sentDays = new Set(data.recent.map((r) => r.date))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const r = await dailyReportApi.save(formId, data!.date, values)
      setData({ ...data!, entry: r.entry, recent: sentDays.has(data!.date) ? data!.recent : [{ date: data!.date, updatedAt: new Date().toISOString() }, ...data!.recent] })
      addToast({ type: 'success', message: data!.entry ? 'Report updated.' : 'Report sent.' })
    } catch (err) { addToast({ type: 'error', message: errMsg(err, 'Could not send the report.') }) } finally { setSaving(false) }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <CalendarDays size={16} className="mr-1 text-ink-muted" />
        {lastDays(data.today, 7).map((d) => (
          <button key={d} type="button" onClick={() => load(d)} className={cn('inline-flex items-center gap-1.5 rounded-btn border px-2.5 py-1.5 text-body-sm', d === date ? 'border-primary bg-primary/10 text-primary' : 'border-line text-ink-muted hover:text-ink')}>
            {d === data.today ? 'Today' : fmtDay(d)}
            {sentDays.has(d) && <CheckCircle2 size={13} className="text-success" />}
          </button>
        ))}
      </div>
      <Card title={f.name} subtitle={f.description ?? (f.department ? `For ${f.department}` : 'For everyone')}
        action={data.entry ? <Badge tone="success">Sent {new Date(data.entry.updatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</Badge> : <Badge tone="warning">Not sent</Badge>}>
        {(data.onLeave || data.holiday) && <p className="mb-4 rounded-btn bg-slate-50 px-3 py-2 text-body-sm text-ink-muted">{data.holiday ? `${data.holiday}: a holiday.` : 'You are on leave this day.'} No report is needed, but you can still send one.</p>}
        <form onSubmit={submit} className="space-y-5">
          {f.fields.map((field) => <FieldInputRow key={field.id} field={field} value={values[field.id]} disabled={!data.editable} onChange={(v) => setValues((s) => ({ ...s, [field.id]: v as Answer }))} />)}
          {data.editable ? <Button type="submit" disabled={saving}>{saving ? 'Sending…' : data.entry ? 'Send again' : 'Send report'}</Button> : <p className="text-body-sm text-ink-muted">This day can no longer be changed.</p>}
        </form>
      </Card>
    </>
  )
}

export function FieldInputRow({ field, value, onChange, disabled }: { field: ReportField; value: Answer | undefined; onChange: (v: Answer | undefined) => void; disabled?: boolean }) {
  const label = (
    <span className="mb-1.5 block">
      <span className="text-body-md font-semibold text-ink">{field.label}{field.required && <span className="text-danger"> *</span>}</span>
      {field.type === 'NUMBER' && field.target != null && <span className="ml-2 text-body-sm text-ink-muted">Target {field.targetDir === 'MAX' ? 'at most' : ''} {field.target}{field.unit ? ` ${field.unit}` : ''} a day</span>}
      {field.help && <span className="block text-body-sm text-ink-muted">{field.help}</span>}
    </span>
  )
  switch (field.type) {
    case 'NUMBER':
      return <label className="block">{label}<div className="flex items-center gap-2"><input type="number" inputMode="decimal" className={inputCls + ' max-w-[200px] tabular-nums'} value={value === undefined ? '' : String(value)} disabled={disabled} required={field.required} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />{field.unit && <span className="text-body-sm text-ink-muted">{field.unit}</span>}</div></label>
    case 'TEXT':
      return <label className="block">{label}<input className={inputCls} maxLength={500} value={typeof value === 'string' ? value : ''} disabled={disabled} required={field.required} onChange={(e) => onChange(e.target.value)} /></label>
    case 'LONG_TEXT':
      return <label className="block">{label}<textarea className={inputCls + ' !h-28 py-2'} maxLength={5000} value={typeof value === 'string' ? value : ''} disabled={disabled} required={field.required} onChange={(e) => onChange(e.target.value)} /></label>
    case 'LINK':
      return <label className="block">{label}<input type="url" className={inputCls} placeholder="https://" value={typeof value === 'string' ? value : ''} disabled={disabled} required={field.required} onChange={(e) => onChange(e.target.value)} /></label>
    case 'CHOICE':
      return (
        <fieldset>{label}<div className="flex flex-wrap gap-1.5">
          {field.options.map((o) => <button key={o} type="button" disabled={disabled} onClick={() => onChange(value === o ? undefined : o)} className={cn('rounded-full border px-3 py-1.5 text-body-sm', value === o ? 'border-primary bg-primary/10 text-primary' : 'border-line text-ink-muted hover:text-ink')}>{o}</button>)}
        </div></fieldset>
      )
    case 'MULTI_CHOICE': {
      const list = Array.isArray(value) ? value : []
      return (
        <fieldset>{label}<div className="flex flex-wrap gap-1.5">
          {field.options.map((o) => { const on = list.includes(o); return <button key={o} type="button" disabled={disabled} onClick={() => onChange(on ? list.filter((x) => x !== o) : [...list, o])} className={cn('rounded-full border px-3 py-1.5 text-body-sm', on ? 'border-primary bg-primary/10 text-primary' : 'border-line text-ink-muted hover:text-ink')}>{o}</button> })}
        </div></fieldset>
      )
    }
    case 'YES_NO':
      return (
        <fieldset>{label}<div className="flex gap-1.5">
          {[[true, 'Yes'], [false, 'No']].map(([v, l]) => <button key={String(v)} type="button" disabled={disabled} onClick={() => onChange(value === v ? undefined : (v as boolean))} className={cn('rounded-btn border px-4 py-1.5 text-body-sm font-medium', value === v ? 'border-primary bg-primary/10 text-primary' : 'border-line text-ink-muted hover:text-ink')}>{l as string}</button>)}
        </div></fieldset>
      )
    case 'RATING':
      return (
        <fieldset>{label}<div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" disabled={disabled} aria-label={`${n} of 5`} onClick={() => onChange(value === n ? undefined : n)} className="p-0.5"><Star size={24} className={typeof value === 'number' && n <= value ? 'fill-warning text-warning' : 'text-ink-faint'} /></button>)}
        </div></fieldset>
      )
  }
}
