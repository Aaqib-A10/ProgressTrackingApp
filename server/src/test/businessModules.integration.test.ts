import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { HOME_COMPANY_ID } from '../lib/company'
import { runAsCompany } from '../lib/tenancy'
import { mailLog } from '../lib/mail'
import { readCsv } from '../controllers/importController'
import { docTotals } from '../controllers/salesDocsController'
import { firstOn, nextAfter, runRecurrences } from '../lib/pm/recurrence'
import { cleanNumber, sendWhatsApp, whatsappLog, whatsappNotify } from '../lib/whatsapp'
import { setCompanyFlag, resetFlagCache } from '../lib/flags'

// Plan 2026-11, stage 2: one approvals engine, people records and leave, quotes and invoices, the report builder,
// imports, repeating tasks / "waits on" / time on a task, and notifications on WhatsApp.

let w: SeededWorld
type U = SeededWorld['superAdmin']
const home = <T>(fn: () => Promise<T>) => runAsCompany(HOME_COMPANY_ID, fn)
const get = (u: U, url: string) => request(app).get(url).set(...auth(u))
const post = (u: U, url: string, body: unknown = {}) => request(app).post(url).set(...auth(u)).send(body as object)
const put = (u: U, url: string, body: unknown = {}) => request(app).put(url).set(...auth(u)).send(body as object)
const YEAR = new Date().getFullYear()

let projectKey = 'BIZ'
let projectId = ''

beforeAll(async () => {
  w = await seedWorld()
  // These parts start off for 99 Technologies (the home company the tests run in): on for the tests.
  await setCompanyFlag('project-extras', HOME_COMPANY_ID, true, 'test')
  resetFlagCache()
  for (const t of ['SalesDoc', 'ApprovalRule', 'SavedReport']) await prisma.$executeRawUnsafe(`DELETE FROM "${t}"`)
  await prisma.company.update({ where: { id: HOME_COMPANY_ID }, data: { leaveAllowances: undefined } })
  const project = await prisma.pmProject.create({ data: { name: 'Business', key: projectKey, ownerId: w.superAdmin.id } })
  projectId = project.id
  await prisma.pmColumn.create({ data: { projectId, name: 'To do', category: 'TODO', isDefault: true } })
  await prisma.pmColumn.create({ data: { projectId, name: 'Done', category: 'DONE', position: 1 } })
  await prisma.pmProjectMember.createMany({ data: [{ projectId, userId: w.itadLead.id, role: 'ADMIN' }, { projectId, userId: w.itadMember.id, role: 'MEMBER' }] })
})
afterAll(async () => { await prisma.$disconnect() })

