import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Bell, HelpCircle, ChevronDown, Settings, LogOut, AlertTriangle, Clock, Info, CheckCircle2, ChevronRight, ArrowLeft, Menu } from 'lucide-react'
import { ROLE_LABEL, type CurrentUser } from '../../lib/types'
import { useAuth } from '../../lib/auth'
import { getNotifications, type AppNotification } from '../../lib/notificationsApi'
import { RangeSelector, type RangeKey, type CustomRange } from './RangeSelector'
import { Avatar } from './Sidebar'
import { ClockWidget } from '../attendance/ClockWidget'

export interface TopBarProps {
  user: CurrentUser
  range: RangeKey
  custom: CustomRange | null
  onRangeChange: (range: RangeKey) => void
  onApplyCustom: (range: CustomRange) => void
  /** Opens the mobile navigation drawer (hamburger). */
  onMenu?: () => void
}

const NOTIF_ICON: Record<AppNotification['type'], React.ReactNode> = {
  reminder: <Clock size={16} className="text-warning" />,
  alert: <AlertTriangle size={16} className="text-danger" />,
  info: <Info size={16} className="text-primary" />,
}

/** Notifications that drill into a page when clicked. */
const NOTIF_LINK: Record<string, string> = {
  'team-missing': '/app/team/not-submitted',
  'feedback-unread': '/app/feedback',
  'qa-unread': '/app/qa/my',
  'qa-coaching': '/app/qa/analytics',
  'stock-requests': '/app/ecommerce/stock',
  'stock-assigned': '/app/ecommerce/stock',
}

export function TopBar({ user, range, custom, onRangeChange, onApplyCustom, onMenu }: TopBarProps) {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [notifs, setNotifs] = useState<AppNotification[]>([])
  const [seenKey, setSeenKey] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  const notifRef = useRef<HTMLDivElement>(null)

  // Load once, then poll so new feedback / alerts surface without a refresh.
  useEffect(() => {
    let active = true
    const load = () =>
      getNotifications()
        .then((r) => active && setNotifs(r.notifications))
        .catch(() => undefined)
    load()
    const timer = setInterval(load, 30000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false)
        setNotifOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  async function handleLogout() {
    setMenuOpen(false)
    await logout()
    navigate('/login', { replace: true })
  }

  // Signature includes the body so a changing count (e.g. 1→2 unread) re-dots.
  const notifKey = notifs.map((n) => `${n.id}|${n.body}`).join(';')
  const hasUnread = notifs.length > 0 && notifKey !== seenKey

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b border-line bg-card px-3 sm:gap-4 sm:px-6">
      {/* Hamburger — opens the nav drawer on mobile */}
      <button
        onClick={onMenu}
        className="shrink-0 rounded-btn p-2 text-ink-muted hover:bg-slate-100 hover:text-ink lg:hidden"
        aria-label="Open menu"
      >
        <Menu size={22} />
      </button>

      <button
        onClick={() => navigate(-1)}
        className="hidden shrink-0 rounded-btn p-2 text-ink-muted hover:bg-slate-100 hover:text-ink sm:block"
        aria-label="Go back"
        title="Go back"
      >
        <ArrowLeft size={20} />
      </button>

      <div className="relative hidden max-w-md flex-1 md:block">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
        <input
          type="search"
          placeholder="Search anything..."
          className="h-10 w-full rounded-btn border border-line bg-bg pl-10 pr-3 text-body-md text-ink placeholder:text-ink-muted focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10"
        />
      </div>

      <div className="min-w-0 md:hidden" />

      <RangeSelector value={range} onChange={onRangeChange} custom={custom} onApplyCustom={onApplyCustom} />

      <div className="ml-auto flex items-center gap-1">
        {/* Attendance clock */}
        <ClockWidget />

        <div className="mx-1 h-6 w-px bg-line" />

        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => { setNotifOpen((o) => !o); setSeenKey(notifKey) }}
            className="relative rounded-btn p-2 text-ink-muted hover:bg-slate-100 hover:text-ink"
            aria-label="Notifications"
          >
            <Bell size={20} />
            {hasUnread && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-danger ring-2 ring-card" />}
          </button>
          {notifOpen && (
            <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-80 animate-scale-in overflow-hidden rounded-card border border-line bg-card shadow-overlay">
              <div className="border-b border-line px-4 py-3 text-body-md font-semibold text-ink">Notifications</div>
              {notifs.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                  <CheckCircle2 size={22} className="text-success" />
                  <p className="text-body-sm text-ink-muted">You're all caught up.</p>
                </div>
              ) : (
                <ul className="max-h-80 divide-y divide-line overflow-y-auto">
                  {notifs.map((n) =>
                    NOTIF_LINK[n.id] ? (
                      <li key={n.id}>
                        <button
                          onClick={() => { setNotifOpen(false); navigate(NOTIF_LINK[n.id]) }}
                          className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
                        >
                          <span className="mt-0.5 shrink-0">{NOTIF_ICON[n.type]}</span>
                          <div className="min-w-0 flex-1">
                            <p className="text-body-md font-medium text-ink">{n.title}</p>
                            <p className="text-body-sm text-ink-muted">{n.body}</p>
                          </div>
                          <ChevronRight size={16} className="shrink-0 text-ink-muted" />
                        </button>
                      </li>
                    ) : (
                      <li key={n.id} className="flex gap-3 px-4 py-3 hover:bg-slate-50">
                        <span className="mt-0.5 shrink-0">{NOTIF_ICON[n.type]}</span>
                        <div className="min-w-0">
                          <p className="text-body-md font-medium text-ink">{n.title}</p>
                          <p className="text-body-sm text-ink-muted">{n.body}</p>
                        </div>
                      </li>
                    ),
                  )}
                </ul>
              )}
            </div>
          )}
        </div>

        <button className="hidden rounded-btn p-2 text-ink-muted hover:bg-slate-100 hover:text-ink sm:inline-flex" aria-label="Help">
          <HelpCircle size={20} />
        </button>

        <div className="mx-2 hidden h-6 w-px bg-line sm:block" />

        {/* Avatar + menu */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-2 rounded-btn p-1 pr-2 hover:bg-slate-100"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <Avatar user={user} size={32} />
            <div className="hidden text-left sm:block">
              <div className="text-body-sm font-semibold leading-tight text-ink">{user.name}</div>
              <div className="text-[11px] leading-tight text-ink-muted">{ROLE_LABEL[user.role]}</div>
            </div>
            <ChevronDown size={16} className={'text-ink-muted transition-transform ' + (menuOpen ? 'rotate-180' : '')} />
          </button>

          {menuOpen && (
            <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-60 animate-scale-in overflow-hidden rounded-card border border-line bg-card shadow-overlay">
              <div className="border-b border-line px-4 py-3">
                <div className="truncate text-body-md font-semibold text-ink">{user.name}</div>
                <div className="truncate text-body-sm text-ink-muted">{user.email}</div>
              </div>
              <div className="p-1">
                <MenuItem icon={<Settings size={16} />} label="Settings" onClick={() => { setMenuOpen(false); navigate('/app/settings') }} />
              </div>
              <div className="border-t border-line p-1">
                <MenuItem icon={<LogOut size={16} />} label="Log out" danger onClick={handleLogout} />
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

function MenuItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={
        'flex w-full items-center gap-2.5 rounded-btn px-3 py-2 text-body-md font-medium transition-colors ' +
        (danger ? 'text-danger hover:bg-danger/10' : 'text-ink hover:bg-slate-100')
      }
    >
      {icon}
      {label}
    </button>
  )
}
