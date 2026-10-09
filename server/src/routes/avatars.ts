import { Router, raw } from 'express'
import { requireAuth } from '../middleware/auth'
import { pmHandler as h } from '../lib/pm/http'
import * as A from '../controllers/avatarsController'

/** /api/avatars — profile pictures (people, projects, group chats). */
export const avatarsRouter = Router()

avatarsRouter.use(requireAuth)

avatarsRouter.get('/', h(A.avatarIndex))
avatarsRouter.get('/:kind/:id', h(A.avatarFile))
avatarsRouter.post('/:kind/:id', raw({ type: () => true, limit: '1100kb' }), h(A.uploadAvatar))
avatarsRouter.delete('/:kind/:id', h(A.deleteAvatar))
