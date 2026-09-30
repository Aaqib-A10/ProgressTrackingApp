import { Navigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import DashboardHome from './DashboardHome'
import TeamLeadDashboard from './TeamLeadDashboard'
import ExecutiveDashboard from './ExecutiveDashboard'
import QaTeam from './qa/QaTeam'

/** Routes /app/dashboard to the right view per role. */
export default function DashboardIndex() {
  const { user } = useAuth()
  if (!user) return null
  // Inventory-only operations users have no general dashboard — send them to their tab.
  if (user.department === 'INVENTORY' && user.role !== 'SUPER_ADMIN') return <Navigate to="/app/inventory" replace />
  if (user.role === 'SUPER_ADMIN') return <ExecutiveDashboard />
  if (user.role === 'QA' || user.role === 'QA_LEAD') return <QaTeam />
  if (user.role === 'TEAM_LEAD' || user.role === 'SUB_DEPT_LEAD') return <TeamLeadDashboard />
  return <DashboardHome />
}
