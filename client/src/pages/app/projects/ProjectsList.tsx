import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Archive, BellRing, Clock, FolderKanban, LayoutDashboard, LayoutGrid, Plus, Rows3, Search, Star } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { TextField } from '../../../components/ui/Input'
import { PillFilter } from '../../../components/ui/PillFilter'
import { useToast } from '../../../components/ui/Toast'
import { useAuth } from '../../../lib/auth'
import { errMsg, projectsApi, type PickUser, type PmRole, type ProjectListItem } from '../../../lib/projectsApi'
import { AvatarStack, ROLE_META, SWATCHES, fieldCls, fmtAgo } from '../../../components/projects/pmUi'
import { getPins, onPinsChange, refreshPins, togglePin, type Pin } from '../../../lib/pins'
import { cn } from '../../../lib/cn'
import { ProjectPicture } from '../../../components/ui/Pictures'
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
  const [view, setViewState] = useState<'grid' | 'list'>(() => { try { return localStorage.getItem('pt-projects-view') === 'list' ? 'list' : 'grid' } catch { return 'grid' } })
  const [pins, setPins] = useState<Pin[]>(() => getPins(user?.id))
  const prefsOpen = params.get('settings') === 'notifications'

  function setView(v: 'grid' | 'list') { setViewState(v); try { localStorage.setItem('pt-projects-view', v) } catch { /* ignore */ } }
  useEffect(() => onPinsChange(() => setPins(getPins(user?.id))), [user?.id])

  const load = () =>
    projectsApi.list(tab === 'archived')
      .then((r) => { setData(r); refreshPins(user?.id, r.projects.map((p) => ({ key: p.key, name: p.name, color: p.color }))) })
      .catch((e) => addToast({ type: 'error', message: errMsg(e, 'Could not load projects') }))
  useEffect(() => { setData(null); load() }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  const pinned = useMemo(() => new Set(pins.map((p) => p.key)), [pins])
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (data?.projects ?? [])
      .filter((p) => !t || p.name.toLowerCase().includes(t) || p.key.toLowerCase().includes(t))
      .sort((a, b) => Number(pinned.has(b.key)) - Number(pinned.has(a.key)))
  }, [data, q, pinned])
  const isAdminSomewhere = user?.role === 'SUPER_ADMIN' || (data?.projects ?? []).some((p) => p.myRole === 'ADMIN')
  const totals = useMemo(() => (data?.projects ?? []).reduce((t, p) => ({ open: t.open + p.openCount, mine: t.mine + p.myOpenCount, overdue: t.overdue + p.overdueCount }), { open: 0, mine: 0, overdue: 0 }), [data])
  const pin = (p: ProjectListItem) => {
    const on = togglePin(user?.id, { key: p.key, name: p.name, color: p.color })
    addToast({ type: 'success', message: on ? `${p.name} pinned to the top and the sidebar` : `${p.name} unpinned` })
  }

  return (
    <div className="mx-auto w-full max-w-[1800px] space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">Projects</h1>
          {data && tab === 'active' ? (
            <p className="mt-1 text-body-md text-ink-muted">
              {data.projects.length} project{data.projects.length === 1 ? '' : 's'} · {totals.open} open task{totals.open === 1 ? '' : 's'} · <span className={totals.mine ? 'text-ink' : ''}>{totals.mine} assigned to you</span>
              {totals.overdue > 0 && <> · <span className="text-danger">{totals.overdue} overdue</span></>}
            </p>
          ) : <p className="mt-1 text-body-md text-ink-muted">Boards for each project you're part of.</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setParams({ settings: 'notifications' })} className="rounded-btn p-2 text-ink-muted hover:bg-slate-100 hover:text-ink" title="Notification settings" aria-label="Notification settings"><BellRing size={16} /></button>
          {isAdminSomewhere && (
            <Link to="/app/projects/dashboard" className="inline-flex h-7 items-center gap-1.5 rounded-btn border border-line bg-card px-2.5 text-[12.5px] font-medium text-ink shadow-xs hover:border-line-strong hover:bg-slate-50">
              <LayoutDashboard size={14} /> Dashboard
            </Link>
          )}
          {data?.canCreate && <Button size="sm" leadingIcon={<Plus size={15} />} onClick={() => setCreating(true)}>New project</Button>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {user?.role === 'SUPER_ADMIN' && (
          <PillFilter size="sm" value={tab} onChange={setTab} options={[{ value: 'active', label: 'Active' }, { value: 'archived', label: 'Archived' }]} />
        )}
        <div className="relative ml-auto w-full max-w-[260px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter projects" aria-label="Filter projects" className={cn(fieldCls, 'h-8 pl-8 text-[13px]')} />
        </div>
        <div className="inline-flex rounded-lg bg-slate-100 p-0.5 ring-1 ring-inset ring-line/60" role="group" aria-label="Layout">
          {(['grid', 'list'] as const).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v} title={v === 'grid' ? 'Cards' : 'List'}
              className={cn('rounded-md p-1.5 transition-colors', view === v ? 'bg-card text-ink shadow-[0_1px_2px_rgb(var(--shadow)/0.08),0_0_0_1px_rgb(var(--line-strong)/0.5)]' : 'text-ink-muted hover:text-ink')}>
              {v === 'grid' ? <LayoutGrid size={15} /> : <Rows3 size={15} />}
            </button>
          ))}
        </div>
      </div>

      {!data ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="rounded-card border border-line bg-card p-4">
              <div className="flex gap-3"><div className="skeleton h-9 w-9" /><div className="flex-1 space-y-2"><div className="skeleton h-3.5 w-1/2" /><div className="skeleton h-3 w-1/3" /></div></div>
              <div className="skeleton mt-6 h-1.5 w-full" />
              <div className="mt-4 flex justify-between"><div className="skeleton h-3 w-24" /><div className="skeleton h-5 w-14" /></div>
            </div>
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-line-strong bg-card py-16 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-ink-muted"><FolderKanban size={22} /></span>
          <p className="text-body-md font-medium text-ink">{tab === 'archived' ? 'No archived projects' : q ? 'No project matches that filter' : "You're not in any project yet"}</p>
          {tab === 'active' && !q && (
            <p className="max-w-sm text-body-sm text-ink-muted">{data.canCreate ? 'Create the first project to give the team a board.' : 'Ask a project admin to add you, and it will show up here.'}</p>
          )}
          {tab === 'active' && data.canCreate && !q && <Button size="sm" leadingIcon={<Plus size={15} />} onClick={() => setCreating(true)}>New project</Button>}
        </div>
      ) : view === 'grid' ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((p, i) => <ProjectCard key={p.id} p={p} pinned={pinned.has(p.key)} onPin={() => pin(p)} onOpen={() => navigate(`/app/projects/${p.key}`)} index={i} />)}
        </div>
      ) : (
        <div className="overflow-hidden rounded-card border border-line bg-card">
          <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_90px_90px_110px_100px_36px] items-center gap-4 border-b border-line bg-slate-50/70 px-4 py-2 text-[11.5px] font-medium text-ink-muted md:grid">
            <span>Project</span><span>Progress</span><span>Open</span><span>Mine</span><span>Members</span><span>Updated</span><span />
          </div>
          {shown.map((p) => <ProjectRow key={p.id} p={p} pinned={pinned.has(p.key)} onPin={() => pin(p)} onOpen={() => navigate(`/app/projects/${p.key}`)} />)}
        </div>
      )}

      {creating && <CreateProjectModal onClose={() => setCreating(false)} onCreated={(key) => { setCreating(false); navigate(`/app/projects/${key}`) }} />}
      {prefsOpen && <NotificationPrefsModal onClose={() => setParams({})} />}
    </div>
  )
}

