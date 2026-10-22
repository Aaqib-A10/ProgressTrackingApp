import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'
import {
  Activity, AlertTriangle, Bot, Bug, CheckCircle2, ChevronRight, Clock, Copy, Globe, Loader2, Monitor, Play, RotateCcw,
  Search, Server, ShieldCheck, Ticket, Timer, Users, X, XCircle, CircleSlash, CircleDashed,
} from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { Toggle } from '../../../components/ui/Toggle'
import { EmptyState } from '../../../components/ui/EmptyState'
import { useToast } from '../../../components/ui/Toast'
import { fieldCls, fmtAgo, fmtDateTime } from '../../../components/projects/pmUi'
import { healthApi, type AuditRunView, type CheckResult, type CheckView, type ErrorDetail, type ErrorRow, type ErrorSource, type ErrorState, type HealthSummary } from '../../../lib/healthApi'
import { projectsApi } from '../../../lib/projectsApi'
import { copyText } from '../../../lib/workLogApi'
import { cn } from '../../../lib/cn'

/**
 * System Health (Super Admins and developers): the error log, the hourly self check, background
 * jobs and the server. Links: ?tab=errors|checks|server|developers, ?error=<id>, ?run=<id>.
 */

type Tab = 'errors' | 'checks' | 'server' | 'developers'

