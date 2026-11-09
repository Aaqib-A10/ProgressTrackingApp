import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronRight, PhoneIncoming, PhoneMissed, PhoneOutgoing, Plus, Link2 } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { EmptyState } from '../../../components/ui/EmptyState'
import { TextField } from '../../../components/ui/Input'
import { useToast } from '../../../components/ui/Toast'
import { apiErrorText } from '../../../lib/api'
import { cn } from '../../../lib/cn'
import { DISPOSITION_LABEL, fmtDur, fmtWhen, leadsApi, type MetaBusiness, type UnmatchedNumber } from '../../../lib/leadsApi'
import { AddLeadModal } from './AddLeadModal'
import { Select } from './shared'

/** "+16025550199" → "(602) 555-0199" */
export const fmtPhone = (p: string) => (/^\+1\d{10}$/.test(p) ? `(${p.slice(2, 5)}) ${p.slice(5, 8)}-${p.slice(8)}` : p)

/**
 * Calls TalkLoop reported to numbers no lead has yet. One row per number; the SDR either adds the
 * company as a lead (the calls move under it) or attaches the number to a lead already here.
 */
export function UnmatchedCalls({ business, businesses }: { business: MetaBusiness | null; businesses: MetaBusiness[] }) {
  const { addToast } = useToast()
  const nav = useNavigate()
  const [d, setD] = useState<{ numbers: UnmatchedNumber[]; total: number } | null>(null)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState<{ phone: string; business: MetaBusiness } | null>(null)
  const [attaching, setAttaching] = useState<string | null>(null)
  const [onlyMine, setOnlyMine] = useState(false)
  const load = useCallback(() => leadsApi.unmatched().then((r) => { setD(r); setErr('') }).catch((e) => setErr(apiErrorText(e, 'Could not load'))), [])
  useEffect(() => { load() }, [load])
  const rows = useMemo(() => (d?.numbers ?? []).filter((n) => !onlyMine || n.connected > 0), [d, onlyMine])
  const target = business ?? businesses[0] ?? null

  const attached = (phone: string, leadId: string, moved: number) => {
    addToast({ type: 'success', message: `${moved} call${moved === 1 ? '' : 's'} to ${fmtPhone(phone)} now on the lead` })
    setAdding(null); setAttaching(null)
    nav(`/app/leads/${leadId}`)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-card px-4 py-3 shadow-xs">
        <p className="text-body-sm text-ink-muted">Numbers TalkLoop reached that are not a lead yet. <strong className="text-ink">Add as lead</strong> makes the company and files every call under it; <strong className="text-ink">Attach</strong> puts them on a company already here. New calls to that number then land there by themselves.</p>
        <label className="ml-auto flex items-center gap-2 text-body-sm text-ink"><input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} className="h-4 w-4 rounded border-line" />Only numbers that answered</label>
        {d && <span className="text-body-sm text-ink-faint">{rows.length} number{rows.length === 1 ? '' : 's'} · {d.total} call{d.total === 1 ? '' : 's'}</span>}
      </div>
      {err && <p className="rounded-btn bg-danger/10 px-3 py-2 text-body-sm text-danger">{err}</p>}
      <div className="overflow-x-auto rounded-card border border-line bg-card shadow-xs">
        <table className="w-full min-w-[640px] text-left text-body-sm">
          <thead className="bg-slate-50 text-[11.5px] uppercase tracking-wide text-ink-muted dark:bg-white/[0.03]"><tr>{['Number', 'Calls', 'Answered', 'Last call', 'Who', ''].map((h, i) => <th key={i} className="px-3 py-2.5 font-semibold">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">
            {rows.map((n) => (
              <NumberRow key={n.phone} n={n} open={open === n.phone} onToggle={() => setOpen(open === n.phone ? null : n.phone)} attaching={attaching === n.phone} onAttachStart={() => setAttaching(attaching === n.phone ? null : n.phone)} onAttached={(leadId, moved) => { attached(n.phone, leadId, moved); load() }} onAdd={target ? () => setAdding({ phone: n.phone, business: target }) : undefined} businesses={businesses} />
            ))}
            {d && !rows.length && <tr><td colSpan={6} className="px-3 py-12"><EmptyState compact icon={<PhoneMissed />} title={onlyMine ? 'No answered calls without a lead' : 'Every call has its lead'} hint="Calls TalkLoop reports to numbers no lead has wait here." /></td></tr>}
          </tbody>
        </table>
      </div>
      {adding && <AddLeadModal business={adding.business} initial={{ phone: fmtPhone(adding.phone) }} onClose={() => setAdding(null)} onAdded={async (id) => { try { const r = await leadsApi.attachUnmatched(adding.phone, id); attached(adding.phone, id, r.moved) } catch (e) { addToast({ type: 'error', message: apiErrorText(e, 'Lead added, but the calls could not be moved') }); nav(`/app/leads/${id}`) } }} />}
    </div>
  )
}

function NumberRow({ n, open, onToggle, attaching, onAttachStart, onAttached, onAdd, businesses }: { n: UnmatchedNumber; open: boolean; onToggle: () => void; attaching: boolean; onAttachStart: () => void; onAttached: (leadId: string, moved: number) => void; onAdd?: () => void; businesses: MetaBusiness[] }) {
  const last = n.items[0]
  return (
    <>
      <tr className={cn('align-top hover:bg-slate-50 dark:hover:bg-white/[0.03]', open && 'bg-slate-50 dark:bg-white/[0.03]')}>
        <td className="whitespace-nowrap px-3 py-2.5"><button type="button" onClick={onToggle} className="flex items-center gap-1.5 font-semibold tabular-nums text-ink hover:underline">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{fmtPhone(n.phone)}</button></td>
        <td className="px-3 py-2.5 tabular-nums text-ink">{n.calls}</td>
        <td className="px-3 py-2.5">{n.connected ? <Badge tone="success">{n.connected} answered</Badge> : <span className="text-ink-faint">—</span>}</td>
        <td className="whitespace-nowrap px-3 py-2.5 text-ink">{fmtWhen(n.lastAt)}{last && <span className="ml-1.5 text-ink-muted">· {DISPOSITION_LABEL[last.disposition]}{last.durationSec ? ` · ${fmtDur(last.durationSec)}` : ''}</span>}</td>
        <td className="px-3 py-2.5 text-ink">{n.people.map((p) => p.name).join(', ')}</td>
        <td className="whitespace-nowrap px-3 py-2 text-right">
          {onAdd && <Button size="sm" leadingIcon={<Plus size={14} />} onClick={onAdd}>Add as lead</Button>}
          <Button size="sm" variant="ghost" className="ml-1" leadingIcon={<Link2 size={14} />} onClick={onAttachStart}>Attach…</Button>
        </td>
      </tr>
      {attaching && <tr className="bg-primary/[0.04]"><td colSpan={6} className="px-3 py-3"><AttachPicker phone={n.phone} businesses={businesses} onAttached={onAttached} /></td></tr>}
      {open && (
        <tr className="bg-slate-50/60 dark:bg-white/[0.02]"><td colSpan={6} className="px-3 py-2">
          <ul className="divide-y divide-line/70">
            {n.items.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 py-1.5 text-body-sm">
                <span className="text-ink-muted">{c.direction === 'IN' ? <PhoneIncoming size={14} /> : <PhoneOutgoing size={14} />}</span>
                <span className="w-32 whitespace-nowrap text-ink">{fmtWhen(c.at)}</span>
                <span className="w-32 text-ink">{c.user.name}</span>
                <Badge tone={c.disposition === 'CONNECTED' ? 'success' : 'neutral'}>{DISPOSITION_LABEL[c.disposition]}</Badge>
                <span className="w-16 tabular-nums text-ink-muted">{c.durationSec ? fmtDur(c.durationSec) : '—'}</span>
                {c.recordingUrl && <audio controls preload="none" src={c.recordingUrl} className="h-8 w-56" />}
              </li>
            ))}
            {n.calls > n.items.length && <li className="py-1.5 text-body-sm text-ink-faint">…and {n.calls - n.items.length} earlier</li>}
          </ul>
        </td></tr>
      )}
    </>
  )
}

