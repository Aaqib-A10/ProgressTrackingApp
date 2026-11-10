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
import { ArrowRight, CheckSquare, ChevronDown, ChevronUp, GripVertical, MessageSquare, Paperclip, Plus } from 'lucide-react'
import type { BoardColumn, TaskCard } from '../../../lib/projectsApi'
import { AvatarStack, DueChip, PriorityGlyph, StatusIcon, PRIORITY_META } from '../../../components/projects/pmUi'
import { LabelChip } from '../../../components/projects/Pickers'
import { VERDICT_META, VerdictBadge } from '../../../components/projects/Reviews'
import { cn } from '../../../lib/cn'
import { usePhone } from '../../../mobile/usePhone'

/**
 * Kanban board with drag and drop (dnd-kit):
 *  - drag a card within a column to reorder, or into another column to change status
 *  - project admins can drag column headers to reorder columns
 *  - mouse, touch (long press) and keyboard (space to pick up, arrows, space to drop)
 * The parent owns the data; this component reports the final drop as
 * onMoveTask(taskId, columnId, beforeId, afterId) where before/after are the
 * neighbouring cards (by id) at the drop spot.
 *
 * Done columns stay short: a task finished more than DONE_VISIBLE_HOURS ago is tucked away
 * (not deleted). "Show N older" opens them again; List view, search and reports still have all.
 */

export const DONE_VISIBLE_HOURS = 24
const DONE_VISIBLE_MS = DONE_VISIBLE_HOURS * 60 * 60 * 1000
/** Finished long enough ago to tuck away from the board. */
function isOldDone(t: TaskCard, now: number): boolean {
  const at = t.completedAt ?? t.updatedAt
  return !!at && now - new Date(at).getTime() > DONE_VISIBLE_MS
}

const colKey = (id: string) => `col:${id}`
const isColKey = (id: string) => id.startsWith('col:')
const colIdOf = (id: string) => id.slice(4)

export function BoardView({ columns, tasks, canMove, canManage, onOpen, onMoveTask, onReorderColumns, onQuickAdd, onAddTask, onDragState, showAllDone = false }: {
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
  /** Show every finished task (e.g. while searching or filtering). */
  showAllDone?: boolean
}) {
  // Phones: one column at a time, and "Move to" under each card instead of dragging.
  const phone = usePhone()
  if (phone) return <PhoneBoard columns={columns} tasks={tasks} canMove={canMove} onOpen={onOpen} onMoveTask={onMoveTask} onQuickAdd={onQuickAdd} onAddTask={onAddTask ?? null} showAllDone={showAllDone} />
  return <DeskBoard columns={columns} tasks={tasks} canMove={canMove} canManage={canManage} onOpen={onOpen} onMoveTask={onMoveTask} onReorderColumns={onReorderColumns} onQuickAdd={onQuickAdd} onAddTask={onAddTask} onDragState={onDragState} showAllDone={showAllDone} />
}

type BoardProps = Parameters<typeof BoardView>[0]

