import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Star, Trash2, UserPlus } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import { Modal } from '../../../components/ui/Modal'
import { TextField } from '../../../components/ui/Input'
import { Toggle } from '../../../components/ui/Toggle'
import { useToast } from '../../../components/ui/Toast'
import { CATEGORY_LABEL, PersonAvatar, ROLE_META, SWATCHES, fieldCls } from '../../../components/projects/pmUi'
import { LabelChip } from '../../../components/projects/Pickers'
import { errMsg, projectsApi, type BoardColumn, type BoardData, type ColumnCategory, type PickUser, type PmRole } from '../../../lib/projectsApi'
import { PictureEditor, ProjectPicture } from '../../../components/ui/Pictures'
import { cn } from '../../../lib/cn'

type Tab = 'general' | 'members' | 'columns' | 'labels' | 'notifications'
const TABS: { id: Tab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'members', label: 'Members' },
  { id: 'columns', label: 'Columns' },
  { id: 'labels', label: 'Labels' },
  { id: 'notifications', label: 'Alerts' },
]

/** /app/projects/:key/settings — project admins only (server enforces it too). */
export default function ProjectSettings() {
  const { key = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'general'
  const [data, setData] = useState<BoardData | null>(null)
  const [denied, setDenied] = useState(false)
  const load = () => projectsApi.board(key).then((d) => { setData(d); if (!d.perms.canManage) setDenied(true) }).catch(() => setDenied(true))
  useEffect(() => { load() }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  if (denied) return <div className="py-20 text-center text-body-md text-ink-muted">Only project admins can change these settings. <Link to={`/app/projects/${key}`} className="text-primary">Back to the board</Link></div>
  if (!data) return <p className="text-body-md text-ink-muted">Loading…</p>

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex items-center gap-3">
        <Link to={`/app/projects/${data.project.key}`} className="rounded-btn p-1.5 text-ink-muted hover:bg-slate-100 hover:text-ink" aria-label="Back to the board"><ArrowLeft size={18} /></Link>
        <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: data.project.color }} />
        <h1 className="text-headline-lg text-ink">{data.project.name} settings</h1>
      </div>
      <div className="flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setParams({ tab: t.id })} className={cn('-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-body-md font-medium', tab === t.id ? 'border-primary text-ink' : 'border-transparent text-ink-muted hover:text-ink')}>{t.label}</button>
        ))}
      </div>
      {tab === 'general' && <General data={data} onSaved={load} />}
      {tab === 'members' && <Members data={data} onChanged={load} />}
      {tab === 'columns' && <Columns data={data} onChanged={load} />}
      {tab === 'labels' && <Labels data={data} onChanged={load} />}
      {tab === 'notifications' && <Alerts data={data} onSaved={load} />}
    </div>
  )
}

