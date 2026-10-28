import { Fragment, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Plus, PackagePlus, PackageMinus, Search, Pencil, Trash2, History } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { Badge, type BadgeTone } from '../../../components/ui/Badge'
import { Modal } from '../../../components/ui/Modal'
import { TextField } from '../../../components/ui/Input'
import { useToast } from '../../../components/ui/Toast'
import { useAuth } from '../../../lib/auth'
import {
  getEcommerceStock, createStockRequest, assignStockRequest, resolveStockRequest,
  editStockRequest, deleteStockRequest, getStockHistory,
  type StockRequest, type StockListResponse, type StockAction, type StockEditInput, type StockStatus,
} from '../../../lib/ecommerceApi'
import { errMsg } from '../../../lib/projectsApi'

const STATUS: Record<StockRequest['status'], { tone: BadgeTone; label: string }> = {
  REQUESTED: { tone: 'warning', label: 'Open' },
  ASSIGNED: { tone: 'primary', label: 'Assigned' },
  RESOLVED: { tone: 'success', label: 'Done' },
}
const ACTION: Record<StockAction, { tone: BadgeTone; label: string; icon: typeof PackagePlus }> = {
  STOCK_IN: { tone: 'success', label: 'Stock In', icon: PackagePlus },
  STOCK_OUT: { tone: 'warning', label: 'Stock Out', icon: PackageMinus },
}
const fmt = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export default function EcommerceStock() {
  const { user } = useAuth()
  const { addToast } = useToast()
  const [data, setData] = useState<StockListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [logOpen, setLogOpen] = useState(false)
  const [assignFor, setAssignFor] = useState<StockRequest | null>(null)
  const [editFor, setEditFor] = useState<StockRequest | null>(null)
  const [deleteFor, setDeleteFor] = useState<StockRequest | null>(null)
  const [historyFor, setHistoryFor] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [typeF, setTypeF] = useState<'ALL' | StockAction>('ALL')
  const [statusF, setStatusF] = useState<'ALL' | StockRequest['status']>('ALL')

  function reload() {
    return getEcommerceStock().then(setData).catch(() => addToast({ type: 'error', message: 'Could not load stock log.' }))
  }
  useEffect(() => { reload().finally(() => setLoading(false)) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function patch(r: StockRequest) {
    setData((d) => (d ? { ...d, requests: d.requests.map((x) => (x.id === r.id ? r : x)) } : d))
  }
  async function resolve(id: string) {
    try { const { request } = await resolveStockRequest(id); patch(request); addToast({ type: 'success', message: 'Marked done.' }) }
    catch { addToast({ type: 'error', message: 'Could not update.' }) }
  }

  const filtered = useMemo(() => {
    if (!data) return []
    const needle = q.trim().toLowerCase()
    return data.requests.filter((r) =>
      (typeF === 'ALL' || r.action === typeF) &&
      (statusF === 'ALL' || r.status === statusF) &&
      (!needle || r.itemName.toLowerCase().includes(needle) || r.requestedByName.toLowerCase().includes(needle)),
    )
  }, [data, q, typeF, statusF])

  if (loading || !data) return <div className="p-2 text-body-md text-ink-muted">Loading…</div>
  const canAssign = data.canAssign

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">Stock Tracking</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">Stock-in / stock-out log with full history & search. Open logs can be edited; every change is kept in the log's history.</p>
        </div>
        <Button size="sm" leadingIcon={<Plus size={16} />} onClick={() => setLogOpen(true)}>Add log</Button>
      </div>

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search item or requester…" className="h-9 w-full rounded-btn border border-line bg-card pl-9 pr-3 text-body-sm text-ink focus:border-primary focus:outline-none" />
        </div>
        <Pills value={typeF} onChange={setTypeF} options={[['ALL', 'All types'], ['STOCK_IN', 'Stock In'], ['STOCK_OUT', 'Stock Out']]} />
        <Pills value={statusF} onChange={setStatusF} options={[['ALL', 'All'], ['REQUESTED', 'Open'], ['ASSIGNED', 'Assigned'], ['RESOLVED', 'Done']]} />
      </div>

      <Card flush>
        {filtered.length === 0 ? (
          <p className="py-12 text-center text-body-md text-ink-muted">{data.requests.length === 0 ? 'No stock logs yet.' : 'No matches.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-body-sm">
              <thead>
                <tr className="border-b border-line text-left text-label-md uppercase text-ink-muted">
                  <th className="px-4 py-2.5 font-semibold">Type</th>
                  <th className="px-3 py-2.5 font-semibold">Item</th>
                  <th className="px-3 py-2.5 font-semibold">Requested by</th>
                  <th className="px-3 py-2.5 font-semibold">When</th>
                  <th className="px-3 py-2.5 font-semibold">Status</th>
                  <th className="px-3 py-2.5 font-semibold">Assignee</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map((r) => {
                  const a = r.action ? ACTION[r.action] : null
                  const canResolve = r.status !== 'RESOLVED' && (canAssign || r.assignee?.id === user?.id)
                  const canEdit = canAssign || r.status !== 'RESOLVED'
                  const showHistory = historyFor === r.id
                  return (
                    <Fragment key={r.id}>
                    <tr className="hover:bg-slate-50">
                      <td className="px-4 py-2.5">{a ? <Badge tone={a.tone} className="gap-1"><a.icon size={12} />{a.label}</Badge> : '—'}</td>
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-ink">{r.itemName}{r.quantity != null && <span className="ml-1.5 text-ink-muted">× {r.quantity}</span>}</div>
                        {r.note && <div className="text-body-sm text-ink-muted">{r.note}</div>}
                        {r.editedAt && <div className="text-label-md text-ink-muted">edited {fmt(r.editedAt)}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-ink">{r.requestedByName}</td>
                      <td className="px-3 py-2.5 text-ink-muted">{fmt(r.requestedAt)}</td>
                      <td className="px-3 py-2.5"><Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge></td>
                      <td className="px-3 py-2.5 text-ink-muted">{r.assignee?.name ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex justify-end gap-1.5">
                          {r.status === 'REQUESTED' && canAssign && <Button size="sm" variant="secondary" onClick={() => setAssignFor(r)}>Assign</Button>}
                          {canResolve && <Button size="sm" variant="secondary" onClick={() => resolve(r.id)}>Done</Button>}
                          {r.status === 'RESOLVED' && r.resolvedAt && <span className="self-center text-body-sm text-ink-muted">{fmt(r.resolvedAt)}</span>}
                          {canEdit && <IconBtn label="Edit" onClick={() => setEditFor(r)}><Pencil size={14} /></IconBtn>}
                          <IconBtn label="History" active={showHistory} onClick={() => setHistoryFor(showHistory ? null : r.id)}><History size={14} /></IconBtn>
                          {canAssign && <IconBtn label="Delete" danger onClick={() => setDeleteFor(r)}><Trash2 size={14} /></IconBtn>}
                        </div>
                      </td>
                    </tr>
                    {showHistory && (
                      <tr className="bg-slate-50/60">
                        <td colSpan={7} className="px-4 py-3"><StockHistory id={r.id} stamp={r.editedAt ?? r.resolvedAt ?? r.assignedAt ?? r.requestedAt} /></td>
                      </tr>
                    )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <LogModal open={logOpen} onClose={() => setLogOpen(false)} onCreated={(r) => setData((d) => (d ? { ...d, requests: [r, ...d.requests] } : d))} />
      <AssignModal request={assignFor} members={data.members} onClose={() => setAssignFor(null)} onAssigned={(r) => { patch(r); setAssignFor(null) }} />
      <EditModal request={editFor} members={data.members} isLead={canAssign} onClose={() => setEditFor(null)} onSaved={(r) => { patch(r); setEditFor(null) }} />
      <DeleteModal request={deleteFor} onClose={() => setDeleteFor(null)}
        onDeleted={(id) => { setData((d) => (d ? { ...d, requests: d.requests.filter((x) => x.id !== id) } : d)); setDeleteFor(null) }} />
    </div>
  )
}

function Pills<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="inline-flex gap-1">
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)} className={'rounded-full px-3 py-1.5 text-body-sm font-medium transition-colors ' + (value === v ? 'bg-ink text-card' : 'bg-slate-100 text-ink-muted hover:bg-slate-200')}>{label}</button>
      ))}
    </div>
  )
}

function LogModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (r: StockRequest) => void }) {
  const { addToast } = useToast()
  const [itemName, setItemName] = useState('')
  const [action, setAction] = useState<StockAction>('STOCK_OUT')
  const [requestedByName, setRequestedByName] = useState('')
  const [quantity, setQuantity] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputCls = 'h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!itemName.trim() || !requestedByName.trim()) return
    const qty = parseQty(quantity)
    if (qty === undefined) { addToast({ type: 'error', message: 'Quantity must be a whole number of 1 or more.' }); return }
    setSubmitting(true)
    try {
      const { request } = await createStockRequest({ itemName, quantity: qty, action, requestedByName, note: note || undefined })
      onCreated(request); addToast({ type: 'success', message: 'Stock log added.' })
      setItemName(''); setRequestedByName(''); setQuantity(''); setNote(''); setAction('STOCK_OUT'); onClose()
    } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not add the log.') }) } finally { setSubmitting(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title="Add stock log"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={submitting}>{submitting ? 'Saving…' : 'Add log'}</Button></>}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="mb-1 block text-body-sm font-semibold text-ink">Type</label>
          <div className="grid grid-cols-2 gap-2">
            {(['STOCK_OUT', 'STOCK_IN'] as StockAction[]).map((a) => {
              const meta = ACTION[a]
              return (
                <button type="button" key={a} onClick={() => setAction(a)}
                  className={'flex items-center justify-center gap-2 rounded-btn border px-3 py-2 text-body-md font-medium transition-colors ' + (action === a ? 'border-primary bg-primary/5 text-primary' : 'border-line text-ink-muted hover:bg-slate-50')}>
                  <meta.icon size={16} />{meta.label}
                </button>
              )
            })}
          </div>
        </div>
        <TextField label="Item / product" placeholder="e.g. Dell OptiPlex 7090" value={itemName} onChange={(e) => setItemName(e.target.value)} autoFocus />
        <TextField label="Quantity (optional)" type="number" min={1} placeholder="e.g. 5" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        <TextField label="Requested by" placeholder="Who reported/requested it" value={requestedByName} onChange={(e) => setRequestedByName(e.target.value)} />
        <div>
          <label className="mb-1 block text-body-sm font-semibold text-ink">Note (optional)</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={inputCls + ' h-auto py-2'} />
        </div>
      </form>
    </Modal>
  )
}

