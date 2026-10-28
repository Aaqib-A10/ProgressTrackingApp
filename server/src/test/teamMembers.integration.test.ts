import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Role } from '@prisma/client'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { hashPassword } from '../lib/auth'
import { ensureHomeCompany } from '../lib/company'

// "My Team" for a new company's founder: a Super Admin with no department of their own manages the
// whole company and picks the department on invite. A Team Lead still sees only their department.

const K = 'team-kilo'
let w: SeededWorld
let admin: { id: string; role: Role }
let lead: { id: string; role: Role }
let sales = ''
let support = ''

beforeAll(async () => {
  w = await seedWorld()
  await ensureHomeCompany()
  await prisma.company.deleteMany({ where: { id: K } })
  await prisma.company.create({ data: { id: K, name: 'Kilo Test Co', slug: K, plan: 'business' } })
  sales = (await prisma.department.create({ data: { companyId: K, type: 'GENERAL', name: 'Sales' } })).id
  support = (await prisma.department.create({ data: { companyId: K, type: 'GENERAL', name: 'Support' } })).id
  const passwordHash = await hashPassword('Pass-for-tests-9')
  const mk = (name: string, role: Role, dep?: string) => prisma.user.create({ data: { companyId: K, name, email: `${name.replace(/\s+/g, '.').toLowerCase()}@kilo.local.test`, role, status: 'ACTIVE', isActive: true, passwordHash, departmentId: dep } })
  const [a, l] = await Promise.all([mk('Kilo Admin', 'SUPER_ADMIN'), mk('Kilo Lead', 'TEAM_LEAD', sales)])
  admin = { id: a.id, role: a.role }
  lead = { id: l.id, role: l.role }
})
afterAll(async () => {
  await prisma.company.deleteMany({ where: { id: K } })
  await prisma.$disconnect()
})

describe('My Team', () => {
  it('a Super Admin with no department sees the whole company (no error)', async () => {
    const r = (await request(app).get('/api/admin/team-members').set(...auth(admin)).expect(200)).body
    expect(r.scope).toBe('company')
    expect(r.departments.map((d: { name: string }) => d.name)).toEqual(['Sales', 'Support'])
    expect(r.members.map((m: { name: string }) => m.name)).toEqual(['Kilo Lead'])
    expect(r.members[0].department).toBe('Sales')
    await request(app).get('/api/admin/team-history').set(...auth(admin)).expect(200)
  })

  it('inviting: picks the department; with several, one must be chosen', async () => {
    const no = await request(app).post('/api/admin/team-members').set(...auth(admin)).send({ name: 'Kilo New', email: 'kilo.new@kilo.local.test' }).expect(400)
    expect(no.body.error).toMatch(/Choose the department/)
    const r = await request(app).post('/api/admin/team-members').set(...auth(admin)).send({ name: 'Kilo New', email: 'kilo.new@kilo.local.test', departmentId: support }).expect(201)
    expect(r.body.member.department).toBe('Support')
    const u = await prisma.user.findUniqueOrThrow({ where: { email: 'kilo.new@kilo.local.test' } })
    expect(u).toMatchObject({ companyId: K, departmentId: support, role: 'MEMBER' })
    const h = (await request(app).get('/api/admin/team-history').set(...auth(admin))).body.events
    expect(h[0]).toMatchObject({ memberName: 'Kilo New', type: 'INVITED' })
  })

  it('a department of another company cannot be used', async () => {
    const itad = await prisma.department.findFirstOrThrow({ where: { type: 'ITAD' } })
    await request(app).post('/api/admin/team-members').set(...auth(admin)).send({ name: 'Kilo X', email: 'kilo.x@kilo.local.test', departmentId: itad.id }).expect(400)
  })

  it('a company with no department yet: the first invite makes one called Team', async () => {
    const L = 'team-lima'
    await prisma.company.deleteMany({ where: { id: L } })
    await prisma.company.create({ data: { id: L, name: 'Lima Team Co', slug: L, plan: 'business' } })
    const a = await prisma.user.create({ data: { companyId: L, name: 'Lima Founder', email: 'lima.founder@lima.local.test', role: 'SUPER_ADMIN', status: 'ACTIVE', isActive: true, passwordHash: await hashPassword('Pass-for-tests-9') } })
    const who = { id: a.id, role: a.role }
    expect((await request(app).get('/api/admin/team-members').set(...auth(who)).expect(200)).body.departments).toEqual([])
    const r = await request(app).post('/api/admin/team-members').set(...auth(who)).send({ name: 'Lima One', email: 'lima.one@lima.local.test' }).expect(201)
    expect(r.body.member.department).toBe('Team')
    expect(await prisma.department.count({ where: { companyId: L } })).toBe(1)
    await prisma.company.deleteMany({ where: { id: L } })
  })

  it('reset and remove work across the company, never on yourself', async () => {
    const u = await prisma.user.findUniqueOrThrow({ where: { email: 'kilo.new@kilo.local.test' } })
    await request(app).post(`/api/admin/team-members/${u.id}/reset-password`).set(...auth(admin)).send({}).expect(200)
    await request(app).delete(`/api/admin/team-members/${admin.id}`).set(...auth(admin)).expect(403)
    await request(app).delete(`/api/admin/team-members/${u.id}`).set(...auth(admin)).expect(204)
    // Another company's person is not found at all.
    await request(app).delete(`/api/admin/team-members/${w.itadMember.id}`).set(...auth(admin)).expect(404)
  })

  it('a Team Lead still sees only their own department', async () => {
    const r = (await request(app).get('/api/admin/team-members').set(...auth(lead)).expect(200)).body
    expect(r.scope).toBe('department')
    expect(r.departments).toBeUndefined()
    const i = (await request(app).get('/api/admin/team-members').set(...auth(w.itadLead)).expect(200)).body
    expect(i.scope).toBe('department')
    expect(i.members.map((m: { name: string }) => m.name)).toEqual(['itad member'])
  })
})
