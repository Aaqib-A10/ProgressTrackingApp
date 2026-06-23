import { Router } from 'express'
import { getBoard, createTask, updateTask, deleteTask } from '../controllers/marketingController'
import { seoGet, seoUpsert, socialGet, socialUpsert, contentList } from '../controllers/marketingActivityController'
import { calendar, marketingAnalytics } from '../controllers/marketingViewsController'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'

export const marketingRouter = Router()

marketingRouter.use(requireAuth)

// Kanban board
marketingRouter.get('/board', asyncHandler(getBoard))
marketingRouter.post('/tasks', asyncHandler(createTask))
marketingRouter.patch('/tasks/:id', asyncHandler(updateTask))
marketingRouter.delete('/tasks/:id', asyncHandler(deleteTask))

// Sub-department activity
marketingRouter.get('/seo/entries', asyncHandler(seoGet))
marketingRouter.put('/seo/entries', asyncHandler(seoUpsert))
marketingRouter.get('/social/entries', asyncHandler(socialGet))
marketingRouter.put('/social/entries', asyncHandler(socialUpsert))
marketingRouter.get('/content', asyncHandler(contentList))

// Views
marketingRouter.get('/calendar', asyncHandler(calendar))
marketingRouter.get('/analytics', asyncHandler(marketingAnalytics))
