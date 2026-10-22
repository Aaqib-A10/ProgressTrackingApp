import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'

// Metriq as a Claude connector: a person makes a private key in Settings, adds the link to
// Claude, and Claude can list their tickets, read one, comment, tick the checklist and move it,
// always as that person and with the app's own rules. Switching the key off stops it at once.

let w: SeededWorld
let url = ''
let code = ''
let otherCode = ''
beforeAll(async () => {
  w = await seedWorld()
  await request(app).post('/api/projects').set(...auth(w.superAdmin)).send({
    name: 'CMR', key: 'CMR', members: [{ userId: w.itadLead.id, role: 'ADMIN' }, { userId: w.itadMember.id, role: 'MEMBER' }],
  }).expect(201)
  await request(app).post('/api/projects').set(...auth(w.superAdmin)).send({ name: 'Secret', key: 'SEC', members: [{ userId: w.leadgenLead.id, role: 'ADMIN' }] }).expect(201)
  await request(app).patch('/api/projects/CMR').set(...auth(w.itadLead)).send({ workFolder: 'GitHub Aneeskhan99/cmr, Mac folder /Users/aqib/CMR' }).expect(200)
  const t = await request(app).post('/api/projects/CMR/tasks').set(...auth(w.itadLead))
    .send({ title: 'Mail-Back Kits card alignment fix', description: 'The three cards on /mail-back-kits are not aligned on mobile.', assigneeIds: [w.itadMember.id], priority: 'HIGH' }).expect(201)
  code = t.body.task.code
  await request(app).post(`/api/projects/tasks/${code}/checklist`).set(...auth(w.itadLead)).send({ text: 'Fix the card grid' }).expect(201)
  await request(app).post(`/api/projects/tasks/${code}/comments`).set(...auth(w.itadLead)).send({ body: 'Use the same card height as the homepage.' }).expect(201)
  await request(app).post(`/api/projects/tasks/${code}/attachments`).query({ name: 'notes.txt' }).set(...auth(w.itadLead)).set('Content-Type', 'text/plain').send(Buffer.from('Cards: 320px wide, 24px gap')).expect(201)
  otherCode = (await request(app).post('/api/projects/SEC/tasks').set(...auth(w.leadgenLead)).send({ title: 'Hidden', assigneeIds: [w.leadgenLead.id] }).expect(201)).body.task.code
})
afterAll(async () => { await prisma.$disconnect() })

