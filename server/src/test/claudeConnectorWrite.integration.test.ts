import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'

// Claude's Metriq connector, write side: create, edit and delete tickets, add checklist items,
// and list a whole project, its members and its columns. Every write goes through the same
// handlers as the web app, so the rules, codes, activity log and notifications are the same.
//
// Project OPS: itadLead = ADMIN, itadMember = MEMBER, leadgenMember = MEMBER,
// inventoryMember = VIEWER. leadgenLead is not a member.

let w: SeededWorld
type U = SeededWorld['itadMember']
const urls = new Map<string, string>()

async function keyFor(u: U): Promise<string> {
  if (!urls.has(u.id)) {
    const r = await request(app).post('/api/claude/keys').set(...auth(u)).send({ name: 'test' }).expect(201)
    urls.set(u.id, new URL(r.body.connectorUrl).pathname)
  }
  return urls.get(u.id)!
}
async function call(u: U, name: string, args: object) {
  const r = await request(app).post(await keyFor(u)).send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }).expect(200)
  const res = r.body.result as { content: { type: string; text?: string }[]; isError?: boolean }
  return { isError: !!res.isError, text: res.content.map((c) => c.text ?? '').join('\n') }
}
const task = (code: string) => prisma.pmTask.findFirstOrThrow({ where: { code }, include: { column: true, assignees: true, checklist: true } })
const acts = async (code: string) => (await prisma.pmActivity.findMany({ where: { task: { code } }, orderBy: { createdAt: 'asc' } })).map((a) => a.action)

beforeAll(async () => {
  w = await seedWorld()
  await request(app).post('/api/projects').set(...auth(w.superAdmin)).send({
    name: 'Operations', key: 'OPS',
    members: [
      { userId: w.itadLead.id, role: 'ADMIN' },
      { userId: w.itadMember.id, role: 'MEMBER' },
      { userId: w.leadgenMember.id, role: 'MEMBER' },
      { userId: w.inventoryMember.id, role: 'VIEWER' },
    ],
  }).expect(201)
})
afterAll(async () => { await prisma.$disconnect() })

describe('reading a project', () => {
  it('lists the board columns in order and the members with email, role and id', async () => {
    const cols = await call(w.itadMember, 'list_board_columns', { project: 'ops' })
    expect(cols.text).toContain('1. Backlog')
    expect(cols.text).toMatch(/2\. To Do \(new tickets start here\)/)
    expect(cols.text).toContain('6. Done (finished)')
    const m = await call(w.itadMember, 'list_project_members', { project: 'Operations' })
    expect(m.text).toContain('5 members of OPS') // the four added plus the Super Admin who made it
    expect(m.text).toContain(`itad member (you) |`)
    expect(m.text).toContain(w.leadgenMember.id)
    expect(m.text).toContain('viewer (cannot be given tickets to work on)')
  })

  it('an unknown project, or one the person is not in, is a plain error', async () => {
    const r = await call(w.itadMember, 'list_board_columns', { project: 'NOPE' })
    expect(r.isError).toBe(true)
    expect(r.text).toContain('No project "NOPE" that you can see. Your projects: OPS (Operations)')
    expect((await call(w.leadgenLead, 'list_project_members', { project: 'OPS' })).text).toContain('No project "OPS"')
  })
})

