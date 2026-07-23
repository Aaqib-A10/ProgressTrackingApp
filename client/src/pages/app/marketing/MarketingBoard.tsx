import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core'
import { Plus, CalendarClock, CheckCircle2, MessageSquare, Trash2 } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { PillFilter } from '../../../components/ui/PillFilter'
import { Modal } from '../../../components/ui/Modal'
import { TextField } from '../../../components/ui/Input'
import { useToast } from '../../../components/ui/Toast'
import { MentionBox, highlightMentions, initials, fmtCommentTime, type Member } from '../../../components/MentionBox'
import {
  getBoard,
  createTask,
  updateTask,
  deleteTask,
  getTask,
  addTaskComment,
  DISCIPLINE_META,
  type MarketingTask,
  type TaskStatus,
  type TaskComment,
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

export default function MarketingBoard() {
  const { addToast } = useToast()
  const [tasks, setTasks] = useState<MarketingTask[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [filter, setFilter] = useState<'ALL' | Discipline>('ALL')
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [searchParams] = useSearchParams()
  // Deep-link: /app/marketing/board?task=<id> (e.g. from an @mention notification).
  const [detailId, setDetailId] = useState<string | null>(() => searchParams.get('task'))

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  useEffect(() => {
    getBoard()
      .then((res) => { setTasks(res.columns.flatMap((c) => c.tasks)); setMembers(res.members) })
      .catch(() => addToast({ type: 'error', message: 'Could not load board.' }))
      .finally(() => setLoading(false))
  }, [addToast])

  const visible = useMemo(
    () => (filter === 'ALL' ? tasks : tasks.filter((t) => t.discipline === filter)),
    [tasks, filter],
  )
  const upsertTask = (t: MarketingTask) => setTasks((ts) => (ts.some((x) => x.id === t.id) ? ts.map((x) => (x.id === t.id ? t : x)) : [...ts, t]))

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

  function remove(id: string) {
    const prev = tasks
    setTasks((ts) => ts.filter((t) => t.id !== id)); setDetailId(null)
    deleteTask(id).catch(() => { setTasks(prev); addToast({ type: 'error', message: 'Could not delete task.' }) })
  }

  if (loading) return <div className="p-2 text-body-md text-ink-muted">Loading…</div>
  const detailTask = tasks.find((t) => t.id === detailId) ?? null

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">Marketing Board</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">Click a card to open it, comment &amp; @mention the team · {visible.length} tasks</p>
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
            <Column key={col.status} status={col.status} label={col.label} tasks={visible.filter((t) => t.status === col.status)} onOpen={setDetailId} />
          ))}
        </div>
      </DndContext>

      <NewTaskModal open={modalOpen} members={members} onClose={() => setModalOpen(false)} onCreated={(t) => setTasks((ts) => [...ts, t])} />
      {detailTask && (
        <DetailModal
          task={detailTask}
          members={members}
          onClose={() => setDetailId(null)}
          onSaved={upsertTask}
          onDelete={remove}
          onCommentAdded={() => setTasks((ts) => ts.map((t) => (t.id === detailTask.id ? { ...t, commentCount: t.commentCount + 1 } : t)))}
        />
      )}
    </div>
  )
}

function Column({ status, label, tasks, onOpen }: { status: TaskStatus; label: string; tasks: MarketingTask[]; onOpen: (id: string) => void }) {
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
          <TaskCard key={t.id} task={t} onOpen={onOpen} />
        ))}
      </div>
    </div>
  )
}