const pct = (p: ProjectListItem) => (p.totalCount ? Math.round((p.doneCount / p.totalCount) * 100) : 0)

function Progress({ p, className }: { p: ProjectListItem; className?: string }) {
  const v = pct(p)
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-slate-100', className)} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={`${v}% done`}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${v}%`, backgroundColor: p.color ?? 'rgb(var(--primary))' }} />
    </div>
  )
}

function PinButton({ pinned, onPin }: { pinned: boolean; onPin: () => void }) {
  return (
    <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); onPin() }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onPin() } }}
      title={pinned ? 'Unpin' : 'Pin to the top and the sidebar'} aria-label={pinned ? 'Unpin' : 'Pin'} aria-pressed={pinned}
      className={cn('rounded-md p-1 transition-colors', pinned ? 'text-warning hover:bg-warning/10' : 'text-ink-faint opacity-0 hover:bg-slate-100 hover:text-ink group-hover:opacity-100 focus-visible:opacity-100')}>
      <Star size={15} className={pinned ? 'fill-warning' : ''} />
    </span>
  )
}

function ProjectCard({ p, pinned, onPin, onOpen, index }: { p: ProjectListItem; pinned: boolean; onPin: () => void; onOpen: () => void; index: number }) {
  return (
    <div
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen() }}
      style={{ animationDelay: `${Math.min(index, 8) * 25}ms`, animationFillMode: 'backwards' }}
      className="group relative flex animate-rise-in cursor-pointer flex-col rounded-card border border-line bg-card p-4 shadow-card transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:border-line-strong hover:shadow-raised focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <div className="flex items-start gap-3">
        <ProjectPicture project={p} size={36} className="rounded-lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h2 className="truncate text-[14.5px] font-semibold tracking-[-0.01em] text-ink">{p.name}</h2>
            {p.status === 'ARCHIVED' && <Archive size={13} className="shrink-0 text-ink-faint" />}
          </div>
          <p className="truncate text-[12px] text-ink-muted"><span className="font-mono text-[11px]">{p.key}</span> · {p.myRole ? ROLE_META[p.myRole] : 'Super Admin view'}</p>
        </div>
        <PinButton pinned={pinned} onPin={onPin} />
      </div>

      {p.description ? <p className="mt-3 line-clamp-2 text-[12.5px] leading-[18px] text-ink-muted">{p.description}</p> : <div className="mt-3" />}

      <div className="mt-auto pt-4">
        <div className="mb-1.5 flex items-baseline justify-between text-[12px]">
          <span className="text-ink-muted"><b className="font-semibold tabular-nums text-ink">{pct(p)}%</b> done</span>
          <span className="tabular-nums text-ink-faint">{p.doneCount}/{p.totalCount} tasks</span>
        </div>
        <Progress p={p} />
      </div>

      <div className="mt-3.5 flex items-center justify-between gap-2 border-t border-line pt-3">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[12px]">
          <Chip>{p.openCount} open</Chip>
          {p.myOpenCount > 0 && <Chip tone="primary">{p.myOpenCount} mine</Chip>}
          {p.overdueCount > 0 && <Chip tone="danger"><AlertTriangle size={11} /> {p.overdueCount} overdue</Chip>}
          {p.dueSoonCount > 0 && <Chip tone="warning"><Clock size={11} /> {p.dueSoonCount} due soon</Chip>}
        </div>
        <AvatarStack people={p.members} max={3} size={22} />
      </div>
    </div>
  )
}

