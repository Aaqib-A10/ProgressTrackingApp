import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Role } from '@prisma/client'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { hashPassword } from '../lib/auth'
import { ensureHomeCompany, HOME_COMPANY_ID } from '../lib/company'
import { runAsCompany, forgetTimeZone } from '../lib/tenancy'
import { companyTz } from '../lib/time'

// Phase 1, step 4: departments, roles and settings are each company's own data. A new company
// ("Echo") makes its departments and roles; 99 Technologies keeps everything as it was.

const E = 'settings-echo'
let w: SeededWorld
let echo: { admin: { id: string; role: Role }; lead: { id: string; role: Role }; member: { id: string; role: Role } }
let echoItad = ''

beforeAll(async () => {
  w = await seedWorld()
  await ensureHomeCompany()
  await prisma.company.deleteMany({ where: { id: E } })
  await prisma.company.create({ data: { id: E, name: 'Echo Test Co', slug: E, plan: 'business' } })
  echoItad = (await prisma.department.create({ data: { companyId: E, type: 'ITAD', name: 'Sales' } })).id
  const passwordHash = await hashPassword('Pass-for-tests-9')
  const mk = (name: string, role: Role, dep?: string) => prisma.user.create({ data: { companyId: E, name, email: `${name.replace(/\s+/g, '.').toLowerCase()}@echo.local.test`, role, status: 'ACTIVE', isActive: true, passwordHash, departmentId: dep } })
  const [admin, lead, member] = await Promise.all([mk('Echo Admin', 'SUPER_ADMIN'), mk('Echo Lead', 'TEAM_LEAD', echoItad), mk('Echo Member', 'MEMBER', echoItad)])
  echo = { admin: { id: admin.id, role: admin.role }, lead: { id: lead.id, role: lead.role }, member: { id: member.id, role: member.role } }
})
afterAll(async () => {
  await prisma.company.deleteMany({ where: { id: E } })
  await prisma.$disconnect()
})

