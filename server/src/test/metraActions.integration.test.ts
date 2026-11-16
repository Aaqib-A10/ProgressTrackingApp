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
import { wantsAction } from '../lib/metra/talk'

// Metra's actions (docs/metra/ROADMAP.md phase 4): a change is only ever a card. Nothing is written until the person
// presses Confirm; then exactly what the card says is done, as that person, through the app's own route.

type U = { id: string; role: Role }
let w: SeededWorld
let server: Server
let ecLead: U, ecMember: U
let itemId = ''

/** A Metra answer of this person holding one proposed card, as the chat would have saved it. */
async function card(u: U, tool: string, args: Record<string, unknown>): Promise<{ messageId: string; actionId: string }> {
  const conv = await prisma.aiConversation.create({ data: { userId: u.id, title: 'test' } })
  const actionId = Math.random().toString(36).slice(2, 10)
  const m = await prisma.aiMessage.create({ data: { conversationId: conv.id, role: 'ASSISTANT', content: 'Here is a card.', actions: [{ id: actionId, tool, label: tool, summary: 'test', args, state: 'PROPOSED' }] as unknown as Prisma.InputJsonValue } })
  return { messageId: m.id, actionId }
}
const decide = (u: U, c: { messageId: string; actionId: string }, decision: 'confirm' | 'dismiss') => request(app).post(`/api/metra/messages/${c.messageId}/actions/${c.actionId}`).set(...auth(u)).send({ decision })

