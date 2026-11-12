import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, AtSign, Bell, BellOff, Settings, CalendarClock, CalendarDays, CheckCheck, CheckCircle2, ChevronDown, ChevronUp, ClipboardCheck, ClipboardList, Flag, Inbox, MessageSquare, Sparkles, UserPlus } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { fmtAgo, fmtDateTime } from '../../components/projects/pmUi'
import { getMutedCategories, getNotificationHistory, getNotifications, markAllNotificationsRead, markNotificationRead, saveMutedCategories, type StoredNotification } from '../../lib/notificationsApi'
import { NOTIFY_CATEGORIES, type NotifyCategory } from '../../lib/notifyCategories'
import { NotifyTabs } from '../../components/layout/NotifyTabs'
import { Toggle } from '../../components/ui/Toggle'
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
  LEAD_NEW: <Inbox size={16} className="text-primary" />,
  LEAD_ASSIGNED: <Inbox size={16} className="text-accent" />,
  LEAD_SLA: <AlertTriangle size={16} className="text-danger" />,
  LEAD_TASK: <CalendarClock size={16} className="text-warning" />,
  LEAD_COMMENT: <MessageSquare size={16} className="text-primary" />,
  LEAD_REVIEW: <Flag size={16} className="text-warning" />,
  LEAD_DECISION: <CheckCircle2 size={16} className="text-success" />,
  AI_INSIGHT: <Sparkles size={16} className="text-accent" />,
}

type Tab = 'all' | NotifyCategory

