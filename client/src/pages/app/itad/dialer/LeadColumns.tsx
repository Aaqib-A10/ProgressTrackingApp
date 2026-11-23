import { crmName } from '../../../../lib/departments'
import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDown, ArrowUp, ArrowUpDown, GripVertical, Pin, X } from 'lucide-react'
import { Modal } from '../../../../components/ui/Modal'
import { Button } from '../../../../components/ui/Button'
import { cn } from '../../../../lib/cn'
import type { DialerLead } from '../../../../lib/dialerApi'
import { daysQuiet, daysSince, lastTouched, leadRegion, leadState, shortDate } from '../../../../lib/dialer'
import { RegionBadge, StatusPill } from './ui'

/**
 * The all-leads table with the columns each agent picks (ITAD spec, 30 Oct 2026, section 8):
 * a "Columns" button chooses the fields and drags them into order; saved per agent.
 */

/** `sort` gives the value a column sorts by (text, a number, or a time); empty values always go last. */
type SortValue = string | number | null | undefined
type Col = { key: string; label: string; cell: (l: DialerLead, now: Date) => ReactNode; sort: (l: DialerLead, now: Date) => SortValue; className?: string }
const fmtDay = (iso: string | null) => (iso ? shortDate(iso) : '—')
const time = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : null)
/** "51-200" or "1,000+" → its first number, so company sizes sort by size, not as text. */
const firstNumber = (s: string | null) => { const m = s?.replace(/,/g, '').match(/\d+/); return m ? Number(m[0]) : null }

export const LEAD_COLUMNS: Col[] = [
  { key: 'company', label: 'Company', sort: (l) => l.company, cell: (l) => <span className="flex items-center gap-1 font-semibold text-ink">{l.company}{l.pinnedNote && <Pin size={11} className="shrink-0 text-ink-muted" />}{l.needsCrmUpdate && <span className="rounded bg-warning/10 px-1 text-[10px] font-bold text-warning-ink" title={`Update ${crmName('Earthzone')}: ${l.crmUpdateWhat ?? ''}`}>EZ</span>}</span> },
  { key: 'contact', label: 'Contact', sort: (l) => l.contactName, cell: (l) => l.contactName ?? '—' },
  { key: 'phone', label: 'Phone', sort: (l) => l.phone?.replace(/\D/g, ''), cell: (l) => <span className="whitespace-nowrap tabular-nums">{l.phone ?? '—'}</span> },
  { key: 'title', label: 'Title', sort: (l) => l.jobTitle, cell: (l) => l.jobTitle ?? '—' },
  { key: 'state', label: 'State', sort: (l) => [leadState(l), l.city].filter(Boolean).join(' '), cell: (l) => [l.city, leadState(l)].filter(Boolean).join(', ') || '—' },
  { key: 'region', label: 'Region', sort: (l, now) => leadRegion(l, now), cell: (l, now) => <RegionBadge lead={l} now={now} /> },
  { key: 'industry', label: 'Industry', sort: (l) => l.industry, cell: (l) => l.industry ?? '—' },
  { key: 'employees', label: 'Employees', sort: (l) => firstNumber(l.companySize), cell: (l) => l.companySize ?? '—' },
  { key: 'source', label: 'Source', sort: (l) => l.source, cell: (l) => l.source ?? '—' },
  { key: 'status', label: 'Status', sort: (l) => l.status, cell: (l) => <StatusPill lead={l} /> },
  { key: 'assignedTo', label: 'Assigned to', sort: (l) => l.assignedTo ?? l.ownerName, cell: (l) => l.assignedTo ?? l.ownerName ?? '—' },
  { key: 'created', label: 'Created', sort: (l) => time(l.leadDate), cell: (l) => <span className="whitespace-nowrap">{fmtDay(l.leadDate)}</span> },
  { key: 'updated', label: 'Updated', sort: (l) => time(l.lastActivityAt), cell: (l, now) => <span className="whitespace-nowrap">{l.lastActivityAt ? `${shortDate(l.lastActivityAt)} · ${daysSince(l.lastActivityAt, now)}d` : '—'}</span> },
  { key: 'lastTouched', label: 'Last touched', sort: (l) => time(lastTouched(l)), cell: (l, now) => <span className="whitespace-nowrap">{`${daysSince(lastTouched(l), now)}d ago`}</span> },
  { key: 'tries', label: 'Tries', sort: (l) => l.tries ?? null, cell: (l) => (l.tries ? `${l.tries}, same status` : '') },
  { key: 'daysQuiet', label: 'Days quiet', sort: (l, now) => daysQuiet(l, now), cell: (l, now) => <span className="tabular-nums">{daysQuiet(l, now)}</span> },
]

