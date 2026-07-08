import { createContext, useContext, useState, useEffect, Suspense, type ReactNode } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Activity } from 'lucide-react'
import { cn } from '../../lib/cn'
import type { CurrentUser } from '../../lib/types'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import type { RangeKey, CustomRange } from './RangeSelector'

// The selected date range is shared with every dashboard under the shell.
interface RangeContextValue {
  range: RangeKey
  setRange: (r: RangeKey) => void
  custom: CustomRange | null
  setCustom: (c: CustomRange) => void
}
const RangeContext = createContext<RangeContextValue | null>(null)

export function useRange(): RangeContextValue {
  const ctx = useContext(RangeContext)
  if (!ctx) throw new Error('useRange must be used within <AppShell>')
  return ctx
}

export interface AppShellProps {
  user: CurrentUser
  /** Defaults to <Outlet/> for routed use; pass children for standalone use. */
  children?: ReactNode
}

/** 260px sidebar + 64px topbar shell that wraps every /app/* screen.
 *  The sidebar is static from lg up and a slide-in drawer below it. */
export function AppShell({ user, children }: AppShellProps) {
  const [range, setRange] = useState<RangeKey>('today')
  const [custom, setCustomState] = useState<CustomRange | null>(null)
  const [navOpen, setNavOpen] = useState(false)
  // Desktop-only: collapse the sidebar to reclaim horizontal space (persisted).
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('pt-sidebar-collapsed') === '1' } catch { return false }
  })
  const location = useLocation()

  const setCustom = (c: CustomRange) => {
    setCustomState(c)
    setRange('custom')
  }

  // The hamburger toggles the desktop collapse on lg+, and the drawer below it.
  const toggleSidebar = () => {
    if (window.matchMedia('(min-width: 1024px)').matches) {
      setCollapsed((c) => {
        const next = !c
        try { localStorage.setItem('pt-sidebar-collapsed', next ? '1' : '0') } catch { /* ignore */ }
        return next
      })
    } else {
      setNavOpen((o) => !o)
    }
  }

  // Close the mobile drawer whenever the route changes.
  useEffect(() => setNavOpen(false), [location.pathname])

  // Lock body scroll while the drawer is open on mobile.
  useEffect(() => {
    if (navOpen) document.body.classList.add('overflow-hidden')
    else document.body.classList.remove('overflow-hidden')
    return () => document.body.classList.remove('overflow-hidden')
  }, [navOpen])

  return (
    <RangeContext.Provider value={{ range, setRange, custom, setCustom }}>
      <div className="flex h-screen overflow-hidden bg-bg">
        {/* Backdrop (mobile only) */}
        <div
          className={cn(
            'fixed inset-0 z-40 bg-ink/50 transition-opacity lg:hidden',
            navOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
          onClick={() => setNavOpen(false)}
          aria-hidden={!navOpen}
        />
        {/* Sidebar — static on lg+, off-canvas drawer below lg */}
        <div
          className={cn(
            'fixed inset-y-0 left-0 z-50 transition-transform duration-200 ease-out lg:static lg:z-auto lg:translate-x-0',
            navOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
            collapsed && 'lg:hidden',
          )}
        >
          <Sidebar user={user} onNavigate={() => setNavOpen(false)} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar user={user} range={range} custom={custom} onRangeChange={setRange} onApplyCustom={setCustom} onMenu={toggleSidebar} />
          <main className="flex-1 overflow-y-auto p-4 sm:p-6">
            <Suspense fallback={<div className="flex h-64 items-center justify-center"><Activity size={26} className="animate-pulse text-primary" /></div>}>
              {children ?? <Outlet />}
            </Suspense>
          </main>
        </div>
      </div>
    </RangeContext.Provider>
  )
}
