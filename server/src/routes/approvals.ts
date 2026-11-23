import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'
import * as A from '../controllers/approvalsController'

/** Requests and approvals: expenses, purchases, leave and anything else (controllers/approvalsController). */
export const approvalsRouter = Router()
approvalsRouter.use(requireAuth)
approvalsRouter.get('/', asyncHandler(A.listRequests))
approvalsRouter.post('/', asyncHandler(A.createRequest))
approvalsRouter.get('/inbox', asyncHandler(A.inbox))
approvalsRouter.get('/rules', asyncHandler(A.listRules))
approvalsRouter.put('/rules', asyncHandler(A.saveRules))
approvalsRouter.get('/leave-balance', asyncHandler(A.myLeaveBalance))
approvalsRouter.get('/:id', asyncHandler(A.getRequest))
approvalsRouter.post('/:id/decide', asyncHandler(A.decideRequest))
approvalsRouter.post('/:id/cancel', asyncHandler(A.cancelRequest))
