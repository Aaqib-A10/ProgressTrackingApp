import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Plus, Trash2, Pencil, TriangleAlert, Bell, BellOff, Search } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { Badge, type BadgeTone } from '../../../components/ui/Badge'
import { DataTable, type Column } from '../../../components/DataTable'
import { useToast } from '../../../components/ui/Toast'
import { useAuth } from '../../../lib/auth'
import {
  listBids, createBid, updateBid, deleteBid,
  BID_STATUS_LABEL, BID_TYPE_LABEL, SUBMISSION_LABEL,
  type Bid, type BidStatus, type BidType, type BidSubmissionType, type BidInput, type BidSummary,
} from '../../../lib/bidApi'

const STATUSES: BidStatus[] = ['ACTIVE', 'SUBMITTED', 'WON', 'LOST']
const TYPES: BidType[] = ['RFQ', 'RFP', 'BID']
const SUBMISSION_TYPES: BidSubmissionType[] = ['PHYSICAL', 'EMAIL', 'PORTAL']

const STATUS_TONE: Record<BidStatus, BadgeTone> = { ACTIVE: 'primary', SUBMITTED: 'warning', WON: 'success', LOST: 'danger' }

// Colour the inline status select by state — Won green, Lost red, etc.
const STATUS_SELECT_CLS: Record<BidStatus, string> = {
  ACTIVE: 'border-primary/40 bg-primary/10 text-primary',
  SUBMITTED: 'border-warning/40 bg-warning/10 text-warning',
  WON: 'border-success/50 bg-success/10 text-success',
  LOST: 'border-danger/50 bg-danger/10 text-danger',
}

const inputCls =
  'h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink placeholder:text-ink-muted focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'

function errMsg(e: unknown, fallback: string): string {
  const m = (e as { message?: string })?.message
  if (!m) return fallback
  try { return (JSON.parse(m) as { error?: string }).error || fallback } catch { return m }
}
const money = (v: number | null | undefined): string =>
  v == null ? '—' : v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
function fmtDue(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}
/** Due within 48h and still an open opportunity. */
function isUrgent(b: Bid): boolean {
  if (b.status !== 'ACTIVE') return false
  const diff = new Date(b.dueDate).getTime() - Date.now()
  return diff <= 48 * 3600 * 1000
}

