import { Router } from 'express'
import { getMe, checkIn, checkOut, startOvertime, startBreak, endBreak, history, teamView, exportTeamAttendanceCsv, getShift, putShift, getUserShift, putUserShift, deleteUserShift, correctDay, markLeave, setRemote, removeLeave, ipCheck } from '../controllers/attendanceController'
import { requireAuth, requireRole } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'
import { createWfhRequest, myWfhRequests, cancelWfhRequest, teamWfhRequests, decideWfhRequest } from '../controllers/wfhRequestController'

export const attendanceRouter = Router()

attendanceRouter.use(requireAuth)

// Self-service clock (all authed users).
attendanceRouter.get('/me', asyncHandler(getMe))
attendanceRouter.post('/check-in', asyncHandler(checkIn))
attendanceRouter.post('/check-out', asyncHandler(checkOut))
attendanceRouter.post('/overtime', asyncHandler(startOvertime))
attendanceRouter.post('/break/start', asyncHandler(startBreak))
attendanceRouter.post('/break/end', asyncHandler(endBreak))
attendanceRouter.get('/ip-check', asyncHandler(ipCheck))

// Work from home requests: anyone asks, their Team Lead (or a Super Admin) decides.
attendanceRouter.post('/wfh-requests', asyncHandler(createWfhRequest))
attendanceRouter.get('/wfh-requests/mine', asyncHandler(myWfhRequests))
attendanceRouter.get('/wfh-requests/team', requireRole('TEAM_LEAD', 'SUPER_ADMIN'), asyncHandler(teamWfhRequests))
attendanceRouter.post('/wfh-requests/:id/decision', requireRole('TEAM_LEAD', 'SUPER_ADMIN'), asyncHandler(decideWfhRequest))
attendanceRouter.delete('/wfh-requests/:id', asyncHandler(cancelWfhRequest))

// History — own by default; TL/Admin may pass ?userId= within their scope.
attendanceRouter.get('/history', asyncHandler(history))

// Team board + shift config + corrections (TL / Super Admin).
attendanceRouter.get('/team', requireRole('TEAM_LEAD', 'SUPER_ADMIN'), asyncHandler(teamView))
// Literal must precede the `/:userId/...` param routes below.
attendanceRouter.get('/team.csv', requireRole('TEAM_LEAD', 'SUPER_ADMIN'), asyncHandler(exportTeamAttendanceCsv))
attendanceRouter.get('/shift', requireRole('TEAM_LEAD', 'SUPER_ADMIN'), asyncHandler(getShift))
attendanceRouter.put('/shift', requireRole('TEAM_LEAD', 'SUPER_ADMIN'), asyncHandler(putShift))
attendanceRouter.get('/shift/user/:userId', requireRole('TEAM_LEAD', 'SUPER_ADMIN'), asyncHandler(getUserShift))
attendanceRouter.put('/shift/user/:userId', requireRole('TEAM_LEAD', 'SUPER_ADMIN'), asyncHandler(putUserShift))
attendanceRouter.delete('/shift/user/:userId', requireRole('TEAM_LEAD', 'SUPER_ADMIN'), asyncHandler(deleteUserShift))
attendanceRouter.put('/:userId/leave/:date', requireRole('TEAM_LEAD', 'SUPER_ADMIN'), asyncHandler(markLeave))
attendanceRouter.put('/:userId/remote', requireRole('TEAM_LEAD', 'SUPER_ADMIN'), asyncHandler(setRemote))
attendanceRouter.delete('/:userId/leave/:date', requireRole('TEAM_LEAD', 'SUPER_ADMIN'), asyncHandler(removeLeave))
attendanceRouter.patch('/:userId/:date', requireRole('TEAM_LEAD', 'SUPER_ADMIN'), asyncHandler(correctDay))
