import crypto from 'node:crypto'
import { lookup } from 'node:dns/promises'
import net from 'node:net'
import type { Role } from '@prisma/client'
import { prisma } from './prisma'
import { appUrl } from './mail'
import { captureError } from './health/errors'

/**
 * Signing in to Metriq from Claude, ChatGPT, Cursor and other MCP apps (OAuth 2.1, as the MCP authorization spec asks).
 * Before this, an app connected with a private key inside the link (/api/mcp/<key>); an app set up "without sign-in"
 * got 401 when its key was switched off and had no way to sign in (24 Nov 2026). Now:
 *
 *   1. The app calls /api/mcp with no token. Metriq answers 401 and, in WWW-Authenticate, where its description is
 *      (protected resource metadata, RFC 9728). That names Metriq as the sign-in service (RFC 8414 metadata).
 *   2. The app registers itself (dynamic client registration, RFC 7591), or uses its own https address as its id
 *      (client ID metadata document): Metriq reads that address once a day, safely.
 *   3. The person's browser opens /app/oauth/authorize. They sign in to Metriq as always (password, two-step sign-in,
 *      or their company's single sign-on), see which app asks and where it sends them back, and press Allow.
 *   4. The app swaps the one-time code for tokens, proving with PKCE (S256) that it is the app that asked.
 *   5. Every call carries the access token (1 hour). The refresh token (90 days) is swapped for a new pair on each use;
 *      an old refresh token that comes back ends the whole connection (it was copied).
 *
 * The app then works exactly as the person, with what they may see and do (lib/mcp.ts calls the app's own API as
 * them). A connection stops at once when the person disconnects it (Connectors page), changes their password, is
 * switched off, or their company is paused. Metriq support signed in as someone (help sign-in) can never connect an
 * app as them. Only hashes of codes and tokens are kept.
 */

export const SCOPE = 'metriq'
const CODE_TTL_MS = 10 * 60_000
const ACCESS_TTL_S = 3600
const REFRESH_TTL_MS = 90 * 86_400_000
export const ACCESS_PREFIX = 'mtqa_'
const REFRESH_PREFIX = 'mtqr_'
const CODE_PREFIX = 'mtqc_'
const CLIENT_PREFIX = 'mtqclient_'

const base = () => appUrl().replace(/\/+$/, '')
/** The connector's address, the "resource" tokens are for. */
export const mcpResource = () => `${base()}/api/mcp`
export const issuer = () => base()
export const authorizePage = () => `${base()}/app/oauth/authorize`
export const resourceMetadataUrl = () => `${base()}/.well-known/oauth-protected-resource/api/mcp`

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex')
const secret = (prefix: string) => prefix + crypto.randomBytes(32).toString('base64url')
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y) }

// ------------------------------------------------------------------ what Metriq tells apps about itself

/** RFC 9728: who signs people in for the connector. */
export function protectedResourceMetadata() {
  return {
    resource: mcpResource(),
    authorization_servers: [issuer()],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'Metriq',
    resource_documentation: `${base()}/app/connectors`,
  }
}