/** The table's sort: a column and a direction, written "updated:desc" (kept in the address bar). */
export type LeadSort = { key: string; dir: 'asc' | 'desc' } | null
export const parseSort = (s: string | null): LeadSort => {
  const [key, dir] = (s ?? '').split(':')
  return key && LEAD_COLUMNS.some((c) => c.key === key) ? { key, dir: dir === 'desc' ? 'desc' : 'asc' } : null
}
/** The whole list in the chosen order (every page, not just the shown one). Empty values go last either way; ties keep their order. */
export function sortLeads(leads: DialerLead[], sort: LeadSort, now: Date): DialerLead[] {
  const col = sort && LEAD_COLUMNS.find((c) => c.key === sort.key)
  if (!sort || !col) return leads
  const sign = sort.dir === 'desc' ? -1 : 1
  const keyed = leads.map((l, i) => ({ l, i, v: col.sort(l, now) }))
  const empty = (v: SortValue) => v == null || v === ''
  keyed.sort((a, b) => {
    if (empty(a.v) || empty(b.v)) return empty(a.v) === empty(b.v) ? a.i - b.i : empty(a.v) ? 1 : -1
    const c = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : String(a.v).localeCompare(String(b.v), undefined, { numeric: true, sensitivity: 'base' })
    return c ? c * sign : a.i - b.i
  })
  return keyed.map((x) => x.l)
}

// Column widths a person dragged, per browser (a convenience, like the sidebar state). Missing = automatic.
const WIDTHS_KEY = 'pt-dialer-col-widths'
const MIN_W = 60
function readWidths(): Record<string, number> {
  try { const v = JSON.parse(localStorage.getItem(WIDTHS_KEY) ?? '{}'); return v && typeof v === 'object' ? v : {} } catch { return {} }
}
function saveWidths(w: Record<string, number>) {
  try { if (Object.keys(w).length) localStorage.setItem(WIDTHS_KEY, JSON.stringify(w)); else localStorage.removeItem(WIDTHS_KEY) } catch { /* fine: widths just are not remembered */ }
}
export const DEFAULT_COLUMNS = ['company', 'contact', 'phone', 'state', 'region', 'status', 'updated']

/**
 * The leads table. Click a column name to sort by it (A→Z, then Z→A, then back to the list's own order); drag the
 * thin line on a header's right edge to make the column wider or narrower (double-click it: automatic widths again).
 */
