import { Router } from 'express'
import { getMyEntry, upsertMyEntry, teamView, getBoard, createTask, updateTask, deleteTask, listStock, createStock, assignStock, resolveStock } from '../controllers/ecommerceController'
import { requireAuth, requireRole } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'

export const ecommerceRouter = Router()

ecommerceRouter.use(requireAuth)
ecommerceRouter.get('/entries', asyncHandler(getMyEntry))
ecommerceRouter.put('/entries', asyncHandler(upsertMyEntry))
ecommerceRouter.get('/team', requireRole('TEAM_LEAD', 'SUPER_ADMIN'), asyncHandler(teamView))
ecommerceRouter.get('/board', asyncHandler(getBoard))
ecommerceRouter.post('/tasks', asyncHandler(createTask))
ecommerceRouter.patch('/tasks/:id', asyncHandler(updateTask))
ecommerceRouter.delete('/tasks/:id', asyncHandler(deleteTask))
ecommerceRouter.get('/stock', asyncHandler(listStock))
ecommerceRouter.post('/stock', asyncHandler(createStock))
ecommerceRouter.patch('/stock/:id/assign', asyncHandler(assignStock))
ecommerceRouter.patch('/stock/:id/resolve', asyncHandler(resolveStock))
