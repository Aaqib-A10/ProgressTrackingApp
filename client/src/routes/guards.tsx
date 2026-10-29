import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Activity } from 'lucide-react'
import type { Role } from '../lib/types'
import { useAuth } from '../lib/auth'
import { canViewFinance } from '../lib/finance'
import { flagOn, refreshFlags } from '../lib/flags'
import { inHomeCompany } from '../lib/types'
import { canOpen } from '../lib/access'
import { asPreviewed, usePreview } from '../lib/preview'
import { AppShell } from '../components/layout/AppShell'

function FullScreenSpinner() {
  return (
    <div className="flex h-screen items-center justify-center bg-bg">
      <Activity size={28} className="animate-pulse text-primary" />
    </div>
  )
}

/** Gate that requires an authenticated session; redirects to /login otherwise. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <FullScreenSpinner />
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />
  return <>{children}</>
}

/** Renders the app shell with the authenticated user; nested routes fill the Outlet. */
export function AppShellRoute() {
  const { user: real } = useAuth()
  const { pathname } = useLocation()
  // Department Studio preview: the Super Admin sees a department's menu as its member or team lead.
  const preview = usePreview()
  if (!real) return <Navigate to="/login" replace />
  const user = asPreviewed(real, preview)
  // Every page under /app checks the same access list as the menu (lib/access.ts), so a
  // screen for another department or role cannot be opened by typing its address.
  if (!canOpen(user, pathname)) return <Navigate to="/app/dashboard" replace />
  // A new company's Super Admin starts in the setup wizard until it is done or skipped (step 7).
  if (user.company && user.company.setupDone === false && user.permissions?.includes('company.settings') && pathname !== '/app/setup' && !user.supportSession) return <Navigate to="/app/setup" replace />
  return <AppShell user={user} />
}

/** RBAC gate for client routes; bounces unauthorized users back to the dashboard. */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  if (!roles.includes(user.role)) return <Navigate to="/app/dashboard" replace />
  return <>{children}</>
}

/** Finance gate — restricted to allowlisted identities (Aqib), not the SUPER_ADMIN role. */
export function RequireFinance({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  if (!canViewFinance(user)) return <Navigate to="/app/dashboard" replace />
  return <>{children}</>
}

/** A page behind an owner switch (company-wise): closed while the switch is off for the company. */
export function RequireFlag({ flag, children }: { flag: string; children: ReactNode }) {
  const [ready, setReady] = useState(false)
  useEffect(() => { void refreshFlags().finally(() => setReady(true)) }, [])
  if (!ready) return null
  if (!flagOn(flag)) return <Navigate to="/app/dashboard" replace />
  return <>{children}</>
}

/** Only for people with this power (Company settings, Holidays…; Phase 1, step 4). */
export function RequirePower({ power, children }: { power: string; children: ReactNode }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  if (!user.permissions?.includes(power)) return <Navigate to="/app/dashboard" replace />
  return <>{children}</>
}

/** System Health: 99 Technologies' Super Admins and developers. */
export function RequireHealth({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  if (!inHomeCompany(user) || (user.role !== 'SUPER_ADMIN' && !user.isDeveloper)) return <Navigate to="/app/dashboard" replace />
  return <>{children}</>
}