describe('create_ticket', () => {
  it('without an assignee: next code, first column, given by the person, logged, nobody notified', async () => {
    const before = await prisma.notification.count({ where: { type: 'TASK_ASSIGNED' } })
    const r = await call(w.itadMember, 'create_ticket', { project: 'OPS', title: 'Order new label printer ribbons' })
    expect(r.isError).toBe(false)
    expect(r.text).toContain('Created OPS-1: Order new label printer ribbons')
    expect(r.text).toContain('Status: To Do')
    expect(r.text).toContain('Assigned to: nobody yet  |  Given by: itad member')
    expect(r.text).toContain('/app/projects/OPS?task=OPS-1')
    const t = await task('OPS-1')
    expect(t.createdById).toBe(w.itadMember.id)
    expect(t.priority).toBe('MEDIUM')
    expect(t.assignees).toHaveLength(0)
    expect(await acts('OPS-1')).toEqual(['created'])
    expect(await prisma.notification.count({ where: { type: 'TASK_ASSIGNED' } })).toBe(before)
  })

  it('with an assignee, due date, priority, column and checklist: the assignee is notified like the web app', async () => {
    const r = await call(w.itadMember, 'create_ticket', {
      project: 'OPS', title: 'Call Microcad about the bid', description: '**Ask** for the pickup date.', assignee: 'leadgen member',
      due_date: '2026-10-30', priority: 'high', status: 'in progress', checklist: ['Find the contact', 'Call', ' '],
    })
    expect(r.isError).toBe(false)
    expect(r.text).toContain('Created OPS-2')
    expect(r.text).toContain('Assigned to: leadgen member')
    expect(r.text).toContain('Due: Fri, Oct 30, 2026, 11:59 PM PKT')
    const t = await task('OPS-2')
    expect(t.column.name).toBe('In Progress')
    expect(t.priority).toBe('HIGH')
    expect(t.description).toBe('**Ask** for the pickup date.')
    expect(t.dueAt?.toISOString()).toBe('2026-10-30T18:59:00.000Z') // 11:59 PM in Pakistan, like the app's picker
    expect(t.assignees.map((a) => a.userId)).toEqual([w.leadgenMember.id])
    expect(t.checklist.map((c) => c.text).sort()).toEqual(['Call', 'Find the contact'])
    expect(await acts('OPS-2')).toEqual(['created', 'assigned'])
    const n = await prisma.notification.findFirstOrThrow({ where: { userId: w.leadgenMember.id, type: 'TASK_ASSIGNED' } })
    expect(n.title).toBe('itad member assigned you OPS-2')
    expect(n.actorId).toBe(w.itadMember.id)
  })

  it('"me" assigns it to the person; it then shows in list_my_tickets', async () => {
    expect((await call(w.itadMember, 'create_ticket', { project: 'OPS', title: 'Update the bid tracker', assignee: 'me' })).text).toContain('Created OPS-3')
    expect((await call(w.itadMember, 'list_my_tickets', {})).text).toContain('OPS-3 | To Do | medium | Update the bid tracker | from itad member')
  })

  it('an ambiguous name returns the candidates and creates nothing', async () => {
    const count = await prisma.pmTask.count()
    const r = await call(w.itadMember, 'create_ticket', { project: 'OPS', title: 'x', assignee: 'itad' })
    expect(r.isError).toBe(true)
    expect(r.text).toContain('"itad" matches more than one person in OPS')
    expect(r.text).toContain('itad lead (')
    expect(r.text).toContain('itad member (')
    expect(await prisma.pmTask.count()).toBe(count)
  })

  it('a person outside the project, a column that does not exist, a bad date or priority: plain errors, nothing created', async () => {
    const count = await prisma.pmTask.count()
    const out = await call(w.itadMember, 'create_ticket', { project: 'OPS', title: 'x', assignee: 'leadgen lead' })
    expect(out.text).toContain('"leadgen lead" is not a member of OPS')
    const col = await call(w.itadMember, 'create_ticket', { project: 'OPS', title: 'x', status: 'Waiting for client' })
    expect(col.text).toBe('No column "Waiting for client" on OPS. Columns: Backlog, To Do, In Progress, In Review, Blocked, Done.')
    expect((await call(w.itadMember, 'create_ticket', { project: 'OPS', title: 'x', due_date: '30/10/2026' })).text).toContain('is not a date. Use YYYY-MM-DD')
    expect((await call(w.itadMember, 'create_ticket', { project: 'OPS', title: 'x', due_date: '2026-02-30' })).text).toContain('is not a real date')
    expect((await call(w.itadMember, 'create_ticket', { project: 'OPS', title: 'x', priority: 'asap' })).text).toContain('Priority must be low, medium, high or urgent')
    expect((await call(w.itadMember, 'create_ticket', { project: 'OPS', title: '  ' })).text).toBe('Give the ticket a title.')
    expect(await prisma.pmTask.count()).toBe(count)
  })

  it('a viewer cannot create tickets, same as the web app', async () => {
    const r = await call(w.inventoryMember, 'create_ticket', { project: 'OPS', title: 'x' })
    expect(r.isError).toBe(true)
    expect(r.text).toBe('Viewers cannot create tasks')
  })
})