describe('Requests and approvals', () => {
  it('an expense goes to the team lead, who approves it', async () => {
    await post(w.itadMember, '/api/approvals', { kind: 'EXPENSE', title: 'Taxi' }).expect(400) // no amount
    const made = (await post(w.itadMember, '/api/approvals', { kind: 'EXPENSE', title: 'Taxi to the airport', amount: 40 }).expect(201)).body.request
    expect(made).toMatchObject({ status: 'PENDING', line: 'Expense: Taxi to the airport, USD 40.00', waitingOn: ['itad lead'], canDecide: false, canCancel: true })

    // Someone from another team cannot even see it; the admin sees it but it is not waiting on them.
    await get(w.leadgenMember, `/api/approvals/${made.id}`).expect(404)
    await post(w.superAdmin, `/api/approvals/${made.id}/decide`, { approve: true }).expect(403)
    await post(w.itadMember, `/api/approvals/${made.id}/decide`, { approve: true }).expect(403) // nobody approves their own

    expect((await get(w.itadLead, '/api/approvals?box=waiting').expect(200)).body.requests.map((r: { id: string }) => r.id)).toEqual([made.id])
    expect((await get(w.itadLead, '/api/approvals/inbox').expect(200)).body.inbox[0]).toMatchObject({ key: 'requests', count: 1 })
    const done = (await post(w.itadLead, `/api/approvals/${made.id}/decide`, { approve: true }).expect(200)).body.request
    expect(done.status).toBe('APPROVED')
    expect(done.steps).toMatchObject([{ status: 'APPROVED', by: 'itad lead' }])
    await post(w.itadLead, `/api/approvals/${made.id}/decide`, { approve: true }).expect(409)
    expect(await prisma.notification.count({ where: { userId: w.itadMember.id, type: 'APPROVAL_DECIDED', entityId: made.id } })).toBe(1)
  })

  it('a rule adds a second approver above an amount; a "no" needs a reason and ends it', async () => {
    await put(w.itadLead, '/api/approvals/rules', { rules: [] }).expect(403)
    await put(w.superAdmin, '/api/approvals/rules', { rules: [{ kind: 'EXPENSE', minAmount: 500, chain: ['LEAD', 'ADMIN'] }, { kind: 'PURCHASE', minAmount: null, chain: ['nobody-with-this-id'] }] }).expect(400)
    const rules = (await put(w.superAdmin, '/api/approvals/rules', { rules: [{ kind: 'EXPENSE', minAmount: 500, chain: ['LEAD', 'ADMIN'] }] }).expect(200)).body.rules
    expect(rules).toMatchObject([{ kind: 'EXPENSE', minAmount: 500, chain: ['LEAD', 'ADMIN'] }])

    // Under the amount: still one step.
    expect((await post(w.itadMember, '/api/approvals', { kind: 'EXPENSE', title: 'Lunch', amount: 30 }).expect(201)).body.request.steps).toHaveLength(1)
    const big = (await post(w.itadMember, '/api/approvals', { kind: 'EXPENSE', title: 'Laptop repair', amount: 800 }).expect(201)).body.request
    expect(big.steps.map((s: { approver: string; status: string }) => [s.approver, s.status])).toEqual([['LEAD', 'PENDING'], ['ADMIN', 'WAITING']])
    const mid = (await post(w.itadLead, `/api/approvals/${big.id}/decide`, { approve: true }).expect(200)).body.request
    expect(mid.status).toBe('PENDING')
    expect(mid.waitingOn).toEqual(['super admin'])
    await post(w.superAdmin, `/api/approvals/${big.id}/decide`, { approve: false }).expect(400) // say why
    const no = (await post(w.superAdmin, `/api/approvals/${big.id}/decide`, { approve: false, note: 'Buy a new one instead' }).expect(200)).body.request
    expect(no.status).toBe('REJECTED')
    expect(no.steps[1]).toMatchObject({ status: 'REJECTED', by: 'super admin', note: 'Buy a new one instead' })
  })

  it('approved leave lands on the attendance calendar and comes off the balance', async () => {
    await put(w.superAdmin, '/api/people/leave-defaults', { days: { ANNUAL: 14, SICK: 8, CASUAL: null } }).expect(200)
    const days = [`${YEAR}-12-30`, `${YEAR}-12-31`]
    await post(w.itadMember, '/api/approvals', { kind: 'LEAVE', days }).expect(400) // which kind of leave?
    const leave = (await post(w.itadMember, '/api/approvals', { kind: 'LEAVE', days, leaveKind: 'ANNUAL' }).expect(201)).body.request
    expect(leave.line).toBe(`Annual leave: 2 days (${days[0]} to ${days[1]})`)
    await post(w.itadMember, '/api/approvals', { kind: 'LEAVE', days: [days[1]], leaveKind: 'SICK' }).expect(409) // same day twice

    let bal = (await get(w.itadMember, '/api/approvals/leave-balance').expect(200)).body.balance
    expect(bal.ANNUAL).toEqual({ allowed: 14, used: 0, waiting: 2, left: 14 })
    expect(bal.CASUAL.allowed).toBeNull() // not set by the company: no limit is shown
    await post(w.itadLead, `/api/approvals/${leave.id}/decide`, { approve: true }).expect(200)
    bal = (await get(w.itadMember, '/api/approvals/leave-balance').expect(200)).body.balance
    expect(bal.ANNUAL).toEqual({ allowed: 14, used: 2, waiting: 0, left: 12 })
    const marked = await prisma.leaveDay.findMany({ where: { userId: w.itadMember.id }, select: { type: true, note: true } })
    expect(marked).toHaveLength(2)
    expect(marked[0]).toMatchObject({ type: 'ON_LEAVE', note: `Annual leave (request #${leave.number})` })

    // The admin gives this one person more days.
    const own = (await put(w.superAdmin, `/api/people/${w.itadMember.id}/leave`, { year: YEAR, days: { ANNUAL: 20 } }).expect(200)).body.balance
    expect(own.ANNUAL).toMatchObject({ allowed: 20, left: 18 })
    await put(w.itadLead, `/api/people/${w.itadMember.id}/leave`, { year: YEAR, days: { ANNUAL: 99 } }).expect(403)
  })

  it('a lead asks an admin; an only admin has nobody to ask; the requester can take a request back', async () => {
    const fromLead = (await post(w.itadLead, '/api/approvals', { kind: 'PURCHASE', title: 'Headsets', amount: 120 }).expect(201)).body.request
    expect(fromLead.waitingOn).toEqual(['super admin'])
    const back = (await post(w.itadLead, `/api/approvals/${fromLead.id}/cancel`).expect(200)).body.request
    expect(back.status).toBe('CANCELLED')
    await post(w.superAdmin, `/api/approvals/${fromLead.id}/decide`, { approve: true }).expect(409)
    await post(w.itadMember, `/api/approvals/${fromLead.id}/cancel`).expect(404)

    const own = (await post(w.superAdmin, '/api/approvals', { kind: 'OTHER', title: 'New office chairs' }).expect(201)).body.request
    expect(own.status).toBe('APPROVED')
    expect(own.steps[0].status).toBe('SKIPPED')

    // "All" for a team lead is their own team; for a member, their own.
    const mine = (await get(w.itadMember, '/api/approvals?box=all').expect(200)).body.requests
    expect(mine.every((r: { mine: boolean }) => r.mine)).toBe(true)
    const team = (await get(w.itadLead, '/api/approvals?box=all').expect(200)).body.requests
    expect(team.length).toBeGreaterThan(mine.length - 1)
    expect((await get(w.leadgenLead, '/api/approvals?box=all').expect(200)).body.requests).toEqual([])
  })
})

