import { useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Home, Menu, type LucideIcon } from 'lucide-react'
import { cn } from '../lib/cn'
import type { CurrentUser } from '../lib/types'
import { filterNav, type NavItem } from '../components/layout/navConfig'
import { useChatUnread } from '../components/chat/useChatUnread'
import { flagsLoaded, useFlags } from '../lib/flags'

/**
 * The phone's bottom bar: the four places this person goes most, plus "More" for the rest
 * of the menu (the drawer). Built from the same menu as the sidebar, so it never shows a
 * screen the person cannot open. Phones only (below md); tablets and computers keep the sidebar.
 */

/** Which screens make a tab, in order of preference. Each slot takes the first one the person has. */
const SLOTS: string[][] = [
  // Home: the head's queue, the lead dashboard for lead people, the company dashboard for the rest.
  ['/app/leads/inbox', '/app/leads/dashboard', '/app/dashboard', '/app/projects'],
  // Work: leads, the ITAD dialer, the daily log, tasks.
  ['/app/leads', '/app/leads/summary', '/app/itad/dialer', '/app/daily-report', '/app/leadgen/log', '/app/ecommerce/log', '/app/tasks'],
  // Tasks or attendance.
  ['/app/leads/tasks', '/app/tasks', '/app/todo', '/app/attendance/me'],
  // Chat.
  ['/app/chat', '/app/todo', '/app/attendance/me', '/app/calendar'],
]

/** Short names that fit under an icon. */
const SHORT: Record<string, string> = {
  '/app/leads/inbox': 'Inbox', '/app/leads/queue': 'Queue', '/app/leads/dashboard': 'Home', '/app/dashboard': 'Home', '/app/leads': 'Leads', '/app/leads/summary': 'Summary',
  '/app/leads/tasks': 'Tasks', '/app/tasks': 'Tasks', '/app/todo': 'To-Do', '/app/attendance/me': 'Attendance', '/app/chat': 'Chat',
  '/app/itad/dialer': 'Dialer', '/app/daily-report': 'Report', '/app/leadgen/log': 'Log', '/app/ecommerce/log': 'Log', '/app/projects': 'Projects', '/app/calendar': 'Calendar',
}

export interface Tab { to: string; label: string; icon: LucideIcon }

/** The tabs for this person (exported for tests). */
export function tabsFor(user: CurrentUser): Tab[] {
  const items = new Map<string, NavItem>()
  for (const g of filterNav(user)) for (const i of [...g.items, ...(g.subgroups ?? []).flatMap((s) => s.items)]) items.set(i.to, i)
  const out: Tab[] = []
  // Home is where the person lands (DashboardIndex): the head's queue, the lead dashboard for CMR people, else the company dashboard.
  const home = user.leadsHead && user.role !== 'SUPER_ADMIN' ? '/app/leads/inbox' : user.department === 'CMR' && user.role !== 'SUPER_ADMIN' ? '/app/leads/dashboard' : '/app/dashboard'
  const slots = [[home, ...SLOTS[0].filter((p) => p !== home)], ...SLOTS.slice(1)]
  for (const slot of slots) {
    const to = slot.find((p) => items.has(p) && !out.some((t) => t.to === p))
    if (!to) continue
    const i = items.get(to)!
    out.push({ to, label: SHORT[to] ?? i.label, icon: to === '/app/dashboard' || to === '/app/leads/dashboard' ? Home : i.icon })
  }
  return out
}

/** The tab a path lights up: the longest tab path the current one sits under (a lead page keeps "Leads" lit). */
export function activeTab(tabs: Tab[], pathname: string): string | null {
  let best: Tab | null = null
  for (const t of tabs) {
    if (pathname === t.to || pathname.startsWith(t.to + '/')) { if (!best || t.to.length > best.to.length) best = t }
  }
  return best?.to ?? null
}

export function BottomTabs({ user, onMore }: { user: CurrentUser; onMore: () => void }) {
  const flagsAt = useFlags() // the tabs settle once the owner's switches are in (same as the sidebar)
  const tabs = useMemo(() => tabsFor(user), [user, flagsAt])
  const chat = useChatUnread()
  const { pathname } = useLocation()
  // Nothing until the switches are in: the bar must not show one set of tabs and then another.
  if (!tabs.length || !flagsLoaded()) return null
  const active = activeTab(tabs, pathname)
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
      <ul className="flex h-[3.75rem] items-stretch">
        {tabs.map((t) => {
          const on = active === t.to
          return (
            <li key={t.to} className="min-w-0 flex-1">
              <Link to={t.to} aria-current={on ? 'page' : undefined} className={cn('relative flex h-full flex-col items-center justify-center gap-0.5 text-[0.75rem] font-medium', on ? 'text-primary' : 'text-ink-muted active:text-ink')}>
                <span className={cn('flex h-7 w-14 items-center justify-center rounded-full transition-colors', on && 'bg-primary/10')}>
                  <t.icon size={22} strokeWidth={on ? 2.4 : 2} />
                </span>
                <span className="truncate">{t.label}</span>
                {t.to === '/app/chat' && chat.total > 0 && <span className="absolute left-1/2 top-1 ml-1.5 min-w-[16px] rounded-full bg-danger px-1 text-center text-[10px] font-bold leading-4 text-white ring-2 ring-card">{chat.total > 99 ? '99+' : chat.total}</span>}
              </Link>
            </li>
          )
        })}
        <li className="min-w-0 flex-1">
          <button type="button" onClick={onMore} className={cn('flex h-full w-full flex-col items-center justify-center gap-0.5 text-[0.75rem] font-medium active:text-ink', active ? 'text-ink-muted' : 'text-primary')} aria-label="More">
            <span className={cn('flex h-7 w-14 items-center justify-center rounded-full', !active && 'bg-primary/10')}><Menu size={22} /></span>
            <span>More</span>
          </button>
        </li>
      </ul>
    </nav>
  )
}
