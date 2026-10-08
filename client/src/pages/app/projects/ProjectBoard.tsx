import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ClipboardCheck, Columns3, List, MessagesSquare, Plus, Search, Settings2, X } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { useToast } from '../../../components/ui/Toast'
import { AvatarStack, PRIORITIES, PRIORITY_META, fieldCls } from '../../../components/projects/pmUi'
import { rankBetween } from '../../../lib/rank'
import { visiblePoll } from '../../../lib/chatApi'
import { errMsg, projectsApi, type BoardData, type Label, type TaskCard } from '../../../lib/projectsApi'
import { cn } from '../../../lib/cn'
import { BoardView } from './BoardView'
import { ListView } from './ListView'
import { ReviewsView } from './ReviewsView'
import { CreateTaskModal } from './CreateTaskModal'
import { TaskDrawer } from './TaskDrawer'

/**
 * /app/projects/:key — one project's board (or list). Only this project's columns
 * and tasks are loaded. Filters live in the URL so a filtered board can be shared,
 * and ?task=CODE opens the task drawer. The board refreshes every 5 seconds while
 * the tab is visible (paused during a drag) so moves by teammates show up live.
 */
export default function ProjectBoard() {
  const { key = '' } = useParams()
  const navigate = useNavigate()
  const { addToast } = useToast()
  const [params, setParams] = useSearchParams()
  const [data, setData] = useState<BoardData | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [showOld, setShowOld] = useState(false)
  const [creating, setCreating] = useState(false)
  const dragging = useRef(false)
  const pending = useRef(0)

  const view = params.get('view') === 'list' ? 'list' : params.get('view') === 'reviews' ? 'reviews' : 'board'
  const q = params.get('q') ?? ''
  const assignee = params.get('assignee') ?? ''
  const priority = params.get('priority') ?? ''
  const label = params.get('label') ?? ''
  const due = params.get('due') ?? ''
  const mine = params.get('mine') === '1'
  const openCode = params.get('task')

  const setParam = (k: string, v: string | null) => {
    const n = new URLSearchParams(params)
    if (v) n.set(k, v)
    else n.delete(k)
    // Always replace: opening or closing a task (or changing a filter) must not add history steps,
    // so the back button leaves the board instead of re-opening the last task.
    setParams(n, { replace: true })
  }

  const load = useCallback(async (quiet = false) => {
    try {
      const d = await projectsApi.board(key, showOld)
      if (dragging.current || pending.current > 0) return
      setData(d)
      setNotFound(false)
    } catch (e) {
      if (!quiet) {
        setNotFound(true)
        if (!(e instanceof Error && /404|not found/i.test(e.message))) addToast({ type: 'error', message: errMsg(e, 'Could not load the board') })
      }
    }
  }, [key, showOld, addToast])

  useEffect(() => { setData(null); load() }, [load])
  useEffect(() => (notFound ? undefined : visiblePoll(() => load(true), 5000)), [load, notFound])

  // "C" opens the new task modal (unless typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key.toLowerCase() !== 'c' || e.metaKey || e.ctrlKey || e.altKey) return
      if (t.closest('input,textarea,select,[contenteditable=true],[role=dialog]')) return
      if (data?.perms.canContribute) { e.preventDefault(); setCreating(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [data?.perms.canContribute])

  const meId = data?.me.id ?? ''
  const filtered = useMemo(() => {
    if (!data) return []
    const now = Date.now()
    const endToday = new Date(); endToday.setHours(23, 59, 59, 999)
    const endWeek = new Date(endToday); endWeek.setDate(endWeek.getDate() + ((7 - endWeek.getDay()) % 7))
    const needle = q.trim().toLowerCase()
    return data.tasks.filter((t) => {
      if (needle && !t.title.toLowerCase().includes(needle) && !t.code.toLowerCase().includes(needle)) return false
      if (mine && !t.assignees.some((a) => a.id === meId)) return false
      if (assignee === 'none' && t.assignees.length) return false
      if (assignee && assignee !== 'none' && !t.assignees.some((a) => a.id === (assignee === 'me' ? meId : assignee))) return false
      if (priority && t.priority !== priority) return false
      if (label && !t.labels.some((l) => l.id === label)) return false
      if (due) {
        const d = t.dueAt ? new Date(t.dueAt).getTime() : null
        if (due === 'none' && d !== null) return false
        if (due === 'overdue' && !(d !== null && d < now && t.category !== 'DONE')) return false
        if (due === 'today' && !(d !== null && d <= endToday.getTime() && t.category !== 'DONE')) return false
        if (due === 'week' && !(d !== null && d <= endWeek.getTime() && t.category !== 'DONE')) return false
      }
      return true
    })
  }, [data, q, mine, assignee, priority, label, due, meId])

  const filtersOn = !!(q || assignee || priority || label || due || mine)
  const myOverdue = data ? data.tasks.filter((t) => t.isOverdue && t.assignees.some((a) => a.id === meId)).length : 0

  const upsert = (card: TaskCard) => setData((d) => (d ? { ...d, tasks: d.tasks.some((t) => t.id === card.id) ? d.tasks.map((t) => (t.id === card.id ? card : t)) : [...d.tasks, card] } : d))
  const addLabel = (l: Label) => setData((d) => (d && !d.labels.some((x) => x.id === l.id) ? { ...d, labels: [...d.labels, l].sort((a, b) => a.name.localeCompare(b.name)) } : d))

  function moveTask(taskId: string, columnId: string, beforeId: string | null, afterId: string | null) {
    if (!data) return
    const task = data.tasks.find((t) => t.id === taskId)
    const col = data.columns.find((c) => c.id === columnId)
    if (!task || !col) return
    const pos = (id: string | null) => (id ? data.tasks.find((t) => t.id === id)?.position ?? null : null)
    const snapshot = data
    // Optimistic: place the card now, then let the server confirm (or roll back).
    upsert({ ...task, columnId, status: col.name, category: col.category, position: rankBetween(pos(beforeId), pos(afterId)), completedAt: col.category === 'DONE' ? task.completedAt ?? new Date().toISOString() : null, isOverdue: col.category === 'DONE' ? false : task.isOverdue })
    pending.current++
    projectsApi.moveTask(task.code, columnId, beforeId, afterId)
      .then((r) => upsert(r.task))
      .catch((e) => { setData(snapshot); addToast({ type: 'error', message: errMsg(e, 'Could not move the task') }) })
      .finally(() => { pending.current = Math.max(0, pending.current - 1) })
  }

  function reorderColumns(ids: string[]) {
    if (!data) return
    const snapshot = data
    setData({ ...data, columns: ids.map((id, i) => ({ ...data.columns.find((c) => c.id === id)!, position: i })) })
    projectsApi.reorderColumns(key, ids).catch((e) => { setData(snapshot); addToast({ type: 'error', message: errMsg(e) }) })
  }

  async function quickAdd(columnId: string, title: string) {
    try {
      const r = await projectsApi.createTask(key, { title, columnId })
      upsert(r.task)
    } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not add the task') }) }
  }

  if (notFound) {
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-center">
        <AlertTriangle size={28} className="text-ink-muted" />
        <p className="text-body-lg text-ink">Project not found</p>
        <p className="text-body-md text-ink-muted">It doesn't exist, or you're not a member of it.</p>
        <Link to="/app/projects" className="text-body-md font-semibold text-primary">Back to projects</Link>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="space-y-4">
        <div className="h-10 w-64 animate-pulse rounded-btn bg-slate-200" />
        <div className="flex gap-3">{Array.from({ length: 5 }, (_, i) => <div key={i} className="h-96 w-72 shrink-0 animate-pulse rounded-card bg-slate-100" />)}</div>
      </div>
    )
  }

  const { project, perms } = data
  const people = data.members.map((m) => ({ id: m.id, name: m.name }))

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-btn text-body-sm font-bold text-white" style={{ backgroundColor: project.color }}>{project.key.slice(0, 3)}</span>
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-body-sm text-ink-muted"><Link to="/app/projects" className="hover:text-ink">Projects</Link><span>/</span><span>{project.key}</span></div>
          <h1 className="truncate text-headline-lg leading-tight text-ink">{project.name}{project.status === 'ARCHIVED' && <span className="ml-2 align-middle text-body-sm font-medium text-ink-muted">(archived)</span>}</h1>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => perms.canManage && navigate(`/app/projects/${project.key}/settings?tab=members`)} title={`${data.members.length} members`} className="mr-1"><AvatarStack people={people} max={5} size={28} /></button>
          <div className="inline-flex rounded-btn border border-line bg-card p-0.5" role="tablist" aria-label="View">
            <button type="button" role="tab" aria-selected={view === 'board'} onClick={() => setParam('view', null)} className={cn('inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-body-sm font-semibold', view === 'board' ? 'bg-primary text-white' : 'text-ink-muted hover:text-ink')}><Columns3 size={14} /> Board</button>
            <button type="button" role="tab" aria-selected={view === 'list'} onClick={() => setParam('view', 'list')} className={cn('inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-body-sm font-semibold', view === 'list' ? 'bg-primary text-white' : 'text-ink-muted hover:text-ink')}><List size={14} /> List</button>
            <button type="button" role="tab" aria-selected={view === 'reviews'} onClick={() => setParam('view', 'reviews')} className={cn('inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-body-sm font-semibold', view === 'reviews' ? 'bg-primary text-white' : 'text-ink-muted hover:text-ink')}><ClipboardCheck size={14} /> Reviews</button>
          </div>
          <Button size="sm" variant="secondary" leadingIcon={<MessagesSquare size={15} />} onClick={() => navigate(`/app/chat?project=${project.key}`)}>Chat</Button>
          {perms.canManage && <Button size="sm" variant="secondary" leadingIcon={<Settings2 size={15} />} onClick={() => navigate(`/app/projects/${project.key}/settings`)}>Settings</Button>}
          {perms.canContribute && project.status === 'ACTIVE' && <Button size="sm" leadingIcon={<Plus size={16} />} onClick={() => setCreating(true)} title="New task (C)">Add task</Button>}
        </div>
      </div>

      {myOverdue > 0 && (
        <button type="button" onClick={() => { const n = new URLSearchParams(params); n.set('due', 'overdue'); n.set('mine', '1'); setParams(n, { replace: true }) }} className="flex w-full items-center gap-2 rounded-card border border-danger/30 bg-danger/5 px-4 py-2.5 text-left text-body-md text-danger">
          <AlertTriangle size={16} /> You have {myOverdue} overdue task{myOverdue > 1 ? 's' : ''} in this project. <span className="font-semibold underline">Show them</span>
        </button>
      )}

      {/* Filters */}
      <div className={cn('flex flex-wrap items-center gap-2', view === 'reviews' && 'hidden')}>
        <div className="relative w-full sm:w-56">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input value={q} onChange={(e) => setParam('q', e.target.value || null)} placeholder="Search title or code" aria-label="Search tasks" className={cn(fieldCls, 'h-8 pl-8 text-body-sm')} />
        </div>
        <FilterSelect label="Assignee" value={assignee} onChange={(v) => setParam('assignee', v)} options={[{ v: 'me', l: 'Me' }, { v: 'none', l: 'Unassigned' }, ...data.members.map((m) => ({ v: m.id, l: m.name }))]} />
        <FilterSelect label="Priority" value={priority} onChange={(v) => setParam('priority', v)} options={PRIORITIES.map((p) => ({ v: p, l: PRIORITY_META[p].label }))} />
        {data.labels.length > 0 && <FilterSelect label="Label" value={label} onChange={(v) => setParam('label', v)} options={data.labels.map((l) => ({ v: l.id, l: l.name }))} />}
        <FilterSelect label="Due" value={due} onChange={(v) => setParam('due', v)} options={[{ v: 'overdue', l: 'Overdue' }, { v: 'today', l: 'Due today' }, { v: 'week', l: 'Due this week' }, { v: 'none', l: 'No due date' }]} />
        <label className={cn('inline-flex h-8 cursor-pointer items-center gap-2 rounded-btn border px-2.5 text-body-sm font-medium', mine ? 'border-primary bg-primary/5 text-primary' : 'border-line bg-card text-ink-muted')}>
          <input type="checkbox" checked={mine} onChange={(e) => setParam('mine', e.target.checked ? '1' : null)} className="h-3.5 w-3.5 accent-primary" /> Only my tasks
        </label>
        {filtersOn && (
          <button type="button" onClick={() => { const n = new URLSearchParams(); if (view === 'list') n.set('view', 'list'); setParams(n, { replace: true }) }} className="inline-flex h-8 items-center gap-1 px-1 text-body-sm text-ink-muted hover:text-ink"><X size={14} /> Clear</button>
        )}
        <span className="ml-auto text-body-sm text-ink-muted">{filtered.length} of {data.tasks.length} tasks</span>
      </div>

      {view === 'reviews' ? (
        <ReviewsView projectKey={project.key} refreshKey={data.tasks.map((t) => t.updatedAt).sort().at(-1) ?? ''} onOpen={(c) => setParam('task', c)} />
      ) : data.tasks.length === 0 && !creating ? (
        <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-line bg-card py-14 text-center">
          <p className="text-body-lg text-ink">No tasks yet</p>
          <p className="text-body-md text-ink-muted">{perms.canContribute ? 'Create the first task and assign it to someone on the team.' : 'Tasks will appear here when the team adds them.'}</p>
          {perms.canContribute && <Button size="sm" leadingIcon={<Plus size={16} />} onClick={() => setCreating(true)}>Create the first task</Button>}
        </div>
      ) : view === 'board' ? (
        <BoardView
          columns={data.columns}
          tasks={filtered}
          canMove={perms.canContribute && project.status === 'ACTIVE'}
          canManage={perms.canManage}
          onOpen={(c) => setParam('task', c)}
          onMoveTask={moveTask}
          onReorderColumns={reorderColumns}
          onQuickAdd={perms.canContribute && project.status === 'ACTIVE' && !filtersOn ? quickAdd : null}
          onDragState={(d) => { dragging.current = d }}
        />
      ) : (
        <ListView projectKey={project.key} tasks={filtered} columns={data.columns} members={data.members} canManage={perms.canManage} onOpen={(c) => setParam('task', c)} onChanged={() => load()} />
      )}

      {data.hiddenDoneCount > 0 || showOld ? (
        <button type="button" className="text-body-sm text-ink-muted underline hover:text-ink" onClick={() => setShowOld((s) => !s)}>
          {showOld ? 'Hide older completed tasks' : `Show ${data.hiddenDoneCount} completed task${data.hiddenDoneCount === 1 ? '' : 's'} older than 14 days`}
        </button>
      ) : null}

      {creating && (
        <CreateTaskModal projectKey={project.key} columns={data.columns} members={data.members} labels={data.labels} onClose={() => setCreating(false)} onCreated={upsert} onLabelCreated={addLabel} />
      )}
      {openCode && (
        <TaskDrawer
          code={openCode}
          columns={data.columns}
          members={data.members}
          labels={data.labels}
          meId={meId}
          onClose={() => setParam('task', null)}
          onChanged={upsert}
          onDeleted={(c) => { setData((d) => (d ? { ...d, tasks: d.tasks.filter((t) => t.code !== c) } : d)); setParam('task', null) }}
          onLabelCreated={addLabel}
        />
      )}
    </div>
  )
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string | null) => void; options: { v: string; l: string }[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value || null)}
      aria-label={label}
      className={cn('h-8 rounded-btn border bg-card px-2 text-body-sm font-medium focus:border-primary focus:outline-none', value ? 'border-primary text-primary' : 'border-line text-ink-muted')}
    >
      <option value="">{label}: All</option>
      {options.map((o) => <option key={o.v} value={o.v}>{label}: {o.l}</option>)}
    </select>
  )
}
