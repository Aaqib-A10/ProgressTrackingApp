import { Router } from 'express'
import { createFeedback, listFeedback, getFeedbackThread, replyToFeedback, getUnreadCount } from '../controllers/feedbackController'
import { requireAuth, requireRole } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'

export const feedbackRouter = Router()

feedbackRouter.use(requireAuth)
feedbackRouter.get('/', asyncHandler(listFeedback))
feedbackRouter.get('/unread-count', asyncHandler(getUnreadCount))
feedbackRouter.post('/', requireRole('TEAM_LEAD', 'SUPER_ADMIN'), asyncHandler(createFeedback))
feedbackRouter.get('/:id', asyncHandler(getFeedbackThread))
feedbackRouter.post('/:id/replies', asyncHandler(replyToFeedback))
