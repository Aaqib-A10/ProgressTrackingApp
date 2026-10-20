import { useMemo, useState } from 'react'
import { ArrowDown, ArrowRight, ArrowUp, Copy } from 'lucide-react'
import type { DialerData, DialerLead, DialerSettings, RegionCode } from '../../../../lib/dialerApi'
import { REGIONS, REGION_META, STATUS_COLUMNS, fmtSpan, followUpTabs, funnelOf, isDialable, leadRegion, leadState, num, pct, regionWindow, segments, stateTable, usDaylight, type Filters, type StatusColumn, columnOf, type FollowUpDays } from '../../../../lib/dialer'
import { cn } from '../../../../lib/cn'
import { InfoTip, Panel, RegionBadge } from './ui'

/**
 * The rep's dashboard answers one question: who can I call now, and what needs attention.
 * Everything else sits behind a click. Explanations are behind ⓘ; colour only means something
 * (red act now, amber watch, green open or good), and every list shows its top 8 to 10.
 */
export function DashboardView({ data, leads, settings, now, filters, setFilter, onOpenLeads, onOpenLead, go, duplicates, followUpDays }: {
  data: DialerData
  leads: DialerLead[]
  settings: DialerSettings
  now: Date
  filters: Filters
  setFilter: (k: keyof Filters, v: string) => void
  onOpenLeads: (title: string, leads: DialerLead[]) => void
  onOpenLead: (id: string, ids?: string[]) => void
  go: (view: string) => void
  duplicates: number
  followUpDays: FollowUpDays
}) {
  const live = useMemo(() => leads.filter((l) => !l.duplicate), [leads])
  const f = funnelOf(live)
  // Same list as the Follow-ups tab badge: overdue, then call backs due today.
  const fu = useMemo(() => {
    const t = followUpTabs(leads, settings, now, new Date(data.dayStart), new Set(data.actedToday.map((a) => a.leadId)), followUpDays)
    return [...t.overdue, ...t.dueToday.filter((x) => x.callBackDue)]
  }, [leads, settings, now, followUpDays, data.dayStart, data.actedToday])
  const table = useMemo(() => stateTable(leads, settings, now), [leads, settings, now])
  const windows = REGIONS.map((r) => regionWindow(r, settings, now))
  const ready = (r: RegionCode) => live.filter((l) => leadRegion(l, now) === r && isDialable(l, settings, now))
  const prime = (settings.primeTimes ?? []).map((p) => `${fmt12(p.start)} to ${fmt12(p.end)}`).join(' and ')

  return (
    <div className="space-y-4">
      {/* Who can I call right now */}
      <Panel title="Who can I call right now" info={<>Calling hours are 9 AM to 5 PM on the lead's own clock in every region{prime ? <>; prime time is {prime}</> : null}. Each lead's region comes from its state; Arizona follows {usDaylight(now) ? 'Pacific' : 'Mountain'} hours right now. Do-Not-Call, finished, snoozed and duplicate leads are never counted.</>}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {windows.map((w) => {
            const list = ready(w.region)
            const tone = w.open ? (w.closingSoon ? 'amber' : 'green') : 'grey'
            return (
              <button key={w.region} type="button" onClick={() => onOpenLeads(`${REGION_META[w.region].name}: leads to dial`, list)}
                className={cn('rounded-card border p-4 text-left transition-shadow hover:shadow-overlay', tone === 'green' ? 'border-success/40 bg-success/[0.05]' : tone === 'amber' ? 'border-warning/50 bg-warning/[0.06]' : 'border-line bg-card')}>
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-ink">{w.region} · {REGION_META[w.region].name}</span>
                  <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', tone === 'green' ? 'bg-success/15 text-success' : tone === 'amber' ? 'bg-warning/15 text-warning' : 'bg-slate-100 text-ink-muted')}>
                    {w.open ? (w.closingSoon ? `Closes in ${fmtSpan(w.minutesLeft)}` : w.prime ? 'Prime time' : 'Open now') : w.weekend ? 'Weekend' : `Opens in ${fmtSpan(w.minutesUntilOpen)}`}
                  </span>
                </div>
                <p className="mt-2 text-[28px] font-bold leading-none tabular-nums text-ink">{w.localTime}</p>
                <p className="mt-2 text-body-md text-ink"><b className="tabular-nums">{num(list.length)}</b> to dial</p>
              </button>
            )
          })}
        </div>
      </Panel>

      {/* Funnel strip */}
      <Panel title="Funnel" action={<button type="button" onClick={() => go('funnel')} className="inline-flex items-center gap-1 text-body-sm font-semibold text-primary">Open <ArrowRight size={14} /></button>}>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Metric label="Total leads" value={num(f.total)} info="All the leads on your list (duplicates waiting for a manager are not counted)." />
          <Metric label="Attempted+" value={num(f.attempted)} sub={pct(f.attemptRate)} info="Leads tried at least once. The rate is Attempted+ ÷ Total." />
          <Metric label="Connected+" value={num(f.connected)} sub={pct(f.connectRate)} info="Leads where we spoke to the person. Connect rate = Connected+ ÷ Attempted+." />
          <Metric label="Positive" value={num(f.positive)} sub={`${pct(f.winRate)} win`} info="Interested or Pipeline. Win rate = Positive ÷ Connected+; positive rate = Positive ÷ Total." />
        </div>
      </Panel>

      <div className={cn('grid gap-4', duplicates > 0 ? 'lg:grid-cols-[1fr_1fr_280px]' : 'lg:grid-cols-2')}>
        {/* Follow-ups */}
        <Panel title={`Follow-ups due · ${fu.length}`} info={<>Leads reached or interested that then went quiet: {Object.entries(settings.followUp).map(([s, d]) => `${s} after ${d} days`).join(', ')} (your own days in Settings). Red when twice as old.</>} action={fu.length > 0 ? <button type="button" onClick={() => go('followups')} className="text-body-sm font-semibold text-primary">See all</button> : undefined}>
          {fu.length === 0 ? <p className="text-body-sm text-ink-muted">Nothing went quiet.</p> : (
            <ul className="divide-y divide-line">
              {fu.slice(0, 8).map((x) => (
                <li key={x.lead.id}>
                  <button type="button" onClick={() => onOpenLead(x.lead.id, fu.map((y) => y.lead.id))} className="flex w-full items-center justify-between gap-2 py-1.5 text-left">
                    <span className="min-w-0">
                      <span className="block truncate text-body-md font-semibold text-ink">{x.lead.company}</span>
                      <span className="block text-body-sm text-ink-muted">{x.callBackDue ? 'Call back due' : x.lead.status} · {leadState(x.lead) ?? 'No state'}</span>
                    </span>
                    <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold', x.severity === 'late' || x.callBackDue ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning')}>{x.days}d</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <InsightCard data={data} leads={live} settings={settings} now={now} table={table} onOpenLeads={onOpenLeads} onOpenLead={onOpenLead} go={go} />

        {duplicates > 0 && (
          <Panel title="Duplicates" info="Leads found in two reps' files. They are kept out of the counts until a manager decides who keeps each one." action={<button type="button" onClick={() => go('duplicates')} className="text-body-sm font-semibold text-primary">Resolve</button>}>
            <p className="flex items-center gap-2 text-body-md text-ink"><Copy size={16} className="text-danger" /><b className="tabular-nums text-danger">{duplicates}</b> waiting</p>
          </Panel>
        )}
      </div>

      {/* Where leads are sitting */}
      <Panel title="Where leads are sitting" info={<>By state and status. Red: Contact Attempted plus Voicemail Sent are {settings.highlight.redPct}%+ of the state, or one passes {settings.highlight.redCount} leads. Amber: {settings.highlight.amberPct}%+. Those leads were tried but not converted. Click a number to open the leads.</>}>
        {table.length === 0 ? <p className="py-6 text-center text-body-sm text-ink-muted">No leads with a state in this view.</p> : (
          <StateTableView rows={table} settings={settings} leads={live} now={now} onOpenLeads={onOpenLeads} />
        )}
      </Panel>

      <IndustryPanel leads={live} settings={settings} state={filters.state} onPickState={(s) => setFilter('state', s)} onPickIndustry={(i) => setFilter('industry', i)} go={go} />
    </div>
  )
}

const fmt12 = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; const h12 = h % 12 || 12; return m ? `${h12}:${String(m).padStart(2, '0')} ${ap}` : `${h12} ${ap}` }

function Metric({ label, value, sub, info }: { label: string; value: string; sub?: string; info: string }) {
  return (
    <div>
      <p className="flex items-center gap-1 text-body-sm text-ink-muted">{label}<InfoTip>{info}</InfoTip></p>
      <p className="text-[28px] font-bold leading-tight tabular-nums text-ink">{value}</p>
      {sub && <p className="text-body-sm text-ink-muted">{sub}</p>}
    </div>
  )
}

// ------------------------------------------------------------------ switchable card

type Tab = 'due' | 'never' | 'since' | 'closing' | 'best' | 'stuck'
const TABS: { k: Tab; label: string; info: string }[] = [
  { k: 'due', label: 'Due today', info: 'The next call backs you scheduled for today, with times.' },
  { k: 'never', label: 'Never attempted', info: 'Leads still Assigned or New Data, by region: the freshest leads and the easiest first dials.' },
  { k: 'since', label: 'Since last import', info: 'Leads that moved forward or back, and whether the connect rate went up or down.' },
  { k: 'closing', label: 'Closing soon', info: 'A region closing within 60 minutes, with how many leads are left to dial there.' },
  { k: 'best', label: 'Best to push', info: 'Industries and states with a good connect rate and many untouched leads: effort likely to pay off.' },
  { k: 'stuck', label: 'Stuck by state', info: 'States where many leads were tried but not converted (red act now, amber watch).' },
]

function InsightCard({ data, leads, settings, now, table, onOpenLeads, onOpenLead, go }: { data: DialerData; leads: DialerLead[]; settings: DialerSettings; now: Date; table: ReturnType<typeof stateTable>; onOpenLeads: (t: string, l: DialerLead[]) => void; onOpenLead: (id: string, ids?: string[]) => void; go: (v: string) => void }) {
  const [tab, setTabState] = useState<Tab>(() => { try { return (localStorage.getItem('dialer.insight') as Tab) || 'due' } catch { return 'due' } })
  const setTab = (t: Tab) => { setTabState(t); try { localStorage.setItem('dialer.insight', t) } catch { /* ignore */ } }
  const cur = TABS.find((t) => t.k === tab) ?? TABS[0]
  const dayStart = new Date(data.dayStart).getTime()
  return (
    <section className="rounded-card border border-line bg-card p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-1">
        {TABS.map((t) => <button key={t.k} type="button" onClick={() => setTab(t.k)} className={cn('rounded-full px-2.5 py-1 text-[12px] font-semibold', tab === t.k ? 'bg-primary text-white' : 'text-ink-muted hover:bg-slate-100 hover:text-ink')}>{t.label}</button>)}
        <InfoTip className="ml-1">{cur.info}</InfoTip>
      </div>
      {tab === 'due' && (() => {
        const due = leads.filter((l) => l.callLaterAt && new Date(l.callLaterAt).getTime() >= dayStart && new Date(l.callLaterAt).getTime() < dayStart + 86400000).sort((a, b) => (a.callLaterAt! < b.callLaterAt! ? -1 : 1))
        if (!due.length) return <p className="text-body-sm text-ink-muted">No call backs scheduled for today.</p>
        return (
          <>
            <ul className="divide-y divide-line">
              {due.slice(0, 3).map((l) => {
                const at = new Date(l.callLaterAt!)
                const late = at.getTime() <= now.getTime()
                return (
                  <li key={l.id}><button type="button" onClick={() => onOpenLead(l.id, due.map((x) => x.id))} className="flex w-full items-center justify-between gap-2 py-1.5 text-left">
                    <span className="min-w-0 truncate font-semibold text-ink">{l.company}</span>
                    <span className={cn('shrink-0 text-body-sm font-semibold tabular-nums', late ? 'text-danger' : 'text-ink')}>{at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                  </button></li>
                )
              })}
            </ul>
            {due.length > 3 && <button type="button" onClick={() => go('followups')} className="mt-2 text-body-sm font-semibold text-primary">See all {due.length}</button>}
          </>
        )
      })()}
      {tab === 'never' && (() => {
        const never = leads.filter((l) => l.status === 'Assigned' || l.status === 'New Data')
        const groups: [string, DialerLead[]][] = [...REGIONS.map((r) => [r, never.filter((l) => leadRegion(l, now) === r)] as [string, DialerLead[]]), ['No state', never.filter((l) => !leadState(l))]]
        return (
          <>
            <p className="mb-2 text-body-md text-ink"><b className="text-headline-md tabular-nums">{num(never.length)}</b> never attempted</p>
            <div className="grid grid-cols-5 gap-1.5">
              {groups.map(([k, ls]) => (
                <button key={k} type="button" disabled={!ls.length} onClick={() => onOpenLeads(`Never attempted · ${k}`, ls)} className="rounded-btn border border-line px-2 py-1.5 text-center hover:bg-slate-50 disabled:opacity-50">
                  <p className="text-[11px] font-semibold text-ink-muted">{k}</p><p className="text-body-lg font-bold tabular-nums text-ink">{num(ls.length)}</p>
                </button>
              ))}
            </div>
          </>
        )
      })()}
      {tab === 'since' && (() => {
        const s = data.lastImport?.summary
        if (!s) return <p className="text-body-sm text-ink-muted">Import your leads to see what changed.</p>
        const dc = s.funnelBefore && s.funnelNow.connectRate != null && s.funnelBefore.connectRate != null ? s.funnelNow.connectRate - s.funnelBefore.connectRate : null
        return (
          <div className="grid grid-cols-2 gap-3 text-body-sm">
            <Stat label="Moved forward" value={num(s.movedForward)} tone={s.movedForward ? 'green' : undefined} />
            <Stat label="Moved back" value={num(s.movedBack)} tone={s.movedBack ? 'amber' : undefined} />
            <Stat label="New leads" value={num(s.added)} />
            <div><p className="text-ink-muted">Connect rate</p><p className="flex items-center gap-1 text-headline-md font-bold tabular-nums text-ink">{pct(s.funnelNow.connectRate)}{dc != null && dc !== 0 && <span className={cn('inline-flex items-center text-body-sm', dc > 0 ? 'text-success' : 'text-danger')}>{dc > 0 ? <ArrowUp size={13} /> : <ArrowDown size={13} />}{Math.abs(dc * 100).toFixed(1)}</span>}</p></div>
            <button type="button" onClick={() => go('history')} className="col-span-2 text-left text-body-sm font-semibold text-primary">Import details</button>
          </div>
        )
      })()}
      {tab === 'closing' && (() => {
        const ws = REGIONS.map((r) => regionWindow(r, settings, now))
        const closing = ws.filter((w) => w.closingSoon)
        const nextOpen = ws.filter((w) => !w.open && !w.weekend).sort((a, b) => a.minutesUntilOpen - b.minutesUntilOpen)[0]
        const left = (r: RegionCode) => leads.filter((l) => leadRegion(l, now) === r && isDialable(l, settings, now))
        if (!closing.length) return <p className="text-body-sm text-ink-muted">No region closes within the hour.{nextOpen ? ` Next to open: ${REGION_META[nextOpen.region].name} in ${fmtSpan(nextOpen.minutesUntilOpen)}.` : ''}</p>
        return (
          <ul className="space-y-2">
            {closing.map((w) => (
              <li key={w.region}><button type="button" onClick={() => onOpenLeads(`${REGION_META[w.region].name}: leads to dial`, left(w.region))} className="flex w-full items-center justify-between rounded-btn border border-warning/40 bg-warning/5 px-3 py-2 text-left">
                <span className="font-semibold text-ink">{REGION_META[w.region].name} closes in {fmtSpan(w.minutesLeft)}</span>
                <span className="text-body-sm text-ink"><b className="tabular-nums">{num(left(w.region).length)}</b> left</span>
              </button></li>
            ))}
          </ul>
        )
      })()}
      {tab === 'best' && (() => {
        const team = funnelOf(leads).connectRate ?? 0
        const pick = (keyOf: (l: DialerLead) => string | null, kind: string) => segments(leads.filter((l) => keyOf(l)), (l) => keyOf(l)!)
          .filter((sg) => sg.leads.length >= settings.minSegment && (sg.funnel.connectRate ?? 0) >= team)
          .map((sg) => ({ kind, key: sg.key, rate: sg.funnel.connectRate, untouched: sg.leads.filter((l) => l.stage <= 1 && isDialable(l, settings, now)) }))
        const best = [...pick((l) => l.industry, 'Industry'), ...pick((l) => leadState(l), 'State')].filter((b) => b.untouched.length).sort((a, b) => b.untouched.length * (b.rate ?? 0) - a.untouched.length * (a.rate ?? 0)).slice(0, 5)
        if (!best.length) return <p className="text-body-sm text-ink-muted">No group yet has both a good connect rate and untouched leads (groups under {settings.minSegment} leads are left out).</p>
        return (
          <ul className="divide-y divide-line">
            {best.map((b) => (
              <li key={b.kind + b.key}><button type="button" onClick={() => onOpenLeads(`${b.key} · untouched leads`, b.untouched)} className="flex w-full items-center justify-between gap-2 py-1.5 text-left text-body-sm">
                <span className="min-w-0 truncate"><span className="text-ink-muted">{b.kind} </span><b className="text-ink">{b.key}</b></span>
                <span className="shrink-0 text-ink"><span className="font-semibold text-success">{pct(b.rate, 0)}</span> · <b className="tabular-nums">{b.untouched.length}</b> untouched</span>
              </button></li>
            ))}
          </ul>
        )
      })()}
      {tab === 'stuck' && (() => {
        const flagged = table.filter((r) => r.flag).slice(0, 8)
        if (!flagged.length) return <p className="text-body-sm text-ink-muted">No state is stuck right now.</p>
        return (
          <ul className="divide-y divide-line">
            {flagged.map((r) => (
              <li key={r.state}><button type="button" onClick={() => onOpenLeads(`${r.state} · tried, not converted`, leads.filter((l) => leadState(l) === r.state && (l.status === 'Contact Attempted' || l.status === 'Voicemail Sent')))} className="flex w-full items-center justify-between gap-2 py-1.5 text-left text-body-sm">
                <span className="font-semibold text-ink">{r.state}</span>
                <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-bold', r.flag === 'red' ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning')}>{r.stuck} stuck · {Math.round(r.stuckShare * 100)}%</span>
              </button></li>
            ))}
          </ul>
        )
      })()}
    </section>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'amber' }) {
  return <div><p className="text-ink-muted">{label}</p><p className={cn('text-headline-md font-bold tabular-nums', tone === 'green' ? 'text-success' : tone === 'amber' ? 'text-warning' : 'text-ink')}>{value}</p></div>
}

// ------------------------------------------------------------------ state table (top 10)

function StateTableView({ rows, settings, leads, now, onOpenLeads }: { rows: ReturnType<typeof stateTable>; settings: DialerSettings; leads: DialerLead[]; now: Date; onOpenLeads: (t: string, l: DialerLead[]) => void }) {
  const [all, setAll] = useState(false)
  const shown = all ? rows : rows.slice(0, 10)
  const open = (state: string, col: StatusColumn | null, label: string) =>
    onOpenLeads(`${state} · ${label}`, leads.filter((l) => leadState(l) === state && (col == null || columnOf(l, settings) === col)))
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
            <th className="px-1.5 text-right">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {shown.map((r) => (
            <tr key={r.state} className="hover:bg-slate-50/60">
              <td className="px-2 py-2 font-semibold text-ink">
                <span className="inline-flex items-center gap-1.5">{r.flag && <span className={cn('h-2 w-2 rounded-full', r.flag === 'red' ? 'bg-danger' : 'bg-warning')} title={`${Math.round(r.stuckShare * 100)}% tried, not converted`} />}{r.state}</span>
              </td>
              <td className="px-1"><RegionBadge region={r.region} now={now} /></td>
              {STATUS_COLUMNS.map((c) => (
                <td key={c.key} className={cn('px-1.5 text-right tabular-nums', cellTone(r, c.key))}>
                  {r.cells[c.key] ? <button type="button" onClick={() => open(r.state, c.key, c.label)} className="hover:underline">{r.cells[c.key]}</button> : <span className="text-ink-muted/40">0</span>}
                </td>
              ))}
              <td className="px-1.5 text-right font-bold tabular-nums text-ink"><button type="button" onClick={() => open(r.state, null, 'all leads')} className="hover:underline">{r.total}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 10 && <div className="pt-3 text-center"><button type="button" onClick={() => setAll((v) => !v)} className="text-body-sm font-semibold text-primary">{all ? 'Show the top 10' : `See all ${rows.length} states`}</button></div>}
    </div>
  )
}

function IndustryPanel({ leads, settings, state, onPickState, onPickIndustry, go }: { leads: DialerLead[]; settings: DialerSettings; state: string; onPickState: (s: string) => void; onPickIndustry: (i: string) => void; go: (v: string) => void }) {
  const inds = segments(leads, (l) => l.industry ?? '(no industry)').slice(0, 8)
  const states = state ? [] : segments(leads.filter((l) => leadState(l)), (l) => leadState(l)!).slice(0, 8)
  const max = Math.max(1, ...inds.map((s) => s.leads.length))
  const maxS = Math.max(1, ...states.map((s) => s.leads.length))
  return (
    <Panel
      title={state ? `${state} · by industry` : 'Leads by industry and state'}
      info={`Top 8 by leads. Click an industry or a state to filter the dashboard. Positive rate shows n/a for groups under ${settings.minSegment} leads.`}
      action={<button type="button" onClick={() => go('industries')} className="inline-flex items-center gap-1 text-body-sm font-semibold text-primary">See all <ArrowRight size={14} /></button>}
    >
      <div className={cn('grid gap-6', !state && 'lg:grid-cols-2')}>
        <ul className="space-y-2">
          {inds.map((s) => (
            <li key={s.key}>
              <button type="button" onClick={() => onPickIndustry(s.key)} className="grid w-full grid-cols-[150px_minmax(0,1fr)_110px] items-center gap-3 text-left text-body-sm sm:grid-cols-[180px_minmax(0,1fr)_130px]">
                <span className="truncate text-ink">{s.key}</span>
                <span className="h-2 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-slate-400" style={{ width: `${(s.leads.length / max) * 100}%` }} /></span>
                <span className="text-right text-ink-muted"><b className="text-ink">{s.leads.length}</b> · {s.leads.length < settings.minSegment ? 'n/a' : `${pct(s.funnel.positiveRate, 0)} pos.`}</span>
              </button>
            </li>
          ))}
          {inds.length === 0 && <li className="text-body-sm text-ink-muted">No leads in this view.</li>}
        </ul>
        {!state && states.length > 0 && (
          <ul className="space-y-2">
            {states.map((s) => (
              <li key={s.key}>
                <button type="button" onClick={() => onPickState(s.key)} className="grid w-full grid-cols-[130px_minmax(0,1fr)_50px] items-center gap-3 text-left text-body-sm">
                  <span className="truncate text-ink">{s.key}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-slate-400" style={{ width: `${(s.leads.length / maxS) * 100}%` }} /></span>
                  <span className="text-right font-semibold text-ink">{s.leads.length}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  )
}