describe('Requests in another company', () => {
  it('count from 1 in each company, and stay inside it', async () => {
    const O = 'biz-other-co'
    await prisma.company.deleteMany({ where: { id: O } })
    await prisma.company.create({ data: { id: O, name: 'Other Biz Co', slug: O, status: 'ACTIVE', plan: 'business', timeZone: 'UTC' } })
    const mk = (name: string, role: 'SUPER_ADMIN' | 'MEMBER') => prisma.user.create({ data: { companyId: O, name, email: `${name.replace(/\s+/g, '.').toLowerCase()}@otherbiz.local.test`, role, status: 'ACTIVE', isActive: true } })
    const [boss, staff] = await Promise.all([mk('Other Boss', 'SUPER_ADMIN'), mk('Other Staff', 'MEMBER')])
    const first = (await post(staff, '/api/approvals', { kind: 'EXPENSE', title: 'Stamps', amount: 5 }).expect(201)).body.request
    expect(first.number).toBe(1) // the home company is already past 5
    expect(first.waitingOn).toEqual(['Other Boss']) // no team lead: an admin of their own company, never the home company's
    expect((await post(staff, '/api/approvals', { kind: 'OTHER', title: 'A second one' }).expect(201)).body.request.number).toBe(2)
    // Nobody in the home company sees it, and the other company sees nothing of the home company's.
    await get(w.superAdmin, `/api/approvals/${first.id}`).expect(404)
    expect((await get(boss, '/api/approvals?box=all').expect(200)).body.requests).toHaveLength(2)
    expect((await get(boss, '/api/people').expect(200)).body.people.map((p: { name: string }) => p.name).sort()).toEqual(['Other Boss', 'Other Staff'])
    expect((await get(boss, '/api/sales-docs').expect(200)).body.docs).toEqual([])
    await prisma.company.delete({ where: { id: O } })
  })
})

describe('People records', () => {
  it('everyone sees the directory; private parts are for the person, their lead and admins', async () => {
    const list = (await get(w.itadMember, '/api/people').expect(200)).body.people as { id: string; private: unknown; canEdit: boolean }[]
    expect(list.find((p) => p.id === w.itadMember.id)!.private).not.toBeNull()
    expect(list.find((p) => p.id === w.leadgenMember.id)).toMatchObject({ private: null, canEdit: false })

    // The person changes their own contacts, not their job.
    const mine = (await put(w.itadMember, `/api/people/${w.itadMember.id}`, { phone: '+92 300 1234567', emergencyName: 'Amna', emergencyPhone: '0300 7654321', birthday: '1995-04-12' }).expect(200)).body.person
    expect(mine).toMatchObject({ phone: '+92 300 1234567', private: { emergencyName: 'Amna', birthday: '1995-04-12' } })
    expect(mine.private.notes).toBeUndefined()
    await put(w.itadMember, `/api/people/${w.itadMember.id}`, { jobTitle: 'Director' }).expect(403)
    await put(w.itadMember, `/api/people/${w.leadgenMember.id}`, { phone: '1' }).expect(403)

    // Their lead fills in the rest; a lead of another team cannot.
    const byLead = (await put(w.itadLead, `/api/people/${w.itadMember.id}`, { jobTitle: 'Sales executive', employmentType: 'FULL_TIME', joinedOn: '2025-03-01', managerId: w.itadLead.id, notes: 'Probation ends in June' }).expect(200)).body.person
    expect(byLead).toMatchObject({ jobTitle: 'Sales executive', phone: '+92 300 1234567', manager: { name: 'itad lead' }, private: { joinedOn: '2025-03-01', employmentType: 'FULL_TIME', notes: 'Probation ends in June' } })
    await put(w.leadgenLead, `/api/people/${w.itadMember.id}`, { jobTitle: 'x' }).expect(403)
    await put(w.itadLead, `/api/people/${w.itadMember.id}`, { managerId: w.itadMember.id }).expect(400)

    // One person, with their leave for the year, for those who may see it.
    const one = (await get(w.itadLead, `/api/people/${w.itadMember.id}`).expect(200)).body
    expect(one.leave.balance.ANNUAL.used).toBe(2)
    expect((await get(w.leadgenMember, `/api/people/${w.itadMember.id}`).expect(200)).body.leave).toBeNull()
    expect((await get(w.leadgenMember, `/api/people/${w.itadMember.id}`).expect(200)).body.person.jobTitle).toBe('Sales executive')
  })
})

