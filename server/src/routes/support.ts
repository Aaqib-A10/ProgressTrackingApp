import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'
import { supportStatus, createTicket, myTickets, replyMine } from '../controllers/supportController'

// The Help button for company people (erp, step 0).
export const supportRouter = Router()

supportRouter.use(requireAuth)
supportRouter.get('/status', asyncHandler(supportStatus))
supportRouter.post('/', asyncHandler(createTicket))
supportRouter.get('/mine', asyncHandler(myTickets))
supportRouter.post('/mine/:id/reply', asyncHandler(replyMine))
