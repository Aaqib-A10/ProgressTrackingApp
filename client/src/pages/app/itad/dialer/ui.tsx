import { useEffect, useState, type ReactNode } from 'react'
import { BellOff, Clock3, MessageSquarePlus, Phone, X } from 'lucide-react'
import { Modal } from '../../../../components/ui/Modal'
import { Button } from '../../../../components/ui/Button'
import { useToast } from '../../../../components/ui/Toast'
import { cn } from '../../../../lib/cn'
import { dialerApi, type DialerLead, type LeadDetail, type RegionCode } from '../../../../lib/dialerApi'
import { REGION_META, REGIONS, leadRegion, leadState, lastActivity, shortDate, daysSince } from '../../../../lib/dialer'

/** Small pieces shared by the Lead Dialer screens. */

export function errMsg(e: unknown, fallback: string): string {
  const m = (e as { message?: string })?.message
  if (!m) return fallback
  try { return (JSON.parse(m) as { error?: string }).error || fallback } catch { return m }
}

export function RegionBadge({ lead, region, now }: { lead?: DialerLead; region?: RegionCode | null; now?: Date }) {
  const r = region ?? (lead ? leadRegion(lead, now ?? new Date()) : null)
  if (!r) return <span className="rounded px-1.5 py-0.5 text-[11px] font-bold text-ink-muted ring-1 ring-line">?</span>
  const verify = lead?.verifyZone && !lead.zoneOverride
  const az = lead?.region === 'AZ' && !lead.zoneOverride
  return (
    <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-bold', REGION_META[r].tone)} title={verify ? 'This state sits in two time zones: check the city' : az ? 'Arizona: Pacific hours in US summer, Mountain in winter' : REGION_META[r].name}>
      {r}{verify ? '?' : az ? '*' : ''}
    </span>
  )
}

const STATUS_TONE: Record<number, string> = {
  1: 'bg-slate-100 text-ink-muted',
  2: 'bg-warning/10 text-warning',
  3: 'bg-primary/10 text-primary',
  4: 'bg-success/10 text-success',
}
export function StatusPill({ lead }: { lead: Pick<DialerLead, 'status' | 'stage'> }) {
  return <span className={cn('inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold', STATUS_TONE[lead.stage] ?? STATUS_TONE[1])}>{lead.status}</span>
}

export function Panel({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-card border border-line bg-card p-4 sm:p-5', className)}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="text-label-md uppercase tracking-wide text-ink-muted">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

const inputCls = 'h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'
const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)

type ActionKind = 'CALL_LATER' | 'SNOOZE' | 'NOTE'
/** Call now · Call later · Snooze · Log note (plan 4c). Snoozes and notes survive new imports. */
export function LeadActions({ lead, onDone, compact }: { lead: DialerLead; onDone: () => void; compact?: boolean }) {
  const { addToast } = useToast()
  const [open, setOpen] = useState<ActionKind | null>(null)
  const [busy, setBusy] = useState(false)
  async function callNow() {
    setBusy(true)
    try {
      await dialerApi.action(lead.id, { kind: 'CALL_NOW' })
      if (lead.phone) { try { await navigator.clipboard?.writeText(lead.phone) } catch { /* clipboard blocked */ } }
      addToast({ type: 'success', message: lead.phone ? `Logged. ${lead.phone} copied. It comes back tomorrow if the CRM still shows no update.` : 'Logged. It comes back tomorrow if the CRM still shows no update.' })
      onDone()
    } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not log the call') }) } finally { setBusy(false) }
  }
  const btn = cn('inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-btn border px-2.5 text-body-sm font-semibold transition-colors', compact && 'h-7 px-2')
  return (
    <div className={cn('flex items-center gap-1.5', compact ? 'flex-nowrap' : 'flex-wrap')} onClick={(e) => e.stopPropagation()}>
      <button type="button" disabled={busy} onClick={callNow} className={cn(btn, 'border-[#0F766E] bg-[#0F766E] text-white hover:bg-[#0F766E]/90')}><Phone size={13} />Call now</button>
      <button type="button" onClick={() => setOpen('CALL_LATER')} className={cn(btn, 'border-line bg-card text-ink hover:bg-slate-50')}><Clock3 size={13} />Call later</button>
      <button type="button" onClick={() => setOpen('SNOOZE')} className={cn(btn, 'border-line bg-card text-ink hover:bg-slate-50')}><BellOff size={13} />Snooze</button>
      <button type="button" onClick={() => setOpen('NOTE')} className={cn(btn, 'border-line bg-card text-ink hover:bg-slate-50')}><MessageSquarePlus size={13} />Log note</button>
      {open && <ActionModal lead={lead} kind={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); onDone() }} />}
    </div>
  )
}

