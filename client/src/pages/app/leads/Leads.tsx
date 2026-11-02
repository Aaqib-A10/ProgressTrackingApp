import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowRight, Download, Globe, Inbox, Mail, MessageSquareText, Phone, PhoneCall, Plus, Search, Settings2, Upload, UserPlus, X } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { Modal } from '../../../components/ui/Modal'
import { EmptyState } from '../../../components/ui/EmptyState'
import { TextField, TextArea } from '../../../components/ui/Input'
import { useToast } from '../../../components/ui/Toast'
import { apiErrorText } from '../../../lib/api'
import { cn } from '../../../lib/cn'
import { useAuth } from '../../../lib/auth'
import { leadsApi, LEAD_IMPORT_FIELDS, SOURCE_LABEL, STATUS_LABEL, STATUS_TONE, type LeadFull, type LeadList, type LeadsMeta, type LeadStatus, type ListParams, type MetaBusiness } from '../../../lib/leadsApi'
import { readFile } from '../itad/dialer/ImportModal'

/**
 * Lead Management: every lead of the businesses I work in. Managers see the whole business and
 * give each new lead to a rep; reps see the leads given to them. ?lead=<id> opens one lead.
 */

const OPEN_TABS: { key: string; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'NEW', label: 'New' },
  { key: 'CONTACTED', label: 'Contacted' },
  { key: 'QUALIFIED', label: 'Qualified' },
  { key: 'WON', label: 'Won' },
  { key: 'LOST', label: 'Lost' },
  { key: 'SPAM', label: 'Spam' },
  { key: '', label: 'All' },
]

export function ago(iso: string | null | undefined): string {
  if (!iso) return ''
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })
}
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

