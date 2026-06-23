import { Router } from 'express'
import { teamDashboard } from '../controllers/dashboardController'
import { executiveDashboard } from '../controllers/executiveController'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'

export const dashboardRouter = Router()

dashboardRouter.use(requireAuth)
dashboardRouter.get('/team', asyncHandler(teamDashboard))
dashboardRouter.get('/executive', asyncHandler(executiveDashboard))
