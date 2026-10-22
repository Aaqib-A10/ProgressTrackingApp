import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'
import { listClaudeKeys, createClaudeKey, revokeClaudeKey } from '../controllers/claudeKeysController'
import { mcpEndpoint } from '../lib/mcp'
import { mcpLimiter } from '../middleware/rateLimit'

/** Settings → Connect Claude: the person's private keys. */
export const claudeRouter = Router()
claudeRouter.use(requireAuth)
claudeRouter.get('/keys', asyncHandler(listClaudeKeys))
claudeRouter.post('/keys', asyncHandler(createClaudeKey))
claudeRouter.delete('/keys/:id', asyncHandler(revokeClaudeKey))

/** The Metriq connector itself (Claude calls it with the key in the link; no login cookie). */
export const mcpRouter = Router()
mcpRouter.all('/:key', mcpLimiter, asyncHandler(mcpEndpoint))
