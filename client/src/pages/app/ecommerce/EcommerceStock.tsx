import { useEffect, useState, type FormEvent } from 'react'
import { Plus, PackageX, PackagePlus, PackageMinus } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { Badge, type BadgeTone } from '../../../components/ui/Badge'
import { Modal } from '../../../components/ui/Modal'
import { TextField } from '../../../components/ui/Input'
import { useToast } from '../../../components/ui/Toast'
import { useAuth } from '../../../lib/auth'
import {
  getEcommerceStock, createStockRequest, assignStockRequest, resolveStockRequest,
  type StockRequest, type StockListResponse, type StockAction,
} from '../../../lib/ecommerceApi'

const STATUS_TONE: Record<StockRequest['status'], BadgeTone> = { REQUESTED: 'warning', ASSIGNED: 'primary', RESOLVED: 'success' }
const ACTION_LABEL: Record<StockAction, string> = { STOCK_IN: 'Stock In', STOCK_OUT: 'Stock Out' }
const fmt = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export default function EcommerceStock() {
  const { user } = useAuth()
  const { addToast } = useToast()
  const [data, setData] = useState<StockListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [logOpen, setLogOpen] = useState(false)
  const [assignFor, setAssignFor] = useState<StockRequest | null>(null)

  function reload() {
    return getEcommerceStock().then(setData).catch(() => addToast({ type: 'error', message: 'Could not load stock requests.' }))
  }
  useEffect(() => { reload().finally(() => setLoading(false)) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function patch(r: StockRequest) {
    setData((d) => (d ? { ...d, requests: d.requests.map((x) => (x.id === r.id ? r : x)) } : d))
  }
  async function resolve(id: string) {
    try { const { request } = await resolveStockRequest(id); patch(request); addToast({ type: 'success', message: 'Marked resolved.' }) }
    catch { addToast({ type: 'error', message: 'Could not resolve.' }) }
  }

  if (loading || !data) return <div className="p-2 text-body-md text-ink-muted">Loading…</div>
  const canAssign = data.canAssign

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">Stock Tracking</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">Out-of-stock requests and stock-in/out assignments.</p>
        </div>
        <Button size="sm" leadingIcon={<Plus size={16} />} onClick={() => setLogOpen(true)}>Log out-of-stock</Button>
      </div>

      <Card flush>
        {data.requests.length === 0 ? (
          <p className="py-12 text-center text-body-md text-ink-muted">No stock requests yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-body-sm">
              <thead>
                <tr className="border-b border-line text-left text-label-md uppercase text-ink-muted">
                  <th className="px-4 py-2.5 font-semibold">Item</th>
                  <th className="px-3 py-2.5 font-semibold">Requested by</th>
                  <th className="px-3 py-2.5 font-semibold">When</th>
                  <th className="px-3 py-2.5 font-semibold">Status</th>
                  <th className="px-3 py-2.5 font-semibold">Assignment</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.requests.map((r) => {
                  const canResolve = r.status === 'ASSIGNED' && (canAssign || r.assignee?.id === user?.id)
                  return (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-ink">{r.itemName}</div>
                        {r.note && <div className="text-body-sm text-ink-muted">{r.note}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-ink">{r.requestedByName}</td>
                      <td className="px-3 py-2.5 text-ink-muted">{fmt(r.requestedAt)}</td>
                      <td className="px-3 py-2.5"><Badge tone={STATUS_TONE[r.status]}>{r.status === 'REQUESTED' ? 'Out of stock' : r.status === 'ASSIGNED' ? 'Assigned' : 'Resolved'}</Badge></td>
                      <td className="px-3 py-2.5 text-ink-muted">
                        {r.action ? <span className="inline-flex items-center gap-1">{r.action === 'STOCK_IN' ? <PackagePlus size={13} /> : <PackageMinus size={13} />}{ACTION_LABEL[r.action]}{r.assignee ? ` · ${r.assignee.name}` : ''}</span> : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {r.status === 'REQUESTED' && canAssign && <Button size="sm" variant="secondary" onClick={() => setAssignFor(r)}>Assign</Button>}
                        {canResolve && <Button size="sm" variant="secondary" onClick={() => resolve(r.id)}>Resolve</Button>}
                        {r.status === 'RESOLVED' && r.resolvedAt && <span className="text-body-sm text-ink-muted">{fmt(r.resolvedAt)}</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <LogModal open={logOpen} onClose={() => setLogOpen(false)} onCreated={(r) => setData((d) => (d ? { ...d, requests: [r, ...d.requests] } : d))} />
      <AssignModal request={assignFor} members={data.members} onClose={() => setAssignFor(null)} onAssigned={(r) => { patch(r); setAssignFor(null) }} />
    </div>
  )
}

function LogModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (r: StockRequest) => void }) {
  const { addToast } = useToast()
  const [itemName, setItemName] = useState('')
  const [requestedByName, setRequestedByName] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!itemName.trim() || !requestedByName.trim()) return
    setSubmitting(true)
    try {
      const { request } = await createStockRequest({ itemName, requestedByName, note: note || undefined })
      onCreated(request); addToast({ type: 'success', message: 'Out-of-stock request logged.' })
      setItemName(''); setRequestedByName(''); setNote(''); onClose()
    } catch { addToast({ type: 'error', message: 'Could not log the request.' }) } finally { setSubmitting(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title="Log out-of-stock"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={submitting}>{submitting ? 'Saving…' : 'Log request'}</Button></>}>
      <form onSubmit={submit} className="space-y-4">
        <TextField label="Item / product" placeholder="e.g. Dell OptiPlex 7090" value={itemName} onChange={(e) => setItemName(e.target.value)} autoFocus />
        <TextField label="Requested by" placeholder="Who from operations reported it" value={requestedByName} onChange={(e) => setRequestedByName(e.target.value)} />
        <div>
          <label className="mb-1 block text-body-sm font-semibold text-ink">Note (optional)</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="w-full rounded-btn border border-line bg-card p-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10" />
        </div>
      </form>
    </Modal>
  )
}

function AssignModal({ request, members, onClose, onAssigned }: { request: StockRequest | null; members: { id: string; name: string }[]; onClose: () => void; onAssigned: (r: StockRequest) => void }) {
  const { addToast } = useToast()
  const [action, setAction] = useState<StockAction>('STOCK_IN')
  const [assignedToId, setAssignedToId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputCls = 'h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'
  async function submit() {
    if (!request || !assignedToId) { addToast({ type: 'error', message: 'Pick an agent.' }); return }
    setSubmitting(true)
    try { const { request: r } = await assignStockRequest(request.id, { action, assignedToId }); onAssigned(r); addToast({ type: 'success', message: 'Assigned.' }); setAssignedToId('') }
    catch { addToast({ type: 'error', message: 'Could not assign.' }) } finally { setSubmitting(false) }
  }
  return (
    <Modal open={!!request} onClose={onClose} title={request ? `Assign — ${request.itemName}` : 'Assign'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={submitting} leadingIcon={<PackageX size={15} />}>{submitting ? 'Assigning…' : 'Assign task'}</Button></>}>
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-body-sm font-semibold text-ink">Action</label>
          <select value={action} onChange={(e) => setAction(e.target.value as StockAction)} className={inputCls}>
            <option value="STOCK_IN">Stock In (restock the item)</option>
            <option value="STOCK_OUT">Stock Out (remove / delist)</option>
          </select>
        </div>
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
