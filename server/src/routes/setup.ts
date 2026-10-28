import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'
import * as S from '../controllers/setupController'

// /api/setup — the setup wizard for a new company (Phase 1, step 7).
export const setupRouter = Router()
setupRouter.use(requireAuth)
setupRouter.get('/', asyncHandler(S.status))
setupRouter.post('/departments', asyncHandler(S.departments))
setupRouter.post('/daily-form', asyncHandler(S.dailyForm))
setupRouter.post('/sample', asyncHandler(S.sample))
setupRouter.post('/done', asyncHandler(S.done))
