import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, AtSign, Bell, Settings, CalendarClock, CalendarDays, CheckCheck, CheckCircle2, ClipboardCheck, ClipboardList, MessageSquare, UserPlus } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { fmtAgo, fmtDateTime } from '../../components/projects/pmUi'
import { getNotificationHistory, markAllNotificationsRead, markNotificationRead, type StoredNotification } from '../../lib/notificationsApi'
import { cn } from '../../lib/cn'
import { NotificationPrefsModal } from '../../components/projects/NotificationPrefsModal'

const ICON: Record<string, JSX.Element> = {
  TASK_OVERDUE: <AlertTriangle size={16} className="text-danger" />,
  TASK_DUE_SOON: <CalendarClock size={16} className="text-warning" />,
  TASK_ASSIGNED: <ClipboardList size={16} className="text-primary" />,
  TASK_COMPLETED: <CheckCircle2 size={16} className="text-success" />,
  TASK_COMMENT: <MessageSquare size={16} className="text-primary" />,
  MENTION: <AtSign size={16} className="text-primary" />,
  PROJECT_MEMBER_ADDED: <UserPlus size={16} className="text-accent" />,
  EXTENSION_REQUESTED: <CalendarClock size={16} className="text-warning" />,
  TASK_REVIEW: <ClipboardCheck size={16} className="text-accent" />,
  MEETING: <CalendarDays size={16} className="text-primary" />,
  CHAT_MESSAGE: <MessageSquare size={16} className="text-primary" />,
}

/** /app/notifications — full history of stored notifications (read and unread). */
export default function Notifications() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<StoredNotification[] | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [prefsOpen, setPrefsOpen] = useState(false)

  const load = (c?: string | null) => getNotificationHistory(c ?? undefined).then((r) => { setRows((cur) => (c ? [...(cur ?? []), ...r.notifications] : r.notifications)); setCursor(r.nextCursor) })
  useEffect(() => { load() }, [])

  const shown = (rows ?? []).filter((n) => filter === 'all' || !n.readAt)
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">Notifications</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">Task assignments, deadlines, mentions and project updates.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-btn border border-line bg-card p-0.5">
            {(['all', 'unread'] as const).map((f) => <button key={f} type="button" onClick={() => setFilter(f)} className={cn('h-7 rounded-md px-3 text-body-sm font-semibold capitalize', filter === f ? 'bg-primary text-white' : 'text-ink-muted')}>{f}</button>)}
          </div>
          <Button size="sm" variant="secondary" leadingIcon={<Settings size={15} />} onClick={() => setPrefsOpen(true)}>Notification settings</Button>
          <Button size="sm" variant="secondary" leadingIcon={<CheckCheck size={15} />} onClick={() => markAllNotificationsRead().then(() => setRows((r) => r?.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) ?? r))}>Mark all read</Button>
        </div>
      </div>
      <div className="overflow-hidden rounded-card border border-line bg-card shadow-card">
        {!rows ? <div className="space-y-2 p-4">{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-10 animate-pulse rounded bg-slate-100" />)}</div> : shown.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-14 text-center"><Bell size={24} className="text-ink-muted" /><p className="text-body-md text-ink-muted">{filter === 'unread' ? "You're all caught up." : 'No notifications yet.'}</p></div>
        ) : (
          <ul className="divide-y divide-line">
            {shown.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => { if (!n.readAt) markNotificationRead(n.id).catch(() => undefined); setRows((r) => r?.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)) ?? r); if (n.link) navigate(n.link) }}
                  className={cn('flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50', !n.readAt && 'bg-primary/[0.04]')}
                >
                  <span className="mt-0.5 shrink-0">{ICON[n.type] ?? <Bell size={16} className="text-ink-muted" />}</span>
                  <span className="min-w-0 flex-1">
                    <span className={cn('block text-body-md text-ink', !n.readAt && 'font-semibold')}>{n.title}</span>
                    <span className="block text-body-sm text-ink-muted">{n.body}</span>
                  </span>
                  <span className="shrink-0 text-body-sm text-ink-muted" title={fmtDateTime(n.createdAt)}>{fmtAgo(n.createdAt)}</span>
                  {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {cursor && <div className="text-center"><Button variant="secondary" size="sm" onClick={() => load(cursor)}>Load older</Button></div>}
      {prefsOpen && <NotificationPrefsModal onClose={() => setPrefsOpen(false)} />}
    </div>
  )
}
