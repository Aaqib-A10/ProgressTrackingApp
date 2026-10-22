import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'
import {
  errorBriefText, errorTicket, getAudit, getError, healthSummary, listAudits, listDevelopers, listErrors,
  reportClientError, requireHealthAccess, runAudit, setDeveloper, setErrorState, uptimeReport,
} from '../controllers/systemHealthController'

export const systemHealthRouter = Router()

// Sent by the app itself (any page, signed in or not) and by the outside uptime checker.
systemHealthRouter.post('/client-error', asyncHandler(reportClientError))
systemHealthRouter.post('/uptime', asyncHandler(uptimeReport))

// Everything else: Super Admins and developers only.
const gate = [requireAuth, asyncHandler(requireHealthAccess)]
systemHealthRouter.get('/summary', ...gate, asyncHandler(healthSummary))
systemHealthRouter.get('/errors', ...gate, asyncHandler(listErrors))
systemHealthRouter.get('/errors/:id', ...gate, asyncHandler(getError))
systemHealthRouter.patch('/errors/:id', ...gate, asyncHandler(setErrorState))
systemHealthRouter.get('/errors/:id/brief', ...gate, asyncHandler(errorBriefText))
systemHealthRouter.post('/errors/:id/ticket', ...gate, asyncHandler(errorTicket))
systemHealthRouter.get('/audits', ...gate, asyncHandler(listAudits))
systemHealthRouter.get('/audits/:id', ...gate, asyncHandler(getAudit))
systemHealthRouter.post('/audits/run', ...gate, asyncHandler(runAudit))
systemHealthRouter.get('/developers', ...gate, asyncHandler(listDevelopers))
systemHealthRouter.patch('/developers/:userId', ...gate, asyncHandler(setDeveloper))
