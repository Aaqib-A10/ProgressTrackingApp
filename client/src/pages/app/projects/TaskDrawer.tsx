import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Bell, BellOff, CalendarClock, Check, CheckSquare, ClipboardCheck, Copy, Download, History, Link2, MessageSquare, MessagesSquare, Paperclip, Pencil, Plus, Trash2, Upload, X } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { useToast } from '../../../components/ui/Toast'
import { MentionBox, highlightMentions } from '../../../components/MentionBox'
import { LabelPicker, PeoplePicker } from '../../../components/projects/Pickers'
import { ReviewForm, ReviewItem } from '../../../components/projects/Reviews'
import { PRIORITIES, PRIORITY_META, PersonAvatar, fieldCls, fmtAgo, fmtBytes, fmtDateTime, fmtSpan, fromLocalInput, toLocalInput } from '../../../components/projects/pmUi'
import { errMsg, projectsApi, type ActivityRow, type BoardColumn, type Label, type PmPriority, type ProjectMember, type TaskCard, type TaskDetail, type TaskPerms } from '../../../lib/projectsApi'
import { cn } from '../../../lib/cn'

/**
 * Right-side task drawer (deep link: /app/projects/:key?task=CODE). Every field
 * saves on change; permissions come from the server so the UI matches exactly
 * what the API will accept.
 */
