import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronRight, Inbox, MessageSquare } from 'lucide-react'
import { Badge } from '../../../components/ui/Badge'
import { EmptyState } from '../../../components/ui/EmptyState'
import { apiErrorText } from '../../../lib/api'
import { cn } from '../../../lib/cn'
import { ago, leadsApi, leadTitle, type LeadRow } from '../../../lib/leadsApi'
import { Avatar, BusinessPicker, FactsMeter, PageHeader, StatusPill, useBusiness } from './shared'

/**
 * Jesse's Inbox: one list of what Mark and Matthew sent him. He opens a card, reads the filled
 * form, and answers in the chat. From there the SDR carries the lead on; Jesse only watches the
 * status. Three tabs: waiting for him, answered (the SDR is on it), closed (how each one ended).
 */
type Tab = 'waiting' | 'answered' | 'closed'
type QueueRow = LeadRow & { flaggedBy?: { id: string; name: string } | null; comments?: { user: { name: string }; body: string }[] }

export default function JesseInbox() {
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'waiting'
  const { business, businesses } = useBusiness()
  const cmrBiz = businesses.filter((b) => b.kind === 'CMR')
  const biz = business?.kind === 'CMR' ? business : cmrBiz[0] ?? null
  const [d, setD] = useState<{ queue: QueueRow[]; decided: LeadRow[]; closed: LeadRow[]; canDecide: boolean } | null>(null)
  const [err, setErr] = useState('')
  const load = useCallback(() => { if (!biz) return; leadsApi.queue(biz.id).then((r) => { setD(r); setErr('') }).catch((e) => setErr(apiErrorText(e, 'Could not load'))) }, [biz])
  useEffect(() => { load() }, [load])
  // New submissions show up without a refresh.
  useEffect(() => { const t = window.setInterval(() => { if (document.visibilityState === 'visible') load() }, 60_000); return () => window.clearInterval(t) }, [load])

  if (!cmrBiz.length) return <div className="mx-auto max-w-xl py-16"><EmptyState icon={<Inbox />} title="No CMR business yet" hint="Make one under Lead Settings (kind: CMR) and set Jesse as its head." /></div>

  const rows: LeadRow[] = !d ? [] : tab === 'waiting' ? d.queue : tab === 'answered' ? d.decided.filter((l) => l.open) : d.closed
  const tabs: { key: Tab; label: string; n: number | null; tone?: 'danger' }[] = [
    { key: 'waiting', label: 'Waiting for you', n: d?.queue.length ?? null, tone: d?.queue.length ? 'danger' : undefined },
    { key: 'answered', label: 'Answered · SDR on it', n: d ? d.decided.filter((l) => l.open).length : null },
    { key: 'closed', label: 'Closed', n: d?.closed.length ?? null },
  ]

  return (
    <div className="mx-auto w-full max-w-[1100px] space-y-4">
      <PageHeader title="Inbox" hint={`${biz?.name ?? ''} · what the SDRs sent you. Open one, read the form, answer in the chat; they take it from there.`} actions={<>{cmrBiz.length > 1 && <BusinessPicker />}<Link to="/app/leads/summary" className="text-body-sm font-semibold text-primary hover:underline">Summary →</Link></>} />
      {err && <p className="rounded-btn bg-danger/10 px-3 py-2 text-body-sm text-danger">{err}</p>}
      <div className="flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button key={t.key} type="button" onClick={() => setParams(t.key === 'waiting' ? {} : { tab: t.key })} className={cn('inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-body-sm font-semibold', tab === t.key ? 'border-ink bg-ink text-card' : 'border-line bg-card text-ink-muted hover:text-ink')}>
            {t.label}{t.n != null && <span className={cn('rounded-full px-1.5 text-[11px] tabular-nums', tab === t.key ? 'bg-card/20' : t.tone === 'danger' ? 'bg-danger/10 text-danger' : 'bg-slate-100 dark:bg-white/10')}>{t.n}</span>}
          </button>
        ))}
      </div>

      {d && !rows.length && (
        <div className="rounded-card border border-line bg-card p-8">
          <EmptyState icon={<Inbox />} title={tab === 'waiting' ? 'Nothing waiting for you' : tab === 'answered' ? 'Nothing answered in the last 30 days' : 'Nothing closed in the last 90 days'} hint={tab === 'waiting' ? 'When Mark or Matthew submit a lead for you, it appears here with the form they filled.' : undefined} />
        </div>
      )}

      <ul className="space-y-2">
        {rows.map((l) => {
          const q = l as QueueRow
          const from = q.flaggedBy?.name ?? l.assignee?.name ?? 'the team'
          const days = l.waitingDays ?? 0
          const last = q.comments?.[0]
          return (
            <li key={l.id}>
              <button type="button" onClick={() => nav(`/app/leads/inbox/${l.id}`)} className={cn('flex w-full items-start gap-3 rounded-card border bg-card p-3.5 text-left shadow-xs transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.03] sm:p-4', tab === 'waiting' && days > 1 ? 'border-danger/40' : tab === 'waiting' && days === 1 ? 'border-warning/50' : 'border-line')}>
                <Avatar name={leadTitle(l)} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-semibold text-ink">{leadTitle(l)}</span>
                    <StatusPill status={l.status} pipeline={biz?.pipeline} label={l.statusLabel} size="sm" />
                    {l.belowMin && <Badge tone="accent">Below minimum</Badge>}
                    {tab === 'waiting' && <span className={cn('rounded-full px-2 py-0.5 text-[11.5px] font-semibold', days > 1 ? 'bg-danger/10 text-danger' : days === 1 ? 'bg-warning/15 text-amber-700' : 'bg-slate-100 text-ink-muted dark:bg-white/10')}>waiting {days} business day{days === 1 ? '' : 's'}</span>}
                  </div>
                  <p className="mt-0.5 text-body-sm text-ink-muted">
                    {tab === 'waiting' && <>From <b className="text-ink">{from}</b> · submitted {ago(l.flaggedAt)}</>}
                    {tab === 'answered' && <>{l.assignee?.name ?? 'Unassigned'} is on it · you answered {ago(l.jesseDecidedAt)}{l.nextStep ? ` · next: ${l.nextStep}` : ''}</>}
                    {tab === 'closed' && <>{l.statusLabel}{l.lostReason ? ` · ${l.lostReason.toLowerCase().replace(/_/g, ' ')}` : ''} · {l.assignee?.name ?? 'Unassigned'} · {ago(l.lastActivityAt)}</>}
                    {[l.industry, l.state].filter(Boolean).length ? ` · ${[l.industry, l.state].filter(Boolean).join(', ')}` : ''}
                  </p>
                  {tab === 'waiting' && l.jesseAsk && <p className="mt-2 rounded-card border border-orange-200 bg-orange-50/60 px-3 py-1.5 text-body-sm text-ink dark:border-orange-500/30 dark:bg-orange-500/10"><span className="font-semibold text-ink-muted">They ask: </span>{l.jesseAsk}</p>}
                  {tab !== 'waiting' && l.jesseComment && <p className="mt-1.5 line-clamp-2 text-body-sm text-ink-muted"><MessageSquare size={12} className="mr-1 inline" />You: {l.jesseComment}</p>}
                  {tab === 'waiting' && last && <p className="mt-1.5 line-clamp-1 text-body-sm text-ink-muted"><MessageSquare size={12} className="mr-1 inline" />{last.user.name}: {last.body}</p>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <FactsMeter facts={l.facts} size="sm" />
                  <ChevronRight size={18} className="text-ink-faint" />
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
