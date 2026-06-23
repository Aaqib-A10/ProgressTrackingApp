import { useState, type FormEvent } from 'react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { TextField, PasswordField } from '../../components/ui/Input'
import { Toggle } from '../../components/ui/Toggle'
import { Avatar } from '../../components/layout/Sidebar'
import { useToast } from '../../components/ui/Toast'
import { useAuth } from '../../lib/auth'
import { api, ApiError } from '../../lib/api'
import { ROLE_LABEL } from '../../lib/types'

const NOTIF_KEY = 'pulsetrack.notifications'
const NOTIFS = [
  { key: 'reminders', label: 'Daily submission reminders', desc: 'Remind me if I haven’t logged by end of day.' },
  { key: 'weekly', label: 'Weekly report email', desc: 'Email me the weekly team report.' },
  { key: 'targets', label: 'Target alerts', desc: 'Alert me when a target is missed.' },
]

function loadNotifs(): Record<string, boolean> {
  try {
    return { reminders: true, weekly: true, targets: false, ...JSON.parse(localStorage.getItem(NOTIF_KEY) || '{}') }
  } catch {
    return { reminders: true, weekly: true, targets: false }
  }
}

export default function Settings() {
  const { user, updateProfile } = useAuth()
  const { addToast } = useToast()
  const [name, setName] = useState(user?.name ?? '')
  const [savingName, setSavingName] = useState(false)

  const [curPw, setCurPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [pwError, setPwError] = useState<string>()
  const [savingPw, setSavingPw] = useState(false)

  const [notifs, setNotifs] = useState<Record<string, boolean>>(loadNotifs)

  if (!user) return null

  async function saveName(e: FormEvent) {
    e.preventDefault()
    setSavingName(true)
    try {
      await updateProfile(name)
      addToast({ type: 'success', message: 'Profile updated.' })
    } catch {
      addToast({ type: 'error', message: 'Could not update profile.' })
    } finally {
      setSavingName(false)
    }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault()
    setPwError(undefined)
    if (newPw.length < 8) return setPwError('New password must be at least 8 characters')
    setSavingPw(true)
    try {
      await api.post('/auth/change-password', { currentPassword: curPw, newPassword: newPw })
      setCurPw(''); setNewPw('')
      addToast({ type: 'success', message: 'Password changed.' })
    } catch (err) {
      setPwError(err instanceof ApiError ? err.message : 'Could not change password.')
    } finally {
      setSavingPw(false)
    }
  }

  function toggleNotif(key: string) {
    setNotifs((n) => {
      const next = { ...n, [key]: !n[key] }
      localStorage.setItem(NOTIF_KEY, JSON.stringify(next))
      return next
    })
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-headline-lg text-ink">Settings</h1>

      {/* Profile */}
      <Card title="Profile">
        <div className="mb-5 flex items-center gap-4">
          <Avatar user={user} size={56} />
          <div>
            <div className="text-headline-md text-ink">{user.name}</div>
            <div className="text-body-sm text-ink-muted">{user.email}</div>
          </div>
        </div>
        <form onSubmit={saveName} className="space-y-4">
          <TextField label="Display name" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-body-sm font-semibold text-ink">Role</label>
              <div className="rounded-btn border border-line bg-bg px-3 py-2 text-body-md text-ink-muted">{ROLE_LABEL[user.role]}</div>
            </div>
            <div>
              <label className="mb-1 block text-body-sm font-semibold text-ink">Department</label>
              <div className="rounded-btn border border-line bg-bg px-3 py-2 text-body-md text-ink-muted">{user.department ? user.department.replace('_', ' ') : '—'}{user.subDepartment ? ` / ${user.subDepartment}` : ''}</div>
            </div>
          </div>
          <Button type="submit" disabled={savingName || name === user.name}>{savingName ? 'Saving…' : 'Save changes'}</Button>
        </form>
      </Card>

      {/* Security */}
      <Card title="Security" subtitle="Change your password">
        <form onSubmit={savePassword} className="space-y-4">
          <PasswordField label="Current password" value={curPw} onChange={(e) => setCurPw(e.target.value)} autoComplete="current-password" />
          <PasswordField label="New password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" />
          {pwError && <p className="rounded-btn bg-danger/10 px-3 py-2 text-body-sm text-danger">{pwError}</p>}
          <Button type="submit" disabled={savingPw || !curPw || !newPw}>{savingPw ? 'Saving…' : 'Change password'}</Button>
        </form>
      </Card>

      {/* Notifications */}
      <Card title="Notifications" subtitle="Preferences (saved on this device)">
        <ul className="divide-y divide-line">
          {NOTIFS.map((n) => (
            <li key={n.key} className="flex items-center justify-between py-3">
              <div>
                <div className="text-body-md font-medium text-ink">{n.label}</div>
                <div className="text-body-sm text-ink-muted">{n.desc}</div>
              </div>
              <Toggle checked={notifs[n.key]} onChange={() => toggleNotif(n.key)} label={n.label} />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
