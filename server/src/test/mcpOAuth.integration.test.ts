import crypto from 'node:crypto'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { signSupportToken } from '../lib/auth'

// Signing in to Metriq from Claude and other MCP apps (lib/mcpAuth.ts). 24 Nov 2026: Claude's "Metriq" connector was
// set up without sign-in, its key was switched off, and it showed "the server asked for sign-in (status 401)" with no
// way to sign in. These follow the whole sign-in as Claude does it, and every way it must stop working.

let w: SeededWorld
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback'
const pkce = () => { const verifier = crypto.randomBytes(40).toString('base64url'); return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') } }
const form = (o: Record<string, string>) => new URLSearchParams(o).toString()
type U = { id: string; role: SeededWorld['itadLead']['role'] }

async function registerApp(extra: Record<string, unknown> = {}) {
  const r = await request(app).post('/api/oauth/register').send({ client_name: 'Claude', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], ...extra }).expect(201)
  return r.body as { client_id: string; client_secret?: string }
}

/** The person presses Allow; returns the code and the PKCE verifier. */
async function allow(u: U, clientId: string, state = 'xyz') {
  const { verifier, challenge } = pkce()
  const ask = { response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, state, code_challenge: challenge, code_challenge_method: 'S256', scope: 'metriq', resource: 'http://localhost:5173/api/mcp' }
  const r = await request(app).post('/api/oauth/authorize').set(...auth(u)).send({ ...ask, allow: true }).expect(200)
  const back = new URL(r.body.redirect)
  expect(back.origin + back.pathname).toBe(REDIRECT)
  expect(back.searchParams.get('state')).toBe(state)
  expect(back.searchParams.get('iss')).toBe('http://localhost:5173')
  return { code: back.searchParams.get('code')!, verifier }
}

async function tokensFor(u: U, clientId: string) {
  const { code, verifier } = await allow(u, clientId)
  const r = await request(app).post('/api/oauth/token').type('form').send(form({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: REDIRECT })).expect(200)
  return r.body as { access_token: string; refresh_token: string; expires_in: number; token_type: string }
}

const mcp = (token: string | null, body: object = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, path = '/api/mcp') => {
  const r = request(app).post(path).send(body)
  return token ? r.set('Authorization', `Bearer ${token}`) : r
}

beforeAll(async () => { w = await seedWorld() })
afterAll(async () => { vi.restoreAllMocks(); await prisma.$disconnect() })

describe('Finding out how to sign in', () => {
  it('the connector answers 401 with where its sign-in is described', async () => {
    const r = await mcp(null).expect(401)
    expect(r.headers['www-authenticate']).toContain('resource_metadata="http://localhost:5173/.well-known/oauth-protected-resource/api/mcp"')
    // GET (some apps look first) gets the same 401, not a 405.
    expect((await request(app).get('/api/mcp').expect(401)).headers['www-authenticate']).toContain('Bearer')
  })

  it('describes the connector and the sign-in service', async () => {
    const prm = (await request(app).get('/.well-known/oauth-protected-resource/api/mcp').expect(200)).body
    expect(prm).toMatchObject({ resource: 'http://localhost:5173/api/mcp', authorization_servers: ['http://localhost:5173'], scopes_supported: ['metriq'] })
    expect((await request(app).get('/.well-known/oauth-protected-resource').expect(200)).body.resource).toBe(prm.resource)
    for (const path of ['/.well-known/oauth-authorization-server', '/.well-known/openid-configuration']) {
      const md = (await request(app).get(path).expect(200)).body
      expect(md).toMatchObject({ issuer: 'http://localhost:5173', authorization_endpoint: 'http://localhost:5173/app/oauth/authorize', token_endpoint: 'http://localhost:5173/api/oauth/token', registration_endpoint: 'http://localhost:5173/api/oauth/register', code_challenge_methods_supported: ['S256'], client_id_metadata_document_supported: false })
    }
  })

  it('opens CORS to apps for these addresses only, never for the rest of the app', async () => {
    const pre = await request(app).options('/api/oauth/token').set('Origin', 'https://some-mcp-app.example').set('Access-Control-Request-Method', 'POST').expect(204)
    expect(pre.headers['access-control-allow-origin']).toBe('*')
    expect(pre.headers['access-control-allow-credentials']).toBeUndefined()
    const other = await request(app).get('/api/auth/me').set('Origin', 'https://some-mcp-app.example')
    expect(other.headers['access-control-allow-origin']).toBeUndefined()
  })
})

