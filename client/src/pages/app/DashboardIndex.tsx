import { lazy } from 'react'
import { pageModule } from '../../lib/staleChunks'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { asPreviewed, usePreview } from '../../lib/preview'
import { MetraOnDashboard } from '../../components/metra/MetraOnDashboard'

// Each person downloads only their own dashboard (the charts library comes only with the ones that chart).
const DashboardHome = lazy(pageModule(() => import('./DashboardHome')))
const TeamLeadDashboard = lazy(pageModule(() => import('./TeamLeadDashboard')))
const ExecutiveDashboard = lazy(pageModule(() => import('./ExecutiveDashboard')))
const QaTeam = lazy(pageModule(() => import('./qa/QaTeam')))
const CardDashboard = lazy(pageModule(() => import('../../components/dashboard/CardDashboard').then((m) => ({ default: m.CardDashboard }))))

/** Routes /app/dashboard to the right view per role. */
export default function DashboardIndex() {
  const { user: real } = useAuth()
  // Department Studio preview: the dashboard of the role being previewed.
  const preview = usePreview()
  if (!real) return null
  const user = asPreviewed(real, preview)
  // Inventory staff work from their Inventory tab; their team lead gets the team dashboard.
  if (user.department === 'INVENTORY' && user.role === 'MEMBER' && (!user.blocks || user.blocks.includes('inv-items'))) return <Navigate to="/app/inventory" replace />
  // The head of a lead business who works no leads (Jesse): home is the queue of what waits on him.
  if (user.leadsHead && user.role !== 'SUPER_ADMIN') return <Navigate to="/app/leads/inbox" replace />
  // A CMR department (SDRs and Jesse) works from Lead Management: its home is the Lead Dashboard.
  if (user.department === 'CMR' && user.role !== 'SUPER_ADMIN') return <Navigate to="/app/leads/dashboard" replace />
  // Department Studio, part B: the department's own dashboard of cards.
  // What Metra noticed (the day's brief, the weekly summary, alerts) sits above every dashboard; nothing shows when there is nothing to say.
  const metra = preview ? null : <MetraOnDashboard />
  if (user.dashboard && user.role !== 'SUPER_ADMIN') return <>{metra}<CardDashboard user={user} cards={user.dashboard} editable={!preview} /></>
  if (user.role === 'SUPER_ADMIN') return <>{metra}<ExecutiveDashboard /></>
  if (user.role === 'QA' || user.role === 'QA_LEAD') return <>{metra}<QaTeam /></>
  if (user.role === 'TEAM_LEAD' || user.role === 'SUB_DEPT_LEAD') return <>{metra}<TeamLeadDashboard /></>
  return <>{metra}<DashboardHome /></>
}
