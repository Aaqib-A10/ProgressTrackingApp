import { useMemo, useState } from 'react'
import type { DialerLead, DialerSettings } from '../../../../lib/dialerApi'
import { REGIONS, followUps, lastActivity, leadRegion, leadState, shortDate } from '../../../../lib/dialer'
import { cn } from '../../../../lib/cn'
import { Panel, RegionBadge, StatusPill, LeadActions } from './ui'

/**
 * Follow-up overdue, full view (plan 4c and 6): leads that were reached or showed interest
 * and then went quiet. Bold when due, red when twice as old as the rule. Finished leads
 * (Not Interested, Not Qualified, DNC) and Working On never appear.
 */
export function FollowUpsView({ leads, settings, now, onOpenLead, onChanged, showOwner }: { leads: DialerLead[]; settings: DialerSettings; now: Date; onOpenLead: (id: string) => void; onChanged: () => void; showOwner: boolean }) {
  const all = useMemo(() => followUps(leads, settings, now), [leads, settings, now])
  const [stage, setStage] = useState('')
  const [minDays, setMinDays] = useState(0)
  const [region, setRegion] = useState('')
  const [state, setState] = useState('')
  const [sort, setSort] = useState<'oldest' | 'newest' | 'company'>('oldest')
  const [limit, setLimit] = useState(25)

  const rows = all
    .filter((x) => (!stage || x.lead.status === stage) && x.days >= minDays && (!region || leadRegion(x.lead, now) === region) && (!state || leadState(x.lead) === state))
    .sort((a, b) => (sort === 'company' ? a.lead.company.localeCompare(b.lead.company) : sort === 'newest' ? a.days - b.days : Number(b.callBackDue) - Number(a.callBackDue) || b.days - a.days))
  const states = [...new Set(all.map((x) => leadState(x.lead)).filter(Boolean) as string[])].sort()
  const sel = 'h-8 rounded-full border border-line bg-card px-3 text-body-sm text-ink focus:border-primary focus:outline-none'
  const callBacks = all.filter((x) => x.callBackDue).length

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Object.entries(settings.followUp).map(([status, days]) => (
          <button key={status} type="button" onClick={() => setStage(stage === status ? '' : status)} className={cn('rounded-card border bg-card p-4 text-left', stage === status ? 'border-primary ring-2 ring-primary/20' : 'border-line')}>
            <p className="text-body-sm text-ink-muted">{status === 'Connected' ? 'Connected, no follow-up' : status}</p>
            <p className="text-[28px] font-bold leading-tight tabular-nums text-ink">{all.filter((x) => x.lead.status === status && !x.callBackDue).length}</p>
            <p className="text-body-sm text-ink-muted">{days}-day rule</p>
          </button>
        ))}
        {callBacks > 0 && (
          <div className="rounded-card border border-primary/30 bg-primary/5 p-4">
            <p className="text-body-sm text-ink-muted">Call backs due</p>
            <p className="text-[28px] font-bold leading-tight tabular-nums text-primary">{callBacks}</p>
            <p className="text-body-sm text-ink-muted">Times you set with Call later</p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-body-sm text-ink-muted">Filters</span>
        <select value={stage} onChange={(e) => setStage(e.target.value)} className={sel}><option value="">All stages</option>{Object.keys(settings.followUp).map((s) => <option key={s}>{s}</option>)}</select>
        <select value={minDays} onChange={(e) => setMinDays(Number(e.target.value))} className={sel}>{[0, 7, 14, 30, 60].map((d) => <option key={d} value={d}>{d ? `Overdue ${d}+ days` : 'Any age'}</option>)}</select>
        <select value={state} onChange={(e) => setState(e.target.value)} className={sel}><option value="">All states</option>{states.map((s) => <option key={s}>{s}</option>)}</select>
        <select value={region} onChange={(e) => setRegion(e.target.value)} className={sel}><option value="">All regions</option>{REGIONS.map((r) => <option key={r}>{r}</option>)}</select>
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className={sel}><option value="oldest">Oldest first</option><option value="newest">Newest first</option><option value="company">Company A to Z</option></select>
      </div>

      <Panel title={`${rows.length} lead${rows.length === 1 ? '' : 's'} to follow up`}>
        {rows.length === 0 ? <p className="py-6 text-center text-body-md text-ink-muted">Nothing to follow up. Good work.</p> : (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[1220px] text-left text-body-sm">
              <thead className="text-[11px] uppercase text-ink-muted">
                <tr><th className="px-2 py-2">Lead</th><th className="px-2">State</th><th className="px-2">Region</th><th className="px-2">Industry</th><th className="px-2">Status</th><th className="px-2">Last activity</th><th className="px-2">Overdue</th>{showOwner && <th className="px-2">Rep</th>}<th className="px-2">Actions</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.slice(0, limit).map((x) => (
                  <tr key={x.lead.id} className="hover:bg-slate-50/60">
                    <td className="px-2 py-2.5">
                      <button type="button" onClick={() => onOpenLead(x.lead.id)} className={cn('text-left hover:underline', x.severity === 'late' ? 'font-bold text-danger' : 'font-semibold text-ink')}>{x.lead.company}</button>
                      {x.lead.contactName && <p className="whitespace-nowrap text-ink-muted">{x.lead.contactName}{x.lead.phone ? ` · ${x.lead.phone}` : ''}</p>}
                    </td>
                    <td className="px-2 text-ink">{leadState(x.lead) ?? '—'}{x.lead.verifyZone && !x.lead.zoneOverride && <span className="ml-1 rounded bg-warning/10 px-1 text-[10px] font-semibold text-warning">verify zone</span>}</td>
                    <td className="px-2"><RegionBadge lead={x.lead} now={now} /></td>
                    <td className="px-2 text-ink">{x.lead.industry ?? '—'}</td>
                    <td className="px-2">{x.callBackDue ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">Call back due</span> : <StatusPill lead={x.lead} />}</td>
                    <td className="px-2 text-ink-muted">{shortDate(lastActivity(x.lead))}</td>
                    <td className="whitespace-nowrap px-2"><span className={cn('rounded px-1.5 py-0.5 text-[11px] font-bold', x.severity === 'late' ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning')}>{x.days} days</span></td>
                    {showOwner && <td className="px-2 text-ink-muted">{x.lead.ownerName}</td>}
                    <td className="px-2"><LeadActions lead={x.lead} onDone={onChanged} compact /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > limit && <div className="mt-3 text-center"><button type="button" onClick={() => setLimit((n) => n + 25)} className="rounded-full border border-line px-4 py-1.5 text-body-sm font-semibold text-ink hover:bg-slate-50">Show {Math.min(25, rows.length - limit)} more</button></div>}
        <p className="mt-3 text-[11px] text-ink-muted">
          "No follow-up" is judged from the last activity date in the export (or when the dashboard saw the status change). Not Interested, Not Qualified, DNC and Working On never appear. Snoozes and notes are saved and survive new imports. Call now hides a lead until tomorrow.
        </p>
      </Panel>
    </div>
  )
}
