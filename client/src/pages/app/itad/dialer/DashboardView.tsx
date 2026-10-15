import { useMemo, useState } from 'react'
import { ArrowRight, Copy, MapPinOff } from 'lucide-react'
import type { DialerLead, DialerSettings, RegionCode } from '../../../../lib/dialerApi'
import { REGIONS, REGION_META, STATUS_COLUMNS, fmtSpan, followUps, funnelOf, isDialable, leadRegion, leadState, num, pct, regionWindow, segments, stateTable, usDaylight, type Filters, type StatusColumn, columnOf } from '../../../../lib/dialer'
import { cn } from '../../../../lib/cn'
import { Panel, RegionBadge } from './ui'

/**
 * The rep's dashboard (plan section 4): who can I call right now, the funnel, where leads are
 * sitting by state and status, follow-ups that went quiet, leads with no state, and the
 * industries of the picked state.
 */
export function DashboardView({ leads, allLeads, settings, now, filters, setFilter, onOpenLeads, onOpenLead, go, duplicates }: {
  leads: DialerLead[]
  allLeads: DialerLead[]
  settings: DialerSettings
  now: Date
  filters: Filters
  setFilter: (k: keyof Filters, v: string) => void
  onOpenLeads: (title: string, leads: DialerLead[]) => void
  onOpenLead: (id: string) => void
  go: (view: string) => void
  duplicates: number
}) {
  const f = funnelOf(leads.filter((l) => !l.duplicate))
  const fu = useMemo(() => followUps(leads, settings, now), [leads, settings, now])
  const table = useMemo(() => stateTable(leads, settings, now), [leads, settings, now])
  const noState = allLeads.filter((l) => !leadState(l) && !l.duplicate)
  const noStateOpen = noState.filter((l) => !l.sentToLeadGen)
  const windows = REGIONS.map((r) => regionWindow(r, settings, now))
  const ready = (r: RegionCode) => leads.filter((l) => leadRegion(l, now) === r && isDialable(l, settings, now))
  const openNow = windows.filter((w) => w.open).map((w) => REGION_META[w.region].name)

  return (
    <div className="space-y-4">
      {/* a) Who can I call right now */}
      <Panel title="Who can I call right now">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {windows.map((w) => {
            const list = ready(w.region)
            return (
              <button
                key={w.region}
                type="button"
                onClick={() => onOpenLeads(`${REGION_META[w.region].name}: leads to dial`, list)}
                className={cn('rounded-card border p-4 text-left transition-shadow hover:shadow-overlay', w.open ? 'border-[#0F766E]/40 bg-[#0F766E]/[0.06]' : 'border-line bg-card')}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={cn('rounded px-2 py-0.5 text-[11px] font-bold', REGION_META[w.region].tone)}>{w.region}</span>
                  <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', w.open ? 'bg-[#0F766E]/15 text-[#0F766E]' : 'bg-slate-100 text-ink-muted')}>
                    {w.open ? 'Open now' : w.weekend ? 'Weekend · opens Monday' : `Opens in ${fmtSpan(w.minutesUntilOpen)}`}
                  </span>
                </div>
                <p className="mt-2 text-[28px] font-bold leading-none tabular-nums text-ink">{w.localTime}</p>
                <p className="mt-1 text-body-sm text-ink-muted">
                  {REGION_META[w.region].name} · {w.open ? `${fmtSpan(w.minutesLeft)} left in slot` : `slot ${w.pktSlot} PKT`}
                </p>
                <p className="mt-2 text-body-md text-ink"><b className="tabular-nums">{num(list.length)}</b> leads to dial</p>
                {settings.peak[w.region] && <p className="mt-0.5 text-[11px] text-ink-muted">Best hours: {settings.peak[w.region]}</p>}
              </button>
            )
          })}
        </div>
        <p className="mt-3 text-body-sm text-ink-muted">
          {openNow.length ? `Open now: ${openNow.join(' and ')}.` : 'No region is open right now.'}{' '}
          Arizona leads follow {usDaylight(now) ? 'Pacific' : 'Mountain'} hours right now ({usDaylight(now) ? 'US summer' : 'US winter'}), handled automatically. Each lead's region comes from its state. Do-Not-Call, finished and snoozed leads are never counted.
        </p>
      </Panel>

      {/* Funnel strip */}
      <button type="button" onClick={() => go('funnel')} className="block w-full text-left">
        <Panel title="Funnel" action={<span className="inline-flex items-center gap-1 text-body-sm font-semibold text-primary">Open full view <ArrowRight size={14} /></span>}>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Metric label="Total leads" value={num(f.total)} />
            <Metric label="Attempted+" value={num(f.attempted)} sub={`Attempt rate ${pct(f.attemptRate)}`} />
            <Metric label="Connected+" value={num(f.connected)} sub={`Connect rate ${pct(f.connectRate)}`} />
            <Metric label="Positive" value={num(f.positive)} sub={`Win rate ${pct(f.winRate)} · Positive rate ${pct(f.positiveRate)}`} />
          </div>
          <p className="mt-3 text-body-sm text-ink-muted"><b className="text-ink">Connect rate</b>: of the leads we tried, how many we reached. <b className="text-ink">Win rate</b>: of the people we spoke to, how many turned positive. <b className="text-ink">Positive rate</b>: of all leads, how many turned positive.</p>
        </Panel>
      </button>

      <div className={cn('grid gap-4', duplicates > 0 ? 'lg:grid-cols-3' : 'lg:grid-cols-2')}>
          {/* c) Follow-up overdue */}
          <Panel title={`Follow-up overdue · ${fu.length ? `top ${Math.min(3, fu.length)} of ${fu.length}` : 'none'}`} action={fu.length > 0 ? <button type="button" onClick={() => go('followups')} className="text-body-sm font-semibold text-primary">See all</button> : undefined}>
            {fu.length === 0 ? <p className="text-body-sm text-ink-muted">Nothing went quiet. Leads that were reached or interested and then left alone show up here.</p> : (
              <ul className="space-y-2.5">
                {fu.slice(0, 3).map((x) => (
                  <li key={x.lead.id}>
                    <button type="button" onClick={() => onOpenLead(x.lead.id)} className="flex w-full items-start justify-between gap-2 text-left">
                      <span className="min-w-0">
                        <span className={cn('block truncate text-body-md text-ink', x.severity === 'late' ? 'font-bold text-danger' : 'font-semibold')}>{x.lead.company}</span>
                        <span className="block text-body-sm text-ink-muted">{x.callBackDue ? 'Call back due' : x.lead.status} · {leadState(x.lead) ?? 'No state'}</span>
                      </span>
                      <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold', x.severity === 'late' ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning')}>{x.days} days</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[11px] text-ink-muted">Rules: {Object.entries(settings.followUp).map(([s, d]) => `${s} ${d} days`).join(' · ')}. Per lead: Call now, Call later, Snooze, Log note.</p>
          </Panel>

          {/* d) Fix data */}
          <Panel title="Fix data" action={noState.length > 0 ? <button type="button" onClick={() => go('fix')} className="text-body-sm font-semibold text-primary">Review</button> : undefined}>
            {noState.length === 0 ? <p className="text-body-sm text-ink-muted">Every lead has a state. Nothing to fix.</p> : (
              <>
                <p className="flex items-center gap-2 text-body-md text-ink"><MapPinOff size={16} className="text-warning" /><b className="text-headline-md tabular-nums">{noStateOpen.length}</b> leads with no state</p>
                {noState.length > noStateOpen.length && <p className="text-body-sm text-ink-muted">{noState.length - noStateOpen.length} more sent back to lead gen.</p>}
                <p className="mt-1 text-body-sm text-ink-muted">Left out of the region counts and the state table. Add the state (one is suggested from the phone area code when possible); if unknown, send it back to lead gen. Clears at zero.</p>
              </>
            )}
          </Panel>

          {duplicates > 0 && (
            <Panel title="Duplicates" action={<button type="button" onClick={() => go('duplicates')} className="text-body-sm font-semibold text-primary">Resolve</button>}>
              <p className="flex items-center gap-2 text-body-md text-ink"><Copy size={16} className="text-danger" /><b className="tabular-nums">{duplicates}</b> lead{duplicates === 1 ? '' : 's'} in two reps' files</p>
              <p className="mt-1 text-body-sm text-ink-muted">Kept out of the counts until a manager decides who keeps each one.</p>
            </Panel>
          )}
      </div>

      {/* b) Where leads are sitting */}
      <Panel title="Where leads are sitting · by state and status">
          {table.length === 0 ? <p className="py-6 text-center text-body-sm text-ink-muted">No leads with a state in this view.</p> : (
            <StateTableView rows={table} settings={settings} leads={leads} now={now} onOpenLeads={onOpenLeads} />
          )}
          <p className="mt-3 text-body-sm text-ink-muted">
            <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-danger/30 align-middle" />Red: Contact Attempted plus Voicemail Sent are {settings.highlight.redPct}%+ of the state, or one of them passes {settings.highlight.redCount} leads.{' '}
            <span className="mx-1 inline-block h-2.5 w-2.5 rounded-sm bg-warning/30 align-middle" />Amber: {settings.highlight.amberPct}%+. These leads were tried but not converted: push them. Click a number to open those leads.
          </p>
        </Panel>


      {/* e) Industries of the picked state, or all states */}
      <IndustryPanel leads={leads} settings={settings} state={filters.state} onPickState={(s) => setFilter('state', s)} onPickIndustry={(i) => setFilter('industry', i)} go={go} />
    </div>
  )
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-body-sm text-ink-muted">{label}</p>
      <p className="text-[28px] font-bold leading-tight tabular-nums text-ink">{value}</p>
      {sub && <p className="text-body-sm text-ink-muted">{sub}</p>}
    </div>
  )
}

function StateTableView({ rows, settings, leads, now, onOpenLeads }: { rows: ReturnType<typeof stateTable>; settings: DialerSettings; leads: DialerLead[]; now: Date; onOpenLeads: (t: string, l: DialerLead[]) => void }) {
  const [all, setAll] = useState(false)
  const shown = all ? rows : rows.slice(0, 12)
  const open = (state: string, col: StatusColumn | null, label: string) =>
    onOpenLeads(`${state} · ${label}`, leads.filter((l) => leadState(l) === state && !l.duplicate && (col == null || columnOf(l, settings) === col)))
  const cellTone = (r: (typeof rows)[number], col: StatusColumn) => {
    if ((col !== 'attempted' && col !== 'voicemail') || !r.cells[col]) return ''
    if (r.flag === 'red' || r.cells[col] > settings.highlight.redCount) return 'bg-danger/10 font-bold text-danger'
    if (r.flag === 'amber') return 'bg-warning/10 font-semibold text-warning'
    return ''
  }
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[820px] text-left text-body-sm">
        <thead className="text-[11px] uppercase text-ink-muted">
          <tr>
            <th className="px-2 py-2">State</th><th className="px-1">Region</th>
            {STATUS_COLUMNS.map((c) => <th key={c.key} className="px-1.5 text-right leading-tight">{c.label}</th>)}
            <th className="px-1.5 text-right">Total</th><th className="px-2">Flag</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {shown.map((r) => (
            <tr key={r.state} className="hover:bg-slate-50/60">
              <td className="px-2 py-2 font-semibold text-ink">{r.state}</td>
              <td className="px-1"><RegionBadge region={r.region} now={now} /></td>
              {STATUS_COLUMNS.map((c) => (
                <td key={c.key} className={cn('px-1.5 text-right tabular-nums', cellTone(r, c.key))}>
                  {r.cells[c.key] ? <button type="button" onClick={() => open(r.state, c.key, c.label)} className="hover:underline">{r.cells[c.key]}</button> : <span className="text-ink-muted/50">0</span>}
                </td>
              ))}
              <td className="px-1.5 text-right font-bold tabular-nums text-ink"><button type="button" onClick={() => open(r.state, null, 'all leads')} className="hover:underline">{r.total}</button></td>
              <td className="px-2">
                {r.flag === 'red' && <span className="whitespace-nowrap rounded bg-danger/10 px-1.5 py-0.5 text-[11px] font-bold text-danger" title={`${Math.round(r.stuckShare * 100)}% still waiting on a first conversation`}>Push to convert</span>}
                {r.flag === 'amber' && <span className="rounded bg-warning/10 px-1.5 py-0.5 text-[11px] font-bold text-warning" title={`${Math.round(r.stuckShare * 100)}% tried, not converted`}>Watch</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 12 && (
        <div className="pt-3 text-center">
          <button type="button" onClick={() => setAll((v) => !v)} className="rounded-full border border-line px-4 py-1.5 text-body-sm font-semibold text-ink hover:bg-slate-50">{all ? 'Show the top 12' : `Show all ${rows.length} states`}</button>
        </div>
      )}
    </div>
  )
}

function IndustryPanel({ leads, settings, state, onPickState, onPickIndustry, go }: { leads: DialerLead[]; settings: DialerSettings; state: string; onPickState: (s: string) => void; onPickIndustry: (i: string) => void; go: (v: string) => void }) {
  const live = leads.filter((l) => !l.duplicate)
  const inds = segments(live, (l) => l.industry ?? '(no industry)').slice(0, 8)
  const states = state ? [] : segments(live.filter((l) => leadState(l)), (l) => leadState(l)!).slice(0, 8)
  const max = Math.max(1, ...inds.map((s) => s.leads.length))
  const maxS = Math.max(1, ...states.map((s) => s.leads.length))
  return (
    <Panel
      title={state ? `${state} · leads by industry` : 'All states · leads by industry'}
      action={<button type="button" onClick={() => go('industries')} className="inline-flex items-center gap-1 text-body-sm font-semibold text-primary">Industry funnel <ArrowRight size={14} /></button>}
    >
      <div className={cn('grid gap-6', !state && 'lg:grid-cols-2')}>
        <ul className="space-y-2">
          {inds.map((s) => (
            <li key={s.key}>
              <button type="button" onClick={() => onPickIndustry(s.key)} className="grid w-full grid-cols-[150px_minmax(0,1fr)_120px] items-center gap-3 text-left text-body-sm sm:grid-cols-[180px_minmax(0,1fr)_140px]">
                <span className="truncate text-ink">{s.key}</span>
                <span className="h-2.5 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-[#0F766E]" style={{ width: `${(s.leads.length / max) * 100}%` }} /></span>
                <span className="text-right text-ink-muted"><b className="text-ink">{s.leads.length}</b> leads · {s.leads.length < settings.minSegment ? 'n/a' : `${pct(s.funnel.positiveRate, 0)} pos.`}</span>
              </button>
            </li>
          ))}
          {inds.length === 0 && <li className="text-body-sm text-ink-muted">No leads in this view.</li>}
        </ul>
        {!state && states.length > 0 && (
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase text-ink-muted">States with the most leads · click to drill in</p>
            <ul className="space-y-2">
              {states.map((s) => (
                <li key={s.key}>
                  <button type="button" onClick={() => onPickState(s.key)} className="grid w-full grid-cols-[130px_minmax(0,1fr)_60px] items-center gap-3 text-left text-body-sm">
                    <span className="truncate text-ink">{s.key}</span>
                    <span className="h-2.5 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-[#1E3A5F]" style={{ width: `${(s.leads.length / maxS) * 100}%` }} /></span>
                    <span className="text-right font-semibold text-ink">{s.leads.length}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <p className="mt-3 text-[11px] text-ink-muted">Positive rate is shown as n/a for groups under {settings.minSegment} leads, so small samples don't mislead.</p>
    </Panel>
  )
}
