import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowRight, CalendarClock, Flag, Inbox, PhoneCall, PhoneMissed, Sparkles, UserPlus, Users } from 'lucide-react'
import { TextField } from '../../../components/ui/Input'
import { apiErrorText } from '../../../lib/api'
import { flagOn } from '../../../lib/flags'
import { cn } from '../../../lib/cn'
import { leadsApi, money, type Dashboard } from '../../../lib/leadsApi'
import { BusinessPicker, DATE_RANGES, PageHeader, useBusiness, useLeadsMeta } from './shared'

/**
 * Lead Dashboard. One screen, no scrolling on a laptop: four big colour cards for what matters
 * today, a row of "needs attention" counts, then the pipeline and the task bar side by side.
 * Every number opens the list already filtered.
 */
export default function LeadsDashboard() {
  const nav = useNavigate()
  const { meta } = useLeadsMeta()
  const { business, all } = useBusiness()
  const [range, setRange] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [d, setD] = useState<Dashboard | null>(null)
  const [err, setErr] = useState('')
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

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-4">
      <PageHeader title={firstName ? `Good ${hourWord()}, ${firstName}` : 'Lead Dashboard'} hint={business ? `${business.name}${cmr && !/cmr/i.test(business.name) ? ' · CMR flow' : ''} · ${d ? d.range.toLowerCase() : '…'}` : 'All businesses'} actions={<BusinessPicker allowAll />}>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-btn border border-line bg-card p-0.5">
            {DATE_RANGES.map((r) => <button key={r.key} type="button" onClick={() => setRange(r.key)} className={cn('h-8 rounded-md px-3 text-body-sm font-semibold', range === r.key ? 'bg-ink text-card' : 'text-ink-muted hover:text-ink')}>{r.label}</button>)}
          </div>
          {range === 'custom' && <><TextField type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" aria-label="From" /><span className="text-ink-faint">to</span><TextField type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" aria-label="To" /></>}
        </div>
      </PageHeader>

      {err && <p className="rounded-btn bg-danger/10 px-3 py-2 text-body-sm text-danger">{err}</p>}

      {c && d && (
        <>
          {/* The four that matter */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Hero label="Leads" value={c.total} sub={`${c.newThisWeek} new this week`} icon={<Inbox size={20} />} from="#4F46E5" to="#7C3AED" onClick={() => go({ status: 'all' })} />
            <Hero label="Calls" value={c.calls} sub={`${c.connected ?? 0} connected${c.kept ? ` · ${c.kept} to numbers with no lead yet` : ''}`} icon={<PhoneCall size={20} />} from="#059669" to="#14B8A6" onClick={() => nav(`/app/leads/calls${q({})}`)} />
            <Hero label="Overdue next steps" value={c.overdue} sub={c.overdue ? 'Next step date has passed' : 'Nothing overdue'} icon={<AlertTriangle size={20} />} from={c.overdue ? '#DC2626' : '#64748B'} to={c.overdue ? '#F97316' : '#94A3B8'} onClick={() => go({ overdue: '1' })} />
            {cmr
              ? <Hero label="Waiting on Jesse" value={c.waiting} sub={c.waiting ? 'Flagged, no decision yet' : 'Nothing flagged'} icon={<Flag size={20} />} from="#EA580C" to="#F59E0B" onClick={() => go({ flag: '1' })} />
              : <Hero label="Unassigned" value={c.unassigned} sub={c.unassigned ? 'Open, nobody yet' : 'Everyone has an owner'} icon={<UserPlus size={20} />} from="#EA580C" to="#F59E0B" onClick={() => go({ assignee: 'none' })} />}
          </div>

          {/* Needs attention */}
          <div className="flex flex-wrap gap-2">
            <Mini label="New this week" value={c.newThisWeek} color="#0EA5E9" onClick={() => go({ status: 'all', sort: 'newest' })} />
            <Mini label="Updated in 48 h" value={c.recentlyUpdated} color="#14B8A6" onClick={() => go({ status: 'all', sort: 'activity' })} />
            <Mini label="Never called" value={c.noStatus} color="#94A3B8" onClick={() => go({ status: 'NEW' })} />
            {canManage && <Mini label="Unassigned" value={c.unassigned} color="#F59E0B" onClick={() => go({ assignee: 'none' })} />}
            {canManage && <Mini label="Assigned" value={c.assigned} color="#8B5CF6" icon={<Users size={12} />} onClick={() => go({ status: 'all' })} />}
            {cmr && <Mini label="Below minimum" value={c.belowMin} color="#A855F7" onClick={() => go({ belowMin: '1' })} />}
            {c.late > 0 && <Mini label="Late (SLA)" value={c.late} color="#DC2626" onClick={() => go({ late: '1' })} />}
            <Mini label={cmr ? 'Prohibited / customer' : 'Do not call'} value={c.prohibited} color="#64748B" onClick={() => go({ prohibited: '1', status: 'all' })} />
            {(c.kept ?? 0) > 0 && <Mini label="Calls with no lead yet" value={c.kept ?? 0} color="#F59E0B" icon={<PhoneMissed size={12} />} onClick={() => nav(`/app/leads/calls${q({ view: 'unmatched' })}`)} />}
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            {/* Pipeline */}
            <section className="rounded-card border border-line bg-card p-5 shadow-xs lg:col-span-2">
              <div className="flex items-center justify-between"><h2 className="text-[15px] font-semibold text-ink">Pipeline</h2><span className="text-right text-body-sm text-ink-faint">{all ? 'Across businesses' : business?.name} · {Object.values(d.byStatus).reduce((a, b) => a + b, 0)} leads{!all && d.openValue && flagOn('deal-board') ? <> · <Link to="/app/leads/board" className="font-semibold text-ink hover:text-primary" title="Open the deal board">{money(d.openValue, d.currency ?? 'USD')} open</Link></> : null}</span></div>
              <PipelineBar d={d} pipeline={pipeline} />
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                {(pipeline.length ? pipeline : Object.keys(d.byStatus).map((k) => ({ key: k, label: k, color: '#64748B', open: true }))).map((st) => {
                  const n = d.byStatus[st.key] ?? 0
                  return (
                    <button key={st.key} type="button" onClick={() => go({ status: st.key })} className={cn('group flex items-center justify-between gap-2 rounded-btn border px-3 py-2 text-left transition-colors hover:border-line-strong', n ? 'border-line bg-card' : 'border-dashed border-line bg-transparent')} style={n ? { borderLeftWidth: 4, borderLeftColor: st.color } : { borderLeftWidth: 4, borderLeftColor: `${st.color}55` }}>
                      <span className="min-w-0"><span className="block truncate text-body-sm font-medium text-ink">{st.label}</span><span className="block text-[11px] text-ink-faint">{st.open ? 'Open' : 'Closed'}</span></span>
                      <span className={cn('text-[20px] font-bold tabular-nums leading-none', n ? 'text-ink' : 'text-ink-faint')} style={n ? { color: st.color } : undefined}>{n}</span>
                    </button>
                  )
                })}
              </div>
            </section>

            {/* Today */}
            <section className="flex flex-col gap-3">
              <Link to={`/app/leads/tasks${q(d.tasks.overdue ? { tab: 'overdue' } : {})}`} className="group rounded-card border border-line bg-card p-5 shadow-xs transition-colors hover:border-primary/40">
                <div className="flex items-start justify-between">
                  <span className="flex items-center gap-2 text-[15px] font-semibold text-ink"><span className="rounded-lg bg-primary/10 p-1.5 text-primary"><CalendarClock size={16} /></span>Scheduled tasks</span>
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
                <Link to={`/app/leads/queue${q({})}`} className="group rounded-card border border-line bg-gradient-to-br from-orange-50 to-amber-50 p-5 shadow-xs transition-colors hover:border-orange-300 dark:from-orange-500/10 dark:to-amber-500/5">
                  <div className="flex items-start justify-between">
                    <span className="flex items-center gap-2 text-[15px] font-semibold text-ink"><span className="rounded-lg bg-orange-500/15 p-1.5 text-orange-600"><Flag size={16} /></span>Waiting on you</span>
                    <ArrowRight size={16} className="text-ink-faint transition-transform group-hover:translate-x-0.5" />
                  </div>
                  <div className="mt-3 flex items-end gap-3"><span className="text-[36px] font-bold tabular-nums leading-none text-orange-600">{c.waiting}</span><span className="pb-1 text-body-sm text-ink-muted">lead{c.waiting === 1 ? '' : 's'} flagged by the SDRs, oldest first in the queue</span></div>
                  <p className="mt-3 text-body-sm text-ink-muted">{c.waiting ? 'Each one shows the five facts, the last call and the recording. Decide: meeting, direction or close.' : 'Nothing to decide right now.'}</p>
                </Link>
              )}
              {cmr && !isHead && (
                <div className="rounded-card border border-line bg-gradient-to-br from-orange-50 to-amber-50 p-5 shadow-xs dark:from-orange-500/10 dark:to-amber-500/5">
                  <span className="flex items-center gap-2 text-[15px] font-semibold text-ink"><span className="rounded-lg bg-orange-500/15 p-1.5 text-orange-600"><Sparkles size={16} /></span>The Jesse flow</span>
                  <ol className="mt-3 space-y-1.5 text-body-sm text-ink">
                    <li><b>1.</b> Call, log it, fill the <b>five facts</b>.</li>
                    <li><b>2.</b> <b>Send info</b> (the profile email), follow up in 2 days.</li>
                    <li><b>3.</b> Press <b>Qualify</b> on the lead with one line on what Jesse must decide → it lands in the <Link to="/app/leads/queue" className="font-semibold text-primary hover:underline">Jesse Queue</Link>.</li>
                    <li><b>4.</b> Jesse answers within a business day: meeting, direction or close.</li>
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

/** A big colour card: gradient, icon, the number, one line under it. */
function Hero({ label, value, sub, icon, from, to, onClick }: { label: string; value: number; sub: string; icon: ReactNode; from: string; to: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group relative overflow-hidden rounded-card p-5 text-left text-white shadow-md transition-transform hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70" style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}>
      <span className="pointer-events-none absolute -right-6 -top-6 h-28 w-28 rounded-full bg-white/10" />
      <span className="pointer-events-none absolute -bottom-10 right-8 h-24 w-24 rounded-full bg-white/10" />
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold uppercase tracking-wide text-white/85">{label}</span>
        <span className="rounded-lg bg-white/20 p-1.5">{icon}</span>
      </div>
      <div className="mt-3 text-[36px] font-bold tabular-nums leading-none">{value.toLocaleString()}</div>
      <div className="mt-2 flex items-center justify-between text-[12.5px] text-white/85"><span className="truncate">{sub}</span><ArrowRight size={14} className="shrink-0 opacity-70 transition-transform group-hover:translate-x-0.5" /></div>
    </button>
  )
}

/** A small count pill for the "needs attention" row. */
function Mini({ label, value, color, icon, onClick }: { label: string; value: number; color: string; icon?: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn('inline-flex h-9 items-center gap-2 rounded-full border bg-card pl-3 pr-1.5 text-body-sm font-medium transition-colors hover:border-line-strong', value ? 'border-line text-ink' : 'border-line text-ink-faint')}>
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />{icon}{label}
      <span className="rounded-full px-2 py-0.5 text-[12px] font-bold tabular-nums" style={value ? { background: `${color}1f`, color } : { background: 'transparent' }}>{value}</span>
    </button>
  )
}

function Stat({ n, label, tone }: { n: number; label: string; tone: 'primary' | 'danger' | 'ink' | 'muted' }) {
  return (
    <div className={cn('rounded-btn px-2 py-2', tone === 'danger' ? 'bg-danger/10' : tone === 'primary' ? 'bg-primary/10' : 'bg-slate-50 dark:bg-white/[0.04]')}>
      <div className={cn('text-[22px] font-bold tabular-nums leading-none', tone === 'danger' ? 'text-danger' : tone === 'primary' ? 'text-primary' : tone === 'muted' ? 'text-ink-faint' : 'text-ink')}>{n}</div>
      <div className="mt-1 text-[11px] text-ink-muted">{label}</div>
    </div>
  )
}

function PipelineBar({ d, pipeline }: { d: Dashboard; pipeline: { key: string; label: string; color: string }[] }) {
  const total = pipeline.reduce((a, s) => a + (d.byStatus[s.key] ?? 0), 0)
  if (!total) return <p className="mt-4 text-body-sm text-ink-faint">No leads in this period yet.</p>
  return (
    <div className="mt-4">
      <div className="flex h-3.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/5">
        {pipeline.map((s) => { const n = d.byStatus[s.key] ?? 0; return n ? <span key={s.key} title={`${s.label}: ${n}`} style={{ width: `${(n / total) * 100}%`, background: s.color }} /> : null })}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-ink-muted">
        {pipeline.map((s) => { const n = d.byStatus[s.key] ?? 0; return n ? <span key={s.key} className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label} {Math.round((n / total) * 100)}%</span> : null })}
      </div>
    </div>
  )
}
