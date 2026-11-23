import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { asyncHandler } from '../lib/asyncHandler'
import * as P from '../controllers/publicApiController'

/**
 * /api/v1 — the public API. No sign-in cookie here: every request carries a company's API key
 * (Company settings → API). 120 requests a minute per key.
 */
export const publicApiRouter = Router()

const limiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  skip: () => process.env.NODE_ENV !== 'production',
  keyGenerator: (req) => P.hashKey(String(req.headers.authorization ?? req.headers['x-api-key'] ?? req.ip ?? '')),
  message: { error: 'Too many requests. The limit is 120 a minute per key.' },
})
publicApiRouter.use(limiter)

const read = P.requireApiKey('read')
const write = P.requireApiKey('write')

publicApiRouter.get('/company', asyncHandler(read), asyncHandler(P.company))
publicApiRouter.get('/people', asyncHandler(read), asyncHandler(P.people))
publicApiRouter.get('/departments', asyncHandler(read), asyncHandler(P.departments))
publicApiRouter.get('/attendance', asyncHandler(read), asyncHandler(P.attendance))
publicApiRouter.get('/tasks', asyncHandler(read), asyncHandler(P.tasks))
publicApiRouter.get('/leads', asyncHandler(read), asyncHandler(P.leads))
publicApiRouter.post('/leads', asyncHandler(write), asyncHandler(P.createLead))
publicApiRouter.get('/deals', asyncHandler(read), asyncHandler(P.deals))
publicApiRouter.use((_req, res) => { res.status(404).json({ error: 'No such address in the Metriq API. See Company settings, API, for the list.' }) })