/** A board on a phone: pick a column with the tabs, read its cards, move a card with "Move to". */
function PhoneBoard({ columns, tasks, canMove, onOpen, onMoveTask, onQuickAdd, onAddTask, showAllDone }: Pick<BoardProps, 'columns' | 'tasks' | 'canMove' | 'onOpen' | 'onMoveTask' | 'onQuickAdd' | 'showAllDone'> & { onAddTask: ((columnId: string) => void) | null }) {
  const [colId, setColId] = useState<string | null>(null)
  const [showOld, setShowOld] = useState(false)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const byCol = useMemo(() => {
    const m: Record<string, TaskCard[]> = {}
    for (const c of columns) m[c.id] = []
    for (const t of [...tasks].sort((a, b) => a.position - b.position)) (m[t.columnId] ??= []).push(t)
    return m
  }, [columns, tasks])
  const col = columns.find((c) => c.id === colId) ?? columns.find((c) => c.category !== 'DONE' && (byCol[c.id]?.length ?? 0) > 0) ?? columns[0]
  if (!col) return null
  const now = Date.now()
  const all = byCol[col.id] ?? []
  const tucked = col.category === 'DONE' && !showAllDone ? all.filter((t) => isOldDone(t, now)) : []
  const list = showOld || !tucked.length ? all : all.filter((t) => !tucked.includes(t))
  const moveTo = (t: TaskCard, to: string) => {
    if (to === t.columnId) return
    const target = (byCol[to] ?? []).filter((x) => x.id !== t.id)
    onMoveTask(t.id, to, target.length ? target[target.length - 1].id : null, null)
  }
  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Columns" className="pt-tabs flex flex-wrap gap-1.5">
        {columns.map((c) => {
          const on = c.id === col.id
          return (
            <button key={c.id} type="button" role="tab" aria-selected={on} onClick={() => { setColId(c.id); setShowOld(false) }} className={cn('inline-flex h-9 items-center justify-center gap-1.5 rounded-full border px-3 text-body-sm font-semibold', on ? 'border-ink bg-ink text-card' : 'border-line bg-card text-ink-muted')}>
              <span className="truncate">{c.name}</span><span className={cn('shrink-0 tabular-nums', on ? 'opacity-70' : 'text-ink-faint')}>{byCol[c.id]?.length ?? 0}</span>
            </button>
          )
        })}
      </div>
      <section aria-label={`${col.name} column, ${all.length} tasks`} className="space-y-2">
        {list.map((t) => (
          <div key={t.id}>
            <div role="button" tabIndex={0} aria-label={`${t.code} ${t.title}`} onClick={() => onOpen(t.code)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(t.code) }} className="rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              <CardBody task={t} />
            </div>
            {canMove && columns.length > 1 && (
              <label className="-mt-1 flex items-center gap-2 rounded-b-lg border border-t-0 border-line bg-card px-3 pb-2 pt-3 text-body-sm text-ink-muted">Move to
                <select value={t.columnId} onChange={(e) => moveTo(t, e.target.value)} className="h-9 min-w-0 flex-1 rounded-btn border border-line bg-card px-2 text-body-sm text-ink" aria-label={`Move ${t.code} to`}>
                  {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
            )}
          </div>
        ))}
        {!list.length && <p className="rounded-lg border border-dashed border-line-strong/70 px-3 py-8 text-center text-body-sm text-ink-faint">{tucked.length ? 'Nothing finished in the last day' : 'No tasks here'}</p>}
        {tucked.length > 0 && (
          <button type="button" onClick={() => setShowOld((v) => !v)} className="flex w-full items-center justify-center gap-1 rounded-lg py-2 text-body-sm font-medium text-ink-muted">
            {showOld ? <><ChevronUp size={16} /> Hide older</> : <><ChevronDown size={16} /> Show {tucked.length} older</>}
          </button>
        )}
        {onAddTask ? (
          <button type="button" onClick={() => onAddTask(col.id)} className="flex h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-strong text-body-sm font-medium text-ink-muted"><Plus size={16} /> Add task to {col.name}</button>
        ) : onQuickAdd && (
          <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!title.trim()) return; setBusy(true); try { await onQuickAdd(col.id, title.trim()); setTitle('') } finally { setBusy(false) } }}>
            <input value={title} disabled={busy} onChange={(e) => setTitle(e.target.value)} placeholder={`New task in ${col.name}`} className="h-11 min-w-0 flex-1 rounded-btn border border-line bg-card px-3 text-ink" aria-label="New task title" />
            <button type="submit" disabled={busy || !title.trim()} className="inline-flex h-11 items-center gap-1 rounded-btn bg-primary px-4 font-semibold text-white disabled:opacity-50"><Plus size={16} /> Add</button>
          </form>
        )}
      </section>
    </div>
  )
}

function DeskBoard({ columns, tasks, canMove, canManage, onOpen, onMoveTask, onReorderColumns, onQuickAdd, onAddTask, onDragState, showAllDone = false }: BoardProps) {
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
  // Cards dropped into a done column here stay in view until the next reload brings their finish time.
  const justDone = useRef(new Set<string>())
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
    if (!unchanged && columns.find((c) => c.id === col)?.category === 'DONE') justDone.current.add(a)
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
              <Column key={c.id} column={c} ids={view[c.id] ?? []} byId={byId} canMove={canMove} canDragColumn={canManage} onOpen={onOpen} onQuickAdd={onQuickAdd} onAddTask={onAddTask ?? null} showAllDone={showAllDone} keep={justDone.current} activeId={activeId} />
            ))}
          </div>
        </SortableContext>
      </div>
      <DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' }}>
        {active ? <CardBody task={active} lifted /> : activeCol ? <div className="flex w-60 items-center gap-2 rounded-xl border border-line-strong bg-card px-3 py-2.5 text-[13px] font-medium text-ink shadow-overlay"><StatusIcon name={activeCol.name} category={activeCol.category} color={activeCol.color} />{activeCol.name}</div> : null}
      </DragOverlay>
    </DndContext>
  )
}

