import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'
import { listWorkLog, createWorkLog, updateWorkLog, carryWorkLog, deleteWorkLog, workLogPeople } from '../controllers/workLogController'

/** My To-Do: Day / Week / Month / Year entries (every department). */
export const worklogRouter = Router()
worklogRouter.use(requireAuth)
worklogRouter.get('/', asyncHandler(listWorkLog))
worklogRouter.get('/people', asyncHandler(workLogPeople))
worklogRouter.post('/', asyncHandler(createWorkLog))
worklogRouter.patch('/:id', asyncHandler(updateWorkLog))
worklogRouter.post('/:id/carry', asyncHandler(carryWorkLog))
worklogRouter.delete('/:id', asyncHandler(deleteWorkLog))
