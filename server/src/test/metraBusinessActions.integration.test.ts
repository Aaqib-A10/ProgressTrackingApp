import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import request from 'supertest'
import type { Prisma, Role } from '@prisma/client'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { setAuditBaseUrl } from '../lib/health/audit'
import { setCompanyFlag, resetFlagCache } from '../lib/flags'
import { HOME_COMPANY_ID } from '../lib/company'
import { askerOf, forgetAsker } from '../lib/metra/access'
import { toolSpecs } from '../lib/metra/agent'
import { readable } from '../lib/metra/catalog'
import { wantsAction } from '../lib/metra/talk'

// Metra and the plan 2026-11 modules: it offers their data sets and action cards only where the module is switched
// on; a card does exactly what it says, on Confirm, as that person; meeting notes become tasks with one confirmation.

type U = { id: string; role: Role }
let w: SeededWorld
let server: Server
const YEAR = new Date().getFullYear()
const FLAGS = ['requests', 'people-records', 'sales-docs', 'report-builder', 'project-extras'] as const

async function card(u: U, tool: string, args: Record<string, unknown>): Promise<{ messageId: string; actionId: string }> {
  const conv = await prisma.aiConversation.create({ data: { userId: u.id, title: 'test' } })
  const actionId = Math.random().toString(36).slice(2, 10)
  const m = await prisma.aiMessage.create({ data: { conversationId: conv.id, role: 'ASSISTANT', content: 'Here is a card.', actions: [{ id: actionId, tool, label: tool, summary: 'test', args, state: 'PROPOSED' }] as unknown as Prisma.InputJsonValue } })
  return { messageId: m.id, actionId }
}
const decide = (u: U, c: { messageId: string; actionId: string }, decision: 'confirm' | 'dismiss' = 'confirm') => request(app).post(`/api/metra/messages/${c.messageId}/actions/${c.actionId}`).set(...auth(u)).send({ decision })
const done = async (u: U, tool: string, args: Record<string, unknown>) => (await decide(u, await card(u, tool, args)).expect(200)).body.action as { state: string; result: string }
const setAll = async (on: boolean) => { for (const f of FLAGS) await setCompanyFlag(f, HOME_COMPANY_ID, on, 'test'); resetFlagCache(); forgetAsker() }

