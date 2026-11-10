import { useState } from 'react'
import { DndContext, DragOverlay, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { cn } from '../../../lib/cn'
import { usePhone } from '../../../mobile/usePhone'
import type { WorkEntry, WorkStatus } from '../../../lib/workLogApi'
import { Chips, DoneCheck, EntryText, RowActions, type EntryActions } from './parts'
import { NoteList } from './notes'

/**
 * Board view of My To-Do: To do, In progress and Done columns. Drag a card to another column
 * to change its status (a short drag threshold keeps the buttons on the card clickable).
 */

const COLUMNS: { status: WorkStatus; label: string; dot: string; empty: string }[] = [
  { status: 'PLANNED', label: 'To do', dot: 'bg-slate-400', empty: 'Nothing waiting.' },
  { status: 'IN_PROGRESS', label: 'In progress', dot: 'bg-warning', empty: 'Drag a card here when you start it.' },
  { status: 'DONE', label: 'Done', dot: 'bg-success', empty: 'Drag finished work here.' },
]

export function TodoBoard({ entries, readOnly, actions, flash }: { entries: WorkEntry[]; readOnly: boolean; actions: EntryActions; flash?: string | null }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }))
  const [dragging, setDragging] = useState<WorkEntry | null>(null)
  // Phones: one column at a time, and "Move to" on each card instead of dragging.
  const phone = usePhone()
  const [phoneCol, setPhoneCol] = useState<WorkStatus>('PLANNED')
  if (phone) {
    const col = COLUMNS.find((c) => c.status === phoneCol) ?? COLUMNS[0]
    const rows = entries.filter((e) => e.status === col.status).sort((a, b) => Number(b.blocked) - Number(a.blocked))
    return (
      <div className="space-y-3">
        <div role="tablist" aria-label="Columns" className="pt-tabs flex flex-wrap gap-1.5">
          {COLUMNS.map((c) => (
            <button key={c.status} type="button" role="tab" aria-selected={c.status === col.status} onClick={() => setPhoneCol(c.status)} className={cn('inline-flex h-9 items-center justify-center gap-1.5 rounded-full border px-3 text-body-sm font-semibold', c.status === col.status ? 'border-ink bg-ink text-card' : 'border-line bg-card text-ink-muted')}>
              <span className={cn('h-2 w-2 shrink-0 rounded-full', c.dot)} />{c.label}<span className="tabular-nums opacity-70">{entries.filter((e) => e.status === c.status).length}</span>
            </button>
          ))}
        </div>
        <div className="space-y-2">
          {rows.map((e) => (
            <div key={e.id} data-entry-id={e.id} className={cn('rounded-btn transition-shadow duration-700', flash === e.id && 'ring-2 ring-primary/50')}>
              <CardBody e={e} readOnly={readOnly} actions={actions} />
              {!readOnly && (
                <label className="-mt-1 flex items-center gap-2 rounded-b-btn border border-t-0 border-line bg-card px-3 pb-2 pt-3 text-body-sm text-ink-muted">Move to
                  <select value={e.status} onChange={(ev) => actions.onStatus(e, ev.target.value as WorkStatus)} className="h-9 min-w-0 flex-1 rounded-btn border border-line bg-card px-2 text-body-sm text-ink" aria-label="Move to">
                    {COLUMNS.map((c) => <option key={c.status} value={c.status}>{c.label}</option>)}
                  </select>
                </label>
              )}
            </div>
          ))}
          {rows.length === 0 && <p className="rounded-btn border border-dashed border-line px-3 py-8 text-center text-body-sm text-ink-muted">{col.status === 'PLANNED' ? 'Nothing waiting.' : col.status === 'IN_PROGRESS' ? 'Nothing in progress.' : 'Nothing done yet.'}</p>}
        </div>
      </div>
    )
  }

  function onStart(ev: DragStartEvent) { setDragging(entries.find((e) => e.id === ev.active.id) ?? null) }
  function onEnd(ev: DragEndEvent) {
    setDragging(null)
    const e = entries.find((x) => x.id === ev.active.id)
    const to = ev.over?.id as WorkStatus | undefined
    if (e && to && to !== e.status) actions.onStatus(e, to)
  }

  return (
    <DndContext sensors={sensors} onDragStart={onStart} onDragEnd={onEnd} onDragCancel={() => setDragging(null)}>
      <div className="grid gap-3 md:grid-cols-3">
        {COLUMNS.map((c) => {
          const rows = entries.filter((e) => e.status === c.status).sort((a, b) => Number(b.blocked) - Number(a.blocked))
          return (
            <Column key={c.status} id={c.status} disabled={readOnly}>
              <div className="mb-2 flex items-center gap-2 px-1">
                <span className={cn('h-2 w-2 rounded-full', c.dot)} />
                <span className="text-label-md uppercase text-ink">{c.label}</span>
                <span className="rounded-full bg-slate-200/70 px-1.5 text-[11px] font-bold text-ink-muted">{rows.length}</span>
              </div>
              <div className="space-y-2">
                {rows.map((e) => <Card key={e.id} e={e} readOnly={readOnly} actions={actions} hidden={dragging?.id === e.id} flash={flash === e.id} />)}
                {rows.length === 0 && <p className="rounded-btn border border-dashed border-line px-3 py-6 text-center text-body-sm text-ink-muted">{c.empty}</p>}
              </div>
            </Column>
          )
        })}
      </div>
      <DragOverlay>{dragging && <CardBody e={dragging} readOnly actions={actions} lifted />}</DragOverlay>
    </DndContext>
  )
}

