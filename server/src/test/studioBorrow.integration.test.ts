import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Role } from '@prisma/client'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { hashPassword } from '../lib/auth'
import { ensureHomeCompany } from '../lib/company'

// Department Studio: any block goes in any department. A General "Sales 2" with the daily calls
// log, the Lead Dialer and the ITAD team view: its people work as a calling team on those screens,
// their entries stay with Sales 2, and its team lead sees Sales 2 only (not the real ITAD team).

const B = 'studio-bora'
type U = { id: string; role: Role }
let w: SeededWorld
let admin: U, itadMember: U, s2member: U, s2lead: U, hrMember: U
let itadId = '', s2Id = ''

beforeAll(async () => {
  w = await seedWorld()
  await ensureHomeCompany()
  await prisma.company.deleteMany({ where: { id: B } })
  await prisma.company.create({ data: { id: B, name: 'Bora Co', slug: B, plan: 'business', setupDoneAt: new Date() } })
  const itad = await prisma.department.create({ data: { companyId: B, name: 'Calling', type: 'ITAD' } })
  const s2 = await prisma.department.create({ data: { companyId: B, name: 'Sales 2', type: 'GENERAL', layout: { member: ['dashboard', 'itad-log', 'itad-dialer'], lead: ['dashboard', 'itad-team', 'itad-dialer', 'itad-log'] } } })
  const hr = await prisma.department.create({ data: { companyId: B, name: 'HR', type: 'GENERAL' } })
  itadId = itad.id; s2Id = s2.id
  const passwordHash = await hashPassword('Pass-for-tests-9')
  const mk = async (name: string, role: Role, departmentId: string | null) => {
    const u = await prisma.user.create({ data: { companyId: B, name, email: `${name.replace(/\s/g, '.')}@bora.local.test`, role, status: 'ACTIVE', isActive: true, passwordHash, departmentId } })
    return { id: u.id, role: u.role }
  }
  admin = await mk('bora admin', 'SUPER_ADMIN', null)
  itadMember = await mk('bora caller', 'MEMBER', itad.id)
  s2member = await mk('bora s2 rep', 'MEMBER', s2.id)
  s2lead = await mk('bora s2 lead', 'TEAM_LEAD', s2.id)
  hrMember = await mk('bora hr', 'MEMBER', hr.id)
})
afterAll(async () => {
  await prisma.company.deleteMany({ where: { id: B } })
  await prisma.$disconnect()
})

describe('borrowed team screens', () => {
  it("a General department's people use the ITAD screens in their menu", async () => {
    await request(app).get('/api/itad/entries').set(...auth(s2member)).expect(200)
    const r = await request(app).put('/api/itad/entries').set(...auth(s2member)).send({ callsDialed: 40, connected: 9 })
    expect([200, 201]).toContain(r.status)
    await request(app).get('/api/dialer/data?rep=me').set(...auth(s2member)).expect(200)
    // Not in the member menu: the team view stays closed.
    expect((await request(app).get('/api/itad/team').set(...auth(s2member))).status).toBe(403)
  })

  it('without those blocks, a General department stays out', async () => {
    await request(app).get('/api/itad/entries').set(...auth(hrMember)).expect(403)
    await request(app).get('/api/dialer/data?rep=me').set(...auth(hrMember)).expect(403)
  })

  it("its team lead's team view is their own department, not the real ITAD team", async () => {
    const r = await request(app).get('/api/itad/team?range=today').set(...auth(s2lead)).expect(200)
    const names = r.body.agents.map((a: { name: string }) => a.name)
    expect(names).toEqual(['bora s2 rep'])
    // And the ITAD team's own view is unchanged.
    const lead = await prisma.user.create({ data: { companyId: B, name: 'bora itad lead', email: 'itad.lead@bora.local.test', role: 'TEAM_LEAD', status: 'ACTIVE', isActive: true, passwordHash: await hashPassword('Pass-for-tests-9'), departmentId: itadId } })
    const r2 = await request(app).get('/api/itad/team?range=today').set(...auth({ id: lead.id, role: lead.role })).expect(200)
    expect(r2.body.agents.map((a: { name: string }) => a.name)).toEqual(['bora caller'])
  })

  it('a borrowing team lead sees only their own department in the Lead Dialer', async () => {
    const d = (await request(app).get('/api/dialer/data?rep=me').set(...auth(s2lead)).expect(200)).body
    expect(d.reps.map((x: { name: string }) => x.name).sort()).toEqual(['bora s2 lead', 'bora s2 rep'])
  })

  it('the Super Admin is not limited, and 99 Technologies is unchanged', async () => {
    await request(app).get('/api/itad/team?range=today').set(...auth(admin)).expect(200)
    await request(app).get('/api/itad/entries').set(...auth(w.itadMember)).expect(200)
    await request(app).get('/api/itad/entries').set(...auth(w.leadgenMember)).expect(403)
  })

  it('the entry is kept with Sales 2', async () => {
    void s2Id
    const e = await prisma.itadDailyEntry.findFirst({ where: { userId: s2member.id } })
    expect(e).not.toBeNull()
  })
})