beforeAll(async () => {
  w = await seedWorld()
  server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  setAuditBaseUrl(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
  await setCompanyFlag('metra', HOME_COMPANY_ID, true, 'test')
  await setAll(true)
  for (const t of ['SalesDoc', 'ApprovalRule', 'ApprovalRequest']) await prisma.$executeRawUnsafe(`DELETE FROM "${t}"`)
  const project = await prisma.pmProject.create({ data: { name: 'Sales Ops', key: 'SOP', ownerId: w.superAdmin.id } })
  await prisma.pmColumn.create({ data: { projectId: project.id, name: 'To do', category: 'TODO', isDefault: true } })
  await prisma.pmProjectMember.createMany({ data: [{ projectId: project.id, userId: w.itadLead.id, role: 'ADMIN' }, { projectId: project.id, userId: w.itadMember.id, role: 'MEMBER' }] })
}, 120_000)
afterAll(async () => { server.close(); await prisma.$disconnect() })

describe('what Metra offers follows the switches', () => {
  const tools = async (u: U) => { forgetAsker(u.id); return toolSpecs(await askerOf(u.id), true).map((t) => t.function.name).filter((n) => n.startsWith('propose_')) }
  const sets = async (u: U) => { forgetAsker(u.id); return readable(await askerOf(u.id)).map((e) => e.key) }
  const NEW_TOOLS = ['propose_request_send', 'propose_request_decide', 'propose_sales_doc_draft', 'propose_task_time_log']
  const NEW_SETS = ['requests.list', 'requests.waiting', 'requests.rules', 'leave.balance', 'people.records', 'sales.docs', 'projects.time']

  it('off (as for 99 Technologies): none of the new data sets or cards; on: all of them', async () => {
    await setAll(false)
    const offTools = await tools(w.itadMember)
    const offSets = await sets(w.itadLead)
    for (const n of NEW_TOOLS) expect(offTools, n).not.toContain(n)
    for (const k of [...NEW_SETS, 'reports.saved']) expect(offSets, k).not.toContain(k)
    expect(offTools).toContain('propose_meeting_tasks') // tasks from notes use Projects, which everyone has

    await setAll(true)
    expect(await tools(w.itadMember)).toEqual(expect.arrayContaining([...NEW_TOOLS, 'propose_meeting_tasks']))
    expect(await sets(w.itadMember)).toEqual(expect.arrayContaining(NEW_SETS))
    expect(await sets(w.itadMember)).not.toContain('reports.saved') // the report builder is for leads and admins
    expect(await sets(w.itadLead)).toContain('reports.saved')
  })

  it('"decline" and "draft" count as asking for a change; plain questions with "convert" or "turn" do not', () => {
    expect(wantsAction('decline request 4, too expensive')).toBe(true)
    expect(wantsAction('draft a quote for Acme: 2 laptops at 450')).toBe(true)
    expect(wantsAction('make tasks from these meeting notes')).toBe(true)
    expect(wantsAction('how many leads convert to deals, and when did it turn?')).toBe(false)
    expect(wantsAction('how many leaves do I have left?')).toBe(false)
  })
})

describe('cards for requests', () => {
  it('a member sends an expense and a leave request; nothing exists before Confirm', async () => {
    const c = await card(w.itadMember, 'request_send', { kind: 'expense', title: 'Client lunch', amount: 60, currency: 'pkr' })
    expect(await prisma.approvalRequest.count()).toBe(0)
    const r = (await decide(w.itadMember, c).expect(200)).body.action
    expect(r.state).toBe('DONE')
    expect(r.result).toBe('Sent request #1: Expense: Client lunch, PKR 60.00. It now waits on itad lead.')
    await decide(w.itadMember, c).expect(409) // a card is used once

    const leave = await done(w.itadMember, 'request_send', { kind: 'leave', leave_kind: 'sick', start_date: `${YEAR}-12-28`, end_date: `${YEAR}-12-29`, details: 'Fever' })
    expect(leave.result).toBe(`Sent request #2: Sick leave: 2 days (${YEAR}-12-28 to ${YEAR}-12-29). It now waits on itad lead.`)
    // What is missing is said, and nothing is made.
    expect((await done(w.itadMember, 'request_send', { kind: 'expense', title: 'No amount' })).result).toBe('Give the amount.')
    expect((await done(w.itadMember, 'request_send', { kind: 'leave', start_date: `${YEAR}-12-30` })).result).toContain('Say which kind of leave')
    expect(await prisma.approvalRequest.count()).toBe(2)
  })

  it('the lead approves one and declines the other with a reason; only what waits on them', async () => {
    expect((await done(w.itadMember, 'request_decide', { number: 1, decision: 'approve' })).result).toContain('No request #1 is waiting on itad member')
    expect((await done(w.itadLead, 'request_decide', { number: 2, decision: 'decline' })).result).toBe('Say why, so the person knows.')
    expect((await done(w.itadLead, 'request_decide', { number: 9, decision: 'approve' })).result).toContain('Waiting on them: #1 Expense: Client lunch, PKR 60.00; #2 Sick leave')
    expect((await done(w.itadLead, 'request_decide', { number: 1, decision: 'Approve' })).result).toBe('Approved request #1 (Expense: Client lunch, PKR 60.00) from itad member. It is now approved.')
    expect((await done(w.itadLead, 'request_decide', { number: 2, decision: 'decline', note: 'We are short that week' })).result).toContain('Declined request #2')
    const rows = await prisma.approvalRequest.findMany({ orderBy: { number: 'asc' }, select: { status: true } })
    expect(rows.map((x) => x.status)).toEqual(['APPROVED', 'REJECTED'])
    expect(await prisma.leaveDay.count({ where: { userId: w.itadMember.id } })).toBe(0) // declined leave marks no day
  })
})

describe('cards for quotes, time and meeting notes', () => {
  it('a quote is drafted, never sent', async () => {
    const r = await done(w.itadMember, 'sales_doc_draft', { kind: 'quote', customer: 'Acme Ltd', lines: [{ description: 'Laptop', quantity: 2, price: 450 }, { description: 'Setup', price: 100 }], tax_percent: 10 })
    expect(r.result).toBe('Drafted quote Q-0001 for Acme Ltd: 2 lines, total USD 1,100.00. It is a draft and has not been sent: open Quotes and invoices to check and send it.')
    const d = await prisma.salesDoc.findFirstOrThrow({ include: { lines: true } })
    expect(d).toMatchObject({ status: 'DRAFT', kind: 'QUOTE', createdById: w.itadMember.id })
    expect(d.lines).toHaveLength(2)
    expect((await done(w.itadMember, 'sales_doc_draft', { kind: 'invoice', customer: 'Acme Ltd', lines: [] })).result).toContain('at least one line')
  })

  it('meeting notes become tasks with one confirmation; one unknown name makes none', async () => {
    const before = await prisma.pmTask.count()
    const bad = await done(w.itadLead, 'meeting_tasks', { project: 'sales ops', tasks: [{ title: 'Send the price list', assignee: 'itad member' }, { title: 'Book the venue', assignee: 'Nobody Known' }] })
    expect(bad.result).toContain('Task "Book the venue": No project member is called "Nobody Known"')
    expect(await prisma.pmTask.count()).toBe(before)

    const ok = await done(w.itadLead, 'meeting_tasks', { project: 'SOP', source: 'Weekly sales meeting', tasks: [{ title: 'Send the price list', assignee: 'itad member', due_date: `${YEAR}-12-20`, details: 'To the three new accounts' }, { title: 'Book the venue' }] })
    expect(ok.result).toBe('Made 2 tasks in Sales Ops: SOP-1 Send the price list (itad member); SOP-2 Book the venue.')
    const made = await prisma.pmTask.findMany({ where: { code: { in: ['SOP-1', 'SOP-2'] } }, orderBy: { code: 'asc' }, include: { assignees: true } })
    expect(made[0]).toMatchObject({ title: 'Send the price list', description: 'To the three new accounts\n\nFrom: Weekly sales meeting', createdById: w.itadLead.id })
    expect(made[0].assignees.map((x) => x.userId)).toEqual([w.itadMember.id])
    expect(made[0].dueAt).not.toBeNull()
    expect(made[1].assignees).toEqual([])
    // Someone who is not in the project cannot put tasks in it.
    expect((await done(w.leadgenMember, 'meeting_tasks', { project: 'Sales Ops', tasks: [{ title: 'x' }] })).result).toContain('No project is called "Sales Ops"')
  })

  it('time is logged on a task by its code', async () => {
    expect((await done(w.itadMember, 'task_time_log', { task: 'sop-1', minutes: 90, note: 'Calls' })).result).toBe('Logged 90 minutes on SOP-1. The task now has 1 h 30 min in all.')
    expect((await done(w.itadMember, 'task_time_log', { task: 'the price list one', minutes: 30 })).result).toContain("Give the task's code")
    expect((await done(w.leadgenMember, 'task_time_log', { task: 'SOP-1', minutes: 30 })).result).toContain('not found')
    expect(await prisma.pmTimeEntry.count()).toBe(1)
  })
})

describe('fair use: AI is included, with a limit per person per day', () => {
  it('a person who reached the limit of the day is told so, and nothing is asked of the model', async () => {
    const O = 'fair-use-co'
    await prisma.company.deleteMany({ where: { id: O } })
    await prisma.company.create({ data: { id: O, name: 'Fair Use Co', slug: O, status: 'ACTIVE', plan: 'starter', timeZone: 'UTC' } })
    await setCompanyFlag('metra', O, true, 'test')
    resetFlagCache()
    const u = await prisma.user.create({ data: { companyId: O, name: 'Busy Asker', email: 'busy@fairuse.local.test', role: 'SUPER_ADMIN', status: 'ACTIVE', isActive: true } })
    const conv = await prisma.aiConversation.create({ data: { companyId: O, userId: u.id, title: 'today' } })
    process.env.METRA_DAILY_QUESTIONS = '2'
    try {
      await prisma.aiMessage.createMany({ data: [1, 2].map((n) => ({ companyId: O, conversationId: conv.id, role: 'USER' as const, content: `question ${n}` })) })
      const r = await request(app).post('/api/metra/chat').set(...auth({ id: u.id, role: u.role })).send({ message: 'one more?' }).expect(429)
      expect(r.body).toMatchObject({ code: 'FAIR_USE', error: 'You have asked Metra 2 questions today, which is the most one person can ask in a day. It opens again tomorrow.' })
      expect(await prisma.aiMessage.count({ where: { conversationId: conv.id } })).toBe(2) // the refused question is not kept
    } finally {
      delete process.env.METRA_DAILY_QUESTIONS
      await prisma.company.delete({ where: { id: O } })
    }
  })
})
