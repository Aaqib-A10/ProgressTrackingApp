import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app, prisma, auth, seedWorld, type SeededWorld } from './helpers'
import { runDeadlineTick, isQuietHours } from '../lib/pm/deadlines'
import { resetPresence } from '../lib/pm/presence'

// End-to-end coverage for Projects + Chat: membership visibility, project roles,
// task codes, drag and drop ordering, completion, the deadline watcher
// (recipients, idempotency, quiet hours, re-arming) and chat privacy.
//
// Roles used:  superAdmin (global)  ·  itadLead = project ADMIN  ·  itadMember = MEMBER
//              inventoryMember = VIEWER  ·  leadgenLead = not a member

let w: SeededWorld
let board: { columns: { id: string; name: string; category: string }[] }
const col = (name: string) => board.columns.find((c) => c.name === name)!.id

beforeAll(async () => {
  w = await seedWorld()
  resetPresence()
  process.env.PM_SUPER_ADMIN_OVERDUE_ALERTS = 'true'
})
afterAll(async () => {
  await prisma.$disconnect()
})

describe('projects: creation + visibility', () => {
  it('only a Super Admin can create a project', async () => {
    await request(app).post('/api/projects').set(...auth(w.itadLead)).send({ name: 'Nope', key: 'NOPE' }).expect(403)
  })

  it('Super Admin creates RTI with members and roles', async () => {
    const res = await request(app).post('/api/projects').set(...auth(w.superAdmin)).send({
      name: 'RTI',
      key: 'rti',
      members: [
        { userId: w.itadLead.id, role: 'ADMIN' },
        { userId: w.itadMember.id, role: 'MEMBER' },
        { userId: w.inventoryMember.id, role: 'VIEWER' },
      ],
    }).expect(201)
    expect(res.body.project.key).toBe('RTI')
    const b = await request(app).get('/api/projects/RTI/board').set(...auth(w.itadMember)).expect(200)
    board = b.body
    expect(board.columns.map((c) => c.name)).toEqual(['Backlog', 'To Do', 'In Progress', 'In Review', 'Blocked', 'Done'])
  })

  it('rejects a duplicate key', async () => {
    await request(app).post('/api/projects').set(...auth(w.superAdmin)).send({ name: 'RTI 2', key: 'RTI' }).expect(409)
  })

  it('a non member cannot see the project anywhere (404, not 403)', async () => {
    const list = await request(app).get('/api/projects').set(...auth(w.leadgenLead)).expect(200)
    expect(list.body.projects).toHaveLength(0)
    await request(app).get('/api/projects/RTI').set(...auth(w.leadgenLead)).expect(404)
    await request(app).get('/api/projects/RTI/board').set(...auth(w.leadgenLead)).expect(404)
  })

  it('members and the Super Admin see it', async () => {
    const a = await request(app).get('/api/projects').set(...auth(w.itadMember)).expect(200)
    expect(a.body.projects.map((p: { key: string }) => p.key)).toEqual(['RTI'])
    const s = await request(app).get('/api/projects').set(...auth(w.superAdmin)).expect(200)
    expect(s.body.projects).toHaveLength(1)
  })

  it('unauthenticated requests are rejected', async () => {
    await request(app).get('/api/projects').expect(401)
    await request(app).get('/api/chat/conversations').expect(401)
  })
})

