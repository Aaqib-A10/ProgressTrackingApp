import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ChevronLeft, ChevronRight, Columns3, Download, Flag, Inbox, Phone, Plus, Search, Upload, X } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { EmptyState } from '../../../components/ui/EmptyState'
import { TextField } from '../../../components/ui/Input'
import { useToast } from '../../../components/ui/Toast'
import { apiErrorText } from '../../../lib/api'
import { cn } from '../../../lib/cn'
import { ago, fmtDate, leadsApi, leadTitle, OWNER_LABEL, SOURCE_LABEL, type LeadList, type LeadRow, type ListParams, type MetaBusiness } from '../../../lib/leadsApi'
import { Avatar, BusinessPicker, FactsMeter, PageHeader, Select, StatusPill, useBusiness, useLeadsMeta } from './shared'
import { AddLeadModal } from './AddLeadModal'
import { ImportModal } from './ImportModal'

/**
 * Leads: the table like LeadWise. Filters live in the address (a filtered view is a link), the
 * columns are chosen per person, the status and the assignee change in the row, and a manager
 * downloads the filtered view. A CMR business adds the five facts, the Jesse flag and the owner.
 */

type Col = { key: string; label: string; cmr?: boolean; manager?: boolean; default?: boolean }
const COLUMNS: Col[] = [
  { key: 'lead', label: 'Lead', default: true }, { key: 'company', label: 'Company', default: true }, { key: 'industry', label: 'Segment / Industry', default: true }, { key: 'state', label: 'State', default: true },
  { key: 'status', label: 'Status', default: true }, { key: 'assignee', label: 'Assigned To', default: true }, { key: 'owner', label: 'Owner', cmr: true }, { key: 'facts', label: 'Five facts', cmr: true, default: true },
  { key: 'nextStep', label: 'Next Step', default: true }, { key: 'nextStepDate', label: 'Next Step Date', default: true }, { key: 'volume', label: 'Volume (lb)', cmr: true }, { key: 'vendor', label: 'Current Vendor', cmr: true }, { key: 'pays', label: 'Pays Today', cmr: true },
  { key: 'calls', label: 'Calls' }, { key: 'lastCall', label: 'Last Call' }, { key: 'tasks', label: 'Tasks', default: true }, { key: 'source', label: 'Source' }, { key: 'tags', label: 'Tags' }, { key: 'updated', label: 'Last Updated', default: true }, { key: 'created', label: 'Created' },
]
const COL_KEY = 'leads.columns.v2'

function useColumns(cmr: boolean): [string[], (c: string[]) => void] {
  const [cols, setCols] = useState<string[]>(() => { try { const s = localStorage.getItem(COL_KEY); if (s) return JSON.parse(s) as string[] } catch { /* ignore */ } return COLUMNS.filter((c) => c.default).map((c) => c.key) })
  const set = (c: string[]) => { setCols(c); try { localStorage.setItem(COL_KEY, JSON.stringify(c)) } catch { /* ignore */ } }
  return [cols.filter((k) => COLUMNS.some((c) => c.key === k && (cmr || !c.cmr))), set]
}