describe('Quotes and invoices', () => {
  const lines = [{ description: 'Laptop', quantity: 2, unitPrice: 450 }, { description: 'Setup', quantity: 1, unitPrice: 100 }]

  it('works out totals the same way everywhere', () => {
    expect(docTotals(lines, 10, 50)).toEqual({ subtotal: 1000, tax: 95, total: 1045 })
    expect(docTotals([{ quantity: 3, unitPrice: 0.1 }], 0, 0)).toEqual({ subtotal: 0.3, tax: 0, total: 0.3 })
  })

  it('a quote is made, sent, turned into an invoice and paid', async () => {
    await post(w.itadMember, '/api/sales-docs', { kind: 'QUOTE', customerName: 'Acme', lines: [] }).expect(400)
    const q = (await post(w.itadMember, '/api/sales-docs', { kind: 'QUOTE', customerName: 'Acme Ltd', lines, taxRate: 10, discount: 50 }).expect(201)).body.doc
    expect(q).toMatchObject({ number: 'Q-0001', status: 'DRAFT', subtotal: 1000, tax: 95, total: 1045 })
    expect((await post(w.itadMember, '/api/sales-docs', { kind: 'QUOTE', customerName: 'Globex', lines: [lines[1]] }).expect(201)).body.doc.number).toBe('Q-0002')

    // Others do not see a member's documents; leads and admins do.
    await get(w.leadgenMember, `/api/sales-docs/${q.id}`).expect(404)
    expect((await get(w.leadgenMember, '/api/sales-docs').expect(200)).body.docs).toEqual([])
    expect((await get(w.itadLead, '/api/sales-docs?kind=QUOTE').expect(200)).body.docs).toHaveLength(2)
    await put(w.itadLead, `/api/sales-docs/${q.id}`, { customerName: 'x', lines }).expect(403) // sees, does not change

    // No email yet: cannot send. With one: emailed, and marked sent.
    await post(w.itadMember, `/api/sales-docs/${q.id}/send`).expect(400)
    await put(w.itadMember, `/api/sales-docs/${q.id}`, { customerName: 'Acme Ltd', customerEmail: 'buyer@acme.test', lines, taxRate: 10, discount: 50 }).expect(200)
    mailLog.length = 0
    expect((await post(w.itadMember, `/api/sales-docs/${q.id}/send`).expect(200)).body.doc.status).toBe('SENT')
    expect(mailLog).toHaveLength(1)
    expect(mailLog[0]).toMatchObject({ to: 'buyer@acme.test', replyTo: 'itad.member@test.local' })
    expect(mailLog[0].subject).toMatch(/^Quote Q-0001 from /)
    expect(mailLog[0].text).toContain('Laptop: 2 x USD 450.00 = USD 900.00')
    expect(mailLog[0].text).toContain('Total: USD 1,045.00')
    await put(w.itadMember, `/api/sales-docs/${q.id}`, { customerName: 'Changed', lines }).expect(409) // sent: not rewritten

    const inv = (await post(w.itadMember, `/api/sales-docs/${q.id}/convert`).expect(201)).body.doc
    expect(inv).toMatchObject({ kind: 'INVOICE', number: 'INV-0001', total: 1045, status: 'DRAFT', fromDocId: q.id })
    expect((await get(w.itadMember, `/api/sales-docs/${q.id}`).expect(200)).body.doc.status).toBe('ACCEPTED')
    await post(w.itadMember, `/api/sales-docs/${q.id}/convert`).expect(409)
    await post(w.itadMember, `/api/sales-docs/${inv.id}/convert`).expect(400)

    await post(w.itadMember, `/api/sales-docs/${inv.id}/status`, { status: 'ACCEPTED' }).expect(400) // not an invoice status
    await post(w.itadMember, `/api/sales-docs/${inv.id}/status`, { status: 'SENT' }).expect(200)
    expect((await get(w.superAdmin, '/api/sales-docs').expect(200)).body.summary).toMatchObject({ owed: 1045, paidThisMonth: 0 })
    const paid = (await post(w.itadMember, `/api/sales-docs/${inv.id}/status`, { status: 'PAID', note: 'Bank transfer' }).expect(200)).body.doc
    expect(paid).toMatchObject({ status: 'PAID', paidNote: 'Bank transfer' })
    expect((await get(w.superAdmin, '/api/sales-docs').expect(200)).body.summary).toMatchObject({ owed: 0, paidThisMonth: 1045 })
    await request(app).delete(`/api/sales-docs/${inv.id}`).set(...auth(w.itadMember)).expect(409) // a sent invoice is voided, not deleted
  })
})

