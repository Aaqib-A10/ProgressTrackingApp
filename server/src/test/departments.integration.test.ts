import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Role } from '@prisma/client'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { hashPassword } from '../lib/auth'
import { companyToday, dbDateFromString } from '../lib/time'

// Each department sees only its own things: the department wall on every department's
// API, the per-department team lead dashboards, Top Achiever, and the cross-department leaks
// that were closed (management report, company holidays, leads with no department).

type U = { id: string; role: Role }
let w: SeededWorld
const u: Record<string, U> = {}
let mkt = '', csr = '', ecom = '', talk = ''

beforeAll(async () => {
  w = await seedWorld()
  const passwordHash = await hashPassword('Password123!')
  const [m, c, e, t] = await Promise.all([
    prisma.department.create({ data: { type: 'MARKETING', name: 'Marketing' } }),
    prisma.department.create({ data: { type: 'CSR', name: 'CSR' } }),
    prisma.department.create({ data: { type: 'ECOMMERCE', name: 'Ecommerce' } }),
    prisma.department.create({ data: { type: 'TALKLOOP', name: 'Talkloop' } }),
  ])
  mkt = m.id; csr = c.id; ecom = e.id; talk = t.id
  const [seo, social] = await Promise.all([
    prisma.subDepartment.create({ data: { name: 'SEO', slug: 'seo', departmentId: mkt } }),
    prisma.subDepartment.create({ data: { name: 'Social', slug: 'social', departmentId: mkt } }),
  ])
  const mk = async (key: string, role: Role, departmentId?: string, subDepartmentId?: string) => {
    const r = await prisma.user.create({ data: { name: key, email: `${key}@test.local`, role, status: 'ACTIVE', isActive: true, passwordHash, departmentId, subDepartmentId } })
    u[key] = { id: r.id, role: r.role }
  }
  await Promise.all([
    mk('mktLead', 'TEAM_LEAD', mkt), mk('mktSeo', 'MEMBER', mkt, seo.id), mk('mktSdl', 'SUB_DEPT_LEAD', mkt, social.id),
    mk('csrLead', 'TEAM_LEAD', csr), mk('csrAgent', 'MEMBER', csr),
    mk('ecomLead', 'TEAM_LEAD', ecom), mk('ecomMember', 'MEMBER', ecom),
    mk('talkLead', 'TEAM_LEAD', talk), mk('talkMember', 'MEMBER', talk), mk('talkMember2', 'MEMBER', talk),
    mk('qa', 'QA'), mk('lostLead', 'TEAM_LEAD'),
  ])
})
afterAll(async () => { await prisma.$disconnect() })

const get = (path: string, who: U) => request(app).get(path).set(...auth(who))

describe('the department wall', () => {
  it('people cannot open another department’s data', async () => {
    const blocked: [string, U][] = [
      ['/api/itad/entries', w.leadgenMember],
      ['/api/itad/team', u.mktLead],
      ['/api/itad/bids', u.talkMember],
      ['/api/leadgen/entries', w.itadMember],
      ['/api/talkloop/entries', u.ecomMember],
      ['/api/talkloop/team', u.ecomLead],
      ['/api/marketing/board', u.talkMember],
      ['/api/marketing/brands', w.itadLead],
      ['/api/ecommerce/board', w.inventoryMember],
      ['/api/inventory/items', u.mktSeo],
      ['/api/rdp', w.itadLead],
    ]
    for (const [path, who] of blocked) {
      const r = await get(path, who)
      expect(r.status, `${path}`).toBe(403)
      expect(r.body.error).toMatch(/only for the/)
    }
  })

  it('people still open their own department, and the Super Admin opens everything', async () => {
    await get('/api/itad/entries', w.itadMember).expect(200)
    await get('/api/talkloop/entries', u.talkMember).expect(200)
    await get('/api/marketing/board', u.mktSeo).expect(200)
    await get('/api/itad/team', w.superAdmin).expect(200)
    await get('/api/talkloop/team', w.superAdmin).expect(200)
  })

  it('shared tools stay open to everyone', async () => {
    for (const who of [u.talkMember, u.csrAgent, w.inventoryMember]) {
      await get('/api/todos', who).expect(200)
      await get('/api/attendance/me', who).expect(200)
      await get('/api/projects/me/tasks', who).expect(200)
      await get('/api/chat/conversations', who).expect(200)
    }
  })
})

