import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Flag, MessageSquare, PhoneCall } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { EmptyState } from '../../../components/ui/EmptyState'
import { apiErrorText } from '../../../lib/api'
import { cn } from '../../../lib/cn'
import { ago, DISPOSITION_LABEL, fmtDur, fmtWhen, inZone, leadsApi, leadTitle, type LeadCall, type LeadComment, type LeadRow } from '../../../lib/leadsApi'
import { BusinessPicker, FactsMeter, PageHeader, StatusPill, useBusiness } from './shared'

/** Jesse Queue: every flagged lead, oldest first, with the timer, the five facts, the last call and the recording. Jesse decides from the lead. */
export default function JesseQueue() {
  const nav = useNavigate()
  const { business, businesses } = useBusiness()
  const cmrBiz = businesses.filter((b) => b.kind === 'CMR')
  const biz = business?.kind === 'CMR' ? business : cmrBiz[0] ?? null
  const [d, setD] = useState<{ queue: (LeadRow & { lastCall: LeadCall | null; comments: LeadComment[] })[]; decided: LeadRow[]; canDecide: boolean } | null>(null)
  const [err, setErr] = useState('')
  const load = useCallback(() => { if (!biz) return; leadsApi.queue(biz.id).then((r) => { setD(r); setErr('') }).catch((e) => setErr(apiErrorText(e, 'Could not load'))) }, [biz])
  useEffect(() => { load() }, [load])

  if (!cmrBiz.length) return <div className="mx-auto max-w-xl py-16"><EmptyState icon={<Flag />} title="No CMR business yet" hint="Make one under Lead Settings (kind: CMR) and set Jesse as its head." /></div>

  return (
    <div className="mx-auto w-full max-w-[1300px] space-y-4">
      <PageHeader title="Jesse Queue" hint={`${biz?.name ?? ''} · flagged leads waiting for a decision. Jesse checks flags within 1 business day.`} actions={cmrBiz.length > 1 ? <BusinessPicker /> : undefined} />
      {err && <p className="rounded-btn bg-danger/10 px-3 py-2 text-body-sm text-danger">{err}</p>}
      {d && !d.queue.length && <div className="rounded-card border border-line bg-card p-10"><EmptyState icon={<Flag />} title="Nothing waiting on Jesse" hint="Qualified leads appear here the moment they are flagged." /></div>}
      <div className="space-y-3">
        {d?.queue.map((l) => (
          <article key={l.id} className={cn('rounded-card border bg-card p-4 shadow-xs', (l.waitingDays ?? 0) > 1 ? 'border-danger/40' : (l.waitingDays ?? 0) === 1 ? 'border-warning/50' : 'border-line')}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/app/leads/${l.id}`} className="text-[16px] font-semibold text-ink hover:underline">{leadTitle(l)}</Link>
                  <StatusPill status={l.status} pipeline={biz?.pipeline} label={l.statusLabel} />
                  {l.belowMin && <Badge tone="accent">Below minimum</Badge>}
                  <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold', (l.waitingDays ?? 0) > 1 ? 'bg-danger/10 text-danger' : (l.waitingDays ?? 0) === 1 ? 'bg-warning/15 text-amber-700' : 'bg-slate-100 text-ink-muted dark:bg-white/10')}>waiting {l.waitingDays ?? 0} business day{l.waitingDays === 1 ? '' : 's'}</span>
                </div>
                <p className="mt-0.5 text-body-sm text-ink-muted">{[l.industry, l.state, l.assignee ? `SDR ${l.assignee.name}` : 'Unassigned', `flagged ${ago(l.flaggedAt)}`].filter(Boolean).join(' · ')}</p>
              </div>
              <div className="flex items-center gap-2">
                <FactsMeter facts={l.facts} />
                {d.canDecide ? <Button size="sm" onClick={() => nav(`/app/leads/${l.id}`)}>Decide</Button> : <Button size="sm" variant="secondary" onClick={() => nav(`/app/leads/${l.id}`)}>Open</Button>}
              </div>
            </div>
            <p className="mt-3 rounded-card border border-orange-200 bg-orange-50/60 px-3 py-2 text-body-md text-ink dark:border-orange-500/30 dark:bg-orange-500/10"><span className="text-body-sm font-semibold text-ink-muted">Decide: </span>{l.jesseAsk}</p>
            <div className="mt-3 grid gap-3 text-body-sm sm:grid-cols-5">
              <Fact label="Material" value={l.material?.length ? l.material.map((m) => m.replace(/_/g, ' ').toLowerCase()).join(', ') : '—'} />
              <Fact label="Volume" value={l.lbsPerShipment || l.lbsPerMonth ? `${l.lbsPerShipment ? `${l.lbsPerShipment.toLocaleString()} lb/load` : ''}${l.lbsPerShipment && l.lbsPerMonth ? ' · ' : ''}${l.lbsPerMonth ? `${l.lbsPerMonth.toLocaleString()} lb/mo` : ''}` : '—'} />
              <Fact label="Current outlet" value={l.currentVendor ? `${l.currentVendor} · ${l.paysUnit === 'NONE' ? 'pays nothing' : l.paysToday != null ? `$${l.paysToday}/lb` : '?'}` : '—'} />
              <Fact label="Decision maker" value={l.decisionMakerName ? `${l.decisionMakerName}${l.contactRole ? `, ${l.contactRole}` : ''}` : '—'} />
              <Fact label="Timing · freight" value={l.pickupCity || l.nextShipmentDate ? `${l.pickupCity ?? ''}${l.nextShipmentDate ? ` · ${new Date(l.nextShipmentDate).toLocaleDateString()}` : ''} · ${(l.freight ?? 'UNKNOWN').toLowerCase().replace('_', ' ')}` : '—'} />
            </div>
            {l.meetingSlots?.length ? <p className="mt-2 text-body-sm text-ink-muted">Slots offered (Phoenix): {l.meetingSlots.map((s) => inZone(s, 'America/Phoenix')).join(' · ')}</p> : null}
            <div className="mt-3 flex flex-wrap items-center gap-4 text-body-sm">
              {l.lastCall ? (
                <span className="inline-flex items-center gap-2 text-ink-muted"><PhoneCall size={14} />Last call {fmtWhen(l.lastCall.at)} · {DISPOSITION_LABEL[l.lastCall.disposition]}{l.lastCall.durationSec ? ` · ${fmtDur(l.lastCall.durationSec)}` : ''}{l.lastCall.recordingUrl && <audio controls preload="none" src={l.lastCall.recordingUrl} className="h-7" />}</span>
              ) : <span className="text-ink-faint">No call logged</span>}
              {l.comments.length > 0 && <span className="inline-flex items-center gap-1 text-ink-muted"><MessageSquare size={14} />{l.comments[0].user.name}: {l.comments[0].body.slice(0, 80)}{l.comments[0].body.length > 80 ? '…' : ''}</span>}
            </div>
          </article>
        ))}
      </div>
      {d && d.decided.length > 0 && (
        <section className="rounded-card border border-line bg-card shadow-xs">
          <header className="border-b border-line px-4 py-2.5 text-[14px] font-semibold text-ink">Decided in the last 14 days</header>
          <ul className="divide-y divide-line">
            {d.decided.map((l) => <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-body-sm"><Link to={`/app/leads/${l.id}`} className="font-medium text-ink hover:underline">{leadTitle(l)}</Link><span className="text-ink-muted">{l.jesseDecision === 'MEETING' ? 'Meeting approved' : l.jesseDecision === 'DIRECTION' ? 'Direction given' : 'Closed out'} · {ago(l.jesseDecidedAt)}</span></li>)}
          </ul>
        </section>
      )}
    </div>
  )
}
function Fact({ label, value }: { label: string; value: string }) {
  return <div className="rounded-card bg-slate-50 px-3 py-2 dark:bg-white/[0.03]"><div className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{label}</div><div className="mt-0.5 text-ink">{value}</div></div>
}
