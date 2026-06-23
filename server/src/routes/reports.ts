import { Router } from 'express'
import { exportTeamCsv } from '../controllers/reportsController'
import { myReports } from '../controllers/myReportsController'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'

export const reportsRouter = Router()

reportsRouter.use(requireAuth)
reportsRouter.get('/team.csv', asyncHandler(exportTeamCsv))
reportsRouter.get('/me', asyncHandler(myReports))
