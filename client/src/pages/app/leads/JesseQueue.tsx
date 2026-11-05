import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, CheckCircle2, Flag, MessageSquare, PhoneCall } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { EmptyState } from '../../../components/ui/EmptyState'
import { apiErrorText } from '../../../lib/api'
import { cn } from '../../../lib/cn'
import { ago, DISPOSITION_LABEL, fmtDur, fmtWhen, inZone, leadsApi, leadTitle, type LeadCall, type LeadComment, type LeadRow } from '../../../lib/leadsApi'
import { BusinessPicker, FactsMeter, PageHeader, StatusPill, useBusiness, useLeadsMeta } from './shared'

/** Jesse Queue: every flagged lead, oldest first, with the timer, the five facts, the last call and the recording. Jesse decides from the lead. */
export default function JesseQueue() {
  const nav = useNavigate()
  const { business, businesses } = useBusiness()
  const cmrBiz = businesses.filter((b) => b.kind === 'CMR')
  const biz = business?.kind === 'CMR' ? business : cmrBiz[0] ?? null
  const { meta } = useLeadsMeta()
  const [d, setD] = useState<{ queue: (LeadRow & { lastCall: LeadCall | null; comments: LeadComment[]; flaggedBy: { id: string; name: string } | null })[]; decided: LeadRow[]; canDecide: boolean } | null>(null)
  const [ready, setReady] = useState<LeadRow[] | null>(null)
  const [err, setErr] = useState('')
  const load = useCallback(() => { if (!biz) return; leadsApi.queue(biz.id).then((r) => { setD(r); setErr('') }).catch((e) => setErr(apiErrorText(e, 'Could not load'))) }, [biz])
  useEffect(() => { load() }, [load])
  // For the SDR: their open leads that are not flagged yet, the ones with the most facts first.
  const sdr = !!d && !d.canDecide && !meta?.me.admin
  useEffect(() => {
    if (!biz || !sdr) { setReady(null); return }
    leadsApi.list({ business: biz.id, assignee: 'me', pageSize: 50 }).then((r) => setReady(r.leads.filter((l) => l.open && !l.jesseInputNeeded && l.status !== 'QUALIFIED').sort((a, b) => b.factsDone - a.factsDone || +new Date(b.lastActivityAt) - +new Date(a.lastActivityAt)).slice(0, 6))).catch(() => setReady([]))
  }, [biz, sdr])

  if (!cmrBiz.length) return <div className="mx-auto max-w-xl py-16"><EmptyState icon={<Flag />} title="No CMR business yet" hint="Make one under Lead Settings (kind: CMR) and set Jesse as its head." /></div>

  return (
    <div className="mx-auto w-full max-w-[1300px] space-y-4">
      <PageHeader title="Jesse Queue" hint={`${biz?.name ?? ''} · flagged leads waiting for a decision. Jesse checks flags within 1 business day.`} actions={cmrBiz.length > 1 ? <BusinessPicker /> : undefined} />
      {err && <p className="rounded-btn bg-danger/10 px-3 py-2 text-body-sm text-danger">{err}</p>}
      {d && !d.queue.length && <div className="rounded-card border border-line bg-card p-8"><EmptyState icon={<Flag />} title="Nothing waiting on Jesse" hint={d.canDecide ? 'When an SDR presses Qualify on a lead, it appears here with the five facts, the last call and the recording.' : 'Press Qualify on a lead once the facts are in; it appears here for Jesse within the minute.'} /></div>}
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
                <p className="mt-0.5 text-body-sm text-ink-muted">{[l.industry, l.state, l.assignee ? `SDR ${l.assignee.name}` : 'Unassigned', `flagged ${ago(l.flaggedAt)}${l.flaggedBy && l.flaggedBy.id !== l.assigneeId ? ` by ${l.flaggedBy.name}` : ''}`].filter(Boolean).join(' · ')}</p>
                <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-primary/[0.08] px-2.5 py-0.5 text-[12px] font-semibold text-primary">From {l.flaggedBy?.name ?? l.assignee?.name ?? 'the team'}</p>
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
      {sdr && (
        <section className="grid gap-3 lg:grid-cols-3">
          <div className="rounded-card border border-line bg-gradient-to-br from-orange-50 to-amber-50 p-5 shadow-xs dark:from-orange-500/10 dark:to-amber-500/5">
            <h2 className="text-[15px] font-semibold text-ink">How a lead reaches Jesse</h2>
            <ol className="mt-3 space-y-2 text-body-sm text-ink">
              <li className="flex gap-2"><CheckCircle2 size={16} className="mt-0.5 shrink-0 text-orange-500" /><span>Log the call and fill the <b>five facts</b> (material, volume, current outlet, decision maker, timing).</span></li>
              <li className="flex gap-2"><CheckCircle2 size={16} className="mt-0.5 shrink-0 text-orange-500" /><span><b>Send info</b> from the lead, follow up in two business days.</span></li>
              <li className="flex gap-2"><CheckCircle2 size={16} className="mt-0.5 shrink-0 text-orange-500" /><span>Open the lead and press <b>Qualify</b>: one line on what Jesse must decide (price, freight, pickup, a meeting). That puts it in this queue.</span></li>
              <li className="flex gap-2"><CheckCircle2 size={16} className="mt-0.5 shrink-0 text-orange-500" /><span>Jesse answers within a business day: a meeting slot, a direction, or close. You see it on the lead and in your tasks.</span></li>
            </ol>
          </div>
          <div className="rounded-card border border-line bg-card p-5 shadow-xs lg:col-span-2">
            <div className="flex items-center justify-between"><h2 className="text-[15px] font-semibold text-ink">Your leads closest to ready</h2><Link to={`/app/leads?business=${biz?.id}&assignee=me`} className="text-body-sm font-semibold text-primary hover:underline">All mine →</Link></div>
            {ready === null ? <p className="mt-3 text-body-sm text-ink-faint">Loading…</p> : !ready.length ? <p className="mt-3 text-body-sm text-ink-muted">No open leads assigned to you yet.</p> : (
              <ul className="mt-3 divide-y divide-line">
                {ready.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center gap-3 py-2.5 text-body-sm">
                    <Link to={`/app/leads/${l.id}`} className="min-w-[160px] flex-1 font-semibold text-ink hover:underline">{leadTitle(l)}</Link>
                    <StatusPill status={l.status} pipeline={biz?.pipeline} label={l.statusLabel} size="sm" />
                    <FactsMeter facts={l.facts} size="sm" />
                    <span className="hidden text-ink-muted sm:inline">{l.nextStep ? l.nextStep.slice(0, 40) + (l.nextStep.length > 40 ? '…' : '') : 'no next step'}</span>
                    <Button size="sm" variant={l.factsDone >= 4 ? 'primary' : 'secondary'} className="ml-auto" trailingIcon={<ArrowRight size={14} />} onClick={() => nav(`/app/leads/${l.id}?qualify=1`)}>{l.factsDone >= 4 ? 'Qualify' : 'Fill facts'}</Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
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