function General({ data, onSaved }: { data: BoardData; onSaved: () => void }) {
  const { addToast } = useToast()
  const navigate = useNavigate()
  const p = data.project
  const [name, setName] = useState(p.name)
  const [key, setKey] = useState(p.key)
  const [description, setDescription] = useState(p.description ?? '')
  const [color, setColor] = useState(p.color)
  const [busy, setBusy] = useState(false)
  const keyLocked = p.taskCounter > 0
  async function save() {
    setBusy(true)
    try {
      const r = await projectsApi.update(p.key, { name: name.trim(), description: description.trim() || null, color, ...(keyLocked ? {} : { key }) })
      addToast({ type: 'success', message: 'Saved' })
      if (r.project.key !== p.key) navigate(`/app/projects/${r.project.key}/settings`, { replace: true })
      else onSaved()
    } catch (e) { addToast({ type: 'error', message: errMsg(e) }) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-5">
      <Card>
        <div className="space-y-4">
          <PictureEditor kind="project" id={p.key} label="Project picture" preview={<ProjectPicture project={{ key: p.key, color }} size={72} />} />
          <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
            <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <TextField label="Key" value={key} disabled={keyLocked} onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} />
          </div>
          {keyLocked && <p className="-mt-2 text-body-sm text-ink-muted">The key is locked because tasks already use it ({p.key}-1 …).</p>}
          <div>
            <label className="mb-1 block text-body-sm font-semibold text-ink">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={cn(fieldCls, 'h-auto py-2')} />
          </div>
          <div>
            <span className="mb-1 block text-body-sm font-semibold text-ink">Color</span>
            <div className="flex flex-wrap gap-2">{SWATCHES.map((c) => <button key={c} type="button" aria-label={`Color ${c}`} onClick={() => setColor(c)} className={cn('h-7 w-7 rounded-full ring-offset-2', color === c && 'ring-2 ring-ink')} style={{ backgroundColor: c }} />)}</div>
          </div>
          <div className="flex justify-end"><Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</Button></div>
        </div>
      </Card>
      {data.perms.canArchive && (
        <Card title="Danger zone">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-body-md text-ink-muted">{p.status === 'ARCHIVED' ? 'This project is archived. Restore it to make it active again.' : 'Archiving hides the project from everyone\'s list and stops its deadline alerts. Nothing is deleted.'}</p>
            <Button variant={p.status === 'ARCHIVED' ? 'secondary' : 'danger'} onClick={async () => {
              try { await projectsApi.archive(p.key, p.status !== 'ARCHIVED'); addToast({ type: 'success', message: p.status === 'ARCHIVED' ? 'Project restored' : 'Project archived' }); onSaved() } catch (e) { addToast({ type: 'error', message: errMsg(e) }) }
            }}>{p.status === 'ARCHIVED' ? 'Restore project' : 'Archive project'}</Button>
          </div>
        </Card>
      )}
    </div>
  )
}

function Members({ data, onChanged }: { data: BoardData; onChanged: () => void }) {
  const { addToast } = useToast()
  const [adding, setAdding] = useState(false)
  const key = data.project.key
  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); addToast({ type: 'success', message: ok }); onChanged() } catch (e) { addToast({ type: 'error', message: errMsg(e) }) } }
  return (
    <Card title={`${data.members.length} members`} subtitle="Only members see this project. Removing someone also unassigns them from its tasks." action={<Button size="sm" leadingIcon={<UserPlus size={15} />} onClick={() => setAdding(true)}>Add people</Button>}>
      <ul className="divide-y divide-line">
        {data.members.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-3 py-2.5">
            <PersonAvatar person={m} size={32} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-body-md font-medium text-ink">{m.name}{m.id === data.me.id && <span className="text-ink-muted"> (you)</span>}{!m.isActive && <span className="ml-1 text-body-sm text-danger">inactive</span>}</p>
              <p className="truncate text-body-sm text-ink-muted">{m.email}</p>
            </div>
            <select value={m.role} onChange={(e) => act(() => projectsApi.setMemberRole(key, m.id, e.target.value as PmRole), 'Role updated')} className="h-8 rounded-btn border border-line bg-card px-2 text-body-sm" aria-label={`Role for ${m.name}`}>
              {(['ADMIN', 'MEMBER', 'VIEWER'] as PmRole[]).map((r) => <option key={r} value={r}>{ROLE_META[r]}</option>)}
            </select>
            <button type="button" onClick={() => { if (window.confirm(`Remove ${m.name} from ${data.project.name}?`)) act(() => projectsApi.removeMember(key, m.id), 'Removed') }} className="rounded-btn p-1.5 text-ink-muted hover:bg-danger/10 hover:text-danger" aria-label={`Remove ${m.name}`}><Trash2 size={15} /></button>
          </li>
        ))}
      </ul>
      {adding && <AddPeople projectKey={key} existing={data.members.map((m) => m.id)} onClose={() => setAdding(false)} onAdded={() => { setAdding(false); onChanged() }} />}
    </Card>
  )
}

