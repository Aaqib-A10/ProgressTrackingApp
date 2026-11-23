import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Role } from '@prisma/client'
import { app, auth, prisma, seedWorld } from './helpers'
import { hashPassword } from '../lib/auth'
import { ensureHomeCompany, HOME_COMPANY_ID } from '../lib/company'
import { billingState, runBillingReminders } from '../lib/billing/billing'
import { mailLog } from '../lib/mail'

// Stage 0 of the plan: a company that pays outside the app (bank transfer, local wallet). The owner records the
// payment; the plan runs to the date paid for, with a reminder a week before, 7 days of grace after, then read-only.

const C = 'manual-pay-co'
const EMAIL = 'owner.manualpay@test.local'
const PASSWORD = 'Owner2026x'
let admin: { id: string; role: Role }

async function owner() {
  const a = request.agent(app)
  await a.post('/api/owner/login').send({ email: EMAIL, password: PASSWORD }).expect(200)
  return a
}
const sub = () => prisma.subscription.findUniqueOrThrow({ where: { companyId: C } })

beforeAll(async () => {
  await seedWorld()
  await ensureHomeCompany()
  await prisma.platformOwner.deleteMany()
  await prisma.platformOwner.create({ data: { name: 'Anees', email: EMAIL, passwordHash: await hashPassword(PASSWORD) } })
  await prisma.company.deleteMany({ where: { id: C } })
  await prisma.ownerAuditLog.deleteMany({ where: { companyId: C } })
  await prisma.billingEvent.deleteMany({ where: { companyId: C } })
  await prisma.company.create({ data: { id: C, name: 'Manual Pay Co', slug: C, status: 'TRIAL', plan: 'business', trialEndsAt: new Date(Date.now() - 86400_000) } })
  const u = await prisma.user.create({ data: { companyId: C, name: 'Manual Admin', email: 'admin@manualpay.local.test', role: 'SUPER_ADMIN', status: 'ACTIVE', isActive: true, passwordHash: await hashPassword('Pass-for-tests-9') } })
  admin = { id: u.id, role: u.role }
})
afterAll(async () => {
  await prisma.company.deleteMany({ where: { id: C } })
  await prisma.billingEvent.deleteMany({ where: { companyId: C } })
  await prisma.platformOwner.deleteMany()
  await prisma.$disconnect()
})

describe('a payment made outside the app', () => {
  it('only the owner records it; the plan runs a month, with a paid invoice in its own currency', async () => {
    await request(app).post(`/api/owner/companies/${C}/payment`).set(...auth(admin)).send({ plan: 'starter', interval: 'month', amount: 8000, currency: 'PKR' }).expect(401)
    const a = await owner()
    await a.post(`/api/owner/companies/${C}/payment`).send({ plan: 'internal', interval: 'month', amount: 1, currency: 'USD' }).expect(400)
    await a.post(`/api/owner/companies/${C}/payment`).send({ plan: 'starter', interval: 'month', amount: 0, currency: 'USD' }).expect(400)
    await a.post(`/api/owner/companies/${HOME_COMPANY_ID}/payment`).send({ plan: 'starter', interval: 'month', amount: 29, currency: 'USD' }).expect(409)

    mailLog.length = 0
    const r = await a.post(`/api/owner/companies/${C}/payment`).send({ plan: 'starter', interval: 'month', amount: 8000.5, currency: 'pkr' }).expect(200)
    const s = await sub()
    expect(s).toMatchObject({ provider: 'manual', plan: 'starter', interval: 'month', status: 'ACTIVE' })
    expect(new Date(r.body.paidThrough).getTime()).toBe(s.currentPeriodEnd.getTime())
    const days = (s.currentPeriodEnd.getTime() - Date.now()) / 86400_000
    expect(days).toBeGreaterThan(27)
    expect(days).toBeLessThan(32)
    expect(await prisma.company.findUniqueOrThrow({ where: { id: C }, select: { plan: true, status: true } })).toEqual({ plan: 'starter', status: 'ACTIVE' })
    const inv = await prisma.invoice.findMany({ where: { companyId: C } })
    expect(inv).toHaveLength(1)
    expect(inv[0]).toMatchObject({ provider: 'manual', currency: 'PKR', amountCents: 800050, status: 'PAID' })
    expect(mailLog.some((m) => m.subject === 'Thank you: your Metriq payment is recorded')).toBe(true)
    expect(await prisma.ownerAuditLog.count({ where: { action: 'PAYMENT_RECORDED', companyId: C } })).toBe(1)

    // The company sees it in Billing, and can save again (its trial had ended).
    const b = (await request(app).get('/api/billing').set(...auth(admin)).expect(200)).body
    expect(b.state).toBe('active')
    expect(b.subscription).toMatchObject({ provider: 'manual', plan: 'starter' })
    expect(b.invoices).toHaveLength(1)
  })

  it('a second payment adds to what is already paid for', async () => {
    const before = (await sub()).currentPeriodEnd
    const a = await owner()
    await a.post(`/api/owner/companies/${C}/payment`).send({ plan: 'starter', interval: 'year', amount: 290, currency: 'USD' }).expect(200)
    const after = (await sub()).currentPeriodEnd
    const added = (after.getTime() - before.getTime()) / 86400_000
    expect(added).toBeGreaterThan(364)
    expect(added).toBeLessThan(367)
  })

  it('reminds a week before the date, gives 7 days after it, then is read-only until the next payment', async () => {
    const s = await sub()
    const c = await prisma.company.findUniqueOrThrow({ where: { id: C } })
    const at = (days: number) => new Date(s.currentPeriodEnd.getTime() + days * 86400_000)
    expect(billingState(c, s, at(-10))).toBe('active')
    expect(billingState(c, s, at(3))).toBe('past_due')
    expect(billingState(c, s, at(8))).toBe('ended')

    mailLog.length = 0
    await runBillingReminders(C, at(-10))
    expect(mailLog).toHaveLength(0)
    await runBillingReminders(C, at(-5))
    await runBillingReminders(C, at(-4)) // only once per paid-for date
    expect(mailLog.map((m) => m.subject)).toEqual([expect.stringMatching(/^Your Metriq plan is paid until /)])
    await runBillingReminders(C, at(1))
    await runBillingReminders(C, at(2))
    expect(mailLog.map((m) => m.subject)[1]).toBe('Your Metriq plan needs renewing')
    expect(mailLog).toHaveLength(2)

    // Past the grace: looking still works, saving does not, and Billing opens.
    await prisma.subscription.update({ where: { companyId: C }, data: { currentPeriodEnd: new Date(Date.now() - 9 * 86400_000) } })
    await request(app).get('/api/tasks/mine').set(...auth(admin)).expect(200)
    expect((await request(app).post('/api/notes').set(...auth(admin)).send({ title: 'After the plan ended', body: 'x' }).expect(402)).body.billing).toBe('ended')
    await request(app).get('/api/billing').set(...auth(admin)).expect(200)
    // The next payment opens it again, counted from the day it was paid.
    const a = await owner()
    await a.post(`/api/owner/companies/${C}/payment`).send({ plan: 'starter', interval: 'month', amount: 29, currency: 'USD' }).expect(200)
    await request(app).post('/api/notes').set(...auth(admin)).send({ title: 'Paid again', body: 'x' }).expect(201)
    expect((await sub()).currentPeriodEnd.getTime()).toBeGreaterThan(Date.now() + 27 * 86400_000)
  })
})
