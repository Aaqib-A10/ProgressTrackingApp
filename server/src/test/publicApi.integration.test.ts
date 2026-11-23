import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import crypto from 'node:crypto'
import type { Role } from '@prisma/client'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { hashPassword } from '../lib/auth'
import { ensureHomeCompany } from '../lib/company'
import { startWebhooks, webhookLog, sign, forgetWebhooks } from '../lib/webhooks'

// Stage 2 of the plan: the public API (a company's key reads its own Metriq, or adds a lead) and webhooks
// (Metriq tells the company's address when something happens, signed with the webhook's secret).

const O = 'api-oscar-co'
let w: SeededWorld
let oscar: { admin: { id: string; role: Role }; member: { id: string; role: Role } }
const key = (token: string): [string, string] => ['Authorization', `Bearer ${token}`]
const settle = () => new Promise((done) => setTimeout(done, 120))

beforeAll(async () => {
  w = await seedWorld()
  await ensureHomeCompany()
  startWebhooks()
  await prisma.company.deleteMany({ where: { id: O } })
  await prisma.company.create({ data: { id: O, name: 'Oscar API Co', slug: O, status: 'ACTIVE', plan: 'business', timeZone: 'Europe/London' } })
  const passwordHash = await hashPassword('Pass-for-tests-9')
  const mk = (name: string, role: Role) => prisma.user.create({ data: { companyId: O, name, email: `${name.replace(/\s+/g, '.').toLowerCase()}@oscar.local.test`, role, status: 'ACTIVE', isActive: true, passwordHash } })
  const [admin, member] = await Promise.all([mk('Oscar Admin', 'SUPER_ADMIN'), mk('Oscar Member', 'MEMBER')])
  oscar = { admin: { id: admin.id, role: admin.role }, member: { id: member.id, role: member.role } }
  await prisma.leadBusiness.create({ data: { companyId: O, name: 'Oscar Sales', formKey: `oscar-form-${Date.now().toString(36)}` } })
  await prisma.attendanceDay.create({ data: { companyId: O, userId: member.id, date: new Date('2026-11-02T00:00:00Z'), checkInAt: new Date('2026-11-02T09:00:00Z'), checkOutAt: new Date('2026-11-02T17:30:00Z') } })
})
afterAll(async () => {
  await prisma.company.deleteMany({ where: { id: O } })
  await prisma.$disconnect()
})