function Column({ id, disabled, children }: { id: string; disabled: boolean; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled })
  return <div ref={setNodeRef} className={cn('min-h-[180px] rounded-card border bg-slate-50/80 p-2.5 transition-colors', isOver ? 'border-primary/50 bg-primary/5' : 'border-line')}>{children}</div>
}

function Card({ e, readOnly, actions, hidden, flash }: { e: WorkEntry; readOnly: boolean; actions: EntryActions; hidden: boolean; flash?: boolean }) {
  const { setNodeRef, listeners, attributes } = useDraggable({ id: e.id, disabled: readOnly })
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} data-entry-id={e.id} className={cn('touch-manipulation rounded-btn outline-none transition-shadow duration-700', !readOnly && 'cursor-grab active:cursor-grabbing', hidden && 'opacity-30', flash && 'ring-2 ring-yellow-400 ring-offset-2')}>
      <CardBody e={e} readOnly={readOnly} actions={actions} />
    </div>
  )
}

function CardBody({ e, readOnly, actions, lifted }: { e: WorkEntry; readOnly: boolean; actions: EntryActions; lifted?: boolean }) {
  return (
    <div className={cn('group rounded-btn border bg-card p-2.5 shadow-sm', e.blocked && e.status !== 'DONE' ? 'border-danger/40' : 'border-line', lifted && 'rotate-1 shadow-lg')}>
      <div className="flex items-start gap-2">
        <DoneCheck e={e} readOnly={readOnly} onToggle={() => actions.onStatus(e, e.status === 'DONE' ? 'PLANNED' : 'DONE')} />
        <div className="min-w-0 flex-1 text-body-sm">
          <EntryText text={e.title} done={e.status === 'DONE'} lines={3} />
          {e.details && <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap break-words text-[12px] text-ink-muted">{e.details}</p>}
          <Chips e={{ ...e, status: e.status === 'IN_PROGRESS' ? 'PLANNED' : e.status }} />
          {!lifted && <NoteList notes={e.notes} max={1} onOpen={() => actions.onNotes(e)} />}
        </div>
      </div>
      {!readOnly && !lifted && <div className="mt-1 flex justify-end"><RowActions e={e} a={actions} /></div>}
    </div>
  )
}