function Column({ column, ids: allIds, byId, canMove, canDragColumn, onOpen, onQuickAdd, onAddTask, showAllDone, keep, activeId }: {
  column: BoardColumn
  ids: string[]
  byId: Map<string, TaskCard>
  canMove: boolean
  canDragColumn: boolean
  onOpen: (code: string) => void
  onQuickAdd: ((columnId: string, title: string) => Promise<void>) | null
  onAddTask: ((columnId: string) => void) | null
  showAllDone: boolean
  keep: Set<string>
  activeId: string | null
}) {
  const [showOld, setShowOld] = useState(false)
  // Done column: tuck away tasks finished more than a day ago (still in List view and reports).
  const now = Date.now()
  const tucked = column.category === 'DONE' && !showAllDone
    ? allIds.filter((id) => { const t = byId.get(id); return !!t && isOldDone(t, now) && !keep.has(id) && id !== activeId })
    : []
  const ids = showOld || tucked.length === 0 ? allIds : allIds.filter((id) => !tucked.includes(id))
  const sortable = useSortable({ id: colKey(column.id), data: { type: 'column' }, disabled: !canDragColumn })
  const { setNodeRef: dropRef, isOver } = useDroppable({ id: column.id, data: { type: 'zone' } })
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const over = column.wipLimit != null && allIds.length > column.wipLimit
  const style = { transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition }

  return (
    <section
      ref={sortable.setNodeRef}
      style={style}
      aria-label={`${column.name} column, ${allIds.length} tasks`}
      className={cn('flex w-[85vw] max-w-[300px] shrink-0 snap-start flex-col rounded-xl transition-colors duration-150 sm:w-[272px] xl:w-auto xl:min-w-0 xl:max-w-none xl:flex-1 xl:basis-0', isOver ? 'bg-primary/[0.06] ring-1 ring-inset ring-primary/25' : 'bg-slate-100/60', sortable.isDragging && 'opacity-40')}
    >
      <header className="group/col flex h-10 items-center gap-2 px-3 xl:px-2.5">
        {canDragColumn && (
          <button type="button" {...sortable.attributes} {...sortable.listeners} className="-ml-1.5 cursor-grab touch-none rounded p-0.5 text-ink-faint opacity-0 hover:bg-slate-200 hover:text-ink-muted focus-visible:opacity-100 active:cursor-grabbing group-hover/col:opacity-100" aria-label={`Drag to reorder ${column.name} column`}>
            <GripVertical size={13} />
          </button>
        )}
        <StatusIcon name={column.name} category={column.category} color={column.color} />
        <h2 className="truncate text-[13px] font-medium text-ink">{column.name}</h2>
        <span className={cn('text-[12px] tabular-nums', over ? 'font-semibold text-danger' : 'text-ink-faint')} title={column.wipLimit != null ? `Work in progress limit ${column.wipLimit}` : undefined}>
          {allIds.length}{column.wipLimit != null ? `/${column.wipLimit}` : ''}
        </span>
        <span className="flex-1" />
        {(onAddTask || onQuickAdd) && (
          <button type="button" onClick={() => (onAddTask ? onAddTask(column.id) : setAdding(true))} className="rounded-md p-1 text-ink-faint transition-colors hover:bg-slate-200 hover:text-ink" aria-label={`Add task to ${column.name}`} title="Add task">
            <Plus size={14} />
          </button>
        )}
      </header>
      <div ref={dropRef} className="flex min-h-[96px] flex-1 flex-col gap-1.5 px-1.5 pb-1.5">
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {ids.map((id) => {
            const t = byId.get(id)
            return t ? <SortableCard key={id} task={t} canMove={canMove} onOpen={onOpen} /> : null
          })}
        </SortableContext>
        {ids.length === 0 && !adding && (
          <p className="mx-0.5 rounded-lg border border-dashed border-line-strong/70 px-2 py-5 text-center text-[12px] text-ink-faint">
            {tucked.length > 0 ? 'Nothing finished in the last day' : canMove ? 'Drop tasks here' : 'No tasks'}
          </p>
        )}
        {tucked.length > 0 && (
          <button
            type="button"
            onClick={() => setShowOld((v) => !v)}
            className="flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[12px] font-medium text-ink-muted hover:bg-slate-200/60 hover:text-ink"
            title={`Tasks finished more than ${DONE_VISIBLE_HOURS} hours ago are tucked away to keep the board short. They are never deleted: see the Completed tab.`}
          >
            {showOld ? <><ChevronUp size={14} /> Hide older</> : <><ChevronDown size={14} /> Show {tucked.length} older</>}
          </button>
        )}
      </div>
      {onAddTask ? (
        <div className="px-2 pb-2">
          <button type="button" onClick={() => onAddTask(column.id)} className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] text-ink-faint transition-colors hover:bg-slate-200/60 hover:text-ink">
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
                className="w-full resize-none rounded-lg border border-primary bg-card p-2 text-[13px] shadow-raised focus:outline-none focus:ring-[3px] focus:ring-primary/15"
              />
            </form>
          ) : (
            <button type="button" onClick={() => setAdding(true)} className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] text-ink-faint transition-colors hover:bg-slate-200/60 hover:text-ink">
              <Plus size={14} /> Add task
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
      className={cn('touch-manipulation rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40', isDragging && 'opacity-30')}
    >
      <CardBody task={task} />
    </div>
  )
}


