import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { AlertTriangle, ArrowDown, ArrowUp, CalendarClock, CheckCircle2, CheckSquare, Columns3, ExternalLink, List as ListIcon, ListChecks, Search, Send, X } from 'lucide-react'
import { getMyTasks, type MyTasksResponse, type PendingTask } from '../../lib/tasksApi'
import { projectsApi, type BoardColumn, type BoardData, type ColumnCategory, type PmPriority, type TaskCard } from '../../lib/projectsApi'
import { AvatarStack, DueChip, PRIORITY_META, PriorityGlyph, StatusIcon, dueState, fmtShort } from '../../components/projects/pmUi'
import { TaskDrawer } from './projects/TaskDrawer'
import { useToast } from '../../components/ui/Toast'
import { useAuth } from '../../lib/auth'
import { apiErrorText } from '../../lib/api'
import { cn } from '../../lib/cn'

/**
 * /app/tasks — every task given to me (or that I gave to others), across all projects and boards,
 * as a board (columns by status, drag a card to move it) or a list (sort, group, change the status
 * in place). A task opens in its project's drawer right here. ?view=list, ?task=CODE.
 */

type Card = TaskCard & { project: { key: string; name: string; color: string } }
/** One row: a project task, or a task from the Marketing / E-commerce boards (opens there). */
type Row =
  | { kind: 'project'; id: string; card: Card }
  | { kind: 'other'; id: string; other: PendingTask; category: ColumnCategory }

const CAT_ORDER: Record<ColumnCategory, number> = { TODO: 0, IN_PROGRESS: 1, DONE: 2 }
const SOURCE_LABEL: Record<string, string> = { ecommerce: 'E-commerce', marketing: 'Marketing' }
const VIEW_KEY = 'pt.myTasks.view'
const readView = (): 'board' | 'list' => { try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'board' } catch { return 'board' } }

/** Other boards' tasks only give a status word: guess where it sits. */
function guessCategory(status: string): ColumnCategory {
  const s = status.toLowerCase()
  if (/done|complete|published|closed|launch/.test(s)) return 'DONE'
  if (/progress|review|test|doing|design|writing|editing|scheduled|blocked/.test(s)) return 'IN_PROGRESS'
  return 'TODO'
}

const rowTitle = (r: Row) => (r.kind === 'project' ? r.card.title : r.other.title)
const rowStatus = (r: Row) => (r.kind === 'project' ? r.card.status : r.other.status)
const rowCategory = (r: Row) => (r.kind === 'project' ? r.card.category : r.category)
const rowDue = (r: Row) => (r.kind === 'project' ? r.card.dueAt : r.other.dueDate)
const rowProject = (r: Row) => (r.kind === 'project' ? r.card.project.name : r.other.projectName ?? SOURCE_LABEL[r.other.source] ?? r.other.source)
const rowOverdue = (r: Row) => (r.kind === 'project' ? dueState(r.card.dueAt, r.card.category) === 'overdue' : r.other.overdue)
const PRIO_RANK: Record<PmPriority, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }

