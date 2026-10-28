import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Role } from '@prisma/client'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { hashPassword } from '../lib/auth'
import { ensureHomeCompany, HOME_COMPANY_ID } from '../lib/company'
import { addAiSeconds, aiRoomLeft } from '../lib/plans'

// Phase 1, step 6: plans (people, file space, AI hours), parts of Metriq per company, and the
// owner console's export, remove and help sign-in (only with the company's consent).

const G = 'plans-golf'
const EMAIL = 'owner.plans@test.local'
const PASSWORD = 'Owner2026x'
let w: SeededWorld
let golf: { admin: { id: string; role: Role }; lead: { id: string; role: Role }; member: { id: string; role: Role } }

async function owner() {
  const a = request.agent(app)
  await a.post('/api/owner/login').send({ email: EMAIL, password: PASSWORD }).expect(200)
  return a
}

beforeAll(async () => {
  w = await seedWorld()
  await ensureHomeCompany()
  await prisma.platformOwner.deleteMany()
  await prisma.platformOwner.create({ data: { name: 'Anees', email: EMAIL, passwordHash: await hashPassword(PASSWORD) } })
  await prisma.company.deleteMany({ where: { id: G } })
  await prisma.company.create({ data: { id: G, name: 'Golf Test Co', slug: G, plan: 'starter' } })
  const dept = await prisma.department.create({ data: { companyId: G, type: 'ITAD', name: 'Golf Sales' } })
  const passwordHash = await hashPassword('Pass-for-tests-9')
  const mk = (name: string, role: Role) => prisma.user.create({ data: { companyId: G, name, email: `${name.replace(/\s+/g, '.').toLowerCase()}@golf.local.test`, role, status: 'ACTIVE', isActive: true, passwordHash, departmentId: role === 'SUPER_ADMIN' ? null : dept.id } })
  const [admin, lead, member] = await Promise.all([mk('Golf Admin', 'SUPER_ADMIN'), mk('Golf Lead', 'TEAM_LEAD'), mk('Golf Member', 'MEMBER')])
  golf = { admin: { id: admin.id, role: admin.role }, lead: { id: lead.id, role: lead.role }, member: { id: member.id, role: member.role } }
})
afterAll(async () => {
  await prisma.company.deleteMany({ where: { id: G } })
  await prisma.$disconnect()
})

