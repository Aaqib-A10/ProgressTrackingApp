import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Role } from '@prisma/client'
import { app, auth, prisma, seedWorld } from './helpers'
import { hashPassword } from '../lib/auth'
import { ensureHomeCompany } from '../lib/company'
import { cleanBlockInput, cleanRecordData } from '../lib/customBlocks'
import { cleanDashboard } from '../lib/cards'

// Department Studio, parts B and C: dashboards made of cards (each person can arrange their
// own), and blocks a company makes itself, with records kept per department.

const C = 'studio-cleo'
type U = { id: string; role: Role }
let admin: U, member: U, member2: U, lead: U, otherMember: U
let salesId = '', hrId = ''

beforeAll(async () => {
  await seedWorld()
  await ensureHomeCompany()
  await prisma.company.deleteMany({ where: { id: C } })
  await prisma.company.create({ data: { id: C, name: 'Cleo Studio Co', slug: C, plan: 'business', setupDoneAt: new Date() } })
  const sales = await prisma.department.create({ data: { companyId: C, name: 'Sales', type: 'ITAD' } })
  const hr = await prisma.department.create({ data: { companyId: C, name: 'HR', type: 'GENERAL' } })
  salesId = sales.id; hrId = hr.id
  const passwordHash = await hashPassword('Pass-for-tests-9')
  const mk = async (name: string, role: Role, departmentId: string | null) => {
    const u = await prisma.user.create({ data: { companyId: C, name, email: `${name.replace(/\s/g, '.')}@cleo.local.test`, role, status: 'ACTIVE', isActive: true, passwordHash, departmentId } })
    return { id: u.id, role: u.role }
  }
  admin = await mk('cleo admin', 'SUPER_ADMIN', null)
  member = await mk('cleo member', 'MEMBER', sales.id)
  member2 = await mk('cleo member two', 'MEMBER', sales.id)
  lead = await mk('cleo lead', 'TEAM_LEAD', sales.id)
  otherMember = await mk('cleo hr', 'MEMBER', hr.id)
})
afterAll(async () => {
  await prisma.company.deleteMany({ where: { id: C } })
  await prisma.$disconnect()
})

const me = (u: U) => request(app).get('/api/auth/me').set(...auth(u)).expect(200).then((r) => r.body.user)

describe('rules', () => {
  it('a block needs a name and fields; keys come from the labels and stay', () => {
    expect(cleanBlockInput({ name: 'x', fields: [] })).toEqual({ error: 'Give the block a name (2 to 60 letters).' })
    expect(cleanBlockInput({ name: 'Pickups', fields: [] })).toEqual({ error: 'Add at least one field.' })
    expect(cleanBlockInput({ name: 'Pickups', fields: [{ label: 'Status', type: 'select', options: [] }] })).toEqual({ error: '"Status" needs at least one choice.' })
    const r = cleanBlockInput({ name: 'Pickups', fields: [{ label: 'Client name', type: 'text', required: true }, { label: 'Client name', type: 'text' }, { key: 'st', label: 'Status', type: 'select', options: ['New', 'Done', 'New'] }, { label: 'When', type: 'date' }], settings: { boardField: 'st', dateField: 'when', membersSee: 'own' } })
    expect(r).toMatchObject({ block: { fields: [{ key: 'client_name' }, { key: 'client_name_2' }, { key: 'st', options: ['New', 'Done'] }, { key: 'when' }], settings: { boardField: 'st', dateField: 'when', membersSee: 'own', membersAdd: true } } })
  })

  it('records are checked against the fields', () => {
    const f = [{ key: 'name', label: 'Name', type: 'text' as const, required: true }, { key: 'n', label: 'Qty', type: 'number' as const }, { key: 's', label: 'Status', type: 'select' as const, options: ['A', 'B'] }, { key: 'u', label: 'Link', type: 'url' as const }]
    expect(cleanRecordData(f, { n: 2 })).toEqual({ error: 'Fill in "Name".' })
    expect(cleanRecordData(f, { name: 'x', s: 'C' })).toEqual({ error: 'Pick one of the choices for "Status".' })
    expect(cleanRecordData(f, { name: 'x', u: 'ftp://a' })).toHaveProperty('error')
    expect(cleanRecordData(f, { name: ' x ', n: '3', s: 'A', junk: 1 })).toEqual({ data: { name: 'x', n: 3, s: 'A' } })
    expect(cleanRecordData(f, { s: 'B' }, true)).toEqual({ data: { s: 'B' } })
  })

  it('dashboards: team cards for team leads, team numbers need a kind with a daily log', () => {
    expect(cleanDashboard({ member: [{ key: 'team-today', size: 2 }], lead: [] }, 'ITAD', [])).toEqual({ error: 'Who is in is for team leads.' })
    expect(cleanDashboard({ member: [], lead: [{ key: 'team-kpis', size: 3 }] }, 'GENERAL', [])).toHaveProperty('error')
    expect(cleanDashboard({ member: [{ key: 'my-tasks', size: 4 }], lead: [] }, 'ITAD', [])).toEqual({ error: 'Each card needs a size of 1, 2 or 3.' })
    expect(cleanDashboard({ member: [{ key: 'my-tasks', size: 2 }, { key: 'my-tasks', size: 1 }], lead: [{ key: 'team-kpis', size: 3 }] }, 'ITAD', [])).toEqual({ dashboard: { member: [{ key: 'my-tasks', size: 2 }], lead: [{ key: 'team-kpis', size: 3 }] } })
  })
})