export default function Leads() {
  const nav = useNavigate()
  const { addToast } = useToast()
  const { meta } = useLeadsMeta()
  const { business, businesses, all } = useBusiness()
  const [params, setParams] = useSearchParams()
  const [data, setData] = useState<LeadList | null>(null)
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState(params.get('q') ?? '')
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const [colsOpen, setColsOpen] = useState(false)
  const [moreFilters, setMoreFilters] = useState(false)
  const cmr = !!business && business.kind === 'CMR' && !all
  const [cols, setCols] = useColumns(cmr)
  const canManage = !!meta?.me.admin || (all ? (meta?.me.managerOf.length ?? 0) > 0 : business?.myRole === 'MANAGER')
  const page = Number(params.get('page') ?? 1) || 1

  const listParams = useMemo((): ListParams => ({
    business: all ? undefined : business?.id, q: params.get('q') ?? undefined, status: params.get('status') ?? 'open', assignee: params.get('assignee') ?? undefined, source: params.get('source') ?? undefined,
    industry: params.get('industry') ?? undefined, state: params.get('state') ?? undefined, owner: params.get('owner') ?? undefined, tag: params.get('tag') ?? undefined,
    flag: params.get('flag') ?? undefined, overdue: params.get('overdue') ?? undefined, belowMin: params.get('belowMin') ?? undefined, late: params.get('late') ?? undefined, prohibited: params.get('prohibited') ?? undefined, active: params.get('active') ?? undefined,
    from: params.get('from') ?? undefined, to: params.get('to') ?? undefined, sort: params.get('sort') ?? undefined, page,
  }), [params, business, all, page])

  const load = useCallback(() => {
    if (!business && !all) { setLoading(false); return }
    setLoading(true)
    leadsApi.list(listParams).then(setData).catch((e) => addToast({ type: 'error', message: apiErrorText(e, 'Could not load leads') })).finally(() => setLoading(false))
  }, [listParams, business, all, addToast])
  useEffect(() => { load() }, [load])

  const setParam = (patch: Record<string, string | null>) => setParams((p) => { const n = new URLSearchParams(p); for (const [k, v] of Object.entries(patch)) { if (v == null || v === '') n.delete(k); else n.set(k, v) } if (!('page' in patch)) n.delete('page'); return n })
  const searchTimer = useRef<number>()
  const onSearch = (v: string) => { setQ(v); window.clearTimeout(searchTimer.current); searchTimer.current = window.setTimeout(() => setParam({ q: v || null }), 350) }

  const status = params.get('status') ?? 'open'
  const pipeline = business?.pipeline ?? []
  const members = business?.members ?? []
  const activeFilters = ['assignee', 'industry', 'state', 'owner', 'tag', 'flag', 'overdue', 'belowMin', 'late', 'prohibited', 'source', 'from', 'to'].filter((k) => params.get(k))

  if (!businesses.length) {
    return (
      <div className="mx-auto max-w-xl py-16">
        <EmptyState icon={<Inbox />} title="No leads for you yet" hint={meta?.me.admin ? 'Add a business under Lead Settings, then its people.' : 'Ask your manager to add you to a business under Lead Settings.'} action={meta?.me.admin ? <Link to="/app/leads/settings"><Button size="sm">Lead Settings</Button></Link> : undefined} />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-[1800px] space-y-4">
      <PageHeader title="Leads" hint={all ? 'Every business you work in' : business ? `${business.name}${cmr ? ' · one record per company, calls underneath' : ''}` : ''}
        actions={<>
          <BusinessPicker allowAll />
          {canManage && <a href={leadsApi.exportUrl(listParams)} download><Button size="sm" variant="secondary" leadingIcon={<Download size={15} />}>Export</Button></a>}
          {canManage && !all && <Button size="sm" variant="secondary" leadingIcon={<Upload size={15} />} onClick={() => setImporting(true)}>Import</Button>}
          {!all && <Button size="sm" leadingIcon={<Plus size={15} />} onClick={() => setAdding(true)}>Add lead</Button>}
        </>} />

      {/* Quick counts */}
      {data && (
        <div className="flex flex-wrap gap-2">
          <Quick label="Open" value={Object.entries(data.counts.byStatus).filter(([k]) => (pipeline.length ? pipeline.find((s) => s.key === k)?.open : !['WON', 'LOST', 'SPAM', 'CLOSED_WON', 'CLOSED_LOST', 'NOT_A_FIT', 'EXISTING_CUSTOMER', 'REFERRAL_PARTNER'].includes(k))).reduce((a, [, n]) => a + n, 0)} active={status === 'open' && !activeFilters.length} onClick={() => setParams(new URLSearchParams(all ? { business: 'all' } : business ? { business: business.id } : {}))} />
          <Quick label="Mine" value={data.counts.mine} active={params.get('assignee') === 'me'} onClick={() => setParam({ assignee: params.get('assignee') === 'me' ? null : 'me', status: 'open' })} />
          {canManage && <Quick label="Unassigned" value={data.counts.unassigned} active={params.get('assignee') === 'none'} tone="warning" onClick={() => setParam({ assignee: params.get('assignee') === 'none' ? null : 'none', status: 'open' })} />}
          <Quick label="Overdue" value={data.counts.overdue} active={!!params.get('overdue')} tone="danger" onClick={() => setParam({ overdue: params.get('overdue') ? null : '1', status: 'open' })} />
          {cmr && <Quick label="Waiting on Jesse" value={data.counts.waiting} active={!!params.get('flag')} tone="accent" onClick={() => setParam({ flag: params.get('flag') ? null : '1', status: 'all' })} />}
          {data.counts.late > 0 && <Quick label="Late" value={data.counts.late} active={!!params.get('late')} tone="danger" onClick={() => setParam({ late: params.get('late') ? null : '1', status: 'open' })} />}
        </div>
      )}

      {/* Filters */}
      <div className="rounded-card border border-line bg-card p-3 shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
            <TextField value={q} onChange={(e) => onSearch(e.target.value)} placeholder="Search company, contact, phone, email, website, vendor…" className="pl-8" aria-label="Search" />
          </div>
          <Select value={status} onChange={(e) => setParam({ status: e.target.value })} aria-label="Status">
            <option value="open">Open statuses</option>
            {pipeline.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            <option value="all">All statuses</option>
          </Select>
          {canManage && !all && (
            <Select value={params.get('assignee') ?? ''} onChange={(e) => setParam({ assignee: e.target.value || null })} aria-label="Agent">
              <option value="">All agents</option><option value="me">Me</option><option value="none">Unassigned</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          )}
          {!all && (
            <Select value={params.get('industry') ?? ''} onChange={(e) => setParam({ industry: e.target.value || null })} aria-label={cmr ? 'Segment' : 'Industry'}>
              <option value="">{cmr ? 'All segments' : 'All industries'}</option>
              {(business?.settings.segments ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          )}
          {!all && (
            <Select value={params.get('state') ?? ''} onChange={(e) => setParam({ state: e.target.value || null })} aria-label="State">
              <option value="">All states</option>
              {(business?.settings.states ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          )}
          <Select value={params.get('active') ?? ''} onChange={(e) => setParam({ active: e.target.value || null, status: e.target.value ? 'all' : 'open' })} aria-label="Active">
            <option value="">Active + closed</option><option value="1">Active only</option><option value="0">Closed only</option>
          </Select>
          <button type="button" onClick={() => setMoreFilters((v) => !v)} className={cn('h-9 rounded-btn border px-3 text-body-sm font-medium', moreFilters || activeFilters.length ? 'border-primary bg-primary/[0.06] text-primary' : 'border-line text-ink-muted hover:text-ink')}>More{activeFilters.length ? ` (${activeFilters.length})` : ''}</button>
          <div className="relative ml-auto">
            <Button size="sm" variant="secondary" leadingIcon={<Columns3 size={15} />} onClick={() => setColsOpen((v) => !v)}>Columns ({cols.length})</Button>
            {colsOpen && <ColumnsMenu cmr={cmr} cols={cols} onChange={setCols} onClose={() => setColsOpen(false)} />}
          </div>
        </div>
        {moreFilters && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
            {cmr && <Select value={params.get('owner') ?? ''} onChange={(e) => setParam({ owner: e.target.value || null })} aria-label="Owner"><option value="">Any owner</option>{(Object.keys(OWNER_LABEL) as (keyof typeof OWNER_LABEL)[]).map((k) => <option key={k} value={k}>{OWNER_LABEL[k]}</option>)}</Select>}
            <Select value={params.get('source') ?? ''} onChange={(e) => setParam({ source: e.target.value || null })} aria-label="Source"><option value="">Any source</option>{Object.entries(SOURCE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
            <Select value={params.get('sort') ?? 'newest'} onChange={(e) => setParam({ sort: e.target.value === 'newest' ? null : e.target.value })} aria-label="Sort"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="activity">Last activity</option><option value="nextStep">Next step date</option><option value="company">Company A–Z</option><option value="calls">Most calls</option></Select>
            <label className="flex items-center gap-1.5 text-body-sm text-ink"><span>Created</span><TextField type="date" value={params.get('from') ?? ''} onChange={(e) => setParam({ from: e.target.value || null })} className="w-36" /><span>to</span><TextField type="date" value={params.get('to') ?? ''} onChange={(e) => setParam({ to: e.target.value || null })} className="w-36" /></label>
            {cmr && <Chip on={!!params.get('belowMin')} onClick={() => setParam({ belowMin: params.get('belowMin') ? null : '1' })}>Below minimum</Chip>}
            <Chip on={!!params.get('prohibited')} onClick={() => setParam({ prohibited: params.get('prohibited') ? null : '1', status: 'all' })}>{cmr ? 'Prohibited / customer' : 'Do not call'}</Chip>
            {activeFilters.length > 0 && <button type="button" className="inline-flex items-center gap-1 text-body-sm text-ink-muted hover:text-ink" onClick={() => setParams(new URLSearchParams(all ? { business: 'all' } : business ? { business: business.id } : {}))}><X size={13} />Clear filters</button>}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-card border border-line bg-card shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-body-sm">
            <thead className="sticky top-0 z-[1] bg-slate-50 text-[11.5px] uppercase tracking-wide text-ink-muted dark:bg-white/[0.03]">
              <tr>{cols.map((k) => <th key={k} className="whitespace-nowrap px-3 py-2.5 font-semibold">{COLUMNS.find((c) => c.key === k)?.label}</th>)}<th className="px-3 py-2.5 text-right font-semibold">Actions</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {loading && !data && Array.from({ length: 6 }).map((_, i) => <tr key={i}><td colSpan={cols.length + 1} className="px-3 py-3"><div className="h-5 animate-pulse rounded bg-slate-100 dark:bg-white/5" /></td></tr>)}
              {data?.leads.map((l) => <Row key={l.id} l={l} cols={cols} business={businesses.find((b) => b.id === l.businessId) ?? business} canManage={canManage} onOpen={() => nav(`/app/leads/${l.id}`)} onChanged={load} toast={addToast} />)}
              {data && !data.leads.length && <tr><td colSpan={cols.length + 1} className="px-3 py-12"><EmptyState compact icon={<Inbox />} title="No leads match" hint="Change the filters, or add a lead." /></td></tr>}
            </tbody>
          </table>
        </div>
        {data && data.total > data.pageSize && (
          <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-body-sm text-ink-muted">
            <span>{(page - 1) * data.pageSize + 1}–{Math.min(page * data.pageSize, data.total)} of {data.total}</span>
            <span className="flex gap-1"><Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setParam({ page: String(page - 1) })} leadingIcon={<ChevronLeft size={14} />}>Prev</Button><Button size="sm" variant="ghost" disabled={page * data.pageSize >= data.total} onClick={() => setParam({ page: String(page + 1) })} trailingIcon={<ChevronRight size={14} />}>Next</Button></span>
          </div>
        )}
        {data && data.total <= data.pageSize && data.total > 0 && <div className="border-t border-line px-4 py-2 text-body-sm text-ink-faint">{data.total} lead{data.total === 1 ? '' : 's'}</div>}
      </div>

      {adding && business && <AddLeadModal business={business} onClose={() => setAdding(false)} onAdded={(id) => { setAdding(false); nav(`/app/leads/${id}`) }} />}
      {importing && business && <ImportModal business={business} onClose={() => setImporting(false)} onDone={() => { setImporting(false); load() }} />}
    </div>
  )
}

function Quick({ label, value, active, onClick, tone }: { label: string; value: number; active: boolean; onClick: () => void; tone?: 'warning' | 'danger' | 'accent' }) {
  return (
    <button type="button" onClick={onClick} className={cn('inline-flex h-8 items-center gap-2 rounded-full border px-3 text-body-sm font-medium transition-colors', active ? 'border-ink bg-ink text-card' : 'border-line bg-card text-ink-muted hover:border-line-strong hover:text-ink')}>
      {label}<span className={cn('rounded-full px-1.5 text-[11px] font-bold tabular-nums', active ? 'bg-card/20' : tone === 'danger' && value ? 'bg-danger/10 text-danger' : tone === 'warning' && value ? 'bg-warning/15 text-amber-700' : tone === 'accent' && value ? 'bg-accent/15 text-accent' : 'bg-slate-100 text-ink dark:bg-white/10')}>{value}</span>
    </button>
  )
}
function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={cn('h-8 rounded-full border px-3 text-body-sm font-medium', on ? 'border-primary bg-primary/[0.08] text-primary' : 'border-line text-ink-muted hover:text-ink')}>{children}</button>
}

function ColumnsMenu({ cmr, cols, onChange, onClose }: { cmr: boolean; cols: string[]; onChange: (c: string[]) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h) }, [onClose])
  const list = COLUMNS.filter((c) => cmr || !c.cmr)
  return (
    <div ref={ref} className="absolute right-0 top-10 z-20 w-64 rounded-card border border-line bg-card p-2 shadow-lg">
      <div className="flex items-center justify-between px-2 py-1 text-[11.5px] font-semibold uppercase tracking-wide text-ink-muted"><span>Columns</span><button type="button" className="text-primary normal-case tracking-normal" onClick={() => onChange(COLUMNS.filter((c) => c.default && (cmr || !c.cmr)).map((c) => c.key))}>Reset</button></div>
      <ul className="max-h-80 overflow-auto">
        {list.map((c) => (
          <li key={c.key}><label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-body-sm hover:bg-slate-50 dark:hover:bg-white/5"><input type="checkbox" checked={cols.includes(c.key)} onChange={(e) => onChange(e.target.checked ? [...COLUMNS.filter((x) => cols.includes(x.key) || x.key === c.key).map((x) => x.key)] : cols.filter((k) => k !== c.key))} />{c.label}</label></li>
        ))}
      </ul>
    </div>
  )
}

function Row({ l, cols, business, canManage, onOpen, onChanged, toast }: { l: LeadRow; cols: string[]; business: MetaBusiness | null; canManage: boolean; onOpen: () => void; onChanged: () => void; toast: ReturnType<typeof useToast>['addToast'] }) {
  const [busy, setBusy] = useState(false)
  const pipeline = business?.pipeline ?? []
  const run = async (fn: () => Promise<unknown>, ok: string) => { setBusy(true); try { await fn(); toast({ type: 'success', message: ok }); onChanged() } catch (e) { toast({ type: 'error', message: apiErrorText(e, 'Could not save') }) } finally { setBusy(false) } }
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()
  const cell = (k: string) => {
    switch (k) {
      case 'lead': return (
        <div className="flex min-w-[180px] items-center gap-2.5">
          <Avatar name={l.name || l.organization || '?'} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 truncate font-semibold text-ink">{l.name || <span className="text-ink-faint">No contact name</span>}{l.prohibited && <Badge tone="danger">Prohibited</Badge>}{l.existingCustomer && <Badge>Customer</Badge>}{l.jesseInputNeeded && <span title="Waiting on Jesse"><Flag size={13} className="text-orange-500" /></span>}</div>
            <div className="truncate text-[11.5px] text-ink-muted">{[l.email, l.phone].filter(Boolean).join(' · ') || '—'}</div>
          </div>
        </div>)
      case 'company': return <span className="font-medium text-ink">{l.organization ?? '—'}</span>
      case 'industry': return l.industry ?? '—'
      case 'state': return l.state ?? '—'
      case 'status': return pipeline.length ? (
        <select value={l.status} disabled={busy || !l.open && !canManage} onClick={stop} onChange={(e) => { e.stopPropagation(); run(() => leadsApi.update(l.id, { status: e.target.value }), `Status: ${pipeline.find((s) => s.key === e.target.value)?.label}`) }} className="h-7 rounded-full border-0 bg-transparent pr-6 text-[12px] font-semibold focus:outline-none" style={{ color: pipeline.find((s) => s.key === l.status)?.color }} aria-label="Status">
          {pipeline.filter((s) => s.key !== 'QUALIFIED' || business?.kind !== 'CMR' || l.status === 'QUALIFIED').map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>) : <StatusPill status={l.status} label={l.statusLabel} />
      case 'assignee': return canManage && business ? (
        <select value={l.assigneeId ?? ''} disabled={busy} onClick={stop} onChange={(e) => { e.stopPropagation(); run(() => leadsApi.assign(l.id, e.target.value || null), e.target.value ? 'Assigned' : 'Unassigned') }} className="h-7 max-w-[160px] rounded-btn border border-line bg-card px-1.5 text-[12px]" aria-label="Assigned to">
          <option value="">Unassigned</option>{business.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}{l.assignee && !business.members.some((m) => m.id === l.assigneeId) && <option value={l.assignee.id}>{l.assignee.name}</option>}
        </select>) : (l.assignee?.name ?? <span className="text-ink-faint">Unassigned</span>)
      case 'owner': return OWNER_LABEL[l.owner] ?? l.owner
      case 'facts': return <FactsMeter facts={l.facts} size="sm" />
      case 'nextStep': return <span className="block max-w-[220px] truncate" title={l.nextStep ?? ''}>{l.nextStep ?? '—'}</span>
      case 'nextStepDate': return l.nextStepDate ? <span className={cn('inline-flex items-center gap-1 whitespace-nowrap', l.overdue && 'font-semibold text-danger')}>{l.overdue && <AlertTriangle size={12} />}{fmtDate(l.nextStepDate)}</span> : '—'
      case 'volume': return l.lbsPerShipment || l.lbsPerMonth ? <span className={cn('tabular-nums', l.belowMin && 'text-purple-600')}>{l.lbsPerShipment ? `${l.lbsPerShipment.toLocaleString()}/load` : ''}{l.lbsPerShipment && l.lbsPerMonth ? ' · ' : ''}{l.lbsPerMonth ? `${l.lbsPerMonth.toLocaleString()}/mo` : ''}</span> : '—'
      case 'vendor': return l.currentVendor ?? '—'
      case 'pays': return l.paysUnit === 'NONE' ? 'Nothing' : l.paysToday != null ? `$${l.paysToday}${l.paysUnit === 'DRUM' ? '/drum' : '/lb'}` : '—'
      case 'calls': return <span className="inline-flex items-center gap-1 tabular-nums"><Phone size={12} className="text-ink-faint" />{l.callsCount}</span>
      case 'lastCall': return l.lastCallAt ? ago(l.lastCallAt) : '—'
      case 'tasks': return l.openTasks ? <Badge tone="primary">{l.openTasks}</Badge> : <span className="text-ink-faint">0</span>
      case 'source': return SOURCE_LABEL[l.source]
      case 'tags': return l.tags.length ? <span className="flex flex-wrap gap-1">{l.tags.map((t) => <span key={t} className="rounded bg-slate-100 px-1.5 text-[11px] dark:bg-white/10">{t}</span>)}</span> : '—'
      case 'updated': return <span title={new Date(l.lastActivityAt).toLocaleString()}>{ago(l.lastActivityAt)}</span>
      case 'created': return fmtDate(l.createdAt)
      default: return null
    }
  }
  return (
    <tr onClick={onOpen} className={cn('cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.03]', l.jesseInputNeeded && 'bg-orange-50/40 dark:bg-orange-500/5')}>
      {cols.map((k) => <td key={k} className="px-3 py-2.5 align-middle text-ink">{cell(k)}</td>)}
      <td className="px-3 py-2.5 text-right">
        <span className="inline-flex gap-1" onClick={stop}>
          {l.phone && <a href={`tel:${l.phoneE164 ?? l.phone}`} className="rounded-btn p-1.5 text-ink-faint hover:bg-slate-100 hover:text-primary" title="Call" aria-label="Call"><Phone size={15} /></a>}
          <Button size="sm" variant="ghost" onClick={onOpen}>Open</Button>
        </span>
      </td>
    </tr>
  )
}

export { leadTitle }