/** /app/notifications — full history of stored notifications (read and unread). */
export default function Notifications() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('all')
  const [rows, setRows] = useState<StoredNotification[] | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [prefsOpen, setPrefsOpen] = useState(false)
  const [muted, setMuted] = useState<NotifyCategory[]>([])
  const [unread, setUnread] = useState<Partial<Record<NotifyCategory, number>>>({})
  // System is collapsed by default in the All tab.
  const [systemOpen, setSystemOpen] = useState(false)

  const category = tab === 'all' ? undefined : tab
  const load = (c?: string | null) => getNotificationHistory(c ?? undefined, category).then((r) => { setRows((cur) => (c ? [...(cur ?? []), ...r.notifications] : r.notifications)); setCursor(r.nextCursor) })
  // Unread per tab (the bell's list: stored, unread).
  const loadCounts = () => getNotifications().then((r) => {
    const by: Partial<Record<NotifyCategory, number>> = {}
    for (const n of r.notifications) if (n.persistent) by[n.category] = (by[n.category] ?? 0) + 1
    setUnread(by)
    setMuted(r.muted ?? [])
  }).catch(() => undefined)
  useEffect(() => { setRows(null); setCursor(null); load() }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadCounts(); getMutedCategories().then((r) => setMuted(r.muted)).catch(() => undefined) }, [])

  const toggleMute = (c: NotifyCategory, on: boolean) => {
    const before = muted
    const next = on ? [...muted.filter((x) => x !== c), c] : muted.filter((x) => x !== c)
    setMuted(next)
    saveMutedCategories(next).then((r) => setMuted(r.muted)).catch(() => setMuted(before))
  }
  const markTabRead = () => markAllNotificationsRead(category).then(() => {
    setRows((r) => r?.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) ?? r)
    loadCounts()
  })

  const shown = (rows ?? []).filter((n) => filter === 'all' || !n.readAt)
  const main = tab === 'all' ? shown.filter((n) => n.category !== 'system') : shown
  const system = tab === 'all' ? shown.filter((n) => n.category === 'system') : []
  const tabs = [
    { key: 'all' as Tab, label: 'All', count: NOTIFY_CATEGORIES.reduce((sum, c) => sum + (muted.includes(c.key) ? 0 : unread[c.key] ?? 0), 0) },
    ...NOTIFY_CATEGORIES.map((c) => ({ key: c.key as Tab, label: c.label, count: unread[c.key] ?? 0, muted: muted.includes(c.key) })),
  ]
  const tabMuted = tab !== 'all' && muted.includes(tab)

  const item = (n: StoredNotification) => {
    const isMuted = muted.includes(n.category)
    return (
      <li key={n.id}>
        <button
          type="button"
          onClick={() => { if (!n.readAt) { markNotificationRead(n.id).then(loadCounts).catch(() => undefined) } setRows((r) => r?.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)) ?? r); if (n.link) navigate(n.link) }}
          className={cn('flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50', !n.readAt && 'bg-primary/[0.04]')}
        >
          <span className="mt-0.5 shrink-0">{ICON[n.type] ?? <Bell size={16} className="text-ink-muted" />}</span>
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
            <span className={cn('block text-body-md text-ink', !n.readAt && 'font-semibold')}>{n.title}</span>
            <span className="block text-body-sm text-ink-muted">{n.body}</span>
            {(n.leadStatus || isMuted) && (
              <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-muted">
                {n.leadStatus && <span className="rounded-full bg-primary/10 px-1.5 font-semibold text-primary">{n.leadStatus}</span>}
                {isMuted && <span className="inline-flex items-center gap-1"><BellOff size={11} /> muted</span>}
              </span>
            )}
          </span>
          <span className="shrink-0 text-body-sm text-ink-muted" title={fmtDateTime(n.createdAt)}>{fmtAgo(n.createdAt)}</span>
          {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
        </button>
      </li>
    )
  }

  return (
    <div className="mx-auto w-full max-w-[1800px] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">Notifications</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">Follow ups, tasks, new leads, AI insights and system alerts.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-btn border border-line bg-card p-0.5">
            {(['all', 'unread'] as const).map((f) => <button key={f} type="button" onClick={() => setFilter(f)} className={cn('h-7 rounded-md px-3 text-body-sm font-semibold capitalize', filter === f ? 'bg-primary text-white' : 'text-ink-muted')}>{f}</button>)}
          </div>
          <Button size="sm" variant="secondary" leadingIcon={<Settings size={15} />} onClick={() => setPrefsOpen(true)}><span className="max-sm:hidden">Notification </span>Settings</Button>
          <Button size="sm" variant="secondary" leadingIcon={<CheckCheck size={15} />} onClick={markTabRead}>Mark all read</Button>
        </div>
      </div>
      <NotifyTabs tabs={tabs} value={tab} onChange={setTab} className="-mx-1 px-1 pb-0.5 max-sm:-mx-4 max-sm:px-4" />
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-card border border-line bg-card px-4 py-2.5 shadow-card">
        <span className="flex items-center gap-1.5 text-body-sm font-semibold text-ink"><BellOff size={14} className="text-ink-muted" /> Mute</span>
        {NOTIFY_CATEGORIES.map((c) => (
          <label key={c.key} className="flex items-center gap-2 text-body-sm text-ink-muted">
            <Toggle checked={muted.includes(c.key)} onChange={(on) => toggleMute(c.key, on)} label={`Mute ${c.label}`} />
            {c.label}
          </label>
        ))}
        <span className="text-body-sm text-ink-muted max-md:w-full">Muted: no pop-ups or phone push, not in the badge. Still listed here.</span>
      </div>
      <div className="overflow-hidden rounded-card border border-line bg-card shadow-card">
        {tabMuted && <p className="flex items-center gap-1.5 border-b border-line px-4 py-2 text-body-sm text-ink-muted"><BellOff size={13} /> This tab is muted.</p>}
        {!rows ? <div className="space-y-2 p-4">{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-10 animate-pulse rounded bg-slate-100" />)}</div> : shown.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-14 text-center"><Bell size={24} className="text-ink-muted" /><p className="text-body-md text-ink-muted">{filter === 'unread' ? "You're all caught up." : 'No notifications yet.'}</p></div>
        ) : (
          <ul className="divide-y divide-line">
            {main.map(item)}
            {system.length > 0 && (
              <li>
                <button
                  type="button"
                  onClick={() => setSystemOpen((o) => !o)}
                  aria-expanded={systemOpen}
                  className="flex w-full items-center gap-2 bg-slate-50 px-4 py-2.5 text-left text-body-sm font-semibold text-ink-muted hover:text-ink dark:bg-white/[0.03]"
                >
                  {muted.includes('system') && <BellOff size={13} />}
                  <span className="flex-1">System · {system.length}</span>
                  {systemOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                </button>
              </li>
            )}
            {systemOpen && system.map(item)}
          </ul>
        )}
      </div>
      {cursor && <div className="text-center"><Button variant="secondary" size="sm" onClick={() => load(cursor)}>Load older</Button></div>}
      {prefsOpen && <NotificationPrefsModal onClose={() => setPrefsOpen(false)} />}
    </div>
  )
}
