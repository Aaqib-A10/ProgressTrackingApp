import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'
import * as P from '../controllers/peopleController'

/** People records and leave days (controllers/peopleController). */
export const peopleRouter = Router()
peopleRouter.use(requireAuth)
peopleRouter.get('/', asyncHandler(P.listPeople))
peopleRouter.get('/leave-defaults', asyncHandler(P.getLeaveDefaults))
peopleRouter.put('/leave-defaults', asyncHandler(P.saveLeaveDefaults))
peopleRouter.get('/:id', asyncHandler(P.getPerson))
peopleRouter.put('/:id', asyncHandler(P.savePerson))
peopleRouter.put('/:id/leave', asyncHandler(P.savePersonLeave))
