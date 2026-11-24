import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { FileText, Plus, Printer, Send, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Badge, type BadgeTone } from '../../components/ui/Badge'
import { Modal } from '../../components/ui/Modal'
import { PillFilter } from '../../components/ui/PillFilter'
import { EmptyState } from '../../components/ui/EmptyState'
import { useToast } from '../../components/ui/Toast'
import { areaCls, dayLabel, errMsg, inputCls, labelCls, money } from '../../lib/biz'

/**
 * Quotes and invoices: write one, send it to the customer, turn a quote into an invoice, mark an invoice paid.
 * No bookkeeping: it answers what was quoted, what was billed and what is still owed.
 */

type Kind = 'QUOTE' | 'INVOICE'
interface Line { description: string; quantity: number; unitPrice: number; amount?: number }
interface Doc {
  id: string; kind: Kind; number: string; customerName: string; customerEmail: string; customerAddress: string; issueDate: string; dueDate: string | null
  currency: string; status: string; taxRate: number; discount: number; notes: string; lines: Line[]; subtotal: number; tax: number; total: number
  paidAt: string | null; paidNote: string; fromDocId: string | null; overdue: boolean; createdBy: string; canEdit: boolean
}
type Row = Omit<Doc, 'lines'> & { lineCount: number }
interface Summary { openQuotes: number; owed: number; overdue: number; paidThisMonth: number }

