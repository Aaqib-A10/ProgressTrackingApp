import { useEffect, useState, type FormEvent } from 'react'
import { DndContext, PointerSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent } from '@dnd-kit/core'
import { Plus, CalendarClock, Trash2, Pencil } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { Modal } from '../../../components/ui/Modal'
import { TextField } from '../../../components/ui/Input'
import { useToast } from '../../../components/ui/Toast'
import { useAuth } from '../../../lib/auth'
import {
  getEcommerceBoard, createEcommerceTask, updateEcommerceTask, deleteEcommerceTask,
  type EcomTask, type EcomTaskStatus, type BoardResponse,
} from '../../../lib/ecommerceApi'

const COLUMNS: { status: EcomTaskStatus; label: string }[] = [
  { status: 'TODO', label: 'To Do' },
  { status: 'IN_PROGRESS', label: 'In Progress' },
  { status: 'DONE', label: 'Done' },
]
const STATUS_LABEL: Record<EcomTaskStatus, string> = { TODO: 'To Do', IN_PROGRESS: 'In Progress', DONE: 'Done' }
const initials = (n: string) => n.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()

export default function EcommerceBoard() {
  const { user } = useAuth()
  const { addToast } = useToast()
  const isHod = user?.role === 'SUPER_ADMIN' || (user?.role === 'TEAM_LEAD' && user?.department === 'ECOMMERCE')
  const [tasks, setTasks] = useState<EcomTask[]>([])
  const [members, setMembers] = useState<BoardResponse['members']>([])
  const [loading, setLoading] = useState(true)
  const [modalTask, setModalTask] = useState<EcomTask | null | 'new'>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  useEffect(() => {
    getEcommerceBoard()
      .then((res) => { setTasks(res.columns.flatMap((c) => c.tasks)); setMembers(res.members) })
      .catch(() => addToast({ type: 'error', message: 'Could not load board.' }))
      .finally(() => setLoading(false))
  }, [addToast])

  const canMove = (t: EcomTask) => isHod || t.assignee?.id === user?.id

  function setStatus(taskId: string, status: EcomTaskStatus) {
    const prev = tasks
    setTasks((ts) => ts.map((t) => (t.id === taskId ? { ...t, status } : t)))
    updateEcommerceTask(taskId, { status })
      .then((res) => setTasks((ts) => ts.map((t) => (t.id === taskId ? res.task : t))))
      .catch(() => { setTasks(prev); addToast({ type: 'error', message: 'Could not update the task.' }) })
  }

  function onDragEnd(e: DragEndEvent) {
    const taskId = String(e.active.id)
    const newStatus = e.over?.id as EcomTaskStatus | undefined
    const task = tasks.find((t) => t.id === taskId)
    if (!newStatus || !task || task.status === newStatus) return
    setStatus(taskId, newStatus)
  }

  function remove(id: string) {
    const prev = tasks
    setTasks((ts) => ts.filter((t) => t.id !== id))
    deleteEcommerceTask(id).catch(() => { setTasks(prev); addToast({ type: 'error', message: 'Could not delete task.' }) })
  }

  function onSaved(t: EcomTask) {
    setTasks((ts) => (ts.some((x) => x.id === t.id) ? ts.map((x) => (x.id === t.id ? t : x)) : [...ts, t]))
  }

  if (loading) return <div className="p-2 text-body-md text-ink-muted">Loading…</div>

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">Ecommerce Task Board</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">{isHod ? 'Assign tasks and track progress' : 'Move your tasks across the board'} · {tasks.length} tasks</p>
        </div>
        {isHod && <Button size="sm" leadingIcon={<Plus size={16} />} onClick={() => setModalTask('new')}>New Task</Button>}
      </div>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {COLUMNS.map((col) => (
            <Column key={col.status} status={col.status} label={col.label} tasks={tasks.filter((t) => t.status === col.status)}
              canMove={canMove} isHod={isHod} onDelete={remove} onEdit={(t) => setModalTask(t)} onStatus={setStatus} />
          ))}
        </div>
      </DndContext>

      {modalTask !== null && (
        <TaskModal task={modalTask === 'new' ? null : modalTask} members={members} onClose={() => setModalTask(null)} onSaved={onSaved} />
      )}
    </div>
  )
}

