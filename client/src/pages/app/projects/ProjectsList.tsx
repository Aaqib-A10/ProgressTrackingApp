import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Archive, BellRing, FolderKanban, LayoutDashboard, Plus, Search, Users } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { TextField } from '../../../components/ui/Input'
import { PillFilter } from '../../../components/ui/PillFilter'
import { useToast } from '../../../components/ui/Toast'
import { useAuth } from '../../../lib/auth'
import { errMsg, projectsApi, type PickUser, type PmRole, type ProjectListItem } from '../../../lib/projectsApi'
import { AvatarStack, ROLE_META, SWATCHES, fieldCls } from '../../../components/projects/pmUi'
import { cn } from '../../../lib/cn'
import { NotificationPrefsModal } from '../../../components/projects/NotificationPrefsModal'

/** /app/projects — every project I'm a member of (all of them for a Super Admin). */
export default function ProjectsList() {
  const { user } = useAuth()
  const { addToast } = useToast()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState<'active' | 'archived'>('active')
  const [data, setData] = useState<{ canCreate: boolean; projects: ProjectListItem[] } | null>(null)
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const prefsOpen = params.get('settings') === 'notifications'

  const load = () =>
    projectsApi.list(tab === 'archived')
      .then(setData)
      .catch((e) => addToast({ type: 'error', message: errMsg(e, 'Could not load projects') }))
  useEffect(() => { setData(null); load() }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (data?.projects ?? []).filter((p) => !t || p.name.toLowerCase().includes(t) || p.key.toLowerCase().includes(t))
  }, [data, q])
  const isAdminSomewhere = user?.role === 'SUPER_ADMIN' || (data?.projects ?? []).some((p) => p.myRole === 'ADMIN')

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">Projects</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">Boards for each project you're part of. Open one to see only its tasks.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" leadingIcon={<BellRing size={15} />} onClick={() => setParams({ settings: 'notifications' })}>Notification settings</Button>
          {isAdminSomewhere && (
            <Link to="/app/projects/dashboard" className="inline-flex h-8 items-center gap-1.5 rounded-btn border border-line bg-card px-3 text-body-sm font-semibold text-ink hover:bg-slate-50">
              <LayoutDashboard size={15} /> Dashboard
            </Link>
          )}
          {data?.canCreate && <Button size="sm" leadingIcon={<Plus size={16} />} onClick={() => setCreating(true)}>New project</Button>}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {user?.role === 'SUPER_ADMIN' ? (
          <PillFilter size="sm" value={tab} onChange={setTab} options={[{ value: 'active', label: 'Active' }, { value: 'archived', label: 'Archived' }]} />
        ) : <span />}
        <div className="relative w-full max-w-xs">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a project" aria-label="Find a project" className={cn(fieldCls, 'h-9 pl-9')} />
        </div>
      </div>

      {!data ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-40 animate-pulse rounded-card border border-line bg-card" />)}
        </div>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-line bg-card py-16 text-center">
          <FolderKanban size={30} className="text-ink-muted" />
          <p className="text-body-md text-ink">{tab === 'archived' ? 'No archived projects.' : q ? 'No project matches that search.' : "You're not in any project yet."}</p>
          {tab === 'active' && !q && (
            <p className="max-w-sm text-body-sm text-ink-muted">{data.canCreate ? 'Create the first project to give the team a board.' : 'Ask a project admin to add you, and it will show up here.'}</p>
          )}
          {tab === 'active' && data.canCreate && !q && <Button size="sm" leadingIcon={<Plus size={16} />} onClick={() => setCreating(true)}>New project</Button>}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((p) => (
            <button
              key={p.id}
              onClick={() => navigate(`/app/projects/${p.key}`)}
              className="group flex flex-col rounded-card border border-line bg-card p-5 text-left shadow-card transition-shadow hover:shadow-overlay focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/20"
            >
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-btn text-body-sm font-bold text-white" style={{ backgroundColor: p.color }}>{p.key.slice(0, 3)}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-body-lg font-semibold text-ink group-hover:text-primary">{p.name}</h2>
                    {p.status === 'ARCHIVED' && <Archive size={14} className="text-ink-muted" />}
                  </div>
                  <p className="text-body-sm text-ink-muted">{p.key} · {p.myRole ? ROLE_META[p.myRole] : 'Super Admin view'}</p>
                </div>
                {p.overdueCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 text-body-sm font-semibold text-danger" title="Overdue tasks">
                    <AlertTriangle size={12} /> {p.overdueCount}
                  </span>
                )}
              </div>
              {p.description && <p className="mt-3 line-clamp-2 text-body-sm text-ink-muted">{p.description}</p>}
              <div className="mt-auto flex items-end justify-between gap-3 pt-4">
                <div className="flex gap-4 text-body-sm">
                  <span><b className="tabular-nums text-ink">{p.openCount}</b> <span className="text-ink-muted">open</span></span>
                  <span><b className="tabular-nums text-ink">{p.myOpenCount}</b> <span className="text-ink-muted">mine</span></span>
                </div>
                <span className="flex items-center gap-2">
                  <AvatarStack people={p.members} max={4} size={24} />
                  {p.memberCount > 4 && <span className="text-body-sm text-ink-muted"><Users size={12} className="inline" /> {p.memberCount}</span>}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {creating && <CreateProjectModal onClose={() => setCreating(false)} onCreated={(key) => { setCreating(false); navigate(`/app/projects/${key}`) }} />}
      {prefsOpen && <NotificationPrefsModal onClose={() => setParams({})} />}
    </div>
  )
}

function CreateProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: (key: string) => void }) {
  const { addToast } = useToast()
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [keyTouched, setKeyTouched] = useState(false)
  const [description, setDescription] = useState('')
  const [color, setColor] = useState(SWATCHES[0])
  const [users, setUsers] = useState<PickUser[]>([])
  const [picked, setPicked] = useState<Record<string, PmRole>>({})
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { projectsApi.pickableUsers().then((r) => setUsers(r.users)).catch(() => undefined) }, [])
  useEffect(() => {
    if (keyTouched) return
    const words = name.trim().split(/\s+/).filter(Boolean)
    const auto = words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] ?? '').slice(0, 4)
    setKey(auto.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^[0-9]+/, '').slice(0, 6))
  }, [name, keyTouched])

  const list = users.filter((u) => !filter || u.name.toLowerCase().includes(filter.toLowerCase()) || (u.department ?? '').toLowerCase().includes(filter.toLowerCase()))

  async function submit() {
    setBusy(true)
    setError('')
    try {
      const r = await projectsApi.create({ name: name.trim(), key, description: description.trim() || undefined, color, members: Object.entries(picked).map(([userId, role]) => ({ userId, role })) })
      addToast({ type: 'success', message: `${r.project.name} created` })
      onCreated(r.project.key)
    } catch (e) {
      setError(errMsg(e, 'Could not create the project'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="New project" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={busy || name.trim().length < 2 || key.length < 2}>{busy ? 'Creating…' : 'Create project'}</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
          <TextField label="Project name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. RTI" autoFocus />
          <TextField label="Key" value={key} onChange={(e) => { setKeyTouched(true); setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)) }} placeholder="RTI" />
        </div>
        <p className="-mt-2 text-body-sm text-ink-muted">Task codes use the key, like <b>{key || 'KEY'}-1</b>. It can't change once tasks exist.</p>
        <div>
          <label className="mb-1 block text-body-sm font-semibold text-ink">Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={cn(fieldCls, 'h-auto py-2')} placeholder="What this project covers" />
        </div>
        <div>
          <span className="mb-1 block text-body-sm font-semibold text-ink">Color</span>
          <div className="flex flex-wrap gap-2">
            {SWATCHES.map((c) => (
              <button key={c} type="button" onClick={() => setColor(c)} aria-label={`Color ${c}`} className={cn('h-7 w-7 rounded-full ring-offset-2 transition', color === c && 'ring-2 ring-ink')} style={{ backgroundColor: c }} />
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-body-sm font-semibold text-ink">Members <span className="font-normal text-ink-muted">({Object.keys(picked).length} selected, you're added as admin)</span></span>
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter people" className={cn(fieldCls, 'h-8 w-44 text-body-sm')} />
          </div>
          <div className="max-h-64 divide-y divide-line overflow-y-auto rounded-btn border border-line">
            {list.map((u) => {
              const on = u.id in picked
              return (
                <div key={u.id} className="flex items-center gap-3 px-3 py-2">
                  <input type="checkbox" checked={on} onChange={() => setPicked((p) => { const n = { ...p }; if (on) delete n[u.id]; else n[u.id] = 'MEMBER'; return n })} className="h-4 w-4 accent-primary" aria-label={`Add ${u.name}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body-md text-ink">{u.name}</p>
                    <p className="truncate text-body-sm text-ink-muted">{u.department ?? u.email}</p>
                  </div>
                  {on && (
                    <select value={picked[u.id]} onChange={(e) => setPicked((p) => ({ ...p, [u.id]: e.target.value as PmRole }))} className="h-8 rounded-btn border border-line bg-card px-2 text-body-sm">
                      <option value="ADMIN">Project admin</option>
                      <option value="MEMBER">Member</option>
                      <option value="VIEWER">Viewer</option>
                    </select>
                  )}
                </div>
              )
            })}
            {list.length === 0 && <p className="px-3 py-4 text-body-sm text-ink-muted">No people found.</p>}
          </div>
        </div>
        {error && <p className="text-body-sm text-danger">{error}</p>}
      </div>
    </Modal>
  )
}