/** RFC 8414: how to sign in. */
export function authorizationServerMetadata() {
  const auth = ['none', 'client_secret_post', 'client_secret_basic']
  return {
    issuer: issuer(),
    authorization_endpoint: authorizePage(),
    token_endpoint: `${base()}/api/oauth/token`,
    registration_endpoint: `${base()}/api/oauth/register`,
    revocation_endpoint: `${base()}/api/oauth/revoke`,
    scopes_supported: [SCOPE],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: auth,
    revocation_endpoint_auth_methods_supported: auth,
    code_challenge_methods_supported: ['S256'],
    // Not offered: reading an app's own address from the server can fail (Claude's site turned the server away on
    // 24 Nov 2026, "This app is not known to Metriq"). Apps register instead (always works); a known app that still
    // sends its address is recognised without reading it (KNOWN_DOCUMENTS).
    client_id_metadata_document_supported: false,
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${base()}/app/connectors`,
  }
}

/** The WWW-Authenticate header of a 401 from the connector: where to find how to sign in. */
export function wwwAuthenticate(invalid = false): string {
  return `Bearer realm="Metriq", resource_metadata="${resourceMetadataUrl()}", scope="${SCOPE}"${invalid ? ', error="invalid_token", error_description="The token is not valid any more. Sign in again."' : ''}`
}

// ------------------------------------------------------------------ apps (clients)

type Client = { id: string; clientId: string; secretHash: string | null; name: string; redirectUris: string[]; authMethod: string }

const BLOCKED_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'vbscript:', 'about:', 'blob:', 'ftp:', 'ws:', 'wss:', 'chrome:', 'jar:'])
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/** A place a sign-in may send the code back to: https, this computer's own address, or an app's own scheme. */
export function redirectUriOk(u: string): boolean {
  if (typeof u !== 'string' || u.length > 500) return false
  let url: URL
  try { url = new URL(u) } catch { return false }
  if (url.hash || url.username || url.password) return false
  if (url.protocol === 'https:') return true
  if (url.protocol === 'http:') return LOOPBACK.has(url.hostname)
  // A native app's own scheme (cursor://, vscode://, com.example.app:/callback), never one a browser runs.
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) && !BLOCKED_SCHEMES.has(url.protocol)
}

/** Does this redirect match one the app registered? Exact, except the port on this computer's own address (RFC 8252). */
export function redirectMatches(registered: string[], asked: string): boolean {
  if (registered.includes(asked)) return true
  let a: URL
  try { a = new URL(asked) } catch { return false }
  if (a.protocol !== 'http:' || !LOOPBACK.has(a.hostname)) return false
  return registered.some((r) => {
    try { const x = new URL(r); return x.protocol === 'http:' && x.hostname === a.hostname && x.pathname === a.pathname && x.search === a.search } catch { return false }
  })
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** RFC 7591: an app registers itself. Returns its id (and a secret if it asked to sign in with one). */
export async function registerClient(body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  const bad = (d: string, error = 'invalid_client_metadata') => ({ status: 400, json: { error, error_description: d } })
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === 'string') : []
  if (!uris.length || uris.length > 10) return bad('Give one to ten redirect_uris.', 'invalid_redirect_uri')
  const wrong = uris.find((u) => !redirectUriOk(u))
  if (wrong) return bad(`This redirect_uri is not allowed: ${wrong.slice(0, 120)}`, 'invalid_redirect_uri')
  const method = text(body.token_endpoint_auth_method, 40) || 'none'
  if (!['none', 'client_secret_post', 'client_secret_basic'].includes(method)) return bad('token_endpoint_auth_method must be none, client_secret_post or client_secret_basic.')
  const grants = Array.isArray(body.grant_types) ? body.grant_types : ['authorization_code']
  if (grants.some((g) => g !== 'authorization_code' && g !== 'refresh_token')) return bad('Only authorization_code and refresh_token are supported.')
  const types = Array.isArray(body.response_types) ? body.response_types : ['code']
  if (types.some((t) => t !== 'code')) return bad('Only the code response type is supported.')
  const name = text(body.client_name, 80) || 'An app'
  const website = text(body.client_uri, 300)
  const clientId = CLIENT_PREFIX + crypto.randomBytes(18).toString('base64url')
  const clientSecret = method === 'none' ? null : secret('mtqs_')
  await prisma.oAuthClient.create({ data: { clientId, secretHash: clientSecret ? sha(clientSecret) : null, name, redirectUris: uris, authMethod: method, website: website && /^https:\/\//.test(website) ? website : null } })
  return {
    status: 201,
    json: {
      client_id: clientId, ...(clientSecret ? { client_secret: clientSecret, client_secret_expires_at: 0 } : {}),
      client_id_issued_at: Math.floor(Date.now() / 1000), client_name: name, redirect_uris: uris,
      token_endpoint_auth_method: method, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], scope: SCOPE,
    },
  }
}

/** Is this address one on the public internet (never this server, the office network or a cloud's internal address)? */
async function publicHost(hostname: string): Promise<boolean> {
  const h = hostname.replace(/^\[|\]$/g, '')
  if (!h || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return false
  const ips = net.isIP(h) ? [h] : (await lookup(h, { all: true }).catch(() => [])).map((r) => r.address)
  if (!ips.length) return false
  return ips.every((ip) => {
    if (net.isIPv4(ip)) {
      const [a, b] = ip.split('.').map(Number)
      return !(a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224)
    }
    const v = ip.toLowerCase()
    return !(v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:'))
  })
}

/** A client ID metadata document: the app's id is its own https address, which says its name and redirect_uris. */
async function fetchClientDocument(url: string): Promise<{ name: string; redirectUris: string[]; website: string | null } | null> {
  let u: URL
  try { u = new URL(url) } catch { return null }
  if (u.protocol !== 'https:' || u.hash || u.username || u.pathname === '/' || !(await publicHost(u.hostname))) return null
  try {
    const r = await fetch(u, { redirect: 'error', signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json', 'User-Agent': 'Metriq/1.0 (MCP client metadata; +https://pulsetrack.online)' } })
    if (!r.ok) { captureError({ source: 'JOB', message: `Could not read the app's metadata at ${u.host}${u.pathname}: HTTP ${r.status}`, route: 'oauth:client-metadata' }); return null }
    const raw = await r.text()
    if (raw.length > 32_768) return null
    const doc = JSON.parse(raw) as Record<string, unknown>
    if (doc.client_id !== url) return null
    const uris = Array.isArray(doc.redirect_uris) ? doc.redirect_uris.filter((x): x is string => typeof x === 'string' && redirectUriOk(x)).slice(0, 10) : []
    if (!uris.length) return null
    // An app that proves itself by its address alone signs in without a secret (PKCE).
    if (doc.token_endpoint_auth_method && doc.token_endpoint_auth_method !== 'none') return null
    const site = text(doc.client_uri, 300)
    return { name: text(doc.client_name, 80) || u.hostname, redirectUris: uris, website: /^https:\/\//.test(site) ? site : null }
  } catch (e) {
    captureError({ source: 'JOB', message: `Could not read the app's metadata at ${u.host}${u.pathname}: ${(e as Error).message.slice(0, 200)}`, route: 'oauth:client-metadata' })
    return null
  }
}

/**
 * Well-known apps' client ID metadata documents, exactly as they publish them (claude.ai checked 24 Nov 2026): used
 * when the app sends its address as its id and reading it fails. Exact id, exact redirect addresses only.
 */
const KNOWN_DOCUMENTS: Record<string, { name: string; redirectUris: string[]; website: string | null }> = {
  'https://claude.ai/oauth/mcp-oauth-client-metadata': { name: 'Claude', redirectUris: ['https://claude.ai/api/mcp/auth_callback'], website: 'https://claude.ai' },
}

/** The app behind a client_id: one that registered, or one whose id is its own address (read again once a day). */
export async function clientFor(clientId: string): Promise<Client | null> {
  if (!clientId || clientId.length > 500) return null
  const known = await prisma.oAuthClient.findUnique({ where: { clientId } })
  if (!clientId.startsWith('https://')) return known
  if (known && known.fetchedAt && Date.now() - known.fetchedAt.getTime() < 86_400_000) return known
  const doc = (await fetchClientDocument(clientId)) ?? KNOWN_DOCUMENTS[clientId] ?? null
  if (!doc) return known && known.fetchedAt && Date.now() - known.fetchedAt.getTime() < 7 * 86_400_000 ? known : null
  return prisma.oAuthClient.upsert({
    where: { clientId },
    create: { clientId, name: doc.name, redirectUris: doc.redirectUris, authMethod: 'none', metadataUrl: clientId, website: doc.website, fetchedAt: new Date() },
    update: { name: doc.name, redirectUris: doc.redirectUris, website: doc.website, fetchedAt: new Date() },
  })
}

// ------------------------------------------------------------------ the sign-in page (authorize)

export interface AuthorizeAsk {
  response_type?: string; client_id?: string; redirect_uri?: string; state?: string; scope?: string
  code_challenge?: string; code_challenge_method?: string; resource?: string
}

/** Where an error goes back to the app (the redirect is known good), or an error shown on the page (it is not). */
type Checked =
  | { ok: true; client: Client; redirectUri: string; challenge: string; scope: string; resource: string | null; state: string | null }
  | { ok: false; page: string }
  | { ok: false; redirect: string }

const withParams = (uri: string, p: Record<string, string | null | undefined>) => {
  const u = new URL(uri)
  for (const [k, v] of Object.entries(p)) if (v != null) u.searchParams.set(k, v)
  return u.toString()
}

/** The connector address or one under it (an old link with a key in it). Normalised to the connector's address. */
function resourceOk(r: string | undefined): string | null | false {
  if (!r) return null
  const want = mcpResource()
  const clean = r.replace(/\/+$/, '')
  return clean === want || clean.startsWith(`${want}/`) ? want : false
}

export async function checkAuthorize(q: AuthorizeAsk): Promise<Checked> {
  const id = text(q.client_id, 500)
  const client = await clientFor(id)
  if (!client) {
    const from = /^https:\/\//.test(id) ? (() => { try { return ` (${new URL(id).host})` } catch { return '' } })() : ''
    return { ok: false, page: `This app${from} is not known to Metriq. Remove the connector in the app and add it again.` }
  }
  const asked = text(q.redirect_uri, 500)
  const redirectUri = asked || (client.redirectUris.length === 1 ? client.redirectUris[0] : '')
  if (!redirectUri || !redirectMatches(client.redirectUris, redirectUri)) return { ok: false, page: 'The app asked to be sent back to an address it did not register. Nothing was shared.' }
  const state = text(q.state, 500) || null
  const fail = (error: string, description: string): Checked => ({ ok: false, redirect: withParams(redirectUri, { error, error_description: description, state, iss: issuer() }) })
  if (q.response_type !== 'code') return fail('unsupported_response_type', 'Only response_type=code is supported.')
  const challenge = text(q.code_challenge, 200)
  if (!challenge || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return fail('invalid_request', 'A code_challenge (PKCE) is required.')
  if ((q.code_challenge_method ?? 'plain') !== 'S256') return fail('invalid_request', 'code_challenge_method must be S256.')
  const resource = resourceOk(text(q.resource, 500) || undefined)
  if (resource === false) return fail('invalid_target', 'This sign-in is for Metriq\'s connector only.')
  // Scopes: Metriq has one ("metriq": everything the person may do). Others that apps add (offline_access, openid) are ignored.
  return { ok: true, client, redirectUri, challenge, scope: SCOPE, resource, state }
}

/** The person pressed Allow (or Cancel): where the browser goes back to. */
export async function decide(q: AuthorizeAsk, me: { id: string; companyId: string }, allow: boolean): Promise<{ ok: false; page: string } | { ok: false; redirect: string } | { ok: true; redirect: string }> {
  const c = await checkAuthorize(q)
  if (!c.ok) return c
  if (!allow) return { ok: true, redirect: withParams(c.redirectUri, { error: 'access_denied', error_description: 'The person did not allow it.', state: c.state, iss: issuer() }) }
  const code = secret(CODE_PREFIX)
  await prisma.oAuthCode.create({ data: { companyId: me.companyId, codeHash: sha(code), clientRef: c.client.id, userId: me.id, redirectUri: c.redirectUri, codeChallenge: c.challenge, scope: c.scope, resource: c.resource, expiresAt: new Date(Date.now() + CODE_TTL_MS) } })
  return { ok: true, redirect: withParams(c.redirectUri, { code, state: c.state, iss: issuer() }) }
}

// ------------------------------------------------------------------ tokens

type TokenAnswer = { status: number; json: Record<string, unknown> }
const oauthError = (error: string, description: string, status = 400): TokenAnswer => ({ status, json: { error, error_description: description } })

/** The person behind a connection may still use it: active, company not paused, no password change since. */
async function personOk(userId: string, since: Date): Promise<{ id: string; role: Role; name: string; companyId: string } | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, name: true, companyId: true, isActive: true, status: true, sessionsValidFrom: true, company: { select: { status: true } } } })
  if (!u || !u.isActive || u.status !== 'ACTIVE' || u.company.status === 'SUSPENDED') return null
  if (u.sessionsValidFrom && u.sessionsValidFrom.getTime() > since.getTime()) return null
  return { id: u.id, role: u.role, name: u.name, companyId: u.companyId }
}