const rpc = (method: string, params: object = {}, id: number | null = 1) => request(app).post(url).send({ jsonrpc: '2.0', ...(id === null ? {} : { id }), method, params })
const call = async (name: string, args: object) => {
  const r = await rpc('tools/call', { name, arguments: args }).expect(200)
  const res = r.body.result as { content: { type: string; text?: string; data?: string }[]; isError?: boolean }
  return { ...res, text: res.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n') }
}

describe('Connect Claude keys', () => {
  it('a person makes a key; the link is shown once; the list never shows the key', async () => {
    await request(app).post('/api/claude/keys').set(...auth(w.itadMember)).send({ name: ' ' }).expect(400)
    const r = await request(app).post('/api/claude/keys').set(...auth(w.itadMember)).send({ name: 'My Claude' }).expect(201)
    url = new URL(r.body.connectorUrl).pathname
    expect(url).toMatch(/^\/api\/mcp\/mtq_[A-Za-z0-9_-]{40,}$/)
    const list = await request(app).get('/api/claude/keys').set(...auth(w.itadMember)).expect(200)
    expect(list.body.keys).toHaveLength(1)
    expect(JSON.stringify(list.body)).not.toContain(url.split('/').pop())
    const stored = await prisma.claudeKey.findFirstOrThrow({ where: { userId: w.itadMember.id } })
    expect(stored.tokenHash).not.toContain('mtq_') // only a hash is kept
    await request(app).get('/api/claude/keys').expect(401)
  })
})

describe('the Metriq connector', () => {
  it('initializes, lists its tools and answers ping; notifications get 202', async () => {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude', version: '1' } }).expect(200)
    expect(init.body.result.protocolVersion).toBe('2025-06-18')
    expect(init.body.result.serverInfo.name).toBe('metriq')
    expect(init.body.result.instructions).toContain('You are working as itad member')
    await rpc('notifications/initialized', {}, null).expect(202)
    const tools = await rpc('tools/list').expect(200)
    expect(tools.body.result.tools.map((t: { name: string }) => t.name)).toEqual(['list_my_tickets', 'get_ticket', 'list_projects', 'add_comment', 'move_ticket', 'update_checklist_item', 'read_attachment',
      'list_board_columns', 'list_project_members', 'list_project_tickets', 'create_ticket', 'update_ticket', 'add_checklist_item', 'delete_ticket'])
    expect((await rpc('ping').expect(200)).body.result).toEqual({})
    expect((await rpc('nope').expect(200)).body.error.code).toBe(-32601)
    await request(app).get(url).expect(405)
  })

  it('lists my tickets and my projects with where the work lives', async () => {
    const mine = await call('list_my_tickets', {})
    expect(mine.text).toContain(code)
    expect(mine.text).toContain('Mail-Back Kits card alignment fix')
    expect((await call('list_my_tickets', { project: 'sec' })).text).toContain('No open tickets')
    const projects = await call('list_projects', {})
    expect(projects.text).toContain('CMR | CMR | 1 open for me')
    expect(projects.text).toContain('/Users/aqib/CMR')
    expect(projects.text).not.toContain('Secret')
  })

  it('reads a ticket with checklist, comments and files; a ticket in a project I am not in is not found', async () => {
    const t = await call('get_ticket', { code: code.toLowerCase() })
    expect(t.isError).toBeFalsy()
    for (const s of ['Mail-Back Kits card alignment fix', 'not aligned on mobile', 'Where the work lives: GitHub Aneeskhan99/cmr', '[ ] Fix the card grid', 'Use the same card height', 'notes.txt', 'attachment_id:']) expect(t.text).toContain(s)
    const hidden = await call('get_ticket', { code: otherCode })
    expect(hidden.isError).toBe(true)
    expect(hidden.text).not.toContain('Hidden')
    expect((await call('get_ticket', { code: 'nonsense' })).isError).toBe(true)
  })

  it('opens a text file on the ticket', async () => {
    const id = (await prisma.pmAttachment.findFirstOrThrow({ where: { originalName: 'notes.txt' } })).id
    const f = await call('read_attachment', { attachment_id: id })
    expect(f.text).toContain('Cards: 320px wide, 24px gap')
  })

  it('comments, ticks the checklist and moves the ticket to review, as the person, with notifications', async () => {
    const c = await call('add_comment', { code, text: 'Fixed the grid in app/mail-back-kits/page.tsx. Cards now line up on mobile.' })
    expect(c.text).toContain('Comment added')
    const row = await prisma.pmComment.findFirstOrThrow({ where: { body: { startsWith: 'Fixed the grid' } } })
    expect(row.authorId).toBe(w.itadMember.id)
    const note = await prisma.notification.findFirst({ where: { userId: w.itadLead.id, type: 'TASK_COMMENT' } })
    expect(note).not.toBeNull() // the lead watching the ticket is told

    expect((await call('update_checklist_item', { code, item: 'fix the card grid', done: true })).text).toContain('marked done')
    expect((await call('move_ticket', { code, status: 'nowhere' })).text).toContain('Columns: Backlog, To Do, In Progress, In Review, Blocked, Done')
    expect((await call('move_ticket', { code, status: 'in review' })).text).toContain('to In Review')
    const after = await call('get_ticket', { code })
    expect(after.text).toContain('Status: In Review')
    expect(after.text).toContain('[x] Fix the card grid')
  })

  it('Copy for Claude gives the same brief in the app', async () => {
    const b = await request(app).get(`/api/projects/tasks/${code}/brief`).set(...auth(w.itadMember)).expect(200)
    expect(b.body.text).toContain(`Metriq ticket ${code}: Mail-Back Kits card alignment fix`)
    expect(b.body.text).toContain('(open the ticket link to download them)')
    await request(app).get(`/api/projects/tasks/${otherCode}/brief`).set(...auth(w.itadMember)).expect(404)
  })

  it('a switched-off key or a made-up key stops working at once', async () => {
    await request(app).post('/api/mcp/mtq_madeupmadeupmadeupmadeup').send({ jsonrpc: '2.0', id: 1, method: 'tools/list' }).expect(401)
    const k = await prisma.claudeKey.findFirstOrThrow({ where: { userId: w.itadMember.id } })
    await request(app).delete(`/api/claude/keys/${k.id}`).set(...auth(w.itadLead)).expect(404) // not theirs
    await request(app).delete(`/api/claude/keys/${k.id}`).set(...auth(w.itadMember)).expect(204)
    await rpc('tools/list').expect(401)
    expect((await request(app).get('/api/claude/keys').set(...auth(w.itadMember)).expect(200)).body.keys).toHaveLength(0)
  })
})