export default function BidTracker() {
  const { user } = useAuth()
  const { addToast } = useToast()
  const [bids, setBids] = useState<Bid[] | null>(null)
  const [summary, setSummary] = useState<BidSummary | null>(null)
  const [filter, setFilter] = useState<BidStatus | null>(null)
  const [query, setQuery] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [editFor, setEditFor] = useState<Bid | null>(null)
  // A bid mid-way through a decision that needs extra input (Won/Lost).
  const [decideFor, setDecideFor] = useState<{ bid: Bid; status: 'WON' | 'LOST' } | null>(null)

  function reload() {
    listBids()
      .then((r) => { setBids(r.bids); setSummary(r.summary) })
      .catch(() => { setBids([]); setSummary(null) })
  }
  useEffect(reload, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (bids ?? []).filter((b) => {
      if (filter && b.status !== filter) return false
      if (!q) return true
      return [b.title, b.company, b.district, b.agentName, `#${b.number}`].some((f) => f?.toLowerCase().includes(q))
    })
  }, [bids, filter, query])

  /** Inline status change from the table. Won/Lost open a prompt for extra input first. */
  async function changeStatus(bid: Bid, status: BidStatus) {
    if (status === bid.status) return
    if (status === 'WON' || status === 'LOST') { setDecideFor({ bid, status }); return }
    try {
      await updateBid(bid.id, { status })
      addToast({ type: 'success', message: `Marked ${BID_STATUS_LABEL[status]}.` })
      reload()
    } catch (e) {
      addToast({ type: 'error', message: errMsg(e, 'Could not update status.') })
    }
  }

  async function remove(bid: Bid) {
    if (!confirm(`Delete bid "${bid.title}"?`)) return
    try {
      await deleteBid(bid.id)
      addToast({ type: 'success', message: 'Bid deleted.' })
      reload()
    } catch (e) {
      addToast({ type: 'error', message: errMsg(e, 'Could not delete.') })
    }
  }

  const columns: Column<Bid>[] = [
    { key: 'title', header: 'Bid Title', render: (b) => (
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 font-medium text-ink">
          {b.reminderSet && <Bell size={13} className="shrink-0 text-primary" />}
          <span className="truncate">{b.title}</span>
        </div>
        <span className="text-body-sm text-ink-muted">#{b.number}{b.submissionType ? ` · ${SUBMISSION_LABEL[b.submissionType]}` : ''}</span>
      </div>
    ) },
    { key: 'company', header: 'Company', render: (b) => b.company },
    { key: 'type', header: 'Type', render: (b) => <Badge tone="neutral">{BID_TYPE_LABEL[b.type]}</Badge> },
    { key: 'district', header: 'District', render: (b) => b.district || '—' },
    { key: 'agent', header: 'Agent', render: (b) => b.agentName },
    { key: 'dueDate', header: 'Due Date', render: (b) => {
      const urgent = isUrgent(b)
      return (
        <span className={'inline-flex items-center gap-1 whitespace-nowrap ' + (urgent ? 'font-semibold text-danger' : 'text-ink')}>
          {urgent && <TriangleAlert size={13} />}{fmtDue(b.dueDate)}
        </span>
      )
    } },
    { key: 'priceQuoted', header: 'Price Quoted', align: 'right', render: (b) => <span className="tabular-nums">{money(b.priceQuoted)}</span> },
    { key: 'awardedPrice', header: 'Awarded Price', align: 'right', render: (b) => {
      const tone = b.awardedPrice == null ? 'text-ink-muted' : b.status === 'LOST' ? 'font-semibold text-danger' : 'font-semibold text-success'
      return <span className={'tabular-nums ' + tone}>{money(b.awardedPrice)}</span>
    } },
    { key: 'status', header: 'Status', render: (b) => (
      <select
        value={b.status}
        onChange={(e) => changeStatus(b, e.target.value as BidStatus)}
        onClick={(e) => e.stopPropagation()}
        className={'h-9 rounded-btn border px-2 text-body-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/20 ' + STATUS_SELECT_CLS[b.status]}
      >
        {STATUSES.map((s) => <option key={s} value={s} className="bg-card text-ink">{BID_STATUS_LABEL[s]}</option>)}
      </select>
    ) },
    { key: 'actions', header: '', align: 'right', render: (b) => (
      <div className="flex items-center justify-end gap-0.5">
        <button onClick={() => setEditFor(b)} className="rounded p-1.5 text-ink-muted hover:bg-slate-100 hover:text-primary" aria-label="Edit">
          <Pencil size={15} />
        </button>
        <button onClick={() => remove(b)} className="rounded p-1.5 text-ink-muted hover:bg-danger/10 hover:text-danger" aria-label="Delete">
          <Trash2 size={15} />
        </button>
      </div>
    ) },
  ]

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">Bid Tracker</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">Track ITAD asset-disposal opportunities from lead to award.</p>
        </div>
        <Button leadingIcon={<Plus size={16} />} onClick={() => setAddOpen(true)}>New bid</Button>
      </div>

      {/* Interactive status filter cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Active Opportunities" count={summary?.active ?? 0} tone="primary" active={filter === 'ACTIVE'} onClick={() => setFilter(filter === 'ACTIVE' ? null : 'ACTIVE')} />
        <MetricCard label="Submitted" count={summary?.submitted ?? 0} tone="warning" active={filter === 'SUBMITTED'} onClick={() => setFilter(filter === 'SUBMITTED' ? null : 'SUBMITTED')} />
        <MetricCard label="Won" count={summary?.won ?? 0} sub={money(summary?.wonValue ?? 0)} tone="success" active={filter === 'WON'} onClick={() => setFilter(filter === 'WON' ? null : 'WON')} />
        <MetricCard label="Lost" count={summary?.lost ?? 0} tone="danger" active={filter === 'LOST'} onClick={() => setFilter(filter === 'LOST' ? null : 'LOST')} />
      </div>

      <Card flush>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search bids by title, company, district or agent…"
              className="h-9 w-full rounded-btn border border-line bg-bg pl-9 pr-3 text-body-sm text-ink placeholder:text-ink-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          {filter && (
            <span className="flex items-center gap-2 text-body-sm text-ink-muted">
              <Badge tone={STATUS_TONE[filter]}>{BID_STATUS_LABEL[filter]}</Badge>
              <button onClick={() => setFilter(null)} className="font-semibold text-primary hover:underline">Clear</button>
            </span>
          )}
        </div>
        {!bids ? (
          <p className="px-4 py-8 text-center text-body-md text-ink-muted">Loading…</p>
        ) : (
          <DataTable columns={columns} rows={filtered} getRowId={(b) => b.id} emptyMessage={filter ? `No ${BID_STATUS_LABEL[filter]} bids.` : 'No bids yet. Add your first opportunity.'} />
        )}
      </Card>

      {addOpen && <BidFormModal agentName={user?.name ?? ''} onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); reload() }} />}
      {editFor && <BidFormModal bid={editFor} agentName={user?.name ?? ''} onClose={() => setEditFor(null)} onSaved={() => { setEditFor(null); reload() }} />}
      {decideFor && (
        <DecisionModal
          bid={decideFor.bid}
          status={decideFor.status}
          onClose={() => setDecideFor(null)}
          onSaved={() => { setDecideFor(null); reload() }}
        />
      )}
    </div>
  )
}

function MetricCard({ label, count, sub, tone, active, onClick }: { label: string; count: number; sub?: string; tone: BadgeTone; active: boolean; onClick: () => void }) {
  const accent = { primary: 'text-primary', warning: 'text-warning', success: 'text-success', danger: 'text-danger', neutral: 'text-ink', accent: 'text-accent' }[tone]
  const ring = { primary: 'ring-primary', warning: 'ring-warning', success: 'ring-success', danger: 'ring-danger', neutral: 'ring-ink', accent: 'ring-accent' }[tone]
  return (
    <button
      type="button"
      onClick={onClick}
      className={'rounded-card border bg-card p-4 text-left shadow-card transition-all hover:border-primary/40 ' + (active ? `border-transparent ring-2 ${ring}` : 'border-line')}
      aria-pressed={active}
    >
      <div className="text-body-sm font-medium text-ink-muted">{label}</div>
      <div className={'mt-1 text-display-lg tabular-nums ' + accent}>{count}</div>
      {sub && <div className="text-body-sm font-semibold text-ink">{sub}</div>}
    </button>
  )
}

/** Convert an ISO datetime to the `YYYY-MM-DDTHH:mm` a datetime-local input needs (local tz). */
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Create/edit form. Agent is auto-filled from the session (locked) on new bids. */
function BidFormModal({ bid, agentName, onClose, onSaved }: { bid?: Bid | null; agentName: string; onClose: () => void; onSaved: () => void }) {
  const { addToast } = useToast()
  const editing = !!bid
  const [title, setTitle] = useState(bid?.title ?? '')
  const [company, setCompany] = useState(bid?.company ?? '')
  const [type, setType] = useState<BidType>(bid?.type ?? 'RFQ')
  const [district, setDistrict] = useState(bid?.district ?? '')
  const [status, setStatus] = useState<BidStatus>(bid?.status ?? 'ACTIVE')
  const [dueDate, setDueDate] = useState(bid ? toLocalInput(bid.dueDate) : '')
  const [reminderSet, setReminderSet] = useState(bid?.reminderSet ?? true)
  const [submissionType, setSubmissionType] = useState<BidSubmissionType | null>(bid?.submissionType ?? null)
  const [priceQuoted, setPriceQuoted] = useState(bid?.priceQuoted != null ? String(bid.priceQuoted) : '')
  const [awardedPrice, setAwardedPrice] = useState(bid?.awardedPrice != null ? String(bid.awardedPrice) : '')
  const [saving, setSaving] = useState(false)

  // Price is prominent once the bid is being Submitted (or beyond).
  const priceProminent = status !== 'ACTIVE'

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim() || !company.trim() || !dueDate) {
      addToast({ type: 'error', message: 'Title, company and due date are required.' })
      return
    }
    if ((status === 'WON' || status === 'LOST') && !awardedPrice) {
      addToast({ type: 'error', message: `Awarded price is required to mark a bid as ${status === 'WON' ? 'Won' : 'Lost'}.` })
      return
    }
    setSaving(true)
    const input: BidInput = {
      title: title.trim(),
      company: company.trim(),
      type,
      district: district.trim() || null,
      status,
      dueDate: new Date(dueDate).toISOString(),
      reminderSet,
      submissionType,
      priceQuoted: priceQuoted ? Number(priceQuoted) : null,
      awardedPrice: (status === 'WON' || status === 'LOST') && awardedPrice ? Number(awardedPrice) : null,
    }
    try {
      if (editing) await updateBid(bid!.id, input)
      else await createBid(input)
      addToast({ type: 'success', message: editing ? 'Bid updated.' : 'Bid added.' })
      onSaved()
    } catch (err) {
      addToast({ type: 'error', message: errMsg(err, editing ? 'Could not update bid.' : 'Could not add bid.') })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? `Edit bid #${bid!.number}` : 'New bid'}
      size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={saving}>{editing ? 'Save changes' : 'Add bid'}</Button></>}
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Bid title" required>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. County IT asset liquidation" className={inputCls} />
          </Field>
          <Field label="Company" required>
            <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Target client / organization" className={inputCls} />
          </Field>
          <Field label="Type" required>
            <select value={type} onChange={(e) => setType(e.target.value as BidType)} className={inputCls}>
              {TYPES.map((t) => <option key={t} value={t}>{BID_TYPE_LABEL[t]}</option>)}
            </select>
          </Field>
          <Field label="District">
            <input value={district} onChange={(e) => setDistrict(e.target.value)} placeholder="e.g. school / regional district" className={inputCls} />
          </Field>
          <Field label="Due date & time" required>
            <input type="datetime-local" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value as BidStatus)} className={inputCls}>
              {STATUSES.map((s) => <option key={s} value={s}>{BID_STATUS_LABEL[s]}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Submission type">
          <div className="flex flex-wrap gap-2">
            {SUBMISSION_TYPES.map((s) => {
              const on = submissionType === s
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSubmissionType(on ? null : s)}
                  className={'rounded-btn border px-3 py-1.5 text-body-sm font-semibold transition-colors ' + (on ? 'border-primary bg-primary text-white' : 'border-line bg-card text-ink-muted hover:border-primary/40')}
                >
                  {SUBMISSION_LABEL[s]}
                </button>
              )
            })}
          </div>
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={priceProminent ? 'Price quoted (buyback rate)' : 'Price quoted (optional at this stage)'}>
            <input
              type="number" min="0" step="0.01" inputMode="decimal"
              value={priceQuoted} onChange={(e) => setPriceQuoted(e.target.value)} placeholder="0.00"
              className={inputCls + (priceProminent ? ' border-primary ring-2 ring-primary/20' : '')}
            />
          </Field>
          {(status === 'WON' || status === 'LOST') && (
            <Field label={status === 'LOST' ? 'Awarded price (winning bid)' : 'Awarded price'} required>
              <input type="number" min="0" step="0.01" inputMode="decimal" value={awardedPrice} onChange={(e) => setAwardedPrice(e.target.value)} placeholder="0.00" className={inputCls} />
            </Field>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-btn border border-line bg-bg px-3 py-2">
          <div className="flex items-center gap-2 text-body-sm text-ink">
            {reminderSet ? <Bell size={16} className="text-primary" /> : <BellOff size={16} className="text-ink-muted" />}
            Send a reminder before the due date
          </div>
          <button type="button" role="switch" aria-checked={reminderSet} onClick={() => setReminderSet((v) => !v)}
            className={'relative h-6 w-11 rounded-full transition-colors ' + (reminderSet ? 'bg-primary' : 'bg-slate-300')}>
            <span className={'absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ' + (reminderSet ? 'translate-x-5' : 'translate-x-0.5')} />
          </button>
        </div>

        {/* Agent — auto-filled and locked (the bid owner when editing) */}
        <Field label="Agent">
          <input value={bid?.agentName ?? agentName} disabled readOnly className={inputCls + ' cursor-not-allowed bg-slate-100 text-ink-muted'} title="Auto-assigned to the submitting agent" />
        </Field>
      </form>
    </Modal>
  )
}

