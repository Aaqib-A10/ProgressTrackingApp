import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { AlertTriangle, Flag, KanbanSquare, Phone, Plus, Search, Trophy, Wallet } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { EmptyState } from '../../../components/ui/EmptyState'
import { Modal } from '../../../components/ui/Modal'
import { TextArea, TextField } from '../../../components/ui/Input'
import { useToast } from '../../../components/ui/Toast'
import { apiErrorText } from '../../../lib/api'
import { cn } from '../../../lib/cn'
import { CLOSE_REASONS, CLOSE_REASON_LABEL, fmtDate, leadsApi, leadTitle, money, type BoardColumn, type DealBoard as Board, type LeadRow } from '../../../lib/leadsApi'
import { AddLeadModal } from './AddLeadModal'
import { BusinessPicker, FactsMeter, Label, PageHeader, Select, initials, useBusiness, useLeadsMeta } from './shared'

/**
 * The deal board: the business's pipeline as columns, a card per lead, what each stage is worth on
 * top. Drag a card to another stage to change its status; dropping on a closing stage asks why.
 * On a phone it shows one stage at a time, and each card has "Move to".
 */
export default function DealBoard() {
  const nav = useNavigate()
  const { addToast } = useToast()
  const { meta } = useLeadsMeta()
  const { business } = useBusiness()
  const [params, setParams] = useSearchParams()
  const assignee = params.get('assignee') ?? ''
  const [q, setQ] = useState(params.get('q') ?? '')
  const [d, setD] = useState<Board | null>(null)
  const [err, setErr] = useState('')
  const [adding, setAdding] = useState(false)
  const [closing, setClosing] = useState<{ lead: LeadRow; to: BoardColumn } | null>(null)
  const [dragging, setDragging] = useState<LeadRow | null>(null)
  const [phoneCol, setPhoneCol] = useState(0)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const cmr = business?.kind === 'CMR'
  const canManage = !!meta?.me.admin || business?.myRole === 'MANAGER'

  const load = useCallback(() => {
    if (!business) return
    leadsApi.board({ business: business.id, assignee: assignee || undefined, q: params.get('q') ?? undefined }).then((r) => { setD(r); setErr('') }).catch((e) => setErr(apiErrorText(e, 'Could not load the board')))
  }, [business, assignee, params])
  useEffect(() => { load() }, [load])

  const setParam = (k: string, v: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n })
  const timer = useRef<number>()
  const onSearch = (v: string) => { setQ(v); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setParam('q', v.trim() || null), 350) }

  /** Put the card in its new column at once; the server's answer follows. */
  const moveLocal = (lead: LeadRow, to: BoardColumn) => setD((cur) => cur && ({
    ...cur,
    columns: cur.columns.map((c) => c.key === lead.status ? { ...c, count: c.count - 1, value: c.value - (lead.value ?? 0), leads: c.leads.filter((l) => l.id !== lead.id) }
      : c.key === to.key ? { ...c, count: c.count + 1, value: c.value + (lead.value ?? 0), leads: [{ ...lead, status: to.key, statusLabel: to.label, open: to.open }, ...c.leads] } : c),
  }))

  const move = async (lead: LeadRow, to: BoardColumn) => {
    if (to.key === lead.status) return
    // CMR: Qualified goes through Qualify (the five facts are checked, Jesse is told).
    if (cmr && to.key === 'QUALIFIED') { nav(`/app/leads/${lead.id}?qualify=1`); return }
    if (!to.open) { setClosing({ lead, to }); return }
    moveLocal(lead, to)
    try { await leadsApi.update(lead.id, { status: to.key }); addToast({ type: 'success', message: `${leadTitle(lead)} → ${to.label}` }) } catch (e) { addToast({ type: 'error', message: apiErrorText(e, 'Could not move it') }) }
    load()
  }

  const onDragStart = (e: DragStartEvent) => setDragging((e.active.data.current?.lead as LeadRow | undefined) ?? null)
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null)
    const lead = e.active.data.current?.lead as LeadRow | undefined
    const to = d?.columns.find((c) => `stage:${c.key}` === e.over?.id)
    if (lead && to) void move(lead, to)
  }

  const cols = d?.columns ?? []
  const pc = cols[Math.min(phoneCol, Math.max(0, cols.length - 1))]
  const currency = d?.currency ?? business?.settings.currency ?? 'USD'
  const hasValues = useMemo(() => cols.some((c) => c.value > 0), [cols])

  if (!business) return <div className="mx-auto max-w-xl py-16"><EmptyState icon={<KanbanSquare />} title="No business to show" hint={meta?.me.admin ? 'Add a business under Lead Settings first.' : 'Ask your manager to add you to a business.'} action={meta?.me.admin ? <Link to="/app/leads/settings"><Button size="sm">Lead Settings</Button></Link> : undefined} /></div>

  return (
    <div className="mx-auto w-full max-w-[1900px] space-y-4">
      <PageHeader title="Deal Board" hint={`${business.name} · drag a card to another stage to move the deal along`} actions={<>
        <BusinessPicker />
        {canManage && <Select value={assignee} onChange={(e) => setParam('assignee', e.target.value || null)} aria-label="Person"><option value="">Everyone</option><option value="me">Me</option><option value="none">Unassigned</option>{business.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>}
        <Button size="sm" leadingIcon={<Plus size={15} />} onClick={() => setAdding(true)}>Add lead</Button>
      </>} />

      {/* What the pipeline is worth */}
      <div className="flex flex-wrap items-stretch gap-3">
        <div className="flex min-w-[200px] flex-1 items-center gap-3 rounded-card border border-line bg-card px-4 py-3 shadow-xs">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Wallet size={19} /></span>
          <div><div className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-muted">Open pipeline</div><div className="text-[20px] font-bold tabular-nums leading-tight text-ink">{d ? (hasValues ? money(d.totals.open.value, currency) : d.totals.open.count) : '—'}<span className="ml-2 text-body-sm font-medium text-ink-muted">{d ? `${d.totals.open.count} deal${d.totals.open.count === 1 ? '' : 's'}` : ''}</span></div></div>
        </div>
        <div className="flex min-w-[200px] flex-1 items-center gap-3 rounded-card border border-line bg-card px-4 py-3 shadow-xs">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-success/10 text-success"><Trophy size={19} /></span>
          <div><div className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-muted">Won · last {d?.closedDays ?? 60} days</div><div className="text-[20px] font-bold tabular-nums leading-tight text-ink">{d ? (hasValues ? money(d.totals.won.value, currency) : d.totals.won.count) : '—'}<span className="ml-2 text-body-sm font-medium text-ink-muted">{d ? `${d.totals.won.count} deal${d.totals.won.count === 1 ? '' : 's'}` : ''}</span></div></div>
        </div>
        <div className="relative min-w-[220px] flex-[2] self-center">
          <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
          <TextField value={q} onChange={(e) => onSearch(e.target.value)} placeholder="Search company, contact, phone, email…" className="pl-8" aria-label="Search the board" />
        </div>
      </div>
      {err && <p className="rounded-btn bg-danger/10 px-3 py-2 text-body-sm text-danger">{err}</p>}
      {!d && !err && <div className="h-64 animate-pulse rounded-card border border-line bg-card" />}

      {d && (
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
          {/* Phones: one stage at a time. */}
          <div className="md:hidden">
            <div className="mb-3 flex flex-wrap gap-1.5">
              {cols.map((c, i) => (
                <button key={c.key} type="button" onClick={() => setPhoneCol(i)} className={cn('inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-body-sm font-semibold', i === phoneCol ? 'border-ink bg-ink text-card' : 'border-line bg-card text-ink-muted')}>
                  <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />{c.label}<span className={cn('tabular-nums', i === phoneCol ? 'text-card/70' : 'text-ink-faint')}>{c.count}</span>
                </button>
              ))}
            </div>
            {pc && <Column col={pc} currency={currency} showValue={hasValues} cmr={cmr} onOpen={(l) => nav(`/app/leads/${l.id}`)} moveTo={{ columns: cols, onMove: move }} full />}
          </div>
          {/* Wider screens: every stage side by side. */}
          <div className="flex gap-3 overflow-x-auto pb-3 max-md:hidden">
            {cols.map((c) => <Column key={c.key} col={c} currency={currency} showValue={hasValues} cmr={cmr} onOpen={(l) => nav(`/app/leads/${l.id}`)} />)}
          </div>
          <DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' }}>
            {dragging ? <div className="w-[264px] rotate-[1.5deg] cursor-grabbing rounded-btn border border-primary/40 bg-card p-3 shadow-overlay"><CardBody l={dragging} currency={currency} cmr={cmr} /></div> : null}
          </DragOverlay>
        </DndContext>
      )}
      {d && <p className="text-[11.5px] text-ink-faint">Closed stages show deals closed in the last {d.closedDays} days. Each stage shows its newest 60 cards; the <Link to={`/app/leads?business=${business.id}&status=all`} className="text-primary hover:underline">leads list</Link> has everything.</p>}

      {adding && <AddLeadModal business={business} onClose={() => setAdding(false)} onAdded={(id) => { setAdding(false); nav(`/app/leads/${id}`) }} />}
      {closing && <CloseDialog lead={closing.lead} to={closing.to} cmr={cmr} canManage={canManage} onClose={() => setClosing(null)} onDone={() => { setClosing(null); load() }} />}
    </div>
  )
}