describe('tasks: create, permissions, codes', () => {
  let code: string

  it('a member creates RTI-1 assigned to another member and they are notified', async () => {
    const res = await request(app).post('/api/projects/RTI/tasks').set(...auth(w.itadMember))
      .send({ title: 'Update case study page', assigneeIds: [w.itadLead.id], priority: 'HIGH', dueAt: new Date(Date.now() + 3 * 86400000).toISOString() })
      .expect(201)
    code = res.body.task.code
    expect(code).toBe('RTI-1')
    expect(res.body.task.assignees.map((a: { id: string }) => a.id)).toEqual([w.itadLead.id])
    const n = await prisma.notification.findMany({ where: { userId: w.itadLead.id, type: 'TASK_ASSIGNED' } })
    expect(n).toHaveLength(1)
    expect(n[0].link).toBe('/app/projects/RTI?task=RTI-1')
  })

  it('cannot assign someone who is not a project member (422)', async () => {
    await request(app).post('/api/projects/RTI/tasks').set(...auth(w.itadMember))
      .send({ title: 'x', assigneeIds: [w.leadgenLead.id] }).expect(422)
  })

  it('a viewer cannot create, edit or move tasks, but can comment', async () => {
    await request(app).post('/api/projects/RTI/tasks').set(...auth(w.inventoryMember)).send({ title: 'x' }).expect(403)
    await request(app).patch(`/api/projects/tasks/${code}`).set(...auth(w.inventoryMember)).send({ title: 'hack' }).expect(403)
    await request(app).patch(`/api/projects/tasks/${code}/move`).set(...auth(w.inventoryMember)).send({ columnId: col('Done') }).expect(403)
    await request(app).post(`/api/projects/tasks/${code}/comments`).set(...auth(w.inventoryMember)).send({ body: 'Looks good' }).expect(201)
  })

  it('a non member gets 404 for the task', async () => {
    await request(app).get(`/api/projects/tasks/${code}`).set(...auth(w.leadgenLead)).expect(404)
  })

  it('only the assigner or a project admin can change the due date', async () => {
    // itadLead is the assignee AND project admin → allowed; make a member-only check with a second task.
    const t = await request(app).post('/api/projects/RTI/tasks').set(...auth(w.itadLead))
      .send({ title: 'Lead task', assigneeIds: [w.itadMember.id], dueAt: new Date(Date.now() + 86400000).toISOString() }).expect(201)
    await request(app).patch(`/api/projects/tasks/${t.body.task.code}`).set(...auth(w.itadMember))
      .send({ dueAt: new Date(Date.now() + 9 * 86400000).toISOString() }).expect(403)
    // ...but the assignee may edit other fields
    await request(app).patch(`/api/projects/tasks/${t.body.task.code}`).set(...auth(w.itadMember)).send({ priority: 'URGENT' }).expect(200)
  })

  it('task codes stay unique under concurrent creates', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => request(app).post('/api/projects/RTI/tasks').set(...auth(w.itadMember)).send({ title: `Parallel ${i}` })),
    )
    const codes = results.map((r) => r.body.task.code)
    expect(results.every((r) => r.status === 201)).toBe(true)
    expect(new Set(codes).size).toBe(8)
  })
})

describe('board: drag and drop', () => {
  let a: string, b: string, c: string

  it('creates three cards in To Do in order', async () => {
    const mk = async (title: string) => (await request(app).post('/api/projects/RTI/tasks').set(...auth(w.itadMember)).send({ title, columnId: col('In Review') }).expect(201)).body.task
    a = (await mk('A')).id
    b = (await mk('B')).id
    c = (await mk('C')).id
  })

  it('moves C between A and B and the order persists', async () => {
    await request(app).patch(`/api/projects/tasks/${c}/move`).set(...auth(w.itadMember))
      .send({ columnId: col('In Review'), beforeTaskId: a, afterTaskId: b }).expect(200)
    const res = await request(app).get('/api/projects/RTI/board').set(...auth(w.itadMember)).expect(200)
    const order = res.body.tasks.filter((t: { columnId: string }) => t.columnId === col('In Review')).map((t: { title: string }) => t.title)
    expect(order).toEqual(['A', 'C', 'B'])
  })

  it('many midpoint moves keep a strict order', async () => {
    for (let i = 0; i < 40; i++) {
      await request(app).patch(`/api/projects/tasks/${c}/move`).set(...auth(w.itadMember)).send({ columnId: col('In Review'), beforeTaskId: a, afterTaskId: b })
      await request(app).patch(`/api/projects/tasks/${b}/move`).set(...auth(w.itadMember)).send({ columnId: col('In Review'), beforeTaskId: a, afterTaskId: c })
    }
    const res = await request(app).get('/api/projects/RTI/board').set(...auth(w.itadMember)).expect(200)
    const cards = res.body.tasks.filter((t: { columnId: string }) => t.columnId === col('In Review'))
    const positions = cards.map((t: { position: number }) => t.position)
    expect(new Set(positions).size).toBe(positions.length)
    expect(cards[0].title).toBe('A')
  })

  it('moving to Done sets completedAt and logs activity; moving back clears it', async () => {
    const done = await request(app).patch(`/api/projects/tasks/${a}/move`).set(...auth(w.itadMember)).send({ columnId: col('Done') }).expect(200)
    expect(done.body.task.completedAt).not.toBeNull()
    const back = await request(app).patch(`/api/projects/tasks/${a}/move`).set(...auth(w.itadMember)).send({ columnId: col('To Do') }).expect(200)
    expect(back.body.task.completedAt).toBeNull()
    const act = await request(app).get(`/api/projects/tasks/${a}/activity`).set(...auth(w.itadMember)).expect(200)
    const actions = act.body.activity.map((x: { action: string }) => x.action)
    expect(actions).toEqual(expect.arrayContaining(['created', 'status_changed', 'completed', 'reopened']))
  })
})

