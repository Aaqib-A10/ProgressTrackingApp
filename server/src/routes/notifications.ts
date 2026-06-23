import { Router } from 'express'
import { getNotifications, getNotSubmitted } from '../controllers/notificationsController'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'

export const notificationsRouter = Router()

notificationsRouter.use(requireAuth)
notificationsRouter.get('/', asyncHandler(getNotifications))
notificationsRouter.get('/not-submitted', asyncHandler(getNotSubmitted))
