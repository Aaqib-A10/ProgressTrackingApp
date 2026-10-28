import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import request from 'supertest'
import crypto from 'node:crypto'
import type { Role } from '@prisma/client'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { hashPassword } from '../lib/auth'
import { ensureHomeCompany, HOME_COMPANY_ID } from '../lib/company'
import { runBillingReminders } from '../lib/billing/billing'

// Phase 1, step 8: billing. A company on a trial picks a plan (test payments), gets invoices,
// upgrades and downgrades, a failed payment gives 7 days (with emails) before read-only, and
// a real provider's message is only taken when signed. 99 Technologies is never billed.

const L = 'billing-lima'
let w: SeededWorld
let lima: { admin: { id: string; role: Role }; member: { id: string; role: Role } }
const env = { ...process.env }

beforeAll(async () => {
  w = await seedWorld()
  await ensureHomeCompany()
  await prisma.company.deleteMany({ where: { id: L } })
  await prisma.company.create({ data: { id: L, name: 'Lima Test Co', slug: L, status: 'TRIAL', plan: 'business', trialEndsAt: new Date(Date.now() + 2 * 86400_000) } })
  const passwordHash = await hashPassword('Pass-for-tests-9')
  const mk = (name: string, role: Role) => prisma.user.create({ data: { companyId: L, name, email: `${name.replace(/\s+/g, '.').toLowerCase()}@lima.local.test`, role, status: 'ACTIVE', isActive: true, passwordHash } })
  const [admin, member] = await Promise.all([mk('Lima Admin', 'SUPER_ADMIN'), mk('Lima Member', 'MEMBER')])
  lima = { admin: { id: admin.id, role: admin.role }, member: { id: member.id, role: member.role } }
})
afterEach(() => { process.env = { ...env } })
afterAll(async () => {
  await prisma.company.deleteMany({ where: { id: L } })
  await prisma.billingEvent.deleteMany({ where: { companyId: L } })
  await prisma.$disconnect()
})