describe('update_ticket', () => {
  it('changes only the fields passed, logs each change and notifies the new assignee', async () => {
    const r = await call(w.itadMember, 'update_ticket', { code: 'ops-2', title: 'Call Microcad about bid 26-017', priority: 'urgent', assignee: 'lead@test', due_date: '2026-11-02 17:00' })
    // "lead@test" is not an email of anyone: plain error, nothing changed
    expect(r.text).toContain('"lead@test" is not a member of OPS')
    expect((await task('OPS-2')).title).toBe('Call Microcad about the bid')

    const leadEmail = (await prisma.user.findUniqueOrThrow({ where: { id: w.itadLead.id } })).email
    const ok = await call(w.itadMember, 'update_ticket', { code: 'ops-2', title: 'Call Microcad about bid 26-017', priority: 'urgent', assignee: leadEmail, due_date: '2026-11-02 17:00' })
    expect(ok.isError).toBe(false)
    expect(ok.text).toContain('OPS-2 updated: title, priority to urgent, due date to Mon, Nov 2, 2026, 5:00 PM PKT, assigned to itad lead.')
    const t = await task('OPS-2')
    expect(t.title).toBe('Call Microcad about bid 26-017')
    expect(t.description).toBe('**Ask** for the pickup date.') // untouched
    expect(t.priority).toBe('URGENT')
    expect(t.dueAt?.toISOString()).toBe('2026-11-02T12:00:00.000Z')
    expect(t.assignees.map((a) => a.userId)).toEqual([w.itadLead.id])
    expect(await acts('OPS-2')).toEqual(expect.arrayContaining(['title_changed', 'priority_changed', 'due_changed', 'assigned', 'unassigned']))
    expect(await prisma.notification.count({ where: { userId: w.itadLead.id, type: 'TASK_ASSIGNED', title: 'itad member assigned you OPS-2' } })).toBe(1)
    expect(await prisma.notification.count({ where: { userId: w.leadgenMember.id, type: 'TASK_UNASSIGNED' } })).toBe(1)
  })

  it('same edit rules as the web app: an outsider to the ticket cannot edit; only the creator or an admin moves the due date', async () => {
    const no = await call(w.leadgenMember, 'update_ticket', { code: 'OPS-2', title: 'hijack' })
    expect(no.text).toBe('You can only edit tasks you created or are assigned to')
    // itad lead is now an assignee (and admin) of OPS-2: can edit. leadgen member is assigned OPS-4 but did not create it:
    await call(w.itadMember, 'create_ticket', { project: 'OPS', title: 'Clean the CRM export', assignee: 'leadgen member', due_date: '2026-11-05' })
    expect((await call(w.leadgenMember, 'update_ticket', { code: 'OPS-4', description: 'Remove duplicates first' })).isError).toBe(false)
    expect((await call(w.leadgenMember, 'update_ticket', { code: 'OPS-4', due_date: '2026-12-01' })).text).toBe('Only the person who assigned this task or a project admin can change the due date')
    expect((await task('OPS-4')).dueAt?.toISOString()).toBe('2026-11-05T18:59:00.000Z')
    expect((await call(w.itadMember, 'update_ticket', { code: 'OPS-4', due_date: 'none' })).text).toContain('due date removed')
    expect((await task('OPS-4')).dueAt).toBeNull()
    expect((await call(w.itadMember, 'update_ticket', { code: 'OPS-4' })).text).toContain('Nothing to change')
  })
})

