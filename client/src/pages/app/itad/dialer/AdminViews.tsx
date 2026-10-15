import { useEffect, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts'
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react'
import { Button } from '../../../../components/ui/Button'
import { useToast } from '../../../../components/ui/Toast'
import { dialerApi, type DialerSettings, type DuplicateGroup, type ImportRecord, type RegionCode } from '../../../../lib/dialerApi'
import { REGIONS, REGION_META, num, pct } from '../../../../lib/dialer'
import { cn } from '../../../../lib/cn'
import { Panel, errMsg } from './ui'
import { ImportSummaryView } from './ImportSummaryView'

/** History (funnel history + every import's summary), Duplicates (manager) and Settings. */

export function HistoryView({ rep, refreshKey }: { rep: string; refreshKey: string }) {
  const [rows, setRows] = useState<ImportRecord[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => { dialerApi.imports(rep).then((r) => { setRows(r.imports); setOpen(r.imports[0]?.id ?? null) }).catch(() => setRows([])) }, [rep, refreshKey])
  if (!rows) return <div className="h-40 animate-pulse rounded-card bg-slate-100" />
  if (rows.length === 0) return <Panel><p className="py-6 text-center text-body-md text-ink-muted">No imports yet. Import your CRM export to start the history.</p></Panel>
  const chart = [...rows].reverse().map((r) => ({
    at: new Date(r.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
    'Connect rate': r.funnel.connectRate != null ? +(r.funnel.connectRate * 100).toFixed(1) : null,
    'Win rate': r.funnel.winRate != null ? +(r.funnel.winRate * 100).toFixed(1) : null,
    'Positive rate': r.funnel.positiveRate != null ? +(r.funnel.positiveRate * 100).toFixed(1) : null,
  }))
  return (
    <div className="space-y-4">
      <Panel title="Funnel history · is the connect rate rising or falling?">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chart} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
              <CartesianGrid stroke="#E2E8F0" vertical={false} />
              <XAxis dataKey="at" tick={{ fontSize: 11, fill: '#64748B' }} />
              <YAxis unit="%" tick={{ fontSize: 11, fill: '#64748B' }} />
              <Tooltip formatter={(v: number) => `${v}%`} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="Connect rate" stroke="#0F766E" strokeWidth={2} dot={{ r: 3 }} connectNulls />
              <Line type="monotone" dataKey="Win rate" stroke="#4F46E5" strokeWidth={2} dot={{ r: 3 }} connectNulls />
              <Line type="monotone" dataKey="Positive rate" stroke="#F59E0B" strokeWidth={2} dot={{ r: 3 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-[11px] text-ink-muted">One point per import. The export holds only the current status, so importing at the start of every shift gives the finest history.</p>
      </Panel>
      <Panel title={`Imports · ${rows.length}`}>
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id} className="py-2">
              <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 text-left text-body-sm">
                {open === r.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <b className="text-ink">{new Date(r.createdAt).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</b>
                <span className="text-ink-muted">{r.user.name} · {r.fileName}</span>
                <span className="text-ink">{num(r.summary.leads)} leads · +{r.summary.added} new · {r.summary.changed} changed · {r.summary.movedForward} forward</span>
                <span className="ml-auto text-ink-muted">Connect {pct(r.funnel.connectRate)} · Win {pct(r.funnel.winRate)}</span>
              </button>
              {open === r.id && <div className="mt-3"><ImportSummaryView s={r.summary} /></div>}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  )
}

export function DuplicatesView({ onChanged }: { onChanged: () => void }) {
  const { addToast } = useToast()
  const [rows, setRows] = useState<DuplicateGroup[] | null>(null)
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
          {rows.map((g) => (
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
      <p className="mt-3 text-[11px] text-ink-muted">The other reps' copies are hidden from their counts and stay hidden on later imports. Also reassign the lead in the CRM so the exports agree.</p>
    </Panel>
  )
}

const inp = 'h-9 rounded-btn border border-line bg-card px-2 text-body-sm text-ink focus:border-primary focus:outline-none disabled:bg-slate-50'

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
      {!canEdit && <p className="rounded-btn bg-slate-100 px-3 py-2 text-body-sm text-ink-muted">Only an ITAD Team Lead or Super Admin can change these. You can see how the numbers are worked out.</p>}
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
          <Panel title="Follow-up alert after (days without activity)">
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

      <Panel title="Calling slots">
        <div className="mb-3 flex flex-wrap gap-4 text-body-sm">
          {([['FIXED_PKT', 'Fixed PKT slots', "The rep's hours stay the same; the lead's local time shifts when the US changes its clocks."], ['FIXED_LOCAL', 'Fixed local hours', "The lead's local hours stay the same; the PKT slots shift by an hour."]] as const).map(([v, label, hint]) => (
            <label key={v} className={cn('flex max-w-sm cursor-pointer gap-2 rounded-btn border p-3', s.clockMode === v ? 'border-primary bg-primary/5' : 'border-line')}>
              <input type="radio" disabled={!canEdit} checked={s.clockMode === v} onChange={() => set('clockMode', v)} className="mt-0.5 accent-primary" />
              <span><b className="text-ink">{label}</b><br /><span className="text-ink-muted">{hint}</span></span>
            </label>
          ))}
          <label className="flex items-center gap-2 text-ink"><input type="checkbox" disabled={!canEdit} checked={s.weekdaysOnly} onChange={(e) => set('weekdaysOnly', e.target.checked)} className="h-4 w-4 accent-primary" /> Closed at weekends (lead's local day)</label>
        </div>
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[720px] text-body-sm">
            <thead className="text-[11px] uppercase text-ink-muted"><tr><th className="px-1 py-1 text-left">Region</th><th className="px-1 text-left">PKT start</th><th className="px-1 text-left">PKT end</th><th className="px-1 text-left">Local start</th><th className="px-1 text-left">Local end</th><th className="px-1 text-left">Best hours (from management)</th></tr></thead>
            <tbody className="divide-y divide-line">
              {REGIONS.map((r: RegionCode) => (
                <tr key={r}>
                  <td className="px-1 py-1.5"><span className={cn('rounded px-1.5 py-0.5 text-[11px] font-bold', REGION_META[r].tone)}>{r}</span> <span className="text-ink">{REGION_META[r].name}</span></td>
                  {(['pktStart', 'pktEnd', 'localStart', 'localEnd'] as const).map((k) => (
                    <td key={k} className="px-1"><input type="time" disabled={!canEdit || (s.clockMode === 'FIXED_PKT' ? k.startsWith('local') : k.startsWith('pkt'))} value={s.slots[r][k]} onChange={(e) => set('slots', { ...s.slots, [r]: { ...s.slots[r], [k]: e.target.value } })} className={inp} /></td>
                  ))}
                  <td className="px-1"><input disabled={!canEdit} value={s.peak[r]} maxLength={80} placeholder="e.g. 10 to 11:30 AM" onChange={(e) => set('peak', { ...s.peak, [r]: e.target.value })} className={cn(inp, 'w-full')} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-ink-muted">The team's rotation: 7 PM to midnight PKT Eastern and Central, midnight to 2 AM Mountain, 2 to 4 AM Pacific. With fixed PKT slots only the PKT times count; with fixed local hours only the local times count.</p>
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