describe('The report builder', () => {
  it('is for leads and admins, and a lead only gets their own team', async () => {
    await get(w.itadMember, '/api/report-builder/sources').expect(403)
    await post(w.itadMember, '/api/report-builder/run', { source: 'requests', measure: 'count', groupBy: 'person', range: '30d' }).expect(403)
    expect((await get(w.itadLead, '/api/report-builder/sources').expect(200)).body.sources.map((s: { key: string }) => s.key)).toEqual(['tasks', 'attendance', 'leads', 'deals', 'requests', 'invoices'])
    await post(w.superAdmin, '/api/report-builder/run', { source: 'requests', measure: 'profit', groupBy: 'person', range: '30d' }).expect(400)

    const all = (await post(w.superAdmin, '/api/report-builder/run', { source: 'requests', measure: 'count', groupBy: 'person', range: '30d' }).expect(200)).body.result
    expect(all.rows.map((r: { label: string }) => r.label).sort()).toEqual(['itad lead', 'itad member', 'super admin'])
    expect(all.rows.find((r: { label: string }) => r.label === 'itad member').value).toBe(4)
    const team = (await post(w.leadgenLead, '/api/report-builder/run', { source: 'requests', measure: 'count', groupBy: 'person', range: '30d' }).expect(200)).body.result
    expect(team.rows).toEqual([])

    const money = (await post(w.superAdmin, '/api/report-builder/run', { source: 'invoices', measure: 'value', groupBy: 'status', range: 'year' }).expect(200)).body.result
    expect(money).toMatchObject({ rows: [{ label: 'Paid', value: 1045 }], total: 1045, money: true })
    const byKind = (await post(w.superAdmin, '/api/report-builder/run', { source: 'requests', measure: 'value', groupBy: 'kind', range: '7d' }).expect(200)).body.result
    expect(byKind.rows[0]).toEqual({ label: 'Expense', value: 870 })
  })

  it('a report can be kept, shared, run again and removed', async () => {
    const spec = { source: 'requests', measure: 'count', groupBy: 'status', range: 'month' }
    await post(w.itadLead, '/api/report-builder/saved', { name: '', spec }).expect(400)
    const id = (await post(w.itadLead, '/api/report-builder/saved', { name: 'Requests this month', shared: true, spec }).expect(201)).body.id
    expect((await get(w.superAdmin, '/api/report-builder/saved').expect(200)).body.reports).toMatchObject([{ name: 'Requests this month', mine: false, owner: 'itad lead' }])
    expect((await get(w.superAdmin, `/api/report-builder/saved/${id}/run`).expect(200)).body.result.total).toBeGreaterThan(0)
    await request(app).delete(`/api/report-builder/saved/${id}`).set(...auth(w.leadgenLead)).expect(404)
    await request(app).delete(`/api/report-builder/saved/${id}`).set(...auth(w.itadLead)).expect(204)
  })
})