const errMsg = (e: unknown, fallback = 'Something went wrong') => {
  const m = (e as { message?: string })?.message
  if (!m) return fallback
  try { return (JSON.parse(m) as { error?: string }).error || fallback } catch { return m }
}
const bytes = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.round(n / 1024 ** 2)} MB`)
const duration = (sec: number) => (sec < 3600 ? `${Math.max(1, Math.round(sec / 60))} min` : sec < 172800 ? `${Math.round(sec / 3600)} h` : `${Math.round(sec / 86400)} days`)
const every = (ms: number | null) => (ms === null ? 'Monthly' : ms < 3600_000 ? `Every ${Math.round(ms / 60_000)} min` : ms < 86400_000 ? 'Hourly' : 'Daily')
const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

const SOURCE_META: Record<ErrorSource, { label: string; icon: React.ReactNode; cls: string }> = {
  SERVER: { label: 'Server', icon: <Server size={13} />, cls: 'text-danger bg-danger/10' },
  BROWSER: { label: 'Browser', icon: <Monitor size={13} />, cls: 'text-primary bg-primary/10' },
  JOB: { label: 'Job', icon: <Clock size={13} />, cls: 'text-warning bg-warning/[0.12]' },
  SLOW: { label: 'Slow', icon: <Timer size={13} />, cls: 'text-ink-muted bg-slate-100' },
}

const CATEGORY_LABEL: Record<string, string> = {
  'api-read': 'APIs that read', 'api-write': 'APIs that save (test mode)', database: 'Database', server: 'Server',
  services: 'Outside services', jobs: 'Background jobs', data: 'Data', website: 'Website',
}
const CATEGORY_ORDER = ['website', 'database', 'server', 'services', 'jobs', 'data', 'api-read', 'api-write']

function ResultIcon({ r, size = 15 }: { r: CheckResult; size?: number }) {
  if (r === 'PASS') return <CheckCircle2 size={size} className="shrink-0 text-success" aria-label="Passed" />
  if (r === 'WARN') return <AlertTriangle size={size} className="shrink-0 text-warning" aria-label="Warning" />
  if (r === 'FAIL') return <XCircle size={size} className="shrink-0 text-danger" aria-label="Failed" />
  return <CircleSlash size={size} className="shrink-0 text-ink-faint" aria-label="Skipped" />
}

function Segmented<T extends string>({ value, options, onChange, size = 'md' }: { value: T; options: { value: T; label: React.ReactNode }[]; onChange: (v: T) => void; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex max-w-full overflow-x-auto rounded-lg bg-slate-100 p-0.5 ring-1 ring-inset ring-line/60">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)} aria-pressed={value === o.value}
          className={cn('inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors', size === 'sm' ? 'h-6 px-2.5 text-[12px]' : 'h-7 px-3 text-body-sm',
            value === o.value ? 'bg-card text-ink shadow-[0_1px_2px_rgb(var(--shadow)/0.08),0_0_0_1px_rgb(var(--line-strong)/0.5)]' : 'text-ink-muted hover:text-ink')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export default function SystemHealth() {
  const { addToast } = useToast()
  const [params, setParams] = useSearchParams()
  const [summary, setSummary] = useState<HealthSummary | null>(null)
  const [failed, setFailed] = useState(false)
  const [starting, setStarting] = useState(false)
  const tab = (params.get('tab') as Tab) || (params.get('run') ? 'checks' : 'errors')
  const openError = params.get('error')

  const set = useCallback((patch: Record<string, string | null>) => {
    const n = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) { if (v === null) n.delete(k); else n.set(k, v) }
    setParams(n, { replace: true })
  }, [params, setParams])

  const load = useCallback(() => healthApi.summary().then((s) => { setSummary(s); setFailed(false) }).catch(() => setFailed(true)), [])
  useEffect(() => { void load() }, [load])
  // Refresh often while a self check runs, otherwise every minute.
  useEffect(() => {
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void load() }, summary?.running ? 3000 : 60_000)
    return () => window.clearInterval(t)
  }, [load, summary?.running])

  async function runNow() {
    setStarting(true)
    try {
      const r = await healthApi.startRun()
      addToast({ type: 'success', message: r.already ? 'A self check is already running' : 'Self check started. It takes a minute or two.' })
      await load()
      set({ tab: 'checks', run: r.runId })
    } catch (e) { addToast({ type: 'error', message: errMsg(e) }) } finally { setStarting(false) }
  }

  if (failed && !summary) return <div className="mx-auto max-w-6xl"><EmptyState icon={<AlertTriangle />} title="System Health did not load" hint="Check your connection and reload the page." /></div>

  const s = summary
  const apiTotal = s ? s.api.read.total + s.api.write.total : 0
  const apiPassed = s ? s.api.read.passed + s.api.write.passed : 0
  const jobsBad = s?.jobs.filter((j) => j.state === 'failing' || j.state === 'stopped').length ?? 0
  const jobsKnown = s?.jobs.filter((j) => j.state !== 'waiting').length ?? 0

  const tabs: { value: Tab; label: React.ReactNode }[] = [
    { value: 'errors', label: <><Bug size={13} /> Errors{s && s.errors.open > 0 && <span className="rounded bg-danger/10 px-1 text-[11px] font-semibold text-danger">{s.errors.open}</span>}</> },
    { value: 'checks', label: <><ShieldCheck size={13} /> Self checks</> },
    { value: 'server', label: <><Server size={13} /> Jobs and server{jobsBad > 0 && <span className="rounded bg-danger/10 px-1 text-[11px] font-semibold text-danger">{jobsBad}</span>}</> },
    ...(s?.canManageDevelopers ? [{ value: 'developers' as Tab, label: <><Users size={13} /> Developers</> }] : []),
  ]

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-ink">System health</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">Errors, the hourly self check, background jobs and the server. Alerts go to {s?.alertsTo === 'developers' ? `the ${s.developers === 1 ? 'developer' : `${s.developers} developers`}` : 'Super Admins until someone is made a developer'}.</p>
        </div>
        <Button leadingIcon={s?.running || starting ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} disabled={!!s?.running || starting} onClick={runNow}>
          {s?.running ? 'Self check running…' : 'Run self check now'}
        </Button>
      </div>

      <StatusBanner s={s} onOpenRun={(id) => set({ tab: 'checks', run: id })} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="APIs answering" value={s ? (apiTotal ? `${apiPassed}/${apiTotal}` : 'None yet') : null} hint={s?.lastRun ? 'At the last self check' : 'Run a self check'} tone={s && apiTotal && apiPassed < apiTotal ? 'warn' : 'ok'} onClick={() => set({ tab: 'checks', run: s?.lastRun?.id ?? null })} />
        <Tile label="Open errors" value={s ? String(s.errors.open) : null} hint={s ? `${s.errors.new24h} new in 24 hours` : ''} tone={s && s.errors.open ? 'bad' : 'ok'} onClick={() => set({ tab: 'errors' })} />
        <Tile label="Slow requests" value={s ? String(s.errors.slow24h) : null} hint="Over 3 seconds, last 24 hours" tone={s && s.errors.slow24h ? 'warn' : 'ok'} onClick={() => set({ tab: 'errors', source: 'SLOW', state: 'ALL' })} />
        <Tile label="Background jobs" value={s ? (jobsBad ? `${jobsBad} failing` : `${jobsKnown}/${s.jobs.length} ok`) : null} hint={jobsBad ? 'Open Jobs and server' : 'Reporting in on time'} tone={jobsBad ? 'bad' : 'ok'} onClick={() => set({ tab: 'server' })} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented value={tab} options={tabs} onChange={(v) => set({ tab: v, run: null, error: null, source: null, state: null, q: null })} />
      </div>

      {tab === 'errors' && <ErrorsTab params={params} set={set} onChanged={load} />}
      {tab === 'checks' && <ChecksTab runId={params.get('run')} lastRunId={s?.lastRun?.id ?? null} running={s?.running?.id ?? null} onPick={(id) => set({ run: id })} />}
      {tab === 'server' && s && <ServerTab s={s} />}
      {tab === 'developers' && s?.canManageDevelopers && <DevelopersTab onChanged={load} />}

      {openError && <ErrorDrawer id={openError} onClose={() => set({ error: null })} onChanged={load} />}
    </div>
  )
}

function StatusBanner({ s, onOpenRun }: { s: HealthSummary | null; onOpenRun: (id: string) => void }) {
  if (!s) return <div className="skeleton h-[74px] rounded-card" />
  const meta = {
    ok: { title: 'All systems normal', cls: 'border-success/25 bg-success/[0.06]', dot: 'bg-success', ring: 'ring-success/20' },
    warn: { title: 'Working, with warnings', cls: 'border-warning/30 bg-warning/[0.07]', dot: 'bg-warning', ring: 'ring-warning/20' },
    fail: { title: 'Problems need attention', cls: 'border-danger/25 bg-danger/[0.06]', dot: 'bg-danger', ring: 'ring-danger/20' },
  }[s.status]
  const r = s.lastRun
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border px-4 py-3.5', meta.cls)}>
      <span className="relative flex h-3 w-3 shrink-0">
        {s.status !== 'ok' && <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-50', meta.dot)} />}
        <span className={cn('relative inline-flex h-3 w-3 rounded-full ring-4', meta.dot, meta.ring)} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold text-ink">{meta.title}</p>
        <p className="text-body-sm text-ink-muted">
          {s.running ? <span className="inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Self check running since {clock(s.running.startedAt)}</span>
            : r ? <>Last self check {fmtAgo(r.startedAt)}: {r.passed} passed, {r.failed} failed, {r.warned} warnings{r.durationMs ? `, took ${Math.round(r.durationMs / 1000)}s` : ''}</>
              : 'No self check has run yet.'}
          {s.nextRunAt && !s.running && <> · next at {clock(s.nextRunAt)}</>}
        </p>
      </div>
      {r && (r.newProblems > 0 || r.fixed > 0) && (
        <div className="flex gap-1.5 text-[12px] font-medium">
          {r.newProblems > 0 && <span className="rounded-md bg-danger/10 px-2 py-1 text-danger">{r.newProblems} new</span>}
          {r.fixed > 0 && <span className="rounded-md bg-success/10 px-2 py-1 text-success">{r.fixed} fixed</span>}
        </div>
      )}
      {r && <button type="button" onClick={() => onOpenRun(r.id)} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-body-sm font-medium text-ink-muted hover:bg-card/70 hover:text-ink">See report <ChevronRight size={14} /></button>}
    </div>
  )
}

function Tile({ label, value, hint, tone, onClick }: { label: string; value: string | null; hint: string; tone: 'ok' | 'warn' | 'bad'; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group rounded-card border border-line bg-card px-4 py-3.5 text-left shadow-xs transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-raised">
      <span className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-ink-muted">{label}</span>
        <span className={cn('h-2 w-2 rounded-full', tone === 'ok' ? 'bg-success' : tone === 'warn' ? 'bg-warning' : 'bg-danger')} />
      </span>
      {value === null ? <span className="skeleton mt-2 block h-7 w-20" /> : <span className="mt-1.5 block text-[24px] font-semibold tabular-nums tracking-[-0.02em] text-ink">{value}</span>}
      <span className="mt-0.5 block truncate text-[12px] text-ink-faint">{hint}</span>
    </button>
  )
}

// ------------------------------------------------------------------------------------------ Errors

function ErrorsTab({ params, set, onChanged }: { params: URLSearchParams; set: (p: Record<string, string | null>) => void; onChanged: () => void }) {
  const state = params.get('state') || 'OPEN'
  const source = params.get('source') || 'ALL'
  const [q, setQ] = useState(params.get('q') ?? '')
  const [rows, setRows] = useState<ErrorRow[] | null>(null)
  const load = useCallback(() => healthApi.errors({ state, source, q: q.trim() || undefined }).then((r) => setRows(r.errors)).catch(() => setRows([])), [state, source, q])
  useEffect(() => { const t = window.setTimeout(() => void load(), q ? 250 : 0); return () => window.clearTimeout(t) }, [load, q])
  useEffect(() => { const t = window.setInterval(() => { if (document.visibilityState === 'visible') void load() }, 30_000); return () => window.clearInterval(t) }, [load])
  const reloadAll = () => { void load(); onChanged() }
  useEffect(() => {
    const on = () => reloadAll()
    window.addEventListener('pt:health-changed', on)
    return () => window.removeEventListener('pt:health-changed', on)
  })

  return (
    <Card flush>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <Segmented size="sm" value={state} onChange={(v) => set({ state: v })} options={[{ value: 'OPEN', label: 'Open' }, { value: 'RESOLVED', label: 'Resolved' }, { value: 'IGNORED', label: 'Ignored' }, { value: 'ALL', label: 'All' }]} />
        <Segmented size="sm" value={source} onChange={(v) => set({ source: v })} options={[{ value: 'ALL', label: 'Everything' }, { value: 'SERVER', label: 'Server' }, { value: 'BROWSER', label: 'Browser' }, { value: 'JOB', label: 'Jobs' }, { value: 'SLOW', label: 'Slow' }]} />
        <div className="relative ml-auto w-full sm:w-64">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search message or page" aria-label="Search errors" className={cn(fieldCls, 'h-8 pl-8 text-body-sm')} />
        </div>
      </div>
      {!rows ? (
        <div className="space-y-2 p-4">{Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton h-12" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={<CheckCircle2 />} title={state === 'OPEN' ? 'No open errors' : 'Nothing here'} hint={state === 'OPEN' ? 'When something breaks on the server, in a browser or in a background job, it shows here within seconds.' : 'Try another filter.'} />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((g) => {
            const m = SOURCE_META[g.source]
            return (
              <li key={g.id}>
                <button type="button" onClick={() => set({ error: g.id })} className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50">
                  <span className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md', m.cls)} title={m.label}>{m.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className={cn('truncate text-body-md font-medium', g.state === 'OPEN' ? 'text-ink' : 'text-ink-muted')}>{g.message}</span>
                      {g.reopenedAt && g.state === 'OPEN' && <span className="shrink-0 rounded bg-danger/10 px-1.5 text-[11px] font-semibold text-danger">came back</span>}
                      {g.state !== 'OPEN' && <span className="shrink-0 rounded bg-slate-100 px-1.5 text-[11px] font-medium text-ink-muted">{g.state.toLowerCase()}</span>}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-ink-faint">
                      {g.route && <span className="truncate font-mono">{g.route}</span>}
                      <span>first {fmtAgo(g.firstSeenAt)}</span>
                    </span>
                  </span>
                  <span className="hidden shrink-0 text-right sm:block">
                    <span className="block text-body-sm font-semibold tabular-nums text-ink">{g.count.toLocaleString()}×</span>
                    <span className="block text-[12px] text-ink-faint">{g.source === 'JOB' ? 'background' : g.people ? `${g.people} ${g.people === 1 ? 'person' : 'people'}` : 'no one signed in'}</span>
                  </span>
                  <span className="w-16 shrink-0 text-right text-[12px] tabular-nums text-ink-muted">{fmtAgo(g.lastSeenAt)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

function ErrorDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { addToast } = useToast()
  const [e, setE] = useState<ErrorDetail | null>(null)
  const [missing, setMissing] = useState(false)
  const [ticketOpen, setTicketOpen] = useState(false)
  const load = useCallback(() => healthApi.error(id).then((r) => setE(r.error)).catch(() => setMissing(true)), [id])
  useEffect(() => { setE(null); setMissing(false); void load() }, [load])
  useEffect(() => {
    const k = (ev: KeyboardEvent) => { if (ev.key === 'Escape' && !ticketOpen) onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose, ticketOpen])

  async function setState(state: ErrorState) {
    try {
      await healthApi.setState(id, state)
      addToast({ type: 'success', message: state === 'RESOLVED' ? 'Marked as resolved. If it happens again it reopens and you get an alert.' : state === 'IGNORED' ? 'Ignored. It stays in the log but never alerts.' : 'Reopened' })
      await load(); onChanged(); window.dispatchEvent(new Event('pt:health-changed'))
    } catch (err) { addToast({ type: 'error', message: errMsg(err) }) }
  }
  async function forClaude() {
    try { const r = await healthApi.brief(id); await copyText(r.text); addToast({ type: 'success', message: 'Copied. Paste it into Claude and ask it to fix the error.' }) } catch (err) { addToast({ type: 'error', message: errMsg(err) }) }
  }

  const max = e ? Math.max(1, ...e.hours) : 1
  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 animate-fade-in bg-black/30 backdrop-blur-[1px]" onClick={onClose} />
      <aside role="dialog" aria-modal="true" aria-label="Error details" className="relative flex h-full w-full max-w-2xl animate-slide-in-right flex-col border-l border-line bg-card shadow-overlay">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
          {e && <span className={cn('inline-flex h-6 items-center gap-1 rounded-md px-2 text-[12px] font-medium', SOURCE_META[e.source].cls)}>{SOURCE_META[e.source].icon}{SOURCE_META[e.source].label}</span>}
          {e && <span className="rounded-md border border-line px-2 py-0.5 text-[12px] font-medium text-ink-muted">{e.state.toLowerCase()}</span>}
          <button type="button" onClick={onClose} className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-ink-muted hover:bg-slate-100 hover:text-ink" aria-label="Close"><X size={16} /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {missing ? <EmptyState icon={<CircleDashed />} title="This error is no longer in the log" /> : !e ? (
            <div className="space-y-3 p-5">{Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton h-6" />)}</div>
          ) : (
            <div className="space-y-6 p-5">
              <div>
                <h2 className="break-words text-[17px] font-semibold leading-snug text-ink">{e.message}</h2>
                {e.route && <p className="mt-1 break-all font-mono text-[12.5px] text-ink-muted">{e.route}{e.status ? ` · ${e.status}` : ''}</p>}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button size="sm" leadingIcon={<Bot size={14} />} onClick={forClaude}>Copy for Claude</Button>
                <Button size="sm" variant="secondary" leadingIcon={<Ticket size={14} />} onClick={() => setTicketOpen(true)}>Create ticket</Button>
                {e.state !== 'RESOLVED' && <Button size="sm" variant="secondary" leadingIcon={<CheckCircle2 size={14} />} onClick={() => setState('RESOLVED')}>Resolve</Button>}
                {e.state === 'OPEN' && <Button size="sm" variant="ghost" onClick={() => setState('IGNORED')}>Ignore</Button>}
                {e.state !== 'OPEN' && <Button size="sm" variant="ghost" leadingIcon={<RotateCcw size={14} />} onClick={() => setState('OPEN')}>Reopen</Button>}
              </div>

              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Fact label="Times" value={e.count.toLocaleString()} />
                <Fact label="People" value={e.source === 'JOB' ? 'n/a' : String(e.people.length)} />
                <Fact label="First seen" value={fmtDateTime(e.firstSeenAt)} />
                <Fact label="Last seen" value={fmtAgo(e.lastSeenAt)} />
              </dl>
              {(e.reopenedAt || e.resolvedBy) && (
                <p className="text-body-sm text-ink-muted">
                  {e.reopenedAt && <>Came back {fmtDateTime(e.reopenedAt)} after being resolved. </>}
                  {e.resolvedBy && e.resolvedAt && <>Resolved by {e.resolvedBy}, {fmtAgo(e.resolvedAt)}.</>}
                </p>
              )}

              <section>
                <h3 className="mb-2 text-[13px] font-semibold text-ink">Last 48 hours</h3>
                <div className="flex h-14 items-end gap-[2px] rounded-lg border border-line bg-slate-50/60 p-2" aria-label="Times per hour, last 48 hours">
                  {e.hours.map((n, i) => <span key={i} title={`${n} in hour ${i - 47 === 0 ? 'now' : `${47 - i}h ago`}`} className={cn('flex-1 rounded-sm', n ? 'bg-danger/70' : 'bg-slate-200/70')} style={{ height: n ? `${Math.max(12, (n / max) * 100)}%` : '8%' }} />)}
                </div>
                <p className="mt-1 flex justify-between text-[11px] text-ink-faint"><span>48h ago</span><span>now</span></p>
              </section>

              {e.stack && (
                <section>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-[13px] font-semibold text-ink">Stack trace</h3>
                    <button type="button" onClick={async () => { await copyText(e.stack!); addToast({ type: 'success', message: 'Stack copied' }) }} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-body-sm text-ink-muted hover:bg-slate-100 hover:text-ink"><Copy size={13} /> Copy</button>
                  </div>
                  <pre className="max-h-72 overflow-auto rounded-lg border border-line bg-slate-50 p-3 font-mono text-[11.5px] leading-relaxed text-ink">{e.stack}</pre>
                </section>
              )}

              {e.people.length > 0 && (
                <section>
                  <h3 className="mb-2 text-[13px] font-semibold text-ink">Who it hit</h3>
                  <div className="flex flex-wrap gap-1.5">{e.people.map((p) => <span key={p.id} className="rounded-md border border-line px-2 py-0.5 text-body-sm text-ink">{p.name}</span>)}</div>
                </section>
              )}

              <section>
                <h3 className="mb-2 text-[13px] font-semibold text-ink">Latest times</h3>
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {e.events.map((ev) => (
                    <li key={ev.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-body-sm">
                      <span className="w-32 shrink-0 tabular-nums text-ink-muted">{fmtDateTime(ev.at)}</span>
                      <span className="text-ink">{ev.user?.name ?? (e.source === 'JOB' ? 'Background job' : 'No one signed in')}</span>
                      {ev.meta?.browser && <span className="text-ink-faint">{ev.meta.browser}</span>}
                      {ev.durationMs != null && <span className="tabular-nums text-ink-faint">{(ev.durationMs / 1000).toFixed(1)}s</span>}
                      {ev.url && <span className="w-full truncate font-mono text-[11.5px] text-ink-faint">{ev.url}</span>}
                    </li>
                  ))}
                  {!e.events.length && <li className="px-3 py-3 text-body-sm text-ink-muted">No samples kept.</li>}
                </ul>
                <p className="mt-1 text-[11px] text-ink-faint">A sample of each burst is kept for 30 days.</p>
              </section>
            </div>
          )}
        </div>
      </aside>
      {ticketOpen && e && <TicketModal error={e} onClose={() => setTicketOpen(false)} />}
    </div>,
    document.body,
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-slate-50/50 px-3 py-2">
      <dt className="text-[12px] text-ink-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-body-md font-semibold tabular-nums text-ink">{value}</dd>
    </div>
  )
}

function TicketModal({ error, onClose }: { error: ErrorDetail; onClose: () => void }) {
  const { addToast } = useToast()
  const [projects, setProjects] = useState<{ key: string; name: string }[] | null>(null)
  const [project, setProject] = useState('')
  const [members, setMembers] = useState<{ userId: string; name: string }[]>([])
  const [assignee, setAssignee] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { projectsApi.list().then((r) => { setProjects(r.projects.map((p) => ({ key: p.key, name: p.name }))); if (r.projects[0]) setProject(r.projects[0].key) }).catch(() => setProjects([])) }, [])
  useEffect(() => { if (!project) return; setAssignee(''); projectsApi.members(project).then((r) => setMembers(r.members.filter((m) => m.isActive && m.role !== 'VIEWER'))).catch(() => setMembers([])) }, [project])
  async function go() {
    setBusy(true)
    try {
      const r = await healthApi.ticket(error.id, project, assignee ? [assignee] : [])
      addToast({ type: 'success', message: `${r.code} created with the full error in it` })
      onClose()
    } catch (e) { addToast({ type: 'error', message: errMsg(e) }) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title="Create a ticket from this error" size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!project || busy} onClick={go}>{busy ? 'Creating…' : 'Create ticket'}</Button></>}>
      <div className="space-y-3">
        <p className="text-body-sm text-ink-muted">The ticket gets the message, where it happened, the stack trace and a link back here. Priority is set to high.</p>
        <label className="block">
          <span className="mb-1 block text-body-sm font-medium text-ink">Project</span>
          <select value={project} onChange={(e) => setProject(e.target.value)} className={fieldCls} disabled={!projects}>
            {projects?.length === 0 && <option value="">No projects you can add tickets to</option>}
            {projects?.map((p) => <option key={p.key} value={p.key}>{p.name} ({p.key})</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-body-sm font-medium text-ink">Assign to</span>
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={fieldCls}>
            <option value="">Nobody yet</option>
            {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
          </select>
        </label>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------------------------------ Self checks

function ChecksTab({ runId, lastRunId, running, onPick }: { runId: string | null; lastRunId: string | null; running: string | null; onPick: (id: string) => void }) {
  const [runs, setRuns] = useState<AuditRunView[] | null>(null)
  const loadRuns = useCallback(() => healthApi.runs().then((r) => setRuns(r.runs)).catch(() => setRuns([])), [])
  useEffect(() => { void loadRuns() }, [loadRuns, running])
  const selected = runId ?? lastRunId ?? runs?.[0]?.id ?? null

  if (runs && runs.length === 0) return <Card><EmptyState icon={<ShieldCheck />} title="No self checks yet" hint="The first one runs a few minutes after the app starts, then every hour. Or use Run self check now." /></Card>
  return (
    <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <Card flush className="lg:max-h-[640px] lg:overflow-y-auto">
        <p className="border-b border-line px-4 py-2.5 text-[12px] font-medium text-ink-muted">Runs, newest first</p>
        {!runs ? <div className="space-y-2 p-3">{Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton h-10" />)}</div> : (
          <ul className="p-1.5">
            {runs.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => onPick(r.id)} className={cn('flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors', selected === r.id ? 'bg-slate-100' : 'hover:bg-slate-50')}>
                  {r.state === 'RUNNING' ? <Loader2 size={14} className="shrink-0 animate-spin text-primary" /> : <ResultIcon r={r.state === 'PASSED' ? 'PASS' : r.state === 'WARN' ? 'WARN' : 'FAIL'} size={14} />}
                  <span className="min-w-0 flex-1">
                    <span className="block text-body-sm font-medium text-ink">{fmtDateTime(r.startedAt)}</span>
                    <span className="block text-[12px] text-ink-faint">{r.state === 'RUNNING' ? 'Running…' : `${r.failed} failed · ${r.warned} warn`}{r.trigger !== 'schedule' ? ` · ${r.trigger === 'claude' ? 'by Claude' : 'manual'}` : ''}</span>
                  </span>
                  {r.newProblems > 0 && <span className="rounded bg-danger/10 px-1 text-[11px] font-semibold text-danger">+{r.newProblems}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {selected ? <RunDetail id={selected} onFinished={loadRuns} /> : <div className="skeleton h-64 rounded-card" />}
    </div>
  )
}

function RunDetail({ id, onFinished }: { id: string; onFinished: () => void }) {
  const [data, setData] = useState<{ run: AuditRunView; checks: CheckView[] } | null>(null)
  const [view, setView] = useState<'problems' | 'all'>('problems')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const load = useCallback(() => healthApi.run(id).then(setData).catch(() => setData(null)), [id])
  useEffect(() => { setData(null); void load() }, [load])
  useEffect(() => {
    if (data?.run.state !== 'RUNNING') return
    const t = window.setInterval(() => { void load().then(() => onFinished()) }, 3000)
    return () => window.clearInterval(t)
  }, [data?.run.state, load, onFinished])

  const groups = useMemo(() => {
    if (!data) return []
    const by = new Map<string, CheckView[]>()
    for (const c of data.checks) by.set(c.category, [...(by.get(c.category) ?? []), c])
    return CATEGORY_ORDER.filter((c) => by.has(c)).map((c) => ({ category: c, checks: by.get(c)! }))
  }, [data])

  if (!data) return <div className="skeleton h-80 rounded-card" />
  const r = data.run
  if (r.state === 'RUNNING') return <Card><EmptyState icon={<Loader2 className="animate-spin" />} title="Self check running" hint="It calls every API in test mode (nothing is saved), then checks the database, server, jobs and website. This page updates by itself." /></Card>
  const problems = data.checks.filter((c) => c.result === 'FAIL' || c.result === 'WARN')

  return (
    <Card flush>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-body-md font-semibold text-ink">{fmtDateTime(r.startedAt)} <span className="font-normal text-ink-muted">· took {Math.round((r.durationMs ?? 0) / 1000)}s · {r.trigger === 'schedule' ? 'hourly' : r.trigger === 'claude' ? 'started by Claude' : 'started by hand'}</span></p>
          <p className="mt-0.5 flex flex-wrap gap-x-3 text-body-sm">
            <span className="text-success">{r.passed} passed</span><span className="text-danger">{r.failed} failed</span><span className="text-warning">{r.warned} warnings</span><span className="text-ink-faint">{r.skipped} skipped</span>
            {r.newProblems > 0 && <span className="font-medium text-danger">{r.newProblems} new since last run</span>}
            {r.fixed > 0 && <span className="font-medium text-success">{r.fixed} fixed</span>}
          </p>
        </div>
        <Segmented size="sm" value={view} onChange={setView} options={[{ value: 'problems', label: `Problems (${problems.length})` }, { value: 'all', label: `Everything (${data.checks.length})` }]} />
      </div>
      {view === 'problems' && problems.length === 0 ? (
        <EmptyState icon={<CheckCircle2 />} title="Nothing to fix" hint={`All ${r.passed} checks passed${r.skipped ? `, ${r.skipped} were skipped on purpose` : ''}.`} />
      ) : (
        <div className="divide-y divide-line">
          {groups.map((g) => {
            const rows = view === 'problems' ? g.checks.filter((c) => c.result === 'FAIL' || c.result === 'WARN') : g.checks
            if (!rows.length) return null
            const bad = g.checks.filter((c) => c.result === 'FAIL').length
            const long = view === 'all' && rows.length > 12 && !open[g.category]
            const shown = long ? rows.slice(0, 12) : rows
            return (
              <section key={g.category} className="px-4 py-3">
                <h3 className="mb-1.5 flex items-center gap-2 text-[13px] font-semibold text-ink">
                  {g.category.startsWith('api') ? <Globe size={14} className="text-ink-faint" /> : <Activity size={14} className="text-ink-faint" />}
                  {CATEGORY_LABEL[g.category] ?? g.category}
                  <span className="font-normal text-ink-faint">{g.checks.filter((c) => c.result === 'PASS').length}/{g.checks.filter((c) => c.result !== 'SKIP').length} ok{bad ? `, ${bad} failed` : ''}</span>
                </h3>
                <ul>
                  {shown.map((c) => (
                    <li key={c.id} className="flex items-start gap-2.5 rounded-md px-1.5 py-1.5 hover:bg-slate-50">
                      <span className="mt-0.5"><ResultIcon r={c.result} size={14} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className={cn('break-all text-body-sm text-ink', g.category.startsWith('api') && 'font-mono text-[12.5px]')}>{c.name}</span>
                          {c.isNew && <span className="rounded bg-danger/10 px-1 text-[10.5px] font-semibold text-danger">NEW</span>}
                          {c.fixed && <span className="rounded bg-success/10 px-1 text-[10.5px] font-semibold text-success">FIXED</span>}
                        </span>
                        {c.detail && <span className={cn('block break-words text-[12.5px]', c.result === 'FAIL' ? 'text-danger' : 'text-ink-muted')}>{c.detail}</span>}
                      </span>
                      {c.ms != null && <span className="shrink-0 text-[12px] tabular-nums text-ink-faint">{c.ms} ms</span>}
                    </li>
                  ))}
                </ul>
                {long && <button type="button" onClick={() => setOpen((o) => ({ ...o, [g.category]: true }))} className="mt-1 h-7 rounded-md px-2 text-body-sm font-medium text-ink-muted hover:bg-slate-100 hover:text-ink">Show all {rows.length}</button>}
              </section>
            )
          })}
        </div>
      )}
    </Card>
  )
}

// ------------------------------------------------------------------------------------------ Jobs and server

function ServerTab({ s }: { s: HealthSummary }) {
  const jobState = { ok: 'text-success bg-success/10', failing: 'text-danger bg-danger/10', stopped: 'text-danger bg-danger/10', waiting: 'text-ink-muted bg-slate-100' } as const
  const jobLabel = { ok: 'OK', failing: 'Failing', stopped: 'Stopped', waiting: 'Not run yet' } as const
  const row = (label: string, value: React.ReactNode, r?: CheckResult) => (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-body-sm text-ink-muted">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5 text-right text-body-sm text-ink">{r && <ResultIcon r={r} size={13} />}<span className="truncate">{value}</span></span>
    </div>
  )
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card title="Background jobs" subtitle="Each one reports in every time it runs" flush>
        <ul className="mt-3 divide-y divide-line border-t border-line">
          {s.jobs.map((j) => (
            <li key={j.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block text-body-md text-ink">{j.label}</span>
                <span className="block text-[12px] text-ink-faint">{every(j.everyMs)}{j.lastRunAt ? ` · last ran ${fmtAgo(j.lastRunAt)}` : ''}{j.runs ? ` · ${j.runs.toLocaleString()} runs, ${j.failures} failed` : ''}</span>
                {j.lastError && <span className="mt-0.5 block break-words text-[12.5px] text-danger">{j.lastError}</span>}
              </span>
              <span className={cn('rounded-md px-2 py-0.5 text-[12px] font-medium', jobState[j.state])}>{jobLabel[j.state]}</span>
            </li>
          ))}
        </ul>
      </Card>
      <div className="space-y-4">
        <Card title="Server">
          <div className="-my-2 divide-y divide-line">
            {row('App running for', duration(s.server.uptimeSec))}
            {row('App memory', bytes(s.server.rss))}
            {row('Server memory free', `${bytes(s.server.freemem)} of ${bytes(s.server.totalmem)}`)}
            {row('CPU load', `${s.server.load.toFixed(2)} on ${s.server.cpus} cores`)}
            {s.server.disk && row('Disk', s.server.disk.detail, s.server.disk.result)}
            {s.server.db && row('Database', s.server.db.detail, s.server.db.result)}
            {s.server.migrations && row('Migrations', s.server.migrations.detail, s.server.migrations.result)}
            {s.server.ssl && row('SSL certificate', s.server.ssl.detail, s.server.ssl.result)}
            {row('Node', s.server.node)}
          </div>
        </Card>
        <Card title="Outside uptime check" subtitle="Alerts when the whole site is down">
          {s.uptime.configured ? (
            <div className="space-y-3">
              <p className="flex items-center gap-1.5 text-body-sm text-ink">
                <ResultIcon r={s.uptime.lastPingAt && Date.now() - new Date(s.uptime.lastPingAt).getTime() < 10 * 60_000 ? 'PASS' : 'WARN'} size={14} />
                {s.uptime.lastPingAt ? `Last heard ${fmtAgo(s.uptime.lastPingAt)}` : 'No word from the checker since the app started'}
              </p>
              {s.uptime.outages.length ? (
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {s.uptime.outages.map((o) => <li key={o.id} className="px-3 py-2 text-body-sm"><span className="font-medium text-ink">Down {o.minutes} min</span> <span className="text-ink-muted">· {fmtDateTime(o.downAt)}{o.detail ? ` · ${o.detail}` : ''}</span></li>)}
                </ul>
              ) : <p className="text-body-sm text-ink-muted">No outages recorded.</p>}
            </div>
          ) : (
            <div className="space-y-2 text-body-sm text-ink-muted">
              <p>Not set up yet. It runs on the office server and checks pulsetrack.online every minute, so you hear about it even if the whole app is down.</p>
              <p>The steps are at the top of <span className="font-mono text-ink">scripts/uptime-check.sh</span>.</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------------------------------ Developers

function DevelopersTab({ onChanged }: { onChanged: () => void }) {
  const { addToast } = useToast()
  const [users, setUsers] = useState<{ id: string; name: string; email: string; role: string; isDeveloper: boolean }[] | null>(null)
  const [q, setQ] = useState('')
  useEffect(() => { healthApi.developers().then((r) => setUsers(r.users)).catch(() => setUsers([])) }, [])
  const shown = (users ?? []).filter((u) => !q || `${u.name} ${u.email}`.toLowerCase().includes(q.toLowerCase()))
  async function toggle(id: string, on: boolean) {
    setUsers((list) => list?.map((u) => (u.id === id ? { ...u, isDeveloper: on } : u)) ?? null)
    try { await healthApi.setDeveloper(id, on); onChanged() } catch (e) {
      setUsers((list) => list?.map((u) => (u.id === id ? { ...u, isDeveloper: !on } : u)) ?? null)
      addToast({ type: 'error', message: errMsg(e) })
    }
  }
  return (
    <Card title="Developers" subtitle="Developers can open this page, get its bell and phone alerts, and use the System Health tools in Claude. While nobody is a developer, Super Admins get the alerts." flush>
      <div className="mt-3 border-t border-line px-5 py-3">
        <div className="relative max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a person" aria-label="Find a person" className={cn(fieldCls, 'h-8 pl-8 text-body-sm')} />
        </div>
      </div>
      {!users ? <div className="space-y-2 px-5 pb-4">{Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton h-10" />)}</div> : (
        <ul className="divide-y divide-line border-t border-line">
          {shown.map((u) => (
            <li key={u.id} className="flex items-center gap-3 px-5 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body-md text-ink">{u.name}</span>
                <span className="block truncate text-[12px] text-ink-faint">{u.email}{u.role === 'SUPER_ADMIN' ? ' · Super Admin' : ''}</span>
              </span>
              <Toggle checked={u.isDeveloper} onChange={(v) => toggle(u.id, v)} label={`${u.name} is a developer`} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
