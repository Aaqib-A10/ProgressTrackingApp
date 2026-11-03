import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BarChart3 } from 'lucide-react'
import { EmptyState } from '../../../components/ui/EmptyState'
import { apiErrorText } from '../../../lib/api'
import { leadsApi, type Summary } from '../../../lib/leadsApi'
import { BusinessPicker, PageHeader, Tile, useBusiness } from './shared'

/** Jesse Summary: the sheet's tab, live — key numbers, pipeline by status, calls by SDR, calls by segment, plus the qualify rate. */
export default function JesseSummary() {
  const nav = useNavigate()
  const { business, businesses } = useBusiness()
  const cmrBiz = businesses.filter((b) => b.kind === 'CMR')
  const biz = business?.kind === 'CMR' ? business : cmrBiz[0] ?? null
  const [d, setD] = useState<Summary | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { if (biz) leadsApi.summary(biz.id).then((r) => { setD(r); setErr('') }).catch((e) => setErr(apiErrorText(e, 'Could not load'))) }, [biz])
  if (!cmrBiz.length) return <div className="mx-auto max-w-xl py-16"><EmptyState icon={<BarChart3 />} title="No CMR business yet" hint="Make one under Lead Settings (kind: CMR)." /></div>
  const go = (p: Record<string, string>) => nav(`/app/leads?${new URLSearchParams({ business: biz?.id ?? '', ...p }).toString()}`)
  const k = d?.keyNumbers
  const max = (xs: number[]) => Math.max(1, ...xs)
  return (
    <div className="mx-auto w-full max-w-[1300px] space-y-4">
      <PageHeader title="Jesse Summary" hint={`${biz?.name ?? ''} · the sheet's Jesse Summary tab, live.`} actions={cmrBiz.length > 1 ? <BusinessPicker /> : undefined} />
      {err && <p className="rounded-btn bg-danger/10 px-3 py-2 text-body-sm text-danger">{err}</p>}
      {k && (
        <>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Tile label="Total companies" value={k.total} color="#4F46E5" onClick={() => go({ status: 'all' })} />
            <Tile label="Waiting on Jesse" value={k.waiting} color="#F97316" onClick={() => go({ flag: '1', status: 'all' })} hint={`avg ${k.avgWaitDays} business days`} />
            <Tile label="Qualified" value={k.qualified} color="#22C55E" onClick={() => go({ status: 'QUALIFIED' })} />
            <Tile label="Follow-ups overdue" value={k.overdue} color="#EF4444" onClick={() => go({ overdue: '1' })} />
            <Tile label="Calls this week" value={k.callsWeek} color="#0EA5E9" onClick={() => nav(`/app/leads/calls?business=${biz?.id}`)} />
            <Tile label="Calls last 30 days" value={k.calls30} color="#14B8A6" onClick={() => nav(`/app/leads/calls?business=${biz?.id}`)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Tile label="Meetings booked this month" value={k.meetingsMonth} color="#8B5CF6" hint="Invites sent" />
            <Tile label="Jesse's decision time" value={`${k.avgDecideDays} d`} color="#64748B" hint="Average business days, last 50 decisions" />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Bars title="Pipeline by status" rows={d!.pipeline.map((p) => ({ label: p.label, n: p.count, color: p.color, onClick: () => go({ status: p.status }) }))} />
            <Bars title="Calls by SDR (30 days)" rows={d!.callsBySdr.map((x) => ({ label: x.name, n: x.calls, color: '#0EA5E9', onClick: x.userId ? () => nav(`/app/leads/calls?business=${biz?.id}&user=${x.userId}`) : undefined }))} empty="No calls in the last 30 days." />
            <Bars title="Companies by segment" rows={d!.bySegment.map((x) => ({ label: x.segment, n: x.count, color: '#14B8A6', onClick: () => go({ status: 'all', industry: x.segment }) }))} />
          </div>
          <section className="rounded-card border border-line bg-card shadow-xs">
            <header className="border-b border-line px-4 py-2.5 text-[14px] font-semibold text-ink">Qualify rate by SDR</header>
            <table className="w-full text-left text-body-sm"><thead className="bg-slate-50 text-[11.5px] uppercase tracking-wide text-ink-muted dark:bg-white/[0.03]"><tr><th className="px-4 py-2 font-semibold">SDR</th><th className="px-4 py-2 text-right font-semibold">Companies</th><th className="px-4 py-2 text-right font-semibold">Qualified or won</th><th className="px-4 py-2 text-right font-semibold">Rate</th></tr></thead>
              <tbody className="divide-y divide-line">{d!.qualifyRate.map((r) => <tr key={r.userId ?? 'none'}><td className="px-4 py-2 font-medium text-ink">{r.name}</td><td className="px-4 py-2 text-right tabular-nums">{r.leads}</td><td className="px-4 py-2 text-right tabular-nums">{r.qualified}</td><td className="px-4 py-2 text-right tabular-nums font-semibold text-ink">{r.rate}%</td></tr>)}{!d!.qualifyRate.length && <tr><td colSpan={4} className="px-4 py-6 text-center text-ink-muted">No leads yet.</td></tr>}</tbody></table>
          </section>
          {void max}
        </>
      )}
    </div>
  )
}

function Bars({ title, rows, empty }: { title: string; rows: { label: string; n: number; color: string; onClick?: () => void }[]; empty?: string }) {
  const top = Math.max(1, ...rows.map((r) => r.n))
  return (
    <section className="rounded-card border border-line bg-card p-4 shadow-xs">
      <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
      <ul className="mt-3 space-y-2">
        {rows.map((r) => (
          <li key={r.label}><button type="button" onClick={r.onClick} disabled={!r.onClick} className="w-full text-left">
            <div className="flex items-center justify-between text-body-sm"><span className="text-ink">{r.label}</span><span className="tabular-nums font-semibold text-ink">{r.n}</span></div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/5"><div className="h-full rounded-full" style={{ width: `${(r.n / top) * 100}%`, background: r.color }} /></div>
          </button></li>
        ))}
        {!rows.length && <li className="text-body-sm text-ink-muted">{empty ?? 'Nothing yet.'}</li>}
      </ul>
    </section>
  )
}