describe('deadline watcher', () => {
  let taskId: string
  let taskCode: string
  // 11:00 in Karachi (UTC+5) → not quiet hours.
  const day = new Date('2030-01-15T06:00:00Z')

  it('flags a newly overdue task and alerts assignee, assigner, project admins and Super Admin exactly once', async () => {
    expect(isQuietHours(day)).toBe(false)
    const t = await request(app).post('/api/projects/RTI/tasks').set(...auth(w.itadMember))
      .send({ title: 'Overdue me', assigneeIds: [w.itadMember.id], dueAt: new Date(day.getTime() - 10 * 60000).toISOString() }).expect(201)
    taskId = t.body.task.id
    taskCode = t.body.task.code
    await prisma.notification.deleteMany({})

    const r1 = await runDeadlineTick(day)
    expect(r1.newlyOverdue).toBeGreaterThanOrEqual(1)
    const notes = await prisma.notification.findMany({ where: { entityId: taskId, type: 'TASK_OVERDUE' } })
    const who = notes.map((n) => n.userId).sort()
    // assignee + creator are the same person (itadMember) → one alert; plus project admin + Super Admin
    expect(who).toEqual([w.itadMember.id, w.itadLead.id, w.superAdmin.id].sort())
    const emails = await prisma.pmDispatchLog.findMany({ where: { taskId, kind: 'overdue_email' } })
    expect(emails).toHaveLength(3)

    const r2 = await runDeadlineTick(day)
    expect(r2.newlyOverdue).toBe(0)
    expect(r2.overdueEmails).toBe(0)
    expect(await prisma.notification.count({ where: { entityId: taskId, type: 'TASK_OVERDUE' } })).toBe(3)
  })

  it('repeats after 24h, then clears when moved to Done', async () => {
    const later = new Date(day.getTime() + 25 * 3600000)
    const r = await runDeadlineTick(later)
    expect(r.repeats).toBeGreaterThanOrEqual(1)
    expect(await prisma.notification.count({ where: { entityId: taskId, type: 'TASK_OVERDUE' } })).toBe(6)
    await request(app).patch(`/api/projects/tasks/${taskCode}/move`).set(...auth(w.itadMember)).send({ columnId: col('Done') }).expect(200)
    const row = await prisma.pmTask.findUniqueOrThrow({ where: { id: taskId } })
    expect(row.isOverdue).toBe(false)
  })

  it('quiet hours: in-app alert now, email held until morning', async () => {
    const night = new Date('2030-02-01T18:30:00Z') // 23:30 Karachi
    expect(isQuietHours(night)).toBe(true)
    const t = await request(app).post('/api/projects/RTI/tasks').set(...auth(w.itadLead))
      .send({ title: 'Night task', assigneeIds: [w.itadMember.id], dueAt: new Date(night.getTime() - 60000).toISOString() }).expect(201)
    await runDeadlineTick(night)
    expect(await prisma.notification.count({ where: { entityId: t.body.task.id, type: 'TASK_OVERDUE' } })).toBeGreaterThan(0)
    expect(await prisma.pmDispatchLog.count({ where: { taskId: t.body.task.id, kind: 'overdue_email' } })).toBe(0)
    const morning = new Date('2030-02-02T03:30:00Z') // 08:30 Karachi
    await runDeadlineTick(morning)
    expect(await prisma.pmDispatchLog.count({ where: { taskId: t.body.task.id, kind: 'overdue_email' } })).toBeGreaterThan(0)
  })

  it('due soon fires once, and changing the due date re-arms it', async () => {
    const base = new Date('2030-03-10T06:00:00Z')
    const t = await request(app).post('/api/projects/RTI/tasks').set(...auth(w.itadLead))
      .send({ title: 'Soon', assigneeIds: [w.itadMember.id], dueAt: new Date(base.getTime() + 30 * 60000).toISOString() }).expect(201)
    const id = t.body.task.id
    await runDeadlineTick(base)
    await runDeadlineTick(base)
    // only the closest offset (1h) fires, once
    expect(await prisma.notification.count({ where: { entityId: id, type: 'TASK_DUE_SOON' } })).toBe(1)
    await request(app).patch(`/api/projects/tasks/${t.body.task.code}`).set(...auth(w.itadLead))
      .send({ dueAt: new Date(base.getTime() + 40 * 60000).toISOString() }).expect(200)
    await runDeadlineTick(base)
    expect(await prisma.notification.count({ where: { entityId: id, type: 'TASK_DUE_SOON' } })).toBe(2)
  })

  it('Super Admin alerts can be turned off', async () => {
    // The Super Admin created RTI so they are also a project admin; drop that membership
    // so only the global Super Admin fan-out would reach them.
    await request(app).delete(`/api/projects/RTI/members/${w.superAdmin.id}`).set(...auth(w.itadLead)).expect(204)
    process.env.PM_SUPER_ADMIN_OVERDUE_ALERTS = 'false'
    const now = new Date('2030-04-01T06:00:00Z')
    const t = await request(app).post('/api/projects/RTI/tasks').set(...auth(w.itadLead))
      .send({ title: 'No SA', assigneeIds: [w.itadMember.id], dueAt: new Date(now.getTime() - 60000).toISOString() }).expect(201)
    await runDeadlineTick(now)
    const who = (await prisma.notification.findMany({ where: { entityId: t.body.task.id, type: 'TASK_OVERDUE' } })).map((n) => n.userId)
    expect(who).not.toContain(w.superAdmin.id)
    expect(who).toEqual(expect.arrayContaining([w.itadMember.id, w.itadLead.id]))
    process.env.PM_SUPER_ADMIN_OVERDUE_ALERTS = 'true'
  })
})