/** Find the company already here and move the number's calls under it. */
function AttachPicker({ phone, businesses, onAttached }: { phone: string; businesses: MetaBusiness[]; onAttached: (leadId: string, moved: number) => void }) {
  const { addToast } = useToast()
  const [q, setQ] = useState('')
  const [bizId, setBizId] = useState(businesses[0]?.id ?? '')
  const [hits, setHits] = useState<{ id: string; name: string; organization: string | null; statusLabel: string; assignee: { name: string } | null }[]>([])
  const [busy, setBusy] = useState(false)
  const timer = useRef<number>()
  useEffect(() => {
    window.clearTimeout(timer.current)
    if (q.trim().length < 2) { setHits([]); return }
    timer.current = window.setTimeout(() => {
      leadsApi.list({ business: bizId || undefined, q: q.trim(), status: 'all', pageSize: 8 }).then((r) => setHits(r.leads.map((l) => ({ id: l.id, name: l.name, organization: l.organization, statusLabel: l.statusLabel, assignee: l.assignee })))).catch(() => setHits([]))
    }, 300)
  }, [q, bizId])
  const go = async (leadId: string) => {
    setBusy(true)
    try { const r = await leadsApi.attachUnmatched(phone, leadId); onAttached(leadId, r.moved) } catch (e) { addToast({ type: 'error', message: apiErrorText(e, 'Could not attach') }) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-body-sm text-ink">Attach {fmtPhone(phone)} to:</span>
        {businesses.length > 1 && <Select value={bizId} onChange={(e) => setBizId(e.target.value)} aria-label="Business">{businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}
        <TextField autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type the company name…" className="w-72" />
      </div>
      {hits.length > 0 && (
        <ul className="divide-y divide-line rounded-btn border border-line bg-card">
          {hits.map((h) => <li key={h.id} className="flex items-center gap-3 px-3 py-2 text-body-sm"><span className="font-semibold text-ink">{h.organization || h.name}</span><span className="text-ink-muted">{h.statusLabel}{h.assignee ? ` · ${h.assignee.name}` : ''}</span><Button size="sm" variant="secondary" className="ml-auto" disabled={busy} onClick={() => go(h.id)}>Attach here</Button></li>)}
        </ul>
      )}
      {q.trim().length >= 2 && !hits.length && <p className="text-body-sm text-ink-faint">No company matches — use Add as lead instead.</p>}
    </div>
  )
}