export function CardBody({ task, lifted }: { task: TaskCard; lifted?: boolean }) {
  const c = task.counts
  const hasFoot = c.comments > 0 || c.attachments > 0 || c.checklistTotal > 0 || !!task.lastReviewVerdict
  return (
    <div
      className={cn(
        'group/card relative cursor-pointer rounded-lg border bg-card px-3 py-2.5 shadow-xs transition-[border-color,box-shadow,transform] duration-150 hover:border-line-strong hover:shadow-raised',
        task.isOverdue ? 'border-danger/35' : 'border-line',
        lifted && 'w-64 rotate-[1.5deg] scale-[1.02] cursor-grabbing border-line-strong shadow-overlay',
      )}
    >
      {/* Urgent and high priority show as a thin coloured edge, so the eye finds them first. */}
      {(task.priority === 'URGENT' || task.priority === 'HIGH') && (
        <span className={cn('absolute inset-y-2 left-0 w-[3px] rounded-r-full', task.priority === 'URGENT' ? 'bg-danger' : 'bg-warning')} aria-hidden />
      )}
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-ink-faint">{task.code}</span>
        <span className="flex-1" />
        {task.assignees.length > 0 ? <AvatarStack people={task.assignees} max={3} size={20} /> : <span className="h-5 w-5 rounded-full border border-dashed border-line-strong" title="Nobody yet" />}
      </div>
      <p className="mt-1 line-clamp-3 break-words text-[13px] font-medium leading-[18px] text-ink">{task.title}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="inline-flex h-5 items-center rounded-md border border-line px-1" title={`${PRIORITY_META[task.priority].label} priority`}><PriorityGlyph priority={task.priority} size={13} /></span>
        <DueChip dueAt={task.dueAt} category={task.category} compact />
        {task.labels.map((l) => <LabelChip key={l.id} label={l} />)}
      </div>
      {hasFoot && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-faint">
          {task.lastReviewVerdict && <span title={`${c.reviews} review${c.reviews === 1 ? '' : 's'}, latest: ${VERDICT_META[task.lastReviewVerdict].label}`}><VerdictBadge verdict={task.lastReviewVerdict} short /></span>}
          {c.comments > 0 && <span className="inline-flex items-center gap-1"><MessageSquare size={12} />{c.comments}</span>}
          {c.attachments > 0 && <span className="inline-flex items-center gap-1"><Paperclip size={12} />{c.attachments}</span>}
          {c.checklistTotal > 0 && <span className={cn('inline-flex items-center gap-1', c.checklistDone === c.checklistTotal && 'text-success')}><CheckSquare size={12} />{c.checklistDone}/{c.checklistTotal}</span>}
        </div>
      )}
      <p className="mt-1.5 truncate text-[11px] text-ink-faint" title={`Assigned by ${task.createdBy.name} to ${task.assignees.map((a) => a.name).join(', ') || 'nobody yet'}`}>
        {task.createdBy.name}<ArrowRight size={10} className="mx-1 inline" />{task.assignees.length ? task.assignees.map((a) => a.name).join(', ') : 'nobody yet'}
      </p>
    </div>
  )
}
