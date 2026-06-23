import { Router } from 'express'
import {
  signup,
  login,
  logout,
  me,
  forgotPassword,
  resetPassword,
  updateProfile,
  changePassword,
} from '../controllers/authController'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'

export const authRouter = Router()

authRouter.post('/signup', asyncHandler(signup))
authRouter.post('/login', asyncHandler(login))
authRouter.post('/logout', logout)
authRouter.get('/me', requireAuth, asyncHandler(me))
authRouter.patch('/profile', requireAuth, asyncHandler(updateProfile))
authRouter.post('/change-password', requireAuth, asyncHandler(changePassword))
authRouter.post('/forgot-password', asyncHandler(forgotPassword))
authRouter.post('/reset-password', asyncHandler(resetPassword))