const STATUS: Record<string, { tone: BadgeTone; label: string }> = {
  DRAFT: { tone: 'neutral', label: 'Draft' }, SENT: { tone: 'primary', label: 'Sent' }, ACCEPTED: { tone: 'success', label: 'Accepted' }, DECLINED: { tone: 'danger', label: 'Declined' }, PAID: { tone: 'success', label: 'Paid' }, VOID: { tone: 'neutral', label: 'Void' },
}
const WORD: Record<Kind, string> = { QUOTE: 'Quote', INVOICE: 'Invoice' }
const round = (n: number) => Math.round(n * 100) / 100
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Open the document on a clean page and ask the browser to print it (or save it as a PDF). */
function printDoc(d: Doc, from: string) {
  const m = (n: number) => money(n, d.currency)
  const rows = d.lines.map((l) => `<tr><td>${esc(l.description)}</td><td class="n">${l.quantity}</td><td class="n">${m(l.unitPrice)}</td><td class="n">${m(l.amount ?? l.quantity * l.unitPrice)}</td></tr>`).join('')
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(WORD[d.kind])} ${esc(d.number)}</title><style>
    body{font-family:Inter,Arial,sans-serif;color:black;margin:40px;font-size:13px}h1{font-size:22px;margin:0}.top{display:flex;justify-content:space-between;gap:24px;margin-bottom:24px}
    .muted{color:dimgray}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{padding:8px;border-bottom:1px solid gainsboro;text-align:left;vertical-align:top}.n{text-align:right;white-space:nowrap}
    .sum{margin-top:16px;margin-left:auto;width:280px}.sum div{display:flex;justify-content:space-between;padding:4px 0}.sum .t{font-weight:700;border-top:2px solid black;margin-top:4px;padding-top:8px;font-size:15px}pre{white-space:pre-wrap;font-family:inherit}
  </style></head><body>
    <div class="top"><div><h1>${esc(WORD[d.kind])} ${esc(d.number)}</h1><p class="muted">From ${esc(from)}</p></div><div style="text-align:right"><p>Date: ${esc(dayLabel(d.issueDate))}</p>${d.dueDate ? `<p>${d.kind === 'INVOICE' ? 'Due' : 'Valid until'}: ${esc(dayLabel(d.dueDate))}</p>` : ''}${d.status === 'PAID' ? '<p><strong>PAID</strong></p>' : ''}</div></div>
    <p><strong>${esc(d.customerName)}</strong></p>${d.customerAddress ? `<pre class="muted">${esc(d.customerAddress)}</pre>` : ''}
    <table><thead><tr><th>Item</th><th class="n">Qty</th><th class="n">Price</th><th class="n">Amount</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="sum"><div><span>Subtotal</span><span>${m(d.subtotal)}</span></div>${d.discount ? `<div><span>Discount</span><span>-${m(d.discount)}</span></div>` : ''}${d.taxRate ? `<div><span>Tax (${d.taxRate}%)</span><span>${m(d.tax)}</span></div>` : ''}<div class="t"><span>Total</span><span>${m(d.total)}</span></div></div>
    ${d.notes ? `<pre style="margin-top:24px">${esc(d.notes)}</pre>` : ''}
  </body></html>`
  const w = window.open('', '_blank')
  if (!w) return false
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 200)
  return true
}

export default function SalesDocs() {
  const { addToast } = useToast()
  const [kind, setKind] = useState<Kind>('QUOTE')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [editing, setEditing] = useState<{ doc: Doc | null } | null>(null)
  const [open, setOpen] = useState<{ doc: Doc; from: string } | null>(null)

  const load = useCallback(() => { api.get<{ docs: Row[]; summary: Summary }>('/sales-docs').then((r) => { setRows(r.docs); setSummary(r.summary) }).catch(() => setRows([])) }, [])
  useEffect(load, [load])
  const show = (id: string) => api.get<{ doc: Doc; from: string }>(`/sales-docs/${id}`).then(setOpen).catch(() => addToast({ type: 'error', message: 'Could not open that document.' }))
  const shown = (rows ?? []).filter((r) => r.kind === kind)
  const tile = (label: string, value: number, tone?: string) => (<div className="rounded-card border border-line bg-card p-4 shadow-card"><p className="text-body-sm text-ink-muted">{label}</p><p className={`mt-1 text-title-lg tabular-nums ${tone ?? 'text-ink'}`}>{money(value)}</p></div>)

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">Quotes and invoices</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">Write a quote, send it, turn it into an invoice and mark it paid.</p>
        </div>
        <Button leadingIcon={<Plus size={16} />} onClick={() => setEditing({ doc: null })}>New {WORD[kind].toLowerCase()}</Button>
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tile('Quotes sent, no answer yet', summary.openQuotes)}
          {tile('Invoices not paid yet', summary.owed)}
          {tile('Of that, overdue', summary.overdue, summary.overdue ? 'text-danger-ink' : undefined)}
          {tile('Paid this month', summary.paidThisMonth, 'text-success-ink')}
        </div>
      )}
      <p className="text-body-sm text-ink-muted">Totals add documents as numbers whatever their currency: keep to one currency for them to mean something.</p>

      <PillFilter<Kind> value={kind} onChange={setKind} options={[{ value: 'QUOTE', label: 'Quotes' }, { value: 'INVOICE', label: 'Invoices' }]} />

      <Card flush>
        {rows === null ? <p className="p-5 text-body-md text-ink-muted">Loading...</p> : shown.length === 0 ? (
          <EmptyState icon={<FileText size={22} />} title={`No ${WORD[kind].toLowerCase()}s yet`} hint={kind === 'INVOICE' ? 'Make one here, or open a quote and choose "Make invoice".' : 'Start with "New quote".'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-body-md">
              <thead className="border-b border-line text-body-sm text-ink-muted"><tr><th className="px-4 py-2.5 font-medium">Number</th><th className="px-4 py-2.5 font-medium">Customer</th><th className="px-4 py-2.5 font-medium">Date</th><th className="px-4 py-2.5 font-medium">{kind === 'INVOICE' ? 'Due' : 'Valid until'}</th><th className="px-4 py-2.5 text-right font-medium">Total</th><th className="px-4 py-2.5 font-medium">Status</th></tr></thead>
              <tbody className="divide-y divide-line">
                {shown.map((r) => (
                  <tr key={r.id} onClick={() => void show(r.id)} className="cursor-pointer hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium tabular-nums text-ink">{r.number}</td>
                    <td className="px-4 py-2.5 text-ink">{r.customerName}</td>
                    <td className="px-4 py-2.5 text-ink-muted">{dayLabel(r.issueDate)}</td>
                    <td className={`px-4 py-2.5 ${r.overdue ? 'text-danger-ink' : 'text-ink-muted'}`}>{dayLabel(r.dueDate)}{r.overdue ? ' (overdue)' : ''}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink">{money(r.total, r.currency)}</td>
                    <td className="px-4 py-2.5"><Badge tone={STATUS[r.status]?.tone ?? 'neutral'}>{STATUS[r.status]?.label ?? r.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {open && <DocModal doc={open.doc} from={open.from} onClose={() => setOpen(null)} onChanged={(doc) => { setOpen(doc ? { doc, from: open.from } : null); load() }} onEdit={() => { setEditing({ doc: open.doc }); setOpen(null) }} onOpen={(id) => void show(id)} />}
      {editing && <Editor kind={editing.doc?.kind ?? kind} doc={editing.doc} onClose={() => setEditing(null)} onSaved={(d) => { setEditing(null); setKind(d.kind); load(); void show(d.id) }} />}
    </div>
  )
}

function DocModal({ doc: d, from, onClose, onChanged, onEdit, onOpen }: { doc: Doc; from: string; onClose: () => void; onChanged: (d: Doc | null) => void; onEdit: () => void; onOpen: (id: string) => void }) {
  const { addToast } = useToast()
  const [busy, setBusy] = useState(false)
  async function act(fn: () => Promise<Doc | null>, ok: string) {
    setBusy(true)
    try { onChanged(await fn()); addToast({ type: 'success', message: ok }) } catch (e) { addToast({ type: 'error', message: errMsg(e, 'That did not work. Try again.') }) } finally { setBusy(false) }
  }
  const status = (s: string, ok: string, note?: string) => act(async () => (await api.post<{ doc: Doc }>(`/sales-docs/${d.id}/status`, { status: s, note })).doc, ok)
  const m = (n: number) => money(n, d.currency)
  return (
    <Modal open onClose={onClose} title={`${WORD[d.kind]} ${d.number}`} size="xl"
      footer={<div className="flex w-full flex-wrap justify-end gap-2">
        <Button variant="secondary" leadingIcon={<Printer size={15} />} onClick={() => { if (!printDoc(d, from)) addToast({ type: 'error', message: 'Your browser blocked the print window. Allow pop-ups for this site.' }) }}>Print or save as PDF</Button>
        {d.canEdit && d.status === 'DRAFT' && <Button variant="secondary" onClick={onEdit}>Edit</Button>}
        {d.canEdit && d.status === 'DRAFT' && <Button variant="secondary" disabled={busy} leadingIcon={<Trash2 size={15} />} onClick={() => { if (window.confirm(`Delete ${d.number}? This cannot be undone.`)) void act(async () => { await api.del(`/sales-docs/${d.id}`); return null }, 'Deleted.') }}>Delete</Button>}
        {d.canEdit && d.status !== 'DRAFT' && d.status !== 'PAID' && <Button variant="secondary" disabled={busy} onClick={() => void status('DRAFT', 'Back to draft.')}>Back to draft</Button>}
        {d.canEdit && d.status === 'DRAFT' && <Button variant="secondary" disabled={busy} onClick={() => void status('SENT', 'Marked as sent.')}>Mark as sent</Button>}
        {d.canEdit && d.status !== 'VOID' && d.status !== 'PAID' && <Button variant="secondary" disabled={busy} leadingIcon={<Send size={15} />} onClick={() => void act(async () => (await api.post<{ doc: Doc }>(`/sales-docs/${d.id}/send`)).doc, `Emailed to ${d.customerEmail || 'the customer'}.`)}>Email to customer</Button>}
        {d.canEdit && d.kind === 'QUOTE' && d.status === 'SENT' && <Button variant="secondary" disabled={busy} onClick={() => void status('DECLINED', 'Marked as declined.')}>Declined</Button>}
        {d.canEdit && d.kind === 'QUOTE' && d.status === 'SENT' && <Button variant="secondary" disabled={busy} onClick={() => void status('ACCEPTED', 'Marked as accepted.')}>Accepted</Button>}
        {d.canEdit && d.kind === 'QUOTE' && d.status !== 'DECLINED' && <Button disabled={busy} onClick={() => { setBusy(true); api.post<{ doc: Doc }>(`/sales-docs/${d.id}/convert`).then((r) => { addToast({ type: 'success', message: `Invoice ${r.doc.number} made.` }); onChanged(null); onOpen(r.doc.id) }).catch((e) => addToast({ type: 'error', message: errMsg(e, 'Could not make the invoice.') })).finally(() => setBusy(false)) }}>Make invoice</Button>}
        {d.canEdit && d.kind === 'INVOICE' && d.status === 'SENT' && <Button variant="secondary" disabled={busy} onClick={() => { if (window.confirm(`Void invoice ${d.number}? Its number is kept and never used again.`)) void status('VOID', 'Invoice voided.') }}>Void</Button>}
        {d.canEdit && d.kind === 'INVOICE' && d.status === 'SENT' && <Button disabled={busy} onClick={() => { const note = window.prompt('How was it paid? (optional, for example: bank transfer)') ?? undefined; void status('PAID', 'Marked as paid.', note || undefined) }}>Mark as paid</Button>}
      </div>}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-body-lg font-semibold text-ink">{d.customerName}</p>{d.customerEmail && <p className="text-body-sm text-ink-muted">{d.customerEmail}</p>}{d.customerAddress && <p className="whitespace-pre-wrap text-body-sm text-ink-muted">{d.customerAddress}</p>}</div>
          <div className="text-right text-body-sm text-ink-muted">
            <Badge tone={STATUS[d.status]?.tone ?? 'neutral'}>{STATUS[d.status]?.label ?? d.status}</Badge>
            <p className="mt-1">Date: {dayLabel(d.issueDate)}</p>
            {d.dueDate && <p className={d.overdue ? 'text-danger-ink' : ''}>{d.kind === 'INVOICE' ? 'Due' : 'Valid until'}: {dayLabel(d.dueDate)}</p>}
            {d.status === 'PAID' && <p>Paid{d.paidNote ? `: ${d.paidNote}` : ''}</p>}
            <p>Made by {d.createdBy}</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-body-md">
            <thead className="border-b border-line text-body-sm text-ink-muted"><tr><th className="py-2 font-medium">Item</th><th className="py-2 text-right font-medium">Qty</th><th className="py-2 text-right font-medium">Price</th><th className="py-2 text-right font-medium">Amount</th></tr></thead>
            <tbody className="divide-y divide-line">{d.lines.map((l, i) => (<tr key={i}><td className="py-2 text-ink">{l.description}</td><td className="py-2 text-right tabular-nums">{l.quantity}</td><td className="py-2 text-right tabular-nums">{m(l.unitPrice)}</td><td className="py-2 text-right tabular-nums text-ink">{m(l.amount ?? 0)}</td></tr>))}</tbody>
          </table>
        </div>
        <div className="ml-auto w-full max-w-xs space-y-1 text-body-md tabular-nums">
          <div className="flex justify-between text-ink-muted"><span>Subtotal</span><span>{m(d.subtotal)}</span></div>
          {d.discount > 0 && <div className="flex justify-between text-ink-muted"><span>Discount</span><span>-{m(d.discount)}</span></div>}
          {d.taxRate > 0 && <div className="flex justify-between text-ink-muted"><span>Tax ({d.taxRate}%)</span><span>{m(d.tax)}</span></div>}
          <div className="flex justify-between border-t border-line pt-1.5 text-body-lg font-semibold text-ink"><span>Total</span><span>{m(d.total)}</span></div>
        </div>
        {d.notes && <p className="whitespace-pre-wrap rounded-btn border border-line bg-slate-50 p-3 text-body-sm text-ink">{d.notes}</p>}
      </div>
    </Modal>
  )
}

function Editor({ kind, doc, onClose, onSaved }: { kind: Kind; doc: Doc | null; onClose: () => void; onSaved: (d: Doc) => void }) {
  const { addToast } = useToast()
  const today = new Date().toISOString().slice(0, 10)
  const [f, setF] = useState({ customerName: doc?.customerName ?? '', customerEmail: doc?.customerEmail ?? '', customerAddress: doc?.customerAddress ?? '', issueDate: doc?.issueDate ?? today, dueDate: doc?.dueDate ?? '', currency: doc?.currency ?? 'USD', taxRate: String(doc?.taxRate ?? 0), discount: String(doc?.discount ?? 0), notes: doc?.notes ?? '' })
  const [lines, setLines] = useState<{ description: string; quantity: string; unitPrice: string }[]>(doc?.lines.map((l) => ({ description: l.description, quantity: String(l.quantity), unitPrice: String(l.unitPrice) })) ?? [{ description: '', quantity: '1', unitPrice: '' }])
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  const line = (i: number, k: 'description' | 'quantity' | 'unitPrice', v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)))
  const subtotal = round(lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0))
  const after = Math.max(0, subtotal - (Number(f.discount) || 0))
  const tax = round((after * (Number(f.taxRate) || 0)) / 100)

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const body = { kind, customerName: f.customerName.trim(), customerEmail: f.customerEmail.trim(), customerAddress: f.customerAddress.trim(), issueDate: f.issueDate, dueDate: f.dueDate || null, currency: f.currency.trim().toUpperCase() || 'USD', taxRate: Number(f.taxRate) || 0, discount: Number(f.discount) || 0, notes: f.notes.trim(), lines: lines.filter((l) => l.description.trim()).map((l) => ({ description: l.description.trim(), quantity: Number(l.quantity) || 0, unitPrice: Number(l.unitPrice) || 0 })) }
      const r = doc ? await api.put<{ doc: Doc }>(`/sales-docs/${doc.id}`, body) : await api.post<{ doc: Doc }>('/sales-docs', body)
      addToast({ type: 'success', message: 'Saved.' })
      onSaved(r.doc)
    } catch (err) { addToast({ type: 'error', message: errMsg(err, 'Could not save the document.') }) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={doc ? `Edit ${WORD[kind].toLowerCase()} ${doc.number}` : `New ${WORD[kind].toLowerCase()}`} size="xl" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="doc-form" disabled={busy}>Save as draft</Button></>}>
      <form id="doc-form" onSubmit={save} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className={labelCls} htmlFor="sd-name">Customer</label><input id="sd-name" required maxLength={160} value={f.customerName} onChange={set('customerName')} className={inputCls} /></div>
          <div><label className={labelCls} htmlFor="sd-email">Customer's email</label><input id="sd-email" type="email" value={f.customerEmail} onChange={set('customerEmail')} className={inputCls} placeholder="Needed to email it" /></div>
          <div className="sm:col-span-2"><label className={labelCls} htmlFor="sd-addr">Address (optional)</label><textarea id="sd-addr" rows={2} value={f.customerAddress} onChange={set('customerAddress')} className={areaCls} maxLength={400} /></div>
          <div><label className={labelCls} htmlFor="sd-date">Date</label><input id="sd-date" type="date" required value={f.issueDate} onChange={set('issueDate')} className={inputCls} /></div>
          <div><label className={labelCls} htmlFor="sd-due">{kind === 'INVOICE' ? 'Due date' : 'Valid until'}</label><input id="sd-due" type="date" value={f.dueDate} onChange={set('dueDate')} className={inputCls} /></div>
        </div>
        <div>
          <p className={labelCls}>Lines</p>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <input aria-label={`Line ${i + 1}: what`} value={l.description} onChange={(e) => line(i, 'description', e.target.value)} placeholder="What is it" maxLength={300} className={`${inputCls} min-w-0 flex-1`} />
                <input aria-label={`Line ${i + 1}: quantity`} type="number" min="0" step="any" value={l.quantity} onChange={(e) => line(i, 'quantity', e.target.value)} className={`${inputCls} w-20`} />
                <input aria-label={`Line ${i + 1}: price each`} type="number" min="0" step="0.01" value={l.unitPrice} onChange={(e) => line(i, 'unitPrice', e.target.value)} placeholder="Price" className={`${inputCls} w-28`} />
                <span className="w-28 text-right text-body-md tabular-nums text-ink">{money(round((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0)), f.currency || 'USD')}</span>
                <button type="button" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="rounded-btn p-2 text-ink-faint hover:bg-slate-100 hover:text-danger-ink disabled:opacity-40" aria-label={`Remove line ${i + 1}`}><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
          <Button size="sm" variant="secondary" className="mt-2" leadingIcon={<Plus size={14} />} onClick={() => setLines((ls) => [...ls, { description: '', quantity: '1', unitPrice: '' }])}>Add a line</Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <div><label className={labelCls} htmlFor="sd-cur">Currency</label><input id="sd-cur" maxLength={3} value={f.currency} onChange={(e) => setF((x) => ({ ...x, currency: e.target.value.toUpperCase() }))} className={inputCls} /></div>
          <div><label className={labelCls} htmlFor="sd-disc">Discount</label><input id="sd-disc" type="number" min="0" step="0.01" value={f.discount} onChange={set('discount')} className={inputCls} /></div>
          <div><label className={labelCls} htmlFor="sd-tax">Tax %</label><input id="sd-tax" type="number" min="0" max="100" step="0.01" value={f.taxRate} onChange={set('taxRate')} className={inputCls} /></div>
          <div className="rounded-btn border border-line bg-slate-50 px-3 py-2"><p className="text-body-sm text-ink-muted">Total</p><p className="text-title-md tabular-nums text-ink">{money(round(after + tax), f.currency || 'USD')}</p></div>
        </div>
        <div><label className={labelCls} htmlFor="sd-notes">Notes on the document (payment details, terms)</label><textarea id="sd-notes" rows={3} value={f.notes} onChange={set('notes')} className={areaCls} maxLength={2000} /></div>
      </form>
    </Modal>
  )
}