describe('closed cross-department leaks', () => {
  it('the management report (ITAD + Bids + Marketing) is for the Super Admin only', async () => {
    await get('/api/reports/management/preview', u.mktLead).expect(403)
    await request(app).post('/api/reports/management/send').set(...auth(u.talkLead)).send({ to: 'someone@example.com' }).expect(403)
    await get('/api/reports/management/preview', w.superAdmin).expect(200)
  })

  it('company holidays are set by the Super Admin; leads can still see them', async () => {
    await request(app).post('/api/admin/holidays').set(...auth(u.talkLead)).send({ date: '2026-12-25', name: 'X' }).expect(403)
    const h = await request(app).post('/api/admin/holidays').set(...auth(w.superAdmin)).send({ date: '2026-12-25', name: 'Christmas' }).expect(201)
    await request(app).delete(`/api/admin/holidays/${h.body.holiday.id}`).set(...auth(w.itadLead)).expect(403)
    await get('/api/admin/holidays', u.talkLead).expect(200)
  })

  it('a team lead with no department sees nobody', async () => {
    await prisma.leaveDay.create({ data: { userId: w.itadMember.id, date: dbDateFromString('2026-10-01'), type: 'ON_LEAVE' } })
    expect((await get('/api/admin/leave', u.lostLead).expect(200)).body.leave).toHaveLength(0)
    expect((await get('/api/admin/leave/members', u.lostLead).expect(200)).body.members).toHaveLength(0)
    expect((await get('/api/admin/leave', w.itadLead).expect(200)).body.leave).toHaveLength(1)
    // ...and cannot touch the Super Admin (who also has no department)
    await get(`/api/attendance/history?userId=${w.superAdmin.id}`, u.lostLead).expect(403)
    // ...nor the company-wide default work hours
    await get('/api/attendance/shift', u.lostLead).expect(403)
  })

  it('the team export only covers the lead’s own department', async () => {
    await get('/api/reports/team.csv?department=ITAD', u.mktSdl).expect(400)
    await get('/api/reports/team.csv?department=LEAD_GEN', w.itadLead).expect(200).expect((r) => expect(r.text).not.toContain('leadgen member'))
  })
})