function Column({ status, label, tasks, canMove, isHod, onDelete, onEdit, onStatus }: {
  status: EcomTaskStatus; label: string; tasks: EcomTask[]; canMove: (t: EcomTask) => boolean; isHod: boolean
  onDelete: (id: string) => void; onEdit: (t: EcomTask) => void; onStatus: (id: string, s: EcomTaskStatus) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  return (
    <div ref={setNodeRef} className={'flex flex-col rounded-card border bg-bg/60 p-2 transition-colors ' + (isOver ? 'border-primary/40 bg-primary/5' : 'border-line')}>
      <div className="flex items-center justify-between px-2 py-1.5">
        <span className="text-label-md uppercase text-ink-muted">{label}</span>
        <span className="rounded-full bg-slate-200 px-2 text-body-sm font-semibold text-ink-muted">{tasks.length}</span>
      </div>
      <div className="flex min-h-[140px] flex-col gap-2 p-1">
        {tasks.map((t) => <TaskCard key={t.id} task={t} movable={canMove(t)} isHod={isHod} onDelete={onDelete} onEdit={onEdit} onStatus={onStatus} />)}
      </div>
    </div>
  )
}

function TaskCard({ task, movable, isHod, onDelete, onEdit, onStatus }: {
  task: EcomTask; movable: boolean; isHod: boolean
  onDelete: (id: string) => void; onEdit: (t: EcomTask) => void; onStatus: (id: string, s: EcomTaskStatus) => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id, disabled: !movable })
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 } : undefined
  // Keep clicks on the controls below from starting a drag.
  const stop = { onPointerDown: (e: { stopPropagation(): void }) => e.stopPropagation() }
  return (
    <div ref={setNodeRef} style={style} {...(movable ? listeners : {})} {...attributes}
      className={'rounded-btn border border-line bg-card p-3 shadow-card ' + (movable ? 'cursor-grab touch-none active:cursor-grabbing ' : '') + (isDragging ? 'opacity-60 shadow-overlay' : '')}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-body-md font-medium text-ink">{task.title}</p>
        {isHod && (
          <div className="flex shrink-0 items-center gap-1" {...stop}>
            <button onClick={() => onEdit(task)} className="text-ink-muted hover:text-primary" aria-label="Edit task"><Pencil size={14} /></button>
            <button onClick={() => onDelete(task.id)} className="text-ink-muted hover:text-danger" aria-label="Delete task"><Trash2 size={14} /></button>
          </div>
        )}
      </div>
      {task.description && <p className="mt-1 text-body-sm text-ink-muted">{task.description}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {task.source && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-ink-muted">From: {task.source}</span>}
        {task.dueDate && <Badge tone="warning" className="gap-1"><CalendarClock size={12} />Due {task.dueDate}</Badge>}
        {task.assignee && (
          <span className="ml-auto flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary" title={task.assignee.name}>{initials(task.assignee.name)}</span>
        )}
      </div>
      {movable && (
        <div className="mt-2.5 border-t border-line pt-2" {...stop}>
          <label className="flex items-center gap-2 text-label-md uppercase text-ink-muted">
            Status
            <select value={task.status} onChange={(e) => onStatus(task.id, e.target.value as EcomTaskStatus)}
              className="h-8 flex-1 rounded-btn border border-line bg-bg px-2 text-body-sm text-ink focus:border-primary focus:outline-none">
              {COLUMNS.map((c) => <option key={c.status} value={c.status}>{STATUS_LABEL[c.status]}</option>)}
            </select>
          </label>
        </div>
      )}
    </div>
  )
}

function TaskModal({ task, members, onClose, onSaved }: { task: EcomTask | null; members: BoardResponse['members']; onClose: () => void; onSaved: (t: EcomTask) => void }) {
  const { addToast } = useToast()
  const editing = !!task
  const [title, setTitle] = useState(task?.title ?? '')
  const [source, setSource] = useState(task?.source ?? '')
  const [assignedToId, setAssignedToId] = useState(task?.assignee?.id ?? '')
  const [dueDate, setDueDate] = useState(task?.dueDate ?? '')
  const [status, setStatus] = useState<EcomTaskStatus>(task?.status ?? 'TODO')
  const [submitting, setSubmitting] = useState(false)
  const inputCls = 'h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSubmitting(true)
    try {
      if (editing && task) {
        const { task: saved } = await updateEcommerceTask(task.id, { title, source: source || null, assignedToId: assignedToId || null, dueDate: dueDate || null, status })
        onSaved(saved); addToast({ type: 'success', message: 'Task updated.' })
      } else {
        const { task: saved } = await createEcommerceTask({ title, source: source || undefined, assignedToId: assignedToId || null, dueDate: dueDate || null })
        onSaved(saved); addToast({ type: 'success', message: 'Task created.' })
      }
      onClose()
    } catch {
      addToast({ type: 'error', message: 'Could not save the task.' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={editing ? 'Edit Task' : 'New Task'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={submitting}>{submitting ? 'Saving…' : editing ? 'Save' : 'Add Task'}</Button></>}>
      <form onSubmit={submit} className="space-y-4">
        <TextField label="Title" placeholder="What needs doing?" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        <TextField label="From (source)" placeholder="Who/where it came from" value={source} onChange={(e) => setSource(e.target.value)} />
        <div>
          <label className="mb-1 block text-body-sm font-semibold text-ink">Assign to</label>
          <select value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)} className={inputCls}>
            <option value="">Unassigned</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-body-sm font-semibold text-ink">Due date</label>
            <input type="date" value={dueDate ?? ''} onChange={(e) => setDueDate(e.target.value)} className={inputCls} />
          </div>
          {editing && (
            <div>
              <label className="mb-1 block text-body-sm font-semibold text-ink">Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as EcomTaskStatus)} className={inputCls}>
                {COLUMNS.map((c) => <option key={c.status} value={c.status}>{STATUS_LABEL[c.status]}</option>)}
              </select>
            </div>
          )}
        </div>
      </form>
    </Modal>
  )
}