export default function MyTasks() {
  const { user } = useAuth()
  const { addToast } = useToast()
  const [params, setParams] = useSearchParams()
  const scope = params.get('scope') === 'byme' ? 'byme' : 'mine'
  const view = (params.get('view') as 'board' | 'list' | null) ?? readView()
  const openCode = params.get('task')
  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) { if (v == null || v === '') next.delete(k); else next.set(k, v) }
    setParams(next, { replace: true })
  }

  const [summary, setSummary] = useState<MyTasksResponse | null>(null)
  const [cards, setCards] = useState<Card[] | null>(null)
  const [columns, setColumns] = useState<Record<string, BoardColumn[]>>({})
  const [doneDays, setDoneDays] = useState(7)
  const [failed, setFailed] = useState(false)
  const [q, setQ] = useState('')
  const [project, setProject] = useState('')
  const [priority, setPriority] = useState<PmPriority | ''>('')
  const [quick, setQuick] = useState<'' | 'overdue' | 'today'>('')
  const [hideDone, setHideDone] = useState(false)
  const [group, setGroup] = useState<'none' | 'project' | 'status' | 'priority' | 'due'>('none')
  const [sort, setSort] = useState<{ key: 'title' | 'project' | 'status' | 'priority' | 'due' | 'created' | 'updated'; dir: 1 | -1 }>({ key: 'due', dir: 1 })
  const [boards, setBoards] = useState<Record<string, BoardData>>({})

  const load = useCallback(() => {
    projectsApi.myTasks(scope === 'byme' ? 'created' : 'assigned', doneDays).then((r) => { setCards(r.tasks); setColumns(r.columns ?? {}) }).catch(() => setFailed(true))
  }, [scope, doneDays])
  useEffect(() => { setCards(null); load() }, [load])
  useEffect(() => { getMyTasks().then(setSummary).catch(() => undefined) }, [])

  const rows: Row[] = useMemo(() => {
    const out: Row[] = (cards ?? []).map((c) => ({ kind: 'project', id: c.id, card: c }))
    // Tasks from the Marketing and E-commerce boards (they open on their own board).
    if (scope === 'mine') for (const t of summary?.pending ?? []) if (t.source !== 'project') out.push({ kind: 'other', id: `${t.source}-${t.id}`, other: t, category: guessCategory(t.status) })
    return out
  }, [cards, summary, scope])

  const projects = useMemo(() => [...new Map(rows.map((r) => [rowProject(r), r.kind === 'project' ? r.card.project.color : '#94A3B8'])).entries()].sort((a, b) => a[0].localeCompare(b[0])), [rows])

  const today = new Date().toDateString()
  const shown = useMemo(() => rows.filter((r) => {
    if (project && rowProject(r) !== project) return false
    if (priority && (r.kind !== 'project' || r.card.priority !== priority)) return false
    if (hideDone && rowCategory(r) === 'DONE') return false
    if (quick === 'overdue' && !rowOverdue(r)) return false
    if (quick === 'today') { const d = rowDue(r); if (!d || new Date(d).toDateString() !== today || rowCategory(r) === 'DONE') return false }
    if (q.trim()) {
      const t = q.trim().toLowerCase()
      const hay = [rowTitle(r), rowProject(r), r.kind === 'project' ? r.card.code : '', rowStatus(r)].join(' ').toLowerCase()
      if (!hay.includes(t)) return false
    }
    return true
  }), [rows, project, priority, hideDone, quick, q, today])

  const filtered = !!(q || project || priority || quick || hideDone)
  const clear = () => { setQ(''); setProject(''); setPriority(''); setQuick(''); setHideDone(false) }

  // Board columns: every status name in use, in the order of their category, then position.
  const statusColumns = useMemo(() => {
    const m = new Map<string, { name: string; category: ColumnCategory; position: number; color: string | null }>()
    for (const r of shown) {
      const name = rowStatus(r)
      const col = r.kind === 'project' ? columns[r.card.project.key]?.find((c) => c.id === r.card.columnId) : null
      const key = name.toLowerCase()
      const cur = m.get(key)
      const cand = { name, category: rowCategory(r), position: col?.position ?? 50, color: col?.color ?? null }
      if (!cur || (cand.position < cur.position && cand.category === cur.category)) m.set(key, cur ? { ...cur, position: cand.position } : cand)
    }
    // Always show the three main stages, even when empty.
    for (const [name, category] of [['To Do', 'TODO'], ['In Progress', 'IN_PROGRESS'], ['Done', 'DONE']] as const) {
      if (![...m.values()].some((x) => x.category === category)) m.set(name.toLowerCase(), { name, category, position: 0, color: null })
    }
    return [...m.values()].sort((a, b) => CAT_ORDER[a.category] - CAT_ORDER[b.category] || a.position - b.position || a.name.localeCompare(b.name))
  }, [shown, columns])

  const replaceCard = (c: TaskCard) => setCards((cur) => (cur ?? []).map((x) => (x.id === c.id ? { ...x, ...c } : x)))

  /** Move a project task to a status of its own project (same name, else the first of that stage). */
  const moveTo = async (card: Card, target: { name: string; category: ColumnCategory }) => {
    const cols = columns[card.project.key] ?? []
    const col = cols.find((c) => c.name.toLowerCase() === target.name.toLowerCase()) ?? cols.filter((c) => c.category === target.category).sort((a, b) => a.position - b.position)[0]
    if (!col) { addToast({ type: 'warning', message: `${card.project.name} has no "${target.name}" column` }); return }
    if (col.id === card.columnId) return
    const before = { ...card }
    replaceCard({ ...card, columnId: col.id, status: col.name, category: col.category })
    try {
      const r = await projectsApi.moveTask(card.code, col.id, null, null)
      replaceCard({ ...r.task })
      if (col.name.toLowerCase() !== target.name.toLowerCase()) addToast({ type: 'info', message: `${card.code} moved to "${col.name}" (its project has no "${target.name}")` })
    } catch (e) {
      replaceCard(before)
      addToast({ type: 'error', message: apiErrorText(e, 'Could not move the task') })
    }
  }

  // The drawer needs the task's project board (columns, people, labels).
  const openCard = cards?.find((c) => c.code === openCode) ?? null
  const openKey = openCode?.split('-').slice(0, -1).join('-') ?? null
  useEffect(() => {
    if (!openKey || boards[openKey]) return
    projectsApi.board(openKey).then((b) => setBoards((m) => ({ ...m, [openKey]: b }))).catch((e) => { addToast({ type: 'error', message: apiErrorText(e, 'Could not open the task') }); setParam({ task: null }) })
  }, [openKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const openRow = (r: Row) => { if (r.kind === 'project') setParam({ task: r.card.code }) }
  const setView = (v: 'board' | 'list') => { try { localStorage.setItem(VIEW_KEY, v) } catch { /* private mode */ } setParam({ view: v }) }

  if (failed) return <p className="text-body-md text-ink-muted">Could not load your tasks.</p>
  const stats = summary?.stats

  return (
    <div className="mx-auto w-full max-w-[1800px] space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">My Tasks</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">{scope === 'mine' ? 'Everything given to you, across every project and board. Drag a card to change its status.' : 'Tasks you gave to other people: open ones, and the ones finished lately.'}</p>
        </div>
        <div className="inline-flex rounded-btn border border-line bg-card p-0.5 shadow-xs">
          <button type="button" onClick={() => setParam({ scope: null })} className={cn('inline-flex h-8 items-center gap-1.5 rounded-[6px] px-3 text-body-md font-medium', scope === 'mine' ? 'bg-primary/10 text-primary' : 'text-ink-muted hover:text-ink')}><CheckSquare size={15} />Assigned to me</button>
          <button type="button" onClick={() => setParam({ scope: 'byme' })} className={cn('inline-flex h-8 items-center gap-1.5 rounded-[6px] px-3 text-body-md font-medium', scope === 'byme' ? 'bg-primary/10 text-primary' : 'text-ink-muted hover:text-ink')}><Send size={14} />Assigned by me</button>
        </div>
      </div>

      {scope === 'mine' && stats && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile icon={<ListChecks size={16} />} label="Open" value={stats.openCount} active={!quick && hideDone} onClick={() => { setQuick(''); setHideDone(!(hideDone && !quick)) }} />
          <Tile icon={<CalendarClock size={16} />} label="Due today" value={stats.dueTodayCount} tone="warning" active={quick === 'today'} onClick={() => setQuick(quick === 'today' ? '' : 'today')} />
          <Tile icon={<AlertTriangle size={16} />} label="Overdue" value={stats.overdueCount} tone="danger" active={quick === 'overdue'} onClick={() => setQuick(quick === 'overdue' ? '' : 'overdue')} />
          <Tile icon={<CheckCircle2 size={16} />} label="Done this week" value={stats.completedThisWeek} tone="success" />
        </div>
      )}

      {/* Views and filters */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line pb-3">
        <div className="mr-1 flex gap-1" role="tablist" aria-label="View">
          <ViewTab on={view === 'board'} onClick={() => setView('board')} icon={<Columns3 size={15} />}>Board</ViewTab>
          <ViewTab on={view === 'list'} onClick={() => setView('list')} icon={<ListIcon size={15} />}>List</ViewTab>
        </div>
        <div className="relative w-full max-w-[220px]">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks" className="h-8 w-full rounded-btn border border-line bg-card pl-8 pr-2.5 text-body-md placeholder:text-ink-faint" />
        </div>
        <select value={project} onChange={(e) => setProject(e.target.value)} className={cn('h-8 rounded-btn border bg-card px-2 text-body-md', project ? 'border-primary text-primary' : 'border-line text-ink')} aria-label="Project">
          <option value="">All projects</option>
          {projects.map(([name]) => <option key={name} value={name}>{name}</option>)}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value as PmPriority | '')} className={cn('h-8 rounded-btn border bg-card px-2 text-body-md', priority ? 'border-primary text-primary' : 'border-line text-ink')} aria-label="Priority">
          <option value="">Any priority</option>
          {(['URGENT', 'HIGH', 'MEDIUM', 'LOW'] as PmPriority[]).map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
        </select>
        <select value={doneDays} onChange={(e) => setDoneDays(Number(e.target.value))} className="h-8 rounded-btn border border-line bg-card px-2 text-body-md text-ink" aria-label="Finished tasks">
          <option value={7}>Done: last 7 days</option>
          <option value={30}>Done: last 30 days</option>
          <option value={90}>Done: last 90 days</option>
        </select>
        <label className="inline-flex h-8 items-center gap-1.5 px-1 text-body-md text-ink-muted"><input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />Hide done</label>
        {view === 'list' && (
          <select value={group} onChange={(e) => setGroup(e.target.value as typeof group)} className="h-8 rounded-btn border border-line bg-card px-2 text-body-md text-ink" aria-label="Group">
            <option value="none">No grouping</option>
            <option value="project">Group by project</option>
            <option value="status">Group by status</option>
            <option value="priority">Group by priority</option>
            <option value="due">Group by due date</option>
          </select>
        )}
        {filtered && <button type="button" onClick={clear} className="inline-flex h-8 items-center gap-1 rounded-btn px-2 text-body-md font-medium text-primary hover:bg-primary/5"><X size={14} />Clear filters</button>}
        <span className="ml-auto text-body-sm text-ink-muted">{cards ? `${shown.length} of ${rows.length}` : 'Loading…'}</span>
      </div>

      {!cards ? (
        <div className="grid gap-3 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-64 animate-pulse rounded-card bg-slate-100" />)}</div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-card border border-line bg-card py-14 text-center">
          <CheckCircle2 size={26} className="text-success" />
          <p className="text-body-md text-ink-muted">{scope === 'mine' ? 'You have no open tasks. Nice work.' : "You haven't given project tasks to others yet."}</p>
        </div>
      ) : view === 'board' ? (
        <Board rows={shown} statusColumns={statusColumns} onOpen={openRow} onMove={moveTo} showAssignees={scope === 'byme'} />
      ) : (
        <ListView rows={shown} columns={columns} group={group} sort={sort} onSort={(key) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))} onOpen={openRow} onStatus={moveTo} showAssignees={scope === 'byme'} />
      )}

      {stats && scope === 'mine' && (
        <p className="text-body-sm text-ink-muted">Finished: today <b className="tabular-nums text-ink">{stats.completedToday}</b> · this week <b className="tabular-nums text-ink">{stats.completedThisWeek}</b> · this month <b className="tabular-nums text-ink">{stats.completedThisMonth}</b></p>
      )}

      {openCode && openKey && boards[openKey] && (
        <TaskDrawer
          code={openCode}
          columns={boards[openKey].columns}
          members={boards[openKey].members}
          labels={boards[openKey].labels}
          meId={user?.id ?? ''}
          onClose={() => { setParam({ task: null }); load() }}
          onChanged={(c) => { if (openCard) replaceCard(c) }}
          onDeleted={() => { setParam({ task: null }); load() }}
          onLabelCreated={(l) => setBoards((m) => ({ ...m, [openKey]: { ...m[openKey], labels: [...m[openKey].labels, l] } }))}
        />
      )}
    </div>
  )
}