describe('Imports', () => {
  it('reads CSV with quotes, commas and line breaks inside a cell', () => {
    expect(readCsv('name,note\r\n"Khan, Sara","said ""hi""\nand left"\n\n')).toEqual([['name', 'note'], ['Khan, Sara', 'said "hi"\nand left']])
  })

  it('people: checked first, then added with an invite email and no password shown', async () => {
    const csv = ['Name,Email,Role,Team,Job Title', 'Sara Khan,sara@import.test,member,ITAD,Sales executive', 'Omar Ali,OMAR@import.test,Team Lead,,', 'No Mail,not-an-email,,,', 'Twice,sara@import.test,,,', 'Old,itad.member@test.local,,,', 'Lost,lost@import.test,,Moon Base,', 'Odd,odd@import.test,wizard,,'].join('\n')
    await post(w.itadLead, '/api/import/people', { csv, dryRun: true }).expect(403)
    const dry = (await post(w.superAdmin, '/api/import/people', { csv, dryRun: true }).expect(200)).body
    expect(dry).toMatchObject({ dryRun: true, made: 0, willMake: 2 })
    expect(dry.rows.map((r: { line: number; ok: boolean; text: string }) => [r.line, r.ok, r.text])).toEqual([
      [2, true, 'Sara Khan (sara@import.test) as member in ITAD'],
      [3, true, 'Omar Ali (omar@import.test) as team lead'],
      [4, false, '"not-an-email" is not an email address.'],
      [5, false, 'sara@import.test is in the file twice.'],
      [6, false, 'itad.member@test.local is already in Metriq.'],
      [7, false, 'There is no team called "Moon Base". Make it first, or leave the team empty.'],
      [8, false, 'Role "wizard" is not known. Use member, team lead or admin.'],
    ])
    expect(await prisma.user.count({ where: { email: { endsWith: '@import.test' } } })).toBe(0)

    mailLog.length = 0
    const done = (await post(w.superAdmin, '/api/import/people', { csv }).expect(201)).body
    expect(done.made).toBe(2)
    const sara = await prisma.user.findUniqueOrThrow({ where: { email: 'sara@import.test' }, include: { personRecord: true, department: true } })
    expect(sara).toMatchObject({ role: 'MEMBER', department: { name: 'ITAD' }, personRecord: { jobTitle: 'Sales executive' } })
    expect((await prisma.user.findUniqueOrThrow({ where: { email: 'omar@import.test' } })).role).toBe('TEAM_LEAD')
    await new Promise((r) => setTimeout(r, 50))
    expect(mailLog.map((m) => m.to).sort()).toEqual(['omar@import.test', 'sara@import.test'])
    expect(JSON.stringify(done)).not.toMatch(/password/i)
    // The same file again adds nobody.
    expect((await post(w.superAdmin, '/api/import/people', { csv }).expect(200)).body.willMake).toBe(0)
  })

  it('tasks: into a project the person can add to, given to people who are in it', async () => {
    const csv = ['title,description,assignee,due,priority', 'Call the supplier,Ask for prices,itad.member@test.local,2026-12-15,high', 'Update the sheet,,,,', ',no title,,,', 'Ask finance,,leadgen.member@test.local,,', 'Bad date,,,next week,', 'Bad priority,,,,asap'].join('\n')
    await post(w.leadgenMember, '/api/import/tasks', { csv, projectKey, dryRun: true }).expect(404) // not their project
    await post(w.itadLead, '/api/import/tasks', { csv, dryRun: true }).expect(400)
    const dry = (await post(w.itadLead, '/api/import/tasks', { csv, projectKey, dryRun: true }).expect(200)).body
    expect(dry.willMake).toBe(2)
    expect(dry.rows.filter((r: { ok: boolean }) => !r.ok).map((r: { text: string }) => r.text)).toEqual([
      'No title.',
      '"leadgen.member@test.local" is not in this project. Add them to the project, or leave the assignee empty.',
      '"next week" is not a date. Write it as 2026-12-31.',
      'Priority "asap" is not known. Use low, medium, high or urgent.',
    ])
    expect((await post(w.itadLead, '/api/import/tasks', { csv, projectKey }).expect(201)).body.made).toBe(2)
    const tasks = await prisma.pmTask.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' }, include: { assignees: true } })
    expect(tasks.map((t) => [t.code, t.title, t.priority, t.assignees.map((a) => a.userId)])).toEqual([['BIZ-1', 'Call the supplier', 'HIGH', [w.itadMember.id]], ['BIZ-2', 'Update the sheet', 'MEDIUM', []]])
    expect(await prisma.notification.count({ where: { userId: w.itadMember.id, type: 'TASK_ASSIGNED', title: '1 new task for you in Business' } })).toBe(1)
    expect((await get(w.superAdmin, '/api/import/template/tasks').expect(200)).text.split('\n')[0].trim()).toBe('title,description,assignee,due,priority')
  })
})