describe('API keys', () => {
  let readKey = ''
  let writeKey = ''

  it('only people with Company settings make keys; the key is shown once and only its hash is kept', async () => {
    await request(app).get('/api/company/api').set(...auth(oscar.member)).expect(403)
    await request(app).post('/api/company/api/keys').set(...auth(oscar.member)).send({ name: 'Nope' }).expect(403)
    await request(app).post('/api/company/api/keys').set(...auth(oscar.admin)).send({ name: 'x' }).expect(400)
    const r = await request(app).post('/api/company/api/keys').set(...auth(oscar.admin)).send({ name: 'Reporting sheet' }).expect(201)
    readKey = r.body.token
    expect(readKey).toMatch(/^mtq_[A-Za-z0-9_-]{30,}$/)
    expect(r.body.key).toMatchObject({ name: 'Reporting sheet', access: 'read', prefix: readKey.slice(0, 10) })
    writeKey = (await request(app).post('/api/company/api/keys').set(...auth(oscar.admin)).send({ name: 'Website form', access: 'write' }).expect(201)).body.token

    const list = (await request(app).get('/api/company/api').set(...auth(oscar.admin)).expect(200)).body
    expect(list.keys.map((k: { name: string }) => k.name).sort()).toEqual(['Reporting sheet', 'Website form'])
    expect(JSON.stringify(list)).not.toContain(readKey)
    const stored = JSON.stringify(await prisma.apiKey.findMany({ where: { companyId: O } }))
    expect(stored).not.toContain(readKey)
    expect(stored).not.toContain(writeKey)
    expect(await prisma.auditLog.count({ where: { companyId: O, entityType: 'ApiKey', action: 'CREATE' } })).toBe(2)
  })

  it('a key reads its own company and nothing else', async () => {
    await request(app).get('/api/v1/people').expect(401)
    await request(app).get('/api/v1/people').set(...key('mtq_not-a-real-key-at-all-000000000000000')).expect(401)
    // A signed-in session is not an API key, and an API key is not a session.
    await request(app).get('/api/v1/people').set(...auth(oscar.admin)).expect(401)
    await request(app).get('/api/tasks/mine').set(...key(readKey)).expect(401)

    expect((await request(app).get('/api/v1/company').set(...key(readKey)).expect(200)).body.data).toMatchObject({ id: O, name: 'Oscar API Co', timeZone: 'Europe/London' })
    const people = (await request(app).get('/api/v1/people').set(...key(readKey)).expect(200)).body
    expect(people.data.map((p: { name: string }) => p.name).sort()).toEqual(['Oscar Admin', 'Oscar Member'])
    expect(people.nextCursor).toBeNull()
    expect(JSON.stringify(people)).not.toContain('passwordHash')
    // One at a time, with the cursor.
    const first = (await request(app).get('/api/v1/people?limit=1').set(...key(readKey)).expect(200)).body
    expect(first.data).toHaveLength(1)
    const second = (await request(app).get(`/api/v1/people?limit=1&cursor=${first.nextCursor}`).set(...key(readKey)).expect(200)).body
    expect(second.data).toHaveLength(1)
    expect(second.data[0].id).not.toBe(first.data[0].id)

    const att = (await request(app).get('/api/v1/attendance?from=2026-11-01&to=2026-11-30').set(...key(readKey)).expect(200)).body.data
    expect(att).toEqual([expect.objectContaining({ personId: oscar.member.id, date: '2026-11-02', checkInAt: '2026-11-02T09:00:00.000Z', checkOutAt: '2026-11-02T17:30:00.000Z' })])
    await request(app).get('/api/v1/attendance').set(...key(readKey)).expect(400)
    await request(app).get('/api/v1/attendance?from=2026-01-01&to=2026-11-30').set(...key(readKey)).expect(400)
    expect((await request(app).get('/api/v1/departments').set(...key(readKey)).expect(200)).body.data).toEqual([])
    expect((await request(app).get('/api/v1/tasks').set(...key(readKey)).expect(200)).body.data).toEqual([])
    await request(app).get('/api/v1/nothing-here').set(...key(readKey)).expect(404)
  })

  it('adding a lead needs a key that can write; the same lead twice is one lead', async () => {
    await request(app).post('/api/v1/leads').set(...key(readKey)).send({ name: 'Rita Read', email: 'rita@example.test' }).expect(403)
    await request(app).post('/api/v1/leads').set(...key(writeKey)).send({ message: 'no way to reach them' }).expect(400)
    const made = await request(app).post('/api/v1/leads').set(...key(writeKey)).send({ name: 'Wanda Write', email: 'wanda@example.test', organization: 'Wanda Ltd', message: 'Please call me', externalId: 'form-77' }).expect(201)
    expect(made.body.data).toMatchObject({ name: 'Wanda Write', email: 'wanda@example.test', status: 'NEW' })
    const again = await request(app).post('/api/v1/leads').set(...key(writeKey)).send({ name: 'Wanda Write', email: 'wanda@example.test', externalId: 'form-77' }).expect(200)
    expect(again.body.repeat).toBe(true)
    expect(await prisma.lead.count({ where: { companyId: O } })).toBe(1)
    const listed = (await request(app).get('/api/v1/leads').set(...key(readKey)).expect(200)).body.data
    expect(listed).toHaveLength(1)
    // 99 Technologies' admin sees none of it, and Oscar's key sees none of theirs.
    expect(await prisma.lead.count({ where: { companyId: { not: O }, email: 'wanda@example.test' } })).toBe(0)
  })

  it('a removed key stops working at once', async () => {
    const list = (await request(app).get('/api/company/api').set(...auth(oscar.admin)).expect(200)).body
    const id = list.keys.find((k: { name: string }) => k.name === 'Reporting sheet').id
    await request(app).delete(`/api/company/api/keys/${id}`).set(...auth(w.superAdmin)).expect(404) // another company's admin
    await request(app).delete(`/api/company/api/keys/${id}`).set(...auth(oscar.admin)).expect(204)
    await request(app).get('/api/v1/people').set(...key(readKey)).expect(401)
    await request(app).get('/api/v1/people').set(...key(writeKey)).expect(200)
  })
})