describe('company settings', () => {
  it('the Super Admin names the company and sets its time zone; others cannot', async () => {
    const r = await request(app).patch('/api/company').set(...auth(echo.admin)).send({ name: 'Echo Ltd', timeZone: 'Europe/London' }).expect(200)
    expect(r.body.company).toMatchObject({ name: 'Echo Ltd', timeZone: 'Europe/London', home: false })
    await request(app).patch('/api/company').set(...auth(echo.admin)).send({ timeZone: 'Mars/Base' }).expect(400)
    await request(app).patch('/api/company').set(...auth(echo.member)).send({ name: 'Hacked' }).expect(403)
    expect((await request(app).get('/api/company').set(...auth(echo.member)).expect(200)).body).toMatchObject({ company: { name: 'Echo Ltd' }, canEdit: false })
    forgetTimeZone(E)
    expect(await runAsCompany(E, () => companyTz())).toBe('Europe/London')
    expect(await runAsCompany(HOME_COMPANY_ID, () => companyTz())).toBe('Asia/Karachi')
  })

  it('departments: General ones as needed, one of each built-in kind, empty ones can go', async () => {
    let r = await request(app).post('/api/company/departments').set(...auth(echo.admin)).send({ name: 'Operations', type: 'GENERAL' }).expect(201)
    r = await request(app).post('/api/company/departments').set(...auth(echo.admin)).send({ name: 'Finance team' }).expect(201)
    expect(r.body.departments.map((d: { name: string }) => d.name)).toEqual(['Sales', 'Operations', 'Finance team'])
    await request(app).post('/api/company/departments').set(...auth(echo.admin)).send({ name: 'Second sales', type: 'ITAD' }).expect(409)
    await request(app).post('/api/company/departments').set(...auth(echo.admin)).send({ name: 'operations' }).expect(409)
    const ops = r.body.departments.find((d: { name: string }) => d.name === 'Operations')
    await request(app).patch(`/api/company/departments/${ops.id}`).set(...auth(echo.admin)).send({ name: 'Ops' }).expect(200)
    await request(app).delete(`/api/company/departments/${echoItad}`).set(...auth(echo.admin)).expect(409)
    r = await request(app).delete(`/api/company/departments/${ops.id}`).set(...auth(echo.admin)).expect(200)
    expect(r.body.departments.map((d: { name: string }) => d.name)).toEqual(['Sales', 'Finance team'])
    await request(app).post('/api/company/departments').set(...auth(echo.lead)).send({ name: 'Nope' }).expect(403)
    // 99 Technologies' departments are not touched, and not visible.
    expect(await prisma.department.count({ where: { companyId: HOME_COMPANY_ID } })).toBe(3)
    const list = (await request(app).get('/api/company/departments').set(...auth(echo.admin)).expect(200)).body.departments
    expect(list.every((d: { name: string }) => !['ITAD', 'Lead Generation', 'Inventory'].includes(d.name))).toBe(true)
  })

  it("a company role switches parts of Metriq off for the people who have it", async () => {
    const r = await request(app).post('/api/company/roles').set(...auth(echo.admin)).send({ name: 'Caller', baseRole: 'MEMBER', areasOff: ['dialer', 'qa'] }).expect(201)
    const role = r.body.roles[0]
    expect(role).toMatchObject({ name: 'Caller', baseLabel: 'Member', areasOff: ['dialer', 'qa'], people: 0 })
    await request(app).post('/api/company/roles').set(...auth(echo.admin)).send({ name: 'Team Lead', baseRole: 'MEMBER' }).expect(409)
    // A role made from Member only fits a Member.
    await request(app).patch(`/api/company/people/${echo.lead.id}`).set(...auth(echo.admin)).send({ customRoleId: role.id }).expect(422)
    await request(app).get('/api/dialer/data').set(...auth(echo.member)).expect((x) => { if (x.status === 403) throw new Error('blocked before the role') })
    await request(app).patch(`/api/company/people/${echo.member.id}`).set(...auth(echo.admin)).send({ customRoleId: role.id }).expect(200)
    const blocked = await request(app).get('/api/dialer/data').set(...auth(echo.member)).expect(403)
    expect(blocked.body.error).toMatch(/switched off for your role/)
    await request(app).get('/api/attendance/me').set(...auth(echo.member)).expect(200)
    const meNow = (await request(app).get('/api/auth/me').set(...auth(echo.member)).expect(200)).body.user
    expect(meNow).toMatchObject({ customRole: { name: 'Caller' }, areasOff: ['dialer', 'qa'], company: { id: E, name: 'Echo Ltd' } })
    // Deleting the role puts them back on just their built-in role.
    await request(app).delete(`/api/company/roles/${role.id}`).set(...auth(echo.admin)).expect(200)
    await request(app).get('/api/dialer/data').set(...auth(echo.member)).expect((x) => { if (x.status === 403) throw new Error('still blocked') })
  })

  it('extra powers: nobody hands out more than they have', async () => {
    // Echo's Super Admin runs the company, finance included.
    await request(app).get('/api/financials/salaries').set(...auth(echo.admin)).expect(200)
    await request(app).get('/api/financials/salaries').set(...auth(echo.lead)).expect(403)
    // Holidays power for a Team Lead role.
    const r = await request(app).post('/api/company/roles').set(...auth(echo.admin)).send({ name: 'Office lead', baseRole: 'TEAM_LEAD', powers: ['holidays.manage'] }).expect(201)
    await request(app).post('/api/admin/holidays').set(...auth(echo.lead)).send({ date: '2026-12-25', name: 'Christmas' }).expect(403)
    await request(app).patch(`/api/company/people/${echo.lead.id}`).set(...auth(echo.admin)).send({ customRoleId: r.body.roles.find((x: { name: string }) => x.name === 'Office lead').id }).expect(200)
    await request(app).post('/api/admin/holidays').set(...auth(echo.lead)).send({ date: '2026-12-25', name: 'Christmas' }).expect(201)
    expect(await prisma.holiday.count({ where: { companyId: E } })).toBe(1)
    expect(await prisma.holiday.count({ where: { companyId: HOME_COMPANY_ID } })).toBe(0)
    // Give finance to a person (the Super Admin has it here).
    await request(app).patch(`/api/company/people/${echo.member.id}`).set(...auth(echo.admin)).send({ permissions: ['finance'] }).expect(200)
    await request(app).get('/api/financials/salaries').set(...auth(echo.member)).expect(200)
    // A role made from Super Admin only by a Super Admin.
    await prisma.user.update({ where: { id: echo.lead.id }, data: { permissions: ['company.settings'] } })
    await request(app).post('/api/company/roles').set(...auth(echo.lead)).send({ name: 'Boss', baseRole: 'SUPER_ADMIN' }).expect(403)
    await request(app).post('/api/company/roles').set(...auth(echo.lead)).send({ name: 'Money', baseRole: 'MEMBER', powers: ['finance'] }).expect(403)
  })

  it("99 Technologies: Super Admins still do not see finance; the finance person does", async () => {
    await request(app).get('/api/financials/salaries').set(...auth(w.superAdmin)).expect(403)
    const aqib = await prisma.user.create({ data: { name: 'Finance Person', email: 'aqibalishehzad3@gmail.com', role: 'SUPER_ADMIN', status: 'ACTIVE', isActive: true } })
    await request(app).get('/api/financials/salaries').set(...auth({ id: aqib.id, role: aqib.role })).expect(200)
    const me = (await request(app).get('/api/auth/me').set(...auth({ id: aqib.id, role: aqib.role })).expect(200)).body.user
    expect(me.permissions).toEqual(['finance', 'company.settings', 'holidays.manage'])
    // 99 Technologies' Super Admin can still set holidays, as before.
    await request(app).post('/api/admin/holidays').set(...auth(w.superAdmin)).send({ date: '2026-12-26', name: 'Boxing day' }).expect(201)
    await request(app).post('/api/admin/holidays').set(...auth(w.itadLead)).send({ date: '2026-12-27', name: 'No' }).expect(403)
  })
})
