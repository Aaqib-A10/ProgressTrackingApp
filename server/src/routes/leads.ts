import express, { Router } from 'express'
import cors from 'cors'
import { requireAuth } from '../middleware/auth'
import { pmHandler as h } from '../lib/pm/http'
import { leadInLimiter } from '../middleware/rateLimit'
import * as L from '../controllers/leadsController'

/** Lead Management (signed in). Who sees what is decided in lib/leads/access.ts. */
export const leadsRouter = Router()
leadsRouter.use(requireAuth)
leadsRouter.get('/meta', h(L.leadsMeta))
leadsRouter.get('/export.csv', h(L.exportLeads))
leadsRouter.get('/businesses', h(L.listBusinesses))
leadsRouter.post('/businesses', h(L.createBusiness))
leadsRouter.patch('/businesses/:id', h(L.updateBusiness))
leadsRouter.delete('/businesses/:id', h(L.deleteBusiness))
leadsRouter.post('/businesses/:id/members', h(L.setMember))
leadsRouter.delete('/businesses/:id/members/:userId', h(L.removeMember))
leadsRouter.post('/businesses/:id/form-key', h(L.newBusinessFormKey))
leadsRouter.put('/businesses/:id/inbox', h(L.saveInbox))
leadsRouter.post('/businesses/:id/inbox/test', h(L.testBusinessInbox))
leadsRouter.post('/businesses/:id/test-lead', h(L.testBusinessLead))
leadsRouter.post('/import', h(L.importLeads))
leadsRouter.get('/', h(L.listLeads))
leadsRouter.post('/', h(L.addLead))
leadsRouter.get('/:id', h(L.getLead))
leadsRouter.patch('/:id', h(L.updateLead))
leadsRouter.post('/:id/assign', h(L.assignLead))
leadsRouter.post('/:id/events', h(L.addLeadEvent))

/**
 * Website forms send leads here from any site (no sign-in). Mounted before the app's own CORS rule,
 * so any website may post; no cookies are read or sent.
 */
export const leadInRouter = Router()
leadInRouter.use(
  // Other sites read the answer: let them (helmet sets same-origin for the rest of the API).
  (_req, res, next) => { res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'); next() },
  cors({ origin: true, credentials: false, methods: ['POST', 'OPTIONS'], maxAge: 86400 }),
  express.json({ limit: '100kb' }),
  express.urlencoded({ extended: true, limit: '100kb' }),
  express.text({ type: 'text/*', limit: '100kb' }),
)
leadInRouter.post('/:key', leadInLimiter, h(L.leadIn as never))
leadInRouter.all('/:key', (_req, res) => { res.status(405).json({ ok: false, error: 'Send the form with POST' }) })