function Column({ col, currency, showValue, cmr, onOpen, moveTo, full }: { col: BoardColumn; currency: string; showValue: boolean; cmr: boolean; onOpen: (l: LeadRow) => void; moveTo?: { columns: BoardColumn[]; onMove: (l: LeadRow, to: BoardColumn) => void }; full?: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `stage:${col.key}` })
  return (
    <section ref={setNodeRef} aria-label={col.label} className={cn('flex max-h-[calc(100vh-300px)] min-h-[280px] shrink-0 flex-col rounded-card border transition-colors', full ? 'w-full' : 'w-[280px]', isOver ? 'border-primary bg-primary/[0.06]' : 'border-transparent bg-slate-100/70 dark:bg-white/[0.03]', !col.open && !isOver && 'opacity-90')}>
      <header className="px-3 pb-2 pt-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: col.color }} />
          <h3 className="text-label-md uppercase text-ink-muted">{col.label}</h3>
          <span className="text-body-sm tabular-nums text-ink-faint">{col.count}</span>
          {!col.open && <span className="ml-auto text-[10.5px] font-medium uppercase tracking-wide text-ink-faint">closed</span>}
        </div>
        {showValue && <div className="mt-0.5 text-body-sm font-semibold tabular-nums text-ink">{col.value > 0 ? money(col.value, currency) : <span className="font-normal text-ink-faint">—</span>}</div>}
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
        {col.leads.map((l) => (
          <div key={l.id}>
            <Card l={l} currency={currency} cmr={cmr} onOpen={onOpen} />
            {moveTo && (
              <label className="-mt-1 flex items-center gap-2 rounded-b-btn border border-t-0 border-line bg-card px-3 py-1.5 text-[11.5px] text-ink-muted">Move to
                <select value={col.key} onChange={(e) => { const to = moveTo.columns.find((c) => c.key === e.target.value); if (to) moveTo.onMove(l, to) }} className="h-7 flex-1 rounded-btn border border-line bg-card px-1.5 text-[12px] text-ink" aria-label="Move to">
                  {moveTo.columns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </label>
            )}
          </div>
        ))}
        {col.count > col.leads.length && <p className="px-1 py-1 text-center text-[11.5px] text-ink-faint">+{col.count - col.leads.length} more in the leads list</p>}
        {!col.leads.length && <p className="rounded-btn border border-dashed border-line px-3 py-6 text-center text-body-sm text-ink-faint">{col.open ? 'Drop a deal here' : 'Nothing closed here lately'}</p>}
      </div>
    </section>
  )
}