function AddPeople({ projectKey, existing, onClose, onAdded }: { projectKey: string; existing: string[]; onClose: () => void; onAdded: () => void }) {
  const { addToast } = useToast()
  const [users, setUsers] = useState<PickUser[]>([])
  const [sel, setSel] = useState<string[]>([])
  const [role, setRole] = useState<PmRole>('MEMBER')
  const [q, setQ] = useState('')
  useEffect(() => { projectsApi.pickableUsers().then((r) => setUsers(r.users.filter((u) => !existing.includes(u.id)))).catch(() => undefined) }, [existing])
  const list = users.filter((u) => !q || u.name.toLowerCase().includes(q.toLowerCase()) || (u.department ?? '').toLowerCase().includes(q.toLowerCase()))
  return (
    <Modal open onClose={onClose} title="Add people" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!sel.length} onClick={async () => { try { await projectsApi.addMembers(projectKey, sel, role); addToast({ type: 'success', message: `Added ${sel.length}` }); onAdded() } catch (e) { addToast({ type: 'error', message: errMsg(e) }) } }}>Add {sel.length || ''}</Button></>}>
      <div className="space-y-3">
        <div className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people or department" className={fieldCls} autoFocus />
          <select value={role} onChange={(e) => setRole(e.target.value as PmRole)} className={cn(fieldCls, 'w-40')} aria-label="Role">{(['ADMIN', 'MEMBER', 'VIEWER'] as PmRole[]).map((r) => <option key={r} value={r}>{ROLE_META[r]}</option>)}</select>
        </div>
        <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-btn border border-line">
          {list.map((u) => (
            <li key={u.id}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-slate-50">
                <input type="checkbox" checked={sel.includes(u.id)} onChange={() => setSel((s) => (s.includes(u.id) ? s.filter((x) => x !== u.id) : [...s, u.id]))} className="h-4 w-4 accent-primary" />
                <span className="min-w-0 flex-1"><span className="block truncate text-body-md text-ink">{u.name}</span><span className="block truncate text-body-sm text-ink-muted">{u.department ?? u.email}</span></span>
              </label>
            </li>
          ))}
          {list.length === 0 && <li className="px-3 py-4 text-body-sm text-ink-muted">Everyone is already in this project.</li>}
        </ul>
      </div>
    </Modal>
  )
}

