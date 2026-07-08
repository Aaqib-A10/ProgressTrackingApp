import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2, UserPlus, UserMinus, RotateCcw, KeyRound, Copy } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Badge, type BadgeTone } from '../../components/ui/Badge'
import { Modal } from '../../components/ui/Modal'
import { TextField } from '../../components/ui/Input'
import { DataTable, type Column } from '../../components/DataTable'
import { ListToolbar } from '../../components/ListToolbar'
import { useToast } from '../../components/ui/Toast'
import { useAuth } from '../../lib/auth'
import { ApiError } from '../../lib/api'
import { fromNow } from '../../lib/datetime'
import { ROLE_LABEL, type UserStatus } from '../../lib/types'
import {
  listTeamMembers,
  inviteTeamMember,
  removeTeamMember,
  resetTeamMemberPassword,
  listTeamHistory,
  type TeamMember,
  type TeamEvent,
  type TeamEventType,
} from '../../lib/adminApi'

const STATUS_META: Record<UserStatus, { label: string; tone: BadgeTone }> = {
  ACTIVE: { label: 'Active', tone: 'success' },
  PENDING: { label: 'Pending', tone: 'warning' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
}
const EVENT_META: Record<TeamEventType, { label: string; tone: BadgeTone; icon: typeof UserPlus }> = {
  INVITED: { label: 'Invited', tone: 'success', icon: UserPlus },
  REMOVED: { label: 'Removed', tone: 'danger', icon: UserMinus },
  REACTIVATED: { label: 'Reactivated', tone: 'accent', icon: RotateCcw },
}
const SUBDEPTS = [
  { value: 'seo', label: 'SEO' },
  { value: 'social', label: 'Social Media' },
  { value: 'content', label: 'Content Creation' },
]
const sel = 'h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'

/** Team Lead's roster — invite/remove employees and review the full team history. */
export default function TeamMembers() {
  const { user } = useAuth()
  const { addToast } = useToast()
  const navigate = useNavigate()
  const [members, setMembers] = useState<TeamMember[]>([])
  const [events, setEvents] = useState<TeamEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [toRemove, setToRemove] = useState<TeamMember | null>(null)
  const [removing, setRemoving] = useState(false)
  const [toReset, setToReset] = useState<TeamMember | null>(null)
  const [query, setQuery] = useState('')

  const filteredMembers = useMemo(() => {
    const q = query.trim().toLowerCase()
    return !q ? members : members.filter((m) => [m.name, m.email].some((f) => (f ?? '').toLowerCase().includes(q)))
  }, [members, query])

  const copyPw = useCallback((text: string) => {
    navigator.clipboard?.writeText(text).then(
      () => addToast({ type: 'success', message: 'Password copied' }),
      () => undefined,
    )
  }, [addToast])

  const loadHistory = useCallback(() => {
    listTeamHistory()
      .then((r) => setEvents(r.events))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    let active = true
    Promise.all([listTeamMembers(), listTeamHistory()])
      .then(([m, h]) => {
        if (!active) return
        setMembers(m.members)
        setEvents(h.events)
      })
      .catch(() => active && addToast({ type: 'error', message: 'Could not load your team.' }))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [addToast])

  async function confirmRemove() {
    if (!toRemove || removing) return
    setRemoving(true)
    try {
      await removeTeamMember(toRemove.id)
      setMembers((ms) => ms.filter((m) => m.id !== toRemove.id))
      addToast({ type: 'success', message: `${toRemove.name} removed — their access is disabled.` })
      setToRemove(null)
      loadHistory()
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Could not remove member.'
      addToast({ type: 'error', message: msg })
    } finally {
      setRemoving(false)
    }
  }

  const isMarketing = user?.department === 'MARKETING'

  const columns: Column<TeamMember>[] = [
    { key: 'name', header: 'Name', render: (m) => <span className="font-medium text-ink">{m.name}</span> },
    { key: 'email', header: 'Email', render: (m) => <span className="text-ink-muted">{m.email}</span> },
    { key: 'role', header: 'Role', render: (m) => ROLE_LABEL[m.role] + (m.subDepartment ? ` · ${m.subDepartment}` : '') },
    { key: 'status', header: 'Status', render: (m) => <Badge tone={STATUS_META[m.status].tone} dot>{STATUS_META[m.status].label}</Badge> },
    {
      key: 'password',
      header: 'Password',
      render: (m) =>
        m.tempPassword ? (
          <span className="inline-flex items-center gap-1.5">
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-body-sm text-ink">{m.tempPassword}</code>
            <button onClick={(e) => { e.stopPropagation(); copyPw(m.tempPassword!) }} className="text-ink-muted hover:text-ink" title="Copy password" aria-label="Copy password">
              <Copy size={14} />
            </button>
          </span>
        ) : (
          <span className="text-body-sm text-ink-muted">Set by member</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (m) => (
        <div className="inline-flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); setToReset(m) }}
            className="inline-flex h-8 w-8 items-center justify-center rounded-btn text-ink-muted hover:bg-primary/10 hover:text-primary"
            aria-label={`Reset password for ${m.name}`}
            title="Reset / change password"
          >
            <KeyRound size={16} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setToRemove(m) }}
            className="inline-flex h-8 w-8 items-center justify-center rounded-btn text-ink-muted hover:bg-danger/10 hover:text-danger"
            aria-label={`Remove ${m.name}`}
            title="Remove from team"
          >
            <Trash2 size={16} />
          </button>
        </div>
      ),
    },
  ]

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">My Team</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">
            {user?.department ? `${user.department.replace('_', ' ')} · ` : ''}Invite and manage your department’s members.
          </p>
        </div>
        <Button size="sm" leadingIcon={<Plus size={16} />} onClick={() => setOpen(true)}>Invite Member</Button>
      </div>

      <Card title="Active members" subtitle="Only members with access appear here" flush>
        {loading ? (
          <div className="p-5 text-body-md text-ink-muted">Loading…</div>
        ) : (
          <>
            <div className="border-b border-line px-4 py-2.5">
              <ListToolbar query={query} onQuery={setQuery} placeholder="Search members by name or email…" />
            </div>
            <DataTable columns={columns} rows={filteredMembers} getRowId={(m) => m.id} onRowClick={(m) => navigate(`/app/members/${m.id}`)} emptyMessage={query ? 'No members match your search.' : 'No active members — invite your first employee.'} />
          </>
        )}
      </Card>

      <Card title="Team History" subtitle="Everyone invited to or removed from your team">
        {loading ? (
          <p className="text-body-sm text-ink-muted">Loading…</p>
        ) : events.length === 0 ? (
          <p className="py-6 text-center text-body-sm text-ink-muted">No team activity yet.</p>
        ) : (
          <ul className="space-y-1">
            {events.map((e) => {
              const meta = EVENT_META[e.type]
              const Icon = meta.icon
              return (
                <li key={e.id} className="flex items-center gap-3 rounded-btn px-2 py-2 hover:bg-slate-50">
                  <span className={'flex h-8 w-8 shrink-0 items-center justify-center rounded-full ' + toneBg(meta.tone)}>
                    <Icon size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-body-md text-ink">
                      <span className="font-semibold">{e.memberName}</span>{' '}
                      <span className="text-ink-muted">({e.memberEmail})</span>
                    </p>
                    <p className="text-body-sm text-ink-muted">
                      {meta.label} by {e.actorName} · {fromNow(e.createdAt)}
                    </p>
                  </div>
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <InviteModal
        open={open}
        isMarketing={isMarketing}
        onClose={() => setOpen(false)}
        onCreated={(m) => {
          setMembers((ms) => [m, ...ms])
          loadHistory()
        }}
      />

      <Modal
        open={!!toRemove}
        onClose={() => setToRemove(null)}
        title="Remove team member"
        footer={
          <>
            <Button variant="secondary" onClick={() => setToRemove(null)}>Cancel</Button>
            <Button className="!bg-danger hover:!bg-danger/90" onClick={confirmRemove} disabled={removing}>
              {removing ? 'Removing…' : 'Remove'}
            </Button>
          </>
        }
      >
        <p className="text-body-md text-ink">
          Remove <span className="font-semibold">{toRemove?.name}</span> from your team? Their access will be disabled
          immediately. This is recorded in Team History and can be reversed by an admin.
        </p>
      </Modal>

      {toReset && (
        <ResetPasswordModal
          member={toReset}
          onClose={() => setToReset(null)}
          onDone={(id, pw) => setMembers((ms) => ms.map((m) => (m.id === id ? { ...m, tempPassword: pw } : m)))}
        />
      )}
    </div>
  )
}

/** Reset or set a specific member's password and reveal the new value to the Team Lead. */
function ResetPasswordModal({
  member,
  onClose,
  onDone,
}: {
  member: TeamMember
  onClose: () => void
  onDone: (id: string, password: string) => void
}) {
  const { addToast } = useToast()
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(useCustom: boolean) {
    if (busy) return
    if (useCustom && pw.trim().length < 8) {
      addToast({ type: 'error', message: 'Password must be at least 8 characters' })
      return
    }
    setBusy(true)
    try {
      const res = await resetTeamMemberPassword(member.id, useCustom ? pw.trim() : undefined)
      onDone(member.id, res.tempPassword)
      addToast({ type: 'success', message: `New password for ${member.name}: ${res.tempPassword}`, duration: 9000 })
      onClose()
    } catch (err) {
      addToast({ type: 'error', message: err instanceof ApiError ? err.message : 'Could not reset password.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Reset password — ${member.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={() => submit(false)} disabled={busy}>Generate random</Button>
          <Button onClick={() => submit(true)} disabled={busy || pw.trim().length < 8}>Set password</Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-body-md text-ink-muted">
          Set a password for <span className="font-medium text-ink">{member.email}</span>, or generate a random one.
          The new password is shown in the roster so you can share it; it disappears once the member changes it.
        </p>
        <TextField
          label="New password (min 8 chars)"
          placeholder="Leave blank to generate randomly"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
        />
      </div>
    </Modal>
  )
}

function toneBg(tone: BadgeTone): string {
  switch (tone) {
    case 'success':
      return 'bg-success/10 text-success'
    case 'danger':
      return 'bg-danger/10 text-danger'
    case 'accent':
      return 'bg-accent/10 text-accent'
    default:
      return 'bg-slate-100 text-ink-muted'
  }
}

function InviteModal({
  open,
  isMarketing,
  onClose,
  onCreated,
}: {
  open: boolean
  isMarketing: boolean
  onClose: () => void
  onCreated: (m: TeamMember) => void
}) {
  const { addToast } = useToast()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [subDept, setSubDept] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || !email.trim() || submitting) return
    setSubmitting(true)
    try {
      const res = await inviteTeamMember({ name, email, subDepartmentSlug: isMarketing ? subDept || null : null })
      onCreated(res.member)
      addToast({ type: 'success', message: `Invited ${res.member.name}. Temp password: ${res.tempPassword}`, duration: 9000 })
      setName(''); setEmail(''); setSubDept('')
      onClose()
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Could not invite member.'
      addToast({ type: 'error', message: msg })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Invite Member"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting}>{submitting ? 'Inviting…' : 'Invite'}</Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-3.5">
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Full name" value={name} onChange={(e) => setName(e.target.value)} />
          <TextField label="Work email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        {isMarketing && (
          <div>
            <label className="mb-1 block text-body-sm font-semibold text-ink">Sub-department</label>
            <select className={sel} value={subDept} onChange={(e) => setSubDept(e.target.value)}>
              <option value="">None</option>
              {SUBDEPTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
        )}
        <p className="text-body-sm text-ink-muted">
          The member joins your department immediately. A temporary password is generated and shown after you invite them.
        </p>
      </form>
    </Modal>
  )
}
