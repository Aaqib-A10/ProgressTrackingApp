import { useState } from 'react'
import { DndContext, DragOverlay, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { cn } from '../../../lib/cn'
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

export function TodoBoard({ entries, readOnly, actions }: { entries: WorkEntry[]; readOnly: boolean; actions: EntryActions }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }))
  const [dragging, setDragging] = useState<WorkEntry | null>(null)

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
                {rows.map((e) => <Card key={e.id} e={e} readOnly={readOnly} actions={actions} hidden={dragging?.id === e.id} />)}
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

function Card({ e, readOnly, actions, hidden }: { e: WorkEntry; readOnly: boolean; actions: EntryActions; hidden: boolean }) {
  const { setNodeRef, listeners, attributes } = useDraggable({ id: e.id, disabled: readOnly })
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={cn('touch-manipulation outline-none', !readOnly && 'cursor-grab active:cursor-grabbing', hidden && 'opacity-30')}>
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