function Tile({ icon, label, value, tone = 'primary', active, onClick }: { icon: ReactNode; label: string; value: number; tone?: 'primary' | 'warning' | 'danger' | 'success'; active?: boolean; onClick?: () => void }) {
  const toneCls = { primary: 'text-primary', warning: 'text-warning', danger: 'text-danger', success: 'text-success' }[tone]
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick} className={cn('rounded-card border bg-card px-4 py-3 text-left shadow-xs transition-all', onClick && 'hover:-translate-y-px hover:shadow-sm', active ? 'border-primary ring-2 ring-primary/15' : 'border-line')}>
      <span className={cn('flex items-center gap-1.5 text-body-sm font-medium', value > 0 || tone === 'primary' ? toneCls : 'text-ink-muted')}>{icon}{label}</span>
      <span className="mt-0.5 block text-[26px] font-semibold leading-8 tabular-nums text-ink">{value}</span>
    </Tag>
  )
}

function ViewTab({ on, onClick, icon, children }: { on: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <button type="button" role="tab" aria-selected={on} onClick={onClick} className={cn('relative inline-flex h-8 items-center gap-1.5 rounded-btn px-2.5 text-body-md font-medium transition-colors', on ? 'bg-primary/10 text-primary' : 'text-ink-muted hover:bg-slate-100 hover:text-ink')}>
      {icon}{children}
    </button>
  )
}

