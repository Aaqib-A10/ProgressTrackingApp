import { Router } from 'express'
import { exportTeamCsv, monthlyReport, previewMonthlyReport, sendMonthlyReport, managementPreview, sendManagementReport } from '../controllers/reportsController'
import { myReports } from '../controllers/myReportsController'
import { requireAuth, requireRole } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'

export const reportsRouter = Router()

reportsRouter.use(requireAuth)
reportsRouter.get('/team.csv', asyncHandler(exportTeamCsv))
reportsRouter.get('/monthly', asyncHandler(monthlyReport))
reportsRouter.get('/monthly/preview', asyncHandler(previewMonthlyReport))
reportsRouter.post('/monthly/send', requireRole('TEAM_LEAD', 'SUPER_ADMIN'), asyncHandler(sendMonthlyReport))
reportsRouter.get('/management/preview', asyncHandler(managementPreview))
reportsRouter.post('/management/send', requireRole('TEAM_LEAD', 'SUPER_ADMIN'), asyncHandler(sendManagementReport))
reportsRouter.get('/me', asyncHandler(myReports))
