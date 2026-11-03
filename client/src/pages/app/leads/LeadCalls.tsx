import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PhoneCall } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { EmptyState } from '../../../components/ui/EmptyState'
import { TextField } from '../../../components/ui/Input'
import { apiErrorText } from '../../../lib/api'
import { cn } from '../../../lib/cn'
import { DISPOSITION_LABEL, DISPOSITIONS, fmtDur, fmtWhen, leadsApi } from '../../../lib/leadsApi'
import { BusinessPicker, PageHeader, Select, StatusPill, useBusiness, useLeadsMeta } from './shared'

type CallRow = Awaited<ReturnType<typeof leadsApi.calls>>['calls'][number]

/** Calls: every call with its recording. Managers and the head hear all; a rep hears their own. */
export default function LeadCalls() {
  const { meta } = useLeadsMeta()
  const { business, all } = useBusiness()
  const [params, setParams] = useSearchParams()
  const [d, setD] = useState<{ calls: CallRow[]; total: number; page: number; pageSize: number } | null>(null)
  const [err, setErr] = useState('')
  const page = Number(params.get('page') ?? 1) || 1
  const canManage = !!meta?.me.admin || business?.myRole === 'MANAGER'
  const setP = (k: string, v: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); if (k !== 'page') n.delete('page'); return n })
  const load = useCallback(() => leadsApi.calls({ business: all ? undefined : business?.id, user: params.get('user') ?? undefined, from: params.get('from') ?? undefined, to: params.get('to') ?? undefined, disposition: params.get('disposition') ?? undefined, minSecs: params.get('minSecs') ? Number(params.get('minSecs')) : undefined, recorded: params.get('recorded') ?? undefined, page }).then((r) => { setD(r); setErr('') }).catch((e) => setErr(apiErrorText(e, 'Could not load'))), [business, all, params, page])
  useEffect(() => { load() }, [load])

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-4">
      <PageHeader title="Calls" hint={canManage ? 'Every call of the team, with recordings. Leave a comment on a call from the lead.' : 'Your calls and recordings.'} actions={<BusinessPicker allowAll />} />
      <div className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-card p-3 shadow-xs">
        {canManage && <Select value={params.get('user') ?? ''} onChange={(e) => setP('user', e.target.value || null)} aria-label="Agent"><option value="">All agents</option><option value="me">Me</option>{(business?.members ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>}
        <Select value={params.get('disposition') ?? ''} onChange={(e) => setP('disposition', e.target.value || null)} aria-label="Disposition"><option value="">Any result</option>{DISPOSITIONS.map((x) => <option key={x} value={x}>{DISPOSITION_LABEL[x]}</option>)}</Select>
        <Select value={params.get('minSecs') ?? ''} onChange={(e) => setP('minSecs', e.target.value || null)} aria-label="Length"><option value="">Any length</option><option value="30">30 s or longer</option><option value="120">2 min or longer</option><option value="300">5 min or longer</option></Select>
        <label className="flex items-center gap-1.5 text-body-sm text-ink"><TextField type="date" value={params.get('from') ?? ''} onChange={(e) => setP('from', e.target.value || null)} className="w-36" /><span>to</span><TextField type="date" value={params.get('to') ?? ''} onChange={(e) => setP('to', e.target.value || null)} className="w-36" /></label>
        <button type="button" onClick={() => setP('recorded', params.get('recorded') ? null : '1')} className={cn('h-9 rounded-btn border px-3 text-body-sm font-medium', params.get('recorded') ? 'border-primary bg-primary/[0.06] text-primary' : 'border-line text-ink-muted')}>With recording</button>
        {d && <span className="ml-auto text-body-sm text-ink-faint">{d.total} call{d.total === 1 ? '' : 's'}</span>}
      </div>
      {err && <p className="rounded-btn bg-danger/10 px-3 py-2 text-body-sm text-danger">{err}</p>}
      <div className="overflow-hidden rounded-card border border-line bg-card shadow-xs">
        <table className="w-full text-left text-body-sm">
          <thead className="bg-slate-50 text-[11.5px] uppercase tracking-wide text-ink-muted dark:bg-white/[0.03]"><tr>{['When', 'Lead', 'Agent', 'Result', 'Length', 'Summary', 'Recording'].map((h) => <th key={h} className="px-3 py-2.5 font-semibold">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">
            {d?.calls.map((c) => (
              <tr key={c.id} className="align-top hover:bg-slate-50 dark:hover:bg-white/[0.03]">
                <td className="whitespace-nowrap px-3 py-2.5 text-ink">{fmtWhen(c.at)}</td>
                <td className="px-3 py-2.5"><Link to={`/app/leads/${c.lead.id}`} className="font-semibold text-ink hover:underline">{c.lead.organization || c.lead.name}</Link><div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-ink-muted"><StatusPill status={c.lead.status} label={c.lead.statusLabel} size="sm" />{c.lead.state}</div></td>
                <td className="px-3 py-2.5 text-ink">{c.user?.name ?? 'TalkLoop'}</td>
                <td className="px-3 py-2.5"><Badge tone={c.disposition === 'CONNECTED' ? 'success' : 'neutral'}>{DISPOSITION_LABEL[c.disposition]}</Badge>{c.consentGiven === false && <Badge tone="warning">No consent</Badge>}</td>
                <td className="px-3 py-2.5 tabular-nums text-ink">{c.durationSec ? fmtDur(c.durationSec) : '—'}</td>
                <td className="max-w-[420px] px-3 py-2.5 text-ink-muted"><span className="line-clamp-3">{c.summary || '—'}</span></td>
                <td className="px-3 py-2.5">{c.recordingUrl ? <audio controls preload="none" src={c.recordingUrl} className="h-8 w-56" /> : c.hasRecording ? <span className="text-ink-faint">Not for you</span> : <span className="text-ink-faint">—</span>}</td>
              </tr>
            ))}
            {d && !d.calls.length && <tr><td colSpan={7} className="px-3 py-12"><EmptyState compact icon={<PhoneCall />} title="No calls match" hint="Calls logged on leads appear here; TalkLoop's call log joins them once connected." /></td></tr>}
          </tbody>
        </table>
        {d && d.total > d.pageSize && <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-body-sm text-ink-muted"><span>Page {page}</span><span className="flex gap-1"><Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setP('page', String(page - 1))}>Prev</Button><Button size="sm" variant="ghost" disabled={page * d.pageSize >= d.total} onClick={() => setP('page', String(page + 1))}>Next</Button></span></div>}
      </div>
    </div>
  )
}