// ------------------------------------------------------------------ board

type StatusCol = { name: string; category: ColumnCategory; color: string | null }

function Board({ rows, statusColumns, onOpen, onMove, showAssignees }: { rows: Row[]; statusColumns: StatusCol[]; onOpen: (r: Row) => void; onMove: (c: Card, to: StatusCol) => void; showAssignees: boolean }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const byCol = useMemo(() => {
    const m = new Map<string, Row[]>(statusColumns.map((c) => [c.name.toLowerCase(), []]))
    for (const r of rows) m.get(rowStatus(r).toLowerCase())?.push(r)
    for (const list of m.values()) list.sort((a, b) => {
      const da = rowDue(a), db = rowDue(b)
      if (rowOverdue(a) !== rowOverdue(b)) return rowOverdue(a) ? -1 : 1
      if (da && db) return da.localeCompare(db)
      return da ? -1 : db ? 1 : 0
    })
    return m
  }, [rows, statusColumns])
  // The card being dragged is drawn in an overlay above the page (not inside its scrolling column),
  // so it is never hidden behind the next column while it moves.
  const [dragging, setDragging] = useState<Row | null>(null)
  const onDragStart = (e: DragStartEvent) => setDragging((e.active.data.current?.row as Row | undefined) ?? null)
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null)
    const row = e.active.data.current?.row as Row | undefined
    const col = statusColumns.find((c) => `col:${c.name.toLowerCase()}` === e.over?.id)
    if (row?.kind === 'project' && col) onMove(row.card, col)
  }
  // Phones: one column at a time (pick it above), and "Move to" under each card instead of dragging.
  const [phoneCol, setPhoneCol] = useState(0)
  const pc = statusColumns[Math.min(phoneCol, statusColumns.length - 1)]
  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <div className="md:hidden">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {statusColumns.map((c, i) => {
            const n = byCol.get(c.name.toLowerCase())?.length ?? 0
            return <button key={c.name} type="button" onClick={() => setPhoneCol(i)} className={cn('inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-body-sm font-semibold', i === phoneCol ? 'border-ink bg-ink text-card' : 'border-line bg-card text-ink-muted')}><StatusIcon name={c.name} category={c.category} color={c.color} />{c.name}<span className={cn('tabular-nums', i === phoneCol ? 'text-card/70' : 'text-ink-faint')}>{n}</span></button>
          })}
        </div>
        {pc && <BoardColumnView col={pc} rows={byCol.get(pc.name.toLowerCase()) ?? []} onOpen={onOpen} showAssignees={showAssignees} moveTo={{ columns: statusColumns, onMove }} />}
      </div>
      <div className="flex gap-3 overflow-x-auto pb-3 max-md:hidden">
        {statusColumns.map((c) => <BoardColumnView key={c.name} col={c} rows={byCol.get(c.name.toLowerCase()) ?? []} onOpen={onOpen} showAssignees={showAssignees} />)}
      </div>
      <DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' }}>
        {dragging ? <div className="w-[300px] rotate-[1.5deg] cursor-grabbing rounded-btn border border-primary/40 bg-card p-3 shadow-overlay"><CardBody row={dragging} showAssignees={showAssignees} /></div> : null}
      </DragOverlay>
    </DndContext>
  )
}