/**
 * Prompt shown when a bid is decided from the table.
 *  - Won: capture the final awarded price.
 *  - Lost: capture the winning price and the company it went to.
 */
function DecisionModal({ bid, status, onClose, onSaved }: { bid: Bid; status: 'WON' | 'LOST'; onClose: () => void; onSaved: () => void }) {
  const { addToast } = useToast()
  const isLost = status === 'LOST'
  const [price, setPrice] = useState(bid.awardedPrice != null ? String(bid.awardedPrice) : bid.priceQuoted != null ? String(bid.priceQuoted) : '')
  const [company, setCompany] = useState(bid.company)
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!price || Number(price) <= 0) {
      addToast({ type: 'error', message: 'Enter the awarded price.' })
      return
    }
    if (isLost && !company.trim()) {
      addToast({ type: 'error', message: 'Enter the company it was awarded to.' })
      return
    }
    setSaving(true)
    try {
      await updateBid(bid.id, { status, awardedPrice: Number(price), ...(isLost ? { company: company.trim() } : {}) })
      addToast({ type: 'success', message: isLost ? 'Bid marked Lost.' : 'Bid marked Won.' })
      onSaved()
    } catch (e) {
      addToast({ type: 'error', message: errMsg(e, 'Could not save.') })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isLost ? 'Mark as Lost' : 'Mark as Won'}
      size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{isLost ? 'Save as Lost' : 'Save as Won'}</Button></>}
    >
      <p className="mb-3 text-body-sm text-ink-muted">
        {isLost
          ? <>Record the winning price and the company that won <b className="text-ink">{bid.title}</b>.</>
          : <>Enter the final accepted price for <b className="text-ink">{bid.title}</b> before saving.</>}
      </p>
      <div className="space-y-4">
        <Field label={isLost ? 'Awarded price (winning bid)' : 'Awarded price'} required>
          <input type="number" min="0" step="0.01" inputMode="decimal" autoFocus value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" className={inputCls} />
        </Field>
        {isLost && (
          <Field label="Awarded to (company)" required>
            <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Winning company" className={inputCls} />
          </Field>
        )}
      </div>
    </Modal>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-body-sm font-medium text-ink">
        {label}{required && <span className="text-danger"> *</span>}
      </span>
      {children}
    </label>
  )
}
