import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import request from 'supertest'
import type { Role } from '@prisma/client'
import { app, auth, prisma, seedWorld } from './helpers'
import { hashPassword } from '../lib/auth'
import { ensureHomeCompany } from '../lib/company'

// Online payment "coming soon" (no payment provider on the server): a trial that ended keeps
// working, Billing says so, and no "choose a plan" email goes out. The owner keeps the seller
// details printed on invoices in the owner console.

const N = 'billing-november'
const EMAIL = 'owner.seller@test.local'
const PASSWORD = 'Owner2026x'
let admin: { id: string; role: Role }
const env = { ...process.env }

beforeAll(async () => {
  await seedWorld()
  await ensureHomeCompany()
  await prisma.company.deleteMany({ where: { id: N } })
  await prisma.company.create({ data: { id: N, name: 'November Test Co', slug: N, status: 'TRIAL', plan: 'business', trialEndsAt: new Date(Date.now() - 86400_000) } })
  const u = await prisma.user.create({ data: { companyId: N, name: 'November Admin', email: 'admin@november.local.test', role: 'SUPER_ADMIN', status: 'ACTIVE', isActive: true, passwordHash: await hashPassword('Pass-for-tests-9') } })
  admin = { id: u.id, role: u.role }
  await prisma.platformSetting.deleteMany()
  await prisma.platformOwner.deleteMany()
  await prisma.platformOwner.create({ data: { name: 'Anees', email: EMAIL, passwordHash: await hashPassword(PASSWORD) } })
})
afterEach(() => { process.env = { ...env } })
afterAll(async () => {
  await prisma.company.deleteMany({ where: { id: N } })
  await prisma.platformSetting.deleteMany()
  await prisma.$disconnect()
})

describe('online payment coming soon', () => {
  it('a trial that ended keeps working while there is no way to pay', async () => {
    process.env.BILLING_PROVIDER = 'none'
    const b = (await request(app).get('/api/billing').set(...auth(admin)).expect(200)).body
    expect(b).toMatchObject({ state: 'trial_ended', provider: null })
    await request(app).post('/api/todos').set(...auth(admin)).send({ title: 'Still works' }).expect(201)
    const r = await request(app).post('/api/billing/checkout').set(...auth(admin)).send({ plan: 'starter', interval: 'month' }).expect(409)
    expect(r.body.error).toMatch(/coming soon/)
    expect((await request(app).get('/api/auth/me').set(...auth(admin)).expect(200)).body.user.company.paymentsOpen).toBe(false)
  })

  it('once payments are open, an ended trial is read-only again', async () => {
    delete process.env.BILLING_PROVIDER
    await request(app).post('/api/todos').set(...auth(admin)).send({ title: 'Too late' }).expect(402)
  })
})

describe('seller details on invoices', () => {
  it('the owner sets them; invoices use them', async () => {
    const a = request.agent(app)
    await a.post('/api/owner/login').send({ email: EMAIL, password: PASSWORD }).expect(200)
    const before = (await a.get('/api/owner/settings').expect(200)).body
    expect(before.seller).toMatchObject({ name: 'Metriq', fromConsole: false })
    expect(before.signIn).toMatchObject({ open: false })
    await a.put('/api/owner/settings/seller').send({ name: 'X' }).expect(400)
    const r = (await a.put('/api/owner/settings/seller').send({ name: 'Example Seller Ltd', address: '1 Test Road, Lahore', taxId: 'NTN-0000000', email: 'billing@example.com' }).expect(200)).body
    expect(r.seller).toMatchObject({ name: 'Example Seller Ltd', taxId: 'NTN-0000000', fromConsole: true })
    await request(app).put('/api/owner/settings/seller').set(...auth(admin)).send({ name: 'Hacker Ltd' }).expect(401)
  })
})