function Card({ l, currency, cmr, onOpen }: { l: LeadRow; currency: string; cmr: boolean; onOpen: (l: LeadRow) => void }) {
  const drag = useDraggable({ id: l.id, data: { lead: l } })
  return (
    <div ref={drag.setNodeRef} {...drag.listeners} {...drag.attributes} role="button" tabIndex={0} onClick={() => onOpen(l)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(l) }}
      className={cn('block w-full cursor-pointer rounded-btn border bg-card p-3 text-left shadow-xs transition-shadow hover:border-line-strong hover:shadow-sm', l.jesseInputNeeded ? 'border-orange-200' : 'border-line', drag.isDragging && 'opacity-30 shadow-none')}>
      <CardBody l={l} currency={currency} cmr={cmr} />
    </div>
  )
}

function CardBody({ l, currency, cmr }: { l: LeadRow; currency: string; cmr: boolean }) {
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 text-body-md font-semibold leading-snug text-ink">{leadTitle(l)}</p>
        {l.value != null && l.value > 0 && <span className="shrink-0 rounded-full bg-success/10 px-2 py-0.5 text-[12px] font-bold tabular-nums text-success">{money(l.value, currency, true)}</span>}
      </div>
      <p className="mt-0.5 truncate text-[11.5px] text-ink-muted">{[l.organization ? l.name : null, l.phone].filter(Boolean).join(' · ') || l.email || 'No contact yet'}</p>
      {(l.nextStep || l.nextStepDate) && (
        <p className={cn('mt-1.5 flex items-center gap-1 text-[11.5px]', l.overdue ? 'font-semibold text-danger' : 'text-ink-muted')}>{l.overdue && <AlertTriangle size={11} className="shrink-0" />}<span className="truncate">{l.nextStep ?? 'Next step'}</span>{l.nextStepDate && <span className="shrink-0">· {fmtDate(l.nextStepDate)}</span>}</p>
      )}
      <div className="mt-2 flex items-center gap-2">
        {l.assignee ? <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary" title={l.assignee.name}>{initials(l.assignee.name)}</span> : <span className="text-[11px] font-medium text-warning">Unassigned</span>}
        <span className="inline-flex items-center gap-1 text-[11px] tabular-nums text-ink-faint"><Phone size={11} />{l.callsCount}</span>
        {l.openTasks > 0 && <Badge tone="primary" className="whitespace-nowrap">{l.openTasks} task{l.openTasks === 1 ? '' : 's'}</Badge>}
        {l.jesseInputNeeded && <span title="Waiting on Jesse"><Flag size={12} className="text-orange-500" /></span>}
        {l.prohibited && <Badge tone="danger">Prohibited</Badge>}
        {cmr && <span className="ml-auto"><FactsMeter facts={l.facts} size="sm" /></span>}
      </div>
    </>
  )
}

