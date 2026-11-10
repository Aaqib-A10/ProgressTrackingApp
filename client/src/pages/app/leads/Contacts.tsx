import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Download, Mail, Phone, Search, Users } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { EmptyState } from '../../../components/ui/EmptyState'
import { TextField } from '../../../components/ui/Input'
import { apiErrorText } from '../../../lib/api'
import { ago, dialHref, leadsApi, type ContactRow } from '../../../lib/leadsApi'
import { Avatar, BusinessPicker, PageHeader, StatusPill, useBusiness, useLeadsMeta } from './shared'

/**
 * Contacts: everyone behind the leads you can see, by name. Each lead's main contact, plus the
 * other people added to it (the buyer, the owner, the accountant). A row opens its company.
 */
export default function Contacts() {
  const nav = useNavigate()
  const { meta } = useLeadsMeta()
  const { business, businesses, all } = useBusiness()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? '')
  const [d, setD] = useState<{ contacts: ContactRow[]; total: number; page: number; pageSize: number; capped: boolean } | null>(null)
  const [err, setErr] = useState('')
  const page = Number(params.get('page') ?? 1) || 1
  const bizId = all ? undefined : business?.id
  const query = params.get('q') ?? undefined
  const load = useCallback(() => {
    leadsApi.contacts({ business: bizId, q: query, page }).then((r) => { setD(r); setErr('') }).catch((e) => setErr(apiErrorText(e, 'Could not load contacts')))
  }, [bizId, query, page])
  useEffect(() => { load() }, [load])
  const setParam = (patch: Record<string, string | null>) => setParams((p) => { const n = new URLSearchParams(p); for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k) } if (!('page' in patch)) n.delete('page'); return n })
  const timer = useRef<number>()
  const onSearch = (v: string) => { setQ(v); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setParam({ q: v.trim() || null }), 350) }
  const canExport = !!meta?.me.admin || businesses.some((b) => b.myRole)
  const open = (r: ContactRow) => nav(`/app/leads/${r.leadId}`)

  if (!businesses.length) return <div className="mx-auto max-w-xl py-16"><EmptyState icon={<Users />} title="No contacts for you yet" hint={meta?.me.admin ? 'Add a business under Lead Settings, then its leads.' : 'Ask your manager to add you to a business.'} action={meta?.me.admin ? <Link to="/app/leads/settings"><Button size="sm">Lead Settings</Button></Link> : undefined} /></div>

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-4">
      <PageHeader title="Contacts" hint={`${all ? 'Every business you work in' : business?.name ?? ''} · the people behind your leads, by name`} actions={<>
        <BusinessPicker allowAll />
        {canExport && <a href={leadsApi.contactsExportUrl({ business: bizId, q: query })} download title="Download this list"><Button size="sm" variant="secondary" leadingIcon={<Download size={15} />}>Export</Button></a>}
      </>} />
      <div className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-card p-3 shadow-xs">
        <div className="relative min-w-[220px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
          <TextField value={q} onChange={(e) => onSearch(e.target.value)} placeholder="Search a name, role, company, phone or email…" className="pl-8" aria-label="Search contacts" />
        </div>
        {d && <span className="text-body-sm text-ink-faint">{d.total} {d.total === 1 ? 'person' : 'people'}</span>}
      </div>
      {err && <p className="rounded-btn bg-danger/10 px-3 py-2 text-body-sm text-danger">{err}</p>}

      {/* Phones: one card per person. */}
      <div className="space-y-2 md:hidden">
        {!d && !err && Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-card border border-line bg-card" />)}
        {d?.contacts.map((r) => (
          <div key={r.id} role="button" tabIndex={0} onClick={() => open(r)} onKeyDown={(e) => { if (e.key === 'Enter') open(r) }} className="flex items-start gap-2.5 rounded-card border border-line bg-card p-3 shadow-xs active:bg-slate-50 dark:active:bg-white/[0.03]">
            <Avatar name={r.name || '?'} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5"><span className="truncate font-semibold text-ink">{r.name}</span>{r.decisionMaker && <Badge tone="success">Decision maker</Badge>}</div>
              <div className="truncate text-[11.5px] text-ink-muted">{[r.role, r.company].filter(Boolean).join(' · ') || '—'}</div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-ink-muted"><StatusPill status={r.status} label={r.statusLabel} color={r.statusColor} size="sm" />{r.assignee && <span>· {r.assignee.name}</span>}</div>
            </div>
            <span className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
              {r.email && <a href={`mailto:${r.email}`} className="rounded-full bg-slate-100 p-2.5 text-ink-muted dark:bg-white/10" aria-label={`Email ${r.name}`}><Mail size={16} /></a>}
              {(r.phone || r.mobile) && <a href={dialHref(r.phone ?? r.mobile, meta?.dial) ?? '#'} className="rounded-full bg-primary/10 p-2.5 text-primary" aria-label={`Call ${r.name}`}><Phone size={16} /></a>}
            </span>
          </div>
        ))}
        {d && !d.contacts.length && <div className="rounded-card border border-line bg-card px-3 py-10"><EmptyState compact icon={<Users />} title={query ? 'Nobody matches' : 'No contacts yet'} hint={query ? 'Try another name, company or number.' : 'Contacts come from your leads: add a lead, then the people at that company.'} /></div>}
      </div>

      {/* Wider screens: the table. */}
      <div className="overflow-hidden rounded-card border border-line bg-card shadow-xs max-md:hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-body-sm">
            <thead className="bg-slate-50 text-[11.5px] uppercase tracking-wide text-ink-muted dark:bg-white/[0.03]"><tr>{['Name', 'Company', 'Phone', 'Email', 'Lead', 'Owner', 'Last call'].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2.5 font-semibold">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">
              {!d && !err && Array.from({ length: 6 }).map((_, i) => <tr key={i}><td colSpan={7} className="px-3 py-3"><div className="h-5 animate-pulse rounded bg-slate-100 dark:bg-white/5" /></td></tr>)}
              {d?.contacts.map((r) => (
                <tr key={r.id} onClick={() => open(r)} className="cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.03]">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5"><Avatar name={r.name || '?'} />
                      <div className="min-w-0 max-w-[280px]"><div className="flex flex-wrap items-center gap-1.5 font-semibold text-ink">{r.name}{r.decisionMaker && <Badge tone="success">Decision maker</Badge>}{!r.primary && <span className="text-[11px] font-normal text-ink-faint" title="Added under People on the lead">added contact</span>}</div><div className="truncate text-[11.5px] text-ink-muted">{r.role ?? '—'}</div></div>
                    </div>
                  </td>
                  <td className="min-w-[190px] px-3 py-2.5 text-ink">{r.company ?? '—'}<div className="text-[11.5px] text-ink-muted">{[r.industry, r.state].filter(Boolean).join(' · ')}</div></td>
                  <td className="whitespace-nowrap px-3 py-2.5" onClick={(e) => e.stopPropagation()}>{r.phone || r.mobile ? <a href={dialHref(r.phone ?? r.mobile, meta?.dial) ?? '#'} className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"><Phone size={13} />{r.phone ?? r.mobile}</a> : <span className="text-ink-faint">—</span>}{r.phone && r.mobile && <div className="text-[11.5px] text-ink-muted">{r.mobile}</div>}</td>
                  <td className="max-w-[220px] px-3 py-2.5" onClick={(e) => e.stopPropagation()}>{r.email ? <a href={`mailto:${r.email}`} className="block truncate text-ink hover:underline">{r.email}</a> : <span className="text-ink-faint">—</span>}</td>
                  <td className="px-3 py-2.5"><StatusPill status={r.status} label={r.statusLabel} color={r.statusColor} size="sm" />{all && <div className="mt-0.5 text-[11.5px] text-ink-muted">{r.business.name}</div>}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-ink">{r.assignee?.name ?? <span className="text-ink-faint">Unassigned</span>}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-ink-muted">{r.lastCallAt ? ago(r.lastCallAt) : '—'}</td>
                </tr>
              ))}
              {d && !d.contacts.length && <tr><td colSpan={7} className="px-3 py-12"><EmptyState compact icon={<Users />} title={query ? 'Nobody matches' : 'No contacts yet'} hint={query ? 'Try another name, company or number.' : 'Contacts come from your leads: add a lead, then the people at that company.'} /></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {d && d.total > d.pageSize && (
        <div className="flex items-center justify-between px-1 text-body-sm text-ink-muted">
          <span>{(page - 1) * d.pageSize + 1}–{Math.min(page * d.pageSize, d.total)} of {d.total}{d.capped ? ' (search to narrow a very long list)' : ''}</span>
          <span className="flex gap-1"><Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setParam({ page: String(page - 1) })} leadingIcon={<ChevronLeft size={14} />}>Prev</Button><Button size="sm" variant="ghost" disabled={page * d.pageSize >= d.total} onClick={() => setParam({ page: String(page + 1) })} trailingIcon={<ChevronRight size={14} />}>Next</Button></span>
        </div>
      )}
    </div>
  )
}