export default function Leads() {
  const { user } = useAuth()
  const { addToast } = useToast()
  const [params, setParams] = useSearchParams()
  const [meta, setMeta] = useState<LeadsMeta | null>(null)
  const [metaError, setMetaError] = useState('')
  const [data, setData] = useState<LeadList | null>(null)
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)

  const business = params.get('business') ?? ''
  const status = params.get('status') ?? 'open'
  const assignee = params.get('assignee') ?? ''
  const late = params.get('late') === '1'
  const page = Number(params.get('page') ?? 1) || 1
  const openId = params.get('lead')

  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) { if (v == null || v === '') next.delete(k); else next.set(k, v) }
    if (!('page' in patch)) next.delete('page')
    setParams(next, { replace: true })
  }

  useEffect(() => { leadsApi.meta().then(setMeta).catch((e) => setMetaError(apiErrorText(e, 'Could not load leads'))) }, [])
  const listParams: ListParams = useMemo(() => ({ business: business || undefined, status: status === 'open' ? 'open' : status || 'all', assignee: assignee || undefined, q: q.trim() || undefined, late, page }), [business, status, assignee, q, late, page])
  const load = useCallback(() => {
    setLoading(true)
    leadsApi.list(listParams).then(setData).catch((e) => addToast({ type: 'error', message: apiErrorText(e, 'Could not load leads') })).finally(() => setLoading(false))
  }, [listParams, addToast])
  // Typing in search waits a moment; everything else loads at once.
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; load(); return }
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
  }, [load])

  const managed = useMemo(() => meta?.businesses.filter((b) => b.myRole === 'MANAGER') ?? [], [meta])
  const isManager = !!meta?.me.admin || managed.length > 0
  const bizById = useMemo(() => new Map((meta?.businesses ?? []).map((b) => [b.id, b])), [meta])
  const people = useMemo(() => {
    const m = new Map<string, string>()
    for (const b of meta?.businesses ?? []) if (!business || b.id === business) for (const p of b.members) m.set(p.id, p.name)
    return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [meta, business])

  if (metaError) return <div className="mx-auto max-w-xl py-16"><EmptyState icon={<Inbox />} title="Leads are not available" hint={metaError} /></div>
  const noBusinesses = meta && meta.businesses.length === 0
  const c = data?.counts
  const openCount = (c?.byStatus.NEW ?? 0) + (c?.byStatus.CONTACTED ?? 0) + (c?.byStatus.QUALIFIED ?? 0)

  return (
    <div className="mx-auto w-full max-w-[1800px] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">Leads</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">{isManager ? 'Every enquiry from your websites, calls, sheets and inboxes. Give each new lead to a rep.' : 'The leads given to you. Get in touch, log the call, move them along.'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {meta && meta.businesses.length > 1 && (
            <select value={business} onChange={(e) => setParam({ business: e.target.value || null, assignee: null })} className="h-9 rounded-btn border border-line bg-card px-2.5 text-body-md text-ink" aria-label="Business">
              <option value="">All businesses</option>
              {meta.businesses.map((b) => <option key={b.id} value={b.id}>{b.name}{b.isActive ? '' : ' (off)'}</option>)}
            </select>
          )}
          {isManager && <a href={leadsApi.exportUrl(listParams)} className="inline-flex h-9 items-center gap-1.5 rounded-btn border border-line bg-card px-3 text-body-md font-medium text-ink hover:bg-slate-50"><Download size={15} />Download</a>}
          {isManager && <Button size="sm" variant="secondary" leadingIcon={<Upload size={15} />} onClick={() => setImporting(true)} disabled={!managed.length && !meta?.me.admin}>Import</Button>}
          {meta?.me.admin && <Link to="/app/leads/settings" className="inline-flex h-9 items-center gap-1.5 rounded-btn border border-line bg-card px-3 text-body-md font-medium text-ink hover:bg-slate-50"><Settings2 size={15} />Settings</Link>}
          <Button size="sm" leadingIcon={<Plus size={16} />} onClick={() => setAdding(true)} disabled={!meta || !meta.businesses.some((b) => b.isActive)}>Add lead</Button>
        </div>
      </div>

      {noBusinesses ? (
        <div className="rounded-card border border-line bg-card p-8">
          <EmptyState icon={<Inbox />} title={meta!.me.admin ? 'Set up your first business' : 'You are not in any business yet'}
            hint={meta!.me.admin ? 'Add the businesses (brands) that receive leads, the people who work them, and connect the website forms and inboxes.' : 'Ask your Super Admin to add you to a business under Lead Settings.'}
            action={meta!.me.admin ? <Link to="/app/leads/settings"><Button size="sm" trailingIcon={<ArrowRight size={15} />}>Open Lead Settings</Button></Link> : undefined} />
        </div>
      ) : (
        <>
          {/* Quick views */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <QuickView active={!late && !assignee && status === 'open'} label="Open" value={openCount} onClick={() => setParam({ status: null, assignee: null, late: null })} />
            {isManager
              ? <QuickView active={assignee === 'none' && !late} label="Not assigned" value={c?.unassigned ?? 0} tone={c?.unassigned ? 'primary' : undefined} onClick={() => setParam({ status: null, assignee: 'none', late: null })} />
              : <QuickView active={assignee === 'me' && !late} label="Mine (open)" value={c?.mine ?? 0} onClick={() => setParam({ status: null, assignee: 'me', late: null })} />}
            <QuickView active={late} label="Late" hint="Not assigned or not contacted in time" value={c?.late ?? 0} tone={c?.late ? 'danger' : undefined} onClick={() => setParam({ late: late ? null : '1', status: null, assignee: null })} />
            <QuickView active={status === 'WON' && !late} label="Won" value={c?.byStatus.WON ?? 0} tone="success" onClick={() => setParam({ status: 'WON', late: null })} />
          </div>

          <div className="rounded-card border border-line bg-card shadow-xs">
            <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
              <div className="relative min-w-[220px] flex-1">
                <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
                <input value={q} onChange={(e) => { setQ(e.target.value); if (page > 1) setParam({ page: null }) }} placeholder="Search name, email, phone, company or message" className="h-9 w-full rounded-btn border border-line bg-card pl-8 pr-3 text-body-md text-ink placeholder:text-ink-faint" />
              </div>
              <div className="flex flex-wrap gap-1">
                {OPEN_TABS.map((t) => (
                  <button key={t.key || 'all'} type="button" onClick={() => setParam({ status: t.key === 'open' ? null : t.key || 'all', late: null })}
                    className={cn('h-8 rounded-full px-3 text-body-sm font-medium transition-colors', !late && (status === (t.key || 'all') || (t.key === 'open' && status === 'open')) ? 'bg-ink text-card' : 'text-ink-muted hover:bg-slate-100 hover:text-ink')}>
                    {t.label}{t.key && t.key !== 'open' && c?.byStatus[t.key as LeadStatus] ? <span className="ml-1 opacity-60">{c.byStatus[t.key as LeadStatus]}</span> : null}
                  </button>
                ))}
              </div>
              {isManager && (
                <select value={assignee} onChange={(e) => setParam({ assignee: e.target.value || null })} className="h-9 rounded-btn border border-line bg-card px-2.5 text-body-md text-ink" aria-label="Assigned to">
                  <option value="">Anyone</option>
                  <option value="none">Not assigned</option>
                  <option value="me">Me</option>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
            </div>

            {loading && !data ? (
              <div className="space-y-2 p-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-11 animate-pulse rounded-btn bg-slate-100" />)}</div>
            ) : !data?.leads.length ? (
              <EmptyState icon={<Inbox />} title={late ? 'Nothing late. Nice.' : 'No leads here'} hint={q ? 'Try other words.' : 'New leads from your forms, inboxes and calls show up here.'} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-body-md">
                  <thead className="text-label-md uppercase text-ink-faint">
                    <tr className="border-b border-line">
                      <th className="px-4 py-2.5 font-semibold">Lead</th>
                      {(meta?.businesses.length ?? 0) > 1 && !business && <th className="px-3 py-2.5 font-semibold">Business</th>}
                      <th className="px-3 py-2.5 font-semibold">From</th>
                      <th className="px-3 py-2.5 font-semibold">Status</th>
                      <th className="px-3 py-2.5 font-semibold">Assigned to</th>
                      <th className="px-3 py-2.5 font-semibold">Received</th>
                      <th className="px-3 py-2.5 font-semibold">Last activity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.leads.map((l) => {
                      const b = bizById.get(l.businessId)
                      return (
                        <tr key={l.id} onClick={() => setParam({ lead: l.id, page: String(page) })} className={cn('cursor-pointer border-b border-line/70 transition-colors last:border-0 hover:bg-slate-50 dark:hover:bg-white/[0.03]', openId === l.id && 'bg-primary/[0.05]')}>
                          <td className="max-w-[340px] px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <span className="truncate font-semibold text-ink">{l.name || l.organization || l.email || l.phone}</span>
                              {l.repeats > 0 && <Badge tone="accent">+{l.repeats} again</Badge>}
                              {l.late && <Badge tone="danger"><AlertTriangle size={11} className="mr-0.5 inline" />{l.late === 'assign' ? 'Assign' : 'Contact'}</Badge>}
                            </div>
                            <p className="truncate text-body-sm text-ink-muted">{[l.organization && l.organization !== l.name ? l.organization : null, l.email, l.phone].filter(Boolean).join(' · ') || l.message}</p>
                          </td>
                          {(meta?.businesses.length ?? 0) > 1 && !business && <td className="whitespace-nowrap px-3 py-2.5"><span className="inline-flex items-center gap-1.5 text-ink"><span className="h-2 w-2 rounded-full" style={{ background: b?.color }} />{b?.name}</span></td>}
                          <td className="whitespace-nowrap px-3 py-2.5 text-ink-muted"><SourceIcon source={l.source} />{SOURCE_LABEL[l.source]}{l.utmCampaign ? <span className="block text-body-sm text-ink-faint">{l.utmCampaign}</span> : null}</td>
                          <td className="px-3 py-2.5"><Badge tone={STATUS_TONE[l.status]}>{STATUS_LABEL[l.status]}</Badge></td>
                          <td className="whitespace-nowrap px-3 py-2.5">{l.assignee ? <span className="text-ink">{l.assignee.id === user?.id ? 'Me' : l.assignee.name}</span> : <span className="text-ink-faint">Not assigned</span>}</td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-ink-muted" title={when(l.createdAt)}>{ago(l.createdAt)}</td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-ink-muted" title={when(l.lastActivityAt)}>{ago(l.lastActivityAt)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {data && data.total > data.pageSize && (
              <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-body-sm text-ink-muted">
                <span>{(page - 1) * data.pageSize + 1}–{Math.min(page * data.pageSize, data.total)} of {data.total}</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setParam({ page: String(page - 1) })}>Previous</Button>
                  <Button size="sm" variant="secondary" disabled={page * data.pageSize >= data.total} onClick={() => setParam({ page: String(page + 1) })}>Next</Button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {openId && meta && <LeadPanel id={openId} meta={meta} onClose={() => setParam({ lead: null, page: params.get('page') })} onChanged={load} />}
      {adding && meta && <AddLeadModal meta={meta} defaultBusiness={business} onClose={() => setAdding(false)} onAdded={(id) => { setAdding(false); load(); setParam({ lead: id }) }} />}
      {importing && meta && <ImportLeadsModal meta={meta} defaultBusiness={business} onClose={() => setImporting(false)} onDone={() => { setImporting(false); load() }} />}
    </div>
  )
}

function QuickView({ label, value, active, onClick, tone, hint }: { label: string; value: number; active: boolean; onClick: () => void; tone?: 'primary' | 'danger' | 'success'; hint?: string }) {
  return (
    <button type="button" onClick={onClick} title={hint} className={cn('rounded-card border bg-card p-4 text-left shadow-xs transition-all hover:-translate-y-px hover:shadow-sm', active ? 'border-primary ring-2 ring-primary/15' : 'border-line')}>
      <span className="text-label-md uppercase text-ink-faint">{label}</span>
      <span className={cn('mt-1 block text-metric-lg tabular-nums', tone === 'danger' && value ? 'text-danger' : tone === 'primary' && value ? 'text-primary' : tone === 'success' ? 'text-success' : 'text-ink')}>{value}</span>
    </button>
  )
}

function SourceIcon({ source }: { source: string }) {
  const I = source === 'FORM' ? Globe : source === 'EMAIL' ? Mail : source === 'IMPORT' ? Upload : Phone
  return <I size={13} className="mr-1.5 inline -translate-y-px text-ink-faint" />
}

// ------------------------------------------------------------------ one lead

function LeadPanel({ id, meta, onClose, onChanged }: { id: string; meta: LeadsMeta; onClose: () => void; onChanged: () => void }) {
  const { addToast } = useToast()
  const { user } = useAuth()
  const [lead, setLead] = useState<LeadFull | null>(null)
  const [canManage, setCanManage] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [lost, setLost] = useState<string | null>(null)

  const load = useCallback(() => leadsApi.get(id).then((r) => { setLead(r.lead); setCanManage(r.canManage) }).catch((e) => setErr(apiErrorText(e, 'Could not open this lead'))), [id])
  useEffect(() => { setLead(null); setErr(''); setEditing(false); void load() }, [load])
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !editing) onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose, editing])

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true)
    try { await fn(); await load(); onChanged(); if (ok) addToast({ type: 'success', message: ok }) } catch (e) { addToast({ type: 'error', message: apiErrorText(e, 'Could not save') }) } finally { setBusy(false) }
  }
  const biz: MetaBusiness | undefined = meta.businesses.find((b) => b.id === lead?.businessId)

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Lead">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-slate-900/20 backdrop-blur-[1px]" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-[560px] animate-slide-in-right flex-col border-l border-line bg-card shadow-overlay">
        {!lead ? (
          <div className="p-6">{err ? <EmptyState title="Could not open this lead" hint={err} /> : <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-card bg-slate-100" />)}</div>}</div>
        ) : (
          <>
            <header className="flex items-start gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-body-sm text-ink-muted"><span className="h-2 w-2 rounded-full" style={{ background: lead.business.color }} />{lead.business.name} · <SourceIcon source={lead.source} />{SOURCE_LABEL[lead.source]} · {ago(lead.createdAt)}</p>
                <h2 className="mt-1 truncate text-headline-md text-ink">{lead.name || lead.organization || lead.email || lead.phone || 'Lead'}</h2>
                {lead.organization && lead.organization !== lead.name && <p className="truncate text-body-md text-ink-muted">{lead.organization}</p>}
              </div>
              <button type="button" onClick={onClose} className="rounded-btn p-1.5 text-ink-muted hover:bg-slate-100 hover:text-ink" aria-label="Close"><X size={18} /></button>
            </header>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
              {lead.late && (
                <p className="flex items-center gap-2 rounded-btn border border-danger/30 bg-danger/5 px-3 py-2 text-body-sm text-danger"><AlertTriangle size={15} />{lead.late === 'assign' ? 'Waiting too long for a rep.' : 'Given out, but nobody has got in touch yet.'}</p>
              )}

              {/* Status */}
              <div>
                <p className="mb-1.5 text-label-md uppercase text-ink-faint">Status</p>
                <div className="flex flex-wrap gap-1.5">
                  {meta.statuses.map((s) => (
                    <button key={s} type="button" disabled={busy} onClick={() => (s === 'LOST' ? setLost('') : s !== lead.status && run(() => leadsApi.update(lead.id, { status: s })))}
                      className={cn('h-8 rounded-full border px-3 text-body-sm font-medium transition-colors', lead.status === s ? 'border-transparent bg-ink text-card' : 'border-line text-ink-muted hover:border-line-strong hover:text-ink')}>
                      {STATUS_LABEL[s]}
                    </button>
                  ))}
                </div>
                {lost !== null && (
                  <div className="mt-2 flex gap-2">
                    <input autoFocus value={lost} onChange={(e) => setLost(e.target.value)} placeholder="Why was it lost? (optional)" className="h-9 flex-1 rounded-btn border border-line bg-card px-3 text-body-md" />
                    <Button size="sm" variant="danger" disabled={busy} onClick={() => run(() => leadsApi.update(lead.id, { status: 'LOST', lostReason: lost || null })).then(() => setLost(null))}>Mark lost</Button>
                    <Button size="sm" variant="ghost" onClick={() => setLost(null)}>Cancel</Button>
                  </div>
                )}
                {lead.status === 'LOST' && lead.lostReason && <p className="mt-1.5 text-body-sm text-ink-muted">Lost: {lead.lostReason}</p>}
              </div>

              {/* Assigned to */}
              <div>
                <p className="mb-1.5 text-label-md uppercase text-ink-faint">Assigned to</p>
                {canManage ? (
                  <select value={lead.assigneeId ?? ''} disabled={busy} onChange={(e) => run(() => leadsApi.assign(lead.id, e.target.value || null), e.target.value ? 'Assigned' : 'Taken back')} className="h-9 w-full rounded-btn border border-line bg-card px-2.5 text-body-md text-ink">
                    <option value="">Not assigned</option>
                    {(biz?.members ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}{p.id === user?.id ? ' (me)' : ''}{p.role === 'MANAGER' ? ' · manager' : ''}</option>)}
                  </select>
                ) : (
                  <p className="text-body-md text-ink">{lead.assignee ? (lead.assignee.id === user?.id ? 'Me' : lead.assignee.name) : 'Not assigned'}</p>
                )}
              </div>

              {/* Contact */}
              <div className="rounded-card border border-line">
                <div className="flex items-center justify-between border-b border-line px-3.5 py-2">
                  <p className="text-label-md uppercase text-ink-faint">Contact</p>
                  <button type="button" onClick={() => setEditing(true)} className="text-body-sm font-medium text-primary hover:underline">Edit</button>
                </div>
                <dl className="divide-y divide-line/70 text-body-md">
                  <Row label="Phone" value={lead.phone} href={lead.phone ? `tel:${lead.phone.replace(/[^\d+]/g, '')}` : undefined} />
                  <Row label="Email" value={lead.email} href={lead.email ? `mailto:${lead.email}` : undefined} />
                  <Row label="Location" value={lead.location} />
                  {lead.value != null && <Row label="Value" value={lead.value.toLocaleString()} />}
                </dl>
                <div className="flex gap-2 border-t border-line p-2.5">
                  <Button size="sm" variant="secondary" leadingIcon={<PhoneCall size={14} />} disabled={busy} onClick={() => run(() => leadsApi.addEvent(lead.id, 'CALL', note.trim()).then(() => setNote('')), 'Call logged')}>Log a call</Button>
                  <Button size="sm" variant="secondary" leadingIcon={<Mail size={14} />} disabled={busy} onClick={() => run(() => leadsApi.addEvent(lead.id, 'EMAIL', note.trim()).then(() => setNote('')), 'Email logged')}>Log an email</Button>
                </div>
              </div>

              {lead.message && (
                <div>
                  <p className="mb-1.5 text-label-md uppercase text-ink-faint">Their message</p>
                  <p className="whitespace-pre-wrap rounded-card bg-slate-50 px-3.5 py-3 text-body-md text-ink dark:bg-white/[0.03]">{lead.message}</p>
                </div>
              )}

              <div>
                <p className="mb-1.5 text-label-md uppercase text-ink-faint">Where it came from</p>
                <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-body-sm">
                  <Detail label="Source" value={SOURCE_LABEL[lead.source]} />
                  <Detail label="From" value={lead.sourceDetail} />
                  <Detail label="Campaign" value={lead.utmCampaign} />
                  <Detail label="UTM source" value={[lead.utmSource, lead.utmMedium].filter(Boolean).join(' / ') || null} />
                  <Detail label="Keyword" value={lead.utmTerm} />
                  <Detail label="Google click" value={lead.gclid ? 'Yes (gclid)' : null} />
                  <Detail label="Added by" value={lead.createdBy?.name} />
                </dl>
              </div>

              {/* Note */}
              <div>
                <TextArea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Add a note (or what was said on the call, then press Log a call)" />
                <div className="mt-2 flex justify-end"><Button size="sm" leadingIcon={<MessageSquareText size={14} />} disabled={busy || !note.trim()} onClick={() => run(() => leadsApi.addEvent(lead.id, 'NOTE', note.trim()).then(() => setNote('')))}>Add note</Button></div>
              </div>

              {/* Timeline */}
              <div>
                <p className="mb-2 text-label-md uppercase text-ink-faint">History</p>
                <ol className="relative space-y-3 border-l border-line pl-4">
                  {lead.events.map((e) => (
                    <li key={e.id} className="relative">
                      <span className={cn('absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-card', e.kind === 'CALL' || e.kind === 'EMAIL' ? 'bg-success' : e.kind === 'STATUS' ? 'bg-primary' : e.kind === 'REPEAT' ? 'bg-accent' : 'bg-slate-300')} />
                      <p className="text-body-sm text-ink"><b className="font-semibold">{eventTitle(e)}</b> <span className="text-ink-faint">· {e.user?.name ? `${e.user.name} · ` : ''}{when(e.createdAt)}</span></p>
                      {e.text && e.kind !== 'CREATED' && <p className="mt-0.5 whitespace-pre-wrap text-body-sm text-ink-muted">{e.text}</p>}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
            {editing && <EditLeadModal lead={lead} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void load(); onChanged() }} />}
          </>
        )}
      </aside>
    </div>
  )
}

function eventTitle(e: LeadFull['events'][number]): string {
  switch (e.kind) {
    case 'CREATED': return `Came in · ${e.text}`
    case 'REPEAT': return 'Got in touch again'
    case 'ASSIGNED': return e.toName ? `Given to ${e.toName}` : 'Taken back'
    case 'STATUS': return `${STATUS_LABEL[(e.data?.from ?? 'NEW') as LeadStatus]} → ${STATUS_LABEL[(e.data?.to ?? 'NEW') as LeadStatus]}`
    case 'CALL': return 'Call'
    case 'EMAIL': return 'Email'
    case 'NOTE': return 'Note'
    case 'EDIT': return e.text
  }
}

function Row({ label, value, href }: { label: string; value: string | null | undefined; href?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3.5 py-2">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right">{value ? (href ? <a href={href} className="font-medium text-primary hover:underline">{value}</a> : <span className="text-ink">{value}</span>) : <span className="text-ink-faint">—</span>}</dd>
    </div>
  )
}
function Detail({ label, value }: { label: string; value: ReactNode | null | undefined }) {
  if (!value) return null
  return <><dt className="text-ink-faint">{label}</dt><dd className="min-w-0 break-words text-ink">{value}</dd></>
}

function EditLeadModal({ lead, onClose, onSaved }: { lead: LeadFull; onClose: () => void; onSaved: () => void }) {
  const { addToast } = useToast()
  const [f, setF] = useState({ name: lead.name, phone: lead.phone ?? '', email: lead.email ?? '', organization: lead.organization ?? '', location: lead.location ?? '', value: lead.value != null ? String(lead.value) : '' })
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      await leadsApi.update(lead.id, { name: f.name, phone: f.phone || null, email: f.email || null, organization: f.organization || null, location: f.location || null, value: f.value ? Number(f.value) : null })
      onSaved()
    } catch (e) { addToast({ type: 'error', message: apiErrorText(e, 'Could not save') }) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title="Edit contact" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <TextField label="Company" value={f.organization} onChange={(e) => setF({ ...f, organization: e.target.value })} />
        <TextField label="Phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <TextField label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <TextField label="Location" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
        <TextField label="Deal value" inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value.replace(/[^\d.]/g, '') })} />
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ adding

function AddLeadModal({ meta, defaultBusiness, onClose, onAdded }: { meta: LeadsMeta; defaultBusiness: string; onClose: () => void; onAdded: (id: string) => void }) {
  const { addToast } = useToast()
  const options = meta.businesses.filter((b) => b.isActive && (meta.me.admin || b.myRole))
  const [businessId, setBusinessId] = useState(options.find((b) => b.id === defaultBusiness)?.id ?? options[0]?.id ?? '')
  const biz = options.find((b) => b.id === businessId)
  const manages = !!biz && (biz.myRole === 'MANAGER' || meta.me.admin)
  const inBiz = !!biz?.members.some((m) => m.id === meta.me.id)
  const [f, setF] = useState({ name: '', phone: '', email: '', organization: '', location: '', message: '' })
  const [assignTo, setAssignTo] = useState<string>(manages ? '' : 'me')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      const r = await leadsApi.add({ businessId, ...f, assignTo: manages ? (assignTo || null) : 'me' })
      addToast({ type: 'success', message: 'Lead added' })
      onAdded(r.lead.id)
    } catch (e) { addToast({ type: 'error', message: apiErrorText(e, 'Could not add the lead') }) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} size="lg" title="Add a lead" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy || !businessId || !(f.name.trim() || f.phone.trim() || f.email.trim())} leadingIcon={<UserPlus size={15} />}>Add lead</Button></>}>
      <p className="mb-4 text-body-md text-ink-muted">Someone called or walked in. Put down what you have; you can fill in the rest later.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {options.length > 1 && (
          <label className="sm:col-span-2"><span className="mb-1.5 block text-body-sm font-medium text-ink">Business</span>
            <select value={businessId} onChange={(e) => setBusinessId(e.target.value)} className="h-9 w-full rounded-btn border border-line bg-card px-2.5 text-body-md">{options.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          </label>
        )}
        <TextField label="Name" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <TextField label="Phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <TextField label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <TextField label="Company" value={f.organization} onChange={(e) => setF({ ...f, organization: e.target.value })} />
        <TextField label="Location" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
        {manages && (
          <label><span className="mb-1.5 block text-body-sm font-medium text-ink">Give it to</span>
            <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)} className="h-9 w-full rounded-btn border border-line bg-card px-2.5 text-body-md">
              <option value="">Nobody yet (assign later)</option>
              {inBiz && <option value="me">Me</option>}
              {biz!.members.filter((m) => m.id !== meta.me.id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
        )}
        <div className="sm:col-span-2"><TextArea label="What they need" rows={4} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></div>
      </div>
    </Modal>
  )
}

