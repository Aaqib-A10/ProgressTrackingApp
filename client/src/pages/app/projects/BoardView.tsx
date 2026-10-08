import { useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowRight, CheckSquare, GripVertical, MessageSquare, Paperclip, Plus } from 'lucide-react'
import type { BoardColumn, TaskCard } from '../../../lib/projectsApi'
import { AvatarStack, DueChip, PriorityIcon } from '../../../components/projects/pmUi'
import { LabelChip } from '../../../components/projects/Pickers'
import { VERDICT_META, VerdictBadge } from '../../../components/projects/Reviews'
import { cn } from '../../../lib/cn'

/**
 * Kanban board with drag and drop (dnd-kit):
 *  - drag a card within a column to reorder, or into another column to change status
 *  - project admins can drag column headers to reorder columns
 *  - mouse, touch (long press) and keyboard (space to pick up, arrows, space to drop)
 * The parent owns the data; this component reports the final drop as
 * onMoveTask(taskId, columnId, beforeId, afterId) where before/after are the
 * neighbouring cards (by id) at the drop spot.
 */

const colKey = (id: string) => `col:${id}`
const isColKey = (id: string) => id.startsWith('col:')
const colIdOf = (id: string) => id.slice(4)

export function BoardView({ columns, tasks, canMove, canManage, onOpen, onMoveTask, onReorderColumns, onQuickAdd, onAddTask, onDragState }: {
  columns: BoardColumn[]
  tasks: TaskCard[]
  canMove: boolean
  canManage: boolean
  onOpen: (code: string) => void
  onMoveTask: (taskId: string, columnId: string, beforeId: string | null, afterId: string | null) => void
  onReorderColumns: (orderedIds: string[]) => void
  onQuickAdd: ((columnId: string, title: string) => Promise<void>) | null
  /** Open the full "New task" form with this column preselected (used instead of the inline quick add). */
  onAddTask?: ((columnId: string) => void) | null
  onDragState: (dragging: boolean) => void
}) {
  // Local mirror of "which column holds which card ids, in order" so cards can
  // hop columns while dragging; rebuilt from props whenever not dragging.
  const grouped = useMemo(() => {
    const m: Record<string, string[]> = {}
    for (const c of columns) m[c.id] = []
    for (const t of [...tasks].sort((a, b) => a.position - b.position)) (m[t.columnId] ??= []).push(t.id)
    return m
  }, [columns, tasks])
  const [items, setItems] = useState<Record<string, string[]> | null>(null)
  const [colOrder, setColOrder] = useState<string[] | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const startCol = useRef<string | null>(null)
  const view = items ?? grouped
  const order = colOrder ?? columns.map((c) => c.id)
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks])

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const findCol = (id: string): string | null => {
    if (isColKey(id)) return colIdOf(id)
    if (id in view) return id
    return Object.keys(view).find((c) => view[c].includes(id)) ?? null
  }

  // Columns only collide with columns; cards collide with cards + column drop zones.
  const collision: CollisionDetection = (args) => {
    const type = args.active.data.current?.type
    if (type === 'column') {
      return closestCorners({ ...args, droppableContainers: args.droppableContainers.filter((d) => isColKey(String(d.id))) })
    }
    const containers = args.droppableContainers.filter((d) => !isColKey(String(d.id)))
    if (!args.pointerCoordinates) {
      // Keyboard: ignore the card's own column zone so arrow keys reach cards and other columns.
      const own = findCol(String(args.active.id))
      return closestCorners({ ...args, droppableContainers: containers.filter((d) => String(d.id) !== own) })
    }
    const within = pointerWithin({ ...args, droppableContainers: containers })
    if (within.length) {
      // Prefer a card under the pointer over its column's zone.
      const card = within.find((c) => !(String(c.id) in view))
      return card ? [card] : within
    }
    return closestCorners({ ...args, droppableContainers: containers })
  }

  function onDragStart(e: DragStartEvent) {
    const id = String(e.active.id)
    setActiveId(id)
    onDragState(true)
    if (isColKey(id)) setColOrder(columns.map((c) => c.id))
    else {
      setItems(grouped)
      startCol.current = findCol(id)
    }
  }

  function onDragOver(e: DragOverEvent) {
    const a = String(e.active.id)
    const o = e.over ? String(e.over.id) : null
    if (!o || isColKey(a) || !items) return
    const from = findCol(a)
    const to = findCol(o)
    if (!from || !to || from === to) return
    setItems((prev) => {
      if (!prev) return prev
      const src = prev[from].filter((x) => x !== a)
      const dst = [...prev[to]]
      const overIdx = dst.indexOf(o)
      const insertAt = overIdx >= 0 ? overIdx : dst.length
      dst.splice(insertAt, 0, a)
      return { ...prev, [from]: src, [to]: dst }
    })
  }

  function finish() {
    setActiveId(null)
    setItems(null)
    setColOrder(null)
    startCol.current = null
    onDragState(false)
  }

  function onDragEnd(e: DragEndEvent) {
    const a = String(e.active.id)
    const o = e.over ? String(e.over.id) : null
    if (isColKey(a)) {
      if (o && isColKey(o) && o !== a) {
        const ids = columns.map((c) => c.id)
        const next = arrayMove(ids, ids.indexOf(colIdOf(a)), ids.indexOf(colIdOf(o)))
        onReorderColumns(next)
      }
      finish()
      return
    }
    if (!items || !o) { finish(); return }
    const col = findCol(o) ?? findCol(a)
    if (!col) { finish(); return }
    let list = items[col]
    const oldIdx = list.indexOf(a)
    const overIdx = list.indexOf(o)
    if (oldIdx >= 0 && overIdx >= 0 && oldIdx !== overIdx) list = arrayMove(list, oldIdx, overIdx)
    const idx = list.indexOf(a)
    const before = idx > 0 ? list[idx - 1] : null
    const after = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null
    const original = grouped[startCol.current ?? col] ?? []
    const unchanged = startCol.current === col && original.indexOf(a) === idx
    finish()
    if (!unchanged) onMoveTask(a, col, before, after)
  }

  const active = activeId && !isColKey(activeId) ? byId.get(activeId) : null
  const activeCol = activeId && isColKey(activeId) ? columns.find((c) => c.id === colIdOf(activeId)) : null
  const orderedCols = order.map((id) => columns.find((c) => c.id === id)).filter((c): c is BoardColumn => !!c)

  return (
    <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={finish}>
      <div className="-mx-4 overflow-x-auto px-4 pb-3 sm:-mx-6 sm:px-6 xl:mx-0 xl:overflow-x-visible xl:px-0">
        <SortableContext items={orderedCols.map((c) => colKey(c.id))} strategy={horizontalListSortingStrategy}>
          <div className="flex min-h-[60vh] snap-x snap-mandatory items-start gap-3 sm:snap-none xl:gap-2.5">
            {orderedCols.map((c) => (
              <Column key={c.id} column={c} ids={view[c.id] ?? []} byId={byId} canMove={canMove} canDragColumn={canManage} onOpen={onOpen} onQuickAdd={onQuickAdd} onAddTask={onAddTask ?? null} />
            ))}
          </div>
        </SortableContext>
      </div>
      <DragOverlay dropAnimation={{ duration: 160, easing: 'ease-out' }}>
        {active ? <CardBody task={active} lifted /> : activeCol ? <div className="w-60 rounded-card border border-primary/40 bg-card px-3 py-2 text-label-md uppercase text-ink shadow-overlay">{activeCol.name}</div> : null}
      </DragOverlay>
    </DndContext>
  )
}