describe('due date extensions', () => {
  it('assignee requests, assigner approves → due date moves', async () => {
    const t = await request(app).post('/api/projects/RTI/tasks').set(...auth(w.itadLead))
      .send({ title: 'Ext', assigneeIds: [w.itadMember.id], dueAt: new Date(Date.now() + 3600000).toISOString() }).expect(201)
    const newDue = new Date(Date.now() + 5 * 86400000).toISOString()
    await request(app).post(`/api/projects/tasks/${t.body.task.code}/extension-requests`).set(...auth(w.itadLead)).send({ requestedDueAt: newDue, reason: 'Waiting on client' }).expect(403)
    await request(app).post(`/api/projects/tasks/${t.body.task.code}/extension-requests`).set(...auth(w.itadMember)).send({ requestedDueAt: newDue, reason: 'Waiting on client' }).expect(201)
    await request(app).post(`/api/projects/tasks/${t.body.task.code}/extension-requests`).set(...auth(w.itadMember)).send({ requestedDueAt: newDue, reason: 'Again' }).expect(409)
    const detail = await request(app).get(`/api/projects/tasks/${t.body.task.code}`).set(...auth(w.itadLead)).expect(200)
    const reqId = detail.body.task.extensionRequests[0].id
    await request(app).post(`/api/projects/extension-requests/${reqId}/decide`).set(...auth(w.itadMember)).send({ decision: 'approve' }).expect(403)
    await request(app).post(`/api/projects/extension-requests/${reqId}/decide`).set(...auth(w.itadLead)).send({ decision: 'approve' }).expect(200)
    const after = await request(app).get(`/api/projects/tasks/${t.body.task.code}`).set(...auth(w.itadMember)).expect(200)
    expect(after.body.task.dueAt).toBe(newDue)
    expect(await prisma.notification.count({ where: { userId: w.itadMember.id, type: 'EXTENSION_DECIDED' } })).toBe(1)
  })

  it('rejecting keeps the old date', async () => {
    const due = new Date(Date.now() + 3600000).toISOString()
    const t = await request(app).post('/api/projects/RTI/tasks').set(...auth(w.itadLead)).send({ title: 'Ext2', assigneeIds: [w.itadMember.id], dueAt: due }).expect(201)
    await request(app).post(`/api/projects/tasks/${t.body.task.code}/extension-requests`).set(...auth(w.itadMember)).send({ requestedDueAt: new Date(Date.now() + 86400000 * 2).toISOString(), reason: 'More time' }).expect(201)
    const d = await request(app).get(`/api/projects/tasks/${t.body.task.code}`).set(...auth(w.itadLead)).expect(200)
    await request(app).post(`/api/projects/extension-requests/${d.body.task.extensionRequests[0].id}/decide`).set(...auth(w.itadLead)).send({ decision: 'reject', note: 'Needed today' }).expect(200)
    const after = await request(app).get(`/api/projects/tasks/${t.body.task.code}`).set(...auth(w.itadMember)).expect(200)
    expect(after.body.task.dueAt).toBe(due)
  })
})

