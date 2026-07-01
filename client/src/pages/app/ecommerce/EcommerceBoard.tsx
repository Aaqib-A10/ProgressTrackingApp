import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { DndContext, PointerSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent } from '@dnd-kit/core'
import { Plus, CalendarClock, Trash2, MessageSquare, Send } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { Modal } from '../../../components/ui/Modal'
import { TextField } from '../../../components/ui/Input'
import { useToast } from '../../../components/ui/Toast'
import { useAuth } from '../../../lib/auth'
import {
  getEcommerceBoard, createEcommerceTask, updateEcommerceTask, deleteEcommerceTask, getEcommerceTask, addTaskComment,
  type EcomTask, type EcomTaskStatus, type TaskComment,
} from '../../../lib/ecommerceApi'

type Member = { id: string; name: string }
const COLUMNS: { status: EcomTaskStatus; label: string }[] = [
  { status: 'TODO', label: 'To Do' },
  { status: 'IN_PROGRESS', label: 'In Progress' },
  { status: 'DONE', label: 'Done' },
]
const STATUS_LABEL: Record<EcomTaskStatus, string> = { TODO: 'To Do', IN_PROGRESS: 'In Progress', DONE: 'Done' }
const initials = (n: string) => n.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()
const fmtTime = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export default function EcommerceBoard() {
  const { user } = useAuth()
  const { addToast } = useToast()
  const isHod = user?.role === 'SUPER_ADMIN' || (user?.role === 'TEAM_LEAD' && user?.department === 'ECOMMERCE')
  const [tasks, setTasks] = useState<EcomTask[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [newOpen, setNewOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  useEffect(() => {
    getEcommerceBoard()
      .then((res) => { setTasks(res.columns.flatMap((c) => c.tasks)); setMembers(res.members) })
      .catch(() => addToast({ type: 'error', message: 'Could not load board.' }))
      .finally(() => setLoading(false))
  }, [addToast])

  const canMove = (t: EcomTask) => isHod || t.assignee?.id === user?.id
  const upsertTask = (t: EcomTask) => setTasks((ts) => (ts.some((x) => x.id === t.id) ? ts.map((x) => (x.id === t.id ? t : x)) : [...ts, t]))

  function setStatus(taskId: string, status: EcomTaskStatus) {
    const prev = tasks
    setTasks((ts) => ts.map((t) => (t.id === taskId ? { ...t, status } : t)))
    updateEcommerceTask(taskId, { status }).then((res) => upsertTask(res.task)).catch(() => { setTasks(prev); addToast({ type: 'error', message: 'Could not update the task.' }) })
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
    setTasks((ts) => ts.filter((t) => t.id !== id)); setDetailId(null)
    deleteEcommerceTask(id).catch(() => { setTasks(prev); addToast({ type: 'error', message: 'Could not delete task.' }) })
  }

  if (loading) return <div className="p-2 text-body-md text-ink-muted">Loading…</div>
  const detailTask = tasks.find((t) => t.id === detailId) ?? null

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">Ecommerce Task Board</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">Click a card to open it, comment & @mention the team · {tasks.length} tasks</p>
        </div>
        {isHod && <Button size="sm" leadingIcon={<Plus size={16} />} onClick={() => setNewOpen(true)}>New Task</Button>}
      </div>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {COLUMNS.map((col) => (
            <Column key={col.status} status={col.status} label={col.label} tasks={tasks.filter((t) => t.status === col.status)}
              canMove={canMove} isHod={isHod} onDelete={remove} onOpen={setDetailId} onStatus={setStatus} />
          ))}
        </div>
      </DndContext>

      {newOpen && <NewTaskModal members={members} onClose={() => setNewOpen(false)} onCreated={upsertTask} />}
      {detailTask && (
        <DetailModal task={detailTask} members={members} isHod={isHod} meId={user?.id}
          onClose={() => setDetailId(null)} onSaved={upsertTask} onDelete={remove}
          onCommentAdded={() => setTasks((ts) => ts.map((t) => (t.id === detailTask.id ? { ...t, commentCount: t.commentCount + 1 } : t)))} />
      )}
    </div>
  )
}

function Column({ status, label, tasks, canMove, isHod, onDelete, onOpen, onStatus }: {
  status: EcomTaskStatus; label: string; tasks: EcomTask[]; canMove: (t: EcomTask) => boolean; isHod: boolean
  onDelete: (id: string) => void; onOpen: (id: string) => void; onStatus: (id: string, s: EcomTaskStatus) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  return (
    <div ref={setNodeRef} className={'flex flex-col rounded-card border bg-bg/60 p-2 transition-colors ' + (isOver ? 'border-primary/40 bg-primary/5' : 'border-line')}>
      <div className="flex items-center justify-between px-2 py-1.5">
        <span className="text-label-md uppercase text-ink-muted">{label}</span>
        <span className="rounded-full bg-slate-200 px-2 text-body-sm font-semibold text-ink-muted">{tasks.length}</span>
      </div>
      <div className="flex min-h-[140px] flex-col gap-2.5 p-1">
        {tasks.map((t) => <TaskCard key={t.id} task={t} movable={canMove(t)} isHod={isHod} onDelete={onDelete} onOpen={onOpen} onStatus={onStatus} />)}
      </div>
    </div>
  )
}

function TaskCard({ task, movable, isHod, onDelete, onOpen, onStatus }: {
  task: EcomTask; movable: boolean; isHod: boolean
  onDelete: (id: string) => void; onOpen: (id: string) => void; onStatus: (id: string, s: EcomTaskStatus) => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id, disabled: !movable })
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 } : undefined
  const stop = { onPointerDown: (e: { stopPropagation(): void }) => e.stopPropagation(), onClick: (e: { stopPropagation(): void }) => e.stopPropagation() }
  return (
    <div ref={setNodeRef} style={style} {...(movable ? listeners : {})} {...attributes} onClick={() => onOpen(task.id)}
      className={'cursor-pointer rounded-btn border border-line bg-card p-3 shadow-card transition-shadow hover:shadow-overlay ' + (movable ? 'touch-none ' : '') + (isDragging ? 'opacity-60' : '')}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-body-md font-medium text-ink">{task.title}</p>
        {isHod && (
          <button {...stop} onClick={(e) => { e.stopPropagation(); onDelete(task.id) }} className="shrink-0 text-ink-muted hover:text-danger" aria-label="Delete task"><Trash2 size={14} /></button>
        )}
      </div>
      {task.description && <p className="mt-1 line-clamp-2 text-body-sm text-ink-muted">{task.description}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {task.source && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-ink-muted">From: {task.source}</span>}
        {task.dueDate && <Badge tone="warning" className="gap-1"><CalendarClock size={12} />{task.dueDate}</Badge>}
        {task.commentCount > 0 && <span className="flex items-center gap-1 text-[11px] text-ink-muted"><MessageSquare size={12} />{task.commentCount}</span>}
        {task.assignee && <span className="ml-auto flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary" title={task.assignee.name}>{initials(task.assignee.name)}</span>}
      </div>
      <div className="mt-2.5 border-t border-line pt-2" {...stop}>
        <select value={task.status} onChange={(e) => onStatus(task.id, e.target.value as EcomTaskStatus)} disabled={!movable}
          className="h-8 w-full rounded-btn border border-line bg-bg px-2 text-body-sm text-ink focus:border-primary focus:outline-none disabled:opacity-60">
          {COLUMNS.map((c) => <option key={c.status} value={c.status}>{STATUS_LABEL[c.status]}</option>)}
        </select>
      </div>
    </div>
  )
}

function NewTaskModal({ members, onClose, onCreated }: { members: Member[]; onClose: () => void; onCreated: (t: EcomTask) => void }) {
  const { addToast } = useToast()
  const [title, setTitle] = useState(''); const [source, setSource] = useState('')
  const [assignedToId, setAssignedToId] = useState(''); const [dueDate, setDueDate] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputCls = 'h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'
  async function submit(e: FormEvent) {
    e.preventDefault(); if (!title.trim()) return
    setSubmitting(true)
    try {
      const { task } = await createEcommerceTask({ title, source: source || undefined, assignedToId: assignedToId || null, dueDate: dueDate || null })
      onCreated(task); addToast({ type: 'success', message: 'Task created.' }); onClose()
    } catch { addToast({ type: 'error', message: 'Could not create task.' }) } finally { setSubmitting(false) }
  }
  return (
    <Modal open onClose={onClose} title="New Task"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={submitting}>{submitting ? 'Adding…' : 'Add Task'}</Button></>}>
      <form onSubmit={submit} className="space-y-4">
        <TextField label="Title" placeholder="What needs doing?" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        <TextField label="From (source)" placeholder="Who/where it came from" value={source} onChange={(e) => setSource(e.target.value)} />
        <div>
          <label className="mb-1 block text-body-sm font-semibold text-ink">Assign to</label>
          <select value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)} className={inputCls}>
            <option value="">Unassigned</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
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

function DetailModal({ task, members, isHod, meId, onClose, onSaved, onDelete, onCommentAdded }: {
  task: EcomTask; members: Member[]; isHod: boolean; meId?: string
  onClose: () => void; onSaved: (t: EcomTask) => void; onDelete: (id: string) => void; onCommentAdded: () => void
}) {
  const { addToast } = useToast()
  const [comments, setComments] = useState<TaskComment[]>([])
  const [loadingC, setLoadingC] = useState(true)
  // Editable (HOD) fields
  const [title, setTitle] = useState(task.title); const [source, setSource] = useState(task.source)
  const [assignedToId, setAssignedToId] = useState(task.assignee?.id ?? ''); const [dueDate, setDueDate] = useState(task.dueDate ?? '')
  const [status, setStatus] = useState<EcomTaskStatus>(task.status)
  const [saving, setSaving] = useState(false)
  const dirty = isHod && (title !== task.title || source !== task.source || assignedToId !== (task.assignee?.id ?? '') || dueDate !== (task.dueDate ?? '') || status !== task.status)

  useEffect(() => {
    getEcommerceTask(task.id).then((r) => setComments(r.comments)).catch(() => undefined).finally(() => setLoadingC(false))
  }, [task.id])

  async function save() {
    setSaving(true)
    try {
      const { task: saved } = await updateEcommerceTask(task.id, { title, source: source || null, assignedToId: assignedToId || null, dueDate: dueDate || null, status })
      onSaved(saved); addToast({ type: 'success', message: 'Task updated.' })
    } catch { addToast({ type: 'error', message: 'Could not save.' }) } finally { setSaving(false) }
  }
  async function comment(body: string, mentions: string[], reset: () => void) {
    try {
      const { comment: c } = await addTaskComment(task.id, body, mentions)
      setComments((cs) => [...cs, c]); onCommentAdded(); reset()
    } catch { addToast({ type: 'error', message: 'Could not post comment.' }) }
  }
  // Non-HOD assignee can still change status quickly.
  const canStatus = isHod || task.assignee?.id === meId
  async function quickStatus(s: EcomTaskStatus) {
    setStatus(s)
    if (!isHod) { const { task: saved } = await updateEcommerceTask(task.id, { status: s }); onSaved(saved) }
  }
  const inputCls = 'h-9 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'

  return (
    <Modal open onClose={onClose} size="lg" title={isHod ? 'Task' : task.title}
      footer={<>
        {isHod && <Button variant="danger" onClick={() => onDelete(task.id)}>Delete</Button>}
        <Button variant="secondary" onClick={onClose}>Close</Button>
        {isHod && <Button onClick={save} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save'}</Button>}
      </>}>
      <div className="space-y-4">
        {/* Task details */}
        {isHod ? (
          <div className="space-y-3 rounded-card border border-line p-3">
            <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
            <TextField label="From (source)" value={source} onChange={(e) => setSource(e.target.value)} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div><label className="mb-1 block text-body-sm font-semibold text-ink">Assign to</label>
                <select value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)} className={inputCls}>
                  <option value="">Unassigned</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select></div>
              <div><label className="mb-1 block text-body-sm font-semibold text-ink">Due date</label>
                <input type="date" value={dueDate ?? ''} onChange={(e) => setDueDate(e.target.value)} className={inputCls} /></div>
              <div><label className="mb-1 block text-body-sm font-semibold text-ink">Status</label>
                <select value={status} onChange={(e) => setStatus(e.target.value as EcomTaskStatus)} className={inputCls}>
                  {COLUMNS.map((c) => <option key={c.status} value={c.status}>{STATUS_LABEL[c.status]}</option>)}
                </select></div>
            </div>
          </div>
        ) : (
          <div className="rounded-card border border-line p-3 text-body-sm">
            <div className="flex flex-wrap items-center gap-2">
              {task.source && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-ink-muted">From: {task.source}</span>}
              {task.assignee && <span className="text-ink-muted">Assigned to <span className="font-medium text-ink">{task.assignee.name}</span></span>}
              {task.dueDate && <Badge tone="warning" className="gap-1"><CalendarClock size={12} />{task.dueDate}</Badge>}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span className="text-body-sm text-ink-muted">Status</span>
              <select value={status} disabled={!canStatus} onChange={(e) => quickStatus(e.target.value as EcomTaskStatus)} className={inputCls + ' max-w-[160px] disabled:opacity-60'}>
                {COLUMNS.map((c) => <option key={c.status} value={c.status}>{STATUS_LABEL[c.status]}</option>)}
              </select>
            </div>
          </div>
        )}

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
                      <span className="text-[11px] text-ink-muted">{fmtTime(c.createdAt)}</span>
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

/** Highlight "@Name" for mentioned members. */
function highlightMentions(body: string, mentionIds: string[], members: Member[]): ReactNode {
  const names = mentionIds.map((id) => members.find((m) => m.id === id)?.name).filter((n): n is string => !!n).sort((a, b) => b.length - a.length)
  if (!names.length) return body
  const out: ReactNode[] = []
  let i = 0, buf = ''
  const flush = () => { if (buf) { out.push(buf); buf = '' } }
  while (i < body.length) {
    if (body[i] === '@') {
      const hit = names.find((n) => body.startsWith('@' + n, i))
      if (hit) { flush(); out.push(<span key={i} className="rounded bg-primary/10 px-1 font-medium text-primary">@{hit}</span>); i += hit.length + 1; continue }
    }
    buf += body[i]; i++
  }
  flush()
  return out
}

function MentionBox({ members, onSubmit }: { members: Member[]; onSubmit: (body: string, mentions: string[], reset: () => void) => void }) {
  const [text, setText] = useState('')
  const [mentionIds, setMentionIds] = useState<string[]>([])
  const [suggest, setSuggest] = useState<Member[] | null>(null)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  function refreshSuggest(v: string, pos: number) {
    const m = v.slice(0, pos).match(/(?:^|\s)@([\w-]{0,30})$/)
    if (!m) { setSuggest(null); return }
    const token = m[1].toLowerCase()
    setSuggest(members.filter((mm) => mm.name.toLowerCase().includes(token)).slice(0, 6))
  }
  function pick(member: Member) {
    const el = ref.current; if (!el) return
    const pos = el.selectionStart ?? text.length
    const before = text.slice(0, pos), after = text.slice(pos)
    const m = before.match(/(?:^|\s)@([\w-]{0,30})$/); if (!m) return
    const at = before.length - m[1].length - 1
    const nb = before.slice(0, at) + '@' + member.name + ' '
    setText(nb + after); setMentionIds((ids) => (ids.includes(member.id) ? ids : [...ids, member.id])); setSuggest(null)
    setTimeout(() => { el.focus(); el.setSelectionRange(nb.length, nb.length) }, 0)
  }
  async function submit() {
    const body = text.trim(); if (!body || busy) return
    const kept = mentionIds.filter((id) => { const mm = members.find((x) => x.id === id); return mm && body.includes('@' + mm.name) })
    setBusy(true)
    await onSubmit(body, kept, () => { setText(''); setMentionIds([]) })
    setBusy(false)
  }
  return (
    <div className="relative mt-3">
      <textarea
        ref={ref} value={text}
        onChange={(e) => { setText(e.target.value); refreshSuggest(e.target.value, e.target.selectionStart ?? e.target.value.length) }}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit() } }}
        rows={2} placeholder="Write a comment… use @ to mention"
        className="w-full rounded-btn border border-line bg-bg p-3 text-body-sm text-ink placeholder:text-ink-muted focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10"
      />
      {suggest && suggest.length > 0 && (
        <ul className="absolute bottom-full z-10 mb-1 w-56 overflow-hidden rounded-btn border border-line bg-card shadow-overlay">
          {suggest.map((m) => (
            <li key={m.id}><button type="button" onClick={() => pick(m)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-body-sm hover:bg-slate-50">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[9px] font-semibold text-primary">{initials(m.name)}</span>{m.name}
            </button></li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex justify-end">
        <Button size="sm" leadingIcon={<Send size={14} />} onClick={submit} disabled={busy || !text.trim()}>{busy ? 'Posting…' : 'Comment'}</Button>
      </div>
    </div>
  )
}
