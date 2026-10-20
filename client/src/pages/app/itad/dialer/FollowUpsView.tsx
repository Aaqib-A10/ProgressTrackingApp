import { useMemo, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { Button } from '../../../../components/ui/Button'
import { useToast } from '../../../../components/ui/Toast'
import { dialerApi, type DialerData, type DialerLead, type DialerSettings } from '../../../../lib/dialerApi'
import { followUpTabs, latestActedToday, leadState, type FollowUp, type FollowUpDays } from '../../../../lib/dialer'
import { cn } from '../../../../lib/cn'
import { InfoTip, Pager, RegionBadge, StatusPill, LeadActions, errMsg, usePaged } from './ui'

/**
 * Follow-up tracker. Tabs: Overdue, Due today, Scheduled, Snoozed, Done, and the 90+ day
 * backlog with bulk Keep, Snooze 30 days and Drop. Order: Pipeline, then Interested, then
 * Connected, oldest first in each. A note's next-action date is a call back, so it shows here.
 * "Cleared today" counts the leads each rep worked on since noon Pakistan time.
 */

type Tab = 'overdue' | 'dueToday' | 'scheduled' | 'snoozed' | 'done' | 'backlog'
const TABS: { k: Tab; label: string; info: string }[] = [
  { k: 'overdue', label: 'Overdue', info: 'The follow-up days have passed since the last activity, or a call back from before today.' },
  { k: 'dueToday', label: 'Due today', info: 'Call backs set for today (from Call later or a note\'s next-action date), earliest first.' },
  { k: 'scheduled', label: 'Scheduled', info: 'Call backs set for a later day.' },
  { k: 'snoozed', label: 'Snoozed', info: 'Hidden until the snooze date.' },
  { k: 'done', label: 'Done today', info: 'Leads worked on today: called, noted, scheduled, snoozed, kept or dropped. Today starts at noon Pakistan time, so a night shift is one day.' },
  { k: 'backlog', label: 'Backlog 90+ days', info: 'Quiet for 90 days or more. Keep (stays in follow-ups), Snooze 30 days, or Drop (out of follow-ups until the status changes in the CRM).' },
]

export function FollowUpsView({ data, leads, settings, now, onOpenLead, onChanged, showOwner, followUpDays }: { data: DialerData; leads: DialerLead[]; settings: DialerSettings; now: Date; onOpenLead: (id: string, ids: string[]) => void; onChanged: () => void; showOwner: boolean; followUpDays: FollowUpDays }) {
  const { addToast } = useToast()
  const acted = useMemo(() => latestActedToday(data.actedToday), [data.actedToday])
  const tabs = useMemo(() => followUpTabs(leads, settings, now, new Date(data.dayStart), acted, followUpDays), [leads, settings, now, data.dayStart, acted, followUpDays])
  const [tab, setTab] = useState<Tab>('overdue')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const rows = tabs[tab]
  const p = usePaged(rows)
  const ids = rows.map((x) => x.lead.id)

  // Cleared today, per rep.
  const byRep = new Map<string, Set<string>>()
  for (const a of data.actedToday) { const s = byRep.get(a.userId) ?? new Set<string>(); s.add(a.leadId); byRep.set(a.userId, s) }
  const repName = (id: string) => (id === data.me.id ? 'You' : data.reps.find((r) => r.id === id)?.name ?? 'Someone')

  async function bulk(action: 'KEEP' | 'SNOOZE30' | 'DROP') {
    const list = [...picked]
    if (!list.length) return
    setBusy(true)
    try {
      const r = await dialerApi.followUpBulk(list, action)
      addToast({ type: 'success', message: `${r.updated} lead${r.updated === 1 ? '' : 's'} ${action === 'KEEP' ? 'kept' : action === 'DROP' ? 'dropped from follow-ups' : 'snoozed for 30 days'}.` })
      setPicked(new Set()); onChanged()
    } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not save') }) } finally { setBusy(false) }
  }
  const mine = (x: FollowUp) => x.lead.ownerId === data.me.id
  const pageIds = p.rows.filter(mine).map((x) => x.lead.id)
  const allPicked = pageIds.length > 0 && pageIds.every((id) => picked.has(id))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1 rounded-btn border border-line bg-card p-1">
          {TABS.map((t) => {
            const n = tabs[t.k].length
            return (
              <button key={t.k} type="button" onClick={() => { setTab(t.k); setPicked(new Set()) }} className={cn('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-body-sm font-semibold', tab === t.k ? 'bg-primary text-white' : 'text-ink-muted hover:text-ink')}>
                {t.label}
                <span className={cn('rounded-full px-1.5 text-[11px] font-bold tabular-nums', tab === t.k ? 'bg-white/20 text-white' : n && (t.k === 'overdue' || t.k === 'backlog') ? 'bg-danger/10 text-danger' : n && t.k === 'dueToday' ? 'bg-warning/15 text-warning' : 'bg-slate-100 text-ink-muted')}>{n}</span>
              </button>
            )
          })}
        </div>
        <InfoTip>{TABS.find((t) => t.k === tab)!.info} Order: Pipeline, Interested, Connected, oldest first.</InfoTip>
        <div className="ml-auto flex flex-wrap items-center gap-2 text-body-sm">
          <CheckCircle2 size={15} className="text-success" />
          {showOwner && byRep.size > 0
            ? [...byRep.entries()].map(([id, s]) => <span key={id} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-ink"><b>{s.size}</b> {repName(id)}</span>)
            : <span className="text-ink"><b className="tabular-nums">{byRep.get(data.me.id)?.size ?? 0}</b> cleared today</span>}
        </div>
      </div>

      {tab === 'backlog' && rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-btn border border-line bg-slate-50 px-3 py-2 text-body-sm">
          <span className="text-ink"><b>{picked.size}</b> picked</span>
          <Button size="sm" variant="secondary" disabled={busy || !picked.size} onClick={() => bulk('KEEP')}>Keep</Button>
          <Button size="sm" variant="secondary" disabled={busy || !picked.size} onClick={() => bulk('SNOOZE30')}>Snooze 30 days</Button>
          <Button size="sm" variant="secondary" disabled={busy || !picked.size} onClick={() => bulk('DROP')}>Drop</Button>
          <span className="text-ink-muted">Dropped leads come back when their status changes in the CRM.</span>
        </div>
      )}

      <section className="rounded-card border border-line bg-card p-4">
        {rows.length === 0 ? <p className="py-8 text-center text-body-md text-ink-muted">{tab === 'done' ? 'Nothing worked on yet today.' : 'Nothing here.'}</p> : (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-body-sm">
              <thead className="text-[11px] uppercase text-ink-muted">
                <tr>
                  {tab === 'backlog' && <th className="w-8 px-2"><input type="checkbox" checked={allPicked} onChange={(e) => setPicked((s) => { const n = new Set(s); pageIds.forEach((id) => (e.target.checked ? n.add(id) : n.delete(id))); return n })} className="h-4 w-4 accent-primary" aria-label="Pick this page" /></th>}
                  <th className="px-2 py-2">Lead</th><th className="px-2">State</th><th className="px-2">Region</th><th className="px-2">Status</th>
                  <th className="px-2">{tab === 'dueToday' || tab === 'scheduled' ? 'Call back at' : tab === 'overdue' ? 'Call back / quiet' : tab === 'snoozed' ? 'Snoozed until' : tab === 'done' ? 'Today' : 'Last activity'}</th>
                  {showOwner && <th className="px-2">Rep</th>}<th className="px-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {p.rows.map((x) => (
                  <tr key={x.lead.id} className="hover:bg-slate-50/60" title={x.lead.pinnedNote ? `Pinned note: ${x.lead.pinnedNote}` : undefined}>
                    {tab === 'backlog' && <td className="px-2"><input type="checkbox" disabled={!mine(x)} checked={picked.has(x.lead.id)} onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(x.lead.id); else n.delete(x.lead.id); return n })} className="h-4 w-4 accent-primary" aria-label={`Pick ${x.lead.company}`} /></td>}
                    <td className="px-2 py-2.5">
                      <button type="button" onClick={() => onOpenLead(x.lead.id, ids)} className="text-left font-semibold text-ink hover:underline">{x.lead.company}</button>
                      {x.lead.contactName && <p className="whitespace-nowrap text-ink-muted">{x.lead.contactName}{x.lead.phone ? ` · ${x.lead.phone}` : ''}</p>}
                    </td>
                    <td className="px-2 text-ink">{leadState(x.lead) ?? '—'}</td>
                    <td className="px-2"><RegionBadge lead={x.lead} now={now} /></td>
                    <td className="px-2"><StatusPill lead={x.lead} /></td>
                    <td className="whitespace-nowrap px-2">{whenCell(x, tab, now, acted.get(x.lead.id))}</td>
                    {showOwner && <td className="px-2 text-ink-muted">{x.lead.ownerName}</td>}
                    <td className="px-2"><LeadActions lead={x.lead} onDone={onChanged} compact /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager p={p} />
          </div>
        )}
      </section>
      {tabs.dropped.length > 0 && <p className="text-body-sm text-ink-muted">{tabs.dropped.length} lead{tabs.dropped.length === 1 ? ' is' : 's are'} dropped from follow-ups until the status changes (open a lead to undo).</p>}
    </div>
  )
}

const DID: Record<string, string> = { CALL_NOW: 'Called', CALL_LATER: 'Call back set', SNOOZE: 'Snoozed', NOTE: 'Note added', KEEP: 'Kept', DROP: 'Dropped', CLEAR: 'Snooze cleared', EDIT: 'Details added', STATE_FIX: 'State corrected', CRM_DONE: 'Done in Earthzone', BULK_FILL: 'Bulk fill' }
function whenCell(x: FollowUp, tab: Tab, now: Date, did?: string) {
  const l = x.lead
  const t = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  if (l.callLaterAt && (tab === 'dueToday' || tab === 'scheduled' || (tab === 'overdue' && x.callBackDue))) {
    const late = new Date(l.callLaterAt).getTime() <= now.getTime()
    return <span className={cn('font-semibold', late ? 'text-danger' : 'text-ink')}>{t(l.callLaterAt)}</span>
  }
  if (tab === 'snoozed' && l.snoozeUntil) return <span className="text-ink">{t(l.snoozeUntil)}</span>
  if (tab === 'done') return <span className="font-semibold text-success">{DID[did ?? ''] ?? 'Worked on'}</span>
  return <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-bold', x.severity === 'late' ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning')}>{x.days} days quiet</span>
}
