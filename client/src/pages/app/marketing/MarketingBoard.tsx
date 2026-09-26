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
import { Plus, CalendarClock, CheckCircle2, MessageSquare, Trash2, Rows3, Columns3, Users, Paperclip, Upload, X, Download } from 'lucide-react'
import { Link } from 'react-router-dom'
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
  uploadTaskAttachment,
  deleteTaskAttachment,
  DISCIPLINE_META,
  PRIORITY_META,
  PRIORITY_ORDER,
  type MarketingTask,
  type TaskStatus,
  type TaskComment,
  type TaskAttachment,
  type Discipline,
  type Priority,
  type BoardViewer,
} from '../../../lib/marketingApi'

/** ISO instant → the value a datetime-local input expects (local tz). */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
const localInputToIso = (v: string): string | null => (v ? new Date(v).toISOString() : null)
/** "Sep 26, 3:00 PM" from an ISO instant. */
function fmtDueAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`)

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

// Swimlane order when grouping by discipline.
const DISCIPLINE_ORDER: Discipline[] = ['SOCIAL', 'CONTENT', 'SEO']

/** Small priority chip for cards + forms. */
function PriorityBadge({ priority }: { priority: Priority }) {
  const m = PRIORITY_META[priority]
  return <Badge tone={m.tone} dot>{m.label}</Badge>
}

export default function MarketingBoard() {
  const { addToast } = useToast()
  const [tasks, setTasks] = useState<MarketingTask[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [viewer, setViewer] = useState<BoardViewer | null>(null)
  const [filter, setFilter] = useState<'ALL' | Discipline>('ALL')
  const [groupBy, setGroupBy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [searchParams] = useSearchParams()
  // Deep-link: /app/marketing/board?task=<id> (e.g. from an @mention notification).
  const [detailId, setDetailId] = useState<string | null>(() => searchParams.get('task'))

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  useEffect(() => {
    getBoard()
      .then((res) => { setTasks(res.columns.flatMap((c) => c.tasks)); setMembers(res.members); setViewer(res.viewer) })
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
    const over = e.over?.id ? String(e.over.id) : undefined
    if (!over) return
    // Droppable id is `status` (single board) or `discipline:status` (swimlanes).
    const [maybeDisc, maybeStatus] = over.includes(':') ? over.split(':') : [undefined, over]
    const newStatus = maybeStatus as TaskStatus
    const newDiscipline = maybeDisc as Discipline | undefined
    const task = tasks.find((t) => t.id === taskId)
    if (!task) return
    if (task.status === newStatus && (!newDiscipline || task.discipline === newDiscipline)) return

    const patch = { status: newStatus, ...(newDiscipline && newDiscipline !== task.discipline ? { discipline: newDiscipline } : {}) }
    const prev = tasks
    setTasks((ts) => ts.map((t) => (t.id === taskId ? { ...t, ...patch } : t))) // optimistic
    updateTask(taskId, patch)
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
          <p className="mt-0.5 text-body-md text-ink-muted">
            {viewer && !viewer.isLead
              ? <>Your assigned tasks · {visible.length} {visible.length === 1 ? 'task' : 'tasks'}</>
              : <>Click a card to open it, comment &amp; @mention the team · {visible.length} tasks</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PillFilter options={FILTERS as never} value={filter} onChange={setFilter} size="sm" />
          <button
            type="button"
            onClick={() => setGroupBy((v) => !v)}
            aria-pressed={groupBy}
            title={groupBy ? 'Show one board' : 'Group into discipline swimlanes'}
            className={'inline-flex h-8 items-center gap-1.5 rounded-btn border px-3 text-body-sm font-semibold transition-colors ' + (groupBy ? 'border-primary bg-primary text-white' : 'border-line bg-card text-ink-muted hover:border-primary/40')}
          >
            {groupBy ? <Rows3 size={15} /> : <Columns3 size={15} />} {groupBy ? 'Swimlanes' : 'Group'}
          </button>
          {viewer?.isLead && (
            <Link to="/app/marketing/team" className="inline-flex h-8 items-center gap-1.5 rounded-btn border border-line bg-card px-3 text-body-sm font-semibold text-ink-muted hover:border-primary/40 hover:text-ink">
              <Users size={15} /> Team
            </Link>
          )}
          <Button size="sm" leadingIcon={<Plus size={16} />} onClick={() => setModalOpen(true)}>
            New Task
          </Button>
        </div>
      </div>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        {groupBy ? (
          <div className="space-y-6">
            {(filter === 'ALL' ? DISCIPLINE_ORDER : [filter]).map((disc) => {
              const laneTasks = visible.filter((t) => t.discipline === disc)
              const meta = DISCIPLINE_META[disc]
              return (
                <section key={disc}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: meta.color }} />
                    <h2 className="text-body-md font-semibold text-ink">{meta.label}</h2>
                    <span className="rounded-full bg-slate-200 px-2 text-body-sm font-semibold text-ink-muted">{laneTasks.length}</span>
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
                    {COLUMNS.map((col) => (
                      <Column key={`${disc}:${col.status}`} dropId={`${disc}:${col.status}`} label={col.label} tasks={laneTasks.filter((t) => t.status === col.status)} onOpen={setDetailId} />
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            {COLUMNS.map((col) => (
              <Column key={col.status} dropId={col.status} label={col.label} tasks={visible.filter((t) => t.status === col.status)} onOpen={setDetailId} />
            ))}
          </div>
        )}
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
          onAttachmentDelta={(d) => setTasks((ts) => ts.map((t) => (t.id === detailTask.id ? { ...t, attachmentCount: Math.max(0, t.attachmentCount + d) } : t)))}
        />
      )}
    </div>
  )
}

function Column({ dropId, label, tasks, onOpen }: { dropId: string; label: string; tasks: MarketingTask[]; onOpen: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId })
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
        : task.dueAt
          ? { icon: <CalendarClock size={12} />, text: `Due ${fmtDueAt(task.dueAt)}`, tone: 'warning' as const }
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
          <p className="line-clamp-3 break-words text-body-md font-medium text-ink" title={task.title}>{task.title}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <PriorityBadge priority={task.priority} />
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
            {task.attachmentCount > 0 && (
              <span className="flex items-center gap-1 text-[11px] text-ink-muted"><Paperclip size={12} />{task.attachmentCount}</span>
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

function DetailModal({ task, members, onClose, onSaved, onDelete, onCommentAdded, onAttachmentDelta }: {
  task: MarketingTask
  members: Member[]
  onClose: () => void
  onSaved: (t: MarketingTask) => void
  onDelete: (id: string) => void
  onCommentAdded: () => void
  onAttachmentDelta: (delta: number) => void
}) {
  const { addToast } = useToast()
  const [comments, setComments] = useState<TaskComment[]>([])
  const [attachments, setAttachments] = useState<TaskAttachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [loadingC, setLoadingC] = useState(true)
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description)
  const [discipline, setDiscipline] = useState<Discipline>(task.discipline)
  const [priority, setPriority] = useState<Priority>(task.priority)
  const [assigneeId, setAssigneeId] = useState(task.assignee?.id ?? '')
  const [status, setStatus] = useState<TaskStatus>(task.status)
  const [dueAt, setDueAt] = useState(toLocalInput(task.dueAt))
  const [scheduledDate, setScheduledDate] = useState(task.scheduledDate ?? '')
  const [saving, setSaving] = useState(false)

  const dirty =
    title !== task.title ||
    description !== task.description ||
    discipline !== task.discipline ||
    priority !== task.priority ||
    assigneeId !== (task.assignee?.id ?? '') ||
    status !== task.status ||
    dueAt !== toLocalInput(task.dueAt) ||
    scheduledDate !== (task.scheduledDate ?? '')

  useEffect(() => {
    setLoadingC(true)
    getTask(task.id).then((r) => { setComments(r.comments); setAttachments(r.attachments) }).catch(() => undefined).finally(() => setLoadingC(false))
  }, [task.id])

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const { attachment } = await uploadTaskAttachment(task.id, file)
        setAttachments((a) => [...a, attachment])
        onAttachmentDelta(1)
      }
    } catch {
      addToast({ type: 'error', message: 'Could not upload file (max 25 MB; executables blocked).' })
    } finally {
      setUploading(false)
    }
  }
  async function removeAttachment(id: string) {
    const prev = attachments
    setAttachments((a) => a.filter((x) => x.id !== id)); onAttachmentDelta(-1)
    try { await deleteTaskAttachment(id) }
    catch { setAttachments(prev); onAttachmentDelta(1); addToast({ type: 'error', message: 'Could not delete file.' }) }
  }

  async function save() {
    if (!title.trim()) return
    setSaving(true)
    try {
      const { task: saved } = await updateTask(task.id, {
        title: title.trim(),
        description: description.trim() || null,
        discipline,
        priority,
        assigneeId: assigneeId || null,
        status,
        dueAt: localInputToIso(dueAt),
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-body-sm font-semibold text-ink">Priority</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className={fieldCls}>
                {PRIORITY_ORDER.map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
              </select>
            </div>
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
              <label className="mb-1 block text-body-sm font-semibold text-ink">Due (date &amp; time)</label>
              <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className={fieldCls} />
              <span className="mt-1 block text-body-sm text-ink-muted">Urgent tasks get a reminder 1h before this.</span>
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

        {/* Attachments */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-body-md font-semibold text-ink"><Paperclip size={16} />Attachments</h3>
            <label className={'inline-flex cursor-pointer items-center gap-1.5 rounded-btn border border-line bg-card px-3 py-1.5 text-body-sm font-semibold text-ink-muted hover:border-primary/40 hover:text-ink ' + (uploading ? 'pointer-events-none opacity-60' : '')}>
              <Upload size={14} /> {uploading ? 'Uploading…' : 'Upload'}
              <input type="file" multiple className="hidden" onChange={(e) => { onFiles(e.target.files); e.target.value = '' }} />
            </label>
          </div>
          {attachments.length === 0 ? (
            <p className="py-2 text-body-sm text-ink-muted">No files yet. Upload images, PDFs, docs (max 25 MB).</p>
          ) : (
            <ul className="space-y-1.5">
              {attachments.map((a) => (
                <li key={a.id} className="flex items-center gap-2 rounded-btn border border-line bg-bg px-3 py-2">
                  <Paperclip size={14} className="shrink-0 text-ink-muted" />
                  <a href={a.downloadUrl} className="min-w-0 flex-1 truncate text-body-sm text-primary hover:underline" title={a.originalName}>{a.originalName}</a>
                  <span className="shrink-0 text-[11px] text-ink-muted">{fmtBytes(a.size)}</span>
                  <a href={a.downloadUrl} className="shrink-0 rounded p-1 text-ink-muted hover:text-primary" title="Download"><Download size={14} /></a>
                  <button onClick={() => removeAttachment(a.id)} className="shrink-0 rounded p-1 text-ink-muted hover:text-danger" title="Remove"><X size={14} /></button>
                </li>
              ))}
            </ul>
          )}
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
  const [priority, setPriority] = useState<Priority>('MEDIUM')
  const [assigneeId, setAssigneeId] = useState('')
  const [dueAt, setDueAt] = useState('')
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
        priority,
        assigneeId: assigneeId || null,
        dueAt: localInputToIso(dueAt),
        scheduledDate: scheduledDate || undefined,
        status: scheduledDate ? 'SCHEDULED' : undefined,
      })
      onCreated(task)
      addToast({ type: 'success', message: scheduledDate ? 'Task scheduled.' : 'Task added to Backlog.' })
      setTitle(''); setPriority('MEDIUM'); setAssigneeId(''); setDueAt(''); setScheduledDate('')
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-body-sm font-semibold text-ink">Priority</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className={fieldCls}>
              {PRIORITY_ORDER.map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
            </select>
          </div>
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
            <label className="mb-1 block text-body-sm font-semibold text-ink">Due (date &amp; time)</label>
            <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className={fieldCls} />
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
