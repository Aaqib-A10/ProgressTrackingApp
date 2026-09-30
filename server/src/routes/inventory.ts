import { Router } from 'express'
import {
  listItems, createItem, updateItem, deleteItem, itemActivity,
  createMovement, assignMovement, resolveMovement, cancelMovement,
  listRequests, teamView,
} from '../controllers/inventoryController'
import { requireAuth, requireRole } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'

export const inventoryRouter = Router()

inventoryRouter.use(requireAuth)

// Items
inventoryRouter.get('/items', asyncHandler(listItems))
inventoryRouter.post('/items', asyncHandler(createItem))
inventoryRouter.patch('/items/:id', asyncHandler(updateItem))
inventoryRouter.delete('/items/:id', asyncHandler(deleteItem))
inventoryRouter.get('/items/:id/activity', asyncHandler(itemActivity))

// Movements (stock-in / stock-out requests)
inventoryRouter.post('/movements', asyncHandler(createMovement))
inventoryRouter.patch('/movements/:id/assign', asyncHandler(assignMovement))
inventoryRouter.patch('/movements/:id/resolve', asyncHandler(resolveMovement))
inventoryRouter.patch('/movements/:id/cancel', asyncHandler(cancelMovement))
inventoryRouter.get('/requests', asyncHandler(listRequests))

// Team view (Team Lead / Super Admin)
inventoryRouter.get('/team', requireRole('TEAM_LEAD', 'SUPER_ADMIN'), asyncHandler(teamView))