describe('webhooks', () => {
  it('tells the address when a lead comes in, signed with the secret; other events and other companies stay silent', async () => {
    await request(app).post('/api/company/api/webhooks').set(...auth(oscar.admin)).send({ url: 'not an address', events: ['lead.created'] }).expect(400)
    await request(app).post('/api/company/api/webhooks').set(...auth(oscar.admin)).send({ url: 'ftp://example.test/hook', events: ['lead.created'] }).expect(400)
    await request(app).post('/api/company/api/webhooks').set(...auth(oscar.admin)).send({ url: 'https://example.test/hook', events: [] }).expect(400)
    const made = await request(app).post('/api/company/api/webhooks').set(...auth(oscar.admin)).send({ url: 'https://example.test/hook', events: ['lead.created', 'lead.status_changed'] }).expect(201)
    const secret: string = made.body.secret
    expect(secret).toMatch(/^whsec_/)
    expect(JSON.stringify((await request(app).get('/api/company/api').set(...auth(oscar.admin)).expect(200)).body)).not.toContain(secret)

    webhookLog.length = 0
    const business = await prisma.leadBusiness.findFirstOrThrow({ where: { companyId: O } })
    const lead = await prisma.lead.create({ data: { companyId: O, businessId: business.id, name: 'Hooked Lead', email: 'hooked@example.test', source: 'PHONE' } })
    await settle()
    expect(webhookLog).toHaveLength(1)
    const sent = webhookLog[0]
    expect(sent.url).toBe('https://example.test/hook')
    expect(sent.event).toBe('lead.created')
    const body = JSON.parse(sent.body)
    expect(body).toMatchObject({ event: 'lead.created', data: { id: lead.id, name: 'Hooked Lead', email: 'hooked@example.test', status: 'NEW' } })
    // The receiver can check the signature with the secret.
    expect(sent.signature).toBe(sign(sent.body, secret))
    expect(sent.signature).toBe(`sha256=${crypto.createHmac('sha256', secret).update(sent.body).digest('hex')}`)

    await prisma.lead.update({ where: { id: lead.id }, data: { status: 'CONTACTED' } })
    await prisma.lead.update({ where: { id: lead.id }, data: { name: 'Hooked Lead Renamed' } }) // not an event
    await settle()
    expect(webhookLog.map((x) => x.event)).toEqual(['lead.created', 'lead.status_changed'])

    // A lead in 99 Technologies tells Oscar's webhook nothing.
    const home = await prisma.leadBusiness.findFirst({ where: { companyId: { not: O } } })
    if (home) { await prisma.lead.create({ data: { companyId: home.companyId, businessId: home.id, name: 'Home Lead', source: 'PHONE' } }); await settle() }
    expect(webhookLog).toHaveLength(2)

    const hooks = (await request(app).get('/api/company/api').set(...auth(oscar.admin)).expect(200)).body.webhooks
    const sentList = (await request(app).get(`/api/company/api/webhooks/${hooks[0].id}/deliveries`).set(...auth(oscar.admin)).expect(200)).body.deliveries
    expect(sentList.map((d: { event: string; ok: boolean }) => `${d.event}:${d.ok}`).sort()).toEqual(['lead.created:true', 'lead.status_changed:true'])
  })

  it('a test message, switching off, failures counted, and removal', async () => {
    const hook = (await request(app).get('/api/company/api').set(...auth(oscar.admin)).expect(200)).body.webhooks[0]
    expect((await request(app).post(`/api/company/api/webhooks/${hook.id}/test`).set(...auth(oscar.admin)).expect(200)).body.ok).toBe(true)
    // An address that fails: recorded as failed, counted on the webhook.
    const bad = (await request(app).post('/api/company/api/webhooks').set(...auth(oscar.admin)).send({ url: 'https://example.test/fail', events: ['lead.created'] }).expect(201)).body.webhook
    const t = await request(app).post(`/api/company/api/webhooks/${bad.id}/test`).set(...auth(oscar.admin)).expect(200)
    expect(t.body).toMatchObject({ ok: false, status: 500 })
    expect((await prisma.webhook.findUniqueOrThrow({ where: { id: bad.id } })).failCount).toBe(1)

    // Switched off: nothing is sent to it.
    await request(app).patch(`/api/company/api/webhooks/${hook.id}`).set(...auth(oscar.admin)).send({ active: false }).expect(200)
    await request(app).delete(`/api/company/api/webhooks/${bad.id}`).set(...auth(oscar.admin)).expect(204)
    forgetWebhooks(O)
    webhookLog.length = 0
    const business = await prisma.leadBusiness.findFirstOrThrow({ where: { companyId: O } })
    await prisma.lead.create({ data: { companyId: O, businessId: business.id, name: 'Quiet Lead', source: 'PHONE' } })
    await settle()
    expect(webhookLog).toHaveLength(0)
    await request(app).delete(`/api/company/api/webhooks/${hook.id}`).set(...auth(w.superAdmin)).expect(404)
    await request(app).delete(`/api/company/api/webhooks/${hook.id}`).set(...auth(oscar.admin)).expect(204)
  })
})