describe('chat', () => {
  let dmId: string

  it('project channel exists and mirrors membership', async () => {
    const res = await request(app).get('/api/chat/conversations').set(...auth(w.itadMember)).expect(200)
    const ch = res.body.conversations.find((c: { type: string }) => c.type === 'PROJECT')
    expect(ch.title).toBe('# RTI')
    await request(app).delete(`/api/projects/RTI/members/${w.inventoryMember.id}`).set(...auth(w.itadLead)).expect(204)
    const viewerList = await request(app).get('/api/chat/conversations').set(...auth(w.inventoryMember)).expect(200)
    expect(viewerList.body.conversations.find((c: { type: string }) => c.type === 'PROJECT')).toBeUndefined()
    await request(app).get(`/api/chat/conversations/${ch.id}/messages`).set(...auth(w.inventoryMember)).expect(404)
  })

  it('cannot remove the last project admin', async () => {
    await request(app).delete(`/api/projects/RTI/members/${w.itadLead.id}`).set(...auth(w.superAdmin)).expect(422)
  })

  it('DMs: unread counts, read state, and admins cannot read other people\'s DMs', async () => {
    const c = await request(app).post('/api/chat/conversations').set(...auth(w.itadMember)).send({ type: 'DIRECT', userId: w.leadgenLead.id }).expect(201)
    dmId = c.body.conversation.id
    const again = await request(app).post('/api/chat/conversations').set(...auth(w.leadgenLead)).send({ type: 'DIRECT', userId: w.itadMember.id }).expect(200)
    expect(again.body.conversation.id).toBe(dmId)
    const sent = await request(app).post(`/api/chat/conversations/${dmId}/messages`).set(...auth(w.itadMember)).send({ body: 'Hi, can you check RTI-1? <script>alert(1)</script>' }).expect(201)
    // stored as plain text; the client renders text, never HTML
    expect(sent.body.message.body).toContain('<script>')
    const u = await request(app).get('/api/chat/unread').set(...auth(w.leadgenLead)).expect(200)
    expect(u.body.total).toBe(1)
    await request(app).get(`/api/chat/conversations/${dmId}/messages`).set(...auth(w.superAdmin)).expect(404)
    await request(app).post(`/api/chat/conversations/${dmId}/read`).set(...auth(w.leadgenLead)).send({ seq: sent.body.message.seq }).expect(200)
    const u2 = await request(app).get('/api/chat/unread').set(...auth(w.leadgenLead)).expect(200)
    expect(u2.body.total).toBe(0)
  })

  it('a task code renders as a card only for people who can see that project', async () => {
    const forOutsider = await request(app).get(`/api/chat/conversations/${dmId}/messages`).set(...auth(w.leadgenLead)).expect(200)
    expect(forOutsider.body.messages[0].task).toBeNull()
    const forMember = await request(app).get(`/api/chat/conversations/${dmId}/messages`).set(...auth(w.itadMember)).expect(200)
    expect(forMember.body.messages[0].task.code).toBe('RTI-1')
  })

  it('only the author can edit or delete a message', async () => {
    const m = await request(app).post(`/api/chat/conversations/${dmId}/messages`).set(...auth(w.leadgenLead)).send({ body: 'typo' }).expect(201)
    await request(app).patch(`/api/chat/messages/${m.body.message.id}`).set(...auth(w.itadMember)).send({ body: 'nope' }).expect(403)
    await request(app).patch(`/api/chat/messages/${m.body.message.id}`).set(...auth(w.leadgenLead)).send({ body: 'fixed' }).expect(200)
    await request(app).delete(`/api/chat/messages/${m.body.message.id}`).set(...auth(w.leadgenLead)).expect(204)
    const list = await request(app).get(`/api/chat/conversations/${dmId}/messages`).set(...auth(w.itadMember)).expect(200)
    const del = list.body.messages.find((x: { id: string }) => x.id === m.body.message.id)
    expect(del.deleted).toBe(true)
    expect(del.body).toBe('')
  })

  it('blocks dangerous file types', async () => {
    await request(app).post(`/api/chat/conversations/${dmId}/files?name=evil.exe`).set(...auth(w.itadMember)).set('Content-Type', 'application/octet-stream').send(Buffer.from('MZ')).expect(415)
    const ok = await request(app).post(`/api/chat/conversations/${dmId}/files?name=notes.txt`).set(...auth(w.itadMember)).set('Content-Type', 'text/plain').send(Buffer.from('hello')).expect(201)
    expect(ok.body.message.file.name).toBe('notes.txt')
    await request(app).get(ok.body.message.file.url.replace(/^\/api/, '/api')).set(...auth(w.superAdmin)).expect(404)
  })

  it('mentions in a group notify the mentioned person', async () => {
    const g = await request(app).post('/api/chat/conversations').set(...auth(w.itadLead)).send({ type: 'GROUP', name: 'Launch', userIds: [w.itadMember.id, w.leadgenLead.id] }).expect(201)
    await request(app).post(`/api/chat/conversations/${g.body.conversation.id}/messages`).set(...auth(w.itadLead)).send({ body: '@itad member please check', mentions: [w.itadMember.id, w.inventoryMember.id] }).expect(201)
    const n = await prisma.notification.findMany({ where: { type: 'MENTION', link: `/app/chat?c=${g.body.conversation.id}` } })
    expect(n.map((x) => x.userId)).toEqual([w.itadMember.id]) // non-members are dropped
  })
})

describe('reports + my tasks', () => {
  it('dashboard is for admins only', async () => {
    await request(app).get('/api/projects/reports/overview').set(...auth(w.itadMember)).expect(403)
    const r = await request(app).get('/api/projects/reports/overview').set(...auth(w.itadLead)).expect(200)
    expect(r.body.byProject[0].key).toBe('RTI')
    expect(Array.isArray(r.body.byMember)).toBe(true)
  })
  it('my tasks + assigned by me', async () => {
    const mine = await request(app).get('/api/projects/me/tasks').set(...auth(w.itadLead)).expect(200)
    expect(mine.body.tasks.some((t: { code: string }) => t.code === 'RTI-1')).toBe(true)
    const created = await request(app).get('/api/projects/me/tasks?scope=created').set(...auth(w.itadMember)).expect(200)
    expect(created.body.tasks.some((t: { code: string }) => t.code === 'RTI-1')).toBe(true)
    const unified = await request(app).get('/api/tasks/mine').set(...auth(w.itadLead)).expect(200)
    expect(unified.body.pending.some((t: { source: string }) => t.source === 'project')).toBe(true)
  })
})