function BoardColumnView({ col, rows, onOpen, showAssignees, moveTo }: { col: StatusCol; rows: Row[]; onOpen: (r: Row) => void; showAssignees: boolean; moveTo?: { columns: StatusCol[]; onMove: (c: Card, to: StatusCol) => void } }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${col.name.toLowerCase()}` })
  return (
    <section ref={setNodeRef} className={cn('flex max-h-[calc(100vh-300px)] min-h-[260px] flex-1 shrink-0 flex-col rounded-card border bg-slate-100/70 transition-colors dark:bg-white/[0.03]', moveTo ? 'w-full' : 'min-w-[260px] max-w-[340px]', isOver ? 'border-primary bg-primary/[0.06]' : 'border-transparent')}>
      <header className="flex items-center gap-2 px-3 pb-2 pt-3">
        <StatusIcon name={col.name} category={col.category} color={col.color} />
        <h3 className="text-label-md uppercase text-ink-muted">{col.name}</h3>
        <span className="text-body-sm tabular-nums text-ink-faint">{rows.length}</span>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
        {rows.map((r) => (
          <div key={r.id}>
            <BoardCard row={r} onOpen={onOpen} showAssignees={showAssignees} />
            {moveTo && r.kind === 'project' && (
              <label className="-mt-1 flex items-center gap-2 rounded-b-btn border border-t-0 border-line bg-card px-3 py-1.5 text-[11.5px] text-ink-muted">Move to
                <select value={col.name} onChange={(e) => { const to = moveTo.columns.find((c) => c.name === e.target.value); if (to && to.name !== col.name) moveTo.onMove(r.card, to) }} className="h-7 flex-1 rounded-btn border border-line bg-card px-1.5 text-[12px] text-ink" aria-label="Move to">
                  {moveTo.columns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
              </label>
            )}
          </div>
        ))}
        {!rows.length && <p className="rounded-btn border border-dashed border-line px-3 py-6 text-center text-body-sm text-ink-faint">Nothing here</p>}
      </div>
    </section>
  )
}

function BoardCard({ row, onOpen, showAssignees }: { row: Row; onOpen: (r: Row) => void; showAssignees: boolean }) {
  const drag = useDraggable({ id: row.id, data: { row }, disabled: row.kind !== 'project' })
  const body = <CardBody row={row} showAssignees={showAssignees} />
  // While it is dragged the overlay shows the card; the one in the column stays put as a faint placeholder.
  const cls = cn('block w-full cursor-pointer rounded-btn border border-line bg-card p-3 text-left shadow-xs transition-shadow hover:border-line-strong hover:shadow-sm', drag.isDragging && 'opacity-30 shadow-none')
  if (row.kind === 'other') return <Link to={row.other.link} className={cls}>{body}</Link>
  return (
    <div ref={drag.setNodeRef} {...drag.listeners} {...drag.attributes} role="button" tabIndex={0} onClick={() => onOpen(row)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(row) }} className={cls}>
      {body}
    </div>
  )
}

function CardBody({ row, showAssignees }: { row: Row; showAssignees: boolean }) {
  return (
    <>
      <p className="line-clamp-3 text-body-md font-medium leading-snug text-ink">{rowTitle(row)}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <ProjectChip row={row} />
        {row.kind === 'project' ? <DueChip dueAt={row.card.dueAt} category={row.card.category} compact /> : row.other.dueDate && <span className={cn('text-[11px] font-medium', row.other.overdue ? 'text-danger' : 'text-ink-muted')}>{row.other.overdue ? 'Overdue · ' : 'Due '}{row.other.dueDate}</span>}
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        {row.kind === 'project' ? (
          <>
            <CheckSquare size={13} className="text-primary" />
            <span className="font-mono text-[11.5px] font-medium text-ink-muted">{row.card.code}</span>
            <span className="ml-auto flex items-center gap-2">
              <span title={`${PRIORITY_META[row.card.priority].label} priority`}><PriorityGlyph priority={row.card.priority} /></span>
              {showAssignees ? <AvatarStack people={row.card.assignees} size={22} /> : <AvatarStack people={[row.card.createdBy]} size={22} />}
            </span>
          </>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11.5px] text-ink-muted"><ExternalLink size={12} />Opens on its board</span>
        )}
      </div>
    </>
  )
}

function ProjectChip({ row }: { row: Row }) {
  const color = row.kind === 'project' ? row.card.project.color : '#94A3B8'
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-px text-[11px] font-medium" style={{ borderColor: `${color}55`, color, background: `${color}12` }}>
      <span className="truncate">{rowProject(row)}</span>
    </span>
  )
}

// ------------------------------------------------------------------ list

type SortKey = 'title' | 'project' | 'status' | 'priority' | 'due' | 'created' | 'updated'
const DUE_GROUPS = ['Overdue', 'Due today', 'This week', 'Later', 'No due date', 'Done'] as const
function dueGroup(r: Row): (typeof DUE_GROUPS)[number] {
  if (rowCategory(r) === 'DONE') return 'Done'
  if (rowOverdue(r)) return 'Overdue'
  const d = rowDue(r)
  if (!d) return 'No due date'
  const day = new Date(d), now = new Date()
  if (day.toDateString() === now.toDateString()) return 'Due today'
  return day.getTime() - now.getTime() < 7 * 86400000 ? 'This week' : 'Later'
}

function ListView({ rows, columns, group, sort, onSort, onOpen, onStatus, showAssignees }: {
  rows: Row[]; columns: Record<string, BoardColumn[]>; group: 'none' | 'project' | 'status' | 'priority' | 'due'
  sort: { key: SortKey; dir: 1 | -1 }; onSort: (k: SortKey) => void; onOpen: (r: Row) => void; onStatus: (c: Card, to: StatusCol) => void; showAssignees: boolean
}) {
  const sorted = useMemo(() => {
    const v = (r: Row): string | number => {
      switch (sort.key) {
        case 'title': return rowTitle(r).toLowerCase()
        case 'project': return rowProject(r).toLowerCase()
        case 'status': return `${CAT_ORDER[rowCategory(r)]}${rowStatus(r).toLowerCase()}`
        case 'priority': return r.kind === 'project' ? PRIO_RANK[r.card.priority] : 9
        case 'due': return rowDue(r) ?? '9999'
        case 'created': return r.kind === 'project' ? r.card.createdAt : ''
        case 'updated': return r.kind === 'project' ? r.card.updatedAt : ''
      }
    }
    return [...rows].sort((a, b) => { const x = v(a), y = v(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir })
  }, [rows, sort])
  const groups = useMemo(() => {
    if (group === 'none') return [{ key: '', rows: sorted }]
    const keyOf = (r: Row) => (group === 'project' ? rowProject(r) : group === 'status' ? rowStatus(r) : group === 'priority' ? (r.kind === 'project' ? PRIORITY_META[r.card.priority].label : 'No priority') : dueGroup(r))
    const m = new Map<string, Row[]>()
    for (const r of sorted) { const k = keyOf(r); if (!m.has(k)) m.set(k, []); m.get(k)!.push(r) }
    const order = group === 'due' ? [...DUE_GROUPS] as string[] : group === 'priority' ? ['Urgent', 'High', 'Medium', 'Low', 'No priority'] : null
    return [...m.entries()].sort((a, b) => (order ? order.indexOf(a[0]) - order.indexOf(b[0]) : a[0].localeCompare(b[0]))).map(([key, rows]) => ({ key, rows }))
  }, [sorted, group])

  const Th = ({ k, children, className }: { k: SortKey; children: ReactNode; className?: string }) => (
    <th className={cn('whitespace-nowrap px-3 py-2.5 font-semibold', className)}>
      <button type="button" onClick={() => onSort(k)} className="inline-flex items-center gap-1 uppercase hover:text-ink">{children}{sort.key === k && (sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}</button>
    </th>
  )
  return (
    <div className="overflow-hidden rounded-card border border-line bg-card shadow-xs">
      <div className="max-h-[calc(100vh-300px)] overflow-auto">
        <table className="w-full min-w-[1080px] text-left text-body-md">
          <thead className="sticky top-0 z-[1] bg-card text-label-md uppercase text-ink-faint shadow-[inset_0_-1px_0_rgb(var(--line))]">
            <tr>
              <th className="w-[110px] px-4 py-2.5 font-semibold">Key</th>
              <Th k="title" className="w-[32%]">Summary</Th>
              <Th k="project">Project</Th>
              <Th k="status">Status</Th>
              <Th k="priority">Priority</Th>
              <Th k="due">Due</Th>
              <th className="px-3 py-2.5 font-semibold">{showAssignees ? 'Assignees' : 'Reporter'}</th>
              <Th k="created">Created</Th>
              <Th k="updated">Updated</Th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <GroupRows key={g.key || 'all'} title={g.key} rows={g.rows} columns={columns} onOpen={onOpen} onStatus={onStatus} showAssignees={showAssignees} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function GroupRows({ title, rows, columns, onOpen, onStatus, showAssignees }: { title: string; rows: Row[]; columns: Record<string, BoardColumn[]>; onOpen: (r: Row) => void; onStatus: (c: Card, to: StatusCol) => void; showAssignees: boolean }) {
  const [open, setOpen] = useState(true)
  return (
    <>
      {title && (
        <tr className="bg-slate-50 dark:bg-white/[0.03]">
          <td colSpan={9} className="px-4 py-2">
            <button type="button" onClick={() => setOpen(!open)} className={cn('inline-flex items-center gap-2 text-body-sm font-semibold', title === 'Overdue' ? 'text-danger' : 'text-ink')}>
              <span className={cn('inline-block transition-transform', open ? 'rotate-90' : '')}>›</span>{title}<span className="font-normal text-ink-faint">{rows.length}</span>
            </button>
          </td>
        </tr>
      )}
      {open && rows.map((r) => {
        const cols = r.kind === 'project' ? columns[r.card.project.key] ?? [] : []
        return (
          <tr key={r.id} onClick={() => onOpen(r)} className={cn('border-b border-line/70 transition-colors last:border-0 hover:bg-slate-50 dark:hover:bg-white/[0.03]', r.kind === 'project' && 'cursor-pointer')}>
            <td className="whitespace-nowrap px-4 py-2">{r.kind === 'project' ? <span className="inline-flex items-center gap-1.5 font-mono text-[12px] text-ink-muted"><CheckSquare size={13} className="text-primary" />{r.card.code}</span> : <Link to={r.other.link} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-body-sm text-primary hover:underline"><ExternalLink size={12} />Open</Link>}</td>
            <td className="max-w-[520px] px-3 py-2"><span className="line-clamp-1 font-medium text-ink" title={rowTitle(r)}>{rowTitle(r)}</span></td>
            <td className="whitespace-nowrap px-3 py-2"><ProjectChip row={r} /></td>
            <td className="whitespace-nowrap px-3 py-2" onClick={(e) => e.stopPropagation()}>
              {r.kind === 'project' && cols.length ? (
                <select value={r.card.columnId} onChange={(e) => { const c = cols.find((x) => x.id === e.target.value); if (c) onStatus(r.card, c) }}
                  className={cn('h-7 rounded-md border-0 px-2 text-[12px] font-semibold uppercase tracking-wide', r.card.category === 'DONE' ? 'bg-success/15 text-success' : r.card.category === 'IN_PROGRESS' ? 'bg-primary/10 text-primary' : 'bg-slate-200/70 text-ink-muted dark:bg-white/10')}>
                  {cols.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              ) : (
                <span className="rounded-md bg-slate-200/70 px-2 py-1 text-[12px] font-semibold uppercase tracking-wide text-ink-muted dark:bg-white/10">{rowStatus(r)}</span>
              )}
            </td>
            <td className="whitespace-nowrap px-3 py-2">{r.kind === 'project' ? <span className="inline-flex items-center gap-1.5 text-body-sm text-ink-muted"><PriorityGlyph priority={r.card.priority} />{PRIORITY_META[r.card.priority].label}</span> : <span className="text-ink-faint">—</span>}</td>
            <td className="whitespace-nowrap px-3 py-2">{r.kind === 'project' ? (r.card.dueAt ? <DueChip dueAt={r.card.dueAt} category={r.card.category} compact /> : <span className="text-ink-faint">—</span>) : r.other.dueDate ? <span className={cn('text-body-sm', r.other.overdue ? 'font-semibold text-danger' : 'text-ink-muted')}>{r.other.dueDate}</span> : <span className="text-ink-faint">—</span>}</td>
            <td className="whitespace-nowrap px-3 py-2">{r.kind === 'project' ? (showAssignees ? <AvatarStack people={r.card.assignees} size={22} /> : <span className="inline-flex items-center gap-2 text-body-sm text-ink"><AvatarStack people={[r.card.createdBy]} size={22} />{r.card.createdBy.name}</span>) : <span className="text-ink-faint">—</span>}</td>
            <td className="whitespace-nowrap px-3 py-2 text-body-sm text-ink-muted">{r.kind === 'project' ? fmtShort(r.card.createdAt) : ''}</td>
            <td className="whitespace-nowrap px-3 py-2 text-body-sm text-ink-muted">{r.kind === 'project' ? fmtShort(r.card.updatedAt) : ''}</td>
          </tr>
        )
      })}
    </>
  )
}
