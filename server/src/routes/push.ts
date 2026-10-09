import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { pmHandler as h } from '../lib/pm/http'
import * as P from '../controllers/pushController'

/** /api/push — pop-up notifications when PulseTrack is closed (Web Push). */
export const pushRouter = Router()

pushRouter.use(requireAuth)

pushRouter.get('/key', h(P.pushKey))
pushRouter.post('/subscribe', h(P.subscribe))
pushRouter.post('/unsubscribe', h(P.unsubscribe))
pushRouter.post('/test', h(P.testPush))
