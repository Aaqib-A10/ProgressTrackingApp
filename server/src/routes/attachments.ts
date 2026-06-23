import { Router, raw } from 'express'
import {
  listAttachments,
  uploadAttachment,
  downloadAttachment,
  deleteAttachment,
} from '../controllers/attachmentsController'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'

export const attachmentsRouter = Router()

attachmentsRouter.use(requireAuth)

attachmentsRouter.get('/', asyncHandler(listAttachments))
// Raw binary body — the file bytes ARE the request body (metadata travels in the query/headers).
attachmentsRouter.post('/', raw({ type: '*/*', limit: '26mb' }), asyncHandler(uploadAttachment))
attachmentsRouter.get('/:id/download', asyncHandler(downloadAttachment))
attachmentsRouter.delete('/:id', asyncHandler(deleteAttachment))