async function issue(grant: { id: string; companyId: string; scope: string }): Promise<TokenAnswer> {
  const access = secret(ACCESS_PREFIX), refresh = secret(REFRESH_PREFIX)
  await prisma.oAuthToken.create({ data: { companyId: grant.companyId, grantId: grant.id, accessHash: sha(access), accessExpiresAt: new Date(Date.now() + ACCESS_TTL_S * 1000), refreshHash: sha(refresh), refreshExpiresAt: new Date(Date.now() + REFRESH_TTL_MS) } })
  return { status: 200, json: { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: grant.scope } }
}

const endGrant = (grantId: string) => prisma.$transaction([
  prisma.oAuthGrant.updateMany({ where: { id: grantId, revokedAt: null }, data: { revokedAt: new Date() } }),
  prisma.oAuthToken.updateMany({ where: { grantId, revokedAt: null }, data: { revokedAt: new Date() } }),
])

/** Which app is asking at the token endpoint, with its secret when it has one. */
async function tokenClient(body: Record<string, unknown>, basic: { id: string; secret: string } | null): Promise<Client | TokenAnswer> {
  const id = basic?.id || text(body.client_id, 500)
  const client = await clientFor(id)
  if (!client) return oauthError('invalid_client', 'Unknown client.', 401)
  if (client.secretHash) {
    const given = basic?.secret || text(body.client_secret, 200)
    if (!given || !same(sha(given), client.secretHash)) return oauthError('invalid_client', 'The client secret is wrong.', 401)
  }
  return client
}