function ActionModal({ lead, kind, onClose, onDone }: { lead: DialerLead; kind: ActionKind; onClose: () => void; onDone: () => void }) {
  const { addToast } = useToast()
  const now = new Date()
  const [when, setWhen] = useState(toLocalInput(new Date(now.getTime() + (kind === 'SNOOZE' ? 3 * 86400000 : 2 * 3600000))))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const title = kind === 'CALL_LATER' ? 'Call later' : kind === 'SNOOZE' ? 'Snooze' : 'Log note'
  async function save(at?: Date) {
    setBusy(true)
    try {
      const t = at ?? new Date(when)
      await dialerApi.action(lead.id, kind === 'NOTE' ? { kind, note: note.trim() } : { kind, at: t.toISOString(), note: note.trim() || undefined })
      addToast({ type: 'success', message: kind === 'NOTE' ? 'Note saved.' : kind === 'CALL_LATER' ? `Call back set for ${t.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.` : `Snoozed until ${t.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}.` })
      onDone()
    } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not save') }) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={`${title} · ${lead.company}`} size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy || (kind === 'NOTE' && !note.trim())} onClick={() => save()}>Save</Button></>}>
      <div className="space-y-3">
        {kind !== 'NOTE' && (
          <>
            {kind === 'SNOOZE' && (
              <div className="flex flex-wrap gap-1.5">
                {[1, 3, 7, 14].map((d) => (
                  <button key={d} type="button" disabled={busy} onClick={() => save(new Date(now.getTime() + d * 86400000))} className="rounded-full border border-line px-3 py-1 text-body-sm font-medium text-ink hover:border-primary hover:text-primary">{d === 1 ? '1 day' : d === 7 ? '1 week' : d === 14 ? '2 weeks' : `${d} days`}</button>
                ))}
              </div>
            )}
            <label className="block">
              <span className="mb-1 block text-body-sm font-semibold text-ink">{kind === 'CALL_LATER' ? 'Call back at (your time)' : 'Hide until'}</span>
              <input type="datetime-local" value={when} min={toLocalInput(now)} onChange={(e) => setWhen(e.target.value)} className={inputCls} />
            </label>
          </>
        )}
        <label className="block">
          <span className="mb-1 block text-body-sm font-semibold text-ink">{kind === 'NOTE' ? 'Note' : 'Note (optional)'}</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} autoFocus={kind === 'NOTE'} className="w-full rounded-btn border border-line bg-card px-3 py-2 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10" placeholder={kind === 'NOTE' ? 'What happened, what was agreed…' : ''} />
        </label>
        <p className="text-body-sm text-ink-muted">Saved on the dashboard against this lead. New imports never erase it. Update the status in the CRM as usual.</p>
      </div>
    </Modal>
  )
}

