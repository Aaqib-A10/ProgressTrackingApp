import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { requireDepartment } from '../middleware/department'
import { asyncHandler } from '../lib/asyncHandler'
import { importLeads, dialerData, importHistory, leadDetail, leadAction, fixLead, getSettings, putSettings, listDuplicates, resolveDuplicate } from '../controllers/dialerController'

/** Lead Dialer (ITAD only; Super Admins too). Each rep sees only their own leads. */
export const dialerRouter = Router()

dialerRouter.use(requireAuth, requireDepartment('ITAD'))
dialerRouter.get('/data', asyncHandler(dialerData))
dialerRouter.post('/imports', asyncHandler(importLeads))
dialerRouter.get('/imports', asyncHandler(importHistory))
dialerRouter.get('/leads/:id', asyncHandler(leadDetail))
dialerRouter.post('/leads/:id/actions', asyncHandler(leadAction))
dialerRouter.patch('/leads/:id', asyncHandler(fixLead))
dialerRouter.get('/settings', asyncHandler(getSettings))
dialerRouter.put('/settings', asyncHandler(putSettings))
dialerRouter.get('/duplicates', asyncHandler(listDuplicates))
dialerRouter.post('/duplicates/resolve', asyncHandler(resolveDuplicate))
