import { useState, type ReactNode } from 'react'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Pin, X } from 'lucide-react'
import { Modal } from '../../../../components/ui/Modal'
import { Button } from '../../../../components/ui/Button'
import { cn } from '../../../../lib/cn'
import type { DialerLead } from '../../../../lib/dialerApi'
import { daysQuiet, daysSince, lastTouched, leadState, shortDate } from '../../../../lib/dialer'
import { RegionBadge, StatusPill } from './ui'

/**
 * The all-leads table with the columns each agent picks (ITAD spec, 30 Oct 2026, section 8):
 * a "Columns" button chooses the fields and drags them into order; saved per agent.
 */

type Col = { key: string; label: string; cell: (l: DialerLead, now: Date) => ReactNode; className?: string }
const fmtDay = (iso: string | null) => (iso ? shortDate(iso) : '—')

export const LEAD_COLUMNS: Col[] = [
  { key: 'company', label: 'Company', cell: (l) => <span className="flex items-center gap-1 font-semibold text-ink">{l.company}{l.pinnedNote && <Pin size={11} className="shrink-0 text-ink-muted" />}{l.needsCrmUpdate && <span className="rounded bg-warning/10 px-1 text-[10px] font-bold text-warning" title={`Update Earthzone: ${l.crmUpdateWhat ?? ''}`}>EZ</span>}</span> },
  { key: 'contact', label: 'Contact', cell: (l) => l.contactName ?? '—' },
  { key: 'phone', label: 'Phone', cell: (l) => <span className="whitespace-nowrap tabular-nums">{l.phone ?? '—'}</span> },
  { key: 'title', label: 'Title', cell: (l) => l.jobTitle ?? '—' },
  { key: 'state', label: 'State', cell: (l) => [l.city, leadState(l)].filter(Boolean).join(', ') || '—' },
  { key: 'region', label: 'Region', cell: (l, now) => <RegionBadge lead={l} now={now} /> },
  { key: 'industry', label: 'Industry', cell: (l) => l.industry ?? '—' },
  { key: 'employees', label: 'Employees', cell: (l) => l.companySize ?? '—' },
  { key: 'source', label: 'Source', cell: (l) => l.source ?? '—' },
  { key: 'status', label: 'Status', cell: (l) => <StatusPill lead={l} /> },
  { key: 'assignedTo', label: 'Assigned to', cell: (l) => l.assignedTo ?? l.ownerName ?? '—' },
  { key: 'created', label: 'Created', cell: (l) => <span className="whitespace-nowrap">{fmtDay(l.leadDate)}</span> },
  { key: 'updated', label: 'Updated', cell: (l, now) => <span className="whitespace-nowrap">{l.lastActivityAt ? `${shortDate(l.lastActivityAt)} · ${daysSince(l.lastActivityAt, now)}d` : '—'}</span> },
  { key: 'lastTouched', label: 'Last touched', cell: (l, now) => <span className="whitespace-nowrap">{`${daysSince(lastTouched(l), now)}d ago`}</span> },
  { key: 'tries', label: 'Tries', cell: (l) => (l.tries ? `${l.tries}, same status` : '') },
  { key: 'daysQuiet', label: 'Days quiet', cell: (l, now) => <span className="tabular-nums">{daysQuiet(l, now)}</span> },
]
export const DEFAULT_COLUMNS = ['company', 'contact', 'phone', 'state', 'region', 'status', 'updated']

export function LeadsTable({ leads, now, columns, showOwner, onOpen, picked, onPick, canPick }: {
  leads: DialerLead[]; now: Date; columns: string[]; showOwner: boolean; onOpen: (id: string) => void
  picked: Set<string>; onPick: (ids: string[], on: boolean) => void; canPick: (l: DialerLead) => boolean
}) {
  const cols = (columns.length ? columns : DEFAULT_COLUMNS).map((k) => LEAD_COLUMNS.find((c) => c.key === k)).filter((c): c is Col => !!c)
  const pickable = leads.filter(canPick).map((l) => l.id)
  const all = pickable.length > 0 && pickable.every((id) => picked.has(id))
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-body-sm">
        <thead className="sticky top-0 bg-card text-[11px] uppercase text-ink-muted">
          <tr>
            <th className="w-8 px-2 py-2"><input type="checkbox" checked={all} onChange={(e) => onPick(pickable, e.target.checked)} className="h-4 w-4 accent-primary" aria-label="Pick the shown rows" /></th>
            {cols.map((c) => <th key={c.key} className="px-2 py-2">{c.label}</th>)}
            {showOwner && <th className="px-2">Rep</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {leads.map((l) => (
            <tr key={l.id} onClick={() => onOpen(l.id)} className={cn('cursor-pointer hover:bg-slate-50', picked.has(l.id) && 'bg-primary/[0.04]')} title={l.pinnedNote ? `Pinned note: ${l.pinnedNote}` : undefined}>
              <td className="px-2" onClick={(e) => e.stopPropagation()}><input type="checkbox" disabled={!canPick(l)} checked={picked.has(l.id)} onChange={(e) => onPick([l.id], e.target.checked)} className="h-4 w-4 accent-primary" aria-label={`Pick ${l.company}`} /></td>
              {cols.map((c) => <td key={c.key} className="max-w-[240px] truncate px-2 py-2 text-ink">{c.cell(l, now)}</td>)}
              {showOwner && <td className="px-2 text-ink-muted">{l.ownerName}</td>}
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
      <button type="button" onClick={onRemove} className="rounded p-0.5 text-ink-faint hover:text-danger" aria-label={`Hide ${label}`}><X size={14} /></button>
    </li>
  )
}

/** Pick the columns and drag them into order. */
export function ColumnPicker({ columns, onClose, onSave }: { columns: string[]; onClose: () => void; onSave: (cols: string[]) => void }) {
  const [list, setList] = useState<string[]>(columns.length ? columns : DEFAULT_COLUMNS)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const end = (e: DragEndEvent) => { if (e.over && e.active.id !== e.over.id) setList((l) => arrayMove(l, l.indexOf(String(e.active.id)), l.indexOf(String(e.over!.id)))) }
  const label = (k: string) => LEAD_COLUMNS.find((c) => c.key === k)?.label ?? k
  const off = LEAD_COLUMNS.filter((c) => !list.includes(c.key))
  return (
    <Modal open onClose={onClose} title="Columns" size="sm" footer={<><Button variant="secondary" onClick={() => setList(DEFAULT_COLUMNS)}>Standard set</Button><Button disabled={!list.length} onClick={() => onSave(list)}>Save</Button></>}>
      <p className="mb-2 text-body-sm text-ink-muted">Drag to change the order. Saved for you only.</p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={end}>
        <SortableContext items={list} strategy={verticalListSortingStrategy}>
          <ul className="space-y-1.5">{list.map((k) => <SortRow key={k} id={k} label={label(k)} onRemove={() => setList((l) => l.filter((x) => x !== k))} />)}</ul>
        </SortableContext>
      </DndContext>
      {off.length > 0 && (
        <>
          <p className="mb-1.5 mt-4 text-[11px] font-semibold uppercase text-ink-muted">Add a column</p>
          <div className="flex flex-wrap gap-1.5">{off.map((c) => <button key={c.key} type="button" onClick={() => setList((l) => [...l, c.key])} className="rounded-full border border-dashed border-line px-2.5 py-1 text-body-sm text-ink hover:border-primary hover:text-primary">+ {c.label}</button>)}</div>
        </>
      )}
    </Modal>
  )
}
