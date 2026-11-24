import type { Request, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { recordActivity } from '../lib/audit'
import { appUrl } from '../lib/mail'
import {
  authorizationServerMetadata, checkAuthorize, decide, endMyConnection, mcpResource, myConnections, protectedResourceMetadata, registerClient, revoke, token,
  type AuthorizeAsk,
} from '../lib/mcpAuth'

/**
 * Signing in to Metriq from Claude, ChatGPT and other MCP apps (lib/mcpAuth.ts has the rules). The discovery documents,
 * registration, token and revocation endpoints are public (an app calls them, not a person); the two calls behind the
 * Allow page need the person's own sign-in; the connected apps list is the person's own.
 */

const json = (res: Response, r: { status: number; json: Record<string, unknown> }) => res.status(r.status).json(r.json)

/** GET /.well-known/oauth-protected-resource[/api/mcp...] */
export function protectedResource(_req: Request, res: Response): void {
  res.set('Cache-Control', 'public, max-age=300').json(protectedResourceMetadata())
}

/** GET /.well-known/oauth-authorization-server and /.well-known/openid-configuration (and their path forms). */
export function authorizationServer(_req: Request, res: Response): void {
  res.set('Cache-Control', 'public, max-age=300').json(authorizationServerMetadata())
}

/** POST /api/oauth/register (RFC 7591) */
export async function register(req: Request, res: Response): Promise<void> {
  json(res.set('Cache-Control', 'no-store'), await registerClient((req.body ?? {}) as Record<string, unknown>))
}

/** Client id and secret sent as HTTP Basic (RFC 6749 2.3.1: each part form-encoded). */
function basicAuth(req: Request): { id: string; secret: string } | null {
  const h = req.headers.authorization
  if (!h || !/^Basic\s+/i.test(h)) return null
  try {
    const raw = Buffer.from(h.replace(/^Basic\s+/i, ''), 'base64').toString('utf8')
    const at = raw.indexOf(':')
    if (at < 0) return null
    const dec = (s: string) => decodeURIComponent(s.replace(/\+/g, ' '))
    return { id: dec(raw.slice(0, at)), secret: dec(raw.slice(at + 1)) }
  } catch { return null }
}

/** POST /api/oauth/token */
export async function tokenEndpoint(req: Request, res: Response): Promise<void> {
  res.set('Cache-Control', 'no-store').set('Pragma', 'no-cache')
  const basic = basicAuth(req)
  const r = await token((req.body ?? {}) as Record<string, unknown>, basic)
  if (r.status === 401 && basic) res.set('WWW-Authenticate', 'Basic realm="Metriq"')
  json(res, r)
}

/** POST /api/oauth/revoke (RFC 7009) */
export async function revokeEndpoint(req: Request, res: Response): Promise<void> {
  res.set('Cache-Control', 'no-store')
  json(res, await revoke((req.body ?? {}) as Record<string, unknown>, basicAuth(req)))
}

// ------------------------------------------------------------------ the Allow page (signed in)

const askSchema = z.object({
  response_type: z.string().max(40).optional(), client_id: z.string().max(500).optional(), redirect_uri: z.string().max(500).optional(),
  state: z.string().max(500).optional(), scope: z.string().max(500).optional(), code_challenge: z.string().max(200).optional(),
  code_challenge_method: z.string().max(20).optional(), resource: z.string().max(500).optional(),
}).passthrough()

/** Only Metriq's own pages may press Allow (a cookie-signed request from another site never can). */
function fromOurSite(req: Request): boolean {
  const origin = req.headers.origin
  if (!origin) return true // same-origin fetches from older browsers; the cookie is SameSite=Lax anyway
  const ours = new Set([new URL(appUrl()).origin, ...(process.env.CLIENT_ORIGIN ?? 'http://localhost:5173').split(',').map((o) => o.trim()).filter(Boolean)])
  return ours.has(origin)
}

/** Who may connect an app as themself: not Metriq support signed in as them, and not an app itself. */
function mayConnect(req: AuthedRequest): string | null {
  if (req.user!.supportBy) return 'Metriq support is signed in as this person, so no app can be connected. The person connects it themself.'
  if (req.user!.via === 'connector') return 'An app cannot connect another app.'
  return null
}

/** POST /api/oauth/authorize/check { ...the app's sign-in request } — what the Allow page shows. */
export async function authorizeCheck(req: AuthedRequest, res: Response): Promise<void> {
  const q = askSchema.safeParse(req.body ?? {})
  if (!q.success) { res.status(400).json({ error: 'This sign-in link is not complete. Start again from the app.' }); return }
  const c = await checkAuthorize(q.data as AuthorizeAsk)
  if (!c.ok) { res.json('page' in c ? { ok: false, error: c.page } : { ok: false, redirect: c.redirect }); return }
  const refused = mayConnect(req)
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { name: true, email: true, company: { select: { name: true } } } })
  const back = new URL(c.redirectUri)
  res.json({
    ok: true,
    app: { name: c.client.name, backTo: back.protocol === 'https:' || back.protocol === 'http:' ? back.host : `${back.protocol}//`, verified: c.client.clientId.startsWith('https://') },
    me: { name: me.name, email: me.email, company: me.company.name },
    ...(refused ? { refused } : {}),
  })
}

/** POST /api/oauth/authorize { ...request, allow } — the person pressed Allow or Cancel: where the browser goes now. */
export async function authorizeDecide(req: AuthedRequest, res: Response): Promise<void> {
  if (!fromOurSite(req)) { res.status(403).json({ error: 'Not allowed from another site.' }); return }
  const q = askSchema.extend({ allow: z.boolean() }).safeParse(req.body ?? {})
  if (!q.success) { res.status(400).json({ error: 'This sign-in link is not complete. Start again from the app.' }); return }
  const refused = mayConnect(req)
  if (refused && q.data.allow) { res.status(403).json({ error: refused }); return }
  const r = await decide(q.data as AuthorizeAsk, { id: req.user!.id, companyId: req.user!.companyId }, q.data.allow)
  if (!r.ok) { res.json('page' in r ? { error: r.page } : { redirect: r.redirect }); return }
  if (q.data.allow) {
    const c = await checkAuthorize(q.data as AuthorizeAsk)
    await recordActivity(req.user!.id, 'CREATE', 'Connector', req.user!.id, { after: { summary: `Signed in to ${c.ok ? c.client.name : 'an app'} with Metriq (connector)` } })
  }
  res.json({ redirect: r.redirect })
}

// ------------------------------------------------------------------ my connected apps

/** GET /api/oauth/connections — my connected apps, and the one address to paste into an app (the server's own: www or not). */
export async function listConnections(req: AuthedRequest, res: Response): Promise<void> {
  res.json({ connectorUrl: mcpResource(), connections: await myConnections(req.user!.id) })
}

/** DELETE /api/oauth/connections/:id — the app loses access at once. */
export async function deleteConnection(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await endMyConnection(req.user!.id, req.params.id))) { res.status(404).json({ error: 'Not found' }); return }
  await recordActivity(req.user!.id, 'DELETE', 'Connector', req.params.id, { after: { summary: 'Disconnected an app from Metriq' } })
  res.status(204).end()
}