beforeAll(async () => {
  w = await seedWorld()
  server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  setAuditBaseUrl(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
  await setCompanyFlag('metra', HOME_COMPANY_ID, true, 'test')
  resetFlagCache()
  const ec = await prisma.department.create({ data: { type: 'ECOMMERCE', name: 'E-commerce' } })
  const inventory = await prisma.department.findFirstOrThrow({ where: { type: 'INVENTORY', companyId: HOME_COMPANY_ID } })
  const person = async (name: string, role: Role, departmentId: string): Promise<U> => { const u = await prisma.user.create({ data: { name, email: `${name.replace(/\s+/g, '.').toLowerCase()}@actions.local.test`, role, status: 'ACTIVE', isActive: true, passwordHash: 'x', departmentId } }); return { id: u.id, role: u.role } }
  ecLead = await person('Ec Lead', 'TEAM_LEAD', ec.id)
  ecMember = await person('Ec Member', 'MEMBER', ec.id)
  itemId = (await prisma.inventoryItem.create({ data: { departmentId: inventory.id, name: 'Dell OptiPlex 7060 SFF', category: 'Desktop Models', quantity: 14, lowStockAt: 5 } })).id
  await prisma.inventoryItem.create({ data: { departmentId: inventory.id, name: 'Dell OptiPlex 7070 Tower', category: 'Desktop Models', quantity: 3, lowStockAt: 5 } })
}, 120_000)

afterAll(async () => { server.close(); await prisma.$disconnect() })

describe('a change is a card: nothing is written before Confirm', () => {
  it('inventory: the request is made on Confirm, with the item, direction, quantity and note of the card, and stock does not change', async () => {
    const c = await card(w.inventoryMember, 'inventory_request', { item: 'dell optiplex 7060 sff', direction: 'out', quantity: 2, requested_by: 'Sales desk', note: 'For the Karachi order.' })
    expect(await prisma.inventoryMovement.count()).toBe(0)
    const r = await decide(w.inventoryMember, c, 'confirm').expect(200)
    expect(r.body.action.state).toBe('DONE')
    expect(r.body.action.result).toContain('Logged a stock out request for 2 x Dell OptiPlex 7060 SFF')
    const made = await prisma.inventoryMovement.findMany()
    expect(made).toHaveLength(1)
    expect(made[0]).toMatchObject({ itemId, type: 'STOCK_OUT', quantity: 2, status: 'REQUESTED', requestedByName: 'Sales desk', note: 'For the Karachi order.' })
    expect((await prisma.inventoryItem.findUniqueOrThrow({ where: { id: itemId } })).quantity).toBe(14)
    // The same card cannot be used twice.
    await decide(w.inventoryMember, c, 'confirm').expect(409)
    expect(await prisma.inventoryMovement.count()).toBe(1)
  })

  it('a name that fits two items is not guessed: the card fails and nothing is written', async () => {
    const c = await card(w.inventoryMember, 'inventory_request', { item: 'optiplex', direction: 'in', quantity: 5 })
    const r = await decide(w.inventoryMember, c, 'confirm').expect(200)
    expect(r.body.action.state).toBe('FAILED')
    expect(r.body.action.result).toContain('fits 2 items')
    expect(await prisma.inventoryMovement.count()).toBe(1)
  })

  it('a dismissed card does nothing', async () => {
    const c = await card(w.inventoryMember, 'inventory_request', { item: 'Dell OptiPlex 7070 Tower', direction: 'in', quantity: 9 })
    expect((await decide(w.inventoryMember, c, 'dismiss').expect(200)).body.action.state).toBe('DISMISSED')
    expect(await prisma.inventoryMovement.count()).toBe(1)
  })

  it("another person cannot confirm someone's card", async () => {
    const c = await card(w.inventoryMember, 'inventory_request', { item: 'Dell OptiPlex 7070 Tower', direction: 'in', quantity: 9 })
    await decide(w.itadMember, c, 'confirm').expect(404)
    await decide(w.superAdmin, c, 'confirm').expect(404)
    expect(await prisma.inventoryMovement.count()).toBe(1)
  })

  it('a card for a screen the person cannot open fails at the app, and nothing is written', async () => {
    const c = await card(w.itadMember, 'inventory_request', { item: 'Dell OptiPlex 7060 SFF', direction: 'out', quantity: 1 })
    expect((await decide(w.itadMember, c, 'confirm').expect(200)).body.action.state).toBe('FAILED')
    const n = await card(w.itadMember, 'ecommerce_meeting_note', { title: 'Sneaky', notes: 'Should not be saved.' })
    expect((await decide(w.itadMember, n, 'confirm').expect(200)).body.action.state).toBe('FAILED')
    const l = await card(ecMember, 'leave_add', { person: 'Ec Lead', date: '2026-12-01' })
    expect((await decide(ecMember, l, 'confirm').expect(200)).body.action.state).toBe('FAILED')
    expect(await prisma.inventoryMovement.count()).toBe(1)
    expect(await prisma.meetingNote.count()).toBe(0)
    expect(await prisma.leaveDay.count({ where: { userId: ecLead.id } })).toBe(0)
  })

  it('e-commerce: a stock problem, meeting notes and a board task are saved as written', async () => {
    const s = await card(ecMember, 'ecommerce_stock_log', { item: 'HP EliteDesk 800 G4', direction: 'out', quantity: 6, note: 'Pull it from Amazon and Walmart.' })
    expect((await decide(ecMember, s, 'confirm').expect(200)).body.action.state).toBe('DONE')
    expect(await prisma.stockRequest.findFirstOrThrow({ where: { itemName: 'HP EliteDesk 800 G4' } })).toMatchObject({ action: 'STOCK_OUT', quantity: 6, status: 'REQUESTED', requestedByName: 'Ec Member', note: 'Pull it from Amazon and Walmart.' })

    const n = await card(ecMember, 'ecommerce_meeting_note', { title: 'Weekly sync', notes: 'Pause the Walmart repricer until Friday.', meeting_date: '2026-11-13', deadline: '2026-11-20' })
    expect((await decide(ecMember, n, 'confirm').expect(200)).body.action.state).toBe('DONE')
    const note = await prisma.meetingNote.findFirstOrThrow({ where: { title: 'Weekly sync' } })
    expect(note.body).toBe('Pause the Walmart repricer until Friday.')
    expect(note.authorId).toBe(ecMember.id)
    expect(note.deadline?.toISOString().slice(0, 10)).toBe('2026-11-20')

    // Adding a board task is the team lead's: a member's card fails, the lead's is done and given to the person named.
    const refused = await card(ecMember, 'ecommerce_task_add', { title: 'Member tries', assignee: 'Ec Member' })
    expect((await decide(ecMember, refused, 'confirm').expect(200)).body.action.state).toBe('FAILED')
    const t = await card(ecLead, 'ecommerce_task_add', { title: 'Upload the Walmart bulk file', assignee: 'ec member', due_date: '2026-11-18' })
    expect((await decide(ecLead, t, 'confirm').expect(200)).body.action.state).toBe('DONE')
    expect(await prisma.ecommerceTask.count({ where: { title: 'Member tries' } })).toBe(0)
    expect(await prisma.ecommerceTask.findFirstOrThrow({ where: { title: 'Upload the Walmart bulk file' } })).toMatchObject({ assignedToId: ecMember.id, status: 'TODO' })
  })

  it('a team lead enters leave for a person of their team; a work-from-home request is the person\'s own', async () => {
    const l = await card(w.itadLead, 'leave_add', { person: 'itad member', date: '2026-12-03', kind: 'work from home', note: 'Plumber' })
    expect((await decide(w.itadLead, l, 'confirm').expect(200)).body.action.state).toBe('DONE')
    expect(await prisma.leaveDay.findFirstOrThrow({ where: { userId: w.itadMember.id } })).toMatchObject({ type: 'WFH', note: 'Plumber' })
    const far = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10)
    const q = await card(w.itadMember, 'wfh_request', { start_date: far, reason: 'Internet engineer is coming' })
    const r = await decide(w.itadMember, q, 'confirm').expect(200)
    expect(r.body.action.state).toBe('DONE')
    expect(await prisma.wfhRequest.count({ where: { userId: w.itadMember.id } })).toBe(1)
  })
})

