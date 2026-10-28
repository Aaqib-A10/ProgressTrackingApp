import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Plus, Trash2, Pencil, Check, X, Building2, Users, ShieldCheck, Layers } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { Modal } from '../../../components/ui/Modal'
import { Toggle } from '../../../components/ui/Toggle'
import { useToast } from '../../../components/ui/Toast'
import { useAuth } from '../../../lib/auth'
import { cn } from '../../../lib/cn'
import { ROLE_LABEL, type Department, type Role } from '../../../lib/types'
import {
  companyApi, type CompanyInfo, type CompanyUsage, type CompanyDepartment, type DepartmentKind, type RolesData, type CompanyRoleRow, type CompanyPerson,
} from '../../../lib/companyApi'

/**
 * Company settings (Phase 1, step 4): the company's name and time zone, its departments, its
 * own roles (what each one sees, and extra powers) and who has which role.
 */

function errMsg(e: unknown, fallback: string): string {
  const m = (e as { message?: string })?.message
  if (!m) return fallback
  try { return (JSON.parse(m) as { error?: string }).error || fallback } catch { return m }
}
const inputCls = 'h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink placeholder:text-ink-muted focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'
const TABS = [
  { key: 'general', label: 'Company', icon: Building2 },
  { key: 'departments', label: 'Departments', icon: Layers },
  { key: 'roles', label: 'Roles', icon: ShieldCheck },
  { key: 'people', label: 'People', icon: Users },
] as const
type Tab = (typeof TABS)[number]['key']

export default function CompanySettings() {
  const [tab, setTab] = useState<Tab>('general')
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-headline-lg text-ink">Company Settings</h1>
        <p className="mt-0.5 text-body-md text-ink-muted">Your company's name and time zone, its departments, and roles of your own on top of the built-in ones.</p>
      </div>
      <div role="tablist" className="flex flex-wrap gap-1 border-b border-line">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} type="button" onClick={() => setTab(t.key)}
            className={cn('-mb-px inline-flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-body-md font-medium transition-colors', tab === t.key ? 'border-primary text-primary' : 'border-transparent text-ink-muted hover:text-ink')}>
            <t.icon size={16} />{t.label}
          </button>
        ))}
      </div>
      {tab === 'general' && <GeneralTab />}
      {tab === 'departments' && <DepartmentsTab />}
      {tab === 'roles' && <RolesTab />}
      {tab === 'people' && <PeopleTab />}
    </div>
  )
}

// ------------------------------------------------------------------ company

