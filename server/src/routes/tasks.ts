import { Router } from 'express'
import { deleteMyMarketingTask, getMyTasks } from '../controllers/tasksController'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'

export const tasksRouter = Router()

tasksRouter.use(requireAuth)
tasksRouter.get('/mine', asyncHandler(getMyTasks))
tasksRouter.delete('/mine/marketing/:id', asyncHandler(deleteMyMarketingTask))
