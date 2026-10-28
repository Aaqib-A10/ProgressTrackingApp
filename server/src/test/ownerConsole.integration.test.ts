import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { hashPassword } from '../lib/auth'
import { newTotpSecret, totpCode } from '../lib/totp'
import { ensureHomeCompany, HOME_COMPANY_ID } from '../lib/company'
import { passwordProblem } from '../scripts/owner'

// erp, step 0: the owner console. Only the owner (Anees) opens it: password, plus a 6 digit code
// from a phone app once that is switched on; companies send complaints from a Help button; every
// owner action is logged.

const EMAIL = 'owner@test.local'
const PASSWORD = 'Owner2026x'
let w: SeededWorld

const agent = () => request.agent(app)
async function signIn(a = agent()) {
  const r = await a.post('/api/owner/login').send({ email: EMAIL, password: PASSWORD }).expect(200)
  expect(r.body.needCode).toBe(false)
  return a
}

beforeAll(async () => {
  w = await seedWorld()
  await prisma.ownerAuditLog.deleteMany()
  await prisma.platformOwner.deleteMany()
  await prisma.supportTicket.deleteMany()
  await ensureHomeCompany()
  await prisma.company.update({ where: { id: HOME_COMPANY_ID }, data: { helpEnabled: false, status: 'ACTIVE', name: '99 Technologies' } })
  // Password only (Anees, Oct 2026: no phone code for now).
  await prisma.platformOwner.create({ data: { name: 'Anees', email: EMAIL, passwordHash: await hashPassword(PASSWORD) } })
})
afterAll(async () => { await prisma.$disconnect() })

describe('owner sign in', () => {
  it('signs in with the password; a company Super Admin cannot get in', async () => {
    await request(app).get('/api/owner/home').expect(401)
    await request(app).get('/api/owner/home').set(...auth(w.superAdmin)).expect(401)
    await request(app).post('/api/owner/login').send({ email: EMAIL, password: 'wrong-password-123' }).expect(401)
    const a = await signIn()
    const me = await a.get('/api/owner/me').expect(200)
    expect(me.body.owner).toMatchObject({ name: 'Anees', email: EMAIL })
    // The owner's session is not a company session.
    await a.get('/api/todos').expect(401)
  })

  it('with the phone code switched on, the password alone is not enough', async () => {
    const secret = newTotpSecret()
    await prisma.platformOwner.update({ where: { email: EMAIL }, data: { totpSecret: secret } })
    const a = agent()
    const r = await a.post('/api/owner/login').send({ email: EMAIL, password: PASSWORD }).expect(200)
    expect(r.body.needCode).toBe(true)
    await a.get('/api/owner/home').expect(401)
    await a.post('/api/owner/login/code').send({ ticket: r.body.ticket, code: '000000' }).expect(401)
    await a.post('/api/owner/login/code').send({ ticket: r.body.ticket, code: totpCode(secret) }).expect(200)
    await a.get('/api/owner/home').expect(200)
    // Back to password only for the rest.
    await prisma.platformOwner.update({ where: { email: EMAIL }, data: { totpSecret: null, failedLogins: 0 } })
  })

  it('locks for 15 minutes after 5 wrong tries, and logs it', async () => {
    await prisma.platformOwner.update({ where: { email: EMAIL }, data: { failedLogins: 0, lockedUntil: null } })
    for (let i = 0; i < 5; i++) await request(app).post('/api/owner/login').send({ email: EMAIL, password: `nope-nope-nope-${i}` }).expect(401)
    const r = await request(app).post('/api/owner/login').send({ email: EMAIL, password: PASSWORD }).expect(423)
    expect(r.body.error).toMatch(/locked until/i)
    expect(await prisma.ownerAuditLog.count({ where: { action: 'LOCKED' } })).toBe(1)
    await prisma.platformOwner.update({ where: { email: EMAIL }, data: { failedLogins: 0, lockedUntil: null } })
  })

  it('signs in with the username too; a PC-only test owner never signs in on the live server', async () => {
    await prisma.platformOwner.create({ data: { name: 'Test User', email: 'tester@local.test', username: 'tester', passwordHash: await hashPassword(PASSWORD) } })
    expect((await request(app).post('/api/owner/login').send({ email: 'Tester', password: PASSWORD }).expect(200)).body.needCode).toBe(false)
    const was = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      await request(app).post('/api/owner/login').send({ email: 'tester', password: PASSWORD }).expect(401)
    } finally { process.env.NODE_ENV = was }
    await prisma.platformOwner.delete({ where: { email: 'tester@local.test' } })
  })

  it('an unknown email gets the same answer as a wrong password', async () => {
    const r = await request(app).post('/api/owner/login').send({ email: 'nobody@test.local', password: PASSWORD }).expect(401)
    expect(r.body.error).toBe('Wrong email, username or password.')
  })

  it('the password needs 8+ characters with letters and numbers', () => {
    expect(passwordProblem('Owner26')).toMatch(/8 characters/)
    expect(passwordProblem('abcdefghij')).toMatch(/letters and numbers/)
    expect(passwordProblem('12345678')).toMatch(/letters and numbers/)
    expect(passwordProblem('Owner2026x')).toBeNull()
  })
})

