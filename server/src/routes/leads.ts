import express, { Router } from 'express'
import cors from 'cors'
import { requireAuth } from '../middleware/auth'
import { pmHandler as h } from '../lib/pm/http'
import { leadInLimiter } from '../middleware/rateLimit'
import * as L from '../controllers/leadsController'
import * as W from '../controllers/leadsWorkController'
import * as T from '../controllers/leadsTalkloopController'

/** Lead Management (signed in). Who sees what is decided in lib/leads/access.ts. */
export const leadsRouter = Router()
leadsRouter.use(requireAuth)
leadsRouter.get('/meta', h(W.leadsMeta))
leadsRouter.get('/dashboard', h(W.dashboard))
leadsRouter.get('/summary', h(W.headSummary))
leadsRouter.get('/queue', h(W.headQueue))
leadsRouter.get('/calls', h(W.listCalls))
leadsRouter.get('/calls/:id/recording', h(W.callRecording))
leadsRouter.patch('/calls/:id', h(T.callConsent))
leadsRouter.get('/unmatched', h(T.listUnmatched))
leadsRouter.get('/unmatched/:id/recording', h(T.unmatchedRecording))
leadsRouter.post('/unmatched/attach', h(T.attachUnmatchedCalls))
leadsRouter.get('/talkloop', h(T.talkloopInfo))
leadsRouter.patch('/talkloop/dial', h(T.setDial))
leadsRouter.patch('/talkloop/link', h(T.talkloopLink))
leadsRouter.post('/talkloop/sync', h(T.talkloopSyncNow))
leadsRouter.get('/tasks', h(W.listTasks))
leadsRouter.post('/tasks', h(W.addTask))
leadsRouter.patch('/tasks/:id', h(W.updateTask))
leadsRouter.post('/tasks/:id/complete', h(W.completeTask))
leadsRouter.get('/report', h(W.myReport))
leadsRouter.post('/report', h(W.submitReport))
leadsRouter.get('/report/team', h(W.teamReport))
leadsRouter.get('/export.csv', h(W.exportLeads))
leadsRouter.get('/check', h(W.checkLead))
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
leadsRouter.get('/businesses/:id/lists', h(W.listEntries))
leadsRouter.post('/businesses/:id/lists', h(W.addEntries))
leadsRouter.delete('/businesses/:id/lists/:entryId', h(W.removeEntry))
leadsRouter.get('/import-sheet/columns', h(W.sheetColumns))
leadsRouter.post('/import-sheet', h(W.importSheet))
leadsRouter.post('/import', h(L.importLeads))
leadsRouter.get('/', h(W.listLeads))
leadsRouter.post('/', h(W.addLead))
leadsRouter.get('/:id', h(W.getLead))
leadsRouter.patch('/:id', h(W.updateLead))
leadsRouter.post('/bulk-assign', h(W.bulkAssign))
leadsRouter.post('/:id/assign', h(W.assignLead))
leadsRouter.post('/:id/events', h(W.addLeadEvent))
leadsRouter.post('/:id/calls', h(W.addCall))
leadsRouter.post('/:id/comments', h(W.addComment))
leadsRouter.post('/:id/send-info', h(W.sendInfo))
leadsRouter.post('/:id/qualify', h(W.qualifyLead))
leadsRouter.post('/:id/approve', h(W.approveLead))
leadsRouter.post('/:id/decide', h(W.decideLead))
leadsRouter.post('/:id/slots', h(W.offerSlots))
leadsRouter.post('/:id/invite', h(W.sendInvite))
leadsRouter.post('/:id/reconfirm', h(W.reconfirmMeeting))
leadsRouter.post('/:id/outcome', h(W.meetingOutcome))
leadsRouter.post('/:id/close', h(W.closeLead))
leadsRouter.post('/:id/reopen', h(W.reopenLead))

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
