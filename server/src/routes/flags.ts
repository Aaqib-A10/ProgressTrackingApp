import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'
import { clientFlags } from '../lib/flags'

// The on/off switches the web app reads (Phase 1, step 1). Changed only in the owner console.
export const flagsRouter = Router()
flagsRouter.get('/', requireAuth, asyncHandler(async (_req, res) => { res.json({ flags: await clientFlags() }) }))