describe('list_project_tickets', () => {
  it('every ticket in the project, filtered by column or assignee; done ones only when asked', async () => {
    const all = await call(w.leadgenMember, 'list_project_tickets', { project: 'OPS' })
    for (const c of ['OPS-1', 'OPS-2', 'OPS-3', 'OPS-4']) expect(all.text).toContain(`${c} |`)
    expect(all.text).toContain('OPS-2 | In Progress | urgent | due Mon, Nov 2, 2026, 5:00 PM PKT | Call Microcad about bid 26-017 | to itad lead, from itad member')
    expect((await call(w.leadgenMember, 'list_project_tickets', { project: 'OPS', status: 'In Progress' })).text).toMatch(/^1 ticket in OPS/)
    const mine = await call(w.leadgenMember, 'list_project_tickets', { project: 'OPS', assignee: 'me' })
    expect(mine.text).toContain('OPS-4')
    expect(mine.text).not.toContain('OPS-2')
    expect((await call(w.leadgenMember, 'list_project_tickets', { project: 'OPS', assignee: 'unassigned' })).text).toContain('OPS-1')
    expect((await call(w.leadgenMember, 'list_project_tickets', { project: 'OPS', status: 'Somewhere' })).isError).toBe(true)

    await call(w.itadMember, 'move_ticket', { code: 'OPS-1', status: 'Done' })
    expect((await call(w.leadgenMember, 'list_project_tickets', { project: 'OPS' })).text).not.toContain('OPS-1 |')
    expect((await call(w.leadgenMember, 'list_project_tickets', { project: 'OPS', include_done: true })).text).toContain('OPS-1 | Done')
  })
})

describe('add_checklist_item', () => {
  it('adds to the end of the checklist; a viewer cannot', async () => {
    expect((await call(w.itadMember, 'add_checklist_item', { code: 'OPS-2', text: 'Send the quote after the call' })).text).toBe('Added "Send the quote after the call" to the checklist of OPS-2.')
    const items = (await task('OPS-2')).checklist.sort((a, b) => a.position - b.position).map((c) => c.text)
    expect(items[items.length - 1]).toBe('Send the quote after the call')
    const v = await call(w.inventoryMember, 'add_checklist_item', { code: 'OPS-2', text: 'x' })
    expect(v.isError).toBe(true)
    expect(v.text).toContain('You cannot change OPS-2')
  })
})

describe('delete_ticket', () => {
  it('only the creator can delete (not even a project admin); it is a soft delete', async () => {
    const admin = await call(w.itadLead, 'delete_ticket', { code: 'OPS-3' })
    expect(admin.isError).toBe(true)
    expect(admin.text).toBe('You cannot delete OPS-3: only the person who created it (itad member) can delete it.')
    expect((await task('OPS-3')).deletedAt).toBeNull()

    const ok = await call(w.itadMember, 'delete_ticket', { code: 'OPS-3' })
    expect(ok.text).toBe('OPS-3 "Update the bid tracker" deleted.')
    const row = await task('OPS-3')
    expect(row.deletedAt).not.toBeNull() // kept in the database, hidden everywhere
    expect(await acts('OPS-3')).toContain('deleted')
    expect((await call(w.itadMember, 'get_ticket', { code: 'OPS-3' })).isError).toBe(true)
    expect((await call(w.itadMember, 'list_project_tickets', { project: 'OPS' })).text).not.toContain('OPS-3 |')
  })

  it('the tool list has the old tools unchanged plus the new ones', async () => {
    const r = await request(app).post(await keyFor(w.itadMember)).send({ jsonrpc: '2.0', id: 1, method: 'tools/list' }).expect(200)
    expect(r.body.result.tools.map((t: { name: string }) => t.name)).toEqual([
      'list_my_tickets', 'get_ticket', 'list_projects', 'add_comment', 'move_ticket', 'update_checklist_item', 'read_attachment',
      'list_board_columns', 'list_project_members', 'list_project_tickets', 'create_ticket', 'update_ticket', 'add_checklist_item', 'delete_ticket',
      'metriq_guide', 'metriq_read', 'dialer_summary', 'dialer_leads', 'dialer_lead', 'dialer_update_lead',
    ])
  })
})