describe('billing', () => {
  it('shows the plans and the trial; only the Super Admin can pay; 99 Technologies is never billed', async () => {
    const r = (await request(app).get('/api/billing').set(...auth(lima.admin)).expect(200)).body
    expect(r.state).toBe('trial')
    expect(r.plans.map((p: { key: string }) => p.key)).toEqual(['starter', 'business'])
    expect(r.plans[0]).toMatchObject({ priceMonthly: 29, priceYearly: 290 })
    expect(r.provider).toMatchObject({ key: 'test', test: true })
    await request(app).post('/api/billing/checkout').set(...auth(lima.member)).send({ plan: 'starter', interval: 'month' }).expect(403)
    await request(app).post('/api/billing/checkout').set(...auth(w.superAdmin)).send({ plan: 'starter', interval: 'month' }).expect(400)
    expect((await request(app).get('/api/billing').set(...auth(w.superAdmin)).expect(200)).body.state).toBe('internal')
  })

  it('trial reminders go once each', async () => {
    await runBillingReminders(L)
    await runBillingReminders(L)
    expect((await prisma.company.findUniqueOrThrow({ where: { id: L } })).trialEndingMailAt).not.toBeNull()
  })

  it('choosing a plan: checkout, a paid invoice, the company on its plan', async () => {
    const c = await request(app).post('/api/billing/checkout').set(...auth(lima.admin)).send({ plan: 'starter', interval: 'year' }).expect(200)
    expect(c.body.url).toBe('/app/billing/test-checkout?plan=starter&interval=year')
    await request(app).post('/api/billing/test/pay').set(...auth(lima.admin)).send({ plan: 'starter', interval: 'year' }).expect(200)
    const r = (await request(app).get('/api/billing').set(...auth(lima.admin))).body
    expect(r.state).toBe('active')
    expect(r.subscription).toMatchObject({ plan: 'starter', interval: 'year', status: 'ACTIVE' })
    expect(r.invoices).toHaveLength(1)
    expect(r.invoices[0]).toMatchObject({ amountCents: 29000, status: 'PAID' })
    const co = await prisma.company.findUniqueOrThrow({ where: { id: L } })
    expect(co).toMatchObject({ status: 'ACTIVE', plan: 'starter' })
    const inv = (await request(app).get(`/api/billing/invoices/${r.invoices[0].id}`).set(...auth(lima.admin)).expect(200)).body
    expect(inv.billedTo.company).toBe('Lima Test Co')
  })

  it('upgrade and downgrade; a smaller plan has to fit', async () => {
    await request(app).post('/api/billing/change').set(...auth(lima.admin)).send({ plan: 'business', interval: 'month' }).expect(200)
    expect((await prisma.company.findUniqueOrThrow({ where: { id: L } })).plan).toBe('business')
    await request(app).post('/api/billing/change').set(...auth(lima.admin)).send({ plan: 'starter', interval: 'month' }).expect(200)
    // Make the company too big for Starter.
    const passwordHash = await hashPassword('Pass-for-tests-9')
    await prisma.user.createMany({ data: Array.from({ length: 10 }, (_, i) => ({ companyId: L, name: `Extra ${i}`, email: `extra${i}@lima.local.test`, role: 'MEMBER' as Role, status: 'ACTIVE' as const, isActive: true, passwordHash })) })
    await request(app).post('/api/billing/change').set(...auth(lima.admin)).send({ plan: 'business', interval: 'month' }).expect(200)
    const r = await request(app).post('/api/billing/change').set(...auth(lima.admin)).send({ plan: 'starter', interval: 'month' }).expect(409)
    expect(r.body.error).toMatch(/room for 10 people/)
    await prisma.user.deleteMany({ where: { companyId: L, name: { startsWith: 'Extra ' } } })
  })

  it('a failed payment: 7 days to fix it, then read-only (look, not save); paying opens it again', async () => {
    await request(app).post('/api/billing/test/pay').set(...auth(lima.admin)).send({ plan: 'business', interval: 'month', fail: true }).expect(200)
    expect((await request(app).get('/api/billing').set(...auth(lima.admin))).body.state).toBe('past_due')
    await request(app).post('/api/todos').set(...auth(lima.member)).send({ title: 'Still fine' }).expect(201)
    await prisma.subscription.update({ where: { companyId: L }, data: { pastDueSince: new Date(Date.now() - 8 * 86400_000) } })
    const blocked = await request(app).post('/api/todos').set(...auth(lima.member)).send({ title: 'Too late' }).expect(402)
    expect(blocked.body).toMatchObject({ billing: 'locked' })
    await request(app).get('/api/todos').set(...auth(lima.member)).expect(200)
    await request(app).post('/api/billing/test/pay').set(...auth(lima.admin)).send({ plan: 'business', interval: 'month' }).expect(200)
    await request(app).post('/api/todos').set(...auth(lima.member)).send({ title: 'Open again' }).expect(201)
  })

  it('cancel runs to the end of what is paid', async () => {
    await request(app).post('/api/billing/cancel').set(...auth(lima.admin)).expect(200)
    expect((await request(app).get('/api/billing').set(...auth(lima.admin))).body.state).toBe('canceling')
    await request(app).post('/api/billing/resume').set(...auth(lima.admin)).expect(200)
    expect((await request(app).get('/api/billing').set(...auth(lima.admin))).body.state).toBe('active')
  })

  it("a real provider's message: only when signed, once", async () => {
    process.env.STRIPE_SECRET_KEY = 'test-stripe-key'
    process.env.STRIPE_WEBHOOK_SECRET = 'test-stripe-signing'
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { companyId: L } })
    const event = { id: 'evt_test_1', type: 'customer.subscription.deleted', data: { object: { id: sub.externalId, status: 'canceled', metadata: { companyId: L } } } }
    const body = JSON.stringify(event)
    await request(app).post('/api/billing/webhook/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', 't=1,v1=00').send(body).expect(400)
    const t = Math.floor(Date.now() / 1000)
    const v1 = crypto.createHmac('sha256', 'test-stripe-signing').update(`${t}.${body}`).digest('hex')
    // The subscription row says "test"; a Stripe message for the company still applies to it.
    await request(app).post('/api/billing/webhook/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', `t=${t},v1=${v1}`).send(body).expect(200)
    await request(app).post('/api/billing/webhook/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', `t=${t},v1=${v1}`).send(body).expect(200)
    expect(await prisma.billingEvent.count({ where: { externalId: 'evt_test_1' } })).toBe(1)
    expect((await prisma.subscription.findUniqueOrThrow({ where: { companyId: L } })).status).toBe('CANCELED')
    await request(app).post('/api/billing/webhook/test').send('{}').expect(404)
    // A message for 99 Technologies is never applied.
    const home = JSON.stringify({ id: 'evt_test_2', type: 'checkout.session.completed', data: { object: { subscription: 'sub_x', client_reference_id: HOME_COMPANY_ID, metadata: { plan: 'starter', interval: 'month' } } } })
    const v2 = crypto.createHmac('sha256', 'test-stripe-signing').update(`${t}.${home}`).digest('hex')
    await request(app).post('/api/billing/webhook/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', `t=${t},v1=${v2}`).send(home).expect(200)
    expect((await prisma.company.findUniqueOrThrow({ where: { id: HOME_COMPANY_ID } })).plan).toBe('internal')
  })
})