/** POST /api/oauth/token: a code (with its PKCE verifier) or a refresh token, swapped for new tokens. */
export async function token(body: Record<string, unknown>, basic: { id: string; secret: string } | null): Promise<TokenAnswer> {
  const client = await tokenClient(body, basic)
  if ('status' in client) return client
  const kind = text(body.grant_type, 40)

  if (kind === 'authorization_code') {
    const code = text(body.code, 200)
    const row = code.startsWith(CODE_PREFIX) ? await prisma.oAuthCode.findUnique({ where: { codeHash: sha(code) } }) : null
    if (!row || row.clientRef !== client.id) return oauthError('invalid_grant', 'This code is not valid.')
    // A code used twice: someone copied it. The connection made with it ends.
    if (row.usedAt) { if (row.grantId) await endGrant(row.grantId); return oauthError('invalid_grant', 'This code was already used.') }
    if (row.expiresAt.getTime() < Date.now()) return oauthError('invalid_grant', 'This code has expired. Sign in again.')
    const redirect = text(body.redirect_uri, 500)
    if (redirect && redirect !== row.redirectUri) return oauthError('invalid_grant', 'redirect_uri does not match the sign-in.')
    const verifier = text(body.code_verifier, 200)
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || crypto.createHash('sha256').update(verifier).digest('base64url') !== row.codeChallenge) return oauthError('invalid_grant', 'The code_verifier does not match (PKCE).')
    const resource = resourceOk(text(body.resource, 500) || undefined)
    if (resource === false || (resource && row.resource && resource !== row.resource)) return oauthError('invalid_target', 'This token is for Metriq\'s connector only.')
    // Taken once: two requests at the same moment cannot both get tokens.
    const took = await prisma.oAuthCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } })
    if (!took.count) return oauthError('invalid_grant', 'This code was already used.')
    const person = await personOk(row.userId, row.createdAt)
    if (!person) return oauthError('invalid_grant', 'This account cannot sign in any more.')
    const grant = await prisma.oAuthGrant.create({ data: { companyId: row.companyId, clientRef: client.id, userId: row.userId, scope: row.scope, resource: row.resource ?? resource ?? mcpResource() } })
    await prisma.oAuthCode.update({ where: { id: row.id }, data: { grantId: grant.id } })
    await prisma.oAuthClient.update({ where: { id: client.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined)
    return issue(grant)
  }

  if (kind === 'refresh_token') {
    const refresh = text(body.refresh_token, 200)
    const row = refresh.startsWith(REFRESH_PREFIX) ? await prisma.oAuthToken.findUnique({ where: { refreshHash: sha(refresh) }, include: { grant: true } }) : null
    if (!row || row.grant.clientRef !== client.id) return oauthError('invalid_grant', 'This refresh token is not valid.')
    // A refresh token that was already swapped: it was copied. The whole connection ends.
    if (row.rotatedAt) { await endGrant(row.grantId); return oauthError('invalid_grant', 'This refresh token was already used. Sign in again.') }
    if (row.revokedAt || row.grant.revokedAt) return oauthError('invalid_grant', 'This connection was ended. Sign in again.')
    if (!row.refreshExpiresAt || row.refreshExpiresAt.getTime() < Date.now()) return oauthError('invalid_grant', 'This refresh token has expired. Sign in again.')
    if (!(await personOk(row.grant.userId, row.grant.createdAt))) { await endGrant(row.grantId); return oauthError('invalid_grant', 'This account cannot sign in any more.') }
    const took = await prisma.oAuthToken.updateMany({ where: { id: row.id, rotatedAt: null }, data: { rotatedAt: new Date(), revokedAt: new Date() } })
    if (!took.count) { await endGrant(row.grantId); return oauthError('invalid_grant', 'This refresh token was already used. Sign in again.') }
    return issue(row.grant)
  }

  return oauthError('unsupported_grant_type', 'Use authorization_code or refresh_token.')
}

