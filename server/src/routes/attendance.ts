import { Router } from 'express'
import { getMe, checkIn, checkOut, startBreak, endBreak, history, teamView, getShift, putShift, getUserShift, putUserShift, deleteUserShift, correctDay, markLeave, removeLeave } from '../controllers/attendanceController'
import { requireAuth, requireRole } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'

export const attendanceRouter = Router()

attendanceRouter.use(requireAuth)

// Self-service clock (all authed users).
attendanceRouter.get('/me', asyncHandler(getMe))
attendanceRouter.post('/check-in', asyncHandler(checkIn))
attendanceRouter.post('/check-out', asyncHandler(checkOut))
attendanceRouter.post('/break/start', asyncHandler(startBreak))
attendanceRouter.post('/break/end', asyncHandler(endBreak))

// History — own by default; TL/Admin may pass ?userId= within their scope.
attendanceRouter.get('/history', asyncHandler(history))

// Team board + shift config + corrections (TL / Super Admin).
attendanceRouter.get('/team', requireRole('TEAM_LEAD', 'SUPER_ADMIN'), asyncHandler(teamView))
attendanceRouter.get('/shift', requireRole('TEAM_LEAD', 'SUPER_ADMIN'), asyncHandler(getShift))
attendanceRouter.put('/shift', requireRole('TEAM_LEAD', 'SUPER_ADMIN'), asyncHandler(putShift))
attendanceRouter.get('/shift/user/:userId', requireRole('TEAM_LEAD', 'SUPER_ADMIN'), asyncHandler(getUserShift))
attendanceRouter.put('/shift/user/:userId', requireRole('TEAM_LEAD', 'SUPER_ADMIN'), asyncHandler(putUserShift))
attendanceRouter.delete('/shift/user/:userId', requireRole('TEAM_LEAD', 'SUPER_ADMIN'), asyncHandler(deleteUserShift))
attendanceRouter.put('/:userId/leave/:date', requireRole('TEAM_LEAD', 'SUPER_ADMIN'), asyncHandler(markLeave))
attendanceRouter.delete('/:userId/leave/:date', requireRole('TEAM_LEAD', 'SUPER_ADMIN'), asyncHandler(removeLeave))
attendanceRouter.patch('/:userId/:date', requireRole('TEAM_LEAD', 'SUPER_ADMIN'), asyncHandler(correctDay))