function AssignModal({ request, members, onClose, onAssigned }: { request: StockRequest | null; members: { id: string; name: string }[]; onClose: () => void; onAssigned: (r: StockRequest) => void }) {
  const { addToast } = useToast()
  const [assignedToId, setAssignedToId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputCls = 'h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'
  async function submit() {
    if (!request || !assignedToId) { addToast({ type: 'error', message: 'Pick an agent.' }); return }
    setSubmitting(true)
    try { const { request: r } = await assignStockRequest(request.id, { action: request.action ?? 'STOCK_OUT', assignedToId }); onAssigned(r); addToast({ type: 'success', message: 'Assigned.' }); setAssignedToId('') }
    catch { addToast({ type: 'error', message: 'Could not assign.' }) } finally { setSubmitting(false) }
  }
  const meta = request?.action ? ACTION[request.action] : null
  return (
    <Modal open={!!request} onClose={onClose} title={request ? `Assign — ${request.itemName}` : 'Assign'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={submitting}>{submitting ? 'Assigning…' : 'Assign task'}</Button></>}>
      <div className="space-y-4">
        {meta && <p className="text-body-md text-ink-muted">Type: <Badge tone={meta.tone} className="gap-1"><meta.icon size={12} />{meta.label}</Badge></p>}
        <div>
          <label className="mb-1 block text-body-sm font-semibold text-ink">Assign to</label>
          <select value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)} className={inputCls}>
            <option value="">Select agent…</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
      </div>
    </Modal>
  )
}

