import { useEffect, useMemo, useState } from 'react'
import { PackagePlus, PackageMinus } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { Badge, type BadgeTone } from '../../../components/ui/Badge'
import { Modal } from '../../../components/ui/Modal'
import { useToast } from '../../../components/ui/Toast'
import { useAuth } from '../../../lib/auth'
import {
  getInventoryRequests, assignMovement, resolveMovement, cancelMovement,
  type InventoryMovement, type RequestsResponse, type MovementType, type InventoryReqStatus,
} from '../../../lib/inventoryApi'

const STATUS: Record<InventoryReqStatus, { tone: BadgeTone; label: string }> = {
  REQUESTED: { tone: 'warning', label: 'Open' },
  ASSIGNED: { tone: 'primary', label: 'Assigned' },
  COMPLETED: { tone: 'success', label: 'Done' },
  CANCELLED: { tone: 'neutral', label: 'Cancelled' },
}
const MOVE: Record<MovementType, { tone: BadgeTone; label: string; icon: typeof PackagePlus }> = {
  STOCK_IN: { tone: 'success', label: 'Stock In', icon: PackagePlus },
  STOCK_OUT: { tone: 'warning', label: 'Stock Out', icon: PackageMinus },
}
const fmt = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export default function InventoryRequests() {
  const { user } = useAuth()
  const { addToast } = useToast()
  const [data, setData] = useState<RequestsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [typeF, setTypeF] = useState<'ALL' | MovementType>('ALL')
  const [statusF, setStatusF] = useState<'ALL' | InventoryReqStatus>('ALL')
  const [assignFor, setAssignFor] = useState<InventoryMovement | null>(null)

  function reload() {
    return getInventoryRequests().then(setData).catch(() => addToast({ type: 'error', message: 'Could not load requests.' }))
  }
  useEffect(() => { reload().finally(() => setLoading(false)) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function patch(m: InventoryMovement) {
    setData((d) => (d ? { ...d, requests: d.requests.map((x) => (x.id === m.id ? m : x)) } : d))
  }
  async function resolve(id: string) {
    try { const { movement } = await resolveMovement(id); patch(movement); addToast({ type: 'success', message: 'Marked done. Quantity updated.' }) }
    catch { addToast({ type: 'error', message: 'Could not update.' }) }
  }
  async function cancel(id: string) {
    try { const { movement } = await cancelMovement(id); patch(movement); addToast({ type: 'success', message: 'Cancelled.' }) }
    catch { addToast({ type: 'error', message: 'Could not cancel.' }) }
  }

  const filtered = useMemo(() => {
    if (!data) return []
    return data.requests.filter((r) => (typeF === 'ALL' || r.type === typeF) && (statusF === 'ALL' || r.status === statusF))
  }, [data, typeF, statusF])

  if (loading || !data) return <div className="p-2 text-body-md text-ink-muted">Loading…</div>
  const canManage = data.canManage

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="text-headline-lg text-ink">Stock Requests</h1>
        <p className="mt-0.5 text-body-md text-ink-muted">All stock-in / stock-out requests — who requested, assigned agent, and when out of stock.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Pills value={typeF} onChange={setTypeF} options={[['ALL', 'All types'], ['STOCK_IN', 'Stock In'], ['STOCK_OUT', 'Stock Out']]} />
        <Pills value={statusF} onChange={setStatusF} options={[['ALL', 'All'], ['REQUESTED', 'Open'], ['ASSIGNED', 'Assigned'], ['COMPLETED', 'Done']]} />
      </div>

      <Card flush>
        {filtered.length === 0 ? (
          <p className="py-12 text-center text-body-md text-ink-muted">{data.requests.length === 0 ? 'No requests yet.' : 'No matches.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-body-sm">
              <thead>
                <tr className="border-b border-line text-left text-label-md uppercase text-ink-muted">
                  <th className="px-4 py-2.5 font-semibold">Type</th>
                  <th className="px-3 py-2.5 font-semibold">Item</th>
                  <th className="px-3 py-2.5 font-semibold">Qty</th>
                  <th className="px-3 py-2.5 font-semibold">Requested by</th>
                  <th className="px-3 py-2.5 font-semibold">When</th>
                  <th className="px-3 py-2.5 font-semibold">Status</th>
                  <th className="px-3 py-2.5 font-semibold">Agent</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map((r) => {
                  const a = MOVE[r.type]
                  const canResolve = (r.status === 'ASSIGNED' || r.status === 'REQUESTED') && (canManage || r.assignee?.id === user?.id)
                  return (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5"><Badge tone={a.tone} className="gap-1"><a.icon size={12} />{a.label}</Badge></td>
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-ink">{r.item?.name ?? '—'}</div>
                        {r.note && <div className="text-body-sm text-ink-muted">{r.note}</div>}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-ink">{r.quantity}</td>
                      <td className="px-3 py-2.5 text-ink">{r.requestedBy?.name ?? r.requestedByName ?? '—'}</td>
                      <td className="px-3 py-2.5 text-ink-muted">{fmt(r.requestedAt)}</td>
                      <td className="px-3 py-2.5"><Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge></td>
                      <td className="px-3 py-2.5 text-ink-muted">
                        {r.assignee?.name ?? '—'}
                        {r.resolvedAt && <div className="text-body-sm text-ink-muted">{fmt(r.resolvedAt)}</div>}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex justify-end gap-1.5">
                          {r.status === 'REQUESTED' && canManage && <Button size="sm" variant="secondary" onClick={() => setAssignFor(r)}>Assign</Button>}
                          {canResolve && <Button size="sm" variant="secondary" onClick={() => resolve(r.id)}>Done</Button>}
                          {r.status !== 'COMPLETED' && r.status !== 'CANCELLED' && canManage && <Button size="sm" variant="ghost" onClick={() => cancel(r.id)}>Cancel</Button>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <AssignModal request={assignFor} members={data.members} onClose={() => setAssignFor(null)} onAssigned={(m) => { patch(m); setAssignFor(null) }} />
    </div>
  )
}

function Pills<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="inline-flex gap-1">
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)} className={'rounded-full px-3 py-1.5 text-body-sm font-medium transition-colors ' + (value === v ? 'bg-ink text-white' : 'bg-slate-100 text-ink-muted hover:bg-slate-200')}>{label}</button>
      ))}
    </div>
  )
}

function AssignModal({ request, members, onClose, onAssigned }: { request: InventoryMovement | null; members: { id: string; name: string }[]; onClose: () => void; onAssigned: (m: InventoryMovement) => void }) {
  const { addToast } = useToast()
  const [assignedToId, setAssignedToId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputCls = 'h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'
  async function submit() {
    if (!request || !assignedToId) { addToast({ type: 'error', message: 'Pick an agent.' }); return }
    setSubmitting(true)
    try { const { movement } = await assignMovement(request.id, assignedToId); onAssigned(movement); addToast({ type: 'success', message: 'Assigned.' }); setAssignedToId('') }
    catch { addToast({ type: 'error', message: 'Could not assign.' }) } finally { setSubmitting(false) }
  }
  const meta = request ? MOVE[request.type] : null
  return (
    <Modal open={!!request} onClose={onClose} title={request ? `Assign — ${request.item?.name ?? 'item'}` : 'Assign'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={submitting}>{submitting ? 'Assigning…' : 'Assign agent'}</Button></>}>
      <div className="space-y-4">
        {meta && <p className="text-body-md text-ink-muted">Type: <Badge tone={meta.tone} className="gap-1"><meta.icon size={12} />{meta.label}</Badge> · Qty {request?.quantity}</p>}
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
