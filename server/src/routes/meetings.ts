import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { pmHandler as h } from '../lib/pm/http'
import * as M from '../controllers/meetingsController'

/** /api/meetings — calendar + scheduled meetings. */
export const meetingsRouter = Router()

meetingsRouter.use(requireAuth)

meetingsRouter.get('/', h(M.listMeetings))
meetingsRouter.post('/', h(M.createMeeting))
meetingsRouter.get('/:id', h(M.getMeeting))
meetingsRouter.patch('/:id', h(M.updateMeeting))
meetingsRouter.post('/:id/join', h(M.joinMeeting))
meetingsRouter.post('/:id/respond', h(M.respondMeeting))
meetingsRouter.post('/:id/cancel', h(M.cancelMeeting))
meetingsRouter.get('/:id/ics', h(M.meetingIcs))