describe('Registering an app', () => {
  it("accepts https, this computer and an app's own scheme; refuses anything a browser could run or another site", async () => {
    for (const bad of ['http://evil.example/cb', 'javascript:alert(1)', 'data:text/html,x', 'https://claude.ai/cb#frag', 'not a url']) {
      const r = await request(app).post('/api/oauth/register').send({ client_name: 'X', redirect_uris: [bad] }).expect(400)
      expect(r.body.error).toBe('invalid_redirect_uri')
    }
    await request(app).post('/api/oauth/register').send({ client_name: 'X', redirect_uris: [] }).expect(400)
    await request(app).post('/api/oauth/register').send({ client_name: 'X', redirect_uris: [REDIRECT], grant_types: ['password'] }).expect(400)
    for (const ok of ['http://127.0.0.1:33418/callback', 'http://localhost/cb', 'cursor://anysphere.cursor-retrieval/oauth/callback']) await request(app).post('/api/oauth/register').send({ client_name: 'Y', redirect_uris: [ok] }).expect(201)
    const c = await registerApp()
    expect(c.client_id).toMatch(/^mtqclient_/)
    expect(c.client_secret).toBeUndefined()
  })
})

describe('The Allow page', () => {
  it('shows the app, where it sends the person back, and who they are', async () => {
    const c = await registerApp()
    const { challenge } = pkce()
    const r = await request(app).post('/api/oauth/authorize/check').set(...auth(w.itadMember)).send({ response_type: 'code', client_id: c.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256' }).expect(200)
    expect(r.body).toMatchObject({ ok: true, app: { name: 'Claude', backTo: 'claude.ai' } })
    expect(r.body.me.name).toBeTruthy()
  })

  it('never sends anything to an address the app did not register, and needs PKCE', async () => {
    const c = await registerApp()
    const { challenge } = pkce()
    const base = { response_type: 'code', client_id: c.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256' }
    const check = async (o: Record<string, unknown>) => (await request(app).post('/api/oauth/authorize/check').set(...auth(w.itadMember)).send(o).expect(200)).body
    expect(await check({ ...base, client_id: 'mtqclient_nope' })).toMatchObject({ ok: false, error: expect.any(String) })
    expect(await check({ ...base, redirect_uri: 'https://evil.example/cb' })).toMatchObject({ ok: false, error: expect.any(String) })
    expect(new URL((await check({ ...base, code_challenge: undefined })).redirect).searchParams.get('error')).toBe('invalid_request')
    expect(new URL((await check({ ...base, code_challenge_method: 'plain' })).redirect).searchParams.get('error')).toBe('invalid_request')
    expect(new URL((await check({ ...base, resource: 'https://other.example/api' })).redirect).searchParams.get('error')).toBe('invalid_target')
  })

  it('Cancel sends access_denied back; another site cannot press Allow; it needs a sign-in', async () => {
    const c = await registerApp()
    const { challenge } = pkce()
    const ask = { response_type: 'code', client_id: c.client_id, redirect_uri: REDIRECT, state: 's1', code_challenge: challenge, code_challenge_method: 'S256' }
    const no = (await request(app).post('/api/oauth/authorize').set(...auth(w.itadMember)).send({ ...ask, allow: false }).expect(200)).body
    expect(new URL(no.redirect).searchParams.get('error')).toBe('access_denied')
    await request(app).post('/api/oauth/authorize').set(...auth(w.itadMember)).set('Origin', 'https://evil.example').send({ ...ask, allow: true }).expect(403)
    await request(app).post('/api/oauth/authorize').send({ ...ask, allow: true }).expect(401)
  })

  it('Metriq support signed in as a person can never connect an app as them', async () => {
    await prisma.company.update({ where: { id: 'company-1' }, data: { supportAccessUntil: new Date(Date.now() + 3600_000) } })
    const c = await registerApp()
    const { challenge } = pkce()
    const support = signSupportToken({ sub: w.itadMember.id, role: w.itadMember.role, ownerId: 'owner-x' }, 600)
    await request(app).post('/api/oauth/authorize').set('Authorization', `Bearer ${support}`).send({ response_type: 'code', client_id: c.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', allow: true }).expect(403)
    await prisma.company.update({ where: { id: 'company-1' }, data: { supportAccessUntil: null } })
  })
})

describe('Tokens and the connector', () => {
  it('a code with the right PKCE verifier gives tokens, and the connector works as the person', async () => {
    const c = await registerApp()
    const t = await tokensFor(w.itadMember, c.client_id)
    expect(t).toMatchObject({ token_type: 'Bearer', expires_in: 3600 })
    expect(t.access_token).toMatch(/^mtqa_/)
    const init = await mcp(t.access_token).expect(200)
    expect(init.body.result.serverInfo.name).toBe('metriq')
    expect(init.body.result.instructions).toContain('You are working as')
    const tools = await mcp(t.access_token, { jsonrpc: '2.0', id: 2, method: 'tools/list' }).expect(200)
    expect(tools.body.result.tools.length).toBeGreaterThan(5)
  })

  it('refuses a wrong verifier, a code used twice (and ends what it made), and an expired code', async () => {
    const c = await registerApp()
    const { code } = await allow(w.itadMember, c.client_id)
    const wrong = await request(app).post('/api/oauth/token').type('form').send(form({ grant_type: 'authorization_code', code, code_verifier: pkce().verifier, client_id: c.client_id })).expect(400)
    expect(wrong.body.error).toBe('invalid_grant')

    const a = await allow(w.itadMember, c.client_id)
    const ok = (await request(app).post('/api/oauth/token').type('form').send(form({ grant_type: 'authorization_code', code: a.code, code_verifier: a.verifier, client_id: c.client_id, redirect_uri: REDIRECT })).expect(200)).body
    await mcp(ok.access_token).expect(200)
    // The same code again: copied. Refused, and the connection it made ends.
    await request(app).post('/api/oauth/token').type('form').send(form({ grant_type: 'authorization_code', code: a.code, code_verifier: a.verifier, client_id: c.client_id })).expect(400)
    await mcp(ok.access_token).expect(401)

    const b = await allow(w.itadMember, c.client_id)
    await prisma.oAuthCode.updateMany({ where: { usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } })
    expect((await request(app).post('/api/oauth/token').type('form').send(form({ grant_type: 'authorization_code', code: b.code, code_verifier: b.verifier, client_id: c.client_id })).expect(400)).body.error).toBe('invalid_grant')
  })

  it("another app cannot use this app's code", async () => {
    const mine = await registerApp(), theirs = await registerApp({ client_name: 'Other' })
    const a = await allow(w.itadMember, mine.client_id)
    await request(app).post('/api/oauth/token').type('form').send(form({ grant_type: 'authorization_code', code: a.code, code_verifier: a.verifier, client_id: theirs.client_id })).expect(400)
  })

  it('a refresh token gives a new pair once; the old one coming back ends the connection', async () => {
    const c = await registerApp()
    const t = await tokensFor(w.itadMember, c.client_id)
    const next = (await request(app).post('/api/oauth/token').type('form').send(form({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: c.client_id })).expect(200)).body
    expect(next.refresh_token).not.toBe(t.refresh_token)
    await mcp(next.access_token).expect(200)
    await mcp(t.access_token).expect(401) // the old access token went with its refresh token
    // The old refresh token again: copied. The whole connection ends.
    await request(app).post('/api/oauth/token').type('form').send(form({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: c.client_id })).expect(400)
    await mcp(next.access_token).expect(401)
  })

  it('an app with a secret must send it (in the form or as Basic)', async () => {
    const c = await registerApp({ token_endpoint_auth_method: 'client_secret_basic' })
    expect(c.client_secret).toMatch(/^mtqs_/)
    const a = await allow(w.itadMember, c.client_id)
    await request(app).post('/api/oauth/token').type('form').send(form({ grant_type: 'authorization_code', code: a.code, code_verifier: a.verifier, client_id: c.client_id })).expect(401)
    const basic = Buffer.from(`${encodeURIComponent(c.client_id)}:${encodeURIComponent(c.client_secret!)}`).toString('base64')
    await request(app).post('/api/oauth/token').set('Authorization', `Basic ${basic}`).type('form').send(form({ grant_type: 'authorization_code', code: a.code, code_verifier: a.verifier })).expect(200)
  })

  it('the old link with a key that was switched off asks for sign-in, and works with a sign-in token', async () => {
    const c = await registerApp()
    const t = await tokensFor(w.itadMember, c.client_id)
    const r = await mcp(null, undefined, '/api/mcp/mtq_switchedoffkeyswitchedoffkey').expect(401)
    expect(r.headers['www-authenticate']).toContain('error="invalid_token"')
    await mcp(t.access_token, undefined, '/api/mcp/mtq_switchedoffkeyswitchedoffkey').expect(200)
  })
})

describe('A connection stops', () => {
  it('when the person disconnects it on the Connectors page', async () => {
    const c = await registerApp()
    const t = await tokensFor(w.leadgenMember, c.client_id)
    const list = (await request(app).get('/api/oauth/connections').set(...auth(w.leadgenMember)).expect(200)).body.connections as { id: string; app: string; from: string }[]
    expect(list[0]).toMatchObject({ app: 'Claude', from: 'claude.ai' })
    // Not someone else's to end.
    await request(app).delete(`/api/oauth/connections/${list[0].id}`).set(...auth(w.itadMember)).expect(404)
    await request(app).delete(`/api/oauth/connections/${list[0].id}`).set(...auth(w.leadgenMember)).expect(204)
    await mcp(t.access_token).expect(401)
    await request(app).post('/api/oauth/token').type('form').send(form({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: c.client_id })).expect(400)
  })

  it('when the app gives its refresh token back (revocation)', async () => {
    const c = await registerApp()
    const t = await tokensFor(w.leadgenMember, c.client_id)
    await request(app).post('/api/oauth/revoke').type('form').send(form({ token: t.refresh_token, client_id: c.client_id })).expect(200)
    await mcp(t.access_token).expect(401)
  })

  it('when the person changes their password, is switched off, or their company is paused', async () => {
    const c = await registerApp()
    const t1 = await tokensFor(w.inventoryMember, c.client_id)
    await prisma.user.update({ where: { id: w.inventoryMember.id }, data: { sessionsValidFrom: new Date(Date.now() + 1000) } })
    await mcp(t1.access_token).expect(401)
    await prisma.user.update({ where: { id: w.inventoryMember.id }, data: { sessionsValidFrom: null } })

    const t2 = await tokensFor(w.inventoryMember, c.client_id)
    await prisma.user.update({ where: { id: w.inventoryMember.id }, data: { isActive: false } })
    await mcp(t2.access_token).expect(401)
    await request(app).post('/api/oauth/token').type('form').send(form({ grant_type: 'refresh_token', refresh_token: t2.refresh_token, client_id: c.client_id })).expect(400)
    await prisma.user.update({ where: { id: w.inventoryMember.id }, data: { isActive: true } })

    const t3 = await tokensFor(w.inventoryMember, c.client_id)
    await prisma.company.update({ where: { id: 'company-1' }, data: { status: 'SUSPENDED' } })
    await mcp(t3.access_token).expect(401)
    await prisma.company.update({ where: { id: 'company-1' }, data: { status: 'ACTIVE' } })
    await mcp(t3.access_token).expect(200)
  })

  it('an expired access token does not work; the app refreshes', async () => {
    const c = await registerApp()
    const t = await tokensFor(w.inventoryLead, c.client_id)
    await prisma.oAuthToken.updateMany({ where: { revokedAt: null }, data: { accessExpiresAt: new Date(Date.now() - 1000) } })
    await mcp(t.access_token).expect(401)
    const next = (await request(app).post('/api/oauth/token').type('form').send(form({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: c.client_id })).expect(200)).body
    await mcp(next.access_token).expect(200)
  })
})

describe('An app that names its own address as its id (client ID metadata document)', () => {
  it('is read from its address, and only its own redirect addresses are allowed', async () => {
    const id = 'https://93.184.216.34/oauth/client.json'
    const doc = { client_id: id, client_name: 'Docs App', redirect_uris: ['https://docs-app.example/callback'], token_endpoint_auth_method: 'none' }
    const real = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => (String(input) === id ? new Response(JSON.stringify(doc), { status: 200, headers: { 'Content-Type': 'application/json' } }) : real(input, init)))
    const { challenge } = pkce()
    const r = await request(app).post('/api/oauth/authorize/check').set(...auth(w.itadMember)).send({ response_type: 'code', client_id: id, redirect_uri: 'https://docs-app.example/callback', code_challenge: challenge, code_challenge_method: 'S256' }).expect(200)
    expect(r.body).toMatchObject({ ok: true, app: { name: 'Docs App', backTo: 'docs-app.example', verified: true } })
    const bad = await request(app).post('/api/oauth/authorize/check').set(...auth(w.itadMember)).send({ response_type: 'code', client_id: id, redirect_uri: 'https://evil.example/cb', code_challenge: challenge, code_challenge_method: 'S256' }).expect(200)
    expect(bad.body.ok).toBe(false)
    vi.restoreAllMocks()
  })

  it("Claude's own address works even when Metriq cannot read it (24 Nov 2026: \"This app is not known to Metriq\")", async () => {
    const id = 'https://claude.ai/oauth/mcp-oauth-client-metadata'
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('blocked') })
    const { verifier, challenge } = pkce()
    const ask = { response_type: 'code', client_id: id, redirect_uri: REDIRECT, state: 'cl', code_challenge: challenge, code_challenge_method: 'S256' }
    const r = await request(app).post('/api/oauth/authorize/check').set(...auth(w.itadMember)).send(ask).expect(200)
    expect(r.body).toMatchObject({ ok: true, app: { name: 'Claude', backTo: 'claude.ai', verified: true } })
    // Only Claude's own callback, never another address.
    expect((await request(app).post('/api/oauth/authorize/check').set(...auth(w.itadMember)).send({ ...ask, redirect_uri: 'https://evil.example/cb' }).expect(200)).body.ok).toBe(false)
    // The whole sign-in, as Claude does it.
    const back = new URL((await request(app).post('/api/oauth/authorize').set(...auth(w.itadMember)).send({ ...ask, allow: true }).expect(200)).body.redirect)
    const t = (await request(app).post('/api/oauth/token').type('form').send(form({ grant_type: 'authorization_code', code: back.searchParams.get('code')!, code_verifier: verifier, client_id: id, redirect_uri: REDIRECT })).expect(200)).body
    await mcp(t.access_token).expect(200)
    vi.restoreAllMocks()
  })

  it('never reads an address on this server or the office network', async () => {
    const { challenge } = pkce()
    for (const id of ['https://127.0.0.1/c.json', 'https://10.0.0.5/c.json', 'https://localhost/c.json', 'http://93.184.216.34/c.json']) {
      const r = await request(app).post('/api/oauth/authorize/check').set(...auth(w.itadMember)).send({ response_type: 'code', client_id: id, redirect_uri: 'https://x.example/cb', code_challenge: challenge, code_challenge_method: 'S256' }).expect(200)
      expect(r.body.ok, id).toBe(false)
    }
  })
})