/** A list of leads (e.g. one state's leads in one status), each opening its detail. */
export function LeadsListModal({ title, leads, now, onClose, onOpen, showOwner }: { title: string; leads: DialerLead[]; now: Date; onClose: () => void; onOpen: (id: string) => void; showOwner?: boolean }) {
  const [limit, setLimit] = useState(50)
  return (
    <Modal open onClose={onClose} title={`${title} · ${leads.length}`} size="xl">
      {leads.length === 0 ? <p className="py-6 text-center text-body-md text-ink-muted">No leads here.</p> : (
        <div className="max-h-[65vh] overflow-y-auto">
          <table className="w-full text-left text-body-sm">
            <thead className="sticky top-0 bg-card text-[11px] uppercase text-ink-muted">
              <tr><th className="py-2 pr-3">Lead</th><th className="pr-3">Phone</th><th className="pr-3">City / State</th><th className="pr-3">Region</th><th className="pr-3">Status</th><th className="pr-3">Last activity</th>{showOwner && <th className="pr-3">Rep</th>}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {leads.slice(0, limit).map((l) => (
                <tr key={l.id} onClick={() => onOpen(l.id)} className="cursor-pointer hover:bg-slate-50">
                  <td className="py-2 pr-3"><p className="font-semibold text-ink">{l.company}</p>{l.contactName && <p className="text-ink-muted">{l.contactName}</p>}</td>
                  <td className="pr-3 tabular-nums text-ink">{l.phone ?? '—'}</td>
                  <td className="pr-3 text-ink">{[l.city, leadState(l)].filter(Boolean).join(', ') || '—'}</td>
                  <td className="pr-3"><RegionBadge lead={l} now={now} /></td>
                  <td className="pr-3"><StatusPill lead={l} /></td>
                  <td className="pr-3 text-ink-muted">{shortDate(lastActivity(l))} · {daysSince(lastActivity(l), now)}d</td>
                  {showOwner && <td className="pr-3 text-ink-muted">{l.ownerName}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          {leads.length > limit && <div className="py-3 text-center"><Button size="sm" variant="secondary" onClick={() => setLimit((n) => n + 100)}>Show {Math.min(100, leads.length - limit)} more</Button></div>}
        </div>
      )}
    </Modal>
  )
}

const KIND_LABEL: Record<string, string> = { CALL_NOW: 'Called', CALL_LATER: 'Call later set', SNOOZE: 'Snoozed', NOTE: 'Note', CLEAR: 'Snooze cleared', STATE_FIX: 'State fixed', ZONE: 'Zone set', BACK_TO_LEADGEN: 'Back to lead gen', DUPLICATE: 'Duplicate' }

/** One lead: details, status path, notes and actions, zone for split states. */
export function LeadDetailModal({ id, now, onClose, onChanged }: { id: string; now: Date; onClose: () => void; onChanged: () => void }) {
  const { addToast } = useToast()
  const [d, setD] = useState<LeadDetail | null>(null)
  const load = () => { dialerApi.lead(id).then(setD).catch((e) => addToast({ type: 'error', message: errMsg(e, 'Could not open the lead') })) }
  useEffect(load, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  const changed = () => { load(); onChanged() }
  const l = d?.lead
  return (
    <Modal open onClose={onClose} title={l ? l.company : 'Lead'} size="xl">
      {!l ? <div className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-5 animate-pulse rounded bg-slate-100" />)}</div> : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill lead={l} />
              <RegionBadge lead={l} now={now} />
              {l.verifyZone && !l.zoneOverride && <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning">verify zone</span>}
              {(l.snoozeUntil && new Date(l.snoozeUntil) > now) && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-ink-muted">Snoozed until {shortDate(l.snoozeUntil)}</span>}
              {(l.callLaterAt && new Date(l.callLaterAt) > now) && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">Call back {new Date(l.callLaterAt).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span>}
            </div>
            <LeadActions lead={l} onDone={changed} />
            {(l.snoozeUntil || l.callLaterAt) && <button type="button" className="text-body-sm text-primary hover:underline" onClick={() => dialerApi.action(l.id, { kind: 'CLEAR' }).then(changed)}>Clear snooze / call back</button>}
            <section>
              <h3 className="mb-2 text-body-md font-semibold text-ink">Notes and actions</h3>
              {d.actions.length === 0 ? <p className="text-body-sm text-ink-muted">Nothing yet.</p> : (
                <ul className="space-y-2">
                  {d.actions.map((a) => (
                    <li key={a.id} className="rounded-btn border border-line px-3 py-2 text-body-sm">
                      <div className="flex items-center gap-2"><b className="text-ink">{KIND_LABEL[a.kind] ?? a.kind}</b><span className="text-ink-muted">{a.user.name} · {new Date(a.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>{a.at && <span className="text-ink-muted">→ {new Date(a.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>}</div>
                      {a.note && <p className="mt-0.5 whitespace-pre-wrap text-ink">{a.note}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h3 className="mb-2 text-body-md font-semibold text-ink">Status path</h3>
              <ol className="flex flex-wrap items-center gap-1.5 text-body-sm">
                {d.changes.map((c, i) => (
                  <li key={c.id} className="flex items-center gap-1.5">
                    {i > 0 && <span className="text-ink-muted">→</span>}
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-ink">{c.toStatus}</span>
                    <span className="text-[11px] text-ink-muted">{shortDate(c.createdAt)}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-1 text-[11px] text-ink-muted">Seen at each import. If a status changed twice between two imports, only the later one shows.</p>
            </section>
          </div>
          <aside className="space-y-2 rounded-card border border-line bg-slate-50/70 p-4 text-body-sm">
            {([
              ['Contact', l.contactName], ['Phone', l.phone], ['Email', l.email], ['City', l.city], ['State', leadState(l) ? `${leadState(l)}${l.stateOverride ? ' (fixed here)' : ''}` : 'Unknown'],
              ['Industry', l.industry], ['Source', l.source], ['Lead ID', l.externalId], ['Owner', l.ownerName || undefined],
              ['Last activity', l.lastActivityAt ? new Date(l.lastActivityAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not in export'],
            ] as [string, string | null | undefined][]).filter(([k, v]) => k !== 'Owner' || v).map(([k, v]) => (
              <div key={k} className="flex gap-2"><span className="w-24 shrink-0 text-ink-muted">{k}</span><span className="min-w-0 break-words text-ink">{v || '—'}</span></div>
            ))}
            {(l.verifyZone || l.zoneOverride) && (
              <div className="border-t border-line pt-2">
                <p className="mb-1 font-semibold text-ink">Time zone for this lead</p>
                <div className="flex flex-wrap gap-1">
                  {REGIONS.map((r) => (
                    <button key={r} type="button" onClick={() => dialerApi.fix(l.id, { zone: l.zoneOverride === r ? null : r }).then(changed)} className={cn('rounded px-2 py-1 text-[11px] font-bold', l.zoneOverride === r ? REGION_META[r].tone : 'bg-card text-ink-muted ring-1 ring-line hover:text-ink')}>{r}</button>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-ink-muted">{leadState(l)} sits in two time zones. The city or area code usually settles it.</p>
              </div>
            )}
          </aside>
        </div>
      )}
      {l && <button type="button" onClick={onClose} className="sr-only"><X /></button>}
    </Modal>
  )
}
