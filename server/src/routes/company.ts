import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'
import * as C from '../controllers/companyController'
import { invite } from '../controllers/setupController'
import * as B from '../controllers/customBlockController'
import * as I from '../controllers/integrationsController'
import * as Sso from '../controllers/ssoController'

// /api/company — Company settings (Phase 1, step 4): name, time zone, departments, roles.
export const companyRouter = Router()
companyRouter.use(requireAuth)
companyRouter.get('/', asyncHandler(C.getCompany))
companyRouter.patch('/', asyncHandler(C.updateCompany))
companyRouter.post('/support-access', asyncHandler(C.setSupportAccess))
// Your data: take all of it as one file, or remove the company for good.
companyRouter.get('/export', asyncHandler(C.exportData))
// Single sign-on (SAML) settings.
companyRouter.get('/sso', asyncHandler(Sso.getSettings))
companyRouter.put('/sso', asyncHandler(Sso.saveSettings))
// API keys (for the public API, /api/v1) and webhooks.
companyRouter.get('/api', asyncHandler(I.overview))
companyRouter.post('/api/keys', asyncHandler(I.createKey))
companyRouter.delete('/api/keys/:id', asyncHandler(I.removeKey))
companyRouter.post('/api/webhooks', asyncHandler(I.createWebhook))
companyRouter.patch('/api/webhooks/:id', asyncHandler(I.updateWebhook))
companyRouter.delete('/api/webhooks/:id', asyncHandler(I.removeWebhook))
companyRouter.post('/api/webhooks/:id/test', asyncHandler(I.testWebhook))
companyRouter.get('/api/webhooks/:id/deliveries', asyncHandler(I.deliveries))
companyRouter.post('/remove', asyncHandler(C.deleteOwnCompany))
companyRouter.post('/invites', asyncHandler(invite))
companyRouter.get('/departments', asyncHandler(C.listDepartments))
companyRouter.post('/departments', asyncHandler(C.createDepartment))
companyRouter.patch('/departments/:id', asyncHandler(C.renameDepartment))
companyRouter.patch('/departments/:id/sections', asyncHandler(C.setDepartmentSections))
companyRouter.put('/departments/:id/layout', asyncHandler(C.setDepartmentLayout))
companyRouter.put('/departments/:id/dashboard', asyncHandler(C.setDepartmentDashboard))
// Blocks the company makes itself (Department Studio, part C).
companyRouter.get('/blocks', asyncHandler(B.listBlocks))
companyRouter.post('/blocks', asyncHandler(B.createBlock))
companyRouter.patch('/blocks/:id', asyncHandler(B.updateBlock))
companyRouter.delete('/blocks/:id', asyncHandler(B.deleteBlock))
companyRouter.delete('/departments/:id', asyncHandler(C.deleteDepartment))
companyRouter.get('/roles', asyncHandler(C.listRoles))
companyRouter.post('/roles', asyncHandler(C.createRole))
companyRouter.patch('/roles/:id', asyncHandler(C.updateRole))
companyRouter.delete('/roles/:id', asyncHandler(C.deleteRole))
companyRouter.get('/people', asyncHandler(C.listPeople))
companyRouter.patch('/people/:id', asyncHandler(C.updatePerson))