function TaskCard({ task, onOpen }: { task: MarketingTask; onOpen: (id: string) => void }) {
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
      onClick={() => onOpen(task.id)}
      className={'cursor-pointer touch-none rounded-btn border border-line bg-card p-3 shadow-card transition-shadow hover:shadow-overlay active:cursor-grabbing ' + (isDragging ? 'opacity-60 shadow-overlay' : '')}
    >
      <div className="flex items-start gap-2">
        <span className="mt-1 h-full w-1 shrink-0 self-stretch rounded-full" style={{ backgroundColor: meta.color }} />
        <div className="min-w-0 flex-1">
          <p className="text-body-md font-medium text-ink">{task.title}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `${meta.color}1a`, color: meta.color }}>
              {meta.label}
            </span>
            {task.brand && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-ink-muted">{task.brand.name}</span>
            )}
            {dateChip && (
              <Badge tone={dateChip.tone} className="gap-1">
                {dateChip.icon}
                {dateChip.text}
              </Badge>
            )}
            {task.commentCount > 0 && (
              <span className="flex items-center gap-1 text-[11px] text-ink-muted"><MessageSquare size={12} />{task.commentCount}</span>
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

const fieldCls = 'h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'

function DetailModal({ task, members, onClose, onSaved, onDelete, onCommentAdded }: {
  task: MarketingTask
  members: Member[]
  onClose: () => void
  onSaved: (t: MarketingTask) => void
  onDelete: (id: string) => void
  onCommentAdded: () => void
}) {
  const { addToast } = useToast()
  const [comments, setComments] = useState<TaskComment[]>([])
  const [loadingC, setLoadingC] = useState(true)
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description)
  const [discipline, setDiscipline] = useState<Discipline>(task.discipline)
  const [assigneeId, setAssigneeId] = useState(task.assignee?.id ?? '')
  const [status, setStatus] = useState<TaskStatus>(task.status)
  const [dueDate, setDueDate] = useState(task.dueDate ?? '')
  const [scheduledDate, setScheduledDate] = useState(task.scheduledDate ?? '')
  const [saving, setSaving] = useState(false)

  const dirty =
    title !== task.title ||
    description !== task.description ||
    discipline !== task.discipline ||
    assigneeId !== (task.assignee?.id ?? '') ||
    status !== task.status ||
    dueDate !== (task.dueDate ?? '') ||
    scheduledDate !== (task.scheduledDate ?? '')

  useEffect(() => {
    setLoadingC(true)
    getTask(task.id).then((r) => setComments(r.comments)).catch(() => undefined).finally(() => setLoadingC(false))
  }, [task.id])

  async function save() {
    if (!title.trim()) return
    setSaving(true)
    try {
      const { task: saved } = await updateTask(task.id, {
        title: title.trim(),
        description: description.trim() || null,
        discipline,
        assigneeId: assigneeId || null,
        status,
        dueDate: dueDate || null,
        scheduledDate: scheduledDate || null,
      })
      onSaved(saved)
      addToast({ type: 'success', message: 'Task updated.' })
    } catch {
      addToast({ type: 'error', message: 'Could not save.' })
    } finally {
      setSaving(false)
    }
  }

  async function comment(body: string, mentions: string[], reset: () => void) {
    try {
      const { comment: c } = await addTaskComment(task.id, body, mentions)
      setComments((cs) => [...cs, c])
      onCommentAdded()
      reset()
    } catch {
      addToast({ type: 'error', message: 'Could not post comment.' })
    }
  }

  const meta = DISCIPLINE_META[discipline]

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Task"
      footer={
        <>
          <Button variant="danger" onClick={() => onDelete(task.id)} leadingIcon={<Trash2 size={16} />}>Delete</Button>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button onClick={save} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-3 rounded-card border border-line p-3">
          <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <div>
            <label className="mb-1 block text-body-sm font-semibold text-ink">Description</label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add detail, links, acceptance criteria…"
              className="w-full rounded-btn border border-line bg-card p-3 text-body-md text-ink placeholder:text-ink-muted focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-body-sm font-semibold text-ink">Discipline</label>
              <select value={discipline} onChange={(e) => setDiscipline(e.target.value as Discipline)} className={fieldCls}>
                <option value="SEO">SEO</option>
                <option value="SOCIAL">Social</option>
                <option value="CONTENT">Content</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-body-sm font-semibold text-ink">Assignee</label>
              <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={fieldCls}>
                <option value="">Unassigned</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-body-sm font-semibold text-ink">Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)} className={fieldCls}>
                {COLUMNS.map((c) => <option key={c.status} value={c.status}>{c.label}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-body-sm font-semibold text-ink">Due date</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={fieldCls} />
            </div>
            <div>
              <label className="mb-1 block text-body-sm font-semibold text-ink">Schedule for</label>
              <input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} className={fieldCls} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1 text-body-sm text-ink-muted">
            <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `${meta.color}1a`, color: meta.color }}>{meta.label}</span>
            {task.brand && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium">{task.brand.name}</span>}
            {task.publishedDate && <Badge tone="success" className="gap-1"><CheckCircle2 size={12} />Published {task.publishedDate}</Badge>}
          </div>
        </div>

        {/* Comments */}
        <div>
          <h3 className="mb-2 flex items-center gap-2 text-body-md font-semibold text-ink"><MessageSquare size={16} />Comments</h3>
          {loadingC ? (
            <p className="py-3 text-body-sm text-ink-muted">Loading…</p>
          ) : comments.length === 0 ? (
            <p className="py-3 text-body-sm text-ink-muted">No comments yet. Start the discussion — type @ to mention a teammate.</p>
          ) : (
            <ul className="max-h-64 space-y-3 overflow-y-auto pr-1">
              {comments.map((c) => (
                <li key={c.id} className="flex gap-2.5">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">{initials(c.author.name)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-body-sm font-semibold text-ink">{c.author.name}</span>
                      <span className="text-[11px] text-ink-muted">{fmtCommentTime(c.createdAt)}</span>
                    </div>
                    <p className="whitespace-pre-wrap break-words text-body-sm text-ink">{highlightMentions(c.body, c.mentions, members)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <MentionBox members={members} onSubmit={comment} />
        </div>
      </div>
    </Modal>
  )
}

function NewTaskModal({ open, members, onClose, onCreated }: { open: boolean; members: Member[]; onClose: () => void; onCreated: (t: MarketingTask) => void }) {
  const { addToast } = useToast()
  const [title, setTitle] = useState('')
  const [discipline, setDiscipline] = useState<Discipline>('SEO')
  const [assigneeId, setAssigneeId] = useState('')
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
        assigneeId: assigneeId || null,
        dueDate: dueDate || undefined,
        scheduledDate: scheduledDate || undefined,
        status: scheduledDate ? 'SCHEDULED' : undefined,
      })
      onCreated(task)
      addToast({ type: 'success', message: scheduledDate ? 'Task scheduled.' : 'Task added to Backlog.' })
      setTitle(''); setAssigneeId(''); setDueDate(''); setScheduledDate('')
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-body-sm font-semibold text-ink">Discipline</label>
            <select value={discipline} onChange={(e) => setDiscipline(e.target.value as Discipline)} className={fieldCls}>
              <option value="SEO">SEO</option>
              <option value="SOCIAL">Social</option>
              <option value="CONTENT">Content</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-body-sm font-semibold text-ink">Assignee</label>
            <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={fieldCls}>
              <option value="">Unassigned</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-body-sm font-semibold text-ink">Due date</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={fieldCls} />
          </div>
          <div>
            <label className="mb-1 block text-body-sm font-semibold text-ink">Schedule for</label>
            <input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} className={fieldCls} />
          </div>
        </div>
        <p className="text-body-sm text-ink-muted">
          Setting a schedule date moves the task straight to the <span className="font-medium text-ink">Scheduled</span> column.
        </p>
      </form>
    </Modal>
  )
}