describe('Projects: waits on, time, repeating tasks', () => {
  it('"waits on" links two tasks, refuses a circle, and clears when the other is done', async () => {
    const dep = (await post(w.itadMember, '/api/projects/tasks/BIZ-1/dependencies', { on: 'biz-2' }).expect(200)).body
    expect(dep).toMatchObject({ waitsOn: [{ code: 'BIZ-2', done: false }], blocked: true })
    await post(w.itadMember, '/api/projects/tasks/BIZ-2/dependencies', { on: 'BIZ-1' }).expect(422)
    await post(w.itadMember, '/api/projects/tasks/BIZ-1/dependencies', { on: 'BIZ-1' }).expect(422)
    await post(w.itadMember, '/api/projects/tasks/BIZ-1/dependencies', { on: 'NOPE-9' }).expect(404)
    expect((await get(w.itadMember, '/api/projects/tasks/BIZ-2/dependencies').expect(200)).body.blocks).toMatchObject([{ code: 'BIZ-1' }])
    await get(w.leadgenMember, '/api/projects/tasks/BIZ-1/dependencies').expect(404)

    await prisma.pmTask.update({ where: { companyId_code: { companyId: HOME_COMPANY_ID, code: 'BIZ-2' } }, data: { completedAt: new Date() } })
    const after = (await get(w.itadMember, '/api/projects/tasks/BIZ-1/dependencies').expect(200)).body
    expect(after.blocked).toBe(false)
    await request(app).delete(`/api/projects/dependencies/${after.waitsOn[0].linkId}`).set(...auth(w.itadMember)).expect(204)
  })

  it('one timer at a time; minutes can be typed in; a timesheet adds it up', async () => {
    expect((await post(w.itadMember, '/api/projects/tasks/BIZ-1/timer/start').expect(200)).body.running).toBeTruthy()
    // Starting on another task stops the first.
    await post(w.itadMember, '/api/projects/tasks/BIZ-2/timer/start').expect(200)
    expect((await get(w.itadMember, '/api/projects/tasks/BIZ-1/time').expect(200)).body.running).toBeNull()
    await post(w.itadMember, '/api/projects/tasks/BIZ-1/timer/stop').expect(409)
    const stopped = (await post(w.itadMember, '/api/projects/tasks/BIZ-2/timer/stop', { note: 'Sheet' }).expect(200)).body
    expect(stopped.running).toBeNull()
    expect(stopped.entries[0]).toMatchObject({ note: 'Sheet', running: false, mine: true })

    await post(w.itadMember, '/api/projects/tasks/BIZ-1/time', { minutes: 0 }).expect(422)
    const typed = (await post(w.itadMember, '/api/projects/tasks/BIZ-1/time', { minutes: 90, note: 'Calls' }).expect(200)).body
    expect(typed.totalMinutes).toBe(91) // the one-minute timer and the 90 typed in
    const sheet = (await get(w.itadMember, '/api/projects/me/time?days=7').expect(200)).body
    expect(sheet.totalMinutes).toBe(92)
    expect(sheet.entries.map((e: { code: string }) => e.code).sort()).toEqual(['BIZ-1', 'BIZ-1', 'BIZ-2'])
    // Someone else's time is theirs; a person who manages the project may remove it.
    const mine = typed.entries.find((e: { note: string }) => e.note === 'Calls').id
    await request(app).delete(`/api/projects/time/${mine}`).set(...auth(w.leadgenMember)).expect(404)
    await request(app).delete(`/api/projects/time/${mine}`).set(...auth(w.itadLead)).expect(204)

    // Hours logged show up in the report builder.
    const hours = (await post(w.superAdmin, '/api/report-builder/run', { source: 'tasks', measure: 'hours', groupBy: 'person', range: '7d' }).expect(200)).body.result
    expect(hours.rows).toEqual([{ label: 'itad member', value: 0.03 }])
  })

  it('a repeating task appears on its day, once', async () => {
    expect(firstOn('WEEKLY', 1, '2026-11-25')).toBe('2026-11-30') // the next Monday
    expect(firstOn('MONTHLY', 15, '2026-11-25')).toBe('2026-12-15')
    expect(firstOn('MONTHLY', 28, '2026-11-25')).toBe('2026-11-28')
    expect(nextAfter('DAILY', null, '2026-11-25')).toBe('2026-11-26')
    expect(nextAfter('WEEKLY', 3, '2026-11-25')).toBe('2026-12-02')

    await post(w.itadMember, `/api/projects/${projectKey}/recurrences`, { title: 'x', every: 'DAILY' }).expect(403) // members do not manage the project
    await post(w.itadLead, `/api/projects/${projectKey}/recurrences`, { title: 'Weekly report', every: 'WEEKLY' }).expect(422) // which day?
    const r = (await post(w.itadLead, `/api/projects/${projectKey}/recurrences`, { title: 'Check the inbox', every: 'DAILY', assigneeIds: [w.itadMember.id], dueInDays: 0 }).expect(201)).body.recurrence
    expect(r).toMatchObject({ every: 'DAILY', active: true })

    const before = await prisma.pmTask.count({ where: { projectId } })
    expect(await home(() => runRecurrences())).toBe(1)
    expect(await home(() => runRecurrences())).toBe(0) // the same day: nothing more
    expect(await home(() => runRecurrences(new Date(Date.now() + 86400_000)))).toBe(1)
    const made = await prisma.pmTask.findMany({ where: { projectId, title: 'Check the inbox' }, include: { assignees: true } })
    expect(made).toHaveLength(2)
    expect(await prisma.pmTask.count({ where: { projectId } })).toBe(before + 2)
    expect(made[0].assignees.map((a) => a.userId)).toEqual([w.itadMember.id])

    // Switched off for the company: nothing is made, and nothing is lost (it is made when the switch comes back on).
    await setCompanyFlag('project-extras', HOME_COMPANY_ID, false, 'test')
    resetFlagCache()
    expect(await home(() => runRecurrences(new Date(Date.now() + 2 * 86400_000)))).toBe(0)
    await setCompanyFlag('project-extras', HOME_COMPANY_ID, true, 'test')
    resetFlagCache()

    // Paused: nothing is made. Removed: the tasks it made stay.
    await request(app).patch(`/api/projects/recurrences/${r.id}`).set(...auth(w.itadLead)).send({ active: false }).expect(200)
    expect(await home(() => runRecurrences(new Date(Date.now() + 3 * 86400_000)))).toBe(0)
    await request(app).delete(`/api/projects/recurrences/${r.id}`).set(...auth(w.itadLead)).expect(204)
    expect(await prisma.pmTask.count({ where: { projectId, title: 'Check the inbox' } })).toBe(2)
  })
})

