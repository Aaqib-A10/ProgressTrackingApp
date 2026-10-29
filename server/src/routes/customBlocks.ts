import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'
import * as B from '../controllers/customBlockController'

/** /api/custom/:id — using a block the company made itself (Department Studio, part C). */
export const customRouter = Router()
customRouter.use(requireAuth)
customRouter.get('/:id', asyncHandler(B.getBlock))
customRouter.get('/:id/summary', asyncHandler(B.summary))
customRouter.get('/:id/records', asyncHandler(B.listRecords))
customRouter.post('/:id/records', asyncHandler(B.createRecord))
customRouter.patch('/:id/records/:rid', asyncHandler(B.updateRecord))
customRouter.delete('/:id/records/:rid', asyncHandler(B.deleteRecord))
