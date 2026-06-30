import { Router } from 'express'
import { getMyEntry, upsertMyEntry, teamView, createVertical } from '../controllers/leadgenController'
import { getBreakdown, putBreakdown } from '../controllers/leadgenBreakdownController'
import { leadgenAnalytics } from '../controllers/analyticsController'
import { requireAuth, requireRole } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'

export const leadgenRouter = Router()

leadgenRouter.use(requireAuth)
leadgenRouter.get('/entries', asyncHandler(getMyEntry))
leadgenRouter.put('/entries', asyncHandler(upsertMyEntry))
leadgenRouter.post('/verticals', asyncHandler(createVertical))
leadgenRouter.get('/team', asyncHandler(teamView))
leadgenRouter.get('/breakdown', requireRole('TEAM_LEAD', 'SUPER_ADMIN'), asyncHandler(getBreakdown))
leadgenRouter.put('/breakdown', requireRole('TEAM_LEAD', 'SUPER_ADMIN'), asyncHandler(putBreakdown))
leadgenRouter.get('/analytics', asyncHandler(leadgenAnalytics))
