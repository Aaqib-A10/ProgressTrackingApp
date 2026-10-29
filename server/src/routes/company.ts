import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'
import * as C from '../controllers/companyController'
import { invite } from '../controllers/setupController'

// /api/company — Company settings (Phase 1, step 4): name, time zone, departments, roles.
export const companyRouter = Router()
companyRouter.use(requireAuth)
companyRouter.get('/', asyncHandler(C.getCompany))
companyRouter.patch('/', asyncHandler(C.updateCompany))
companyRouter.post('/support-access', asyncHandler(C.setSupportAccess))
companyRouter.post('/invites', asyncHandler(invite))
companyRouter.get('/departments', asyncHandler(C.listDepartments))
companyRouter.post('/departments', asyncHandler(C.createDepartment))
companyRouter.patch('/departments/:id', asyncHandler(C.renameDepartment))
companyRouter.patch('/departments/:id/sections', asyncHandler(C.setDepartmentSections))
companyRouter.put('/departments/:id/layout', asyncHandler(C.setDepartmentLayout))
companyRouter.delete('/departments/:id', asyncHandler(C.deleteDepartment))
companyRouter.get('/roles', asyncHandler(C.listRoles))
companyRouter.post('/roles', asyncHandler(C.createRole))
companyRouter.patch('/roles/:id', asyncHandler(C.updateRole))
companyRouter.delete('/roles/:id', asyncHandler(C.deleteRole))
companyRouter.get('/people', asyncHandler(C.listPeople))
companyRouter.patch('/people/:id', asyncHandler(C.updatePerson))