describe('dashboards', () => {
  it('the Super Admin sets one per role; people get theirs; each person can arrange their own', async () => {
    expect((await me(member)).dashboard).toBeNull()
    await request(app).put(`/api/company/departments/${salesId}/dashboard`).set(...auth(member)).send({ member: [], lead: [] }).expect(403)
    await request(app).put(`/api/company/departments/${salesId}/dashboard`).set(...auth(admin)).send({ member: [{ key: 'greeting', size: 3 }, { key: 'my-tasks', size: 2 }, { key: 'checklist', size: 1 }], lead: [{ key: 'team-today', size: 2 }, { key: 'team-kpis', size: 3 }] }).expect(200)
    expect((await me(member)).dashboard).toEqual([{ key: 'greeting', size: 3 }, { key: 'my-tasks', size: 2 }, { key: 'checklist', size: 1 }])
    expect((await me(lead)).dashboard).toEqual([{ key: 'team-today', size: 2 }, { key: 'team-kpis', size: 3 }])
    expect((await me(admin)).dashboard).toBeNull()

    await request(app).put('/api/auth/me/dashboard').set(...auth(member)).send({ order: ['checklist', 'greeting', 'my-tasks', 'nope'], hidden: ['greeting'] }).expect(200)
    expect((await me(member)).dashboardPrefs).toEqual({ order: ['checklist', 'greeting', 'my-tasks'], hidden: ['greeting'] })
    expect((await me(member2)).dashboardPrefs).toBeNull()
    await request(app).put('/api/auth/me/dashboard').set(...auth(member)).send({ reset: true }).expect(200)
    expect((await me(member)).dashboardPrefs).toBeNull()
  })
})