function Column({ column, ids, byId, canMove, canDragColumn, onOpen, onQuickAdd, onAddTask }: {
  column: BoardColumn
  ids: string[]
  byId: Map<string, TaskCard>
  canMove: boolean
  canDragColumn: boolean
  onOpen: (code: string) => void
  onQuickAdd: ((columnId: string, title: string) => Promise<void>) | null
  onAddTask: ((columnId: string) => void) | null
}) {
  const sortable = useSortable({ id: colKey(column.id), data: { type: 'column' }, disabled: !canDragColumn })
  const { setNodeRef: dropRef, isOver } = useDroppable({ id: column.id, data: { type: 'zone' } })
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const over = column.wipLimit != null && ids.length > column.wipLimit
  const style = { transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition }

  return (
    <section
      ref={sortable.setNodeRef}
      style={style}
      aria-label={`${column.name} column, ${ids.length} tasks`}
      className={cn('flex w-[85vw] max-w-[300px] shrink-0 snap-start flex-col rounded-card border bg-slate-50/80 sm:w-64 xl:w-auto xl:min-w-0 xl:max-w-none xl:flex-1 xl:basis-0', isOver ? 'border-primary/40 bg-primary/5' : 'border-line', sortable.isDragging && 'opacity-40')}
    >
      <header className="flex items-center gap-2 px-3 pb-1 pt-2.5 xl:px-2.5">
        {canDragColumn && (
          <button type="button" {...sortable.attributes} {...sortable.listeners} className="-ml-1 cursor-grab touch-none rounded p-0.5 text-ink-muted hover:bg-slate-200 active:cursor-grabbing" aria-label={`Drag to reorder ${column.name} column`}>
            <GripVertical size={14} />
          </button>
        )}
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: column.color ?? '#94A3B8' }} />
        <h2 className="flex-1 truncate text-label-md uppercase text-ink">{column.name}</h2>
        <span className={cn('rounded-full px-2 text-body-sm font-semibold tabular-nums', over ? 'bg-danger/10 text-danger' : 'bg-slate-200 text-ink-muted')} title={column.wipLimit != null ? `Work in progress limit ${column.wipLimit}` : undefined}>
          {ids.length}{column.wipLimit != null ? `/${column.wipLimit}` : ''}
        </span>
      </header>
      <div ref={dropRef} className="flex min-h-[96px] flex-1 flex-col gap-2 p-2 xl:gap-1.5 xl:p-1.5">
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {ids.map((id) => {
            const t = byId.get(id)
            return t ? <SortableCard key={id} task={t} canMove={canMove} onOpen={onOpen} /> : null
          })}
        </SortableContext>
        {ids.length === 0 && !adding && <p className="px-1 py-4 text-center text-body-sm text-ink-muted">{canMove ? 'Drop tasks here' : 'No tasks'}</p>}
      </div>
      {onAddTask ? (
        <div className="px-2 pb-2">
          <button type="button" onClick={() => onAddTask(column.id)} className="flex w-full items-center gap-1.5 rounded-btn px-2 py-1.5 text-body-sm font-medium text-ink-muted hover:bg-slate-200/70 hover:text-ink">
            <Plus size={14} /> Add task
          </button>
        </div>
      ) : onQuickAdd && (
        <div className="px-2 pb-2">
          {adding ? (
            <form onSubmit={async (e) => { e.preventDefault(); if (!title.trim()) return; setBusy(true); try { await onQuickAdd(column.id, title.trim()); setTitle('') } finally { setBusy(false) } }}>
              <textarea
                autoFocus
                value={title}
                disabled={busy}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement).requestSubmit() }
                  if (e.key === 'Escape') { setAdding(false); setTitle('') }
                }}
                onBlur={() => { if (!title.trim()) setAdding(false) }}
                rows={2}
                placeholder="Task title, then Enter"
                className="w-full resize-none rounded-btn border border-primary bg-card p-2 text-body-md focus:outline-none focus:ring-4 focus:ring-primary/10"
              />
            </form>
          ) : (
            <button type="button" onClick={() => setAdding(true)} className="flex w-full items-center gap-1.5 rounded-btn px-2 py-1.5 text-body-sm font-medium text-ink-muted hover:bg-slate-200/70 hover:text-ink">
              <Plus size={15} /> Add task
            </button>
          )}
        </div>
      )}
    </section>
  )
}

