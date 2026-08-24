import { Router } from 'express'
import { getMyEntry, upsertMyEntry, teamView, createCountry } from '../controllers/talkloopController'
import { requireAuth, requireRole } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'

export const talkloopRouter = Router()

talkloopRouter.use(requireAuth)
talkloopRouter.get('/entries', asyncHandler(getMyEntry))
talkloopRouter.put('/entries', asyncHandler(upsertMyEntry))
talkloopRouter.post('/countries', asyncHandler(createCountry))
talkloopRouter.get('/team', requireRole('TEAM_LEAD', 'SUPER_ADMIN'), asyncHandler(teamView))
