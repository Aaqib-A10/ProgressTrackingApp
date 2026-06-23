import { Router } from 'express'
import { getMyEntry, upsertMyEntry, teamView, createVertical } from '../controllers/leadgenController'
import { leadgenAnalytics } from '../controllers/analyticsController'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'

export const leadgenRouter = Router()

leadgenRouter.use(requireAuth)
leadgenRouter.get('/entries', asyncHandler(getMyEntry))
leadgenRouter.put('/entries', asyncHandler(upsertMyEntry))
leadgenRouter.post('/verticals', asyncHandler(createVertical))
leadgenRouter.get('/team', asyncHandler(teamView))
leadgenRouter.get('/analytics', asyncHandler(leadgenAnalytics))