/** '' → null (no quantity), a whole number ≥ 1 → that number, anything else → undefined (invalid). */
function parseQty(v: string): number | null | undefined {
  const t = v.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isInteger(n) && n >= 1 && n <= 1_000_000 ? n : undefined
}

function IconBtn({ label, onClick, children, danger, active }: { label: string; onClick: () => void; children: React.ReactNode; danger?: boolean; active?: boolean }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick}
      className={'inline-flex h-8 w-8 items-center justify-center rounded-btn border transition-colors ' +
        (active ? 'border-primary bg-primary/5 text-primary' : danger ? 'border-line text-ink-muted hover:border-red-300 hover:bg-red-50 hover:text-red-600' : 'border-line text-ink-muted hover:bg-slate-100 hover:text-ink')}>
      {children}
    </button>
  )
}

const STATUS_OPTIONS: [StockStatus, string][] = [['REQUESTED', 'Open'], ['ASSIGNED', 'Assigned'], ['RESOLVED', 'Done']]

/** Edit a stock log. Members: item, quantity, type, requested by, note (while not done). Team lead: everything, incl. assignee and status (reopen). */
function EditModal({ request, members, isLead, onClose, onSaved }: { request: StockRequest | null; members: { id: string; name: string }[]; isLead: boolean; onClose: () => void; onSaved: (r: StockRequest) => void }) {
  const { addToast } = useToast()
  const [itemName, setItemName] = useState('')
  const [quantity, setQuantity] = useState('')
  const [action, setAction] = useState<StockAction>('STOCK_OUT')
  const [requestedByName, setRequestedByName] = useState('')
  const [note, setNote] = useState('')
  const [assignedToId, setAssignedToId] = useState('')
  const [status, setStatus] = useState<StockStatus>('REQUESTED')
  const [saving, setSaving] = useState(false)
  const inputCls = 'h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'

  useEffect(() => {
    if (!request) return
    setItemName(request.itemName)
    setQuantity(request.quantity != null ? String(request.quantity) : '')
    setAction(request.action ?? 'STOCK_OUT')
    setRequestedByName(request.requestedByName)
    setNote(request.note)
    setAssignedToId(request.assignee?.id ?? '')
    setStatus(request.status)
  }, [request])

  async function save(e?: FormEvent) {
    e?.preventDefault()
    if (!request) return
    if (!itemName.trim() || !requestedByName.trim()) { addToast({ type: 'error', message: 'Item and requested by are needed.' }); return }
    const qty = parseQty(quantity)
    if (qty === undefined) { addToast({ type: 'error', message: 'Quantity must be a whole number of 1 or more.' }); return }
    // Send only what changed, so the history shows exactly what was edited.
    const input: StockEditInput = {}
    if (itemName.trim() !== request.itemName) input.itemName = itemName.trim()
    if (qty !== request.quantity) input.quantity = qty
    if (action !== request.action) input.action = action
    if (requestedByName.trim() !== request.requestedByName) input.requestedByName = requestedByName.trim()
    if (note.trim() !== request.note) input.note = note.trim() || null
    if (isLead) {
      if ((assignedToId || null) !== (request.assignee?.id ?? null)) input.assignedToId = assignedToId || null
      if (status !== request.status) input.status = status
    }
    if (!Object.keys(input).length) { onClose(); return }
    setSaving(true)
    try {
      const { request: r } = await editStockRequest(request.id, input)
      onSaved(r); addToast({ type: 'success', message: 'Stock log updated.' })
    } catch (err) { addToast({ type: 'error', message: errMsg(err, 'Could not save the changes.') }) } finally { setSaving(false) }
  }

  return (
    <Modal open={!!request} onClose={onClose} title={request ? `Edit — ${request.itemName}` : 'Edit'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => save()} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button></>}>
      <form onSubmit={save} className="space-y-4">
        <div>
          <label className="mb-1 block text-body-sm font-semibold text-ink">Type</label>
          <div className="grid grid-cols-2 gap-2">
            {(['STOCK_OUT', 'STOCK_IN'] as StockAction[]).map((a) => {
              const meta = ACTION[a]
              return (
                <button type="button" key={a} onClick={() => setAction(a)}
                  className={'flex items-center justify-center gap-2 rounded-btn border px-3 py-2 text-body-md font-medium transition-colors ' + (action === a ? 'border-primary bg-primary/5 text-primary' : 'border-line text-ink-muted hover:bg-slate-50')}>
                  <meta.icon size={16} />{meta.label}
                </button>
              )
            })}
          </div>
        </div>
        <div className="grid grid-cols-[1fr_120px] gap-3">
          <TextField label="Item / product" value={itemName} onChange={(e) => setItemName(e.target.value)} />
          <TextField label="Quantity" type="number" min={1} placeholder="—" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </div>
        <TextField label="Requested by" value={requestedByName} onChange={(e) => setRequestedByName(e.target.value)} />
        <div>
          <label className="mb-1 block text-body-sm font-semibold text-ink">Note</label>
          <textarea aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={inputCls + ' h-auto py-2'} />
        </div>
        {isLead ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-body-sm font-semibold text-ink">Assigned to</label>
              <select aria-label="Assigned to" value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)} className={inputCls}>
                <option value="">Nobody</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-body-sm font-semibold text-ink">Status</label>
              <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as StockStatus)} className={inputCls}>
                {STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
        ) : (
          <p className="text-body-sm text-ink-muted">Only your team lead can change who it's assigned to or its status. Once a log is done, ask your team lead to change it.</p>
        )}
      </form>
    </Modal>
  )
}

