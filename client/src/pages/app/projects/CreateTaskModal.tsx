import { useRef, useState } from 'react'
import { Paperclip, Plus, Upload, X } from 'lucide-react'
import { useAuth } from '../../../lib/auth'
import { Modal } from '../../../components/ui/Modal'
import { Button } from '../../../components/ui/Button'
import { TextField } from '../../../components/ui/Input'
import { useToast } from '../../../components/ui/Toast'
import { LabelPicker, PeoplePicker } from '../../../components/projects/Pickers'
import { PRIORITIES, PRIORITY_META, PersonAvatar, fieldCls, fmtBytes, fromLocalInput } from '../../../components/projects/pmUi'
import { errMsg, projectsApi, type BoardColumn, type Label, type PmPriority, type ProjectMember, type TaskCard } from '../../../lib/projectsApi'
import { cn } from '../../../lib/cn'

export function CreateTaskModal({ projectKey, columns, members, labels, defaultColumnId, onClose, onCreated, onLabelCreated }: {
  projectKey: string
  columns: BoardColumn[]
  members: ProjectMember[]
  labels: Label[]
  defaultColumnId?: string
  onClose: () => void
  onCreated: (t: TaskCard) => void
  onLabelCreated: (l: Label) => void
}) {
  const { addToast } = useToast()
  const def = defaultColumnId ?? columns.find((c) => c.isDefault)?.id ?? columns[0]?.id
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assignees, setAssignees] = useState<string[]>([])
  const { user } = useAuth()
  const [start, setStart] = useState('')
  const [due, setDue] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const MAX = 25 * 1024 * 1024
  const [priority, setPriority] = useState<PmPriority>('MEDIUM')
  const [labelIds, setLabelIds] = useState<string[]>([])
  const [columnId, setColumnId] = useState(def)
  const [checklist, setChecklist] = useState<string[]>([])
  const [newItem, setNewItem] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function addFiles(list: File[]) {
    const tooBig = list.filter((f) => f.size > MAX)
    if (tooBig.length) setError(`${tooBig.map((f) => f.name).join(', ')} ${tooBig.length > 1 ? 'are' : 'is'} over 25 MB`)
    setFiles((cur) => [...cur, ...list.filter((f) => f.size <= MAX)].slice(0, 20))
  }

  const people = members.filter((m) => m.role !== 'VIEWER' || assignees.includes(m.id)).map((m) => ({ id: m.id, name: m.name }))

  async function submit(again = false) {
    if (busy) return // Enter pressed twice
    if (!title.trim()) { setError('Give the task a title'); return }
    if (start && due && new Date(due) < new Date(start)) { setError('The end date must be after the start date'); return }
    setBusy(true)
    setError('')
    try {
      const items = newItem.trim() ? [...checklist, newItem.trim()] : checklist
      const r = await projectsApi.createTask(projectKey, { title: title.trim(), description: description.trim() || null, assigneeIds: assignees, startAt: fromLocalInput(start), dueAt: fromLocalInput(due), priority, labelIds, columnId, checklist: items })
      let failed = 0
      for (const f of files) {
        try { await projectsApi.uploadAttachment(r.task.code, f) } catch { failed++ }
      }
      const task = files.length ? (await projectsApi.task(r.task.code)).task : r.task
      onCreated(task)
      addToast(failed
        ? { type: 'error', message: `${r.task.code} created, but ${failed} file${failed > 1 ? 's' : ''} could not be uploaded` }
        : { type: 'success', message: `${r.task.code} created${files.length ? ` with ${files.length} file${files.length > 1 ? 's' : ''}` : ''}` })
      if (again) { setTitle(''); setDescription(''); setChecklist([]); setNewItem(''); setFiles([]) }
      else onClose()
    } catch (e) {
      setError(errMsg(e, 'Could not create the task'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New task"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="secondary" onClick={() => submit(true)} disabled={busy}>Create and add another</Button>
          <Button onClick={() => submit(false)} disabled={busy}>{busy ? (files.length ? 'Uploading…' : 'Creating…') : 'Create task'}</Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(false) }}>
        <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs to be done?" autoFocus maxLength={255} />
        <div>
          <label className="mb-1 block text-body-sm font-semibold text-ink">Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className={cn(fieldCls, 'h-auto py-2')} placeholder="Details, links, acceptance criteria" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <span className="mb-1 block text-body-sm font-semibold text-ink">Assigned by</span>
            <div className="flex h-10 items-center gap-2 rounded-btn border border-line bg-slate-50 px-3 text-body-md text-ink">
              {user && <PersonAvatar person={{ id: user.id, name: user.name }} size={22} />}
              <span className="truncate">{user?.name ?? 'You'}</span>
              <span className="text-body-sm text-ink-muted">(you)</span>
            </div>
          </div>
          <div>
            <span className="mb-1 block text-body-sm font-semibold text-ink">Assign to</span>
            <PeoplePicker people={people} value={assignees} onChange={setAssignees} />
          </div>
          <div>
            <label className="mb-1 block text-body-sm font-semibold text-ink" htmlFor="ct-start">Start date</label>
            <input id="ct-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className={fieldCls} />
          </div>
          <div>
            <label className="mb-1 block text-body-sm font-semibold text-ink" htmlFor="ct-due">End date <span className="font-normal text-ink-muted">(due)</span></label>
            <input id="ct-due" type="datetime-local" value={due} min={start || undefined} onChange={(e) => setDue(e.target.value)} className={fieldCls} />
          </div>
          <div>
            <span className="mb-1 block text-body-sm font-semibold text-ink">Priority</span>
            <div className="flex gap-1">
              {PRIORITIES.map((p) => (
                <button type="button" key={p} onClick={() => setPriority(p)} className={cn('flex h-10 flex-1 items-center justify-center gap-1 rounded-btn border text-body-sm font-medium', priority === p ? 'border-primary bg-primary/5 text-ink' : 'border-line text-ink-muted hover:bg-slate-50')}>
                  <span className={PRIORITY_META[p].cls}>{PRIORITY_META[p].icon}</span>{PRIORITY_META[p].label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-body-sm font-semibold text-ink" htmlFor="ct-col">Status</label>
            <select id="ct-col" value={columnId} onChange={(e) => setColumnId(e.target.value)} className={fieldCls}>
              {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <div>
          <span className="mb-1 block text-body-sm font-semibold text-ink">Labels</span>
          <LabelPicker
            labels={labels}
            value={labelIds}
            onChange={setLabelIds}
            onCreate={async (name) => {
              try { const r = await projectsApi.createLabel(projectKey, { name }); onLabelCreated(r.label); return r.label } catch (e) { addToast({ type: 'error', message: errMsg(e) }); return null }
            }}
          />
        </div>
        <div>
          <span className="mb-1 block text-body-sm font-semibold text-ink">Attachments <span className="font-normal text-ink-muted">(PDF, Word, Excel, images, zip… up to 25 MB each)</span></span>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); addFiles(Array.from(e.dataTransfer.files)) }}
            onClick={() => fileRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click() } }}
            className="flex cursor-pointer items-center justify-center gap-2 rounded-btn border border-dashed border-line px-3 py-3 text-body-sm text-ink-muted hover:border-primary hover:text-primary"
          >
            <Upload size={15} /> Drop files here or click to choose
          </div>
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = '' }} />
          {files.length > 0 && (
            <ul className="mt-2 space-y-1">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-btn bg-slate-50 px-2 py-1 text-body-sm">
                  <Paperclip size={13} className="text-ink-muted" />
                  <span className="min-w-0 flex-1 truncate text-ink" title={f.name}>{f.name}</span>
                  <span className="text-ink-muted">{fmtBytes(f.size)}</span>
                  <button type="button" onClick={() => setFiles((l) => l.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}><X size={14} className="text-ink-muted" /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <span className="mb-1 block text-body-sm font-semibold text-ink">Checklist <span className="font-normal text-ink-muted">(optional)</span></span>
          {checklist.length > 0 && (
            <ul className="mb-2 space-y-1">
              {checklist.map((c, i) => (
                <li key={i} className="flex items-center gap-2 rounded-btn bg-slate-50 px-2 py-1 text-body-sm">
                  <span className="flex-1">{c}</span>
                  <button type="button" onClick={() => setChecklist((l) => l.filter((_, j) => j !== i))} aria-label="Remove item"><X size={14} className="text-ink-muted" /></button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <input value={newItem} onChange={(e) => setNewItem(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (newItem.trim()) { setChecklist((l) => [...l, newItem.trim()]); setNewItem('') } } }} placeholder="Add an item and press Enter" className={fieldCls} />
            <Button type="button" variant="secondary" onClick={() => { if (newItem.trim()) { setChecklist((l) => [...l, newItem.trim()]); setNewItem('') } }} aria-label="Add checklist item"><Plus size={16} /></Button>
          </div>
        </div>
        {error && <p className="text-body-sm text-danger">{error}</p>}
      </form>
    </Modal>
  )
}