/** RFC 7009: an app gives back a token. Always "done", whether or not the token was known. */
export async function revoke(body: Record<string, unknown>, basic: { id: string; secret: string } | null): Promise<TokenAnswer> {
  const client = await tokenClient(body, basic)
  if ('status' in client) return client
  const t = text(body.token, 200)
  const row = t.startsWith(ACCESS_PREFIX) ? await prisma.oAuthToken.findUnique({ where: { accessHash: sha(t) }, include: { grant: true } })
    : t.startsWith(REFRESH_PREFIX) ? await prisma.oAuthToken.findUnique({ where: { refreshHash: sha(t) }, include: { grant: true } }) : null
  if (row && row.grant.clientRef === client.id) {
    // Giving back the refresh token ends the connection; an access token only stops itself.
    if (t.startsWith(REFRESH_PREFIX)) await endGrant(row.grantId)
    else await prisma.oAuthToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } })
  }
  return { status: 200, json: {} }
}

/** The person an access token works as, or null (unknown, expired, ended, or the person may not sign in any more). */
export async function userForAccessToken(t: string): Promise<{ id: string; role: Role; name: string; companyId: string } | null> {
  if (!t.startsWith(ACCESS_PREFIX) || t.length > 200) return null
  const row = await prisma.oAuthToken.findUnique({ where: { accessHash: sha(t) }, include: { grant: true } })
  if (!row || row.revokedAt || row.grant.revokedAt || row.accessExpiresAt.getTime() < Date.now()) return null
  if (row.grant.resource && row.grant.resource !== mcpResource()) return null
  const person = await personOk(row.grant.userId, row.grant.createdAt)
  if (!person) return null
  if (!row.grant.lastUsedAt || Date.now() - row.grant.lastUsedAt.getTime() > 5 * 60_000) await prisma.oAuthGrant.update({ where: { id: row.grantId }, data: { lastUsedAt: new Date() } }).catch(() => undefined)
  return person
}

// ------------------------------------------------------------------ the person's connected apps

/** My connected apps (Connectors page). */
export async function myConnections(userId: string) {
  const rows = await prisma.oAuthGrant.findMany({ where: { userId, revokedAt: null }, include: { client: { select: { name: true, website: true, metadataUrl: true, redirectUris: true } } }, orderBy: { createdAt: 'desc' } })
  const host = (u: string | undefined) => { try { return u ? new URL(u).host : null } catch { return null } }
  return rows.map((g) => ({ id: g.id, app: g.client.name, from: host(g.client.website ?? g.client.metadataUrl ?? g.client.redirectUris[0]), connectedAt: g.createdAt.toISOString(), lastUsedAt: g.lastUsedAt?.toISOString() ?? null }))
}

/** Disconnect one of my apps: it loses access at once. */
export async function endMyConnection(userId: string, grantId: string): Promise<boolean> {
  const g = await prisma.oAuthGrant.findFirst({ where: { id: grantId, userId, revokedAt: null }, select: { id: true } })
  if (!g) return false
  await endGrant(g.id)
  return true
}
