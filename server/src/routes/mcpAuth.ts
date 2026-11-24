import express, { Router, type NextFunction, type Request, type Response } from 'express'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'
import { oauthLimiter } from '../middleware/rateLimit'
import {
  authorizationServer, authorizeCheck, authorizeDecide, deleteConnection, listConnections, protectedResource, register, revokeEndpoint, tokenEndpoint,
} from '../controllers/mcpAuthController'

/**
 * Sign-in for MCP apps (lib/mcpAuth.ts). /.well-known is answered by the app (nginx passes those addresses on:
 * scripts/nginx-oauth.sh); the rest is under /api/oauth.
 */
export const wellKnownRouter = Router()
wellKnownRouter.get(['/oauth-protected-resource', '/oauth-protected-resource/*'], protectedResource)
wellKnownRouter.get(['/oauth-authorization-server', '/oauth-authorization-server/*', '/openid-configuration', '/openid-configuration/*'], authorizationServer)

export const oauthRouter = Router()
// Apps send forms (application/x-www-form-urlencoded) to the token and revocation endpoints.
oauthRouter.use(express.urlencoded({ extended: false, limit: '64kb' }))
oauthRouter.get('/protected-resource', protectedResource)
oauthRouter.post('/register', oauthLimiter, asyncHandler(register))
oauthRouter.post('/token', oauthLimiter, asyncHandler(tokenEndpoint))
oauthRouter.post('/revoke', oauthLimiter, asyncHandler(revokeEndpoint))
oauthRouter.post('/authorize/check', requireAuth, asyncHandler(authorizeCheck))
oauthRouter.post('/authorize', requireAuth, asyncHandler(authorizeDecide))
oauthRouter.get('/connections', requireAuth, asyncHandler(listConnections))
oauthRouter.delete('/connections/:id', requireAuth, asyncHandler(deleteConnection))

/**
 * Open CORS for what apps call without cookies (discovery, registration, tokens, the connector): a browser-based MCP
 * app may call them from any site. Bearer tokens only, never cookies, so this opens nothing a person is signed in to.
 */
const OPEN = /^\/(\.well-known\/(oauth-|openid-configuration)|api\/oauth\/(register|token|revoke|protected-resource)$|api\/mcp(\/|$))/
export const isOpenCors = (path: string) => OPEN.test(path)
export function openCors(req: Request, res: Response, next: NextFunction): void {
  if (!OPEN.test(req.path)) { next(); return }
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID',
    'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id, MCP-Protocol-Version',
    'Access-Control-Max-Age': '600',
  })
  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  next()
}