export function LeadsTable({ leads, now, columns, showOwner, onOpen, picked, onPick, canPick, sort, onSort }: {
  leads: DialerLead[]; now: Date; columns: string[]; showOwner: boolean; onOpen: (id: string) => void
  picked: Set<string>; onPick: (ids: string[], on: boolean) => void; canPick: (l: DialerLead) => boolean
  sort?: LeadSort; onSort?: (s: LeadSort) => void
}) {
  const cols = (columns.length ? columns : DEFAULT_COLUMNS).map((k) => LEAD_COLUMNS.find((c) => c.key === k)).filter((c): c is Col => !!c)
  const pickable = leads.filter(canPick).map((l) => l.id)
  const all = pickable.length > 0 && pickable.every((id) => picked.has(id))
  const [widths, setWidths] = useState<Record<string, number>>(readWidths)
  const heads = useRef<Record<string, HTMLTableCellElement | null>>({})
  // Once any column has a width, the table uses fixed widths: every shown column then needs one, measured as it is now.
  const sized = cols.some((c) => widths[c.key])

  function startResize(key: string, e: ReactPointerEvent) {
    e.preventDefault(); e.stopPropagation()
    const base: Record<string, number> = { ...widths }
    for (const c of cols) if (!base[c.key]) base[c.key] = Math.round(heads.current[c.key]?.offsetWidth ?? 140)
    const startX = e.clientX, startW = base[key]
    let latest = base
    const move = (ev: PointerEvent) => { latest = { ...base, [key]: Math.max(MIN_W, Math.round(startW + ev.clientX - startX)) }; setWidths(latest) }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.style.cursor = ''; saveWidths(latest) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    document.body.style.cursor = 'col-resize'
    setWidths(base)
  }
  // Back to automatic widths. A fixed-width table needs a width for every column, so they all go back together.
  function resetWidths() { setWidths({}); saveWidths({}) }
  const nextSort = (key: string): LeadSort => (sort?.key !== key ? { key, dir: 'asc' } : sort.dir === 'asc' ? { key, dir: 'desc' } : null)
  const tableWidth = sized ? 32 + cols.reduce((t, c) => t + (widths[c.key] ?? 140), 0) + (showOwner ? 140 : 0) : undefined

  return (
    <div className="-mx-1 overflow-x-auto">
      <table className={cn('text-left text-body-sm', sized ? 'table-fixed' : 'w-full min-w-[760px]')} style={tableWidth ? { width: tableWidth, minWidth: '100%' } : undefined}>
        {sized && (
          <colgroup>
            <col style={{ width: 32 }} />
            {cols.map((c) => <col key={c.key} style={{ width: widths[c.key] ?? 140 }} />)}
            {showOwner && <col style={{ width: 140 }} />}
          </colgroup>
        )}
        <thead className="sticky top-0 bg-card text-[11px] uppercase text-ink-muted">
          <tr>
            <th className="w-8 px-2 py-2"><input type="checkbox" checked={all} onChange={(e) => onPick(pickable, e.target.checked)} className="h-4 w-4 accent-primary" aria-label="Pick the shown rows" /></th>
            {cols.map((c) => {
              const on = sort?.key === c.key
              const Arrow = !on ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
              return (
                <th key={c.key} ref={(el) => { heads.current[c.key] = el }} aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className="relative px-2 py-2">
                  {onSort ? (
                    <button type="button" onClick={() => onSort(nextSort(c.key))}
                      title={on ? (sort.dir === 'asc' ? `Sorted A→Z / oldest first. Click for Z→A / newest first` : 'Sorted Z→A / newest first. Click to stop sorting') : `Sort by ${c.label}`}
                      className={cn('group inline-flex max-w-full items-center gap-1 rounded uppercase hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40', on && 'text-primary-ink')}>
                      <span className="truncate">{c.label}</span>
                      <Arrow size={12} className={cn('shrink-0', on ? 'opacity-100' : 'opacity-40 group-hover:opacity-100')} />
                    </button>
                  ) : c.label}
                  <span role="separator" aria-orientation="vertical" aria-label={`Resize ${c.label}`} title="Drag to resize. Double-click: all columns back to automatic width"
                    onPointerDown={(e) => startResize(c.key, e)} onDoubleClick={resetWidths} onClick={(e) => e.stopPropagation()}
                    className="absolute right-0 top-1/2 h-5 w-2 -translate-y-1/2 cursor-col-resize touch-none border-r-2 border-line hover:border-primary" />
                </th>
              )
            })}
            {showOwner && <th className="px-2">Rep</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {leads.map((l) => (
            <tr key={l.id} onClick={() => onOpen(l.id)} className={cn('cursor-pointer hover:bg-slate-50', picked.has(l.id) && 'bg-primary/[0.04]')} title={l.pinnedNote ? `Pinned note: ${l.pinnedNote}` : undefined}>
              <td className="px-2" onClick={(e) => e.stopPropagation()}><input type="checkbox" disabled={!canPick(l)} checked={picked.has(l.id)} onChange={(e) => onPick([l.id], e.target.checked)} className="h-4 w-4 accent-primary" aria-label={`Pick ${l.company}`} /></td>
              {cols.map((c) => <td key={c.key} className={cn('truncate px-2 py-2 text-ink', !sized && 'max-w-[240px]')}>{c.cell(l, now)}</td>)}
              {showOwner && <td className="truncate px-2 text-ink-muted">{l.ownerName}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SortRow({ id, label, onRemove }: { id: string; label: string; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn('flex items-center gap-2 rounded-btn border border-line bg-card px-2 py-1.5 text-body-sm', isDragging && 'z-10 shadow-overlay')}>
      <button type="button" {...attributes} {...listeners} className="cursor-grab text-ink-faint active:cursor-grabbing" aria-label={`Move ${label}`}><GripVertical size={15} /></button>
      <span className="flex-1 font-medium text-ink">{label}</span>
      <button type="button" onClick={onRemove} className="rounded p-0.5 text-ink-faint hover:text-danger-ink" aria-label={`Hide ${label}`}><X size={14} /></button>
    </li>
  )
}

/** Pick the columns and drag them into order (All leads by default; Follow-ups passes its own list). */
export function ColumnPicker({ columns, onClose, onSave, options = LEAD_COLUMNS, defaults = DEFAULT_COLUMNS, note }: { columns: string[]; onClose: () => void; onSave: (cols: string[]) => void; options?: { key: string; label: string }[]; defaults?: string[]; note?: string }) {
  const [list, setList] = useState<string[]>((columns.length ? columns : defaults).filter((k) => options.some((c) => c.key === k)))
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const end = (e: DragEndEvent) => { if (e.over && e.active.id !== e.over.id) setList((l) => arrayMove(l, l.indexOf(String(e.active.id)), l.indexOf(String(e.over!.id)))) }
  const label = (k: string) => options.find((c) => c.key === k)?.label ?? k
  const off = options.filter((c) => !list.includes(c.key))
  return (
    <Modal open onClose={onClose} title="Columns" size="sm" footer={<><Button variant="secondary" onClick={() => setList(defaults)}>Standard set</Button><Button disabled={!list.length} onClick={() => onSave(list)}>Save</Button></>}>
      <p className="mb-2 text-body-sm text-ink-muted">Drag to change the order. Saved for you only.{note ? ` ${note}` : ''}</p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={end}>
        <SortableContext items={list} strategy={verticalListSortingStrategy}>
          <ul className="space-y-1.5">{list.map((k) => <SortRow key={k} id={k} label={label(k)} onRemove={() => setList((l) => l.filter((x) => x !== k))} />)}</ul>
        </SortableContext>
      </DndContext>
      {off.length > 0 && (
        <>
          <p className="mb-1.5 mt-4 text-[11px] font-semibold uppercase text-ink-muted">Add a column</p>
          <div className="flex flex-wrap gap-1.5">{off.map((c) => <button key={c.key} type="button" onClick={() => setList((l) => [...l, c.key])} className="rounded-full border border-dashed border-line px-2.5 py-1 text-body-sm text-ink hover:border-primary hover:text-primary-ink">+ {c.label}</button>)}</div>
        </>
      )}
    </Modal>
  )
}
