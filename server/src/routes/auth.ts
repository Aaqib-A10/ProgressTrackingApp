import express, { Router } from 'express'
import * as Sso from '../controllers/ssoController'
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
  saveDashboardPrefs,
  saveTheme,
  saveNav,
  saveWhatsapp,
} from '../controllers/authController'
import { requireAuth } from '../middleware/auth'
import { loginLimiter, sensitiveAuthLimiter } from '../middleware/rateLimit'
import { asyncHandler } from '../lib/asyncHandler'
import { runAsCompany } from '../lib/tenancy'
import * as S from '../controllers/signupController'
import * as TwoStep from '../controllers/twoStepController'
import { HOME_COMPANY_ID } from '../lib/company'

export const authRouter = Router()

// The old sign-up page is 99 Technologies' own (people join a department there and wait for
// approval). New companies sign up on their own page (Phase 1, step 7).
authRouter.post('/signup', sensitiveAuthLimiter, asyncHandler((req, res) => runAsCompany(HOME_COMPANY_ID, () => signup(req, res))))
authRouter.post('/login', loginLimiter, asyncHandler(login))
// Single sign-on (SAML): the identity provider posts a form back, so that one address reads form fields.
authRouter.post('/sso/find', loginLimiter, asyncHandler(Sso.find))
authRouter.get('/sso/:slug/metadata', asyncHandler(Sso.metadata))
authRouter.get('/sso/:slug/start', loginLimiter, asyncHandler(Sso.start))
authRouter.post('/sso/:slug/acs', loginLimiter, express.urlencoded({ extended: false, limit: '2mb' }), asyncHandler(Sso.acs))
// Two-step sign-in: the code after the password, and each person's own setup (Settings → Security).
authRouter.post('/login/two-step', loginLimiter, asyncHandler(TwoStep.loginTwoStep))
authRouter.get('/me/two-step', requireAuth, asyncHandler(TwoStep.twoStepStatus))
authRouter.post('/me/two-step/start', requireAuth, sensitiveAuthLimiter, asyncHandler(TwoStep.twoStepStart))
authRouter.post('/me/two-step/confirm', requireAuth, sensitiveAuthLimiter, asyncHandler(TwoStep.twoStepConfirm))
authRouter.post('/me/two-step/recovery', requireAuth, sensitiveAuthLimiter, asyncHandler(TwoStep.twoStepNewRecovery))
authRouter.post('/me/two-step/off', requireAuth, sensitiveAuthLimiter, asyncHandler(TwoStep.twoStepOff))
// Phase 1, step 7: companies and solo users sign up on their own.
authRouter.get('/open', asyncHandler(S.signupOpen))
authRouter.post('/start', sensitiveAuthLimiter, asyncHandler(S.start))
authRouter.post('/verify-email', sensitiveAuthLimiter, asyncHandler(S.verifyEmail))
authRouter.post('/verify-email/resend', requireAuth, sensitiveAuthLimiter, asyncHandler(S.resendVerify))
authRouter.get('/company/:slug', asyncHandler(S.companyBySlug))
authRouter.get('/oauth/providers', asyncHandler(S.oauthProviders))
authRouter.get('/oauth/:provider/start', sensitiveAuthLimiter, asyncHandler(S.oauthStart))
authRouter.get('/oauth/:provider/callback', asyncHandler(S.oauthCallback))
authRouter.post('/logout', logout)
authRouter.get('/me', requireAuth, asyncHandler(me))
authRouter.put('/me/dashboard', requireAuth, asyncHandler(saveDashboardPrefs))
authRouter.put('/me/theme', requireAuth, asyncHandler(saveTheme))
authRouter.put('/me/nav', requireAuth, asyncHandler(saveNav))
authRouter.put('/me/whatsapp', requireAuth, asyncHandler(saveWhatsapp))
authRouter.post('/active-department', requireAuth, asyncHandler(setActiveDepartment))
authRouter.patch('/profile', requireAuth, asyncHandler(updateProfile))
authRouter.post('/change-password', requireAuth, asyncHandler(changePassword))
authRouter.post('/forgot-password', sensitiveAuthLimiter, asyncHandler(forgotPassword))
authRouter.post('/reset-password', sensitiveAuthLimiter, asyncHandler(resetPassword))
