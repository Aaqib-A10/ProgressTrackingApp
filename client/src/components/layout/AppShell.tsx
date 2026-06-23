import { createContext, useContext, useState, Suspense, type ReactNode } from 'react'
import { Outlet } from 'react-router-dom'
import { Activity } from 'lucide-react'
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

/** 260px sidebar + 64px topbar shell that wraps every /app/* screen. */
export function AppShell({ user, children }: AppShellProps) {
  const [range, setRange] = useState<RangeKey>('today')
  const [custom, setCustomState] = useState<CustomRange | null>(null)

  const setCustom = (c: CustomRange) => {
    setCustomState(c)
    setRange('custom')
  }

  return (
    <RangeContext.Provider value={{ range, setRange, custom, setCustom }}>
      <div className="flex h-screen overflow-hidden bg-bg">
        <Sidebar user={user} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar user={user} range={range} custom={custom} onRangeChange={setRange} onApplyCustom={setCustom} />
          <main className="flex-1 overflow-y-auto p-6">
            <Suspense fallback={<div className="flex h-64 items-center justify-center"><Activity size={26} className="animate-pulse text-primary" /></div>}>
              {children ?? <Outlet />}
            </Suspense>
          </main>
        </div>
      </div>
    </RangeContext.Provider>
  )
}