describe('blocks of your own', () => {
  let blockId = ''
  it('only the Super Admin makes them', async () => {
    const body = { name: 'Pickups', icon: 'Truck', fields: [{ label: 'Client', type: 'text', required: true }, { key: 'status', label: 'Status', type: 'select', options: ['New', 'Booked', 'Done'] }, { key: 'day', label: 'Pickup day', type: 'date' }], settings: { boardField: 'status', dateField: 'day', membersSee: 'own' } }
    await request(app).post('/api/company/blocks').set(...auth(lead)).send(body).expect(403)
    const r = await request(app).post('/api/company/blocks').set(...auth(admin)).send(body).expect(201)
    blockId = r.body.block.id
    expect(r.body.block).toMatchObject({ name: 'Pickups', icon: 'Truck', settings: { membersSee: 'own', boardField: 'status' } })
    expect((await me(member)).customBlocks.map((b: { name: string }) => b.name)).toEqual(['Pickups'])
  })

  it('opens only for people whose menu has it', async () => {
    await request(app).get(`/api/custom/${blockId}`).set(...auth(member)).expect(403)
    await request(app).put(`/api/company/departments/${salesId}/layout`).set(...auth(admin)).send({ member: ['my-todo', `custom:${blockId}`], lead: [`custom:${blockId}`, 'itad-team'] }).expect(200)
    await request(app).put(`/api/company/departments/${salesId}/layout`).set(...auth(admin)).send({ member: ['custom:nope00000000'], lead: [] }).expect(400)
    expect((await request(app).get(`/api/custom/${blockId}`).set(...auth(member)).expect(200)).body).toMatchObject({ canAdd: true, lead: false })
    await request(app).get(`/api/custom/${blockId}`).set(...auth(otherMember)).expect(403)
    await request(app).get(`/api/custom/${blockId}`).set(...auth(admin)).expect(200)
  })

  it("members add and see their own; the team lead sees and changes the department's", async () => {
    await request(app).post(`/api/custom/${blockId}/records`).set(...auth(member)).send({ data: { status: 'New' } }).expect(400)
    const a = (await request(app).post(`/api/custom/${blockId}/records`).set(...auth(member)).send({ data: { client: 'Acme', status: 'New', day: '2026-11-02' } }).expect(201)).body.record
    expect(a).toMatchObject({ data: { client: 'Acme', status: 'New' }, department: 'Sales', canChange: true })
    await request(app).post(`/api/custom/${blockId}/records`).set(...auth(member2)).send({ data: { client: 'Beta', status: 'Booked' } }).expect(201)
    expect((await request(app).get(`/api/custom/${blockId}/records`).set(...auth(member)).expect(200)).body.records.map((r: { data: { client: string } }) => r.data.client)).toEqual(['Acme'])
    const all = (await request(app).get(`/api/custom/${blockId}/records`).set(...auth(lead)).expect(200)).body.records
    expect(all.map((r: { data: { client: string } }) => r.data.client).sort()).toEqual(['Acme', 'Beta'])
    const beta = all.find((r: { data: { client: string } }) => r.data.client === 'Beta')
    await request(app).patch(`/api/custom/${blockId}/records/${beta.id}`).set(...auth(member)).send({ data: { status: 'Done' } }).expect(404)
    const moved = (await request(app).patch(`/api/custom/${blockId}/records/${beta.id}`).set(...auth(lead)).send({ data: { status: 'Done' } }).expect(200)).body.record
    expect(moved.data).toMatchObject({ client: 'Beta', status: 'Done' })
    await request(app).patch(`/api/custom/${blockId}/records/${a.id}`).set(...auth(member)).send({ data: { client: '' } }).expect(400)
    const s = (await request(app).get(`/api/custom/${blockId}/summary`).set(...auth(lead)).expect(200)).body
    expect(s).toMatchObject({ total: 2, by: { label: 'Status', counts: [{ label: 'New', count: 1 }, { label: 'Booked', count: 0 }, { label: 'Done', count: 1 }] } })
    await request(app).delete(`/api/custom/${blockId}/records/${a.id}`).set(...auth(member2)).expect(404)
    await request(app).delete(`/api/custom/${blockId}/records/${a.id}`).set(...auth(member)).expect(204)
  })

  it('removing a block with records needs a yes, and takes it out of every menu', async () => {
    await request(app).delete(`/api/company/blocks/${blockId}`).set(...auth(admin)).expect(409)
    await request(app).delete(`/api/company/blocks/${blockId}?withRecords=yes`).set(...auth(admin)).expect(204)
    expect((await me(member)).blocks).toEqual(['dashboard', 'my-todo'])
    expect(await prisma.customRecord.count({ where: { blockId } })).toBe(0)
  })
})
