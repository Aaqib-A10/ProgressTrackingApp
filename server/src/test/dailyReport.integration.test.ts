import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Role } from '@prisma/client'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { hashPassword } from '../lib/auth'
import { ensureHomeCompany, HOME_COMPANY_ID } from '../lib/company'
import { resetFlagCache } from '../lib/flags'
import { companyToday, dbDateFromString } from '../lib/time'

// Phase 1, step 5: the Daily Report builder. A company ("Foxtrot") builds its own daily form,
// people fill it in, the team lead sees the day, charts and the month. 99 Technologies does not
// see it until the owner switches it on for them.

const F = 'report-foxtrot'
let w: SeededWorld
let fx: { admin: { id: string; role: Role }; lead: { id: string; role: Role }; ann: { id: string; role: Role }; bob: { id: string; role: Role }; ops: { id: string; role: Role } }
let sales = ''
let formId = ''
let fields: { id: string; label: string }[] = []
const today = () => companyToday()

beforeAll(async () => {
  w = await seedWorld()
  await ensureHomeCompany()
  await prisma.featureFlagCompany.deleteMany({ where: { key: 'daily-report' } })
  await prisma.featureFlagCompany.create({ data: { key: 'daily-report', companyId: HOME_COMPANY_ID, enabled: false } })
  resetFlagCache()
  await prisma.company.deleteMany({ where: { id: F } })
  await prisma.company.create({ data: { id: F, name: 'Foxtrot Test Co', slug: F, timeZone: 'Asia/Karachi', plan: 'business' } })
  sales = (await prisma.department.create({ data: { companyId: F, type: 'GENERAL', name: 'Sales' } })).id
  const opsDept = (await prisma.department.create({ data: { companyId: F, type: 'GENERAL', name: 'Ops' } })).id
  const passwordHash = await hashPassword('Pass-for-tests-9')
  const mk = (name: string, role: Role, dep?: string) => prisma.user.create({ data: { companyId: F, name, email: `${name.replace(/\s+/g, '.').toLowerCase()}@fox.local.test`, role, status: 'ACTIVE', isActive: true, passwordHash, departmentId: dep, ...(dep ? { memberships: { create: { departmentId: dep, role } } } : {}) } })
  const [admin, lead, ann, bob, ops] = await Promise.all([mk('Fox Admin', 'SUPER_ADMIN'), mk('Fox Lead', 'TEAM_LEAD', sales), mk('Ann Fox', 'MEMBER', sales), mk('Bob Fox', 'MEMBER', sales), mk('Ops Fox', 'MEMBER', opsDept)])
  const p = (u: { id: string; role: Role }) => ({ id: u.id, role: u.role })
  fx = { admin: p(admin), lead: p(lead), ann: p(ann), bob: p(bob), ops: p(ops) }
})
afterAll(async () => {
  await prisma.company.deleteMany({ where: { id: F } })
  await prisma.featureFlagCompany.deleteMany({ where: { key: 'daily-report' } })
  await prisma.$disconnect()
})

describe('building a daily form', () => {
  it("the department's team lead builds it; members cannot", async () => {
    const body = {
      name: 'Sales daily', departmentId: sales,
      fields: [
        { label: 'Calls made', type: 'NUMBER', required: true, target: 50 },
        { label: 'Meetings booked', type: 'NUMBER', target: 2 },
        { label: 'How did it go?', type: 'CHOICE', options: ['Good', 'Okay', 'Hard'] },
        { label: 'Anything blocking you?', type: 'LONG_TEXT' },
        { label: 'Updated the CRM', type: 'YES_NO' },
      ],
    }
    await request(app).post('/api/daily-report/forms').set(...auth(fx.ann)).send(body).expect(403)
    await request(app).post('/api/daily-report/forms').set(...auth(fx.lead)).send({ ...body, fields: [{ label: 'Pick', type: 'CHOICE', options: ['One'] }] }).expect(400)
    const r = await request(app).post('/api/daily-report/forms').set(...auth(fx.lead)).send(body).expect(201)
    formId = r.body.form.id
    fields = r.body.form.fields
    expect(r.body.form).toMatchObject({ name: 'Sales daily', department: 'Sales', canManage: true })
    expect(fields.map((f) => f.label)).toEqual(body.fields.map((f) => f.label))
    // A team lead cannot make a form for everyone.
    await request(app).post('/api/daily-report/forms').set(...auth(fx.lead)).send({ ...body, departmentId: null }).expect(403)
  })

  it('only the people of the department see it to fill in', async () => {
    const ann = (await request(app).get('/api/daily-report/forms').set(...auth(fx.ann)).expect(200)).body.forms
    expect(ann.map((f: { id: string; fills: boolean }) => [f.id, f.fills])).toEqual([[formId, true]])
    expect((await request(app).get('/api/daily-report/forms').set(...auth(fx.ops)).expect(200)).body.forms).toEqual([])
    await request(app).get(`/api/daily-report/forms/${formId}/entry`).set(...auth(fx.ops)).expect(403)
  })
})

