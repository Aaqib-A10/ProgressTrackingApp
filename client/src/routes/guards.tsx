import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Activity } from 'lucide-react'
import type { Role } from '../lib/types'
import { useAuth } from '../lib/auth'
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
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  return <AppShell user={user} />
}

/** RBAC gate for client routes; bounces unauthorized users back to the dashboard. */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  if (!roles.includes(user.role)) return <Navigate to="/app/dashboard" replace />
  return <>{children}</>
}
