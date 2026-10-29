import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { Prisma, type Role } from '@prisma/client'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { hashPassword } from '../lib/auth'
import { ensureHomeCompany, HOME_COMPANY_ID } from '../lib/company'
import { setCompanyFlag } from '../lib/flags'

// Department Studio (Phase 2, part A): a department gets its own member and team lead menus.
// The person's menu comes back on /me; blocks taken out stop new entries; 99 Technologies has
// the Studio switched off, so nothing changes for them.

const S = 'studio-sam'
let w: SeededWorld
let admin: { id: string; role: Role }
let member: { id: string; role: Role }
let lead: { id: string; role: Role }
let salesId = ''
let generalId = ''

beforeAll(async () => {
  w = await seedWorld()
  await ensureHomeCompany()
  await prisma.company.deleteMany({ where: { id: S } })
  await prisma.company.create({ data: { id: S, name: 'Sam Studio Co', slug: S, plan: 'business', setupDoneAt: new Date() } })
  const sales = await prisma.department.create({ data: { companyId: S, name: 'Sales', type: 'ITAD' } })
  const general = await prisma.department.create({ data: { companyId: S, name: 'HR', type: 'GENERAL' } })
  salesId = sales.id; generalId = general.id
  const passwordHash = await hashPassword('Pass-for-tests-9')
  const mk = (name: string, role: Role, departmentId: string | null) => prisma.user.create({ data: { companyId: S, name, email: `${name.replace(/\s/g, '.')}@sam.local.test`, role, status: 'ACTIVE', isActive: true, passwordHash, departmentId } })
  const [a, m, l] = await Promise.all([mk('sam admin', 'SUPER_ADMIN', null), mk('sam member', 'MEMBER', sales.id), mk('sam lead', 'TEAM_LEAD', sales.id)])
  admin = { id: a.id, role: a.role }; member = { id: m.id, role: m.role }; lead = { id: l.id, role: l.role }
})
afterAll(async () => {
  await prisma.company.deleteMany({ where: { id: S } })
  await prisma.department.updateMany({ where: { companyId: HOME_COMPANY_ID }, data: { layout: Prisma.DbNull } })
  await prisma.$disconnect()
})

const me = (u: { id: string; role: Role }) => request(app).get('/api/auth/me').set(...auth(u)).expect(200).then((r) => r.body.user)
const put = (u: { id: string; role: Role }, id: string, body: object) => request(app).put(`/api/company/departments/${id}/layout`).set(...auth(u)).send(body)

describe('Department Studio', () => {
  it('starts with the menu of its kind (no layout)', async () => {
    expect((await me(member)).blocks).toBeNull()
    const d = (await request(app).get('/api/company/departments').set(...auth(admin)).expect(200)).body.departments
    expect(d.find((x: { id: string }) => x.id === salesId).layout).toBeNull()
  })

  it('only the Super Admin saves it, and only blocks that fit', async () => {
    await put(member, salesId, { member: ['my-todo'], lead: [] }).expect(403)
    await put(admin, generalId, { member: ['my-reports'], lead: [] }).expect(400)
    await put(admin, salesId, { member: ['itad-team'], lead: [] }).expect(400)
    const r = await put(admin, salesId, { member: ['itad-dialer', 'my-todo', 'chat'], lead: ['itad-dialer', 'itad-team', 'my-team'] }).expect(200)
    expect(r.body.departments.find((x: { id: string }) => x.id === salesId).layout).toEqual({ member: ['dashboard', 'itad-dialer', 'my-todo', 'chat'], lead: ['dashboard', 'itad-dialer', 'itad-team', 'my-team'] })
  })

  it("each person gets their role's menu; the Super Admin is not limited", async () => {
    expect((await me(member)).blocks).toEqual(['dashboard', 'itad-dialer', 'my-todo', 'chat'])
    expect((await me(lead)).blocks).toEqual(['dashboard', 'itad-dialer', 'itad-team', 'my-team'])
    expect((await me(admin)).blocks).toBeNull()
  })

  it('a block out of the menu takes no new entries; reading stays open', async () => {
    const r = await request(app).post('/api/itad/bids').set(...auth(member)).send({})
    expect(r.status).toBe(403)
    expect(r.body.blockOff).toBe('itad-bids')
    await request(app).get('/api/itad/bids').set(...auth(member)).expect((x) => { if (x.status === 403 && x.body.blockOff) throw new Error('reading was refused') })
    // In the menu: the request goes through to the page's own checks (not refused by the Studio).
    const d = await request(app).post('/api/dialer/leads/nope/status').set(...auth(member)).send({ status: 'Interested' })
    expect(d.body.blockOff).toBeUndefined()
  })

  it('reset goes back to the menu of its kind', async () => {
    await put(admin, salesId, { reset: true }).expect(200)
    expect((await me(member)).blocks).toBeNull()
    const r = await request(app).post('/api/itad/bids').set(...auth(member)).send({})
    expect(r.body.blockOff).toBeUndefined()
  })

  it('is switched off for 99 Technologies: nothing changes for them', async () => {
    // As the migration sets it for 99 Technologies (another test may have cleared the switches).
    await setCompanyFlag('department-studio', HOME_COMPANY_ID, false, 'test')
    const itad = await prisma.user.findUniqueOrThrow({ where: { id: w.itadMember.id }, select: { departmentId: true } })
    await prisma.department.update({ where: { id: itad.departmentId! }, data: { layout: { member: ['dashboard'], lead: ['dashboard'] } } })
    expect((await me(w.itadMember)).blocks).toBeNull()
    await put(w.superAdmin, itad.departmentId!, { member: ['my-todo'], lead: [] }).expect(403)
  })
})
