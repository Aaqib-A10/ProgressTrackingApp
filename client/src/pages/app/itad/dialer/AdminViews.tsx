import { CHART } from '../../../../components/charts/chartTheme'
import { PredictiveDialer } from './PredictiveDialer'
import { useEffect, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts'
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react'
import { Button } from '../../../../components/ui/Button'
import { useToast } from '../../../../components/ui/Toast'
import { dialerApi, type DialerSettings, type DuplicateGroup, type ImportRecord, type RegionCode } from '../../../../lib/dialerApi'
import { REGIONS, REGION_META, num, pct } from '../../../../lib/dialer'
import { cn } from '../../../../lib/cn'
import { InfoTip, Pager, Panel, errMsg, usePaged } from './ui'
import { ImportSummaryView } from './ImportSummaryView'

/** History (funnel history + every import's summary), Duplicates (manager) and Settings. */

export function HistoryView({ rep, refreshKey, onOpenLeads }: { rep: string; refreshKey: string; onOpenLeads: (title: string, ids: string[], fallback: { id: string; company: string }[]) => void }) {
  const { addToast } = useToast()
  const [rows, setRows] = useState<ImportRecord[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [showChart, setShowChart] = useState(true)
  useEffect(() => { dialerApi.imports(rep).then((r) => { setRows(r.imports); setOpen(r.imports[0]?.id ?? null) }).catch(() => setRows([])) }, [rep, refreshKey])
  const p = usePaged(rows ?? [], 25)
  if (!rows) return <div className="h-40 animate-pulse rounded-card bg-slate-100" />
  if (rows.length === 0) return <Panel><p className="py-6 text-center text-body-md text-ink-muted">No imports yet. Import your CRM export to start the history.</p></Panel>
  const crm = rows.filter((r) => (r.summary.listName ?? 'CRM') === 'CRM')
  const rate = (v: number | null) => (v != null ? +(v * 100).toFixed(1) : null)
  const chart = [...crm].reverse().map((r) => ({
    at: new Date(r.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
    'Attempt rate': rate(r.funnel.attemptRate), 'Connect rate': rate(r.funnel.connectRate), 'Win rate': rate(r.funnel.winRate), 'Positive rate': rate(r.funnel.positiveRate),
  }))
  const few = crm.length < 5
  async function openChange(id: string, from: string, to: string) {
    try {
      const r = await dialerApi.importChanges(id, from, to)
      onOpenLeads(`${from} → ${to}`, r.leads.map((x) => x.leadId), r.leads.map((x) => ({ id: x.leadId, company: x.company })))
    } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not open those leads') }) }
  }
  const LINES: [string, string][] = [['Attempt rate', '#94A3B8'], ['Connect rate', '#4F46E5'], ['Win rate', '#22C55E'], ['Positive rate', '#F59E0B']]
  return (
    <div className="space-y-4">
      <Panel title="Rates after each import" info="The four funnel rates in %, one point per import of your CRM export (other lists are left out). Until there are about five imports a table is clearer than a chart. Import at the start of every shift for the finest history."
        action={!few ? <button type="button" onClick={() => setShowChart((v) => !v)} className="text-body-sm font-semibold text-primary">{showChart ? 'Show as table' : 'Show as chart'}</button> : undefined}>
        {few || !showChart ? (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-body-sm">
              <thead className="text-[11px] uppercase text-ink-muted"><tr><th className="px-2 py-1.5">Import</th><th className="px-2 text-right">Leads</th>{LINES.map(([k]) => <th key={k} className="px-2 text-right">{k}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {crm.map((r, i) => {
                  const prev = crm[i + 1]
                  return (
                    <tr key={r.id}>
                      <td className="px-2 py-1.5 text-ink">{new Date(r.createdAt).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                      <td className="px-2 text-right tabular-nums text-ink">{num(r.funnel.total)}</td>
                      {(['attemptRate', 'connectRate', 'winRate', 'positiveRate'] as const).map((k) => {
                        const d = prev && r.funnel[k] != null && prev.funnel[k] != null ? r.funnel[k]! - prev.funnel[k]! : null
                        return <td key={k} className="px-2 text-right tabular-nums text-ink">{pct(r.funnel[k])}{d != null && Math.abs(d) >= 0.0005 && <span className={cn('ml-1 text-[11px]', d > 0 ? 'text-success' : 'text-danger')}>{d > 0 ? '+' : ''}{(d * 100).toFixed(1)}</span>}</td>
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {few && <p className="mt-2 text-[11px] text-ink-muted">A chart appears from the fifth import.</p>}
          </div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="at" tick={{ fontSize: 11, fill: CHART.axis }} />
                <YAxis unit="%" domain={[0, 'auto']} tick={{ fontSize: 11, fill: CHART.axis }} />
                <Tooltip formatter={(v: number) => `${v}%`} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {LINES.map(([k, c]) => <Line key={k} type="monotone" dataKey={k} stroke={c} strokeWidth={2} dot={{ r: 4, strokeWidth: 0, fill: c }} activeDot={{ r: 6 }} connectNulls />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>
      <Panel title={`Imports · ${rows.length}`} info="Every import is kept with its summary. Click a status change to see the leads behind it.">
        <ul className="divide-y divide-line">
          {p.rows.map((r) => (
            <li key={r.id} className="py-2">
              <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 text-left text-body-sm">
                {open === r.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <b className="text-ink">{new Date(r.createdAt).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</b>
                <span className="text-ink-muted">{r.user.name} · {r.fileName}{(r.summary.listName ?? 'CRM') !== 'CRM' ? ` · ${r.summary.listName}` : ''}</span>
                <span className="text-ink">{num(r.summary.leads)} leads · +{r.summary.added} new · {r.summary.movedForward} forward</span>
                <span className="ml-auto text-ink-muted">Connect {pct(r.funnel.connectRate)} · Win {pct(r.funnel.winRate)}</span>
              </button>
              {open === r.id && <div className="mt-3"><ImportSummaryView s={r.summary} onOpenChange={(from, to) => openChange(r.id, from, to)} /></div>}
            </li>
          ))}
        </ul>
        <Pager p={p} />
      </Panel>
    </div>
  )
}

export function DuplicatesView({ onChanged }: { onChanged: () => void }) {
  const { addToast } = useToast()
  const [rows, setRows] = useState<DuplicateGroup[] | null>(null)
  const pd = usePaged(rows ?? [])
  const load = () => { dialerApi.duplicates().then((r) => setRows(r.duplicates)).catch(() => setRows([])) }
  useEffect(load, [])
  async function keep(g: DuplicateGroup, ownerId: string, name: string) {
    try { await dialerApi.resolveDuplicate(g.matchKey, ownerId); addToast({ type: 'success', message: `${g.company} stays with ${name}.` }); load(); onChanged() } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not save') }) }
  }
  if (!rows) return <div className="h-40 animate-pulse rounded-card bg-slate-100" />
  return (
    <Panel title={`Same lead in two reps' files · ${rows.length}`}>
      {rows.length === 0 ? <p className="py-6 text-center text-body-md text-success">No duplicates. Every lead has one owner.</p> : (
        <ul className="divide-y divide-line">
          {pd.rows.map((g) => (
            <li key={g.matchKey} className="py-3">
              <p className="text-body-md font-semibold text-ink">{g.company}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {g.holders.map((h) => (
                  <div key={h.leadId} className="flex items-center gap-3 rounded-btn border border-line px-3 py-2 text-body-sm">
                    <span><b className="text-ink">{h.ownerName}</b> <span className="text-ink-muted">· {h.status}{h.state ? ` · ${h.state}` : ''} · {h.first ? 'had it first' : `added ${new Date(h.since).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}</span></span>
                    <Button size="sm" onClick={() => keep(g, h.ownerId, h.ownerName)}>Keep with {h.ownerName.split(' ')[0]}</Button>
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pager p={pd} />
      <p className="mt-3 text-[11px] text-ink-muted">The other reps' copies are hidden from their counts and stay hidden on later imports. Also reassign the lead in the CRM so the exports agree.</p>
    </Panel>
  )
}

const inp = 'h-9 rounded-btn border border-line bg-card px-2 text-body-sm text-ink focus:border-primary focus:outline-none disabled:bg-slate-50'

/** Each rep's own follow-up days (within 3 to 60), with "reset to default". */
function MyFollowUpDays({ defaults, onSaved }: { defaults: Record<string, number>; onSaved: () => void }) {
  const { addToast } = useToast()
  const [mine, setMine] = useState<Record<string, number> | null>(null)
  const [limits, setLimits] = useState({ min: 3, max: 60 })
  const [busy, setBusy] = useState(false)
  useEffect(() => { dialerApi.prefs().then((r) => { setMine(r.prefs.followUp); setLimits(r.limits) }).catch(() => setMine({})) }, [])
  if (!mine) return null
  const statuses = Object.keys(defaults)
  async function save(next: Record<string, number>, msg: string) {
    setBusy(true)
    try { const r = await dialerApi.savePrefs({ followUp: next }); setMine(r.prefs.followUp); addToast({ type: 'success', message: msg }); onSaved() } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not save') }) } finally { setBusy(false) }
  }
  const bad = Object.values(mine).some((d) => d < limits.min || d > limits.max || !Number.isFinite(d))
  return (
    <Panel title="My follow-up alert days" info={`Your own alert days, ${limits.min} to ${limits.max}. They only change your follow-up list; the company default is shown beside each.`}>
      <div className="space-y-2">
        {statuses.map((st) => (
          <div key={st} className="flex items-center gap-2 text-body-sm">
            <span className="w-32 text-ink">{st}</span>
            <input type="number" min={limits.min} max={limits.max} value={mine[st] ?? defaults[st]} onChange={(e) => setMine({ ...mine, [st]: Number(e.target.value) })} className={cn(inp, 'w-20', mine[st] != null && mine[st] !== defaults[st] && 'border-primary font-semibold')} />
            <span className="text-ink-muted">days · default {defaults[st]}</span>
          </div>
        ))}
      </div>
      {bad && <p className="mt-2 text-body-sm text-danger">Pick {limits.min} to {limits.max} days.</p>}
      <div className="mt-3 flex gap-2">
        <Button size="sm" disabled={busy || bad} onClick={() => save(Object.fromEntries(Object.entries(mine).filter(([k, v]) => v !== defaults[k])), 'Your follow-up days are saved.')}>Save mine</Button>
        <Button size="sm" variant="secondary" leadingIcon={<RotateCcw size={13} />} disabled={busy || !Object.keys(mine).length} onClick={() => save({}, 'Back to the default days.')}>Reset to default</Button>
      </div>
    </Panel>
  )
}

export function SettingsView({ canEdit, onSaved, extraStatuses }: { canEdit: boolean; onSaved: () => void; extraStatuses: string[] }) {
  const { addToast } = useToast()
  const [s, setS] = useState<DialerSettings | null>(null)
  const [defaults, setDefaults] = useState<DialerSettings | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { dialerApi.settings().then((r) => { setS(r.settings); setDefaults(r.defaults) }).catch(() => {}) }, [])
  if (!s || !defaults) return <div className="h-40 animate-pulse rounded-card bg-slate-100" />
  const statuses = [...new Set([...Object.keys(s.stageMap), ...extraStatuses])]
  const set = <K extends keyof DialerSettings>(k: K, v: DialerSettings[K]) => setS({ ...s, [k]: v })
  async function save() {
    setBusy(true)
    try { const r = await dialerApi.saveSettings(s!); addToast({ type: 'success', message: r.restaged ? `Saved. ${r.restaged} leads moved to their new stage.` : 'Saved.' }); onSaved() } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not save the settings') }) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-4">
      <MyFollowUpDays defaults={s.followUp} onSaved={onSaved} />
      {canEdit && <PredictiveDialer />}
      <h2 className="flex items-center gap-1.5 pt-2 text-label-md uppercase tracking-wide text-ink-muted">Company settings<InfoTip>{canEdit ? 'These change everyone\'s numbers.' : 'Only an ITAD Team Lead or Super Admin can change these. You can see how the numbers are worked out.'}</InfoTip></h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Stage of each status (changes everyone's numbers)">
          <table className="w-full text-body-sm">
            <thead className="text-[11px] uppercase text-ink-muted"><tr><th className="py-1 text-left">Status</th><th className="text-left">Stage</th><th className="text-center">Finished / not dialed</th></tr></thead>
            <tbody className="divide-y divide-line">
              {statuses.map((st) => (
                <tr key={st}>
                  <td className="py-1.5 text-ink">{st}{s.stageMap[st] == null && <span className="ml-1 rounded bg-warning/10 px-1 text-[10px] font-semibold text-warning">new</span>}</td>
                  <td>
                    <select disabled={!canEdit} value={s.stageMap[st] ?? 1} onChange={(e) => set('stageMap', { ...s.stageMap, [st]: Number(e.target.value) })} className={inp}>
                      <option value={1}>1 · New or assigned</option><option value={2}>2 · Attempted</option><option value={3}>3 · Connected</option><option value={4}>4 · Positive</option>
                    </select>
                  </td>
                  <td className="text-center"><input type="checkbox" disabled={!canEdit} checked={s.closed.includes(st)} onChange={(e) => set('closed', e.target.checked ? [...s.closed, st] : s.closed.filter((x) => x !== st))} className="h-4 w-4 accent-primary" /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-ink-muted">Finished statuses are never counted as dialable and never raise a follow-up alert (Not Interested, Not Qualified, DNC; Working On because the rep is already handling it).</p>
        </Panel>

        <div className="space-y-4">
          <Panel title="Follow-up alert after (company default)">
            <div className="space-y-2">
              {Object.entries(s.followUp).map(([st, d]) => (
                <div key={st} className="flex items-center gap-2 text-body-sm">
                  <span className="w-40 text-ink">{st}</span>
                  <input type="number" min={1} max={365} disabled={!canEdit} value={d} onChange={(e) => set('followUp', { ...s.followUp, [st]: Number(e.target.value) })} className={cn(inp, 'w-24')} />
                  <span className="text-ink-muted">days</span>
                  {canEdit && <button type="button" onClick={() => { const n = { ...s.followUp }; delete n[st]; set('followUp', n) }} className="text-[11px] text-ink-muted hover:text-danger">remove</button>}
                </div>
              ))}
              {canEdit && (
                <select value="" onChange={(e) => e.target.value && set('followUp', { ...s.followUp, [e.target.value]: 14 })} className={inp}>
                  <option value="">Add a status…</option>
                  {statuses.filter((st) => s.followUp[st] == null && !s.closed.includes(st)).map((st) => <option key={st}>{st}</option>)}
                </select>
              )}
            </div>
          </Panel>
          <Panel title="State table highlight">
            <div className="grid grid-cols-3 gap-2 text-body-sm">
              <label>Amber at<input type="number" disabled={!canEdit} value={s.highlight.amberPct} onChange={(e) => set('highlight', { ...s.highlight, amberPct: Number(e.target.value) })} className={cn(inp, 'mt-1 w-full')} /><span className="text-[11px] text-ink-muted">% stuck</span></label>
              <label>Red at<input type="number" disabled={!canEdit} value={s.highlight.redPct} onChange={(e) => set('highlight', { ...s.highlight, redPct: Number(e.target.value) })} className={cn(inp, 'mt-1 w-full')} /><span className="text-[11px] text-ink-muted">% stuck</span></label>
              <label>Or a cell over<input type="number" disabled={!canEdit} value={s.highlight.redCount} onChange={(e) => set('highlight', { ...s.highlight, redCount: Number(e.target.value) })} className={cn(inp, 'mt-1 w-full')} /><span className="text-[11px] text-ink-muted">leads</span></label>
            </div>
            <label className="mt-3 flex items-center gap-2 text-body-sm text-ink">Hide rates for groups under <input type="number" min={1} disabled={!canEdit} value={s.minSegment} onChange={(e) => set('minSegment', Number(e.target.value))} className={cn(inp, 'w-20')} /> leads</label>
          </Panel>
        </div>
      </div>

      <Panel title="Calling hours">
        <div className="mb-3 flex flex-wrap gap-4 text-body-sm">
          {([['FIXED_PKT', 'Fixed PKT slots', "The rep's hours stay the same; the lead's local time shifts when the US changes its clocks."], ['FIXED_LOCAL', 'Fixed local hours', "The lead's local hours stay the same; the PKT slots shift by an hour."]] as const).map(([v, label, hint]) => (
            <label key={v} className={cn('flex max-w-sm cursor-pointer gap-2 rounded-btn border p-3', s.clockMode === v ? 'border-primary bg-primary/5' : 'border-line')}>
              <input type="radio" disabled={!canEdit} checked={s.clockMode === v} onChange={() => set('clockMode', v)} className="mt-0.5 accent-primary" />
              <span><b className="text-ink">{label}</b><br /><span className="text-ink-muted">{hint}</span></span>
            </label>
          ))}
          <label className="flex items-center gap-2 text-ink"><input type="checkbox" disabled={!canEdit} checked={s.weekdaysOnly} onChange={(e) => set('weekdaysOnly', e.target.checked)} className="h-4 w-4 accent-primary" /> Closed at weekends (lead's local day)</label>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2 text-body-sm">
          <span className="font-semibold text-ink">Prime time (lead's clock)</span>
          {(s.primeTimes ?? []).map((pt, i) => (
            <span key={i} className="inline-flex items-center gap-1">
              <input type="time" disabled={!canEdit} value={pt.start} onChange={(e) => set('primeTimes', s.primeTimes.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} className={inp} />
              to
              <input type="time" disabled={!canEdit} value={pt.end} onChange={(e) => set('primeTimes', s.primeTimes.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} className={inp} />
            </span>
          ))}
        </div>
        <label className="mb-3 flex items-center gap-2 text-body-sm text-ink"><input type="checkbox" disabled={!canEdit} checked={s.earthzoneTick} onChange={(e) => set('earthzoneTick', e.target.checked)} className="h-4 w-4 accent-primary" /> Mark leads "needs Earthzone update" when something is added in the dialer<InfoTip>Off: reps don't double-enter, but then Earthzone and Metriq hold different information.</InfoTip></label>
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[720px] text-body-sm">
            <thead className="text-[11px] uppercase text-ink-muted"><tr><th className="px-1 py-1 text-left">Region</th><th className="px-1 text-left">PKT start</th><th className="px-1 text-left">PKT end</th><th className="px-1 text-left">Local start</th><th className="px-1 text-left">Local end</th><th className="px-1 text-left">Best hours (from management)</th></tr></thead>
            <tbody className="divide-y divide-line">
              {REGIONS.map((r: RegionCode) => (
                <tr key={r}>
                  <td className="px-1 py-1.5"><span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-ink">{r}</span> <span className="text-ink">{REGION_META[r].name}</span></td>
                  {(['pktStart', 'pktEnd', 'localStart', 'localEnd'] as const).map((k) => (
                    <td key={k} className="px-1"><input type="time" disabled={!canEdit || (s.clockMode === 'FIXED_PKT' ? k.startsWith('local') : k.startsWith('pkt'))} value={s.slots[r][k]} onChange={(e) => set('slots', { ...s.slots, [r]: { ...s.slots[r], [k]: e.target.value } })} className={inp} /></td>
                  ))}
                  <td className="px-1"><input disabled={!canEdit} value={s.peak[r]} maxLength={80} placeholder="e.g. 10 to 11:30 AM" onChange={(e) => set('peak', { ...s.peak, [r]: e.target.value })} className={cn(inp, 'w-full')} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-ink-muted">Calling hours: 9 AM to 5 PM on the lead's clock in every region. With fixed local hours only the local times count; with fixed PKT slots only the PKT times count.</p>
      </Panel>

      {canEdit && (
        <div className="flex justify-end gap-2">
          <Button variant="secondary" leadingIcon={<RotateCcw size={14} />} onClick={() => setS(defaults)}>Back to the plan's defaults</Button>
          <Button disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save settings'}</Button>
        </div>
      )}
    </div>
  )
}