describe('team lead dashboards for every department', () => {
  const today = dbDateFromString(companyToday())

  it('Talkloop: calls, connect rate, demos, by country, today', async () => {
    const pk = await prisma.tag.create({ data: { name: 'Pakistan', type: 'COUNTRY', departmentId: talk } })
    await prisma.talkloopDailyEntry.create({ data: { userId: u.talkMember.id, date: today, callsMade: 50, connects: 10, demosScheduled: 3, demosConducted: 2, countryCounts: { create: [{ tagId: pk.id, calls: 50, demos: 2 }] } } })
    await prisma.talkloopDailyEntry.create({ data: { userId: u.talkMember2.id, date: today, callsMade: 30, connects: 5, demosConducted: 4 } })
    const d = (await get('/api/dashboard/team', u.talkLead).expect(200)).body
    expect(d.department).toBe('TALKLOOP')
    const k = Object.fromEntries(d.kpis.map((x: { label: string; value: number }) => [x.label, x.value]))
    expect(k['Calls Made']).toBe(80)
    expect(k['Connect Rate']).toBeCloseTo(15 / 80)
    expect(k['Demos Conducted']).toBe(6)
    expect(d.breakdown).toEqual([{ name: 'Pakistan', value: 50 }])
    expect(d.counts).toEqual({ submitted: 2, total: 2 })
    expect(d.improvement).not.toMatch(/Phase 3/)
  })

  it('Ecommerce: listings by marketplace and tasks', async () => {
    const amazon = await prisma.tag.create({ data: { name: 'Amazon', type: 'MARKETPLACE', departmentId: ecom } })
    const bto = await prisma.tag.create({ data: { name: 'BTO', type: 'TASK_TYPE', departmentId: ecom } })
    await prisma.ecommerceDailyEntry.create({ data: { userId: u.ecomMember.id, date: today, lines: { create: [{ taskTypeId: bto.id, marketplaceId: amazon.id, listings: 12 }] } } })
    await prisma.ecommerceTask.create({ data: { title: 'Done', status: 'DONE', completedAt: new Date(), assignedToId: u.ecomMember.id } })
    await prisma.ecommerceTask.create({ data: { title: 'Open', status: 'TODO' } })
    const d = (await get('/api/dashboard/team', u.ecomLead).expect(200)).body
    const k = Object.fromEntries(d.kpis.map((x: { label: string; value: number }) => [x.label, x.value]))
    expect(k).toMatchObject({ Listings: 12, 'Tasks Completed': 1, 'Open Tasks': 1 })
    expect(d.breakdown).toEqual([{ name: 'Amazon', value: 12 }])
    expect(d.todaySubmissions[0]).toMatchObject({ name: 'ecomMember', status: 'SUBMITTED', metricValue: 12 })
  })

  it('Marketing: tasks published, posts, who logged today (sub-dept leads count as team)', async () => {
    await prisma.marketingTask.create({ data: { title: 'Post', discipline: 'SOCIAL', status: 'PUBLISHED', completedAt: new Date(), assigneeId: u.mktSdl.id } })
    await prisma.seoDailyEntry.create({ data: { userId: u.mktSeo.id, date: today } })
    const d = (await get('/api/dashboard/team', u.mktLead).expect(200)).body
    expect(d.kpis.find((x: { label: string }) => x.label === 'Tasks Published').value).toBe(1)
    expect(d.breakdown).toEqual([{ name: 'Social Media', value: 1 }])
    expect(d.counts).toEqual({ submitted: 1, total: 1 }) // only SEO and Content keep a daily log
    expect(d.people.subtitle).toContain('1 of 1')
    expect(d.todaySubmissions.find((x: { name: string }) => x.name === 'mktSdl').metricValue).toBe(1)
  })

  it('CSR: QA scores (shown as percentages) and no "submitted" badges', async () => {
    for (const score of [90, 70, 85]) {
      await prisma.qaEvaluation.create({ data: { scorecardName: 'CSR', evaluatorId: u.qa.id, agentId: u.csrAgent.id, departmentId: csr, totalScore: score, passed: score >= 80, coachingNeeded: score < 80 } })
    }
    const d = (await get('/api/dashboard/team', u.csrLead).expect(200)).body
    const k = Object.fromEntries(d.kpis.map((x: { label: string; value: number }) => [x.label, x.value]))
    expect(k.Evaluations).toBe(3)
    expect(k['Average QA Score']).toBeCloseTo(245 / 300)
    expect(k['Pass Rate']).toBeCloseTo(2 / 3)
    expect(d.people.showStatus).toBe(false)
    expect(d.todaySubmissions[0]).toMatchObject({ name: 'csrAgent', metricValue: 82 })
  })

  it('Inventory: requests completed, open, low stock', async () => {
    const inv = await prisma.department.findUniqueOrThrow({ where: { type: 'INVENTORY' } })
    const item = await prisma.inventoryItem.create({ data: { departmentId: inv.id, name: 'SSD', category: 'Parts', quantity: 1, lowStockAt: 2 } })
    await prisma.inventoryMovement.create({ data: { itemId: item.id, type: 'STOCK_OUT', quantity: 3, status: 'COMPLETED', resolvedAt: new Date(), assignedToId: w.inventoryMember.id } })
    await prisma.inventoryMovement.create({ data: { itemId: item.id, type: 'STOCK_IN', quantity: 1 } })
    const d = (await get('/api/dashboard/team', w.inventoryLead).expect(200)).body
    const k = Object.fromEntries(d.kpis.map((x: { label: string; value: number }) => [x.label, x.value]))
    expect(k).toMatchObject({ 'Requests Completed': 1, 'Units Moved': 3, 'Open Requests': 1, 'Low Stock Items': 1 })
  })

  it('Top Achiever: your own department only, judged on its own work', async () => {
    const t = (await get('/api/dashboard/top-achiever', u.talkMember).expect(200)).body
    expect(t.winners).toHaveLength(1)
    expect(t.winners[0]).toMatchObject({ department: 'TALKLOOP', basis: 'by demos conducted', winner: { name: 'talkMember2', value: 4, display: '4 demos' } })
    const c = (await get('/api/dashboard/top-achiever', u.csrLead).expect(200)).body
    expect(c.winners[0]).toMatchObject({ department: 'CSR', winner: { name: 'csrAgent', display: '81.7%' } })
    const m = (await get('/api/dashboard/top-achiever', u.mktSeo).expect(200)).body
    expect(m.winners[0]).toMatchObject({ department: 'MARKETING', winner: { name: 'mktSdl' } })
    expect((await get('/api/dashboard/top-achiever', u.qa).expect(200)).body.winners.map((x: { department: string }) => x.department)).toEqual(['ITAD', 'CSR'])
    expect((await get('/api/dashboard/top-achiever', w.superAdmin).expect(200)).body.winners).toHaveLength(7)
    expect((await get('/api/dashboard/top-achiever', u.lostLead).expect(200)).body.winners).toEqual([])
    await get('/api/dashboard/top-achiever?month=2026-13', u.talkMember).expect(200)
  })

  it('the executive view now includes Talkloop and Inventory, and CSR percentages read right', async () => {
    const d = (await get('/api/dashboard/executive', w.superAdmin).expect(200)).body
    const types = d.departments.map((x: { type: string }) => x.type)
    expect(types).toEqual(expect.arrayContaining(['TALKLOOP', 'INVENTORY']))
    const tl = d.departments.find((x: { type: string }) => x.type === 'TALKLOOP')
    expect(tl.headline[0]).toMatchObject({ label: 'Calls', value: 80 })
    const c = d.departments.find((x: { type: string }) => x.type === 'CSR')
    expect(c.headline[0].value).toBeLessThanOrEqual(1)
    expect(d.benchmark.map((x: { department: string }) => x.department)).toEqual(expect.arrayContaining(['Talkloop', 'Inventory']))
  })

  it('Talkloop and Content now count in "not submitted"', async () => {
    await prisma.talkloopDailyEntry.deleteMany({ where: { userId: u.talkMember2.id } })
    const r = (await get('/api/notifications/not-submitted', u.talkLead).expect(200)).body
    expect(r.groups).toEqual([{ department: 'TALKLOOP', label: 'Talkloop', members: [expect.objectContaining({ name: 'talkMember2' })] }])
  })
})
