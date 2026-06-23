import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core'
import { Plus, CalendarClock, CheckCircle2 } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { PillFilter } from '../../../components/ui/PillFilter'
import { Modal } from '../../../components/ui/Modal'
import { TextField } from '../../../components/ui/Input'
import { useToast } from '../../../components/ui/Toast'
import {
  getBoard,
  createTask,
  updateTask,
  DISCIPLINE_META,
  type MarketingTask,
  type TaskStatus,
  type Discipline,
} from '../../../lib/marketingApi'

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'BACKLOG', label: 'Backlog' },
  { status: 'IN_PROGRESS', label: 'In Progress' },
  { status: 'IN_REVIEW', label: 'In Review' },
  { status: 'SCHEDULED', label: 'Scheduled' },
  { status: 'PUBLISHED', label: 'Published' },
]

const FILTERS = [
  { value: 'ALL', label: 'All' },
  { value: 'SEO', label: 'SEO' },
  { value: 'SOCIAL', label: 'Social' },
  { value: 'CONTENT', label: 'Content' },
] as const

function initials(name: string) {
  return name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()
}

export default function MarketingBoard() {
  const { addToast } = useToast()
  const [tasks, setTasks] = useState<MarketingTask[]>([])
  const [filter, setFilter] = useState<'ALL' | Discipline>('ALL')
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  useEffect(() => {
    getBoard()
      .then((res) => setTasks(res.columns.flatMap((c) => c.tasks)))
      .catch(() => addToast({ type: 'error', message: 'Could not load board.' }))
      .finally(() => setLoading(false))
  }, [addToast])

  const visible = useMemo(
    () => (filter === 'ALL' ? tasks : tasks.filter((t) => t.discipline === filter)),
    [tasks, filter],
  )

  function onDragEnd(e: DragEndEvent) {
    const taskId = String(e.active.id)
    const newStatus = e.over?.id as TaskStatus | undefined
    if (!newStatus) return
    const task = tasks.find((t) => t.id === taskId)
    if (!task || task.status === newStatus) return

    const prev = tasks
    setTasks((ts) => ts.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t))) // optimistic
    updateTask(taskId, { status: newStatus })
      .then((res) => setTasks((ts) => ts.map((t) => (t.id === taskId ? res.task : t))))
      .catch(() => {
        setTasks(prev) // revert
        addToast({ type: 'error', message: 'Could not move task.' })
      })
  }

  if (loading) return <div className="p-2 text-body-md text-ink-muted">Loading…</div>

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">Marketing Board</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">Drag cards across the pipeline · {visible.length} tasks</p>
        </div>
        <div className="flex items-center gap-3">
          <PillFilter options={FILTERS as never} value={filter} onChange={setFilter} size="sm" />
          <Button size="sm" leadingIcon={<Plus size={16} />} onClick={() => setModalOpen(true)}>
            New Task
          </Button>
        </div>
      </div>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          {COLUMNS.map((col) => (
            <Column key={col.status} status={col.status} label={col.label} tasks={visible.filter((t) => t.status === col.status)} />
          ))}
        </div>
      </DndContext>

      <NewTaskModal open={modalOpen} onClose={() => setModalOpen(false)} onCreated={(t) => setTasks((ts) => [...ts, t])} />
    </div>
  )
}

function Column({ status, label, tasks }: { status: TaskStatus; label: string; tasks: MarketingTask[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  return (
    <div
      ref={setNodeRef}
      className={'flex flex-col rounded-card border bg-bg/60 p-2 transition-colors ' + (isOver ? 'border-primary/40 bg-primary/5' : 'border-line')}
    >
      <div className="flex items-center justify-between px-2 py-1.5">
        <span className="text-label-md uppercase text-ink-muted">{label}</span>
        <span className="rounded-full bg-slate-200 px-2 text-body-sm font-semibold text-ink-muted">{tasks.length}</span>
      </div>
      <div className="flex min-h-[120px] flex-col gap-2 p-1">
        {tasks.map((t) => (
          <TaskCard key={t.id} task={t} />
        ))}
      </div>
    </div>
  )
}

function TaskCard({ task }: { task: MarketingTask }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id })
  const meta = DISCIPLINE_META[task.discipline]
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 }
    : undefined

  const dateChip =
    task.publishedDate
      ? { icon: <CheckCircle2 size={12} />, text: task.publishedDate, tone: 'success' as const }
      : task.scheduledDate
        ? { icon: <CalendarClock size={12} />, text: task.scheduledDate, tone: 'primary' as const }
        : task.dueDate
          ? { icon: <CalendarClock size={12} />, text: `Due ${task.dueDate}`, tone: 'warning' as const }
          : null

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={'cursor-grab touch-none rounded-btn border border-line bg-card p-3 shadow-card active:cursor-grabbing ' + (isDragging ? 'opacity-60 shadow-overlay' : '')}
    >
      <div className="flex items-start gap-2">
        <span className="mt-1 h-full w-1 shrink-0 self-stretch rounded-full" style={{ backgroundColor: meta.color }} />
        <div className="min-w-0 flex-1">
          <p className="text-body-md font-medium text-ink">{task.title}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `${meta.color}1a`, color: meta.color }}>
              {meta.label}
            </span>
            {dateChip && (
              <Badge tone={dateChip.tone} className="gap-1">
                {dateChip.icon}
                {dateChip.text}
              </Badge>
            )}
            {task.assignee && (
              <span className="ml-auto flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary" title={task.assignee.name}>
                {initials(task.assignee.name)}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function NewTaskModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (t: MarketingTask) => void }) {
  const { addToast } = useToast()
  const [title, setTitle] = useState('')
  const [discipline, setDiscipline] = useState<Discipline>('SEO')
  const [dueDate, setDueDate] = useState('')
  const [scheduledDate, setScheduledDate] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSubmitting(true)
    try {
      const { task } = await createTask({
        title,
        discipline,
        dueDate: dueDate || undefined,
        scheduledDate: scheduledDate || undefined,
        status: scheduledDate ? 'SCHEDULED' : undefined,
      })
      onCreated(task)
      addToast({ type: 'success', message: scheduledDate ? 'Task scheduled.' : 'Task added to Backlog.' })
      setTitle(''); setDueDate(''); setScheduledDate('')
      onClose()
    } catch {
      addToast({ type: 'error', message: 'Could not create task.' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Task"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting}>{submitting ? 'Adding…' : 'Add Task'}</Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <TextField label="Title" placeholder="What needs doing?" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        <div>
          <label className="mb-1 block text-body-sm font-semibold text-ink">Discipline</label>
          <select
            value={discipline}
            onChange={(e) => setDiscipline(e.target.value as Discipline)}
            className="h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10"
          >
            <option value="SEO">SEO</option>
            <option value="SOCIAL">Social</option>
            <option value="CONTENT">Content</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-body-sm font-semibold text-ink">Due date</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10"
            />
          </div>
          <div>
            <label className="mb-1 block text-body-sm font-semibold text-ink">Schedule for</label>
            <input
              type="date"
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
              className="h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10"
            />
          </div>
        </div>
        <p className="text-body-sm text-ink-muted">
          Setting a schedule date moves the task straight to the <span className="font-medium text-ink">Scheduled</span> column.
        </p>
      </form>
    </Modal>
  )
}
