import { useEffect, useState, type FormEvent } from 'react'
import { Plus, Check, X, Trash2, Eye, EyeOff, Copy, RotateCcw } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { Badge, type BadgeTone } from '../../../components/ui/Badge'
import { Modal } from '../../../components/ui/Modal'
import { TextField } from '../../../components/ui/Input'
import { DataTable, type Column } from '../../../components/DataTable'
import { useToast } from '../../../components/ui/Toast'
import { ROLE_LABEL, type Role, type Department, type UserStatus } from '../../../lib/types'
import { DEPARTMENTS } from '../../../lib/departments'
import { listUsers, createUser, updateUser, deleteUser, resetUserPassword, type AdminUser } from '../../../lib/adminApi'

const STATUS_META: Record<UserStatus, { label: string; tone: BadgeTone }> = {
  ACTIVE: { label: 'Active', tone: 'success' },
  PENDING: { label: 'Pending', tone: 'warning' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
}

const ROLES: Role[] = ['MEMBER', 'TEAM_LEAD', 'SUB_DEPT_LEAD', 'QA', 'QA_LEAD', 'SUPER_ADMIN']
const SUBDEPTS = [
  { value: 'seo', label: 'SEO' },
  { value: 'social', label: 'Social Media' },
  { value: 'content', label: 'Content Creation' },
]
const sel = 'rounded-btn border border-line bg-card px-2 py-1 text-body-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20'

export default function AdminUsers() {
  const { addToast } = useToast()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    listUsers()
      .then((r) => setUsers(r.users))
      .catch(() => addToast({ type: 'error', message: 'Could not load users.' }))
      .finally(() => setLoading(false))
  }, [addToast])

  function patch(id: string, p: Parameters<typeof updateUser>[1]) {
    const prev = users
    setUsers((us) => us.map((u) => (u.id === id ? { ...u, ...p, department: (p.department ?? u.department) as Department | null } : u)))
    updateUser(id, p)
      .then((r) => setUsers((us) => us.map((u) => (u.id === id ? r.user : u))))
      .catch(() => {
        setUsers(prev)
        addToast({ type: 'error', message: 'Update failed.' })
      })
  }

  async function resetPw(u: AdminUser) {
    try {
      const { tempPassword } = await resetUserPassword(u.id)
      setUsers((us) => us.map((x) => (x.id === u.id ? { ...x, tempPassword } : x)))
      addToast({ type: 'success', message: `New temp password for ${u.name}: ${tempPassword}`, duration: 12000 })
    } catch (e) {
      addToast({ type: 'error', message: (e as { message?: string })?.message || 'Could not reset password.' })
    }
  }

  function remove(u: AdminUser) {
    if (!window.confirm(`Delete ${u.name} (${u.email})? This permanently removes the account and their daily entries. This cannot be undone.`)) return
    const prev = users
    setUsers((us) => us.filter((x) => x.id !== u.id))
    deleteUser(u.id)
      .then(() => addToast({ type: 'success', message: `${u.name} deleted.` }))
      .catch((e) => {
        setUsers(prev)
        addToast({ type: 'error', message: (e as { message?: string })?.message || 'Could not delete user.' })
      })
  }

  const pending = users.filter((u) => u.status === 'PENDING')

  const columns: Column<AdminUser>[] = [
    {
      key: 'name',
      header: 'User',
      render: (u) => (
        <div className="min-w-0 max-w-[170px]">
          <div className="truncate font-medium text-ink">{u.name}</div>
          <div className="truncate text-body-sm text-ink-muted">{u.email}</div>
        </div>
      ),
    },
    { key: 'department', header: 'Department', render: (u) => (u.department ? u.department.replace('_', ' ') : '—') + (u.subDepartment ? ` / ${u.subDepartment}` : '') },
    {
      key: 'role',
      header: 'Role',
      render: (u) => (
        <select className={sel + ' max-w-[116px]'} value={u.role} onChange={(e) => patch(u.id, { role: e.target.value as Role })}>
          {ROLES.map((r) => (
            <option key={r} value={r}>{ROLE_LABEL[r]}</option>
          ))}
        </select>
      ),
    },
    {
      key: 'enabled',
      header: 'Status',
      render: (u) => (
        <button onClick={() => patch(u.id, { isActive: !u.isActive })} title="Toggle enabled">
          <Badge tone={u.status !== 'ACTIVE' ? STATUS_META[u.status].tone : u.isActive ? 'success' : 'neutral'} dot>
            {u.status !== 'ACTIVE' ? STATUS_META[u.status].label : u.isActive ? 'Enabled' : 'Disabled'}
          </Badge>
        </button>
      ),
    },
    {
      key: 'password',
      header: 'Temp password',
      render: (u) => <PasswordCell u={u} />,
    },
    {
      key: 'actions',
      header: 'Manage',
      align: 'right',
      headerClassName: 'sticky right-0 z-20 bg-bg',
      className: 'sticky right-0 z-10 bg-card shadow-[-8px_0_8px_-8px_rgba(15,23,42,0.12)]',
      render: (u) => (
        <div className="flex items-center justify-end gap-0.5">
          <button onClick={() => resetPw(u)} className="flex h-8 w-8 items-center justify-center rounded-btn text-ink-muted hover:bg-slate-100 hover:text-primary" aria-label={`Reset password for ${u.name}`} title="Reset password">
            <RotateCcw size={15} />
          </button>
          <button onClick={() => remove(u)} className="flex h-8 w-8 items-center justify-center rounded-btn text-ink-muted hover:bg-danger/10 hover:text-danger" aria-label={`Delete ${u.name}`} title="Delete user">
            <Trash2 size={16} />
          </button>
        </div>
      ),
    },
  ]

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-headline-lg text-ink">User Management</h1>
        <Button size="sm" leadingIcon={<Plus size={16} />} onClick={() => setOpen(true)}>Invite User</Button>
      </div>

      {pending.length > 0 && (
        <Card title="Pending Team Lead requests" subtitle={`${pending.length} awaiting your review`}>
          <ul className="divide-y divide-line">
            {pending.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-body-md font-medium text-ink">{u.name}</p>
                  <p className="text-body-sm text-ink-muted">
                    {u.email} · {u.department ? u.department.replace('_', ' ') : 'No department'}
                  </p>
                </div>
                <Button size="sm" variant="secondary" leadingIcon={<Check size={16} />} onClick={() => patch(u.id, { status: 'ACTIVE' })}>
                  Approve
                </Button>
                <Button size="sm" variant="ghost" leadingIcon={<X size={16} />} className="!text-danger hover:!bg-danger/10" onClick={() => patch(u.id, { status: 'REJECTED' })}>
                  Reject
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card flush>
        {loading ? <div className="p-5 text-body-md text-ink-muted">Loading…</div> : <DataTable columns={columns} rows={users} getRowId={(u) => u.id} />}
      </Card>
      <InviteModal open={open} onClose={() => setOpen(false)} onCreated={(u) => setUsers((us) => [u, ...us])} />
    </div>
  )
}

function PasswordCell({ u }: { u: AdminUser }) {
  const { addToast } = useToast()
  const [show, setShow] = useState(false)
  const pw = u.tempPassword
  if (!pw) return <span className="text-body-sm text-ink-muted">set by user</span>
  return (
    <div className="flex items-center gap-1.5">
      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-body-sm text-ink">{show ? pw : '••••••'}</code>
      <button onClick={() => setShow((s) => !s)} className="text-ink-muted hover:text-ink" title={show ? 'Hide' : 'Show'}>{show ? <EyeOff size={14} /> : <Eye size={14} />}</button>
      <button onClick={() => { navigator.clipboard?.writeText(pw); addToast({ type: 'success', message: 'Copied.' }) }} className="text-ink-muted hover:text-ink" title="Copy">
        <Copy size={14} />
      </button>
    </div>
  )
}

function InviteModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (u: AdminUser) => void }) {
  const { addToast } = useToast()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('MEMBER')
  const [department, setDepartment] = useState<Department | ''>('')
  const [subDept, setSubDept] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || !email.trim()) return
    setSubmitting(true)
    try {
      const res = await createUser({
        name,
        email,
        role,
        department: department || null,
        subDepartmentSlug: department === 'MARKETING' ? subDept || null : null,
      })
      onCreated({ ...res.user, tempPassword: res.tempPassword ?? res.user.tempPassword ?? null })
      addToast({ type: 'success', message: res.tempPassword ? `Created. Temp password: ${res.tempPassword}` : 'User created.', duration: 9000 })
      setName(''); setEmail(''); setRole('MEMBER'); setDepartment(''); setSubDept('')
      onClose()
    } catch {
      addToast({ type: 'error', message: 'Could not create user (email may be in use).' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Invite User" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={submitting}>Create</Button></>}>
      <form onSubmit={submit} className="space-y-3.5">
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Full name" value={name} onChange={(e) => setName(e.target.value)} />
          <TextField label="Work email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-body-sm font-semibold text-ink">Role</label>
            <select className={sel + ' h-10 w-full'} value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-body-sm font-semibold text-ink">Department</label>
            <select className={sel + ' h-10 w-full'} value={department} onChange={(e) => setDepartment(e.target.value as Department)}>
              <option value="">None</option>
              {DEPARTMENTS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </div>
        </div>
        {department === 'MARKETING' && (
          <div>
            <label className="mb-1 block text-body-sm font-semibold text-ink">Sub-department</label>
            <select className={sel + ' h-10 w-full'} value={subDept} onChange={(e) => setSubDept(e.target.value)}>
              <option value="">None</option>
              {SUBDEPTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
        )}
        <p className="text-body-sm text-ink-muted">A temporary password is generated and shown after creation.</p>
      </form>
    </Modal>
  )
}