export function TaskDrawer({ code, columns, members, labels, meId, onClose, onChanged, onDeleted, onLabelCreated }: {
  code: string
  columns: BoardColumn[]
  members: ProjectMember[]
  labels: Label[]
  meId: string
  onClose: () => void
  onChanged: (card: TaskCard) => void
  onDeleted: (code: string) => void
  onLabelCreated: (l: Label) => void
}) {
  const { addToast } = useToast()
  const navigate = useNavigate()
  const [task, setTask] = useState<TaskDetail | null>(null)
  const [perms, setPerms] = useState<TaskPerms | null>(null)
  const [missing, setMissing] = useState(false)
  const [tab, setTab] = useState<'comments' | 'activity'>('comments')
  const [activity, setActivity] = useState<ActivityRow[] | null>(null)
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [editingDesc, setEditingDesc] = useState(false)
  const [newItem, setNewItem] = useState('')
  const [uploading, setUploading] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [extOpen, setExtOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const load = () =>
    projectsApi.task(code)
      .then((r) => { setTask(r.task); setPerms(r.perms); setTitle(r.task.title); setDesc(r.task.description ?? ''); setMissing(false) })
      .catch(() => setMissing(true))

  useEffect(() => { setTask(null); setActivity(null); setTab('comments'); setReviewOpen(false); load() }, [code]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === 'activity') projectsApi.activity(code).then((r) => setActivity(r.activity)).catch(() => setActivity([])) }, [tab, code, task?.updatedAt])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !extOpen && !confirmDelete) onClose() }
    window.addEventListener('keydown', onKey)
    panelRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, extOpen, confirmDelete])

  async function patch(body: Parameters<typeof projectsApi.updateTask>[1]) {
    try {
      const r = await projectsApi.updateTask(code, body)
      onChanged(r.task)
      await load()
    } catch (e) {
      addToast({ type: 'error', message: errMsg(e, 'Could not save') })
      await load()
    }
  }

  async function move(columnId: string) {
    try {
      const r = await projectsApi.moveTask(code, columnId, null, null)
      onChanged(r.task)
      await load()
    } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not move') }) }
  }

  const people = members.map((m) => ({ id: m.id, name: m.name }))
  const canEdit = !!perms?.canEdit

  const body = (() => {
    if (missing) return <div className="p-8 text-center text-body-md text-ink-muted">This task doesn't exist or you don't have access to it.</div>
    if (!task || !perms) return <div className="space-y-3 p-6">{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-6 animate-pulse rounded bg-slate-100" />)}</div>
    const overdueMs = task.isOverdue && task.dueAt ? Date.now() - new Date(task.dueAt).getTime() : 0
    const pendingExt = task.extensionRequests.find((x) => x.status === 'PENDING')
    return (
      <div className="space-y-5 p-5">
        {task.isOverdue && (
          <div className="flex items-start gap-2 rounded-btn border border-danger/30 bg-danger/5 px-3 py-2 text-body-sm text-danger">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span><b>Overdue by {fmtSpan(overdueMs)}.</b> Due {fmtDateTime(task.dueAt!)}.{perms.canRequestExtension && !pendingExt ? ' Update the status or request an extension.' : ''}</span>
          </div>
        )}

        {/* Title */}
        {canEdit ? (
          <textarea
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => { if (title.trim() && title !== task.title) patch({ title: title.trim() }); else setTitle(task.title) }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLTextAreaElement).blur() } }}
            rows={1}
            aria-label="Task title"
            className="w-full resize-none rounded-btn border border-transparent px-1 py-0.5 text-headline-md text-ink hover:border-line focus:border-primary focus:outline-none"
          />
        ) : <h2 className="text-headline-md text-ink">{task.title}</h2>}

        {/* Fields */}
        <dl className="grid grid-cols-[110px_1fr] items-center gap-x-3 gap-y-2.5 text-body-md">
          <dt className="text-ink-muted">Status</dt>
          <dd>
            <select value={task.columnId} disabled={!perms.canMove} onChange={(e) => move(e.target.value)} className={cn(fieldCls, 'h-9')} aria-label="Status">
              {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </dd>
          <dt className="text-ink-muted">Assigned by</dt>
          <dd className="flex items-center gap-2"><PersonAvatar person={task.createdBy} size={22} />{task.createdBy.name} <span className="text-body-sm text-ink-muted">· {fmtAgo(task.createdAt)}</span></dd>
          <dt className="text-ink-muted">Assigned to</dt>
          <dd><PeoplePicker people={people} value={task.assignees.map((a) => a.id)} onChange={(ids) => patch({ assigneeIds: ids })} disabled={!canEdit} /></dd>
          <dt className="text-ink-muted">Start date</dt>
          <dd><input type="datetime-local" defaultValue={toLocalInput(task.startAt)} key={`s${task.startAt}`} disabled={!canEdit} onBlur={(e) => { const v = fromLocalInput(e.target.value); if (v !== task.startAt) patch({ startAt: v }) }} className={cn(fieldCls, 'h-9')} aria-label="Start date" /></dd>
          <dt className="text-ink-muted">End date</dt>
          <dd className="flex items-center gap-2">
            <input type="datetime-local" defaultValue={toLocalInput(task.dueAt)} key={task.dueAt ?? 'none'} disabled={!perms.canChangeDue} onBlur={(e) => { const v = fromLocalInput(e.target.value); if (v !== task.dueAt) patch({ dueAt: v }) }} className={cn(fieldCls, 'h-9')} aria-label="End date (due)" />
            {perms.canChangeDue && task.dueAt && <button type="button" className="text-body-sm text-ink-muted hover:text-danger" onClick={() => patch({ dueAt: null })}>Clear</button>}
          </dd>
          <dt className="text-ink-muted">Priority</dt>
          <dd>
            <select value={task.priority} disabled={!canEdit} onChange={(e) => patch({ priority: e.target.value as PmPriority })} className={cn(fieldCls, 'h-9')} aria-label="Priority">
              {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
            </select>
          </dd>
          <dt className="text-ink-muted">Labels</dt>
          <dd>
            <LabelPicker labels={labels} value={task.labels.map((l) => l.id)} disabled={!canEdit} onChange={(ids) => patch({ labelIds: ids })}
              onCreate={async (name) => { try { const r = await projectsApi.createLabel(task.projectKey, { name }); onLabelCreated(r.label); return r.label } catch (e) { addToast({ type: 'error', message: errMsg(e) }); return null } }} />
          </dd>
          <dt className="text-ink-muted">Estimate</dt>
          <dd className="flex items-center gap-2"><input type="number" min={0} step={0.5} defaultValue={task.estimateHours ?? ''} key={`e${task.estimateHours}`} disabled={!canEdit} onBlur={(e) => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== task.estimateHours) patch({ estimateHours: v }) }} className={cn(fieldCls, 'h-9 w-28')} aria-label="Estimate in hours" /><span className="text-body-sm text-ink-muted">hours</span></dd>
          <dt className="text-ink-muted">Watching</dt>
          <dd className="flex items-center gap-2">
            <span className="flex -space-x-1.5">{task.watchers.slice(0, 6).map((w) => <PersonAvatar key={w.id} person={w} size={22} ring />)}</span>
            {task.watchers.some((w) => w.id === meId)
              ? <button type="button" className="inline-flex items-center gap-1 text-body-sm text-ink-muted hover:text-ink" onClick={() => projectsApi.watch(code, false).then(load)}><BellOff size={13} /> Stop watching</button>
              : <button type="button" className="inline-flex items-center gap-1 text-body-sm text-primary" onClick={() => projectsApi.watch(code, true).then(load)}><Bell size={13} /> Watch</button>}
          </dd>
        </dl>

        {/* Extension */}
        {(pendingExt || perms.canRequestExtension) && (
          <div className="rounded-btn border border-line bg-bg p-3">
            {pendingExt ? (
              <div className="space-y-2 text-body-sm">
                <p className="text-ink"><b>{pendingExt.requestedBy.name}</b> asked to move the due date to <b>{fmtDateTime(pendingExt.requestedDueAt)}</b>.</p>
                <p className="text-ink-muted">"{pendingExt.reason}"</p>
                {perms.canDecideExtension ? (
                  <DecideExtension id={pendingExt.id} onDone={async () => { await load(); const r = await projectsApi.task(code); onChanged(r.task) }} />
                ) : <p className="text-ink-muted">Waiting for the assigner or a project admin to decide.</p>}
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3 text-body-sm">
                <span className="text-ink-muted">Need more time?</span>
                <Button size="sm" variant="secondary" leadingIcon={<CalendarClock size={14} />} onClick={() => setExtOpen(true)}>Request extension</Button>
              </div>
            )}
          </div>
        )}

        {/* Description */}
        <section>
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-body-md font-semibold text-ink">Description</h3>
            {canEdit && !editingDesc && <button type="button" onClick={() => setEditingDesc(true)} className="inline-flex items-center gap-1 text-body-sm text-ink-muted hover:text-ink"><Pencil size={13} /> Edit</button>}
          </div>
          {editingDesc ? (
            <div>
              <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={6} autoFocus className={cn(fieldCls, 'h-auto py-2')} />
              <div className="mt-2 flex justify-end gap-2">
                <Button size="sm" variant="secondary" onClick={() => { setDesc(task.description ?? ''); setEditingDesc(false) }}>Cancel</Button>
                <Button size="sm" onClick={async () => { await patch({ description: desc.trim() || null }); setEditingDesc(false) }}>Save</Button>
              </div>
            </div>
          ) : task.description ? (
            <p className="whitespace-pre-wrap break-words text-body-md text-ink">{linkify(task.description)}</p>
          ) : <p className="text-body-sm text-ink-muted">{canEdit ? 'No description yet. Click Edit to add one.' : 'No description.'}</p>}
        </section>

        {/* Checklist */}
        <section>
          <div className="mb-1 flex items-center gap-2">
            <h3 className="text-body-md font-semibold text-ink"><CheckSquare size={15} className="mr-1 inline" />Checklist</h3>
            {task.checklist.length > 0 && <span className="text-body-sm text-ink-muted">{task.checklist.filter((c) => c.isDone).length}/{task.checklist.length}</span>}
          </div>
          {task.checklist.length > 0 && (
            <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-success transition-all" style={{ width: `${(task.checklist.filter((c) => c.isDone).length / task.checklist.length) * 100}%` }} /></div>
          )}
          <ul className="space-y-1">
            {task.checklist.map((c) => (
              <li key={c.id} className="group flex items-center gap-2 rounded-btn px-1 py-0.5 hover:bg-slate-50">
                <input type="checkbox" checked={c.isDone} disabled={!canEdit} onChange={() => projectsApi.updateChecklist(c.id, { isDone: !c.isDone }).then(load).then(() => projectsApi.task(code).then((r) => onChanged(r.task)))} className="h-4 w-4 accent-primary" aria-label={c.text} />
                <span className={cn('flex-1 text-body-md', c.isDone && 'text-ink-muted line-through')}>{c.text}</span>
                {canEdit && <button type="button" onClick={() => projectsApi.deleteChecklist(c.id).then(load)} className="opacity-0 group-hover:opacity-100" aria-label="Delete item"><X size={14} className="text-ink-muted" /></button>}
              </li>
            ))}
          </ul>
          {canEdit && (
            <form className="mt-1 flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!newItem.trim()) return; await projectsApi.addChecklist(code, newItem.trim()); setNewItem(''); await load(); const r = await projectsApi.task(code); onChanged(r.task) }}>
              <input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Add an item" className={cn(fieldCls, 'h-8 text-body-sm')} />
              <Button size="sm" variant="secondary" type="submit" aria-label="Add item"><Plus size={14} /></Button>
            </form>
          )}
        </section>

        {/* Attachments */}
        <section
          onDragOver={(e) => { if (perms.canMove) e.preventDefault() }}
          onDrop={(e) => { e.preventDefault(); if (perms.canMove) uploadMany(Array.from(e.dataTransfer.files)) }}
        >
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-body-md font-semibold text-ink"><Paperclip size={15} className="mr-1 inline" />Attachments</h3>
            {perms.canMove && <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1 text-body-sm text-primary" disabled={uploading}><Upload size={13} /> {uploading ? 'Uploading…' : 'Add file'}</button>}
            <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { uploadMany(Array.from(e.target.files ?? [])); e.target.value = '' }} />
          </div>
          {task.attachments.length === 0 ? <p className="text-body-sm text-ink-muted">{perms.canMove ? 'Drop a file here or use Add file (25 MB max).' : 'No files.'}</p> : (
            <ul className="divide-y divide-line rounded-btn border border-line">
              {task.attachments.map((a) => (
                <li key={a.id} className="flex items-center gap-2 px-3 py-2 text-body-sm">
                  <Paperclip size={14} className="text-ink-muted" />
                  <span className="min-w-0 flex-1 truncate text-ink" title={a.originalName}>{a.originalName}</span>
                  <span className="text-ink-muted">{fmtBytes(a.size)}</span>
                  <a href={(import.meta.env.VITE_API_URL ?? '/api') + a.downloadUrl.replace(/^\/api/, '')} className="text-ink-muted hover:text-primary" aria-label={`Download ${a.originalName}`}><Download size={14} /></a>
                  {(a.uploadedBy.id === meId || perms.canDelete) && <button type="button" onClick={() => projectsApi.deleteAttachment(a.id).then(load).then(() => projectsApi.task(code).then((r) => onChanged(r.task))).catch((e) => addToast({ type: 'error', message: errMsg(e) }))} aria-label="Remove file"><Trash2 size={14} className="text-ink-muted hover:text-danger" /></button>}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Reviews */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-body-md font-semibold text-ink"><ClipboardCheck size={15} className="mr-1 inline" />Reviews ({task.reviews.length})</h3>
            {!reviewOpen && <button type="button" onClick={() => setReviewOpen(true)} className="inline-flex items-center gap-1 text-body-sm text-primary"><Plus size={13} /> Add review</button>}
          </div>
          {reviewOpen && (
            <div className="mb-2">
              <ReviewForm
                onCancel={() => setReviewOpen(false)}
                onSubmit={async (v) => {
                  try { await projectsApi.addReview(code, v); setReviewOpen(false); await load(); const r = await projectsApi.task(code); onChanged(r.task); addToast({ type: 'success', message: 'Review posted' }); return true } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not post the review') }); return false }
                }}
              />
            </div>
          )}
          {task.reviews.length === 0 && !reviewOpen
            ? <p className="text-body-sm text-ink-muted">No reviews yet. Use Add review to approve the work or ask for changes.</p>
            : (
              <ul className="space-y-2">
                {task.reviews.map((rv) => (
                  <ReviewItem key={rv.id} review={rv} canDelete={rv.reviewer.id === meId || perms.canDelete}
                    onDelete={() => projectsApi.deleteReview(rv.id).then(load).then(() => projectsApi.task(code).then((r) => onChanged(r.task))).catch((e) => addToast({ type: 'error', message: errMsg(e) }))} />
                ))}
              </ul>
            )}
        </section>

        {/* Comments / activity */}
        <section>
          <div className="mb-2 flex gap-1 border-b border-line">
            {(['comments', 'activity'] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)} className={cn('-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-body-md font-medium', tab === t ? 'border-primary text-ink' : 'border-transparent text-ink-muted hover:text-ink')}>
                {t === 'comments' ? <><MessageSquare size={14} /> Comments ({task.comments.length})</> : <><History size={14} /> Activity</>}
              </button>
            ))}
          </div>
          {tab === 'comments' ? (
            <div>
              {task.comments.length === 0 && <p className="py-2 text-body-sm text-ink-muted">No comments yet. Start the discussion below.</p>}
              <ul className="space-y-3">
                {task.comments.map((c) => (
                  <Comment key={c.id} comment={c} members={people} mine={c.author.id === meId} canDelete={c.author.id === meId || perms.canDelete} onChanged={load} />
                ))}
              </ul>
              <MentionBox members={people} onSubmit={async (b, mentions, reset) => {
                try { await projectsApi.addComment(code, b, mentions); reset(); await load(); const r = await projectsApi.task(code); onChanged(r.task) } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not post') }) }
              }} />
            </div>
          ) : (
            <ActivityList rows={activity} columns={columns} people={people} labels={labels} />
          )}
        </section>
      </div>
    )
  })()

  async function uploadMany(files: File[]) {
    if (!files.length) return
    setUploading(true)
    for (const f of files) {
      if (f.size > 25 * 1024 * 1024) { addToast({ type: 'error', message: `${f.name} is over 25 MB` }); continue }
      try { await projectsApi.uploadAttachment(code, f) } catch (e) { addToast({ type: 'error', message: `${f.name}: ${errMsg(e, 'upload failed')}` }) }
    }
    try { await load(); const r = await projectsApi.task(code); onChanged(r.task) } finally { setUploading(false) }
  }

  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 animate-fade-in bg-ink/30" onClick={onClose} />
      <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={task ? `${task.code} ${task.title}` : 'Task'} className="relative flex h-full w-full max-w-[620px] animate-slide-in-right flex-col bg-card shadow-overlay focus:outline-none">
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-5 py-3">
          <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-body-sm font-semibold text-ink-muted">{code}</span>
          {task && <span className="truncate text-body-sm text-ink-muted">{task.projectName}</span>}
          <div className="ml-auto flex items-center gap-1">
            <IconBtn label="Copy link" onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}/app/projects/${task?.projectKey ?? code.split('-')[0]}?task=${code}`); addToast({ type: 'success', message: 'Link copied' }) }}><Link2 size={16} /></IconBtn>
            <IconBtn label="Share to chat" onClick={() => navigate(`/app/chat?share=${encodeURIComponent(code)}`)}><MessagesSquare size={16} /></IconBtn>
            <IconBtn label="Copy code" onClick={() => { navigator.clipboard?.writeText(code); addToast({ type: 'success', message: `${code} copied` }) }}><Copy size={16} /></IconBtn>
            {perms?.canDelete && <IconBtn label="Delete task" onClick={() => setConfirmDelete(true)}><Trash2 size={16} /></IconBtn>}
            <IconBtn label="Close" onClick={onClose}><X size={18} /></IconBtn>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
      </div>

      {extOpen && task && <ExtensionModal code={code} dueAt={task.dueAt} onClose={() => setExtOpen(false)} onDone={() => { setExtOpen(false); load() }} />}
      {confirmDelete && (
        <Modal open onClose={() => setConfirmDelete(false)} title={`Delete ${code}?`} size="sm" footer={<><Button variant="secondary" onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="danger" onClick={async () => { try { await projectsApi.deleteTask(code); onDeleted(code); addToast({ type: 'success', message: `${code} deleted` }) } catch (e) { addToast({ type: 'error', message: errMsg(e) }) } }}>Delete</Button></>}>
          <p className="text-body-md text-ink">The task, its comments and files will be removed from the board.</p>
        </Modal>
      )}
    </div>,
    document.body,
  )
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} title={label} aria-label={label} className="rounded-btn p-1.5 text-ink-muted hover:bg-slate-100 hover:text-ink">{children}</button>
}

function linkify(text: string): React.ReactNode[] {
  const parts = text.split(/(https?:\/\/[^\s)]+)/g)
  return parts.map((p, i) => (/^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noreferrer noopener" className="text-primary underline">{p}</a> : p))
}

function Comment({ comment, members, mine, canDelete, onChanged }: { comment: TaskDetail['comments'][number]; members: { id: string; name: string }[]; mine: boolean; canDelete: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(comment.body)
  return (
    <li className="flex gap-2.5">
      <PersonAvatar person={comment.author} size={28} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-body-md font-semibold text-ink">{comment.author.name}</span>
          <span className="text-body-sm text-ink-muted" title={fmtDateTime(comment.createdAt)}>{fmtAgo(comment.createdAt)}{comment.editedAt ? ' · edited' : ''}</span>
          <span className="ml-auto flex gap-2">
            {mine && !editing && <button type="button" onClick={() => setEditing(true)} className="text-body-sm text-ink-muted hover:text-ink">Edit</button>}
            {canDelete && !editing && <button type="button" onClick={() => projectsApi.deleteComment(comment.id).then(onChanged)} className="text-body-sm text-ink-muted hover:text-danger">Delete</button>}
          </span>
        </div>
        {editing ? (
          <div className="mt-1">
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} className={cn(fieldCls, 'h-auto py-2 text-body-sm')} />
            <div className="mt-1 flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => { setText(comment.body); setEditing(false) }}>Cancel</Button>
              <Button size="sm" leadingIcon={<Check size={14} />} onClick={async () => { await projectsApi.editComment(comment.id, text); setEditing(false); onChanged() }}>Save</Button>
            </div>
          </div>
        ) : <p className="mt-0.5 whitespace-pre-wrap break-words text-body-md text-ink">{highlightMentions(comment.body, comment.mentions, members)}</p>}
      </div>
    </li>
  )
}

const ACTION_TEXT: Record<string, string> = {
  created: 'created the task',
  title_changed: 'renamed the task',
  description_changed: 'updated the description',
  status_changed: 'moved the task',
  assigned: 'assigned',
  unassigned: 'unassigned',
  due_changed: 'changed the due date',
  priority_changed: 'changed the priority',
  label_added: 'added a label',
  label_removed: 'removed a label',
  comment_added: 'commented',
  review_added: 'reviewed the task',
  review_deleted: 'deleted a review',
  attachment_added: 'attached a file',
  attachment_removed: 'removed a file',
  checklist_updated: 'updated the checklist',
  extension_requested: 'requested an extension',
  extension_approved: 'approved the extension',
  extension_rejected: 'rejected the extension',
  became_overdue: 'Task became overdue',
  completed: 'completed the task',
  reopened: 'reopened the task',
  deleted: 'deleted the task',
}

function ActivityList({ rows, people }: { rows: ActivityRow[] | null; columns: BoardColumn[]; people: { id: string; name: string }[]; labels: Label[] }) {
  if (!rows) return <p className="py-2 text-body-sm text-ink-muted">Loading…</p>
  if (!rows.length) return <p className="py-2 text-body-sm text-ink-muted">No activity yet.</p>
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? 'someone'
  const detail = (r: ActivityRow): string => {
    const m = (r.meta ?? {}) as Record<string, unknown>
    if (r.action === 'status_changed') return ` from ${m.from} to ${m.to}`
    if (r.action === 'assigned' || r.action === 'unassigned') return ` ${((m.userIds as string[]) ?? []).map(name).join(', ')}`
    if (r.action === 'due_changed') return m.to ? ` to ${fmtDateTime(String(m.to))}` : ' (removed)'
    if (r.action === 'priority_changed') return ` from ${String(m.from).toLowerCase()} to ${String(m.to).toLowerCase()}`
    if (r.action === 'title_changed') return ` to "${m.to}"`
    if (r.action === 'attachment_added' || r.action === 'attachment_removed') return ` ${m.name}`
    if (r.action === 'review_added') return m.verdict === 'APPROVED' ? ': approved' : m.verdict === 'CHANGES_REQUESTED' ? ': changes requested' : ''
    return ''
  }
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.id} className="flex items-start gap-2 text-body-sm">
          {r.user ? <PersonAvatar person={r.user} size={20} /> : <span className="flex h-5 w-5 items-center justify-center rounded-full bg-danger/10"><AlertTriangle size={11} className="text-danger" /></span>}
          <span className="flex-1 text-ink">{r.user && <b>{r.user.name} </b>}{ACTION_TEXT[r.action] ?? r.action.replace(/_/g, ' ')}{detail(r)}</span>
          <span className="shrink-0 text-ink-muted" title={fmtDateTime(r.createdAt)}>{fmtAgo(r.createdAt)}</span>
        </li>
      ))}
    </ul>
  )
}

function ExtensionModal({ code, dueAt, onClose, onDone }: { code: string; dueAt: string | null; onClose: () => void; onDone: () => void }) {
  const { addToast } = useToast()
  const [when, setWhen] = useState(toLocalInput(dueAt ? new Date(Math.max(Date.now(), new Date(dueAt).getTime()) + 86400000).toISOString() : null))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Modal open onClose={onClose} title="Request more time" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy || !when || reason.trim().length < 3} onClick={async () => {
      setBusy(true)
      try { await projectsApi.requestExtension(code, fromLocalInput(when)!, reason.trim()); addToast({ type: 'success', message: 'Request sent' }); onDone() } catch (e) { addToast({ type: 'error', message: errMsg(e) }) } finally { setBusy(false) }
    }}>Send request</Button></>}>
      <div className="space-y-3">
        <p className="text-body-sm text-ink-muted">Current due date: {dueAt ? fmtDateTime(dueAt) : 'none'}. The person who assigned the task or a project admin will approve or reject it.</p>
        <div>
          <label className="mb-1 block text-body-sm font-semibold text-ink" htmlFor="ext-when">New due date</label>
          <input id="ext-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={fieldCls} />
        </div>
        <div>
          <label className="mb-1 block text-body-sm font-semibold text-ink" htmlFor="ext-why">Reason</label>
          <textarea id="ext-why" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className={cn(fieldCls, 'h-auto py-2')} placeholder="What's holding it up?" />
        </div>
      </div>
    </Modal>
  )
}

function DecideExtension({ id, onDone }: { id: string; onDone: () => void }) {
  const { addToast } = useToast()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const go = async (d: 'approve' | 'reject') => {
    setBusy(true)
    try { await projectsApi.decideExtension(id, d, note.trim() || undefined); addToast({ type: 'success', message: d === 'approve' ? 'Extension approved' : 'Extension rejected' }); onDone() } catch (e) { addToast({ type: 'error', message: errMsg(e) }) } finally { setBusy(false) }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className={cn(fieldCls, 'h-8 flex-1 text-body-sm')} />
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => go('reject')}>Reject</Button>
      <Button size="sm" disabled={busy} onClick={() => go('approve')}>Approve</Button>
    </div>
  )
}
