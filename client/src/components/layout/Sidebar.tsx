import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Activity, Settings, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '../../lib/cn'
import { ROLE_LABEL, type CurrentUser } from '../../lib/types'
import { Badge } from '../ui/Badge'
import { getUnreadFeedbackCount } from '../../lib/feedbackApi'
import { getQaUnreadCount } from '../../lib/qaApi'
import { filterNav, type NavGroup } from './navConfig'

const NAV_STORE = 'pt-nav-expanded'
const pathInGroup = (group: NavGroup, path: string) =>
  group.items.some((i) => path === i.to || path.startsWith(i.to + '/'))

function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

export function Sidebar({ user }: { user: CurrentUser }) {
  const groups = filterNav(user.role, user.department)
  const location = useLocation()
  const [unreadFeedback, setUnreadFeedback] = useState(0)
  const [unreadQa, setUnreadQa] = useState(0)

  // Collapsible department sections. Default: only the section for the current
  // route is open; choices persist in localStorage.
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    let saved: Record<string, boolean> = {}
    try { saved = JSON.parse(localStorage.getItem(NAV_STORE) || '{}') } catch { /* ignore */ }
    const init: Record<string, boolean> = {}
    for (const g of groups) if (g.title) init[g.title] = g.title in saved ? saved[g.title] : pathInGroup(g, location.pathname)
    return init
  })
  function toggleGroup(title: string) {
    setExpanded((prev) => {
      const next = { ...prev, [title]: !prev[title] }
      try { localStorage.setItem(NAV_STORE, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }
  // Keep the section for the current route open as you navigate.
  useEffect(() => {
    const active = groups.find((g) => g.title && pathInGroup(g, location.pathname))
    if (active?.title) setExpanded((prev) => (prev[active.title!] ? prev : { ...prev, [active.title!]: true }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  // Poll unread counts; also refetch on navigation (reading marks as read).
  useEffect(() => {
    let active = true
    const load = () => {
      getUnreadFeedbackCount().then((r) => active && setUnreadFeedback(r.count)).catch(() => undefined)
      getQaUnreadCount().then((r) => active && setUnreadQa(r.count)).catch(() => undefined)
    }
    load()
    const timer = setInterval(load, 30000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [location.pathname])

  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col border-r border-line bg-card">
      {/* Brand — normalized to PulseTrack everywhere */}
      <div className="flex items-center gap-3 px-5 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-btn bg-primary text-white">
          <Activity size={20} />
        </div>
        <div>
          <div className="text-headline-md leading-tight text-ink">PulseTrack</div>
          <div className="text-body-sm text-ink-muted">Performance Suite</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-2">
        {groups.map((group, gi) => {
          const collapsible = !!group.title
          const isOpen = !collapsible || expanded[group.title!]
          return (
          <div key={group.title ?? gi} className="mb-3">
            {group.title && (
              <button
                type="button"
                onClick={() => toggleGroup(group.title!)}
                className="flex w-full items-center justify-between rounded-btn px-3 pb-1 pt-2 text-label-md uppercase text-ink-muted/70 transition-colors hover:text-ink-muted"
                aria-expanded={isOpen}
              >
                <span>{group.title}</span>
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            )}
            {isOpen && (
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon
                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      className={({ isActive }) =>
                        cn(
                          'group relative flex items-center gap-3 rounded-btn px-3 py-2 text-body-md font-medium transition-colors',
                          isActive
                            ? 'bg-slate-100 text-primary'
                            : 'text-ink-muted hover:bg-slate-50 hover:text-ink',
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && (
                            <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary" />
                          )}
                          <Icon size={18} className="shrink-0" />
                          <span className="flex-1">{item.label}</span>
                          {item.to === '/app/feedback' && unreadFeedback > 0 && (
                            <span className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-danger px-1 text-[11px] font-semibold tabular-nums text-white">
                              {unreadFeedback > 9 ? '9+' : unreadFeedback}
                            </span>
                          )}
                          {item.to === '/app/qa/my' && unreadQa > 0 && (
                            <span className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-danger px-1 text-[11px] font-semibold tabular-nums text-white">
                              {unreadQa > 9 ? '9+' : unreadQa}
                            </span>
                          )}
                          {item.badge && (
                            <Badge tone={item.badge.tone} className="px-1.5 py-0 text-[10px]">
                              {item.badge.text}
                            </Badge>
                          )}
                        </>
                      )}
                    </NavLink>
                  </li>
                )
              })}
            </ul>
            )}
          </div>
          )
        })}
      </nav>

      {/* Footer links + user card */}
      <div className="border-t border-line px-3 py-3">
        <ul className="mb-2 space-y-0.5">
          <li>
            <NavLink
              to="/app/settings"
              className="flex items-center gap-3 rounded-btn px-3 py-2 text-body-md font-medium text-ink-muted hover:bg-slate-50 hover:text-ink"
            >
              <Settings size={18} /> Settings
            </NavLink>
          </li>
        </ul>
        <div className="flex items-center gap-3 rounded-btn px-3 py-2">
          <Avatar user={user} />
          <div className="min-w-0">
            <div className="truncate text-body-md font-semibold text-ink">{user.name}</div>
            <div className="truncate text-body-sm text-ink-muted">{ROLE_LABEL[user.role]}</div>
          </div>
        </div>
      </div>
    </aside>
  )
}

export function Avatar({ user, size = 36 }: { user: CurrentUser; size?: number }) {
  if (user.avatarUrl) {
    return (
      <img
        src={user.avatarUrl}
        alt={user.name}
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <div
      className="flex items-center justify-center rounded-full bg-primary/10 text-body-sm font-semibold text-primary"
      style={{ width: size, height: size }}
    >
      {initials(user.name)}
    </div>
  )
}
