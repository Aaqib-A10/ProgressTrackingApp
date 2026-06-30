import { useEffect, useState, type FormEvent } from 'react'
import { DndContext, PointerSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent } from '@dnd-kit/core'
import { Plus, CalendarClock, Trash2 } from 'lucide-react'
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
const initials = (n: string) => n.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()

export default function EcommerceBoard() {
  const { user } = useAuth()
  const { addToast } = useToast()
  const isHod = user?.role === 'SUPER_ADMIN' || (user?.role === 'TEAM_LEAD' && user?.department === 'ECOMMERCE')
  const [tasks, setTasks] = useState<EcomTask[]>([])
  const [members, setMembers] = useState<BoardResponse['members']>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  useEffect(() => {
    getEcommerceBoard()
      .then((res) => { setTasks(res.columns.flatMap((c) => c.tasks)); setMembers(res.members) })
      .catch(() => addToast({ type: 'error', message: 'Could not load board.' }))
      .finally(() => setLoading(false))
  }, [addToast])

  const canMove = (t: EcomTask) => isHod || t.assignee?.id === user?.id

  function onDragEnd(e: DragEndEvent) {
    const taskId = String(e.active.id)
    const newStatus = e.over?.id as EcomTaskStatus | undefined
    if (!newStatus) return
    const task = tasks.find((t) => t.id === taskId)
    if (!task || task.status === newStatus) return
    const prev = tasks
    setTasks((ts) => ts.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t)))
    updateEcommerceTask(taskId, { status: newStatus })
      .then((res) => setTasks((ts) => ts.map((t) => (t.id === taskId ? res.task : t))))
      .catch(() => { setTasks(prev); addToast({ type: 'error', message: 'Could not move task.' }) })
  }

  function remove(id: string) {
    const prev = tasks
    setTasks((ts) => ts.filter((t) => t.id !== id))
    deleteEcommerceTask(id).catch(() => { setTasks(prev); addToast({ type: 'error', message: 'Could not delete task.' }) })
  }

  if (loading) return <div className="p-2 text-body-md text-ink-muted">Loading…</div>

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">Ecommerce Task Board</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">{isHod ? 'Assign tasks and track progress' : 'Drag your tasks across the board'} · {tasks.length} tasks</p>
        </div>
        {isHod && <Button size="sm" leadingIcon={<Plus size={16} />} onClick={() => setModalOpen(true)}>New Task</Button>}
      </div>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {COLUMNS.map((col) => (
            <Column key={col.status} status={col.status} label={col.label} tasks={tasks.filter((t) => t.status === col.status)} canMove={canMove} isHod={isHod} onDelete={remove} />
          ))}
        </div>
      </DndContext>

      {isHod && <NewTaskModal open={modalOpen} onClose={() => setModalOpen(false)} members={members} onCreated={(t) => setTasks((ts) => [...ts, t])} />}
    </div>
  )
}

function Column({ status, label, tasks, canMove, isHod, onDelete }: { status: EcomTaskStatus; label: string; tasks: EcomTask[]; canMove: (t: EcomTask) => boolean; isHod: boolean; onDelete: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  return (
    <div ref={setNodeRef} className={'flex flex-col rounded-card border bg-bg/60 p-2 transition-colors ' + (isOver ? 'border-primary/40 bg-primary/5' : 'border-line')}>
      <div className="flex items-center justify-between px-2 py-1.5">
        <span className="text-label-md uppercase text-ink-muted">{label}</span>
        <span className="rounded-full bg-slate-200 px-2 text-body-sm font-semibold text-ink-muted">{tasks.length}</span>
      </div>
      <div className="flex min-h-[140px] flex-col gap-2 p-1">
        {tasks.map((t) => <TaskCard key={t.id} task={t} draggable={canMove(t)} isHod={isHod} onDelete={onDelete} />)}
      </div>
    </div>
  )
}

function TaskCard({ task, draggable, isHod, onDelete }: { task: EcomTask; draggable: boolean; isHod: boolean; onDelete: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id, disabled: !draggable })
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 } : undefined
  return (
    <div ref={setNodeRef} style={style} {...(draggable ? listeners : {})} {...attributes}
      className={'rounded-btn border border-line bg-card p-3 shadow-card ' + (draggable ? 'cursor-grab touch-none active:cursor-grabbing ' : '') + (isDragging ? 'opacity-60 shadow-overlay' : '')}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-body-md font-medium text-ink">{task.title}</p>
        {isHod && (
          <button onClick={() => onDelete(task.id)} className="shrink-0 text-ink-muted hover:text-danger" aria-label="Delete task"><Trash2 size={14} /></button>
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
    </div>
  )
}

function NewTaskModal({ open, onClose, members, onCreated }: { open: boolean; onClose: () => void; members: BoardResponse['members']; onCreated: (t: EcomTask) => void }) {
  const { addToast } = useToast()
  const [title, setTitle] = useState('')
  const [source, setSource] = useState('')
  const [assignedToId, setAssignedToId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const inputCls = 'h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSubmitting(true)
    try {
      const { task } = await createEcommerceTask({ title, source: source || undefined, assignedToId: assignedToId || null, dueDate: dueDate || null })
      onCreated(task)
      addToast({ type: 'success', message: 'Task created.' })
      setTitle(''); setSource(''); setAssignedToId(''); setDueDate('')
      onClose()
    } catch {
      addToast({ type: 'error', message: 'Could not create task.' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New Task"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={submitting}>{submitting ? 'Adding…' : 'Add Task'}</Button></>}>
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
        <div>
          <label className="mb-1 block text-body-sm font-semibold text-ink">Due date</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} />
        </div>
      </form>
    </Modal>
  )
}
