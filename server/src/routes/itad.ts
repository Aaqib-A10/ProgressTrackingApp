import { Router } from 'express'
import { getMyEntry, upsertMyEntry, teamView } from '../controllers/itadController'
import { itadAnalytics } from '../controllers/analyticsController'
import { listBids, createBid, updateBid, deleteBid } from '../controllers/bidController'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'

export const itadRouter = Router()

itadRouter.use(requireAuth)
itadRouter.get('/entries', asyncHandler(getMyEntry))
itadRouter.put('/entries', asyncHandler(upsertMyEntry))
itadRouter.get('/team', asyncHandler(teamView))
itadRouter.get('/analytics', asyncHandler(itadAnalytics))
itadRouter.get('/bids', asyncHandler(listBids))
itadRouter.post('/bids', asyncHandler(createBid))
itadRouter.patch('/bids/:id', asyncHandler(updateBid))
itadRouter.delete('/bids/:id', asyncHandler(deleteBid))