function Chip({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'primary' | 'danger' | 'warning' }) {
  const cls = { neutral: 'bg-slate-100 text-ink-muted', primary: 'bg-primary/10 text-primary', danger: 'bg-danger/10 text-danger', warning: 'bg-warning/[0.12] text-warning' }[tone]
  return <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-px font-medium tabular-nums', cls)}>{children}</span>
}

function ProjectRow({ p, pinned, onPin, onOpen }: { p: ProjectListItem; pinned: boolean; onPin: () => void; onOpen: () => void }) {
  return (
    <div role="link" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter') onOpen() }}
      className="group grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-line px-4 py-2.5 last:border-b-0 hover:bg-slate-50 focus:outline-none focus-visible:bg-slate-50 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_90px_90px_110px_100px_36px]">
      <div className="flex min-w-0 items-center gap-3">
        <ProjectPicture project={p} size={28} className="rounded-md" />
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-medium text-ink">{p.name}</p>
          <p className="truncate text-[11.5px] text-ink-muted"><span className="font-mono">{p.key}</span> · {p.myRole ? ROLE_META[p.myRole] : 'Super Admin view'}</p>
        </div>
      </div>
      <div className="hidden items-center gap-2.5 md:flex">
        <Progress p={p} className="max-w-[160px]" />
        <span className="w-9 text-right text-[12px] tabular-nums text-ink-muted">{pct(p)}%</span>
      </div>
      <span className="hidden text-[13px] tabular-nums text-ink md:block">{p.openCount}{p.overdueCount > 0 && <span className="ml-1.5 text-[11.5px] text-danger">{p.overdueCount} late</span>}</span>
      <span className={cn('hidden text-[13px] tabular-nums md:block', p.myOpenCount ? 'text-ink' : 'text-ink-faint')}>{p.myOpenCount}</span>
      <span className="hidden md:block"><AvatarStack people={p.members} max={3} size={20} /></span>
      <span className="hidden text-[12px] text-ink-muted md:block">{p.lastActivityAt ? fmtAgo(p.lastActivityAt) : 'No tasks yet'}</span>
      <PinButton pinned={pinned} onPin={onPin} />
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
