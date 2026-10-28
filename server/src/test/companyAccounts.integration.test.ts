import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app, prisma, seedWorld } from './helpers'
import { hashPassword } from '../lib/auth'
import { ensureHomeCompany } from '../lib/company'

// erp: people belong to a company (or a personal workspace for one person), sign in with an
// email or a username, and a suspended company signs its people out.

const PW = 'Pass-for-tests-9'

beforeAll(async () => {
  await seedWorld()
  await ensureHomeCompany()
  await prisma.company.deleteMany({ where: { id: { in: ['t-acme', 't-solo'] } } })
  await prisma.company.create({ data: { id: 't-acme', name: 'Acme Test', slug: 't-acme', kind: 'TEAM', helpEnabled: true } })
  await prisma.company.create({ data: { id: 't-solo', name: 'Solo Test', slug: 't-solo', kind: 'PERSONAL', plan: 'personal', helpEnabled: true } })
  const passwordHash = await hashPassword(PW)
  await prisma.user.create({ data: { name: 'Acme Person', email: 'acme.person@local.test', username: 'acmeperson', passwordHash, companyId: 't-acme' } })
  await prisma.user.create({ data: { name: 'Solo Person', email: 'solo.person@local.test', username: 'soloperson', passwordHash, companyId: 't-solo' } })
})
afterAll(async () => {
  await prisma.supportTicket.deleteMany({ where: { companyId: { in: ['t-acme', 't-solo'] } } })
  await prisma.user.deleteMany({ where: { email: { in: ['acme.person@local.test', 'solo.person@local.test'] } } })
  await prisma.company.deleteMany({ where: { id: { in: ['t-acme', 't-solo'] } } })
  await prisma.$disconnect()
})

describe('company people', () => {
  it('sign in with a username or the email', async () => {
    const a = request.agent(app)
    const r = await a.post('/api/auth/login').send({ email: 'AcmePerson', password: PW }).expect(200)
    expect(r.body.user.email).toBe('acme.person@local.test')
    await request(app).post('/api/auth/login').send({ email: 'acme.person@local.test', password: PW }).expect(200)
    await request(app).post('/api/auth/login').send({ email: 'acmeperson', password: 'wrong-one-1' }).expect(401)
  })

  it('a complaint lands under their own company (or their personal workspace)', async () => {
    const a = request.agent(app)
    await a.post('/api/auth/login').send({ email: 'acmeperson', password: PW }).expect(200)
    expect((await a.get('/api/support/status').expect(200)).body.enabled).toBe(true)
    const t = await a.post('/api/support').send({ subject: 'From Acme', body: 'Testing the help button' }).expect(201)
    expect((await prisma.supportTicket.findUniqueOrThrow({ where: { id: t.body.ticket.id } })).companyId).toBe('t-acme')

    const s = request.agent(app)
    await s.post('/api/auth/login').send({ email: 'soloperson', password: PW }).expect(200)
    const t2 = await s.post('/api/support').send({ subject: 'From solo', body: 'Testing the help button' }).expect(201)
    expect((await prisma.supportTicket.findUniqueOrThrow({ where: { id: t2.body.ticket.id } })).companyId).toBe('t-solo')
  })

  it('a suspended company cannot sign in, and open sessions end', async () => {
    const a = request.agent(app)
    await a.post('/api/auth/login').send({ email: 'acmeperson', password: PW }).expect(200)
    await prisma.company.update({ where: { id: 't-acme' }, data: { status: 'SUSPENDED' } })
    await a.get('/api/auth/me').expect(401)
    expect((await request(app).post('/api/auth/login').send({ email: 'acmeperson', password: PW }).expect(403)).body.error).toMatch(/paused/)
    await prisma.company.update({ where: { id: 't-acme' }, data: { status: 'ACTIVE' } })
  })

  it('test accounts made on a PC never sign in on the live server', async () => {
    const was = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try { await request(app).post('/api/auth/login').send({ email: 'soloperson', password: PW }).expect(401) } finally { process.env.NODE_ENV = was }
  })
})
