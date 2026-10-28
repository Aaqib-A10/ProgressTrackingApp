import { Router } from 'express'
import {
  signup,
  login,
  logout,
  me,
  setActiveDepartment,
  forgotPassword,
  resetPassword,
  updateProfile,
  changePassword,
} from '../controllers/authController'
import { requireAuth } from '../middleware/auth'
import { loginLimiter, sensitiveAuthLimiter } from '../middleware/rateLimit'
import { asyncHandler } from '../lib/asyncHandler'
import { runAsCompany } from '../lib/tenancy'
import { HOME_COMPANY_ID } from '../lib/company'

export const authRouter = Router()

// The old sign-up page is 99 Technologies' own (people join a department there and wait for
// approval). New companies sign up on their own page (Phase 1, step 7).
authRouter.post('/signup', sensitiveAuthLimiter, asyncHandler((req, res) => runAsCompany(HOME_COMPANY_ID, () => signup(req, res))))
authRouter.post('/login', loginLimiter, asyncHandler(login))
authRouter.post('/logout', logout)
authRouter.get('/me', requireAuth, asyncHandler(me))
authRouter.post('/active-department', requireAuth, asyncHandler(setActiveDepartment))
authRouter.patch('/profile', requireAuth, asyncHandler(updateProfile))
authRouter.post('/change-password', requireAuth, asyncHandler(changePassword))
authRouter.post('/forgot-password', sensitiveAuthLimiter, asyncHandler(forgotPassword))
authRouter.post('/reset-password', sensitiveAuthLimiter, asyncHandler(resetPassword))
