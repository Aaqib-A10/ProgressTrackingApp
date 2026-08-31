import { useEffect, useMemo, useState } from 'react'
import { Monitor, Smartphone, Tablet } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Badge, type BadgeTone } from '../../../components/ui/Badge'
import { PillFilter } from '../../../components/ui/PillFilter'
import { DataTable, type Column } from '../../../components/DataTable'
import { useRange } from '../../../components/layout/AppShell'
import { useToast } from '../../../components/ui/Toast'
import { listUsers, listLoginEvents, listAuditLog, type AdminUser, type LoginEvent, type AuditEntry } from '../../../lib/adminApi'

type Tab = 'signins' | 'activity'
const sel = 'h-10 rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
const DEVICE_ICON: Record<string, React.ReactNode> = {
  Mobile: <Smartphone size={13} />, Tablet: <Tablet size={13} />, Desktop: <Monitor size={13} />,
}
const ACTION_TONE: Record<string, BadgeTone> = { CREATE: 'success', UPDATE: 'primary', DELETE: 'danger' }
// Friendly labels for the data-change audit entities.
const ENTITY_LABEL: Record<string, string> = {
  ItadDailyEntry: 'ITAD daily log',
  LeadGenDailyEntry: 'Lead Gen daily log',
  TalkloopDailyEntry: 'Talkloop daily log',
  EcommerceDailyEntry: 'Ecommerce daily log',
  AttendanceDay: 'Attendance day',
  StockRequest: 'Stock request',
  Target: 'Target',
}
const entityLabel = (t: string) => ENTITY_LABEL[t] ?? t

export default function AdminActivity() {
  const { range, custom } = useRange()
  const { addToast } = useToast()
  const [tab, setTab] = useState<Tab>('signins')
  const [users, setUsers] = useState<AdminUser[]>([])
  const [userId, setUserId] = useState('')
  const [events, setEvents] = useState<LoginEvent[] | null>(null)
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)

  useEffect(() => { listUsers().then((r) => setUsers(r.users)).catch(() => undefined) }, [])

  useEffect(() => {
    let active = true
    const uid = userId || undefined
    if (tab === 'signins') {
      setEvents(null)
      listLoginEvents(range, custom, uid).then((r) => active && setEvents(r.events)).catch(() => active && addToast({ type: 'error', message: 'Could not load sign-ins.' }))
    } else {
      setEntries(null)
      listAuditLog(range, custom, uid).then((r) => active && setEntries(r.entries)).catch(() => active && addToast({ type: 'error', message: 'Could not load activity.' }))
    }
    return () => { active = false }
  }, [tab, range, custom, userId, addToast])

  const userOptions = useMemo(() => [...users].sort((a, b) => a.name.localeCompare(b.name)), [users])

  const signinCols: Column<LoginEvent>[] = [
    { key: 'user', header: 'Member', render: (e) => <span className="font-medium text-ink">{e.userName}</span> },
    { key: 'when', header: 'When', render: (e) => when(e.createdAt) },
    { key: 'device', header: 'Device', render: (e) => (
      <span className="flex items-center gap-1.5 text-ink">
        {e.device && <span className="text-ink-muted">{DEVICE_ICON[e.device]}</span>}
        {[e.browser, e.os].filter(Boolean).join(' · ') || '—'}
        {e.kind === 'SIGNUP' && <Badge tone="accent">signup</Badge>}
      </span>
    ) },
    { key: 'ip', header: 'IP', render: (e) => <span className="tabular-nums text-ink-muted">{e.ip ?? '—'}</span> },
  ]

  const activityCols: Column<AuditEntry>[] = [
    { key: 'user', header: 'Member', render: (a) => <span className="font-medium text-ink">{a.userName}</span> },
    { key: 'when', header: 'When', render: (a) => when(a.createdAt) },
    { key: 'action', header: 'Action', render: (a) => <Badge tone={ACTION_TONE[a.action] ?? 'neutral'}>{a.action.toLowerCase()}</Badge> },
    { key: 'what', header: 'What', render: (a) => entityLabel(a.entityType) },
  ]

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-headline-lg text-ink">Activity Log</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">Sign-ins (who, when, device, IP) and data-change activity. Use the range filter in the top bar.</p>
        </div>
        <div>
          <label className="mb-1 block text-body-sm font-semibold text-ink">Member</label>
          <select className={sel} value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">All members</option>
            {userOptions.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      </div>

      <PillFilter
        options={[{ value: 'signins', label: 'Sign-ins' }, { value: 'activity', label: 'Activity' }]}
        value={tab}
        onChange={(v) => setTab(v as Tab)}
      />

      {tab === 'signins' ? (
        <Card flush>
          {events == null
            ? <div className="p-5 text-body-md text-ink-muted">Loading…</div>
            : <DataTable columns={signinCols} rows={events} getRowId={(e) => e.id} emptyMessage="No sign-ins in this range." />}
        </Card>
      ) : (
        <Card flush>
          {entries == null
            ? <div className="p-5 text-body-md text-ink-muted">Loading…</div>
            : <DataTable columns={activityCols} rows={entries} getRowId={(a) => a.id} emptyMessage="No activity in this range." />}
        </Card>
      )}
      <p className="-mt-3 px-1 text-body-sm text-ink-muted">Showing the most recent 500 in the selected range.</p>
    </div>
  )
}
