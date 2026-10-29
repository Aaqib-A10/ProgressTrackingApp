import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Building2, Layers, ClipboardList, UserPlus, Sparkles, Upload, X } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Toggle } from '../../components/ui/Toggle'
import { useToast } from '../../components/ui/Toast'
import { useAuth } from '../../lib/auth'
import { api } from '../../lib/api'
import { cn } from '../../lib/cn'
import { companyApi } from '../../lib/companyApi'
import { parsePeople } from '../../lib/parsePeople'
import { KIND_INFO, kindFromName } from '../../lib/sections'
import type { Department } from '../../lib/types'

/**
 * The setup wizard (Phase 1, step 7): a new company is ready in about five minutes. A person on
 * their own ("Just me") gets the short version: time zone, a daily report, sample data.
 */

interface SetupStatus {
  company: { id: string; name: string; kind: 'TEAM' | 'PERSONAL'; timeZone: string; slug: string; trialEndsAt: string | null; setupDoneAt: string | null }
  emailCheckPending: boolean
  departments: { id: string; name: string; type: string }[]
  hasDailyForm: boolean
  people: number
  hasSample: boolean
  templates: { key: string; name: string; description: string; questions: string[] }[]
}

function errMsg(e: unknown, fallback: string): string {
  const m = (e as { message?: string })?.message
  if (!m) return fallback
  try { return (JSON.parse(m) as { error?: string }).error || fallback } catch { return m }
}
const inputCls = 'h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink placeholder:text-ink-muted focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'
const SUGGESTED = ['Sales', 'Customer support', 'Operations', 'Marketing', 'Finance', 'Engineering', 'HR']

export default function Setup() {
  const { addToast } = useToast()
  const { user, refresh } = useAuth()
  const navigate = useNavigate()
  const [s, setS] = useState<SetupStatus | null>(null)
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const solo = s?.company.kind === 'PERSONAL'

  const load = () => api.get<SetupStatus>('/setup').then(setS).catch((e) => addToast({ type: 'error', message: errMsg(e, 'Could not load the setup.') }))
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const steps = useMemo(() => solo
    ? [{ key: 'company', label: 'You', icon: Building2 }, { key: 'report', label: 'Daily report', icon: ClipboardList }, { key: 'sample', label: 'Sample data', icon: Sparkles }]
    : [{ key: 'company', label: 'Company', icon: Building2 }, { key: 'departments', label: 'Departments', icon: Layers }, { key: 'report', label: 'Daily report', icon: ClipboardList }, { key: 'people', label: 'People', icon: UserPlus }, { key: 'sample', label: 'Sample data', icon: Sparkles }], [solo])

  async function finish() {
    setBusy(true)
    try { await api.post('/setup/done'); await refresh?.(); navigate('/app/dashboard', { replace: true }) }
    catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not finish.') }); setBusy(false) }
  }
  if (!s) return <div className="mx-auto w-full max-w-[1800px]"><Card><p className="text-body-md text-ink-muted">Loading…</p></Card></div>
  const current = steps[step]
  const next = () => (step < steps.length - 1 ? setStep(step + 1) : finish())

  return (
    <div className="mx-auto w-full max-w-[1800px] space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">{solo ? `Welcome, ${user?.name.split(' ')[0] ?? ''}` : `Set up ${s.company.name}`}</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">A few minutes, and everything can be changed later.</p>
        </div>
        <button type="button" onClick={finish} disabled={busy} className="text-body-sm font-medium text-ink-muted hover:text-ink">Skip for now</button>
      </div>
      <ol className="flex flex-wrap gap-2">
        {steps.map((st, i) => (
          <li key={st.key}>
            <button type="button" onClick={() => setStep(i)} className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-body-sm font-medium', i === step ? 'border-primary bg-primary/10 text-primary' : i < step ? 'border-success/40 text-success' : 'border-line text-ink-muted')}>
              {i < step ? <Check size={14} /> : <st.icon size={14} />}{st.label}
            </button>
          </li>
        ))}
      </ol>
      {current.key === 'company' && <CompanyStep s={s} solo={solo} onNext={next} />}
      {current.key === 'departments' && <DepartmentsStep s={s} onDone={(departments) => { setS({ ...s, departments }); next() }} />}
      {current.key === 'report' && <ReportStep s={s} solo={solo} onDone={() => { setS({ ...s, hasDailyForm: true }); next() }} onSkip={next} />}
      {current.key === 'people' && <PeopleStep s={s} onNext={next} />}
      {current.key === 'sample' && <SampleStep s={s} onChange={(hasSample) => setS({ ...s, hasSample })} onFinish={finish} busy={busy} />}
    </div>
  )
}