function DeleteModal({ request, onClose, onDeleted }: { request: StockRequest | null; onClose: () => void; onDeleted: (id: string) => void }) {
  const { addToast } = useToast()
  const [busy, setBusy] = useState(false)
  async function go() {
    if (!request) return
    setBusy(true)
    try { await deleteStockRequest(request.id); onDeleted(request.id); addToast({ type: 'success', message: 'Stock log deleted.' }) }
    catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not delete.') }) } finally { setBusy(false) }
  }
  return (
    <Modal open={!!request} onClose={onClose} title="Delete this stock log?"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" onClick={go} disabled={busy}>{busy ? 'Deleting…' : 'Delete'}</Button></>}>
      <p className="text-body-md text-ink">
        <span className="font-semibold">{request?.itemName}</span>{request?.quantity != null ? ` × ${request.quantity}` : ''} will be removed from the stock log.
        The activity log still keeps a record that it was deleted and by whom.
      </p>
    </Modal>
  )
}

function StockHistory({ id, stamp }: { id: string; stamp: string }) {
  const [rows, setRows] = useState<{ at: string; by: string; what: string }[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    setFailed(false)
    getStockHistory(id).then((r) => { if (live) setRows(r.history) }).catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [id, stamp])
  if (failed) return <p className="text-body-sm text-ink-muted">Could not load the history.</p>
  if (!rows) return <p className="text-body-sm text-ink-muted">Loading history…</p>
  if (!rows.length) return <p className="text-body-sm text-ink-muted">No history recorded for this log.</p>
  return (
    <ol className="space-y-1.5">
      {rows.map((h, i) => (
        <li key={i} className="flex flex-wrap gap-x-2 text-body-sm">
          <span className="w-32 shrink-0 text-ink-muted">{fmt(h.at)}</span>
          <span className="font-medium text-ink">{h.by}</span>
          <span className="text-ink-muted">{h.what}</span>
        </li>
      ))}
    </ol>
  )
}
