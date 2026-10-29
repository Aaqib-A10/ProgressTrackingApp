import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { ArrowDown, ArrowUp, CalendarDays, ChevronLeft, ChevronRight, Columns3, Download, Plus, Search, Table2, Trash2 } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { useToast } from '../../../components/ui/Toast'
import { cn } from '../../../lib/cn'
import { apiErrorText } from '../../../lib/api'
import { customApi, iconOf, type CustomBlock, type CustomField, type CustomRecord } from '../../../lib/customApi'
import { FieldInput, FieldValue, valueText } from './fields'
import { fmtAgo } from '../../../components/projects/pmUi'

/**
 * A block the company made itself (Department Studio, part C): its records as a table, a board
 * (by its choice field) or a calendar (by its date field). Who sees and changes what is decided
 * on the server (lib/customBlocks.ts).
 */

type View = 'table' | 'board' | 'calendar'
type People = { id: string; name: string }[]

export default function CustomBlockPage() {
  const { id = '' } = useParams()
  const { addToast } = useToast()
  const [block, setBlock] = useState<CustomBlock | null>(null)
  const [canAdd, setCanAdd] = useState(false)
  const [lead, setLead] = useState(false)
  const [people, setPeople] = useState<People>([])
  const [records, setRecords] = useState<CustomRecord[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [view, setView] = useState<View>('table')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<CustomRecord | 'new' | null>(null)

  const load = useCallback(() => {
    customApi.records(id).then((r) => setRecords(r.records)).catch((e) => setFailed(apiErrorText(e, 'Could not load.')))
  }, [id])
  useEffect(() => {
    setBlock(null); setRecords(null); setFailed(null)
    customApi.get(id).then((r) => {
      setBlock(r.block); setCanAdd(r.canAdd); setLead(r.lead); setPeople(r.people)
      try { const v = localStorage.getItem(`custom.view.${id}`) as View | null; if (v && (v === 'table' || (v === 'board' && r.block.settings.boardField) || (v === 'calendar' && r.block.settings.dateField))) setView(v) } catch { /* ignore */ }
    }).catch((e) => setFailed(apiErrorText(e, 'Could not open this block.')))
    load()
  }, [id, load])
  function pickView(v: View) { setView(v); try { localStorage.setItem(`custom.view.${id}`, v) } catch { /* ignore */ } }

  const shown = useMemo(() => {
    if (!records || !block) return []
    const ql = q.trim().toLowerCase()
    if (!ql) return records
    return records.filter((r) => block.fields.some((f) => valueText(f, r.data[f.key], people).toLowerCase().includes(ql)) || (r.createdBy?.name ?? '').toLowerCase().includes(ql))
  }, [records, block, q, people])

  async function moveTo(r: CustomRecord, field: string, value: string | null) {
    setRecords((list) => list?.map((x) => (x.id === r.id ? { ...x, data: { ...x.data, [field]: value } } : x)) ?? list)
    try { await customApi.change(id, r.id, { [field]: value }) } catch (e) { addToast({ type: 'error', message: apiErrorText(e, 'Could not move it.') }); load() }
  }

  function downloadCsv() {
    if (!block) return
    const head = [...block.fields.map((f) => f.label), 'Added by', 'Department', 'Added']
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const csv = [head.map(esc).join(','), ...shown.map((r) => [...block.fields.map((f) => valueText(f, r.data[f.key], people)), r.createdBy?.name ?? '', r.department ?? '', r.createdAt.slice(0, 10)].map(esc).join(','))].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `${block.name.replace(/[^\w-]+/g, '-')}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  if (failed) return <div className="mx-auto w-full max-w-[1800px] py-16 text-center text-body-md text-ink-muted">{failed}</div>
  if (!block) return <div className="mx-auto w-full max-w-[1800px] py-16 text-center text-body-md text-ink-muted">Loading…</div>
  const Icon = iconOf(block.icon)
  const boardField = block.fields.find((f) => f.key === block.settings.boardField)
  const dateField = block.fields.find((f) => f.key === block.settings.dateField)

  return (
    <div className="mx-auto w-full max-w-[1800px] space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-card" style={{ background: `${block.color}1f`, color: block.color }}><Icon size={22} /></span>
        <div className="min-w-0">
          <h1 className="text-headline-lg text-ink">{block.name}</h1>
          <p className="text-body-md text-ink-muted">{block.description || (lead ? "Your department's records." : block.settings.membersSee === 'own' ? 'Your own records.' : "Your department's records.")}</p>
        </div>
        {canAdd && <Button className="ml-auto" leadingIcon={<Plus size={16} />} onClick={() => setEditing('new')}>Add</Button>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-btn border border-line bg-card p-0.5" role="tablist" aria-label="View">
          <ViewTab on={view === 'table'} onClick={() => pickView('table')} icon={<Table2 size={14} />}>Table</ViewTab>
          {boardField && <ViewTab on={view === 'board'} onClick={() => pickView('board')} icon={<Columns3 size={14} />}>Board</ViewTab>}
          {dateField && <ViewTab on={view === 'calendar'} onClick={() => pickView('calendar')} icon={<CalendarDays size={14} />}>Calendar</ViewTab>}
        </div>
        <div className="relative w-full sm:w-72">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search records" className="h-8 w-full rounded-btn border border-line bg-card pl-8 pr-2 text-body-sm text-ink focus:border-primary focus:outline-none" />
        </div>
        <span className="text-body-sm text-ink-muted">{records ? `${shown.length} of ${records.length}` : ''}</span>
        <button type="button" onClick={downloadCsv} disabled={!shown.length} className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-btn border border-line bg-card px-2.5 text-body-sm text-ink hover:bg-slate-50 disabled:opacity-50"><Download size={14} /> CSV</button>
      </div>

      {!records ? <p className="py-10 text-center text-body-md text-ink-muted">Loading…</p>
        : view === 'board' && boardField ? <Board block={block} field={boardField} records={shown} people={people} onOpen={setEditing} onMove={moveTo} />
          : view === 'calendar' && dateField ? <Calendar block={block} field={dateField} records={shown} onOpen={setEditing} />
            : <TableView block={block} records={shown} people={people} onOpen={setEditing} empty={records.length === 0 ? (canAdd ? 'Nothing here yet. Press Add to start.' : 'Nothing here yet.') : 'Nothing matches.'} />}

      {editing && <RecordModal block={block} people={people} record={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
    </div>
  )
}

function ViewTab({ on, onClick, icon, children }: { on: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return <button type="button" role="tab" aria-selected={on} onClick={onClick} className={cn('inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-body-sm font-semibold', on ? 'bg-slate-100 text-ink dark:bg-slate-700' : 'text-ink-muted hover:text-ink')}>{icon}{children}</button>
}

/** The text a record is known by: its first short text field. */
const titleOf = (block: CustomBlock, r: CustomRecord) => {
  const f = block.fields.find((x) => x.type === 'text') ?? block.fields[0]
  const v = f ? r.data[f.key] : null
  return v == null || v === '' ? 'Untitled' : String(v)
}

function TableView({ block, records, people, onOpen, empty }: { block: CustomBlock; records: CustomRecord[]; people: People; onOpen: (r: CustomRecord) => void; empty: string }) {
  const [sort, setSort] = useState<{ key: string; up: boolean }>({ key: '_added', up: false })
  const sorted = useMemo(() => {
    const f = block.fields.find((x) => x.key === sort.key)
    const val = (r: CustomRecord) => (f ? (f.type === 'number' ? Number(r.data[f.key] ?? -Infinity) : valueText(f, r.data[f.key], people).toLowerCase()) : r.createdAt)
    return [...records].sort((a, b) => { const x = val(a), y = val(b); const c = x < y ? -1 : x > y ? 1 : 0; return sort.up ? c : -c })
  }, [records, sort, block, people])
  const th = (key: string, label: string) => (
    <th key={key} className="whitespace-nowrap px-3 py-2 text-left text-label-md uppercase text-ink-muted">
      <button type="button" onClick={() => setSort((s) => ({ key, up: s.key === key ? !s.up : true }))} className="inline-flex items-center gap-1 hover:text-ink">{label}{sort.key === key && (sort.up ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}</button>
    </th>
  )
  if (records.length === 0) return <div className="rounded-card border border-line bg-card py-14 text-center text-body-md text-ink-muted">{empty}</div>
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-card shadow-sm">
      <table className="w-full min-w-[640px] text-body-sm">
        <thead className="sticky top-0 border-b border-line bg-slate-50 dark:bg-slate-800/60"><tr>{block.fields.map((f) => th(f.key, f.label))}{th('_by', 'Added by')}{th('_added', 'Added')}</tr></thead>
        <tbody className="divide-y divide-line">
          {sorted.map((r) => (
            <tr key={r.id} onClick={() => onOpen(r)} className="cursor-pointer hover:bg-primary/5" data-record={r.id}>
              {block.fields.map((f) => <td key={f.key} className="max-w-[280px] px-3 py-2 align-top text-ink"><FieldValue f={f} v={r.data[f.key]} people={people} color={block.color} /></td>)}
              <td className="whitespace-nowrap px-3 py-2 text-ink-muted">{r.createdBy?.name ?? '—'}{r.department && <span className="text-ink-faint"> · {r.department}</span>}</td>
              <td className="whitespace-nowrap px-3 py-2 text-ink-muted">{fmtAgo(r.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Board({ block, field, records, people, onOpen, onMove }: { block: CustomBlock; field: CustomField; records: CustomRecord[]; people: People; onOpen: (r: CustomRecord) => void; onMove: (r: CustomRecord, field: string, v: string | null) => void }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const cols = [...(field.options ?? []), '']
  function onEnd(e: DragEndEvent) {
    const r = records.find((x) => x.id === e.active.id)
    if (!r || !e.over) return
    const to = String(e.over.id).slice(4)
    if ((r.data[field.key] ?? '') !== to) onMove(r, field.key, to || null)
  }
  const others = block.fields.filter((f) => f.key !== field.key).slice(0, 3)
  return (
    <DndContext sensors={sensors} onDragEnd={onEnd}>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {cols.map((c) => {
          const rows = records.filter((r) => (r.data[field.key] ?? '') === c)
          if (!c && rows.length === 0) return null
          return (
            <BoardColumn key={c || '_none'} id={`col:${c}`} title={c || `No ${field.label.toLowerCase()}`} count={rows.length} color={block.color}>
              {rows.map((r) => (
                <BoardCard key={r.id} r={r} disabled={!r.canChange} onOpen={() => onOpen(r)}>
                  <p className="text-body-sm font-semibold text-ink">{titleOf(block, r)}</p>
                  {others.filter((f) => f.type !== 'text' || titleOf(block, r) !== String(r.data[f.key] ?? '')).map((f) => r.data[f.key] != null && r.data[f.key] !== '' && (
                    <p key={f.key} className="mt-0.5 truncate text-[12px] text-ink-muted"><span className="text-ink-faint">{f.label}: </span><FieldValue f={f} v={r.data[f.key]} people={people} color={block.color} /></p>
                  ))}
                  <p className="mt-1 text-[11px] text-ink-faint">{r.createdBy?.name ?? ''} · {fmtAgo(r.createdAt)}</p>
                </BoardCard>
              ))}
            </BoardColumn>
          )
        })}
      </div>
    </DndContext>
  )
}
function BoardColumn({ id, title, count, color, children }: { id: string; title: string; count: number; color: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div ref={setNodeRef} className={cn('flex w-72 shrink-0 flex-col rounded-card border bg-slate-50/80 p-2.5 dark:bg-slate-900/40', isOver ? 'border-primary/50 bg-primary/5' : 'border-line')}>
      <div className="mb-2 flex items-center gap-2 px-1"><span className="h-2 w-2 rounded-full" style={{ background: color }} /><span className="text-label-md uppercase text-ink">{title}</span><span className="rounded-full bg-slate-200/70 px-1.5 text-[11px] font-bold text-ink-muted">{count}</span></div>
      <div className="min-h-[120px] space-y-2">{children}</div>
    </div>
  )
}
function BoardCard({ r, disabled, onOpen, children }: { r: CustomRecord; disabled: boolean; onOpen: () => void; children: React.ReactNode }) {
  const { setNodeRef, listeners, attributes, transform, isDragging } = useDraggable({ id: r.id, disabled })
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} onClick={onOpen} style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={cn('rounded-btn border border-line bg-card p-2.5 shadow-sm', !disabled && 'cursor-grab active:cursor-grabbing', isDragging && 'z-10 opacity-80 shadow-lg')} data-record={r.id}>
      {children}
    </div>
  )
}

function Calendar({ block, field, records, onOpen }: { block: CustomBlock; field: CustomField; records: CustomRecord[]; onOpen: (r: CustomRecord) => void }) {
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const pad = (n: number) => String(n).padStart(2, '0')
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const lead = (month.getDay() + 6) % 7
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const today = iso(new Date())
  const undated = records.filter((r) => !r.data[field.key]).length
  return (
    <div className="rounded-card border border-line bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded-btn p-1.5 text-ink-muted hover:bg-slate-100" aria-label="Previous month"><ChevronLeft size={17} /></button>
        <span className="min-w-[160px] text-center text-body-lg font-semibold text-ink">{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
        <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded-btn p-1.5 text-ink-muted hover:bg-slate-100" aria-label="Next month"><ChevronRight size={17} /></button>
        <span className="ml-auto text-body-sm text-ink-muted">By {field.label.toLowerCase()}{undated ? ` · ${undated} without a date` : ''}</span>
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d} className="text-center text-[11px] font-semibold uppercase text-ink-muted">{d}</span>)}
        {Array.from({ length: lead }, (_, i) => <span key={`x${i}`} />)}
        {Array.from({ length: days }, (_, i) => {
          const d = iso(new Date(month.getFullYear(), month.getMonth(), i + 1))
          const here = records.filter((r) => r.data[field.key] === d)
          return (
            <div key={d} className={cn('min-h-[92px] rounded-btn border p-1.5', d === today ? 'border-primary/50 bg-primary/5' : 'border-line')}>
              <span className="text-body-sm font-semibold text-ink">{i + 1}</span>
              <div className="mt-1 space-y-1">
                {here.slice(0, 3).map((r) => <button key={r.id} type="button" onClick={() => onOpen(r)} className="block w-full truncate rounded px-1.5 py-0.5 text-left text-[11.5px] font-medium" style={{ background: `${block.color}1a`, color: block.color }}>{titleOf(block, r)}</button>)}
                {here.length > 3 && <span className="block text-[11px] text-ink-muted">+{here.length - 3} more</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RecordModal({ block, people, record, onClose, onSaved }: { block: CustomBlock; people: People; record: CustomRecord | null; onClose: () => void; onSaved: () => void }) {
  const { addToast } = useToast()
  const [data, setData] = useState<Record<string, unknown>>(() => ({ ...(record?.data ?? {}) }))
  const [busy, setBusy] = useState(false)
  const readOnly = !!record && !record.canChange
  async function save() {
    setBusy(true)
    try {
      if (record) await customApi.change(block.id, record.id, data)
      else await customApi.add(block.id, data)
      onSaved()
    } catch (e) { addToast({ type: 'error', message: apiErrorText(e, 'Could not save.') }) } finally { setBusy(false) }
  }
  async function remove() {
    if (!record || !window.confirm('Delete this record?')) return
    setBusy(true)
    try { await customApi.drop(block.id, record.id); onSaved() } catch (e) { addToast({ type: 'error', message: apiErrorText(e, 'Could not delete.') }) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={record ? (readOnly ? titleOf(block, record) : `Change ${block.name.toLowerCase()}`) : `Add to ${block.name}`}
      footer={readOnly ? <Button variant="secondary" onClick={onClose}>Close</Button> : <>
        {record && <Button variant="ghost" className="mr-auto text-danger" leadingIcon={<Trash2 size={15} />} disabled={busy} onClick={remove}>Delete</Button>}
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button disabled={busy} onClick={save}>{record ? 'Save' : 'Add'}</Button>
      </>}>
      <form onSubmit={(e) => { e.preventDefault(); if (!readOnly) void save() }} className="grid gap-3 sm:grid-cols-2">
        {block.fields.map((f) => (
          <div key={f.key} className={f.type === 'longtext' || f.type === 'text' ? 'sm:col-span-2' : ''}>
            <FieldInput f={f} value={data[f.key]} onChange={(v) => setData((d) => ({ ...d, [f.key]: v }))} people={people} disabled={readOnly} />
          </div>
        ))}
        {record && <p className="text-body-sm text-ink-muted sm:col-span-2">Added by {record.createdBy?.name ?? 'someone'}{record.department ? ` (${record.department})` : ''}, {fmtAgo(record.createdAt)}.</p>}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  )
}
