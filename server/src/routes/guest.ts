import { Router } from 'express'
import { pmHandler as h } from '../lib/pm/http'
import { guestLimiter } from '../middleware/rateLimit'
import * as G from '../controllers/guestController'

/** /api/guest — people outside Metriq joining a call by link (no login). */
export const guestRouter = Router()

guestRouter.get('/:token', guestLimiter, h(G.guestInfo))
guestRouter.post('/:token/knock', guestLimiter, h(G.guestKnock))
guestRouter.get('/:token/status', h(G.guestStatus))
