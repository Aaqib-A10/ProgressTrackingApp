import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Activity, Settings, ChevronRight, Search, X } from 'lucide-react'
import { cn } from '../../lib/cn'
import { ROLE_LABEL, type CurrentUser } from '../../lib/types'
import { Badge } from '../ui/Badge'
import { getUnreadFeedbackCount } from '../../lib/feedbackApi'
import { getQaUnreadCount } from '../../lib/qaApi'
import { filterNav, type NavGroup } from './navConfig'

const NAV_STORE = 'pt-nav-expanded'
const matches = (to: string, path: string) => path === to || path.startsWith(to + '/')
const pathInGroup = (group: NavGroup, path: string) =>
  group.items.some((i) => matches(i.to, path)) ||
  (group.subgroups?.some((sg) => sg.items.some((i) => matches(i.to, path))) ?? false)
// Stable collapse key for a nested subgroup.
const subKey = (groupTitle: string, subTitle: string) => `${groupTitle} › ${subTitle}`

function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

export function Sidebar({ user, onNavigate }: { user: CurrentUser; onNavigate?: () => void }) {
  const groups = filterNav(user.role, user.department)
  const location = useLocation()
  const [unreadFeedback, setUnreadFeedback] = useState(0)
  const [unreadQa, setUnreadQa] = useState(0)
  const [query, setQuery] = useState('')

  // "Jump to…" filter: narrows nav to items whose label matches. When active,
  // every group/subgroup is force-expanded and non-matching ones are hidden.
  const q = query.trim().toLowerCase()
  const visibleGroups: NavGroup[] = q
    ? groups
        .map((g) => ({
          ...g,
          items: g.items.filter((i) => i.label.toLowerCase().includes(q)),
          subgroups: g.subgroups
            ?.map((sg) => ({ ...sg, items: sg.items.filter((i) => i.label.toLowerCase().includes(q)) }))
            .filter((sg) => sg.items.length > 0),
        }))
        .filter((g) => g.items.length > 0 || (g.subgroups?.length ?? 0) > 0)
    : groups

  // Top-level (department) section titles — the accordion group. At most one of
  // these is open at a time. Subgroup keys (containing ' › ') are exempt.
  const groupTitles = groups.filter((g) => g.title).map((g) => g.title!)

  // Collapsible department sections. Default: only the section for the current
  // route is open; choices persist in localStorage.
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    let saved: Record<string, boolean> = {}
    try { saved = JSON.parse(localStorage.getItem(NAV_STORE) || '{}') } catch { /* ignore */ }
    const init: Record<string, boolean> = {}
    for (const g of groups) {
      if (g.title) init[g.title] = g.title in saved ? saved[g.title] : pathInGroup(g, location.pathname)
      for (const sg of g.subgroups ?? []) {
        const key = subKey(g.title ?? '', sg.title)
        init[key] = key in saved ? saved[key] : sg.items.some((i) => matches(i.to, location.pathname))
      }
    }
    // Accordion invariant: keep at most one top-level section open on first paint
    // (a previously-saved multi-open state would otherwise violate it).
    const openTitles = groupTitles.filter((t) => init[t])
    if (openTitles.length > 1) {
      const keep = groups.find((g) => g.title && pathInGroup(g, location.pathname))?.title ?? openTitles[0]
      for (const t of groupTitles) init[t] = t === keep
    }
    return init
  })
  function toggleGroup(title: string) {
    setExpanded((prev) => {
      let next: Record<string, boolean>
      if (groupTitles.includes(title)) {
        // Top-level section: open this one and close all other sections.
        const willOpen = !prev[title]
        next = { ...prev }
        for (const t of groupTitles) next[t] = willOpen && t === title
      } else {
        // Subgroup: independent single-key toggle.
        next = { ...prev, [title]: !prev[title] }
      }
      try { localStorage.setItem(NAV_STORE, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }
  // Keep the current route's section open (and, per the accordion rule, close the
  // others) as you navigate.
  useEffect(() => {
    const active = groups.find((g) => g.title && pathInGroup(g, location.pathname))
    if (!active?.title) return
    setExpanded((prev) => {
      if (prev[active.title!] && groupTitles.every((t) => (t === active.title) === !!prev[t])) return prev
      const next = { ...prev }
      for (const t of groupTitles) next[t] = t === active.title
      try { localStorage.setItem(NAV_STORE, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
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

  const renderItems = (items: typeof groups[number]['items'], nested = false) => (
    <ul className={cn('space-y-0.5', nested && 'ml-3 border-l border-line/60 pl-2')}>
      {items.map((item) => {
        const Icon = item.icon
        return (
          <li key={item.to}>
            <NavLink
              to={item.to}
              onClick={() => { setQuery(''); onNavigate?.() }}
              className={({ isActive }) =>
                cn(
                  'group relative flex items-center gap-3 rounded-btn px-3 py-2 text-body-md transition-colors',
                  isActive
                    ? 'bg-primary/10 font-semibold text-primary'
                    : 'font-medium text-ink-muted hover:bg-slate-50 hover:text-ink',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary" />}
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
  )

  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col border-r border-line bg-card">
      {/* Brand — normalized to PulseTrack everywhere */}
      <div className="flex items-center gap-3 px-5 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-btn bg-primary text-white">
          <Activity size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-headline-md leading-tight text-ink">PulseTrack</div>
          <div className="text-body-sm text-ink-muted">Performance Suite</div>
        </div>
        {/* Close (mobile drawer only) */}
        <button
          type="button"
          onClick={onNavigate}
          className="-mr-1 rounded-btn p-1.5 text-ink-muted hover:bg-slate-100 hover:text-ink lg:hidden"
          aria-label="Close menu"
        >
          <X size={20} />
        </button>
      </div>

      {/* Jump-to filter */}
      <div className="px-3 pb-1 pt-2">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
            placeholder="Jump to…"
            aria-label="Filter navigation"
            className="w-full rounded-btn border border-line bg-slate-50 py-1.5 pl-8 pr-7 text-body-sm text-ink transition-colors placeholder:text-ink-muted focus:border-primary focus:bg-card focus:outline-none focus:ring-4 focus:ring-primary/10"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-btn p-0.5 text-ink-muted hover:bg-slate-100 hover:text-ink"
              aria-label="Clear filter"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-2">
        {q && visibleGroups.length === 0 && (
          <p className="px-3 py-6 text-center text-body-sm text-ink-muted">No screens match “{query.trim()}”.</p>
        )}
        {visibleGroups.map((group, gi) => {
          const collapsible = !!group.title
          const isOpen = !collapsible || !!q || expanded[group.title!]
          const GroupIcon = group.icon
          // Hairline before the first titled section, separating personal items from departments.
          const showDivider = !q && collapsible && !visibleGroups[gi - 1]?.title
          return (
          <div key={group.title ?? gi} className={cn(collapsible ? 'mb-1.5' : 'mb-2')}>
            {showDivider && <div className="mx-3 my-2 border-t border-line/70" />}
            {group.title && (
              <button
                type="button"
                onClick={() => toggleGroup(group.title!)}
                className="group/hd flex w-full items-center justify-between rounded-btn px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted transition-colors hover:bg-slate-50 hover:text-ink"
                aria-expanded={isOpen}
              >
                <span className="flex items-center gap-2.5">
                  {GroupIcon && (
                    <span
                      className="flex h-5 w-5 items-center justify-center rounded-[6px]"
                      style={group.color ? { color: group.color, backgroundColor: `${group.color}1A` } : undefined}
                    >
                      <GroupIcon size={13} />
                    </span>
                  )}
                  <span>{group.title}</span>
                </span>
                <ChevronRight
                  size={14}
                  className={cn('shrink-0 text-ink-muted/50 transition-transform duration-200 group-hover/hd:text-ink-muted', isOpen && 'rotate-90')}
                />
              </button>
            )}
            {isOpen && (
              <>
                {group.items.length > 0 && renderItems(group.items)}
                {group.subgroups?.map((sg) => {
                  const key = subKey(group.title ?? '', sg.title)
                  const subOpen = !!q || expanded[key]
                  return (
                    <div key={key} className="mt-0.5">
                      <button
                        type="button"
                        onClick={() => toggleGroup(key)}
                        className="group/sub flex w-full items-center justify-between rounded-btn px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted/80 transition-colors hover:bg-slate-50 hover:text-ink"
                        aria-expanded={subOpen}
                      >
                        <span>{sg.title}</span>
                        <ChevronRight
                          size={13}
                          className={cn('shrink-0 text-ink-muted/40 transition-transform duration-200 group-hover/sub:text-ink-muted', subOpen && 'rotate-90')}
                        />
                      </button>
                      {subOpen && renderItems(sg.items, true)}
                    </div>
                  )
                })}
              </>
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
              onClick={onNavigate}
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