function SortableCard({ task, canMove, onOpen }: { task: TaskCard; canMove: boolean; onOpen: (code: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, data: { type: 'task' }, disabled: !canMove })
  const style = { transform: CSS.Transform.toString(transform), transition }
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      role="button"
      aria-roledescription={canMove ? 'draggable task' : 'task'}
      aria-label={`${task.code} ${task.title}`}
      onClick={() => onOpen(task.code)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(task.code)
        else listeners?.onKeyDown?.(e)
      }}
      className={cn('touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-btn', isDragging && 'opacity-30')}
    >
      <CardBody task={task} />
    </div>
  )
}


export function CardBody({ task, lifted }: { task: TaskCard; lifted?: boolean }) {
  const c = task.counts
  return (
    <div className={cn('cursor-pointer rounded-btn border bg-card p-3 shadow-card transition-shadow hover:shadow-overlay xl:p-2.5', task.isOverdue ? 'border-danger/40' : 'border-line', lifted && 'w-60 rotate-1 cursor-grabbing shadow-overlay')}>
      {task.labels.length > 0 && <div className="mb-1.5 flex flex-wrap gap-1">{task.labels.map((l) => <LabelChip key={l.id} label={l} />)}</div>}
      <p className="line-clamp-3 break-words text-body-md font-medium text-ink xl:text-body-sm">{task.title}</p>
      <p className="mt-1 truncate text-[11px] text-ink-muted" title={`Assigned by ${task.createdBy.name} to ${task.assignees.map((a) => a.name).join(', ') || 'nobody yet'}`}>
        <span className="font-medium text-ink">{task.createdBy.name}</span>
        <ArrowRight size={10} className="mx-1 inline" />
        {task.assignees.length ? <span className="font-medium text-ink">{task.assignees.map((a) => a.name).join(', ')}</span> : <span className="italic">unassigned</span>}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 xl:mt-1.5">
        <span className="font-mono text-[11px] font-semibold text-ink-muted">{task.code}</span>
        <PriorityIcon priority={task.priority} />
        <DueChip dueAt={task.dueAt} category={task.category} compact />
        <span className="ml-auto">{task.assignees.length > 0 && <AvatarStack people={task.assignees} max={3} size={22} />}</span>
      </div>
      {(c.comments > 0 || c.attachments > 0 || c.checklistTotal > 0 || task.lastReviewVerdict) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-muted">
          {task.lastReviewVerdict && <span title={`${c.reviews} review${c.reviews === 1 ? '' : 's'}, latest: ${VERDICT_META[task.lastReviewVerdict].label}`}><VerdictBadge verdict={task.lastReviewVerdict} short /></span>}
          {c.comments > 0 && <span className="inline-flex items-center gap-1"><MessageSquare size={12} />{c.comments}</span>}
          {c.attachments > 0 && <span className="inline-flex items-center gap-1"><Paperclip size={12} />{c.attachments}</span>}
          {c.checklistTotal > 0 && <span className={cn('inline-flex items-center gap-1', c.checklistDone === c.checklistTotal && 'text-success')}><CheckSquare size={12} />{c.checklistDone}/{c.checklistTotal}</span>}
        </div>
      )}
    </div>
  )
}
