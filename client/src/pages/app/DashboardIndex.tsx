import { lazy } from 'react'
import { pageModule } from '../../lib/staleChunks'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { asPreviewed, usePreview } from '../../lib/preview'

// Each person downloads only their own dashboard (the charts library comes only with the ones that chart).
const DashboardHome = lazy(pageModule(() => import('./DashboardHome')))
const TeamLeadDashboard = lazy(pageModule(() => import('./TeamLeadDashboard')))
const ExecutiveDashboard = lazy(pageModule(() => import('./ExecutiveDashboard')))
const QaTeam = lazy(pageModule(() => import('./qa/QaTeam')))

/** Routes /app/dashboard to the right view per role. */
export default function DashboardIndex() {
  const { user: real } = useAuth()
  // Department Studio preview: the dashboard of the role being previewed.
  const preview = usePreview()
  if (!real) return null
  const user = asPreviewed(real, preview)
  // Inventory staff work from their Inventory tab; their team lead gets the team dashboard.
  if (user.department === 'INVENTORY' && user.role === 'MEMBER' && (!user.blocks || user.blocks.includes('inv-items'))) return <Navigate to="/app/inventory" replace />
  if (user.role === 'SUPER_ADMIN') return <ExecutiveDashboard />
  if (user.role === 'QA' || user.role === 'QA_LEAD') return <QaTeam />
  if (user.role === 'TEAM_LEAD' || user.role === 'SUB_DEPT_LEAD') return <TeamLeadDashboard />
  return <DashboardHome />
}
