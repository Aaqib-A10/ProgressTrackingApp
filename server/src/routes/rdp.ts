import { Router } from 'express'
import {
  listRdps, getRdp, createRdp, updateRdp, deleteRdp,
  assignAgent, endAssignment, deleteAssignment,
  listAgents, agentHistory,
} from '../controllers/rdpController'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'

export const rdpRouter = Router()

rdpRouter.use(requireAuth)

// Literal routes first so they don't get captured by /:id.
rdpRouter.get('/agents', asyncHandler(listAgents))
rdpRouter.get('/agent-history', asyncHandler(agentHistory))
rdpRouter.post('/assignments/:id/end', asyncHandler(endAssignment))
rdpRouter.delete('/assignments/:id', asyncHandler(deleteAssignment))

rdpRouter.get('/', asyncHandler(listRdps))
rdpRouter.post('/', asyncHandler(createRdp))
rdpRouter.get('/:id', asyncHandler(getRdp))
rdpRouter.patch('/:id', asyncHandler(updateRdp))
rdpRouter.delete('/:id', asyncHandler(deleteRdp))
rdpRouter.post('/:id/assign', asyncHandler(assignAgent))
