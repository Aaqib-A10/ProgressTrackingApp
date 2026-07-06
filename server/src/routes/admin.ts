import { Router } from 'express'
import {
  listUsers, createUser, updateUser, deleteUser, resetUserPassword,
  listTeamMembers, inviteTeamMember, removeTeamMember, resetTeamMemberPassword, listTeamHistory,
  listTargets, upsertTarget, deleteTarget,
  listTags, createTag, updateTag,
  listHolidays, createHoliday, deleteHoliday,
  listLeave, listLeaveMembers, createLeave, deleteLeave,
} from '../controllers/adminController'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'

export const adminRouter = Router()

adminRouter.use(requireAuth)

// Users (Super Admin)
adminRouter.get('/users', asyncHandler(listUsers))
adminRouter.post('/users', asyncHandler(createUser))
adminRouter.patch('/users/:id', asyncHandler(updateUser))
adminRouter.delete('/users/:id', asyncHandler(deleteUser))
adminRouter.post('/users/:id/reset-password', asyncHandler(resetUserPassword))

// Team Members (Team Lead — own department roster + invites)
adminRouter.get('/team-members', asyncHandler(listTeamMembers))
adminRouter.post('/team-members', asyncHandler(inviteTeamMember))
adminRouter.delete('/team-members/:id', asyncHandler(removeTeamMember))
adminRouter.post('/team-members/:id/reset-password', asyncHandler(resetTeamMemberPassword))
adminRouter.get('/team-history', asyncHandler(listTeamHistory))

// Targets (TL / Admin)
adminRouter.get('/targets', asyncHandler(listTargets))
adminRouter.post('/targets', asyncHandler(upsertTarget))
adminRouter.delete('/targets/:id', asyncHandler(deleteTarget))

// Tags (TL / Admin)
adminRouter.get('/tags', asyncHandler(listTags))
adminRouter.post('/tags', asyncHandler(createTag))
adminRouter.patch('/tags/:id', asyncHandler(updateTag))

// Holidays & Leave (TL / Admin)
adminRouter.get('/holidays', asyncHandler(listHolidays))
adminRouter.post('/holidays', asyncHandler(createHoliday))
adminRouter.delete('/holidays/:id', asyncHandler(deleteHoliday))
adminRouter.get('/leave', asyncHandler(listLeave))
adminRouter.get('/leave/members', asyncHandler(listLeaveMembers))
adminRouter.post('/leave', asyncHandler(createLeave))
adminRouter.delete('/leave/:id', asyncHandler(deleteLeave))
