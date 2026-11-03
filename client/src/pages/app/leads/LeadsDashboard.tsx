import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, CalendarClock, Flag, Inbox, PhoneCall, Users } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { TextField } from '../../../components/ui/Input'
import { apiErrorText } from '../../../lib/api'
import { cn } from '../../../lib/cn'
import { leadsApi, type Dashboard } from '../../../lib/leadsApi'
import { BusinessPicker, DATE_RANGES, PageHeader, Tile, useBusiness } from './shared'

/** Lead Dashboard: the LeadWise-style tiles, the scheduled tasks bar and the time filter. Every tile opens the list filtered. */
export default function LeadsDashboard() {
  const nav = useNavigate()
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

  const go = (p: Record<string, string>) => nav(`/app/leads?${new URLSearchParams({ ...(bizParam ? { business: bizParam } : {}), ...p }).toString()}`)
  const cmr = business?.kind === 'CMR'
  const pipeline = business?.pipeline ?? []
  const c = d?.cards

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5">
      <PageHeader title="Lead Dashboard" hint={business ? `${business.name}${cmr && !/cmr/i.test(business.name) ? ' · CMR flow' : ''}` : 'All businesses'} actions={<BusinessPicker allowAll />} />

      {/* Scheduled tasks bar */}
      {d && (
        <Link to={`/app/leads/tasks${bizParam ? `?business=${bizParam}` : ''}`} className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-gradient-to-r from-primary/[0.08] to-accent/[0.08] px-5 py-3.5 transition-colors hover:border-primary/40">
          <span className="flex items-center gap-3">
            <span className="rounded-lg bg-primary/15 p-2 text-primary"><CalendarClock size={18} /></span>
            <span><span className="block text-[15px] font-semibold text-ink">Scheduled Tasks</span><span className="block text-body-sm text-ink-muted">{d.tasks.today} due today{d.tasks.overdue ? ` · ${d.tasks.overdue} overdue` : ''}</span></span>
          </span>
          <span className="flex items-center gap-4 text-right">
            <span><span className="block text-[22px] font-bold tabular-nums leading-none text-ink">{d.tasks.total}</span><span className="text-[11px] text-ink-faint">open</span></span>
            {d.tasks.overdue > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-danger/10 px-2.5 py-1 text-body-sm font-semibold text-danger"><AlertTriangle size={13} />{d.tasks.overdue} overdue</span>}
            <Button size="sm" variant="secondary">Open tasks</Button>
          </span>
        </Link>
      )}

      {/* Time filter */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-btn border border-line bg-card p-0.5">
          {DATE_RANGES.map((r) => <button key={r.key} type="button" onClick={() => setRange(r.key)} className={cn('h-8 rounded-md px-3 text-body-sm font-semibold', range === r.key ? 'bg-ink text-card' : 'text-ink-muted hover:text-ink')}>{r.label}</button>)}
        </div>
        {range === 'custom' && <><TextField type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" aria-label="From" /><span className="text-ink-faint">to</span><TextField type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" aria-label="To" /></>}
        {d && <span className="ml-auto text-body-sm text-ink-faint">Showing {d.range.toLowerCase()}</span>}
      </div>

      {err && <p className="rounded-btn bg-danger/10 px-3 py-2 text-body-sm text-danger">{err}</p>}

      {c && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Total Leads" value={c.total} color="#4F46E5" icon={<Inbox size={15} />} onClick={() => go({ status: 'all' })} hint={d.range} />
            <Tile label="New This Week" value={c.newThisWeek} color="#0EA5E9" onClick={() => go({ status: 'all', sort: 'newest' })} hint="Created since Monday" />
            <Tile label="Recently Updated" value={c.recentlyUpdated} color="#14B8A6" onClick={() => go({ status: 'all', sort: 'activity' })} hint="Changed in the last 48 hours" />
            <Tile label="No Status" value={c.noStatus} color="#94A3B8" onClick={() => go({ status: 'NEW' })} hint="New, never called" />
            <Tile label="Assigned" value={c.assigned} color="#8B5CF6" icon={<Users size={15} />} onClick={() => go({ status: 'all' })} />
            <Tile label="Unassigned" value={c.unassigned} color="#F59E0B" onClick={() => go({ assignee: 'none' })} hint="Open, nobody yet" />
            <Tile label="Overdue Next Steps" value={c.overdue} color="#EF4444" icon={<AlertTriangle size={15} />} onClick={() => go({ overdue: '1' })} hint="Next step date has passed" />
            <Tile label="Calls" value={c.calls} color="#059669" icon={<PhoneCall size={15} />} onClick={() => nav(`/app/leads/calls${bizParam ? `?business=${bizParam}` : ''}`)} hint={d.range} />
            {cmr && <Tile label="Waiting on Jesse" value={c.waiting} color="#F97316" icon={<Flag size={15} />} onClick={() => go({ flag: '1' })} hint="Flagged, no decision yet" />}
            {cmr && <Tile label="Below Minimum" value={c.belowMin} color="#A855F7" onClick={() => go({ belowMin: '1' })} hint="Under the load minimum" />}
            {c.late > 0 && <Tile label="Late (SLA)" value={c.late} color="#DC2626" onClick={() => go({ late: '1' })} hint="Not assigned or contacted in time" />}
            <Tile label={cmr ? 'Prohibited / Customer' : 'Do Not Call'} value={c.prohibited} color="#64748B" onClick={() => go({ prohibited: '1', status: 'all' })} hint="On a list" />
          </div>

          <section className="rounded-card border border-line bg-card p-5 shadow-xs">
            <div className="flex items-center justify-between"><h2 className="text-[15px] font-semibold text-ink">Pipeline</h2><span className="text-body-sm text-ink-faint">{all ? 'Statuses across businesses' : business?.name}</span></div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {(pipeline.length ? pipeline : Object.keys(d.byStatus).map((k) => ({ key: k, label: k, color: '#64748B', open: true }))).map((st) => (
                <Tile key={st.key} label={st.label} value={d.byStatus[st.key] ?? 0} color={st.color} onClick={() => go({ status: st.key })} hint={st.open ? 'Open' : 'Closed'} />
              ))}
            </div>
            <PipelineBar d={d} pipeline={pipeline} />
          </section>
        </>
      )}
    </div>
  )
}

function PipelineBar({ d, pipeline }: { d: Dashboard; pipeline: { key: string; label: string; color: string }[] }) {
  const total = pipeline.reduce((a, s) => a + (d.byStatus[s.key] ?? 0), 0)
  if (!total) return null
  return (
    <div className="mt-4">
      <div className="flex h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-white/5">
        {pipeline.map((s) => { const n = d.byStatus[s.key] ?? 0; return n ? <span key={s.key} title={`${s.label}: ${n}`} style={{ width: `${(n / total) * 100}%`, background: s.color }} /> : null })}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-ink-muted">
        {pipeline.map((s) => { const n = d.byStatus[s.key] ?? 0; return n ? <span key={s.key} className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label} {Math.round((n / total) * 100)}%</span> : null })}
      </div>
    </div>
  )
}
