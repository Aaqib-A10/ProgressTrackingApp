import { Router, raw } from 'express'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'
import * as B from '../controllers/billingController'

// /api/billing — plans, checkout, invoices (Phase 1, step 8). The payment providers' messages
// come to /api/billing/webhook/:provider without a sign-in; their signature is checked.
export const billingRouter = Router()
billingRouter.post('/webhook/:provider', raw({ type: () => true, limit: '1mb' }), asyncHandler(B.webhook))
billingRouter.use(requireAuth)
billingRouter.get('/', asyncHandler(B.overview))
billingRouter.post('/checkout', asyncHandler(B.checkout))
billingRouter.post('/change', asyncHandler(B.changePlan))
billingRouter.post('/cancel', asyncHandler(B.cancel))
billingRouter.post('/resume', asyncHandler(B.resume))
billingRouter.get('/portal', asyncHandler(B.portal))
billingRouter.post('/test/pay', asyncHandler(B.testPay))
billingRouter.get('/invoices/:id', asyncHandler(B.invoice))
