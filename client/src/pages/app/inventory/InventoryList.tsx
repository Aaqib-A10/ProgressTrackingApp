import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Plus, PackagePlus, PackageMinus, Search, Boxes, History, Pencil, Trash2, ToggleLeft, ToggleRight, Check } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { Badge, type BadgeTone } from '../../../components/ui/Badge'
import { Modal } from '../../../components/ui/Modal'
import { TextField } from '../../../components/ui/Input'
import { useToast } from '../../../components/ui/Toast'
import { INVENTORY_CATEGORIES } from '../../../lib/inventory'
import {
  getInventoryItems, createInventoryItem, updateInventoryItem, deleteInventoryItem,
  getItemActivity, createMovement,
  type InventoryItem, type ItemsResponse, type InventoryStatus, type MovementType,
  type ActivityResponse,
} from '../../../lib/inventoryApi'

const STATUS: Record<InventoryStatus, { tone: BadgeTone; label: string }> = {
  IN: { tone: 'success', label: 'In stock' },
  LOW: { tone: 'warning', label: 'Low' },
  OUT: { tone: 'danger', label: 'Out of stock' },
}
const MOVE: Record<MovementType, { tone: BadgeTone; label: string; icon: typeof PackagePlus }> = {
  STOCK_IN: { tone: 'success', label: 'Stock In', icon: PackagePlus },
  STOCK_OUT: { tone: 'warning', label: 'Stock Out', icon: PackageMinus },
}
const money = (n: number | null) => (n == null ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
const fmt = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const inputCls = 'h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'

export default function InventoryList() {
  const { addToast } = useToast()
  const [data, setData] = useState<ItemsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [cat, setCat] = useState<string>('All Items')
  const [q, setQ] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)

  function reload(category = cat) {
    return getInventoryItems(category === 'All Items' ? undefined : category)
      .then(setData)
      .catch(() => addToast({ type: 'error', message: 'Could not load inventory.' }))
  }
  useEffect(() => { reload().finally(() => setLoading(false)) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function pickCat(c: string) { setCat(c); reload(c) }

  function patchItem(item: InventoryItem) {
    setData((d) => (d ? { ...d, items: d.items.map((x) => (x.id === item.id ? item : x)) } : d))
  }

  const filtered = useMemo(() => {
    if (!data) return []
    const needle = q.trim().toLowerCase()
    return data.items.filter((i) => !needle || i.name.toLowerCase().includes(needle) || i.sku.toLowerCase().includes(needle))
  }, [data, q])

  if (loading || !data) return <div className="p-2 text-body-md text-ink-muted">Loading…</div>
  const canManage = data.canManage

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">Inventory Management</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">All stock — quantities, requests and full per-item history.</p>
        </div>
        {canManage && <Button size="sm" leadingIcon={<Plus size={16} />} onClick={() => setAddOpen(true)}>Add item</Button>}
      </div>

      {/* Category filter pills */}
      <div className="flex flex-wrap items-center gap-1.5">
        {['All Items', ...INVENTORY_CATEGORIES].map((c) => (
          <button key={c} onClick={() => pickCat(c)}
            className={'rounded-full px-3 py-1.5 text-body-sm font-medium transition-colors ' + (cat === c ? 'bg-ink text-white' : 'bg-slate-100 text-ink-muted hover:bg-slate-200')}>
            {c}
          </button>
        ))}
      </div>

      <div className="relative max-w-sm">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search item or SKU…" className="h-9 w-full rounded-btn border border-line bg-card pl-9 pr-3 text-body-sm text-ink focus:border-primary focus:outline-none" />
      </div>

      <Card flush>
        {filtered.length === 0 ? (
          <p className="py-12 text-center text-body-md text-ink-muted">{data.items.length === 0 ? 'No items yet.' : 'No matches.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-body-sm">
              <thead>
                <tr className="border-b border-line text-left text-label-md uppercase text-ink-muted">
                  <th className="px-4 py-2.5 font-semibold">Name</th>
                  <th className="px-3 py-2.5 font-semibold">Category</th>
                  <th className="px-3 py-2.5 font-semibold">Active</th>
                  <th className="px-3 py-2.5 font-semibold">Quantity</th>
                  <th className="px-3 py-2.5 font-semibold">Price</th>
                  {canManage && <th className="px-3 py-2.5 font-semibold">Set New Price</th>}
                  <th className="px-4 py-2.5 text-right font-semibold">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map((i) => (
                  <ItemRow key={i.id} item={i} canManage={canManage} onPatch={patchItem} onOpen={() => setDetailId(i.id)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <AddItemModal open={addOpen} onClose={() => setAddOpen(false)} onCreated={() => reload()} />
      {detailId && (
        <ItemDetailModal
          id={detailId}
          canManage={canManage}
          onClose={() => setDetailId(null)}
          onChanged={() => reload()}
        />
      )}
    </div>
  )
}

function ItemRow({ item, canManage, onPatch, onOpen }: { item: InventoryItem; canManage: boolean; onPatch: (i: InventoryItem) => void; onOpen: () => void }) {
  const { addToast } = useToast()
  const s = STATUS[item.status]

  async function save(patch: { active?: boolean; quantity?: number; price?: number | null }) {
    try { const { item: updated } = await updateInventoryItem(item.id, patch); onPatch(updated) }
    catch { addToast({ type: 'error', message: 'Could not update.' }) }
  }

  return (
    <tr className="hover:bg-slate-50">
      <td className="px-4 py-2.5">
        <button onClick={onOpen} className="text-left font-medium text-ink hover:text-primary hover:underline">{item.name}</button>
        {item.sku && <div className="text-body-sm text-ink-muted">SKU {item.sku}</div>}
      </td>
      <td className="px-3 py-2.5"><Badge tone="neutral">{item.category}</Badge></td>
      <td className="px-3 py-2.5">
        {canManage ? (
          <button
            onClick={() => save({ active: !item.active })}
            title={item.active ? 'Click to deactivate' : 'Click to activate'}
            className={'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-label-md font-semibold transition-colors ' + (item.active ? 'bg-success/10 text-success hover:bg-success/20' : 'bg-slate-100 text-ink-muted hover:bg-slate-200')}>
            {item.active ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
            {item.active ? 'Active' : 'Inactive'}
          </button>
        ) : (
          <Badge tone={item.active ? 'success' : 'neutral'} className="gap-1">
            {item.active ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
            {item.active ? 'Active' : 'Inactive'}
          </Badge>
        )}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          {canManage ? (
            <NumberBox value={item.quantity} onSave={(v) => { if (v != null) save({ quantity: v }) }} />
          ) : (
            <span className="tabular-nums font-medium text-ink">{item.quantity}</span>
          )}
          <Badge tone={s.tone}>{s.label}</Badge>
        </div>
      </td>
      <td className="px-3 py-2.5">
        <span className="tabular-nums text-ink">{money(item.price)}</span>
      </td>
      {canManage && (
        <td className="px-3 py-2.5">
          <NewPriceBox onSave={(v) => save({ price: v })} />
        </td>
      )}
      <td className="px-4 py-2.5 text-right">
        <Button size="sm" variant="secondary" leadingIcon={<History size={14} />} onClick={onOpen}>History</Button>
      </td>
    </tr>
  )
}

/** Inline-editable numeric cell (Quantity / Price boxes). Saves on blur / Enter when changed. */
function NumberBox({ value, onSave, decimals, prefix }: { value: number | null; onSave: (v: number | null) => void; decimals?: boolean; prefix?: string }) {
  const [v, setV] = useState(value == null ? '' : String(value))
  useEffect(() => { setV(value == null ? '' : String(value)) }, [value])
  function commit() {
    const trimmed = v.trim()
    if (trimmed === '') { if (value != null && decimals) onSave(null); return }
    const n = decimals ? parseFloat(trimmed) : parseInt(trimmed, 10)
    if (Number.isNaN(n) || n < 0) { setV(value == null ? '' : String(value)); return }
    if (n !== value) onSave(n)
  }
  return (
    <span className="inline-flex items-center gap-0.5">
      {prefix && <span className="text-ink-muted">{prefix}</span>}
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        inputMode={decimals ? 'decimal' : 'numeric'}
        className="h-8 w-20 rounded-btn border border-line bg-card px-2 text-body-sm tabular-nums text-ink focus:border-primary focus:outline-none"
      />
    </span>
  )
}

/** Empty box to set a NEW price. Once submitted, the value flows to the Price column. */
function NewPriceBox({ onSave }: { onSave: (v: number) => void }) {
  const [v, setV] = useState('')
  function commit() {
    const trimmed = v.trim()
    if (trimmed === '') return
    const n = parseFloat(trimmed)
    if (Number.isNaN(n) || n < 0) { setV(''); return }
    onSave(n)
    setV('')
  }
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-ink-muted">$</span>
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        inputMode="decimal"
        placeholder="New price"
        className="h-8 w-24 rounded-btn border border-line bg-card px-2 text-body-sm tabular-nums text-ink placeholder:text-ink-muted/60 focus:border-primary focus:outline-none"
      />
      {v.trim() !== '' && (
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={commit} title="Set price" className="text-primary hover:text-primary/80">
          <Check size={16} />
        </button>
      )}
    </span>
  )
}

function AddItemModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { addToast } = useToast()
  const [name, setName] = useState('')
  const [category, setCategory] = useState<string>(INVENTORY_CATEGORIES[0])
  const [quantity, setQuantity] = useState('0')
  const [price, setPrice] = useState('')
  const [lowStockAt, setLowStockAt] = useState('0')
  const [sku, setSku] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function reset() { setName(''); setCategory(INVENTORY_CATEGORIES[0]); setQuantity('0'); setPrice(''); setLowStockAt('0'); setSku('') }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSubmitting(true)
    try {
      await createInventoryItem({
        name: name.trim(), category,
        quantity: parseInt(quantity, 10) || 0,
        price: price.trim() === '' ? null : parseFloat(price),
        lowStockAt: parseInt(lowStockAt, 10) || 0,
        sku: sku.trim() || undefined,
      })
      addToast({ type: 'success', message: 'Item added.' })
      reset(); onCreated(); onClose()
    } catch { addToast({ type: 'error', message: 'Could not add the item.' }) } finally { setSubmitting(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add item"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={submitting}>{submitting ? 'Saving…' : 'Add item'}</Button></>}>
      <form onSubmit={submit} className="space-y-4">
        <TextField label="Name" placeholder="e.g. Dell OptiPlex 7090" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <div>
          <label className="mb-1 block text-body-sm font-semibold text-ink">Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
            {INVENTORY_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Quantity" type="number" min={0} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          <TextField label="Price (optional)" type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Low-stock alert at" type="number" min={0} value={lowStockAt} onChange={(e) => setLowStockAt(e.target.value)} />
          <TextField label="SKU (optional)" value={sku} onChange={(e) => setSku(e.target.value)} />
        </div>
      </form>
    </Modal>
  )
}

function ItemDetailModal({ id, canManage, onClose, onChanged }: {
  id: string
  canManage: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const { addToast } = useToast()
  const [data, setData] = useState<ActivityResponse | null>(null)
  const [tab, setTab] = useState<'STOCK_OUT' | 'STOCK_IN'>('STOCK_OUT')
  const [qty, setQty] = useState('1')
  const [reqBy, setReqBy] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function load() { return getItemActivity(id).then(setData).catch(() => addToast({ type: 'error', message: 'Could not load item.' })) }
  useEffect(() => { load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function submitRequest(e: FormEvent) {
    e.preventDefault()
    const n = parseInt(qty, 10)
    if (!n || n < 1) { addToast({ type: 'error', message: 'Enter a quantity.' }); return }
    setSubmitting(true)
    try {
      await createMovement({ itemId: id, type: tab, quantity: n, requestedByName: reqBy.trim() || undefined, note: note.trim() || undefined })
      addToast({ type: 'success', message: 'Request logged.' })
      setQty('1'); setReqBy(''); setNote('')
      await load(); onChanged()
    } catch { addToast({ type: 'error', message: 'Could not log the request.' }) } finally { setSubmitting(false) }
  }

  async function remove() {
    if (!confirm('Delete this item and all its history?')) return
    try { await deleteInventoryItem(id); addToast({ type: 'success', message: 'Item deleted.' }); onChanged(); onClose() }
    catch { addToast({ type: 'error', message: 'Could not delete.' }) }
  }

  const timeline = useMemo(() => {
    if (!data) return []
    type Row = { key: string; when: string; kind: 'move' | 'audit'; text: string; who: string }
    const rows: Row[] = []
    for (const m of data.movements) {
      const meta = MOVE[m.type]
      const statusTxt = m.status === 'COMPLETED' ? 'completed' : m.status === 'ASSIGNED' ? 'assigned' : m.status === 'CANCELLED' ? 'cancelled' : 'requested'
      const agent = m.assignee ? ` · agent ${m.assignee.name}` : ''
      const when = m.resolvedAt ?? m.assignedAt ?? m.requestedAt
      rows.push({
        key: 'm' + m.id, when, kind: 'move',
        text: `${meta.label} ×${m.quantity} ${statusTxt}${agent}${m.note ? ` — ${m.note}` : ''}`,
        who: m.requestedBy?.name ?? m.requestedByName ?? '—',
      })
    }
    for (const a of data.audits) {
      let text = a.action.toLowerCase()
      const after = a.after as Record<string, unknown> | null
      if (a.action === 'CREATE') text = 'Item created'
      else if (after && 'movement' in after) text = `Quantity → ${String(after.quantity)} (${String(after.movement)} ${String(after.by)})`
      else if (after && 'quantity' in after) text = `Details updated (qty ${String(after.quantity)})`
      else text = 'Details updated'
      rows.push({ key: 'a' + a.id, when: a.createdAt, kind: 'audit', text, who: a.actor?.name ?? 'System' })
    }
    return rows.sort((x, y) => (x.when < y.when ? 1 : -1))
  }, [data])

  const item = data?.item
  return (
    <Modal open onClose={onClose} size="lg"
      title={item ? item.name : 'Item'}
      footer={<>
        {canManage && item && <Button variant="ghost" leadingIcon={<Trash2 size={15} />} onClick={remove}>Delete</Button>}
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </>}>
      {!item ? (
        <p className="py-8 text-center text-body-md text-ink-muted">Loading…</p>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{item.category}</Badge>
            <Badge tone={STATUS[item.status].tone}>{STATUS[item.status].label}</Badge>
            <Badge tone={item.active ? 'success' : 'neutral'}>{item.active ? 'Active' : 'Inactive'}</Badge>
            <span className="text-body-sm text-ink-muted">Qty <b className="tabular-nums text-ink">{item.quantity}</b>{item.unit ? ` ${item.unit}` : ''}</span>
            <span className="text-body-sm text-ink-muted">Price <b className="tabular-nums text-ink">{money(item.price)}</b></span>
          </div>

          {/* Log a stock-in / stock-out request */}
          <form onSubmit={submitRequest} className="rounded-card border border-line p-4">
            <div className="mb-3 grid grid-cols-2 gap-2">
              {(['STOCK_OUT', 'STOCK_IN'] as MovementType[]).map((t) => {
                const meta = MOVE[t]
                return (
                  <button type="button" key={t} onClick={() => setTab(t)}
                    className={'flex items-center justify-center gap-2 rounded-btn border px-3 py-2 text-body-md font-medium transition-colors ' + (tab === t ? 'border-primary bg-primary/5 text-primary' : 'border-line text-ink-muted hover:bg-slate-50')}>
                    <meta.icon size={16} />{meta.label}
                  </button>
                )
              })}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <TextField label="Quantity" type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
              <TextField label="Requested by (optional)" placeholder="On behalf of…" value={reqBy} onChange={(e) => setReqBy(e.target.value)} />
            </div>
            <div className="mt-3">
              <label className="mb-1 block text-body-sm font-semibold text-ink">Note (optional)</label>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={inputCls + ' h-auto py-2'} />
            </div>
            <div className="mt-3 flex justify-end">
              <Button size="sm" onClick={submitRequest} disabled={submitting}>{submitting ? 'Logging…' : 'Log request'}</Button>
            </div>
            <p className="mt-2 text-body-sm text-ink-muted">Requests appear in the Requests tab, where a lead assigns an agent and marks them done (which adjusts the quantity).</p>
          </form>

          {/* Activity timeline */}
          <div>
            <h3 className="mb-2 flex items-center gap-2 text-headline-md text-ink"><History size={16} /> Activity</h3>
            {timeline.length === 0 ? (
              <p className="py-4 text-center text-body-sm text-ink-muted">No activity yet.</p>
            ) : (
              <ol className="space-y-2">
                {timeline.map((r) => (
                  <li key={r.key} className="flex items-start gap-3 rounded-btn border border-line p-2.5">
                    <span className="mt-0.5 shrink-0 text-ink-muted">{r.kind === 'move' ? <Boxes size={15} /> : <Pencil size={15} />}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-body-sm text-ink">{r.text}</p>
                      <p className="text-body-sm text-ink-muted">{r.who} · {fmt(r.when)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
