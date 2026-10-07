import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Modal } from '../../../components/ui/Modal'
import { Button } from '../../../components/ui/Button'
import { TextField } from '../../../components/ui/Input'
import { useToast } from '../../../components/ui/Toast'
import { LabelPicker, PeoplePicker } from '../../../components/projects/Pickers'
import { PRIORITIES, PRIORITY_META, fieldCls, fromLocalInput } from '../../../components/projects/pmUi'
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
  const [due, setDue] = useState('')
  const [priority, setPriority] = useState<PmPriority>('MEDIUM')
  const [labelIds, setLabelIds] = useState<string[]>([])
  const [columnId, setColumnId] = useState(def)
  const [checklist, setChecklist] = useState<string[]>([])
  const [newItem, setNewItem] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const people = members.filter((m) => m.role !== 'VIEWER' || assignees.includes(m.id)).map((m) => ({ id: m.id, name: m.name }))

  async function submit(again = false) {
    if (!title.trim()) { setError('Give the task a title'); return }
    setBusy(true)
    setError('')
    try {
      const items = newItem.trim() ? [...checklist, newItem.trim()] : checklist
      const r = await projectsApi.createTask(projectKey, { title: title.trim(), description: description.trim() || null, assigneeIds: assignees, dueAt: fromLocalInput(due), priority, labelIds, columnId, checklist: items })
      onCreated(r.task)
      addToast({ type: 'success', message: `${r.task.code} created` })
      if (again) { setTitle(''); setDescription(''); setChecklist([]); setNewItem('') }
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
          <Button onClick={() => submit(false)} disabled={busy}>{busy ? 'Creating…' : 'Create task'}</Button>
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
            <span className="mb-1 block text-body-sm font-semibold text-ink">Assignees</span>
            <PeoplePicker people={people} value={assignees} onChange={setAssignees} />
          </div>
          <div>
            <label className="mb-1 block text-body-sm font-semibold text-ink" htmlFor="ct-due">Due date and time</label>
            <input id="ct-due" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className={fieldCls} />
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
