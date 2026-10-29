import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Role } from '@prisma/client'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { hashPassword } from '../lib/auth'
import { ensureHomeCompany } from '../lib/company'
import { forgetSections } from '../lib/sectionsOff'

// Department sections (Phase 2): a company picks what each department uses. A section that is off
// leaves the menu and takes no new entries; what is there is kept and can still be read.

const O = 'sections-oscar'
let w: SeededWorld
let admin: { id: string; role: Role }
let member: { id: string; role: Role }
let leadgenId = ''

beforeAll(async () => {
  w = await seedWorld()
  await ensureHomeCompany()
  await prisma.company.deleteMany({ where: { id: O } })
  await prisma.company.create({ data: { id: O, name: 'Oscar Test Co', slug: O, plan: 'business' } })
  const passwordHash = await hashPassword('Pass-for-tests-9')
  const a = await prisma.user.create({ data: { companyId: O, name: 'Oscar Admin', email: 'admin@oscar.local.test', role: 'SUPER_ADMIN', status: 'ACTIVE', isActive: true, passwordHash } })
  admin = { id: a.id, role: a.role }
  forgetSections()
})
afterAll(async () => {
  await prisma.company.deleteMany({ where: { id: O } })
  forgetSections()
  await prisma.$disconnect()
})

describe('department kinds and sections', () => {
  it('adding a department: pick the kind and the sections to start with', async () => {
    const kinds = (await request(app).get('/api/company/departments').set(...auth(admin)).expect(200)).body.kinds
    expect(kinds.find((k: { type: string }) => k.type === 'LEAD_GEN').sections.map((s: { key: string }) => s.key)).toEqual(['leadgen-log', 'leadgen-breakdown'])
    await request(app).post('/api/company/departments').set(...auth(admin)).send({ name: 'Lead generation', type: 'LEAD_GEN', sectionsOff: ['itad-log'] }).expect(400)
    const r = await request(app).post('/api/company/departments').set(...auth(admin)).send({ name: 'Lead generation', type: 'LEAD_GEN', sectionsOff: ['leadgen-breakdown'] }).expect(201)
    const d = r.body.departments.find((x: { name: string }) => x.name === 'Lead generation')
    expect(d).toMatchObject({ type: 'LEAD_GEN', sectionsOff: ['leadgen-breakdown'] })
    leadgenId = d.id
    // One of each built-in kind.
    await request(app).post('/api/company/departments').set(...auth(admin)).send({ name: 'Second leadgen', type: 'LEAD_GEN' }).expect(409)
    const u = await prisma.user.create({ data: { companyId: O, name: 'Oscar Member', email: 'member@oscar.local.test', role: 'TEAM_LEAD', status: 'ACTIVE', isActive: true, passwordHash: await hashPassword('Pass-for-tests-9'), departmentId: leadgenId } })
    member = { id: u.id, role: u.role }
  })

  it('a section that is off: out of the menu list, no new entries, reading still works', async () => {
    const me = (await request(app).get('/api/auth/me').set(...auth(member)).expect(200)).body.user
    expect(me.company.sectionsOff).toEqual(['leadgen-breakdown'])
    const r = await request(app).put('/api/leadgen/breakdown').set(...auth(member)).send({ month: '2026-10', rows: [] })
    expect(r.status).toBe(403)
    expect(r.body).toMatchObject({ sectionOff: 'leadgen-breakdown' })
    await request(app).get('/api/leadgen/breakdown?month=2026-10').set(...auth(member)).expect(200)
  })

  it('turning it back on opens it again; only sections of its own kind; only with Company settings', async () => {
    await request(app).patch(`/api/company/departments/${leadgenId}/sections`).set(...auth(member)).send({ sectionsOff: [] }).expect(403)
    await request(app).patch(`/api/company/departments/${leadgenId}/sections`).set(...auth(admin)).send({ sectionsOff: ['mkt-seo'] }).expect(400)
    await request(app).patch(`/api/company/departments/${leadgenId}/sections`).set(...auth(admin)).send({ sectionsOff: [] }).expect(200)
    const r = await request(app).put('/api/leadgen/breakdown').set(...auth(member)).send({ month: '2026-10', rows: [] })
    expect(r.status).not.toBe(403)
    expect((await request(app).get('/api/auth/me').set(...auth(member)).expect(200)).body.user.company.sectionsOff).toEqual([])
  })

  it('99 Technologies is not touched by another company turning sections off', async () => {
    await request(app).patch(`/api/company/departments/${leadgenId}/sections`).set(...auth(admin)).send({ sectionsOff: ['leadgen-log', 'leadgen-breakdown'] }).expect(200)
    expect((await request(app).get('/api/auth/me').set(...auth(w.leadgenMember)).expect(200)).body.user.company.sectionsOff).toEqual([])
    const r = await request(app).put('/api/leadgen/entries').set(...auth(w.leadgenMember)).send({})
    expect(r.status).not.toBe(403)
    // And another company's department cannot be changed from here.
    const home = await prisma.department.findFirstOrThrow({ where: { type: 'LEAD_GEN', companyId: { not: O } } })
    await request(app).patch(`/api/company/departments/${home.id}/sections`).set(...auth(admin)).send({ sectionsOff: [] }).expect(404)
  })
})

describe('the setup wizard', () => {
  it('guesses the kind from the name, takes the one picked, and a second of a kind becomes General', async () => {
    await prisma.department.deleteMany({ where: { companyId: O, name: { not: 'Lead generation' } } })
    await prisma.company.update({ where: { id: O }, data: { setupDoneAt: null } })
    const r = await request(app).post('/api/setup/departments').set(...auth(admin)).send({ departments: [
      { name: 'Digital marketing' }, { name: 'Lead gen two' }, { name: 'Operations' }, { name: 'Phones', type: 'ITAD' },
    ] }).expect(200)
    const by = Object.fromEntries(r.body.departments.map((d: { name: string; type: string }) => [d.name, d.type]))
    expect(by).toMatchObject({ 'Digital marketing': 'MARKETING', 'Lead gen two': 'GENERAL', Operations: 'GENERAL', Phones: 'ITAD' })
  })
})
