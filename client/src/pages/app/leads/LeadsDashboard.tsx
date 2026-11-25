import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowRight, Ban, CalendarClock, Check, Clock, Flag, Inbox, PhoneCall, PhoneMissed, PhoneOff, RefreshCw, SlidersHorizontal, Sparkles, TrendingDown, UserPlus, Users, Wallet } from 'lucide-react'
import { TextField } from '../../../components/ui/Input'
import { apiErrorText } from '../../../lib/api'
import { flagOn } from '../../../lib/flags'
import { cn } from '../../../lib/cn'
import { leadsApi, money, type Dashboard } from '../../../lib/leadsApi'
import { BusinessPicker, DATE_RANGES, PageHeader, useBusiness, useLeadsMeta } from './shared'
import type { Hue } from '../../../theme/roles'
import { role } from '../../../theme/css'

/**
 * Lead Dashboard. The big colour cards are the person's own pick (Customize: any of the numbers below can be a card;
 * the rest stay as small counts), then the pipeline as one funnel and the tasks. Every number opens the list filtered.
 */

/** One number the dashboard can show, as a big card or a small count. */
interface Metric { key: string; label: string; value: number | string; count: number; sub: string; icon: ReactNode; tone: Tone; open: () => void }

const CARDS_KEY = 'leads.dashboard.cards.v1'
const readCards = (): string[] | null => { try { const v = JSON.parse(localStorage.getItem(CARDS_KEY) ?? 'null'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null } catch { return null } }
const writeCards = (v: string[] | null) => { try { if (v) localStorage.setItem(CARDS_KEY, JSON.stringify(v)); else localStorage.removeItem(CARDS_KEY) } catch { /* private window */ } }

export default function LeadsDashboard() {
  const nav = useNavigate()
  const { meta } = useLeadsMeta()
  const { business, all } = useBusiness()
  const [range, setRange] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [d, setD] = useState<Dashboard | null>(null)
  const [err, setErr] = useState('')
  const [picked, setPicked] = useState<string[] | null>(readCards)
  const bizParam = all ? undefined : business?.id

  useEffect(() => {
    if (range === 'custom' && !(from && to)) return
    leadsApi.dashboard({ business: bizParam, range, from: range === 'custom' ? from : undefined, to: range === 'custom' ? to : undefined }).then((r) => { setD(r); setErr('') }).catch((e) => setErr(apiErrorText(e, 'Could not load')))
  }, [bizParam, range, from, to])

  const q = (p: Record<string, string>) => `?${new URLSearchParams({ ...(bizParam ? { business: bizParam } : {}), ...p }).toString()}`
  const go = (p: Record<string, string>) => nav(`/app/leads${q(p)}`)
  const cmr = business?.kind === 'CMR'
  const canManage = !!meta?.me.admin || business?.myRole === 'MANAGER'
  const isHead = !!business && !!meta?.me.headOf.includes(business.id)
  const pipeline = business?.pipeline ?? []
  const c = d?.cards
  const firstName = meta?.me.name?.split(' ')[0]

  // Every number this person can see, in the order they are offered.
  const metrics = useMemo((): Metric[] => {
    if (!c || !d) return []
    const m = (key: string, label: string, count: number, sub: string, icon: ReactNode, tone: Tone, open: () => void, value: number | string = count): Metric => ({ key, label, value, count, sub, icon, tone, open })
    return [
      m('total', 'Leads', c.total, `${c.newThisWeek} new this week`, <Inbox size={20} />, 'accent', () => go({ status: 'all' })),
      m('calls', 'Calls', c.calls, `${c.connected ?? 0} connected${c.kept ? ` · ${c.kept} to numbers with no lead yet` : ''}`, <PhoneCall size={20} />, 'green', () => nav(`/app/leads/calls${q({})}`)),
      m('overdue', 'Overdue next steps', c.overdue, c.overdue ? 'The next step date has passed' : 'Nothing overdue', <AlertTriangle size={20} />, c.overdue ? 'red' : 'neutral', () => go({ overdue: '1' })),
      ...(cmr ? [m('waiting', 'Waiting on Jesse', c.waiting, c.waiting ? 'Flagged, no decision yet' : 'Nothing flagged', <Flag size={20} />, 'orange', () => go({ flag: '1' }))] : []),
      ...(canManage ? [m('unassigned', 'Unassigned', c.unassigned, c.unassigned ? 'Open, nobody has it yet' : 'Everyone has an owner', <UserPlus size={20} />, 'orange', () => go({ assignee: 'none' }))] : []),
      m('newThisWeek', 'New this week', c.newThisWeek, 'Came in since Monday', <Sparkles size={20} />, 'blue', () => go({ status: 'all', sort: 'newest' })),
      m('recentlyUpdated', 'Updated in 48 h', c.recentlyUpdated, 'Touched in the last two days', <RefreshCw size={20} />, 'teal', () => go({ status: 'all', sort: 'activity' })),
      m('noStatus', 'Never called', c.noStatus, 'Still at the first stage', <PhoneOff size={20} />, 'purple', () => go({ status: 'NEW' })),
      ...(canManage ? [m('assigned', 'Assigned', c.assigned, 'Open leads with an owner', <Users size={20} />, 'blue', () => go({ status: 'all' }))] : []),
      ...(cmr ? [m('belowMin', 'Below minimum', c.belowMin, 'Volume under the minimum load', <TrendingDown size={20} />, 'pink', () => go({ belowMin: '1' }))] : []),
      m('late', 'Late (SLA)', c.late, 'Not assigned or contacted in time', <Clock size={20} />, 'red', () => go({ late: '1' })),
      m('prohibited', cmr ? 'Prohibited / customer' : 'Do not call', c.prohibited, 'On the Prohibited or customer list', <Ban size={20} />, 'neutral', () => go({ prohibited: '1', status: 'all' })),
      m('kept', 'Calls with no lead yet', c.kept ?? 0, 'Calls to numbers no lead has', <PhoneMissed size={20} />, 'orange', () => nav(`/app/leads/calls${q({ view: 'unmatched' })}`)),
      m('tasksToday', 'Tasks due today', d.tasks.today, `${d.tasks.total} open in all`, <CalendarClock size={20} />, 'blue', () => nav(`/app/leads/tasks${q({})}`)),
      m('tasksOverdue', 'Overdue tasks', d.tasks.overdue, 'Follow-ups past their date', <CalendarClock size={20} />, 'red', () => nav(`/app/leads/tasks${q({ tab: 'overdue' })}`)),
      ...(!all && flagOn('deal-board') && d.openValue != null ? [m('openValue', 'Open deal value', d.openValue, 'What the open deals are worth', <Wallet size={20} />, 'green', () => nav('/app/leads/board'), money(d.openValue, d.currency ?? 'USD', true))] : []),
    ]
  }, [c, d, cmr, canManage, all, bizParam]) // eslint-disable-line react-hooks/exhaustive-deps

  const defaults = ['total', 'calls', 'overdue', cmr ? 'waiting' : 'unassigned']
  const offered = new Set(metrics.map((x) => x.key))
  const mine = (picked ?? defaults).filter((k) => offered.has(k))
  const cards = (mine.length ? mine : defaults.filter((k) => offered.has(k))).map((k) => metrics.find((x) => x.key === k)!)
  const chips = metrics.filter((x) => !cards.includes(x) && !x.key.startsWith('tasks') && x.key !== 'openValue' && (x.count > 0 || !['late', 'kept'].includes(x.key)))
  const choose = (v: string[] | null) => { setPicked(v); writeCards(v) }

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-4">
      <PageHeader title={firstName ? `Good ${hourWord()}, ${firstName}` : 'Lead Dashboard'} hint={business ? `${business.name}${cmr && !/cmr/i.test(business.name) ? ' · CMR flow' : ''} · ${d ? d.range.toLowerCase() : '…'}` : 'All businesses'} actions={<BusinessPicker allowAll />}>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-btn border border-line bg-card p-0.5">
            {DATE_RANGES.map((r) => <button key={r.key} type="button" onClick={() => setRange(r.key)} className={cn('h-8 rounded-md px-3 text-body-sm font-semibold', range === r.key ? 'bg-ink text-card' : 'text-ink-muted hover:text-ink')}>{r.label}</button>)}
          </div>
          {range === 'custom' && <><TextField type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" aria-label="From" /><span className="text-ink-faint">to</span><TextField type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" aria-label="To" /></>}
          {metrics.length > 0 && <span className="ml-auto"><Customize metrics={metrics} shown={cards.map((x) => x.key)} onChange={choose} /></span>}
        </div>
      </PageHeader>

      {err && <p className="rounded-btn bg-danger/10 px-3 py-2 text-body-sm text-danger-ink">{err}</p>}

      {c && d && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {cards.map((x) => <Hero key={x.key} label={x.label} value={x.value} sub={x.sub} icon={x.icon} tone={x.tone} onClick={x.open} />)}
          </div>

          {chips.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {chips.map((x) => <Mini key={x.key} label={x.label} value={x.count} tone={CHIP[x.tone]} onClick={x.open} />)}
            </div>
          )}

          <div className="grid gap-3 lg:grid-cols-3">
            <section className="rounded-card border border-line bg-card p-5 shadow-xs lg:col-span-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-[15px] font-semibold text-ink">Pipeline</h2>
                <span className="text-body-sm text-ink-faint">{all ? 'Across businesses' : business?.name}{!all && d.openValue && flagOn('deal-board') ? <> · <Link to="/app/leads/board" className="font-semibold text-ink hover:text-primary-ink" title="Open the deal board">{money(d.openValue, d.currency ?? 'USD')} open</Link></> : null}</span>
              </div>
              <Funnel d={d} pipeline={pipeline} onPick={(key) => go({ status: key })} />
            </section>

            <section className="flex flex-col gap-3">
              <Link to={`/app/leads/tasks${q(d.tasks.overdue ? { tab: 'overdue' } : {})}`} className="group rounded-card border border-line bg-card p-5 shadow-xs transition-colors hover:border-primary/40">
                <div className="flex items-start justify-between">
                  <span className="flex items-center gap-2 text-[15px] font-semibold text-ink"><span className="rounded-lg bg-primary/10 p-1.5 text-primary-ink"><CalendarClock size={16} /></span>Scheduled tasks</span>
                  <ArrowRight size={16} className="text-ink-faint transition-transform group-hover:translate-x-0.5" />
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <Stat n={d.tasks.today} label="Due today" tone={d.tasks.today ? 'primary' : 'muted'} />
                  <Stat n={d.tasks.overdue} label="Overdue" tone={d.tasks.overdue ? 'danger' : 'muted'} />
                  <Stat n={d.tasks.total} label="Open" tone="ink" />
                </div>
                <p className="mt-3 text-body-sm text-ink-muted">{d.tasks.overdue ? 'Start with the overdue ones: each has a Call button.' : d.tasks.today ? 'Work today’s list top to bottom.' : 'Nothing due. Call the never-called leads.'}</p>
              </Link>
              {cmr && isHead && (
                <Link to={`/app/leads${q({ flag: '1' })}`} className="group rounded-card border border-line bg-gradient-to-br from-orange-subtle to-yellow-subtle p-5 shadow-xs transition-colors hover:border-orange-ring">
                  <div className="flex items-start justify-between">
                    <span className="flex items-center gap-2 text-[15px] font-semibold text-ink"><span className="rounded-lg bg-orange-vivid/15 p-1.5 text-orange-ink"><Flag size={16} /></span>Waiting on you</span>
                    <ArrowRight size={16} className="text-ink-faint transition-transform group-hover:translate-x-0.5" />
                  </div>
                  <div className="mt-3 flex items-end gap-3"><span className="text-[36px] font-bold tabular-nums leading-none text-orange-ink">{c.waiting}</span><span className="pb-1 text-body-sm text-ink-muted">lead{c.waiting === 1 ? '' : 's'} flagged by the SDRs, waiting for your decision</span></div>
                </Link>
              )}
              {cmr && !isHead && (
                <div className="rounded-card border border-line bg-gradient-to-br from-orange-subtle to-yellow-subtle p-5 shadow-xs">
                  <span className="flex items-center gap-2 text-[15px] font-semibold text-ink"><span className="rounded-lg bg-orange-vivid/15 p-1.5 text-orange-ink"><Sparkles size={16} /></span>The Jesse flow</span>
                  <ol className="mt-3 space-y-1.5 text-body-sm text-ink">
                    <li><b>1.</b> Call, log it, fill the <b>five facts</b>.</li>
                    <li><b>2.</b> <b>Send info</b>, follow up in 2 days.</li>
                    <li><b>3.</b> <b>Qualify</b> with one line on what Jesse must decide.</li>
                    <li><b>4.</b> Jesse answers within a business day.</li>
                  </ol>
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}

function hourWord(): string { const h = new Date().getHours(); return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening' }

/** Pick which numbers are big cards; the order of the list is the order on the screen. */
function Customize({ metrics, shown, onChange }: { metrics: Metric[]; shown: string[]; onChange: (v: string[] | null) => void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', off); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc) }
  }, [open])
  const flip = (k: string) => {
    const on = shown.includes(k)
    if (on && shown.length === 1) return // at least one card
    onChange(on ? shown.filter((x) => x !== k) : metrics.map((x) => x.key).filter((x) => x === k || shown.includes(x)).slice(0, 8))
  }
  return (
    <div ref={box} className="relative">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="inline-flex h-9 items-center gap-1.5 rounded-btn border border-line bg-card px-3 text-body-sm font-semibold text-ink-muted hover:border-line-strong hover:text-ink"><SlidersHorizontal size={15} />Customize cards</button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-72 rounded-card border border-line bg-card p-2 shadow-overlay">
          <p className="px-2 pb-2 pt-1 text-[11.5px] text-ink-muted">Pick the numbers you want as big cards (up to 8). The rest stay as small counts.</p>
          <ul className="max-h-80 overflow-auto">
            {metrics.map((x) => {
              const on = shown.includes(x.key)
              return (
                <li key={x.key}>
                  <button type="button" role="menuitemcheckbox" aria-checked={on} onClick={() => flip(x.key)} disabled={!on && shown.length >= 8} className="flex w-full items-center gap-2.5 rounded-btn px-2 py-1.5 text-left text-body-sm text-ink hover:bg-slate-50 disabled:opacity-40 dark:hover:bg-white/5">
                    <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded border', on ? 'border-primary bg-primary text-primary-on' : 'border-line-strong')}>{on && <Check size={11} />}</span>
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: role(HERO[x.tone][0]) }} />
                    <span className="flex-1 truncate">{x.label}</span>
                    <span className="tabular-nums text-ink-faint">{typeof x.value === 'number' ? x.value.toLocaleString() : x.value}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="mt-1 border-t border-line px-2 pt-2"><button type="button" onClick={() => onChange(null)} className="text-body-sm font-semibold text-primary-ink hover:underline">Back to the usual four</button></div>
        </div>
      )}
    </div>
  )
}

/**
 * The colours of a big card, from the theme: a gradient between two solid colours, and the text colour that reads on
 * the first, in light and dark.
 */
const HERO = {
  accent: ['accent', 'purple-vivid', 'on-accent'],
  green: ['green-vivid', 'teal-vivid', 'on-green'],
  red: ['red-vivid', 'orange-vivid', 'on-red'],
  orange: ['orange-vivid', 'yellow-vivid', 'on-orange'],
  blue: ['blue-vivid', 'accent', 'on-blue'],
  teal: ['teal-vivid', 'blue-vivid', 'on-teal'],
  purple: ['purple-vivid', 'pink-vivid', 'on-purple'],
  pink: ['pink-vivid', 'red-vivid', 'on-pink'],
  neutral: ['neutral-600', 'neutral-500', 'background-body'],
} as const
type Tone = keyof typeof HERO
/** The same tone as a small count's dot. */
const CHIP: Record<Tone, Hue | 'neutral'> = { accent: 'purple', green: 'green', red: 'red', orange: 'orange', blue: 'blue', teal: 'teal', purple: 'purple', pink: 'pink', neutral: 'neutral' }

/** A big colour card: gradient, icon, the number, one line under it. */
function Hero({ label, value, sub, icon, tone, onClick }: { label: string; value: number | string; sub: string; icon: ReactNode; tone: Tone; onClick: () => void }) {
  const [from, to, ink] = HERO[tone].map(role)
  return (
    <button type="button" onClick={onClick} className="group relative overflow-hidden rounded-card p-5 text-left shadow-md transition-transform hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-current" style={{ color: ink, background: `linear-gradient(135deg, ${from}, ${to})` }}>
      <span className="pointer-events-none absolute -right-6 -top-6 h-28 w-28 rounded-full bg-white/10" />
      <span className="pointer-events-none absolute -bottom-10 right-8 h-24 w-24 rounded-full bg-white/10" />
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold uppercase tracking-wide opacity-[.85]">{label}</span>
        <span className="rounded-lg bg-white/20 p-1.5">{icon}</span>
      </div>
      <div className="mt-3 text-[36px] font-bold tabular-nums leading-none">{typeof value === 'number' ? value.toLocaleString() : value}</div>
      <div className="mt-2 flex items-center justify-between text-[12.5px] opacity-[.85]"><span className="truncate">{sub}</span><ArrowRight size={14} className="shrink-0 opacity-70 transition-transform group-hover:translate-x-0.5" /></div>
    </button>
  )
}

/** A small count pill for the numbers that are not big cards. */
function Mini({ label, value, tone, onClick }: { label: string; value: number; tone: Hue | 'neutral'; onClick: () => void }) {
  // The theme's colours for this hue: a solid dot, and a tinted count that reads in light and dark.
  const dot = role(tone === 'neutral' ? 'neutral-400' : `${tone}-vivid`)
  const tint = tone === 'neutral' ? 'rgb(var(--c-neutral-400) / 0.15)' : `rgb(var(--c-${tone}-vivid) / 0.12)`
  const ink = role(tone === 'neutral' ? 'text-secondary' : `text-${tone}`)
  return (
    <button type="button" onClick={onClick} className={cn('inline-flex h-9 items-center gap-2 rounded-full border border-line bg-card pl-3 pr-1.5 text-body-sm font-medium transition-colors hover:border-line-strong', value ? 'text-ink' : 'text-ink-faint')}>
      <span className="h-2 w-2 rounded-full" style={{ background: dot }} />{label}
      <span className="rounded-full px-2 py-0.5 text-[12px] font-bold tabular-nums" style={value ? { background: tint, color: ink } : { background: 'transparent' }}>{value}</span>
    </button>
  )
}

function Stat({ n, label, tone }: { n: number; label: string; tone: 'primary' | 'danger' | 'ink' | 'muted' }) {
  return (
    <div className={cn('rounded-btn px-2 py-2', tone === 'danger' ? 'bg-danger/10' : tone === 'primary' ? 'bg-primary/10' : 'bg-slate-50 dark:bg-white/[0.04]')}>
      <div className={cn('text-[22px] font-bold tabular-nums leading-none', tone === 'danger' ? 'text-danger-ink' : tone === 'primary' ? 'text-primary-ink' : tone === 'muted' ? 'text-ink-faint' : 'text-ink')}>{n}</div>
      <div className="mt-1 text-[11px] text-ink-muted">{label}</div>
    </div>
  )
}

/**
 * The pipeline as one funnel: a row per open stage (its bar against the biggest stage, the count, its share of all
 * the leads), then the closed stages that have leads. Stages with none are named on one quiet line. A row opens the
 * Leads list at that stage.
 */
function Funnel({ d, pipeline, onPick }: { d: Dashboard; pipeline: { key: string; label: string; color: string; open?: boolean }[]; onPick: (key: string) => void }) {
  const stages = pipeline.length ? pipeline : Object.keys(d.byStatus).map((k) => ({ key: k, label: k, color: role('neutral-500'), open: true }))
  const n = (k: string) => d.byStatus[k] ?? 0
  const total = stages.reduce((a, s) => a + n(s.key), 0)
  if (!total) return <p className="mt-6 text-body-sm text-ink-faint">No leads in this period yet.</p>
  const open = stages.filter((s) => s.open !== false), closed = stages.filter((s) => s.open === false)
  const openN = open.reduce((a, s) => a + n(s.key), 0), closedN = total - openN
  const max = Math.max(1, ...stages.map((s) => n(s.key)))
  const empty = [...open, ...closed].filter((s) => !n(s.key))
  const row = (s: (typeof stages)[number]) => {
    const v = n(s.key)
    return (
      <li key={s.key}>
        <button type="button" onClick={() => onPick(s.key)} className="group grid w-full grid-cols-[minmax(96px,150px)_minmax(0,1fr)_72px] items-center gap-3 rounded-btn px-2 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-white/[0.04]">
          <span className="flex min-w-0 items-center gap-2 text-body-sm font-medium text-ink"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} /><span className="truncate">{s.label}</span></span>
          <span className="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/[0.06]"><span className="block h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(3, (v / max) * 100)}%`, background: s.color }} /></span>
          <span className="flex items-baseline justify-end gap-1.5"><span className="text-[15px] font-bold tabular-nums text-ink">{v}</span><span className="w-9 text-right text-[11.5px] tabular-nums text-ink-faint">{Math.round((v / total) * 100)}%</span></span>
        </button>
      </li>
    )
  }
  return (
    <div className="mt-4">
      <div className="mb-3 flex gap-4 text-body-sm">
        <span className="text-ink-muted"><b className="tabular-nums text-ink">{openN}</b> open</span>
        <span className="text-ink-muted"><b className="tabular-nums text-ink">{closedN}</b> closed</span>
        <span className="text-ink-muted"><b className="tabular-nums text-ink">{total}</b> in all</span>
      </div>
      <ul className="space-y-0.5">{open.filter((s) => n(s.key)).map(row)}</ul>
      {closed.some((s) => n(s.key)) && (
        <>
          <p className="mb-1 mt-4 px-2 text-[11.5px] font-semibold uppercase tracking-wide text-ink-faint">Closed</p>
          <ul className="space-y-0.5">{closed.filter((s) => n(s.key)).map(row)}</ul>
        </>
      )}
      {empty.length > 0 && <p className="mt-3 px-2 text-[11.5px] text-ink-faint">None yet in: {empty.map((s) => s.label).join(', ')}</p>}
    </div>
  )
}