function CompanyStep({ s, solo, onNext }: { s: SetupStatus; solo: boolean; onNext: () => void }) {
  const { addToast } = useToast()
  const [name, setName] = useState(s.company.name)
  const [tz, setTz] = useState(s.company.timeZone)
  const zones = useMemo(() => { try { return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone') } catch { return [s.company.timeZone] } }, [s.company.timeZone])
  async function save() {
    try { await companyApi.update({ name: name.trim(), timeZone: tz }); onNext() } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not save.') }) }
  }
  return (
    <Card title={solo ? 'Your workspace' : 'Your company'} subtitle={`Your Metriq address: ${window.location.origin}/c/${s.company.slug}`}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block"><span className="mb-1 block text-body-sm font-semibold text-ink">{solo ? 'Workspace name' : 'Company name'}</span><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></label>
        <label className="block"><span className="mb-1 block text-body-sm font-semibold text-ink">Time zone</span>
          <select className={inputCls} value={tz} onChange={(e) => setTz(e.target.value)}>{zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}</select>
        </label>
      </div>
      <div className="mt-5"><Button onClick={save} disabled={name.trim().length < 2}>Next</Button></div>
    </Card>
  )
}

function DepartmentsStep({ s, onDone }: { s: SetupStatus; onDone: (d: SetupStatus['departments']) => void }) {
  const { addToast } = useToast()
  type Pick = { name: string; type: Department; made?: boolean }
  // Departments already made start with their kind; new ones get a guess from the name. Until the setup is
  // finished every one can be taken off the list or given another kind (the server keeps a department
  // that already has people in it, and says so).
  const [picked, setPicked] = useState<Pick[]>(s.departments.length
    ? s.departments.map((d) => ({ name: d.name, type: d.type as Department, made: true }))
    : [{ name: 'Sales', type: 'GENERAL' }, { name: 'Operations', type: 'GENERAL' }])
  const [own, setOwn] = useState('')
  const has = (n: string) => picked.some((p) => p.name.toLowerCase() === n.toLowerCase())
  const usedBy = (t: Department, except: string) => t !== 'GENERAL' && picked.some((p) => p.type === t && p.name !== except)
  const guess = (n: string): Department => { const g = kindFromName(n); return usedBy(g, n) ? 'GENERAL' : g }
  const flip = (n: string) => setPicked((p) => (has(n) ? p.filter((x) => x.name.toLowerCase() !== n.toLowerCase()) : [...p, { name: n, type: s.departments.find((d) => d.name.toLowerCase() === n.toLowerCase())?.type as Department ?? guess(n), made: s.departments.some((d) => d.name.toLowerCase() === n.toLowerCase()) }]))
  const setType = (n: string, t: Department) => setPicked((p) => p.map((x) => (x.name === n ? { ...x, type: t } : x)))
  async function save() {
    try {
      const r = await api.post<{ departments: SetupStatus['departments']; kept?: { name: string; reason: string }[] }>('/setup/departments', { departments: picked.map(({ name, type }) => ({ name, type })) })
      if (r.kept?.length) addToast({ type: 'info', message: `Kept ${r.kept.map((k) => `${k.name} (${k.reason})`).join(', ')}. Move them in Company Settings, Departments.` })
      onDone(r.departments)
    }
    catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not add the departments.') }) }
  }
  const kinds = (Object.keys(KIND_INFO) as Department[]).filter((k) => k !== 'TALKLOOP')
  return (
    <Card title="Departments" subtitle="Groups of people with a team lead. Pick some, or type your own, then say what kind of work each one does.">
      <div className="flex flex-wrap gap-2">
        {[...new Set([...SUGGESTED, ...picked.map((p) => p.name)])].map((n) => {
          const on = has(n)
          return (
            <button key={n} type="button" onClick={() => flip(n)} aria-pressed={on} className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-body-sm', on ? 'border-primary bg-primary/10 text-primary' : 'border-line text-ink-muted hover:text-ink')}>
              {on && <Check size={13} />}{n}
            </button>
          )
        })}
      </div>
      <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); const n = own.trim(); if (n.length >= 2 && !has(n)) setPicked((p) => [...p, { name: n, type: guess(n) }]); setOwn('') }}>
        <input className={inputCls + ' max-w-xs'} value={own} onChange={(e) => setOwn(e.target.value)} placeholder="Another department, e.g. Lead generation" maxLength={60} />
        <Button type="submit" variant="secondary">Add</Button>
      </form>

      {picked.length > 0 && (
        <div className="mt-5">
          <p className="mb-2 text-body-sm font-semibold text-ink">What each one does</p>
          <ul className="divide-y divide-line rounded-card border border-line">
            {picked.map((p) => (
              <li key={p.name} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <span className="min-w-[140px] flex-1 text-body-md font-medium text-ink">{p.name}</span>
                <select className={inputCls + ' !h-9 max-w-[220px]'} value={p.type} onChange={(e) => setType(p.name, e.target.value as Department)} aria-label={`Kind of work for ${p.name}`}>
                  {kinds.map((k) => <option key={k} value={k} disabled={usedBy(k, p.name)}>{KIND_INFO[k].label}{usedBy(k, p.name) ? ' (taken)' : ''}</option>)}
                </select>
                <span className="w-full text-body-sm text-ink-muted sm:w-auto sm:flex-[2]">{KIND_INFO[p.type].description}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-body-sm text-ink-muted">General is right for most teams. Sales calling, Lead Generation, Marketing, E-commerce and Inventory come with screens of their own (one of each); choose which screens each team uses later in Company Settings, Departments.</p>
        </div>
      )}
      <div className="mt-5"><Button onClick={save} disabled={!picked.length}>Next</Button></div>
    </Card>
  )
}

function ReportStep({ s, solo, onDone, onSkip }: { s: SetupStatus; solo: boolean; onDone: () => void; onSkip: () => void }) {
  const { addToast } = useToast()
  const list = s.templates.filter((t) => (solo ? t.key === 'solo' || t.key === 'general' : t.key !== 'solo'))
  const [template, setTemplate] = useState(list[0]?.key ?? 'general')
  const [dept, setDept] = useState<string>('')
  async function save() {
    try { await api.post('/setup/daily-form', { template, departmentId: dept || null }); onDone() } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not make the form.') }) }
  }
  if (s.hasDailyForm) return <Card title="Daily report"><p className="text-body-md text-ink-muted">You have a daily form already. Change it any time in Report Forms.</p><div className="mt-4"><Button onClick={onSkip}>Next</Button></div></Card>
  return (
    <Card title="Daily report" subtitle={solo ? 'A few questions to answer at the end of each day.' : 'What your people fill in each day. Numbers can have a daily target.'}>
      <div className="grid gap-3 sm:grid-cols-2">
        {list.map((t) => (
          <button key={t.key} type="button" onClick={() => setTemplate(t.key)} className={cn('rounded-card border p-3.5 text-left', template === t.key ? 'border-primary bg-primary/5 ring-2 ring-primary/15' : 'border-line hover:border-primary/40')}>
            <span className="block text-body-md font-semibold text-ink">{t.name}</span>
            <span className="block text-body-sm text-ink-muted">{t.description}</span>
            <ul className="mt-2 space-y-0.5">{t.questions.map((q) => <li key={q} className="text-body-sm text-ink">· {q}</li>)}</ul>
          </button>
        ))}
      </div>
      {!solo && s.departments.length > 0 && (
        <label className="mt-4 block max-w-xs"><span className="mb-1 block text-body-sm font-semibold text-ink">Who fills it in</span>
          <select className={inputCls} value={dept} onChange={(e) => setDept(e.target.value)}><option value="">Everyone</option>{s.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        </label>
      )}
      <div className="mt-5 flex gap-2"><Button onClick={save}>Use this</Button><Button variant="ghost" onClick={onSkip}>Skip</Button></div>
    </Card>
  )
}

function PeopleStep({ s, onNext }: { s: SetupStatus; onNext: () => void }) {
  const { addToast } = useToast()
  const { refresh } = useAuth()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<{ added: { email: string }[]; skipped: string[] } | null>(null)
  const people = parsePeople(text)
  async function send() {
    setBusy(true)
    try {
      const byName = new Map(s.departments.map((d) => [d.name.toLowerCase(), d.id]))
      const r = await api.post<{ added: { email: string }[]; skipped: string[] }>('/company/invites', { people: people.map((p) => ({ name: p.name, email: p.email, role: p.role, departmentId: p.department ? byName.get(p.department.toLowerCase()) ?? null : null })) })
      setSent(r); setText('')
      addToast({ type: 'success', message: `${r.added.length} invited. They get an email to set their password.` })
    } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not send the invites.') }) } finally { setBusy(false) }
  }
  async function readCsv(f: File | undefined) {
    if (!f) return
    const csv = await f.text()
    setText((t) => (t ? `${t}\n` : '') + csv)
  }
  return (
    <Card title="Invite your people" subtitle="One per line: an email, or name, email, department, role. Or upload a CSV with those columns.">
      {s.emailCheckPending && (
        <div className="mb-4 rounded-btn border border-warning/30 bg-warning/10 px-3 py-2 text-body-sm text-ink">
          Confirm your email first: we sent you a link. <button type="button" className="font-semibold text-primary hover:underline" onClick={async () => { try { await api.post('/auth/verify-email/resend'); addToast({ type: 'success', message: 'Sent again.' }) } catch { /* shown by the toast system */ } }}>Send it again</button>
          <button type="button" className="ml-2 font-semibold text-primary hover:underline" onClick={() => refresh?.()}>I have confirmed</button>
        </div>
      )}
      <textarea className={inputCls + ' !h-36 py-2 font-mono text-body-sm'} value={text} onChange={(e) => setText(e.target.value)} placeholder={'amy@company.com\nLee Park, lee@company.com, Sales, Team Lead'} />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label className="inline-flex cursor-pointer items-center gap-2 text-body-sm font-medium text-primary hover:underline"><Upload size={14} />Upload a CSV<input type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={(e) => void readCsv(e.target.files?.[0])} /></label>
        <span className="text-body-sm text-ink-muted">{people.length ? `${people.length} ${people.length === 1 ? 'person' : 'people'} found` : 'No emails yet'}</span>
      </div>
      {people.length > 0 && (
        <ul className="mt-3 max-h-48 divide-y divide-line overflow-y-auto rounded-btn border border-line">
          {people.map((p) => <li key={p.email} className="flex flex-wrap gap-x-3 px-3 py-1.5 text-body-sm"><span className="font-medium text-ink">{p.name || p.email}</span><span className="text-ink-muted">{p.email}</span>{p.department && <span className="text-ink-muted">· {p.department}</span>}{p.role === 'TEAM_LEAD' && <span className="text-primary">· Team Lead</span>}</li>)}
        </ul>
      )}
      {sent && sent.skipped.length > 0 && <p className="mt-3 flex items-center gap-1.5 text-body-sm text-ink-muted"><X size={14} />Already on Metriq, not invited: {sent.skipped.join(', ')}</p>}
      <div className="mt-5 flex gap-2">
        <Button onClick={send} disabled={busy || !people.length || s.emailCheckPending}>{busy ? 'Sending…' : `Invite ${people.length || ''}`.trim()}</Button>
        <Button variant={sent ? 'primary' : 'ghost'} onClick={onNext}>{sent ? 'Next' : 'Later'}</Button>
      </div>
    </Card>
  )
}

function SampleStep({ s, onChange, onFinish, busy }: { s: SetupStatus; onChange: (on: boolean) => void; onFinish: () => void; busy: boolean }) {
  const { addToast } = useToast()
  const [working, setWorking] = useState(false)
  async function set(on: boolean) {
    setWorking(true)
    try { await api.post('/setup/sample', { on }); onChange(on) } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not change the sample data.') }) } finally { setWorking(false) }
  }
  return (
    <Card title="Sample data" subtitle="A sample project with tasks, a week of daily reports and a few to-dos, so the screens are not empty while you look around. Take it out any time.">
      <div className="flex items-center justify-between gap-3 rounded-btn border border-line px-4 py-3">
        <span className="text-body-md text-ink">{s.hasSample ? 'Sample data is in' : 'Add sample data'}</span>
        <Toggle checked={s.hasSample} disabled={working} onChange={(v) => void set(v)} label="Sample data" />
      </div>
      <div className="mt-5"><Button onClick={onFinish} disabled={busy}>{busy ? 'Opening…' : 'Open my Metriq'}</Button></div>
    </Card>
  )
}
