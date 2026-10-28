import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'
import { clientFlags } from '../lib/flags'

// The on/off switches the web app reads (Phase 1, step 1). Changed only in the owner console.
export const flagsRouter = Router()
flagsRouter.get('/', requireAuth, asyncHandler(async (req: AuthedRequest, res) => { res.json({ flags: await clientFlags(req.user!.companyId) }) }))