describe('Notifications on WhatsApp', () => {
  it('a person gives their number and turns it on; only they are messaged', async () => {
    expect(cleanNumber('+92 300 123-4567')).toBe('923001234567')
    expect(cleanNumber('0092 300 1234567')).toBe('923001234567')
    expect(cleanNumber('12345')).toBeNull()
    await put(w.itadMember, '/api/auth/me/whatsapp', { number: '', on: true }).expect(400)
    await put(w.itadMember, '/api/auth/me/whatsapp', { number: 'hello', on: false }).expect(400)
    expect((await put(w.itadMember, '/api/auth/me/whatsapp', { number: '+92 300 1234567', on: true }).expect(200)).body.whatsapp).toMatchObject({ number: '923001234567', on: true })
    expect((await get(w.itadMember, '/api/auth/me').expect(200)).body.user.whatsapp).toMatchObject({ number: '923001234567', on: true })

    whatsappLog.length = 0
    const sent = await whatsappNotify([{ userId: w.itadMember.id, title: 'Task due', body: 'BIZ-1 is due today' }, { userId: w.itadLead.id, title: 'Not for WhatsApp', body: 'This person did not turn it on' }])
    expect(sent).toBe(1)
    expect(whatsappLog).toEqual([{ to: '923001234567', title: 'Task due', body: 'BIZ-1 is due today' }])
  })

  it('sends Meta a template message with the title and the text', async () => {
    const calls: { url: string; body: Record<string, unknown>; auth: string }[] = []
    const fake = async (url: string, init: { headers: Record<string, string>; body: string }) => { calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization }); return { ok: true, status: 200, text: async () => '{}' } }
    expect(await sendWhatsApp('923001234567', 'Hi', 'There', fake)).toBe(false) // no account on the server: nothing is sent
    process.env.WHATSAPP_TOKEN = 'test-token'
    process.env.WHATSAPP_PHONE_ID = '1234567890'
    try {
      expect(await sendWhatsApp('923001234567', 'Task\ndue', '', fake)).toBe(true)
      expect(calls).toHaveLength(1)
      expect(calls[0].url).toBe('https://graph.facebook.com/v20.0/1234567890/messages')
      expect(calls[0].auth).toBe('Bearer test-token')
      expect(calls[0].body).toMatchObject({ messaging_product: 'whatsapp', to: '923001234567', type: 'template', template: { name: 'metriq_alert', components: [{ type: 'body', parameters: [{ type: 'text', text: 'Task due' }, { type: 'text', text: '-' }] }] } })
      expect(await sendWhatsApp('923001234567', 'Hi', 'There', async () => ({ ok: false, status: 400, text: async () => 'bad template' }))).toBe(false)
    } finally {
      delete process.env.WHATSAPP_TOKEN
      delete process.env.WHATSAPP_PHONE_ID
    }
  })
})