describe('filling it in', () => {
  it('one report per person per day; sending again updates it', async () => {
    const [calls, meetings, how, , crm] = fields.map((f) => f.id)
    await request(app).put(`/api/daily-report/forms/${formId}/entry`).set(...auth(fx.ann)).send({ date: today(), values: { [meetings]: 1 } }).expect(422)
    await request(app).put(`/api/daily-report/forms/${formId}/entry`).set(...auth(fx.ann)).send({ date: today(), values: { [calls]: 40, [meetings]: 1, [how]: 'Good', [crm]: true } }).expect(200)
    await request(app).put(`/api/daily-report/forms/${formId}/entry`).set(...auth(fx.ann)).send({ date: today(), values: { [calls]: 55, [meetings]: 3, [how]: 'Good', [crm]: true } }).expect(200)
    expect(await prisma.reportEntry.count({ where: { formId } })).toBe(1)
    const mine = (await request(app).get(`/api/daily-report/forms/${formId}/entry?date=${today()}`).set(...auth(fx.ann)).expect(200)).body
    expect(mine.entry.values[calls]).toBe(55)
    expect(mine.editable).toBe(true)
  })

  it('not for days to come, nor more than a week back', async () => {
    const [calls] = fields.map((f) => f.id)
    await request(app).put(`/api/daily-report/forms/${formId}/entry`).set(...auth(fx.bob)).send({ date: '2099-01-01', values: { [calls]: 1 } }).expect(422)
    await request(app).put(`/api/daily-report/forms/${formId}/entry`).set(...auth(fx.bob)).send({ date: '2020-01-01', values: { [calls]: 1 } }).expect(422)
  })
})

describe("the team's reports", () => {
  it("the team lead sees the day: who sent, who is missing, who is on leave, totals against targets", async () => {
    await prisma.leaveDay.create({ data: { userId: fx.bob.id, date: dbDateFromString(today()) } })
    await request(app).get(`/api/daily-report/forms/${formId}/team`).set(...auth(fx.ann)).expect(403)
    const r = (await request(app).get(`/api/daily-report/forms/${formId}/team?date=${today()}`).set(...auth(fx.lead)).expect(200)).body
    const byName = Object.fromEntries(r.rows.map((x: { name: string; status: string }) => [x.name, x.status]))
    expect(byName).toEqual({ 'Ann Fox': 'SENT', 'Bob Fox': 'ON_LEAVE', 'Fox Lead': 'MISSING' })
    expect(r.counts).toMatchObject({ people: 3, sent: 1, missing: 1, onLeave: 1 })
    const calls = r.totals.find((t: { fieldId: string }) => t.fieldId === fields[0].id)
    // Two people working (Ann, the lead) × 50 = 100; 55 sent.
    expect(calls).toMatchObject({ total: 55, target: 100, tone: 'danger' })
    const ann = r.rows.find((x: { name: string }) => x.name === 'Ann Fox')
    expect(ann.tones[fields[0].id]).toBe('success')
  })

  it('charts: per day over a period', async () => {
    const r = (await request(app).get(`/api/daily-report/forms/${formId}/trend?to=${today()}`).set(...auth(fx.lead)).expect(200)).body
    expect(r.days).toHaveLength(30)
    expect(r.days.at(-1)).toMatchObject({ date: today(), sent: 1, totals: { [fields[0].id]: 55 } })
  })

  it('the month: per person, and as a spreadsheet', async () => {
    const r = (await request(app).get(`/api/daily-report/forms/${formId}/monthly?month=${today().slice(0, 7)}`).set(...auth(fx.admin)).expect(200)).body
    const ann = r.rows.find((x: { name: string }) => x.name === 'Ann Fox')
    expect(ann).toMatchObject({ sent: 1, onLeave: 0 })
    expect(ann.fields[fields[0].id].total).toBe(55)
    const csv = await request(app).get(`/api/daily-report/forms/${formId}/monthly.csv?month=${today().slice(0, 7)}`).set(...auth(fx.admin)).expect(200)
    expect(csv.headers['content-type']).toMatch(/text\/csv/)
    expect(csv.text.split('\n')[0]).toBe('Name,Reports sent,Reports due,Days on leave,Calls made (total),Calls made (daily average),Meetings booked (total),Meetings booked (daily average)')
    expect(csv.text).toContain('Ann Fox,1,')
  })
})

describe('changing the form', () => {
  it('a removed question is kept for old answers; a form with answers is switched off, not deleted', async () => {
    const form = (await request(app).get('/api/daily-report/forms').set(...auth(fx.lead))).body.forms[0]
    const r = await request(app).put(`/api/daily-report/forms/${formId}`).set(...auth(fx.lead)).send({ name: 'Sales daily', departmentId: sales, fields: form.fields.filter((f: { label: string }) => f.label !== 'Meetings booked') }).expect(200)
    expect(r.body.form.fields.map((f: { label: string }) => f.label)).not.toContain('Meetings booked')
    expect(await prisma.reportField.count({ where: { formId, archived: true } })).toBe(1)
    await request(app).delete(`/api/daily-report/forms/${formId}`).set(...auth(fx.lead)).expect(409)
  })
})

describe('99 Technologies', () => {
  it("does not have it until the owner switches it on for them", async () => {
    await request(app).get('/api/daily-report/forms').set(...auth(w.itadMember)).expect(403)
    expect((await request(app).get('/api/flags').set(...auth(w.itadMember)).expect(200)).body.flags['daily-report']).toBe(false)
    expect((await request(app).get('/api/flags').set(...auth(fx.ann)).expect(200)).body.flags['daily-report']).toBe(true)
  })
})
