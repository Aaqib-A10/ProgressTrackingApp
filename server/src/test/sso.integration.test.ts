import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createSign, generateKeyPairSync, randomBytes, X509Certificate, type KeyObject } from 'crypto'
import { SignedXml } from 'xml-crypto'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { HOME_COMPANY_ID } from '../lib/company'
import { signToken } from '../lib/auth'
import { spUrls } from '../lib/sso'

// Single sign-on with SAML (plan 2026-11, stage 4), against a fake identity provider made here: its key and
// certificate are made fresh on every run, so no key is ever stored. Everything a real identity provider sends is
// signed and checked the same way.

// ------------------------------------------------------------------ a self-signed certificate, made with Node alone
const der = (tag: number, body: Buffer) => {
  const n = body.length
  const len = n < 128 ? Buffer.from([n]) : n < 256 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 255])
  return Buffer.concat([Buffer.from([tag]), len, body])
}
const seq = (...xs: Buffer[]) => der(0x30, Buffer.concat(xs))
const oid = (s: string) => { const [a, b, ...rest] = s.split('.').map(Number); const out = [40 * a + b]; for (const v of rest) { const bytes = [v & 127]; let x = v >> 7; while (x) { bytes.unshift((x & 127) | 128); x >>= 7 } out.push(...bytes) } return der(0x06, Buffer.from(out)) }
const utc = (d: Date) => der(0x17, Buffer.from(d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'))
const name = (cn: string) => seq(der(0x31, seq(oid('2.5.4.3'), der(0x0c, Buffer.from(cn)))))
const SHA256_RSA = seq(oid('1.2.840.113549.1.1.11'), Buffer.from([5, 0]))

function makeIdp(cn: string): { key: KeyObject; pem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const now = Date.now()
  const tbs = seq(
    der(0xa0, der(0x02, Buffer.from([2]))),
    der(0x02, Buffer.concat([Buffer.from([1]), randomBytes(8)])),
    SHA256_RSA,
    name(cn),
    seq(utc(new Date(now - 86400_000)), utc(new Date(now + 365 * 86400_000))),
    name(cn),
    publicKey.export({ type: 'spki', format: 'der' }) as Buffer,
  )
  const sig = createSign('sha256').update(tbs).sign(privateKey)
  const cert = seq(tbs, SHA256_RSA, der(0x03, Buffer.concat([Buffer.from([0]), sig])))
  const pem = `-----BEGIN CERTIFICATE-----\n${cert.toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`
  new X509Certificate(pem) // it must read as a real certificate
  return { key: privateKey, pem }
}

// ------------------------------------------------------------------ the fake identity provider's answer
const IDP_ISSUER = 'https://idp.example.test/metadata'
function samlResponse(o: { key: KeyObject; pem: string; email: string; audience: string; acs: string; attrs?: Record<string, string>; ageMs?: number }): string {
  const now = new Date(Date.now() - (o.ageMs ?? 0))
  const later = new Date(now.getTime() + 5 * 60_000)
  const id = `_a${randomBytes(12).toString('hex')}`
  const attrs = Object.entries(o.attrs ?? {}).map(([k, v]) => `<saml:Attribute Name="${k}"><saml:AttributeValue>${v}</saml:AttributeValue></saml:Attribute>`).join('')
  const assertion = `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id}" Version="2.0" IssueInstant="${now.toISOString()}">`
    + `<saml:Issuer>${IDP_ISSUER}</saml:Issuer>`
    + `<saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${o.email}</saml:NameID>`
    + `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData NotOnOrAfter="${later.toISOString()}" Recipient="${o.acs}"/></saml:SubjectConfirmation></saml:Subject>`
    + `<saml:Conditions NotBefore="${now.toISOString()}" NotOnOrAfter="${later.toISOString()}"><saml:AudienceRestriction><saml:Audience>${o.audience}</saml:Audience></saml:AudienceRestriction></saml:Conditions>`
    + `<saml:AuthnStatement AuthnInstant="${now.toISOString()}" SessionIndex="${id}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>`
    + (attrs ? `<saml:AttributeStatement>${attrs}</saml:AttributeStatement>` : '')
    + `</saml:Assertion>`
  const xml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_r${randomBytes(12).toString('hex')}" Version="2.0" IssueInstant="${now.toISOString()}" Destination="${o.acs}">`
    + `<saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">${IDP_ISSUER}</saml:Issuer>`
    + `<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>${assertion}</samlp:Response>`
  const sig = new SignedXml({ privateKey: o.key, publicCert: o.pem, signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256', canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#' })
  sig.addReference({ xpath: "//*[local-name(.)='Assertion']", digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256', transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'] })
  sig.computeSignature(xml, { prefix: 'ds', location: { reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']", action: 'after' } })
  return Buffer.from(sig.getSignedXml()).toString('base64')
}

// ------------------------------------------------------------------ the tests
let w: SeededWorld
let slug = ''
let sp: ReturnType<typeof spUrls>
const idp = makeIdp('Metriq test identity provider')
const stranger = makeIdp('Someone else')
const post = (r: string) => request(app).post(`/api/auth/sso/${slug}/acs`).type('form').send({ SAMLResponse: r, RelayState: '/app/tasks' })
const cookieOf = (res: request.Response) => ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('token='))?.split(';')[0] ?? ''
const settings = (on = true, more: Record<string, unknown> = {}) => ({ on, entryPoint: 'https://idp.example.test/sso', idpIssuer: IDP_ISSUER, cert: idp.pem, domains: ['test.local'], required: false, createPeople: false, ...more })

beforeAll(async () => {
  w = await seedWorld()
  slug = (await prisma.company.findUniqueOrThrow({ where: { id: HOME_COMPANY_ID }, select: { slug: true } })).slug
  await prisma.company.update({ where: { id: HOME_COMPANY_ID }, data: { ssoOn: false, ssoEntryPoint: null, ssoCert: null, ssoDomains: [], ssoRequired: false, ssoCreatePeople: false, requireTwoStep: false } })
  sp = spUrls(slug)
})
afterAll(async () => {
  await prisma.company.update({ where: { id: HOME_COMPANY_ID }, data: { ssoOn: false, ssoEntryPoint: null, ssoCert: null, ssoDomains: [], ssoRequired: false, ssoCreatePeople: false, requireTwoStep: false } })
  await prisma.$disconnect()
})

describe('single sign-on settings', () => {
  it('only people with Company settings set it up; it is checked before it is saved', async () => {
    await request(app).put('/api/company/sso').set(...auth(w.itadLead)).send(settings()).expect(403)
    await request(app).put('/api/company/sso').set(...auth(w.superAdmin)).send(settings(true, { cert: 'not a certificate at all, just some words to fill it up past one hundred characters of text for the check here' })).expect(400)
    await request(app).put('/api/company/sso').set(...auth(w.superAdmin)).send(settings(true, { domains: [] })).expect(400)
    await request(app).put('/api/company/sso').set(...auth(w.superAdmin)).send(settings(true, { entryPoint: 'http://not-https.example' })).expect(400)
    const saved = (await request(app).put('/api/company/sso').set(...auth(w.superAdmin)).send(settings()).expect(200)).body.sso
    expect(saved).toMatchObject({ on: true, domains: ['test.local'], cert: { set: true }, sp: { acsUrl: sp.acsUrl, entityId: sp.entityId } })
    expect(new Date(saved.cert.expires).getTime()).toBeGreaterThan(Date.now())
    // Requiring it is refused to someone who did not sign in through it: that proves the settings work first.
    await request(app).put('/api/company/sso').set(...auth(w.superAdmin)).send(settings(true, { required: true })).expect(409)
  })

  it('our metadata, the sign-in page finding the company by email, and the start sending people to the identity provider', async () => {
    const meta = await request(app).get(`/api/auth/sso/${slug}/metadata`).expect(200)
    expect(meta.text).toContain(`entityID="${sp.entityId}"`)
    expect(meta.text).toContain(`Location="${sp.acsUrl}"`)
    expect((await request(app).post('/api/auth/sso/find').send({ email: 'someone@test.local' }).expect(200)).body).toMatchObject({ url: sp.startUrl })
    await request(app).post('/api/auth/sso/find').send({ email: 'someone@elsewhere.example' }).expect(404)
    const go = await request(app).get(`/api/auth/sso/${slug}/start?next=/app/tasks`).expect(302)
    expect(go.headers.location).toMatch(/^https:\/\/idp\.example\.test\/sso\?SAMLRequest=/)
    expect(go.headers.location).toContain('RelayState=%2Fapp%2Ftasks')
  })
})

describe('signing in through the identity provider', () => {
  const email = () => 'itad.member@test.local'

  it('a signed answer for a person in the company signs them in, once', async () => {
    const answer = samlResponse({ ...idp, email: email(), audience: sp.entityId, acs: sp.acsUrl })
    const res = await post(answer).expect(302)
    expect(res.headers.location).toMatch(/\/app\/tasks$/)
    const cookie = cookieOf(res)
    expect(cookie).toMatch(/^token=/)
    const me = await request(app).get('/api/auth/me').set('Cookie', cookie).expect(200)
    expect(me.body.user.id).toBe(w.itadMember.id)
    // The same answer again (a copy someone kept): refused.
    const again = await post(answer).expect(302)
    expect(again.headers.location).toContain('/login?sso_error=')
    expect(cookieOf(again)).toBe('')
  })

  it('refuses an answer signed by anyone else, meant for another service, or too old', async () => {
    for (const bad of [
      samlResponse({ ...stranger, email: email(), audience: sp.entityId, acs: sp.acsUrl }),
      samlResponse({ ...idp, email: email(), audience: 'https://another-service.example/metadata', acs: sp.acsUrl }),
      samlResponse({ ...idp, email: email(), audience: sp.entityId, acs: sp.acsUrl, ageMs: 60 * 60_000 }),
    ]) {
      const res = await post(bad).expect(302)
      expect(res.headers.location).toContain('/login?sso_error=')
      expect(cookieOf(res)).toBe('')
    }
    // A tampered answer: the email changed after signing.
    const good = Buffer.from(samlResponse({ ...idp, email: email(), audience: sp.entityId, acs: sp.acsUrl }), 'base64').toString()
    const forged = Buffer.from(good.replace('itad.member@test.local', 'super.admin@test.local')).toString('base64')
    expect(cookieOf(await post(forged).expect(302))).toBe('')
    // Nothing at all.
    expect((await request(app).post(`/api/auth/sso/${slug}/acs`).type('form').send({}).expect(302)).headers.location).toContain('sso_error')
  })

  it('a person not in Metriq is turned away, or added as a member when the company allows it', async () => {
    const newcomer = 'new.joiner@test.local'
    const first = await post(samlResponse({ ...idp, email: newcomer, audience: sp.entityId, acs: sp.acsUrl })).expect(302)
    expect(decodeURIComponent(first.headers.location)).toContain('not in this company')
    await request(app).put('/api/company/sso').set(...auth(w.superAdmin)).send(settings(true, { createPeople: true })).expect(200)
    const second = await post(samlResponse({ ...idp, email: newcomer, audience: sp.entityId, acs: sp.acsUrl, attrs: { firstName: 'New', lastName: 'Joiner' } })).expect(302)
    expect(cookieOf(second)).toMatch(/^token=/)
    expect(await prisma.user.findUniqueOrThrow({ where: { email: newcomer }, select: { name: true, role: true, companyId: true } })).toEqual({ name: 'New Joiner', role: 'MEMBER', companyId: HOME_COMPANY_ID })
    // An email of a domain the company did not list is refused, whoever signs it.
    const outside = await post(samlResponse({ ...idp, email: 'boss@elsewhere.example', audience: sp.entityId, acs: sp.acsUrl })).expect(302)
    expect(decodeURIComponent(outside.headers.location)).toContain('not one of the email domains')
  })

  it('a company that requires it: passwords closed for everyone but its Super Admins, and no two-step demand after it', async () => {
    // Requiring it, from a session that came through single sign-on.
    const ssoSession = signToken({ sub: w.superAdmin.id, role: w.superAdmin.role, sso: true })
    await request(app).put('/api/company/sso').set('Authorization', `Bearer ${ssoSession}`).send(settings(true, { required: true })).expect(200)
    const refused = await request(app).post('/api/auth/login').send({ email: 'itad.member@test.local', password: 'Password123!' }).expect(403)
    expect(refused.body).toMatchObject({ code: 'SSO_REQUIRED', ssoUrl: `/api/auth/sso/${slug}/start` })
    await request(app).post('/api/auth/login').send({ email: 'super.admin@test.local', password: 'Password123!' }).expect(200)

    // The company also requires two-step sign-in: a single sign-on session is not asked for it, a password one is.
    await prisma.company.update({ where: { id: HOME_COMPANY_ID }, data: { requireTwoStep: true } })
    await request(app).get('/api/notes').set('Authorization', `Bearer ${signToken({ sub: w.itadMember.id, role: w.itadMember.role, sso: true })}`).expect(200)
    expect((await request(app).get('/api/notes').set(...auth(w.itadMember)).expect(403)).body.code).toBe('TWO_STEP_REQUIRED')
    await prisma.company.update({ where: { id: HOME_COMPANY_ID }, data: { requireTwoStep: false } })
  })

  it('turned off: nothing signs in through it', async () => {
    await request(app).put('/api/company/sso').set(...auth(w.superAdmin)).send(settings(false)).expect(200)
    const res = await post(samlResponse({ ...idp, email: 'itad.member@test.local', audience: sp.entityId, acs: sp.acsUrl })).expect(302)
    expect(decodeURIComponent(res.headers.location)).toContain('not set up')
    await request(app).post('/api/auth/login').send({ email: 'itad.member@test.local', password: 'Password123!' }).expect(200)
  })
})