type Cell = string | number | null
const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '')

function ImportLeadsModal({ meta, defaultBusiness, onClose, onDone }: { meta: LeadsMeta; defaultBusiness: string; onClose: () => void; onDone: () => void }) {
  const { addToast } = useToast()
  const options = meta.businesses.filter((b) => b.isActive && (meta.me.admin || b.myRole === 'MANAGER'))
  const [businessId, setBusinessId] = useState(options.find((b) => b.id === defaultBusiness)?.id ?? options[0]?.id ?? '')
  const biz = options.find((b) => b.id === businessId)
  const [file, setFile] = useState<{ name: string; headers: string[]; rows: Cell[][] } | null>(null)
  const [mapping, setMapping] = useState<Record<string, string | null>>({})
  const [assigneeId, setAssigneeId] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ added: number; skipped: number; already: number } | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const pick = async (f: File | undefined) => {
    if (!f) return
    if (f.size > 20 * 1024 * 1024) { addToast({ type: 'error', message: 'The file is over 20 MB' }); return }
    try {
      const t = await readFile(f)
      const low = t.headers.map(norm)
      const m: Record<string, string | null> = {}
      for (const fld of LEAD_IMPORT_FIELDS) { const hit = fld.synonyms.map((s) => low.indexOf(norm(s))).find((i) => i >= 0); m[fld.key] = hit != null ? t.headers[hit] : null }
      // A full-name column makes first/last unnecessary.
      if (m.name) { m.firstName = null; m.lastName = null }
      setMapping(m)
      setFile({ name: f.name, ...t })
    } catch (e) { addToast({ type: 'error', message: (e as Error).message || 'Could not read the file' }) }
  }
  const go = async () => {
    if (!file) return
    setBusy(true)
    try { setResult(await leadsApi.import({ businessId, fileName: file.name, headers: file.headers, mapping, rows: file.rows, assigneeId: assigneeId || null })) } catch (e) { addToast({ type: 'error', message: apiErrorText(e, 'Could not import') }) } finally { setBusy(false) }
  }
  const ready = !!file && !!businessId && !!(mapping.email || mapping.phone)

  return (
    <Modal open onClose={result ? onDone : onClose} size="xl" title="Import leads"
      footer={result ? <Button onClick={onDone}>Done</Button> : <><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={go} disabled={!ready || busy}>{busy ? 'Importing…' : `Import ${file?.rows.length ?? ''} rows`}</Button></>}>
      {result ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Added" value={result.added} tone="text-success" />
          <Stat label="Already open (skipped)" value={result.already} />
          <Stat label="Empty rows (skipped)" value={result.skipped} />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label><span className="mb-1.5 block text-body-sm font-medium text-ink">Business</span>
              <select value={businessId} onChange={(e) => { setBusinessId(e.target.value); setAssigneeId('') }} className="h-9 w-full rounded-btn border border-line bg-card px-2.5 text-body-md">{options.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
            </label>
            <label><span className="mb-1.5 block text-body-sm font-medium text-ink">Give them to</span>
              <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="h-9 w-full rounded-btn border border-line bg-card px-2.5 text-body-md">
                <option value="">Nobody yet (assign later)</option>
                {(biz?.members ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
          </div>
          {!file ? (
            <button type="button" onClick={() => input.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void pick(e.dataTransfer.files[0]) }}
              className="flex w-full flex-col items-center gap-2 rounded-card border-2 border-dashed border-line-strong px-6 py-10 text-center hover:border-primary/50 hover:bg-primary/[0.03]">
              <Upload size={22} className="text-ink-faint" />
              <span className="text-body-lg font-semibold text-ink">Drop a CSV or Excel file here, or click to choose</span>
              <span className="text-body-sm text-ink-muted">Trade show lists, old CRM exports, bought lists. Up to 20,000 rows. Open leads with the same email or phone are skipped.</span>
            </button>
          ) : (
            <>
              <p className="text-body-md text-ink"><b>{file.name}</b> · {file.rows.length} rows <button type="button" className="ml-2 text-primary hover:underline" onClick={() => setFile(null)}>Choose another</button></p>
              <div className="grid gap-x-4 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {LEAD_IMPORT_FIELDS.map((fld) => (
                  <label key={fld.key}><span className="mb-1 block text-body-sm font-medium text-ink">{fld.label}{(fld.key === 'email' || fld.key === 'phone') && <span className="text-ink-faint"> (email or phone needed)</span>}</span>
                    <select value={mapping[fld.key] ?? ''} onChange={(e) => setMapping({ ...mapping, [fld.key]: e.target.value || null })} className="h-9 w-full rounded-btn border border-line bg-card px-2.5 text-body-md">
                      <option value="">Not in this file</option>
                      {file.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              <div className="overflow-x-auto rounded-card border border-line">
                <table className="w-full text-body-sm"><thead className="bg-slate-50 dark:bg-white/[0.03]"><tr>{file.headers.slice(0, 8).map((h) => <th key={h} className="px-2.5 py-1.5 text-left font-semibold text-ink-muted">{h}</th>)}</tr></thead>
                  <tbody>{file.rows.slice(0, 4).map((r, i) => <tr key={i} className="border-t border-line">{r.slice(0, 8).map((c, j) => <td key={j} className="max-w-[180px] truncate px-2.5 py-1.5 text-ink">{c ?? ''}</td>)}</tr>)}</tbody>
                </table>
              </div>
            </>
          )}
          <input ref={input} type="file" accept=".csv,.xlsx,.xls,text/csv" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
        </div>
      )}
    </Modal>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return <div className="rounded-card border border-line p-4"><p className="text-label-md uppercase text-ink-faint">{label}</p><p className={cn('mt-1 text-metric-lg tabular-nums text-ink', tone)}>{value}</p></div>
}
