import { Router, raw } from 'express'
import { listDocs, createDoc, updateDoc, deleteDoc, uploadDocFile, downloadDocFile } from '../controllers/savedDocsController'
import { requireAuth } from '../middleware/auth'
import { requireDepartment } from '../middleware/department'
import { asyncHandler } from '../lib/asyncHandler'

/** Docs & Links (personal). For the ITAD team for now; add departments to the wall to open it to others. */
export const docsRouter = Router()

docsRouter.use(requireAuth, requireDepartment('ITAD'))
docsRouter.get('/', asyncHandler(listDocs))
docsRouter.post('/', asyncHandler(createDoc))
docsRouter.patch('/:id', asyncHandler(updateDoc))
docsRouter.delete('/:id', asyncHandler(deleteDoc))
docsRouter.post('/:id/file', raw({ type: () => true, limit: '26mb' }), asyncHandler(uploadDocFile))
docsRouter.get('/:id/file', asyncHandler(downloadDocFile))