function Columns({ data, onChanged }: { data: BoardData; onChanged: () => void }) {
  const { addToast } = useToast()
  const [cols, setCols] = useState(data.columns)
  const [deleting, setDeleting] = useState<BoardColumn | null>(null)
  const [moveTo, setMoveTo] = useState('')
  const [newName, setNewName] = useState('')
  const [newCat, setNewCat] = useState<ColumnCategory>('IN_PROGRESS')
  useEffect(() => setCols(data.columns), [data.columns])
  const counts = new Map<string, number>()
  for (const t of data.tasks) counts.set(t.columnId, (counts.get(t.columnId) ?? 0) + 1)
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); onChanged() } catch (e) { addToast({ type: 'error', message: errMsg(e) }); onChanged() } }
  const swap = (i: number, j: number) => {
    const n = [...cols]; [n[i], n[j]] = [n[j], n[i]]; setCols(n)
    run(() => projectsApi.reorderColumns(data.project.key, n.map((c) => c.id)))
  }
  return (
    <Card title="Board columns" subtitle="Each column has a type. Moving a task into a Done type column completes it and stops its overdue alerts. You can also drag column headers on the board.">
      <ul className="space-y-2">
        {cols.map((c, i) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-btn border border-line p-2">
            <div className="flex flex-col">
              <button type="button" disabled={i === 0} onClick={() => swap(i, i - 1)} className="text-ink-muted disabled:opacity-30" aria-label="Move up"><ArrowUp size={14} /></button>
              <button type="button" disabled={i === cols.length - 1} onClick={() => swap(i, i + 1)} className="text-ink-muted disabled:opacity-30" aria-label="Move down"><ArrowDown size={14} /></button>
            </div>
            <input type="color" value={c.color ?? '#94A3B8'} onChange={(e) => run(() => projectsApi.updateColumn(c.id, { color: e.target.value }))} className="h-8 w-8 cursor-pointer rounded border border-line" aria-label={`${c.name} color`} />
            <input defaultValue={c.name} onBlur={(e) => { if (e.target.value.trim() && e.target.value !== c.name) run(() => projectsApi.updateColumn(c.id, { name: e.target.value.trim() })) }} className={cn(fieldCls, 'h-8 w-40 text-body-sm')} aria-label="Column name" />
            <select value={c.category} onChange={(e) => run(() => projectsApi.updateColumn(c.id, { category: e.target.value as ColumnCategory }))} className={cn(fieldCls, 'h-8 w-36 text-body-sm')} aria-label="Column type">
              {(['TODO', 'IN_PROGRESS', 'DONE'] as ColumnCategory[]).map((x) => <option key={x} value={x}>{CATEGORY_LABEL[x]}</option>)}
            </select>
            <input type="number" min={1} placeholder="WIP limit" defaultValue={c.wipLimit ?? ''} onBlur={(e) => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== c.wipLimit) run(() => projectsApi.updateColumn(c.id, { wipLimit: v })) }} className={cn(fieldCls, 'h-8 w-24 text-body-sm')} aria-label="Work in progress limit" />
            <button type="button" onClick={() => run(() => projectsApi.updateColumn(c.id, { isDefault: true }))} title={c.isDefault ? 'New tasks land here' : 'Make this where new tasks land'} className={cn('rounded-btn p-1.5', c.isDefault ? 'text-warning' : 'text-ink-muted hover:text-warning')} aria-label="Default column"><Star size={15} fill={c.isDefault ? 'currentColor' : 'none'} /></button>
            <span className="ml-auto text-body-sm text-ink-muted">{counts.get(c.id) ?? 0} tasks</span>
            <button type="button" onClick={() => { setDeleting(c); setMoveTo((cols.find((x) => x.id !== c.id && x.category === c.category) ?? cols.find((x) => x.id !== c.id && c.category !== 'DONE'))?.id ?? '') }} className="rounded-btn p-1.5 text-ink-muted hover:bg-danger/10 hover:text-danger" aria-label={`Delete ${c.name}`}><Trash2 size={15} /></button>
          </li>
        ))}
      </ul>
      <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (!newName.trim()) return; run(() => projectsApi.createColumn(data.project.key, { name: newName.trim(), category: newCat })).then(() => setNewName('')) }}>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New column name" className={cn(fieldCls, 'h-9 w-52')} />
        <select value={newCat} onChange={(e) => setNewCat(e.target.value as ColumnCategory)} className={cn(fieldCls, 'h-9 w-40')}>{(['TODO', 'IN_PROGRESS', 'DONE'] as ColumnCategory[]).map((x) => <option key={x} value={x}>{CATEGORY_LABEL[x]}</option>)}</select>
        <Button type="submit" size="sm" leadingIcon={<Plus size={15} />}>Add column</Button>
      </form>
      {deleting && (
        <Modal open onClose={() => setDeleting(null)} title={`Delete "${deleting.name}"?`} size="sm" footer={<><Button variant="secondary" onClick={() => setDeleting(null)}>Cancel</Button><Button variant="danger" onClick={() => { const d = deleting; setDeleting(null); run(() => projectsApi.deleteColumn(d.id, moveTo)) }}>Delete column</Button></>}>
          {(counts.get(deleting.id) ?? 0) > 0 || deleting.category === 'DONE' ? (
            <div className="space-y-2">
              <p className="text-body-md text-ink">{deleting.category === 'DONE' ? 'Its finished tasks (older ones too) move to:' : `Move its ${counts.get(deleting.id)} task(s) to:`}</p>
              <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className={fieldCls}>{cols.filter((x) => x.id !== deleting.id && (deleting.category !== 'DONE' || x.category === 'DONE')).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
              {deleting.category === 'DONE' && !cols.some((x) => x.id !== deleting.id && x.category === 'DONE') && <p className="text-body-sm text-danger">Add another Done type column first, so finished tasks stay finished.</p>}
            </div>
          ) : <p className="text-body-md text-ink">The column is empty.</p>}
        </Modal>
      )}
    </Card>
  )
}

