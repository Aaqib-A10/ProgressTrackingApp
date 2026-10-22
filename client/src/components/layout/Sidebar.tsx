import { useEffect, useState, useCallback } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Settings, ChevronRight, X } from 'lucide-react'
import { cn } from '../../lib/cn'
import metriqLogo from '../../assets/metriq-logo.svg'
import metriqLogoDark from '../../assets/metriq-logo-dark.svg'
import { ROLE_LABEL, type CurrentUser } from '../../lib/types'
import { Badge } from '../ui/Badge'
import { getUnreadFeedbackCount } from '../../lib/feedbackApi'
import { getQaUnreadCount } from '../../lib/qaApi'
import { filterNav, type NavGroup } from './navConfig'
import { visiblePoll } from '../../lib/chatApi'
import { projectsApi } from '../../lib/projectsApi'
import { avatarUrl, useAvatarIndex } from '../../lib/avatars'
import { GlobalSearch } from './GlobalSearch'
import { getPins, onPinsChange, type Pin } from '../../lib/pins'

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

/** Does this person administer any project? (Cached for the session; Super Admins always do.) */
let adminCache: { userId: string; value: boolean } | null = null
function useIsProjectAdmin(user: CurrentUser): boolean {
  const [value, setValue] = useState(() => user.role === 'SUPER_ADMIN' || (adminCache?.userId === user.id && adminCache.value))
  useEffect(() => {
    if (user.role === 'SUPER_ADMIN') { setValue(true); return }
    if (adminCache?.userId === user.id) { setValue(adminCache.value); return }
    let alive = true
    projectsApi.list().then((r) => {
      const v = r.projects.some((p) => p.myRole === 'ADMIN')
      adminCache = { userId: user.id, value: v }
      if (alive) setValue(v)
    }).catch(() => undefined)
    return () => { alive = false }
  }, [user.id, user.role])
  return value
}