/** Dropping a deal on a closing stage: say why (CMR picks a reason from its list). */
function CloseDialog({ lead, to, cmr, canManage, onClose, onDone }: { lead: LeadRow; to: BoardColumn; cmr: boolean; canManage: boolean; onClose: () => void; onDone: () => void }) {
  const { addToast } = useToast()
  const [reason, setReason] = useState<string>('OTHER')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const won = /WON/.test(to.key)
  const blocked = won && !canManage
  const go = async () => {
    setBusy(true)
    try { await leadsApi.close(lead.id, { status: to.key, reason: cmr ? reason : note.trim() || undefined, note: note.trim() || undefined }); addToast({ type: 'success', message: `${leadTitle(lead)} → ${to.label}` }); onDone() } catch (e) { addToast({ type: 'error', message: apiErrorText(e, 'Could not close it') }) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={`${to.label}: ${leadTitle(lead)}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || blocked} onClick={go}>Move to {to.label}</Button></>}>
      <div className="space-y-3">
        {blocked ? <p className="rounded-btn bg-warning/10 px-3 py-2 text-body-sm text-ink">Only a manager marks a deal as won. Ask your manager to move it.</p> : (
          <>
            {cmr && <label><Label>Reason</Label><Select value={reason} onChange={(e) => setReason(e.target.value)} className="w-full">{CLOSE_REASONS.map((r) => <option key={r} value={r}>{CLOSE_REASON_LABEL[r]}</option>)}</Select></label>}
            <TextArea label={won ? 'Note (optional)' : cmr ? 'Note' : 'Reason / note'} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={won ? 'What was sold, for how much' : 'Why it closed'} />
            <p className="text-[11.5px] text-ink-muted">Closing clears the next step and finishes the lead’s open tasks.</p>
          </>
        )}
      </div>
    </Modal>
  )
}