describe('companies', () => {
  it('shows 99 Technologies as company 1, with its people, and it can never be suspended', async () => {
    const a = await signIn()
    const list = (await a.get('/api/owner/companies').expect(200)).body.companies
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: HOME_COMPANY_ID, name: '99 Technologies', status: 'ACTIVE', home: true, helpEnabled: false, people: 7 })
    const r = await a.patch(`/api/owner/companies/${HOME_COMPANY_ID}`).send({ status: 'SUSPENDED' }).expect(400)
    expect(r.body.error).toMatch(/always stays active/)
    const h = (await a.get('/api/owner/home').expect(200)).body
    expect(h.counts).toMatchObject({ companies: 1, people: 7 })
  })
})

describe('Help button and support', () => {
  it('stays off for 99 Technologies until the owner switches it on', async () => {
    expect((await request(app).get('/api/support/status').set(...auth(w.itadMember)).expect(200)).body.enabled).toBe(false)
    await request(app).post('/api/support').set(...auth(w.itadMember)).send({ subject: 'Cannot export', body: 'The export button does nothing' }).expect(403)
    const a = await signIn()
    await a.patch(`/api/owner/companies/${HOME_COMPANY_ID}`).send({ helpEnabled: true }).expect(200)
    expect((await request(app).get('/api/support/status').set(...auth(w.itadMember)).expect(200)).body.enabled).toBe(true)
    expect(await prisma.ownerAuditLog.count({ where: { action: 'COMPANY_UPDATE', companyId: HOME_COMPANY_ID } })).toBe(1)
  })

  it('a complaint reaches the console with the page and the errors the person hit; the reply reaches their bell', async () => {
    const g = await prisma.errorGroup.create({ data: { fingerprint: `fp-${Date.now()}`, source: 'BROWSER', message: 'Screen crashed', route: '/app/itad/log' } })
    await prisma.errorEvent.create({ data: { groupId: g.id, userId: w.itadMember.id } })
    const c = await request(app).post('/api/support').set(...auth(w.itadMember))
      .send({ subject: 'Daily log will not save', body: 'I press Save and nothing happens', pageUrl: '/app/itad/log' }).expect(201)
    const id = c.body.ticket.id

    const a = await signIn()
    const list = (await a.get('/api/owner/support').expect(200)).body.tickets
    expect(list[0]).toMatchObject({ id, subject: 'Daily log will not save', status: 'OPEN', company: { name: '99 Technologies' }, userName: 'itad member' })
    const t = (await a.get(`/api/owner/support/${id}`).expect(200)).body.ticket
    expect(t).toMatchObject({ pageUrl: '/app/itad/log', body: 'I press Save and nothing happens' })
    expect(t.errors).toEqual([expect.objectContaining({ id: g.id, message: 'Screen crashed' })])

    const r = await a.post(`/api/owner/support/${id}/reply`).send({ body: 'Fixed, please try again.' }).expect(200)
    expect(r.body.ticket).toMatchObject({ status: 'IN_PROGRESS', messages: [expect.objectContaining({ fromOwner: true, body: 'Fixed, please try again.' })] })
    const n = await prisma.notification.findFirst({ where: { userId: w.itadMember.id, type: 'SUPPORT_REPLY' } })
    expect(n?.link).toBe(`/app/help?ticket=${id}`)

    // The person sees the answer and replies; another person cannot.
    const mine = (await request(app).get('/api/support/mine').set(...auth(w.itadMember)).expect(200)).body.tickets
    expect(mine[0].messages[0].body).toBe('Fixed, please try again.')
    await request(app).post(`/api/support/mine/${id}/reply`).set(...auth(w.leadgenMember)).send({ body: 'hi' }).expect(404)
    await a.patch(`/api/owner/support/${id}`).send({ status: 'RESOLVED', priority: 'HIGH' }).expect(200)
    await request(app).post(`/api/support/mine/${id}/reply`).set(...auth(w.itadMember)).send({ body: 'Still broken' }).expect(201)
    expect((await a.get(`/api/owner/support/${id}`).expect(200)).body.ticket).toMatchObject({ status: 'OPEN', priority: 'HIGH' })
  })

  it('every owner action is in the activity log', async () => {
    const a = await signIn()
    const log = (await a.get('/api/owner/activity').expect(200)).body.activity.map((x: { action: string }) => x.action)
    expect(log).toEqual(expect.arrayContaining(['LOGIN', 'LOGIN_FAILED', 'LOCKED', 'COMPANY_UPDATE', 'TICKET_REPLY', 'TICKET_UPDATE']))
    await a.post('/api/owner/logout').expect(204)
    await a.get('/api/owner/me').expect(401)
  })
})
