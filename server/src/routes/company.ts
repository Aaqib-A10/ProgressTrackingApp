import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'
import * as C from '../controllers/companyController'

// /api/company — Company settings (Phase 1, step 4): name, time zone, departments, roles.
export const companyRouter = Router()
companyRouter.use(requireAuth)
companyRouter.get('/', asyncHandler(C.getCompany))
companyRouter.patch('/', asyncHandler(C.updateCompany))
companyRouter.get('/departments', asyncHandler(C.listDepartments))
companyRouter.post('/departments', asyncHandler(C.createDepartment))
companyRouter.patch('/departments/:id', asyncHandler(C.renameDepartment))
companyRouter.delete('/departments/:id', asyncHandler(C.deleteDepartment))
companyRouter.get('/roles', asyncHandler(C.listRoles))
companyRouter.post('/roles', asyncHandler(C.createRole))
companyRouter.patch('/roles/:id', asyncHandler(C.updateRole))
companyRouter.delete('/roles/:id', asyncHandler(C.deleteRole))
companyRouter.get('/people', asyncHandler(C.listPeople))
companyRouter.patch('/people/:id', asyncHandler(C.updatePerson))