export function Sidebar({ user, onNavigate }: { user: CurrentUser; onNavigate?: () => void }) {
  const isProjectAdmin = useIsProjectAdmin(user)
  const groups = filterNav(user)
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.projectAdminOnly || isProjectAdmin) }))
    .filter((g) => g.items.length > 0 || (g.subgroups?.length ?? 0) > 0)
  const location = useLocation()
  const [unreadFeedback, setUnreadFeedback] = useState(0)
  const [unreadQa, setUnreadQa] = useState(0)
  const [query, setQuery] = useState('')
  const [pins, setPins] = useState<Pin[]>(() => getPins(user.id))
  useEffect(() => onPinsChange(() => setPins(getPins(user.id))), [user.id])

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

  // Unread badges: check every minute while the tab is in front, and again after visiting
  // Feedback or QA (reading there marks things read).
  const loadUnread = useCallback(() => {
    getUnreadFeedbackCount().then((r) => setUnreadFeedback(r.count)).catch(() => undefined)
    getQaUnreadCount().then((r) => setUnreadQa(r.count)).catch(() => undefined)
  }, [])
  useEffect(() => { loadUnread(); return visiblePoll(loadUnread, 60000) }, [loadUnread])
  const readingPage = /^\/app\/(feedback|qa)/.test(location.pathname)
  useEffect(() => { if (readingPage) loadUnread() }, [location.pathname, readingPage, loadUnread])

  const renderItems = (items: typeof groups[number]['items'], nested = false) => (
    <ul className={cn('space-y-px', nested && 'ml-[17px] border-l border-line pl-2')}>
      {items.map((item) => {
        const Icon = item.icon
        return (
          <li key={item.to}>
            <NavLink
              to={item.to}
              onClick={() => { setQuery(''); onNavigate?.() }}
              className={({ isActive }) =>
                cn(
                  'group relative flex h-[30px] items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors duration-100',
                  isActive
                    ? 'bg-slate-200/70 font-medium text-ink shadow-[inset_0_0_0_1px_rgb(var(--line-strong)/0.35)]'
                    : 'text-ink-muted hover:bg-slate-200/45 hover:text-ink',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={16} strokeWidth={isActive ? 2 : 1.75} className={cn('shrink-0', isActive ? 'text-ink' : 'text-ink-faint group-hover:text-ink-muted')} />
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.to === '/app/feedback' && unreadFeedback > 0 && (
                    <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10.5px] font-semibold tabular-nums text-white">
                      {unreadFeedback > 9 ? '9+' : unreadFeedback}
                    </span>
                  )}
                  {item.to === '/app/qa/my' && unreadQa > 0 && (
                    <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10.5px] font-semibold tabular-nums text-white">
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
    <aside className="flex h-full w-[248px] shrink-0 flex-col border-r border-line bg-sidebar">
      {/* Brand */}
      <div className="flex h-[52px] items-center justify-between gap-2 px-4">
        <img src={metriqLogo} alt="Metriq" className="h-[22px] w-auto dark:hidden" />
        <img src={metriqLogoDark} alt="Metriq" className="hidden h-[22px] w-auto dark:block" />
        {/* Close (mobile drawer only) */}
        <button
          type="button"
          onClick={onNavigate}
          className="-mr-1 shrink-0 rounded-btn p-1.5 text-ink-muted hover:bg-slate-200/60 hover:text-ink lg:hidden"
          aria-label="Close menu"
        >
          <X size={18} />
        </button>
      </div>

      {/* Search / jump (opens the command bar) */}
      <div className="px-3 pb-2">
        <GlobalSearch className="h-[30px] bg-card/70" />
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2.5 pb-3">
        {pins.length > 0 && !q && (
          <div className="mb-3">
            <p className="flex h-6 items-center px-2 text-[11.5px] font-medium text-ink-faint">Pinned</p>
            <ul className="space-y-px">
              {pins.map((p) => (
                <li key={p.key}>
                  <NavLink
                    to={`/app/projects/${p.key}`}
                    onClick={() => onNavigate?.()}
                    className={({ isActive }) => cn('flex h-[30px] items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors', isActive && location.search.indexOf('task=') < 0 ? 'bg-slate-200/70 font-medium text-ink' : 'text-ink-muted hover:bg-slate-200/45 hover:text-ink')}
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: p.color ?? 'rgb(var(--ink-faint))' }} /></span>
                    <span className="truncate">{p.name}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        )}
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
          <div key={group.title ?? gi} className={cn(collapsible ? 'mb-0.5' : 'mb-3')}>
            {showDivider && <div className="mx-2 mb-2 mt-1 border-t border-line" />}
            {group.title && (
              <button
                type="button"
                onClick={() => toggleGroup(group.title!)}
                className="group/hd flex h-[30px] w-full items-center justify-between rounded-md px-2 text-[13px] text-ink-muted transition-colors hover:bg-slate-200/45 hover:text-ink"
                aria-expanded={isOpen}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  {GroupIcon && (
                    <span
                      className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px]"
                      style={group.color ? { color: group.color, backgroundColor: `${group.color}1F` } : undefined}
                    >
                      <GroupIcon size={12} strokeWidth={2.2} />
                    </span>
                  )}
                  <span className="truncate">{group.title}</span>
                </span>
                <ChevronRight
                  size={13}
                  className={cn('shrink-0 text-ink-faint transition-transform duration-200', isOpen && 'rotate-90')}
                />
              </button>
            )}
            {isOpen && (
              <>
                {group.items.length > 0 && <div className={cn(collapsible && 'mb-1 mt-px pl-[17px]')}>{renderItems(group.items, collapsible)}</div>}
                {group.subgroups?.map((sg) => {
                  const key = subKey(group.title ?? '', sg.title)
                  const subOpen = !!q || expanded[key]
                  return (
                    <div key={key} className="mt-0.5">
                      <button
                        type="button"
                        onClick={() => toggleGroup(key)}
                        className="group/sub ml-[17px] flex h-[28px] w-[calc(100%-17px)] items-center justify-between rounded-md px-2 text-[12px] font-medium text-ink-faint transition-colors hover:bg-slate-200/45 hover:text-ink"
                        aria-expanded={subOpen}
                      >
                        <span>{sg.title}</span>
                        <ChevronRight
                          size={12}
                          className={cn('shrink-0 text-ink-faint transition-transform duration-200', subOpen && 'rotate-90')}
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

      {/* Footer: settings and who is signed in */}
      <div className="border-t border-line px-2.5 py-2">
        <NavLink
          to="/app/settings"
          onClick={onNavigate}
          className={({ isActive }) => cn('flex h-[30px] items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors', isActive ? 'bg-slate-200/70 font-medium text-ink' : 'text-ink-muted hover:bg-slate-200/45 hover:text-ink')}
        >
          <Settings size={16} strokeWidth={1.75} className="text-ink-faint" /> Settings
        </NavLink>
        <div className="mt-1 flex items-center gap-2.5 rounded-md px-2 py-1.5">
          <Avatar user={user} size={24} />
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[12.5px] font-medium text-ink">{user.name}</div>
            <div className="truncate text-[11px] text-ink-muted">{ROLE_LABEL[user.role]}</div>
          </div>
        </div>
      </div>
    </aside>
  )
}

export function Avatar({ user, size = 36 }: { user: CurrentUser; size?: number }) {
  const uploaded = avatarUrl(useAvatarIndex(), 'user', user.id)
  if (uploaded || user.avatarUrl) {
    return (
      <img
        src={uploaded ?? user.avatarUrl!}
        alt={user.name}
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <div
      className="flex items-center justify-center rounded-full bg-primary/15 font-semibold text-primary"
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.38)) }}
    >
      {initials(user.name)}
    </div>
  )
}
