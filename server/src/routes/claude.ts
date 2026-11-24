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

/**
 * The Metriq connector itself, never with a login cookie: /api/mcp with a token from signing in through the app
 * (lib/mcpAuth.ts), or /api/mcp/<key> with a private key in the link (the older way).
 */
export const mcpRouter = Router()
mcpRouter.all('/', mcpLimiter, asyncHandler(mcpEndpoint))
mcpRouter.all('/:key', mcpLimiter, asyncHandler(mcpEndpoint))
