import { Router } from 'express'
import { getMemberProfile } from '../controllers/membersController'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'

export const membersRouter = Router()

membersRouter.use(requireAuth)
membersRouter.get('/:id', asyncHandler(getMemberProfile))
