import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'
import { openLive } from '../lib/live'

/** GET /api/live: the quiet connection an open tab keeps, to hear at once that something is new (lib/live). */
export const liveRouter = Router()
liveRouter.get('/', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  await openLive(req.user!, res, (close) => req.on('close', close), String(req.headers.accept ?? '').includes('text/event-stream'))
}))