describe('plans', () => {
  it("parts of Metriq not in the plan are closed; the owner can open one for the company", async () => {
    // Starter has no Lead Dialer.
    const r = await request(app).get('/api/dialer/data').set(...auth(golf.member)).expect(403)
    expect(r.body.error).toMatch(/not in your company's plan/)
    expect((await request(app).get('/api/auth/me').set(...auth(golf.member))).body.user.areasOff).toEqual(expect.arrayContaining(['dialer', 'qa']))
    const a = await owner()
    await a.patch(`/api/owner/companies/${G}`).send({ module: { key: "dialer", on: true } }).expect(200)
    await request(app).get('/api/dialer/data').set(...auth(golf.member)).expect((x) => { if (x.status === 403) throw new Error('still closed') })
    // And close one that is in the plan.
    await a.patch(`/api/owner/companies/${G}`).send({ module: { key: 'projects', on: false } }).expect(200)
    await request(app).get('/api/projects/me/tasks').set(...auth(golf.member)).expect(403)
    const detail = (await a.get(`/api/owner/companies/${G}`).expect(200)).body
    expect(detail.modules.find((x: { key: string }) => x.key === 'dialer')).toMatchObject({ on: true, byPlan: true, set: 'on' })
    expect(detail.modules.find((x: { key: string }) => x.key === 'projects')).toMatchObject({ on: false, set: 'off' })
    await a.patch(`/api/owner/companies/${G}`).send({ module: { key: 'projects', on: null } }).expect(200)
    await request(app).get('/api/projects/me/tasks').set(...auth(golf.member)).expect(200)
  })

  it('people: no more than the plan has room for', async () => {
    await prisma.company.update({ where: { id: G }, data: { plan: 'personal' } })
    const r = await request(app).post('/api/admin/users').set(...auth(golf.admin)).send({ name: 'One Too Many', email: 'too.many@golf.local.test', role: 'MEMBER' }).expect(402)
    expect(r.body.error).toMatch(/room for 1 person/)
    await prisma.company.update({ where: { id: G }, data: { plan: 'starter' } })
    await request(app).post('/api/admin/users').set(...auth(golf.admin)).send({ name: 'Fits In', email: 'fits.in@golf.local.test', role: 'MEMBER' }).expect(201)
  })

  it('AI meeting notes: hours a month', async () => {
    expect(await aiRoomLeft(G)).toBe(true)
    await addAiSeconds(G, 10 * 3600)
    expect(await aiRoomLeft(G)).toBe(false)
    const a = await owner()
    expect((await a.get(`/api/owner/companies/${G}`).expect(200)).body.usage.aiHours).toEqual({ used: 10, limit: 10 })
  })

  it('99 Technologies stays on the internal plan, with everything on', async () => {
    const a = await owner()
    await a.patch(`/api/owner/companies/${HOME_COMPANY_ID}`).send({ plan: 'starter' }).expect(400)
    await a.patch(`/api/owner/companies/${G}`).send({ plan: 'internal' }).expect(400)
    const home = (await a.get(`/api/owner/companies/${HOME_COMPANY_ID}`).expect(200)).body
    expect(home.company.plan).toBe('internal')
    expect(home.modules.every((m: { on: boolean }) => m.on)).toBe(true)
    expect(home.usage.people.limit).toBeNull()
    expect((await request(app).get('/api/auth/me').set(...auth(w.itadMember))).body.user.areasOff).toEqual([])
  })
})

describe('help sign-in', () => {
  it("only with the company's consent, for at most an hour, logged, with no finance", async () => {
    const a = await owner()
    await a.post(`/api/owner/companies/${G}/help-sign-in`).send({ userId: golf.member.id }).expect(403)
    // Only the company's Super Admin (Company settings) allows it.
    await request(app).post('/api/company/support-access').set(...auth(golf.member)).send({ hours: 24 }).expect(403)
    await request(app).post('/api/company/support-access').set(...auth(golf.admin)).send({ hours: 24 }).expect(200)
    // Not someone of another company.
    await a.post(`/api/owner/companies/${G}/help-sign-in`).send({ userId: w.itadMember.id }).expect(404)
    const r = await a.post(`/api/owner/companies/${G}/help-sign-in`).send({ userId: golf.admin.id }).expect(200)
    const cookie = (r.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('token='))!
    const me = await request(app).get('/api/auth/me').set('Cookie', cookie).expect(200)
    expect(me.body.user).toMatchObject({ id: golf.admin.id, supportSession: true })
    await request(app).get('/api/financials/salaries').set('Cookie', cookie).expect(403)
    expect(await prisma.ownerAuditLog.count({ where: { action: 'HELP_SIGN_IN', companyId: G } })).toBe(1)
    expect(await prisma.auditLog.count({ where: { companyId: G, action: 'SUPPORT_SIGN_IN' } })).toBe(1)
    // The company stops it: the session ends at once.
    await request(app).post('/api/company/support-access').set(...auth(golf.admin)).send({ hours: 0 }).expect(200)
    await request(app).get('/api/auth/me').set('Cookie', cookie).expect(401)
  })
})

describe('export and remove', () => {
  it('export: everything of the company, nothing of anyone else, no password hashes', async () => {
    const a = await owner()
    const r = await a.get(`/api/owner/companies/${G}/export`).buffer(true).parse((res, cb) => { let d = ''; res.on('data', (c) => { d += c }); res.on('end', () => cb(null, d)) }).expect(200)
    const data = JSON.parse(r.body as string)
    expect(data.company.id).toBe(G)
    expect(data.tables.User.map((u: { email: string }) => u.email)).toEqual(expect.arrayContaining(['golf.admin@golf.local.test']))
    expect(JSON.stringify(data)).not.toContain('passwordHash')
    expect(JSON.stringify(data)).not.toContain(w.itadMember.id)
    expect(await prisma.ownerAuditLog.count({ where: { action: 'COMPANY_EXPORT', companyId: G } })).toBe(1)
  })

  it('remove: only by typing the name; 99 Technologies never', async () => {
    const a = await owner()
    await a.delete(`/api/owner/companies/${HOME_COMPANY_ID}`).send({ confirm: '99 Technologies' }).expect(400)
    await a.delete(`/api/owner/companies/${G}`).send({ confirm: 'golf' }).expect(400)
    await fs.mkdir(path.resolve('uploads', 'chat', G), { recursive: true })
    await a.delete(`/api/owner/companies/${G}`).send({ confirm: 'Golf Test Co' }).expect(204)
    expect(await prisma.company.findUnique({ where: { id: G } })).toBeNull()
    expect(await prisma.user.count({ where: { companyId: G } })).toBe(0)
    await expect(fs.access(path.resolve('uploads', 'chat', G))).rejects.toThrow()
    expect(await prisma.user.count({ where: { companyId: HOME_COMPANY_ID } })).toBeGreaterThan(0)
  })
})
