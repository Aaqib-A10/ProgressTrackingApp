import { useState } from 'react'
import { Check, Undo2 } from 'lucide-react'
import { useToast } from '../../../../components/ui/Toast'
import { dialerApi, type DialerLead, type RegionCode } from '../../../../lib/dialerApi'
import { REGIONS, REGION_META, US_STATES, leadState, segments } from '../../../../lib/dialer'
import { cn } from '../../../../lib/cn'
import { Panel, StatusPill, errMsg } from './ui'

/**
 * Fix data (plan 4d and 5): leads with no state stay out of the region counts and the state
 * table until fixed. The rep adds the state (suggested from the phone area code when it can
 * be), or sends the lead back to lead gen. Split-state leads can get their zone here too.
 */
export function FixDataView({ leads, onOpenLead, onChanged, showOwner }: { leads: DialerLead[]; onOpenLead: (id: string) => void; onChanged: () => void; showOwner: boolean }) {
  const { addToast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [showSplit, setShowSplit] = useState(false)
  const live = leads.filter((l) => !l.duplicate)
  const noState = live.filter((l) => !leadState(l))
  const open = noState.filter((l) => !l.sentToLeadGen)
  const sent = noState.filter((l) => l.sentToLeadGen)
  const split = live.filter((l) => l.verifyZone && !l.zoneOverride && leadState(l))

  async function fix(l: DialerLead, body: Parameters<typeof dialerApi.fix>[1], done: string) {
    setBusy(l.id)
    try { await dialerApi.fix(l.id, body); addToast({ type: 'success', message: done }); onChanged() } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not save') }) } finally { setBusy(null) }
  }

  const owners = showOwner ? segments(noState, (l) => l.ownerName || 'Unknown') : []

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="No state, to fix" value={open.length} tone={open.length ? 'warning' : 'success'} />
        <Stat label="Sent back to lead gen" value={sent.length} />
        <Stat label="Split states to verify" value={split.length} />
      </div>
      {showOwner && owners.length > 0 && (
        <p className="text-body-sm text-ink-muted">Who owns them: {owners.map((o) => `${o.key} ${o.leads.length}`).join(' · ')}</p>
      )}

      <Panel title={`Leads with no state · ${open.length}`}>
        {open.length === 0 ? <p className="py-4 text-center text-body-md text-success">Nothing to fix. Every lead has a state.</p> : (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-body-sm">
              <thead className="text-[11px] uppercase text-ink-muted"><tr><th className="px-2 py-2">Lead</th><th className="px-2">Phone</th><th className="px-2">City</th><th className="px-2">Status</th>{showOwner && <th className="px-2">Rep</th>}<th className="px-2">Set the state</th><th className="px-2" /></tr></thead>
              <tbody className="divide-y divide-line">
                {open.map((l) => (
                  <tr key={l.id}>
                    <td className="px-2 py-2"><button type="button" onClick={() => onOpenLead(l.id)} className="font-semibold text-ink hover:underline">{l.company}</button>{l.stateRaw && <p className="text-[11px] text-ink-muted">CRM says "{l.stateRaw}"</p>}</td>
                    <td className="px-2 tabular-nums text-ink">{l.phone ?? '—'}</td>
                    <td className="px-2 text-ink">{l.city ?? '—'}</td>
                    <td className="px-2"><StatusPill lead={l} /></td>
                    {showOwner && <td className="px-2 text-ink-muted">{l.ownerName}</td>}
                    <td className="px-2">
                      <div className="flex items-center gap-1.5">
                        {l.suggestedState && (
                          <button type="button" disabled={busy === l.id} onClick={() => fix(l, { state: l.suggestedState }, `${l.company}: state set to ${l.suggestedState}`)} className="inline-flex items-center gap-1 rounded-btn bg-primary/10 px-2 py-1 text-[12px] font-semibold text-primary hover:bg-primary/15" title="From the phone area code">
                            <Check size={12} />{l.suggestedState}
                          </button>
                        )}
                        <select defaultValue="" disabled={busy === l.id} onChange={(e) => e.target.value && fix(l, { state: e.target.value }, `${l.company}: state set to ${e.target.value}`)} className="h-8 rounded-btn border border-line bg-card px-2 text-[12px] text-ink">
                          <option value="">{l.suggestedState ? 'Other…' : 'Pick a state…'}</option>
                          {US_STATES.map((s) => <option key={s}>{s}</option>)}
                        </select>
                      </div>
                    </td>
                    <td className="px-2 text-right"><button type="button" disabled={busy === l.id} onClick={() => fix(l, { sentToLeadGen: true }, `${l.company} sent back to lead gen`)} className="whitespace-nowrap rounded-btn border border-line px-2 py-1 text-[12px] font-semibold text-ink hover:bg-slate-50">Back to lead gen</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-[11px] text-ink-muted">A state set here is kept until the CRM sends one itself. Tell lead gen to correct the source so the next export has it.</p>
      </Panel>

      {sent.length > 0 && (
        <Panel title={`Sent back to lead gen · ${sent.length}`}>
          <ul className="divide-y divide-line">
            {sent.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 py-2 text-body-sm">
                <button type="button" onClick={() => onOpenLead(l.id)} className="font-semibold text-ink hover:underline">{l.company}</button>
                <button type="button" onClick={() => fix(l, { sentToLeadGen: false }, 'Back on your Fix data list')} className="inline-flex items-center gap-1 text-ink-muted hover:text-ink"><Undo2 size={13} /> Undo</button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title={`Split states · verify zone · ${split.length}`} action={split.length > 0 ? <button type="button" onClick={() => setShowSplit((v) => !v)} className="text-body-sm font-semibold text-primary">{showSplit ? 'Hide' : 'Show'}</button> : undefined}>
        <p className="text-body-sm text-ink-muted">These states sit in two time zones (parts of Florida, Texas, Tennessee, Kentucky, Indiana, Michigan, the Dakotas, Nebraska, Kansas, Idaho, Oregon; Alaska and Hawaii). They are called in the zone most of the state uses. If the city says otherwise, pick the zone.</p>
        {showSplit && (
          <ul className="mt-3 divide-y divide-line">
            {split.slice(0, 200).map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 py-2 text-body-sm">
                <button type="button" onClick={() => onOpenLead(l.id)} className="min-w-0 flex-1 truncate text-left font-semibold text-ink hover:underline">{l.company}</button>
                <span className="text-ink-muted">{[l.city, leadState(l)].filter(Boolean).join(', ')}</span>
                <span className="flex gap-1">
                  {REGIONS.map((r: RegionCode) => (
                    <button key={r} type="button" disabled={busy === l.id} onClick={() => fix(l, { zone: r }, `${l.company}: ${REGION_META[r].name} time`)} className={cn('rounded px-1.5 py-0.5 text-[11px] font-bold ring-1 ring-line hover:text-ink', l.region === r ? REGION_META[r].soft : 'text-ink-muted')}>{r}</button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'warning' | 'success' }) {
  return (
    <div className="rounded-card border border-line bg-card p-4">
      <p className="text-body-sm text-ink-muted">{label}</p>
      <p className={cn('text-[28px] font-bold leading-tight tabular-nums', tone === 'warning' ? 'text-warning' : tone === 'success' ? 'text-success' : 'text-ink')}>{value}</p>
    </div>
  )
}