function zones(): string[] {
  try { return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone') } catch { return ['Asia/Karachi', 'Asia/Dubai', 'Europe/London', 'America/New_York', 'UTC'] }
}

function GeneralTab() {
  const { addToast } = useToast()
  const { refresh } = useAuth()
  const [data, setData] = useState<{ company: CompanyInfo; canEdit: boolean; timeZoneLocked: boolean; usage: CompanyUsage | null } | null>(null)
  const [name, setName] = useState('')
  const [tz, setTz] = useState('')
  const [saving, setSaving] = useState(false)
  const all = useMemo(zones, [])
  useEffect(() => { companyApi.get().then((r) => { setData(r); setName(r.company.name); setTz(r.company.timeZone) }).catch(() => addToast({ type: 'error', message: 'Could not load the company.' })) }, [addToast])
  if (!data) return <Card><p className="text-body-md text-ink-muted">Loading…</p></Card>
  const c = data.company
  async function save(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const r = await companyApi.update({ name: name.trim(), ...(data!.timeZoneLocked ? {} : { timeZone: tz }) })
      setData({ ...data!, company: r.company })
      addToast({ type: 'success', message: 'Saved.' })
      void refresh?.()
    } catch (err) { addToast({ type: 'error', message: errMsg(err, 'Could not save.') }) } finally { setSaving(false) }
  }
  const changed = name.trim() !== c.name || tz !== c.timeZone
  async function allow(hours: 0 | 24 | 72 | 168) {
    try { const r = await companyApi.supportAccess(hours); setData({ ...data!, company: { ...c, supportAccessUntil: r.supportAccessUntil } }); addToast({ type: 'success', message: hours ? 'Metriq support can sign in to help.' : 'Help sign-in stopped.' }) }
    catch (err) { addToast({ type: 'error', message: errMsg(err, 'Could not change it.') }) }
  }
  const u = data.usage
  return (
    <>
    <Card title="Company" subtitle={c.kind === 'PERSONAL' ? 'Your own workspace' : `On Metriq since ${new Date(c.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`}>
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-body-sm font-semibold text-ink">Name</span>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} disabled={!data.canEdit} />
        </label>
        <label className="block">
          <span className="mb-1 block text-body-sm font-semibold text-ink">Time zone</span>
          <select className={inputCls} value={tz} onChange={(e) => setTz(e.target.value)} disabled={!data.canEdit || data.timeZoneLocked}>
            {!all.includes(tz) && <option value={tz}>{tz}</option>}
            {all.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
          </select>
          <span className="mt-1 block text-body-sm text-ink-muted">
            {data.timeZoneLocked ? 'Set on the server for 99 Technologies.' : 'Which day a check-in, daily log or report belongs to. A person on other hours can have their own in Working hours.'}
          </span>
        </label>
        {data.canEdit && <div className="sm:col-span-2"><Button type="submit" disabled={saving || !changed || name.trim().length < 2}>{saving ? 'Saving…' : 'Save'}</Button></div>}
      </form>
    </Card>
    {u && (
      <Card title="Your plan" subtitle={c.home ? 'Internal: no limits.' : 'Change it in Billing.'}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Use label="People" used={String(u.people.used)} limit={u.people.limit === null ? null : String(u.people.limit)} pct={u.people.limit ? u.people.used / u.people.limit : 0} />
          <Use label="Files" used={gb(u.storage.usedBytes)} limit={u.storage.limitBytes === null ? null : gb(u.storage.limitBytes)} pct={u.storage.limitBytes ? u.storage.usedBytes / u.storage.limitBytes : 0} />
          <Use label="AI meeting notes this month" used={`${u.aiHours.used} h`} limit={u.aiHours.limit === null ? null : `${u.aiHours.limit} h`} pct={u.aiHours.limit ? u.aiHours.used / u.aiHours.limit : 0} />
        </div>
      </Card>
    )}
    {data.canEdit && !c.home && (
      <Card title="Help from Metriq support" subtitle="When you ask us for help, you can let us see Metriq as one of your people for a while. You see it in your activity log, and they see a banner the whole time. Finance stays closed to us.">
        <div className="flex flex-wrap items-center gap-2">
          {c.supportAccessUntil ? (
            <>
              <Badge tone="warning">Allowed until {new Date(c.supportAccessUntil).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</Badge>
              <Button size="sm" variant="secondary" onClick={() => allow(0)}>Stop now</Button>
            </>
          ) : ([[24, 'Allow for a day'], [72, 'For 3 days'], [168, 'For a week']] as const).map(([h, l]) => <Button key={h} size="sm" variant={h === 24 ? 'primary' : 'secondary'} onClick={() => allow(h)}>{l}</Button>)}
        </div>
      </Card>
    )}
    </>
  )
}

const gb = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(0)} MB` : `${Math.round(n / 1024)} KB`)
function Use({ label, used, limit, pct }: { label: string; used: string; limit: string | null; pct: number }) {
  return (
    <div>
      <p className="text-body-sm text-ink-muted">{label}</p>
      <p className="mt-0.5 text-body-lg font-semibold tabular-nums text-ink">{used}<span className="text-body-sm font-normal text-ink-muted">{limit === null ? '' : ` of ${limit}`}</span></p>
      {limit !== null && <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={cn('h-full rounded-full', pct >= 1 ? 'bg-danger' : pct >= 0.8 ? 'bg-warning' : 'bg-primary')} style={{ width: `${Math.min(100, pct * 100)}%` }} /></div>}
    </div>
  )
}

// ------------------------------------------------------------------ departments

function DepartmentsTab() {
  const { addToast } = useToast()
  const [list, setList] = useState<CompanyDepartment[] | null>(null)
  const [kinds, setKinds] = useState<DepartmentKind[]>([])
  const [name, setName] = useState('')
  const [type, setType] = useState<Department>('GENERAL')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { companyApi.departments().then((r) => { setList(r.departments); setKinds(r.kinds) }).catch(() => addToast({ type: 'error', message: 'Could not load departments.' })) }, [addToast])

  async function run(p: Promise<{ departments: CompanyDepartment[] }>, ok: string) {
    setBusy(true)
    try { setList((await p).departments); addToast({ type: 'success', message: ok }); return true }
    catch (err) { addToast({ type: 'error', message: errMsg(err, 'Something went wrong.') }); return false }
    finally { setBusy(false) }
  }
  const taken = new Set((list ?? []).filter((d) => d.type !== 'GENERAL').map((d) => d.type))
  const kind = kinds.find((k) => k.type === type)

  return (
    <div className="space-y-5">
      <Card title="Departments" subtitle="People belong to a department; built-in kinds come with their own screens." flush>
        {!list ? <p className="px-5 py-4 text-body-md text-ink-muted">Loading…</p> : list.length === 0 ? <p className="px-5 py-4 text-body-md text-ink-muted">No departments yet. Add your first one below.</p> : (
          <ul className="divide-y divide-line">
            {list.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                {editing?.id === d.id ? (
                  <form className="flex min-w-0 flex-1 items-center gap-2" onSubmit={async (e) => { e.preventDefault(); if (await run(companyApi.renameDepartment(d.id, editing.name.trim()), 'Renamed.')) setEditing(null) }}>
                    <input autoFocus className={inputCls + ' !h-9'} value={editing.name} onChange={(e) => setEditing({ id: d.id, name: e.target.value })} maxLength={60} />
                    <Button size="sm" type="submit" disabled={busy || editing.name.trim().length < 2} aria-label="Save name"><Check size={15} /></Button>
                    <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(null)} aria-label="Cancel"><X size={15} /></Button>
                  </form>
                ) : (
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body-md font-semibold text-ink">{d.name}</p>
                    <p className="text-body-sm text-ink-muted">{d.kind} · {d.people === 1 ? '1 person' : `${d.people} people`}</p>
                  </div>
                )}
                {editing?.id !== d.id && (
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing({ id: d.id, name: d.name })} aria-label={`Rename ${d.name}`}><Pencil size={15} /></Button>
                    <Button size="sm" variant="ghost" disabled={busy || d.people > 0} title={d.people > 0 ? 'Move its people to another department first' : 'Remove'} onClick={() => run(companyApi.removeDepartment(d.id), `${d.name} removed.`)} aria-label={`Remove ${d.name}`}><Trash2 size={15} /></Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Add a department">
        <form className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={async (e) => { e.preventDefault(); if (await run(companyApi.addDepartment({ name: name.trim(), type }), `${name.trim()} added.`)) { setName(''); setType('GENERAL') } }}>
          <label className="block"><span className="mb-1 block text-body-sm font-semibold text-ink">Name</span><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Operations" maxLength={60} /></label>
          <label className="block"><span className="mb-1 block text-body-sm font-semibold text-ink">Kind</span>
            <select className={inputCls} value={type} onChange={(e) => setType(e.target.value as Department)}>
              {kinds.map((k) => <option key={k.type} value={k.type} disabled={taken.has(k.type)}>{k.label}{taken.has(k.type) ? ' (you have one)' : ''}</option>)}
            </select>
          </label>
          <Button type="submit" leadingIcon={<Plus size={16} />} disabled={busy || name.trim().length < 2}>Add</Button>
          {kind && <p className="text-body-sm text-ink-muted sm:col-span-3">{kind.description}</p>}
        </form>
      </Card>
    </div>
  )
}

// ------------------------------------------------------------------ roles

function RolesTab() {
  const { addToast } = useToast()
  const { user } = useAuth()
  const [data, setData] = useState<RolesData | null>(null)
  const [editing, setEditing] = useState<CompanyRoleRow | 'new' | null>(null)
  useEffect(() => { companyApi.roles().then(setData).catch(() => addToast({ type: 'error', message: 'Could not load roles.' })) }, [addToast])
  if (!data) return <Card><p className="text-body-md text-ink-muted">Loading…</p></Card>
  const powerLabel = (k: string) => data.powers.find((p) => p.key === k)?.label ?? k
  return (
    <div className="space-y-5">
      <Card title="Your roles" subtitle="Start from a built-in role, switch off the parts of Metriq it should not see, and add extra powers." action={<Button size="sm" leadingIcon={<Plus size={15} />} onClick={() => setEditing('new')}>New role</Button>} flush>
        {data.roles.length === 0 ? <p className="px-5 py-4 text-body-md text-ink-muted">None yet. Everyone has one of the built-in roles below.</p> : (
          <ul className="divide-y divide-line">
            {data.roles.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-body-md font-semibold text-ink">{r.name}</p>
                    <Badge tone="neutral">from {r.baseLabel}</Badge>
                    {r.powers.map((p) => <Badge key={p} tone="accent">{powerLabel(p)}</Badge>)}
                  </div>
                  <p className="mt-0.5 text-body-sm text-ink-muted">
                    {r.areasOff.length ? `Does not see: ${r.areasOff.map((a) => data.areas.find((x) => x.key === a)?.label ?? a).join(', ')}` : 'Sees everything its built-in role sees'} · {r.people === 1 ? '1 person' : `${r.people} people`}
                  </p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => setEditing(r)}>Edit</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Built-in roles" subtitle="Always there, and they do not change." flush>
        <ul className="divide-y divide-line">
          {data.builtIn.map((b) => (
            <li key={b.role} className="flex flex-wrap items-center gap-2 px-5 py-3">
              <span className="min-w-[160px] text-body-md font-medium text-ink">{b.label}</span>
              {b.powers.map((p) => <Badge key={p} tone="neutral">{powerLabel(p)}</Badge>)}
            </li>
          ))}
        </ul>
      </Card>
      {editing && <RoleModal data={data} role={editing === 'new' ? null : editing} myPowers={user?.permissions ?? []} isSuperAdmin={user?.role === 'SUPER_ADMIN'} onClose={() => setEditing(null)} onSaved={(roles) => { setData({ ...data, roles }); setEditing(null) }} />}
    </div>
  )
}

function RoleModal({ data, role, myPowers, isSuperAdmin, onClose, onSaved }: { data: RolesData; role: CompanyRoleRow | null; myPowers: string[]; isSuperAdmin: boolean; onClose: () => void; onSaved: (roles: CompanyRoleRow[]) => void }) {
  const { addToast } = useToast()
  const [name, setName] = useState(role?.name ?? '')
  const [baseRole, setBaseRole] = useState<Role>(role?.baseRole ?? 'MEMBER')
  const [off, setOff] = useState<string[]>(role?.areasOff ?? [])
  const [powers, setPowers] = useState<string[]>(role?.powers ?? [])
  const [busy, setBusy] = useState(false)
  const flip = (list: string[], k: string, on: boolean) => (on ? [...new Set([...list, k])] : list.filter((x) => x !== k))
  async function save() {
    setBusy(true)
    try {
      const r = role ? await companyApi.updateRole(role.id, { name: name.trim(), areasOff: off, powers }) : await companyApi.addRole({ name: name.trim(), baseRole, areasOff: off, powers })
      addToast({ type: 'success', message: role ? 'Role saved.' : 'Role made.' })
      onSaved(r.roles)
    } catch (err) { addToast({ type: 'error', message: errMsg(err, 'Could not save the role.') }) } finally { setBusy(false) }
  }
  async function remove() {
    if (!role) return
    setBusy(true)
    try { onSaved((await companyApi.removeRole(role.id)).roles); addToast({ type: 'success', message: `${role.name} removed. Its people keep their built-in role.` }) }
    catch (err) { addToast({ type: 'error', message: errMsg(err, 'Could not remove the role.') }) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={role ? `Edit ${role.name}` : 'New role'}
      footer={<>
        {role && <Button variant="ghost" className="mr-auto text-danger" onClick={remove} disabled={busy}>Remove role</Button>}
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={busy || name.trim().length < 2}>{busy ? 'Saving…' : 'Save'}</Button>
      </>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="mb-1 block text-body-sm font-semibold text-ink">Name</span><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Caller" maxLength={40} /></label>
          <label className="block"><span className="mb-1 block text-body-sm font-semibold text-ink">Starts from</span>
            <select className={inputCls} value={baseRole} onChange={(e) => setBaseRole(e.target.value as Role)} disabled={!!role}>
              {data.builtIn.filter((b) => b.role !== 'SUPER_ADMIN' || isSuperAdmin).map((b) => <option key={b.role} value={b.role}>{b.label}</option>)}
            </select>
          </label>
        </div>
        <div>
          <p className="mb-1.5 text-body-sm font-semibold text-ink">What it sees</p>
          <div className="grid gap-x-6 gap-y-1 rounded-btn border border-line p-3 sm:grid-cols-2">
            {data.areas.map((a) => (
              <div key={a.key} className="flex items-center justify-between gap-3 py-1">
                <span className="text-body-md text-ink">{a.label}</span>
                <Toggle checked={!off.includes(a.key)} onChange={(v) => setOff(flip(off, a.key, !v))} label={`${a.label} for ${name || 'this role'}`} />
              </div>
            ))}
          </div>
          <p className="mt-1 text-body-sm text-ink-muted">A part that is on is still only shown when the built-in role and department would show it.</p>
        </div>
        <div>
          <p className="mb-1.5 text-body-sm font-semibold text-ink">Extra powers</p>
          <div className="space-y-2">
            {data.powers.map((p) => {
              const mine = myPowers.includes(p.key) || powers.includes(p.key)
              return (
                <label key={p.key} className={cn('flex items-start gap-3 rounded-btn border border-line p-3', !mine && 'opacity-60')}>
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={powers.includes(p.key)} disabled={!mine} onChange={(e) => setPowers(flip(powers, p.key, e.target.checked))} />
                  <span><span className="block text-body-md font-medium text-ink">{p.label}</span><span className="block text-body-sm text-ink-muted">{p.description}{!mine ? ' (you do not have this power)' : ''}</span></span>
                </label>
              )
            })}
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ people

function PeopleTab() {
  const { addToast } = useToast()
  const { user } = useAuth()
  const [people, setPeople] = useState<CompanyPerson[] | null>(null)
  const [roles, setRoles] = useState<RolesData | null>(null)
  const [q, setQ] = useState('')
  useEffect(() => {
    Promise.all([companyApi.people(), companyApi.roles()]).then(([p, r]) => { setPeople(p.people); setRoles(r) }).catch(() => addToast({ type: 'error', message: 'Could not load people.' }))
  }, [addToast])
  if (!people || !roles) return <Card><p className="text-body-md text-ink-muted">Loading…</p></Card>
  async function set(p: CompanyPerson, input: { customRoleId?: string | null; permissions?: string[] }) {
    const before = people
    setPeople(people!.map((x) => (x.id === p.id ? { ...x, ...input } : x)))
    try { await companyApi.updatePerson(p.id, input); addToast({ type: 'success', message: `${p.name} updated.` }) }
    catch (err) { setPeople(before); addToast({ type: 'error', message: errMsg(err, 'Could not update.') }) }
  }
  const shown = people.filter((p) => !q.trim() || `${p.name} ${p.email} ${p.department ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <Card title="People" subtitle="Give someone one of your roles (made from their built-in role) or an extra power. Their built-in role and departments are set in Users." flush>
      <div className="border-b border-line px-5 py-3"><input className={inputCls + ' !h-9 max-w-xs'} placeholder="Search people…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <ul className="divide-y divide-line">
        {shown.map((p) => {
          const fits = roles.roles.filter((r) => r.baseRole === p.role)
          return (
            <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-[180px] flex-1">
                <p className="truncate text-body-md font-medium text-ink">{p.name}</p>
                <p className="truncate text-body-sm text-ink-muted">{ROLE_LABEL[p.role]}{p.department ? ` · ${p.department}` : ''}</p>
              </div>
              <select className={inputCls + ' !h-9 !w-auto min-w-[150px]'} value={p.customRoleId ?? ''} onChange={(e) => set(p, { customRoleId: e.target.value || null })} aria-label={`Role for ${p.name}`}>
                <option value="">{ROLE_LABEL[p.role]} (built-in)</option>
                {fits.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <div className="flex flex-wrap gap-1.5">
                {roles.powers.map((w) => {
                  const on = p.permissions.includes(w.key)
                  const can = (user?.permissions ?? []).includes(w.key)
                  return (
                    <button key={w.key} type="button" disabled={!can} onClick={() => set(p, { permissions: on ? p.permissions.filter((x) => x !== w.key) : [...p.permissions, w.key] })}
                      title={can ? w.description : 'You do not have this power'}
                      className={cn('rounded-full border px-2.5 py-1 text-body-sm transition-colors disabled:opacity-50', on ? 'border-primary bg-primary/10 text-primary' : 'border-line text-ink-muted hover:text-ink')}>
                      {w.label}
                    </button>
                  )
                })}
              </div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
