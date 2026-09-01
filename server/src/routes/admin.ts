import { Router } from 'express'
import {
  listUsers, createUser, updateUser, setUserDepartments, deleteUser, resetUserPassword,
  listTeamMembers, inviteTeamMember, removeTeamMember, resetTeamMemberPassword, listTeamHistory,
  listTargets, upsertTarget, deleteTarget,
  listTags, createTag, updateTag,
  listHolidays, createHoliday, deleteHoliday,
  listLeave, listLeaveMembers, createLeave, deleteLeave,
  listOfficeNetworks, createOfficeNetwork, updateOfficeNetwork, deleteOfficeNetwork,
  listLoginEvents, listAuditLog, listAttendanceActivity,
} from '../controllers/adminController'
import { requireAuth, requireRole } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'

export const adminRouter = Router()

adminRouter.use(requireAuth)

// Declarative role guards at the router — the first line of defense so a
// forgotten in-handler check can't expose an endpoint. Handlers keep their own
// role + ownership/department-scope checks as belt-and-braces (defense in depth).
const superAdmin = requireRole('SUPER_ADMIN')
const teamLeadOrAdmin = requireRole('TEAM_LEAD', 'SUPER_ADMIN')

// Users (Super Admin)
adminRouter.get('/users', superAdmin, asyncHandler(listUsers))
adminRouter.post('/users', superAdmin, asyncHandler(createUser))
adminRouter.patch('/users/:id', superAdmin, asyncHandler(updateUser))
adminRouter.put('/users/:id/departments', superAdmin, asyncHandler(setUserDepartments))
adminRouter.delete('/users/:id', superAdmin, asyncHandler(deleteUser))
adminRouter.post('/users/:id/reset-password', superAdmin, asyncHandler(resetUserPassword))

// Team Members (Team Lead — own department roster + invites)
adminRouter.get('/team-members', teamLeadOrAdmin, asyncHandler(listTeamMembers))
adminRouter.post('/team-members', teamLeadOrAdmin, asyncHandler(inviteTeamMember))
adminRouter.delete('/team-members/:id', teamLeadOrAdmin, asyncHandler(removeTeamMember))
adminRouter.post('/team-members/:id/reset-password', teamLeadOrAdmin, asyncHandler(resetTeamMemberPassword))
adminRouter.get('/team-history', teamLeadOrAdmin, asyncHandler(listTeamHistory))

// Targets (TL / Admin)
adminRouter.get('/targets', teamLeadOrAdmin, asyncHandler(listTargets))
adminRouter.post('/targets', teamLeadOrAdmin, asyncHandler(upsertTarget))
adminRouter.delete('/targets/:id', teamLeadOrAdmin, asyncHandler(deleteTarget))

// Tags (TL / Admin)
adminRouter.get('/tags', teamLeadOrAdmin, asyncHandler(listTags))
adminRouter.post('/tags', teamLeadOrAdmin, asyncHandler(createTag))
adminRouter.patch('/tags/:id', teamLeadOrAdmin, asyncHandler(updateTag))

// Holidays & Leave (TL / Admin). NOTE: GET /holidays is intentionally open to any
// authenticated user — it's the company-wide holiday calendar shown across the app.
adminRouter.get('/holidays', asyncHandler(listHolidays))
adminRouter.post('/holidays', teamLeadOrAdmin, asyncHandler(createHoliday))
adminRouter.delete('/holidays/:id', teamLeadOrAdmin, asyncHandler(deleteHoliday))
adminRouter.get('/leave', teamLeadOrAdmin, asyncHandler(listLeave))
adminRouter.get('/leave/members', teamLeadOrAdmin, asyncHandler(listLeaveMembers))
adminRouter.post('/leave', teamLeadOrAdmin, asyncHandler(createLeave))
adminRouter.delete('/leave/:id', teamLeadOrAdmin, asyncHandler(deleteLeave))

// Activity log — sign-ins + data-change audit (Super Admin)
adminRouter.get('/login-events', superAdmin, asyncHandler(listLoginEvents))
adminRouter.get('/audit-log', superAdmin, asyncHandler(listAuditLog))
adminRouter.get('/attendance-activity', superAdmin, asyncHandler(listAttendanceActivity))

// Office networks — IP allowlist for attendance (Super Admin)
adminRouter.get('/office-networks', superAdmin, asyncHandler(listOfficeNetworks))
adminRouter.post('/office-networks', superAdmin, asyncHandler(createOfficeNetwork))
adminRouter.patch('/office-networks/:id', superAdmin, asyncHandler(updateOfficeNetwork))
adminRouter.delete('/office-networks/:id', superAdmin, asyncHandler(deleteOfficeNetwork))
