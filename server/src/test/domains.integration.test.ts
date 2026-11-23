import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Role } from '@prisma/client'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'

// E-commerce, Marketing, Quality Assurance and Financials had no tests of their own (plan 2026-11, 1.6). These are
// the checks a buyer's first week would trip over: who may open each area, and that its everyday actions save.

type U = { id: string; role: Role }
let w: SeededWorld
let ecLead: U, ecMember: U, mkLead: U, mkMember: U, qa: U, finance: U
const get = (u: U, url: string) => request(app).get(url).set(...auth(u))
const post = (u: U, url: string, body: unknown = {}) => request(app).post(url).set(...auth(u)).send(body as object)

beforeAll(async () => {
  w = await seedWorld()
  const [ec, mk] = await Promise.all([
    prisma.department.create({ data: { type: 'ECOMMERCE', name: 'E-commerce' } }),
    prisma.department.create({ data: { type: 'MARKETING', name: 'Marketing' } }),
  ])
  const person = async (name: string, role: Role, departmentId?: string, permissions: string[] = []): Promise<U> => {
    const u = await prisma.user.create({ data: { name, email: `${name.replace(/\s+/g, '.').toLowerCase()}@domains.local.test`, role, status: 'ACTIVE', isActive: true, departmentId, permissions } })
    return { id: u.id, role: u.role }
  }
  ecLead = await person('Shop Lead', 'TEAM_LEAD', ec.id)
  ecMember = await person('Shop Member', 'MEMBER', ec.id)
  mkLead = await person('Brand Lead', 'TEAM_LEAD', mk.id)
  mkMember = await person('Brand Member', 'MEMBER', mk.id)
  qa = await person('Quality Checker', 'QA')
  finance = await person('Money Person', 'MEMBER', undefined, ['finance'])
})
afterAll(async () => { await prisma.$disconnect() })

describe('E-commerce', () => {
  it('is for the e-commerce team; other teams and visitors are turned away', async () => {
    for (const url of ['/api/ecommerce/board', '/api/ecommerce/meeting-notes', '/api/ecommerce/stock', '/api/ecommerce/team']) {
      await get(ecLead, url).expect(200)
      await get(w.itadMember, url).expect(403)
      await request(app).get(url).expect(401)
    }
    await get(ecMember, '/api/ecommerce/board').expect(200)
    await get(w.superAdmin, '/api/ecommerce/board').expect(200) // the admin sees every team
  })

  it('meeting notes, a stock problem and a board task are saved and read back', async () => {
    await post(ecMember, '/api/ecommerce/meeting-notes', { title: 'Monday sync', body: 'Relist the monitors by Friday.' }).expect(201)
    const notes = (await get(ecLead, '/api/ecommerce/meeting-notes').expect(200)).body
    expect(JSON.stringify(notes)).toContain('Relist the monitors by Friday.')

    await post(ecMember, '/api/ecommerce/stock', { itemName: 'Dell 24 monitor', action: 'STOCK_OUT', quantity: 4, requestedByName: 'Shop Member' }).expect(201)
    expect(JSON.stringify((await get(ecLead, '/api/ecommerce/stock').expect(200)).body)).toContain('Dell 24 monitor')
    await post(w.itadMember, '/api/ecommerce/stock', { itemName: 'Not theirs', action: 'STOCK_OUT', requestedByName: 'x' }).expect(403)

    // The board: a team lead adds a task and gives it to a member, who then sees it.
    const made = await post(ecLead, '/api/ecommerce/tasks', { title: 'Fix the Amazon listing', assignedToId: ecMember.id, dueDate: null }).expect(201)
    expect(JSON.stringify(made.body)).toContain('Fix the Amazon listing')
    expect(JSON.stringify((await get(ecMember, '/api/ecommerce/board').expect(200)).body)).toContain('Fix the Amazon listing')
    await post(ecLead, '/api/ecommerce/tasks', {}).expect(400)
  })
})

describe('Marketing', () => {
  it('is for the marketing team; other teams and visitors are turned away', async () => {
    for (const url of ['/api/marketing/board', '/api/marketing/team', '/api/marketing/brands', '/api/marketing/content']) {
      await get(mkLead, url).expect(200)
      await get(w.leadgenMember, url).expect(403)
      await request(app).get(url).expect(401)
    }
    await get(mkMember, '/api/marketing/board').expect(200)
    await get(w.superAdmin, '/api/marketing/brands').expect(200)
    // A member of another team cannot write into Marketing either.
    await post(w.itadLead, '/api/marketing/tasks', { title: 'Not theirs' }).expect(403)
  })
})

describe('Quality Assurance', () => {
  it('QA people score and see the team; an agent sees only their own evaluations', async () => {
    await get(qa, '/api/qa/scorecards').expect(200)
    await get(qa, '/api/qa/team-dashboard').expect(200)
    await get(qa, '/api/qa/evaluations').expect(200)
    await get(w.itadMember, '/api/qa/my-evaluations').expect(200)
    await get(w.itadMember, '/api/qa/team-dashboard').expect(403)
    await request(app).get('/api/qa/scorecards').expect(401)
    // Only QA (and admins) make scorecards and evaluations.
    await post(w.itadMember, '/api/qa/scorecards', { name: 'Mine' }).expect(403)
    await post(w.itadLead, '/api/qa/evaluations', {}).expect(403)
    await post(qa, '/api/qa/evaluations', {}).expect(400) // QA may, but an empty evaluation is refused
  })
})

describe('Financials', () => {
  it('open only to people with the finance power, not to every admin', async () => {
    await get(finance, '/api/financials').expect(200)
    await get(finance, '/api/financials/salaries').expect(200)
    await get(w.itadLead, '/api/financials').expect(403)
    await get(w.itadMember, '/api/financials/salaries').expect(403)
    await request(app).get('/api/financials').expect(401)
    // A Super Admin without the finance power does not see salaries.
    expect((await get(w.superAdmin, '/api/financials/salaries')).status).toBe(403)
    await post(w.itadLead, '/api/financials/salaries', { userId: w.itadMember.id, monthlyCost: 1000 }).expect(403)
  })
})