describe('"Your day" brief', () => {
  type Insight = { kind: string; title: string; payload: { text: string } }
  const briefs = async (u: U) => ((await request(app).get('/api/metra/insights').set(...auth(u)).expect(200)).body.insights as Insight[]).filter((i) => i.kind === 'BRIEF')

  it("is made from the person's own data sets the first time they open Metra that day, and only once", async () => {
    const [b] = await briefs(w.inventoryMember)
    expect(b.title).toBe('Your day')
    expect(b.payload.text).toContain('Hello inventory.')
    expect(b.payload.text).toContain('- Stock list: 0 out of stock, 1 low.')
    expect(b.payload.text).toContain('- Stock requests: 1 open, 1 with nobody on it.')
    expect(await briefs(w.inventoryMember)).toHaveLength(1)
    expect(await prisma.aiInsight.count({ where: { userId: w.inventoryMember.id, kind: 'BRIEF' } })).toBe(1)
  })

  it('says nothing about another team, and a person with nothing today gets no brief', async () => {
    const [b] = await briefs(ecMember)
    expect(b.payload.text).toContain('Stock tracking: 1 not resolved')
    expect(b.payload.text).not.toContain('Stock list:')
    expect(await briefs(w.leadgenMember)).toEqual([])
  })
})

describe('which actions a person is offered', () => {
  const names = async (u: U, actions: boolean) => { forgetAsker(u.id); return toolSpecs(await askerOf(u.id), actions).map((t) => t.function.name).filter((n) => n.startsWith('propose_')) }

  it('only the actions of the screens they have; for a plain question only the everyday ones (a to-do, a meeting)', async () => {
    // A plain question: the everyday cards as before (a to-do, a meeting, a lead for those with Lead Management), and
    // none of the cards for tickets or for a team's own screens.
    const plain = await names(w.inventoryMember, false)
    expect(plain).toEqual(expect.arrayContaining(['propose_meeting_schedule', 'propose_todo_add', 'propose_todo_update']))
    for (const n of plain) expect(['propose_meeting_schedule', 'propose_todo_add', 'propose_todo_update', 'propose_lead_update'], n).toContain(n)
    const inv = await names(w.inventoryMember, true)
    expect(inv).toEqual(expect.arrayContaining(['propose_inventory_request', 'propose_wfh_request', 'propose_todo_add', 'propose_add_comment']))
    for (const n of ['propose_ecommerce_stock_log', 'propose_ecommerce_meeting_note', 'propose_ecommerce_task_add', 'propose_leave_add', 'propose_dialer_update_lead']) expect(inv, n).not.toContain(n)
    const member = await names(ecMember, true)
    expect(member).toEqual(expect.arrayContaining(['propose_ecommerce_stock_log', 'propose_ecommerce_meeting_note']))
    expect(member).not.toContain('propose_ecommerce_task_add')
    expect(member).not.toContain('propose_inventory_request')
    expect(await names(ecLead, true)).toEqual(expect.arrayContaining(['propose_ecommerce_task_add', 'propose_leave_add']))
    expect(await names(w.itadMember, true)).toEqual(expect.arrayContaining(['propose_dialer_update_lead']))
  })

  it('a message that asks for a change gets the cards; a question does not', () => {
    for (const q of ['log a stock out request for 2 optiplex', 'add a to-do for tomorrow', 'schedule a meeting with Ali at 3', 'please mark it done', 'meeting ke notes save kar do', 'kal ke liye wfh request bhej do', 'move MCHK-2 to in review']) expect(wantsAction(q), q).toBe(true)
    for (const q of ['how many items are low in stock?', 'who is late today', 'what was decided in the last meeting?', 'kitne items ka stock khatam hai', 'which leads were added this month']) expect(wantsAction(q), q).toBe(false)
    expect(wantsAction('yes', [{ role: 'assistant', content: 'Shall I add it to your to-dos?' }])).toBe(true)
    expect(wantsAction('yes')).toBe(false)
  })
})
