import { Router } from 'express'
import { asyncHandler } from '../lib/asyncHandler'
import { loginLimiter } from '../middleware/rateLimit'
import { requireOwner } from '../middleware/owner'
import {
  ownerLogin, ownerLoginCode, ownerLogout, ownerMe, ownerHome,
  listCompanies, getCompany, updateCompany,
  listTickets, getTicket, replyTicket, updateTicket, ownerActivity, listFlags, updateFlag, listCompanyFlags, updateCompanyFlag,
} from '../controllers/ownerController'

// The owner console's API (erp, step 0). Only the owner's own session opens it.
export const ownerRouter = Router()

ownerRouter.post('/login', loginLimiter, asyncHandler(ownerLogin))
ownerRouter.post('/login/code', loginLimiter, asyncHandler(ownerLoginCode))
ownerRouter.post('/logout', requireOwner, asyncHandler(ownerLogout))
ownerRouter.get('/me', requireOwner, asyncHandler(ownerMe))
ownerRouter.get('/home', requireOwner, asyncHandler(ownerHome))
ownerRouter.get('/companies', requireOwner, asyncHandler(listCompanies))
ownerRouter.get('/companies/:id', requireOwner, asyncHandler(getCompany))
ownerRouter.patch('/companies/:id', requireOwner, asyncHandler(updateCompany))
ownerRouter.get('/support', requireOwner, asyncHandler(listTickets))
ownerRouter.get('/support/:id', requireOwner, asyncHandler(getTicket))
ownerRouter.post('/support/:id/reply', requireOwner, asyncHandler(replyTicket))
ownerRouter.patch('/support/:id', requireOwner, asyncHandler(updateTicket))
ownerRouter.get('/activity', requireOwner, asyncHandler(ownerActivity))
ownerRouter.get('/flags', requireOwner, asyncHandler(listFlags))
ownerRouter.patch('/flags/:key', requireOwner, asyncHandler(updateFlag))
ownerRouter.get('/companies/:id/flags', requireOwner, asyncHandler(listCompanyFlags))
ownerRouter.patch('/companies/:id/flags/:key', requireOwner, asyncHandler(updateCompanyFlag))