function Labels({ data, onChanged }: { data: BoardData; onChanged: () => void }) {
  const { addToast } = useToast()
  const [name, setName] = useState('')
  const [color, setColor] = useState(SWATCHES[0])
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); onChanged() } catch (e) { addToast({ type: 'error', message: errMsg(e) }) } }
  return (
    <Card title="Labels" subtitle="Tag tasks to filter the board (for example Website, SEO, Urgent client).">
      <ul className="flex flex-wrap gap-2">
        {data.labels.map((l) => (
          <li key={l.id} className="flex items-center gap-1 rounded-full border border-line py-0.5 pl-1 pr-1">
            <input type="color" value={l.color} onChange={(e) => run(() => projectsApi.updateLabel(l.id, { color: e.target.value }))} className="h-5 w-5 cursor-pointer rounded-full border-0 p-0" aria-label={`${l.name} color`} />
            <LabelChip label={l} />
            <button type="button" onClick={() => { if (window.confirm(`Delete label "${l.name}"?`)) run(() => projectsApi.deleteLabel(l.id)) }} className="text-ink-muted hover:text-danger" aria-label={`Delete ${l.name}`}><Trash2 size={13} /></button>
          </li>
        ))}
        {data.labels.length === 0 && <li className="text-body-sm text-ink-muted">No labels yet.</li>}
      </ul>
      <form className="mt-4 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; run(() => projectsApi.createLabel(data.project.key, { name: name.trim(), color })).then(() => setName('')) }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Label name" maxLength={30} className={cn(fieldCls, 'h-9 w-48')} />
        <div className="flex gap-1">{SWATCHES.slice(0, 8).map((c) => <button key={c} type="button" onClick={() => setColor(c)} aria-label={`Color ${c}`} className={cn('h-6 w-6 rounded-full ring-offset-1', color === c && 'ring-2 ring-ink')} style={{ backgroundColor: c }} />)}</div>
        <Button type="submit" size="sm" leadingIcon={<Plus size={15} />}>Add label</Button>
      </form>
    </Card>
  )
}

function Alerts({ data, onSaved }: { data: BoardData; onSaved: () => void }) {
  const { addToast } = useToast()
  const p = data.project
  const [offsets, setOffsets] = useState<number[]>(p.reminderOffsetsMinutes)
  const [repeat, setRepeat] = useState(p.overdueRepeatHours)
  const [notifyAdmins, setNotifyAdmins] = useState(p.overdueNotifyAdmins)
  const OPTIONS = [{ m: 10080, l: '1 week before' }, { m: 2880, l: '2 days before' }, { m: 1440, l: '1 day before' }, { m: 240, l: '4 hours before' }, { m: 60, l: '1 hour before' }, { m: 15, l: '15 minutes before' }]
  async function save() {
    try { await projectsApi.update(p.key, { reminderOffsetsMinutes: offsets, overdueRepeatHours: repeat, overdueNotifyAdmins: notifyAdmins }); addToast({ type: 'success', message: 'Alert settings saved' }); onSaved() } catch (e) { addToast({ type: 'error', message: errMsg(e) }) }
  }
  return (
    <Card title="Deadline alerts" subtitle="Checked every 5 minutes. Overdue alerts go to the assignee, the person who assigned the task, and the admins below.">
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-body-md font-semibold text-ink">Remind assignees before the due time <span className="font-normal text-ink-muted">(up to 4)</span></p>
          <div className="flex flex-wrap gap-2">
            {OPTIONS.map((o) => {
              const on = offsets.includes(o.m)
              return <button key={o.m} type="button" onClick={() => setOffsets((s) => (on ? s.filter((x) => x !== o.m) : s.length >= 4 ? s : [...s, o.m]))} className={cn('rounded-full border px-3 py-1 text-body-sm font-medium', on ? 'border-primary bg-primary text-white' : 'border-line text-ink-muted hover:bg-slate-50')}>{o.l}</button>
            })}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-body-md font-semibold text-ink" htmlFor="repeat">Repeat the overdue alert every</label>
          <select id="repeat" value={repeat} onChange={(e) => setRepeat(Number(e.target.value))} className={cn(fieldCls, 'h-9 w-40')}>
            {[4, 8, 12, 24, 48, 72].map((h) => <option key={h} value={h}>{h} hours</option>)}
          </select>
          <span className="text-body-sm text-ink-muted">Never between 10 PM and 8 AM</span>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-btn border border-line p-3">
          <div>
            <p className="text-body-md text-ink">Alert project admins when a task is overdue</p>
            <p className="text-body-sm text-ink-muted">The assignee and the assigner are always alerted.</p>
          </div>
          <Toggle checked={notifyAdmins} onChange={setNotifyAdmins} label="Alert project admins" />
        </div>
        <div className="flex justify-end"><Button onClick={save}>Save alert settings</Button></div>
      </div>
    </Card>
  )
}
