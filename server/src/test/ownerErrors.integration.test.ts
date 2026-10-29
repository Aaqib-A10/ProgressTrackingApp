import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { hashPassword } from '../lib/auth'
import { ensureHomeCompany } from '../lib/company'

// The owner console's Errors page: the "Errors in 24 hours" card opens a list, each error opens
// in full (where, stack, who, which company) with the text to give Claude.

const EMAIL = 'owner.errors@test.local'
const PASSWORD = 'Owner2026x'
let w: SeededWorld
let groupId = ''

async function owner() {
  const a = request.agent(app)
  await a.post('/api/owner/login').send({ email: EMAIL, password: PASSWORD }).expect(200)
  return a
}

beforeAll(async () => {
  w = await seedWorld()
  await ensureHomeCompany()
  await prisma.ownerAuditLog.deleteMany()
  await prisma.platformOwner.deleteMany()
  await prisma.platformOwner.create({ data: { name: 'Anees', email: EMAIL, passwordHash: await hashPassword(PASSWORD) } })
  await prisma.errorGroup.deleteMany()
  const g = await prisma.errorGroup.create({
    data: {
      fingerprint: 'owner-errors-test', source: 'SERVER', message: "Cannot read properties of undefined (reading 'name')",
      stack: "TypeError: Cannot read properties of undefined (reading 'name')\n    at listTeam (server/src/controllers/adminController.ts:42:10)",
      route: 'GET /api/admin/team-members', status: 500, count: 3, userIds: [w.itadLead.id],
    },
  })
  groupId = g.id
  await prisma.errorEvent.create({ data: { groupId, userId: w.itadLead.id, url: '/api/admin/team-members', status: 500, durationMs: 12 } })
  await prisma.errorGroup.create({ data: { fingerprint: 'owner-errors-old', source: 'BROWSER', message: 'Old fixed thing', state: 'RESOLVED', lastSeenAt: new Date(Date.now() - 10 * 86400_000) } })
})
afterAll(async () => {
  await prisma.errorGroup.deleteMany()
  await prisma.$disconnect()
})

describe('owner errors', () => {
  it('only the owner sees them', async () => {
    await request(app).get('/api/owner/errors').set(...auth(w.superAdmin)).expect(401)
  })

  it('the list: open ones by default, with the companies they hit; filters work', async () => {
    const a = await owner()
    const r = (await a.get('/api/owner/errors?since=24h').expect(200)).body.errors
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ id: groupId, route: 'GET /api/admin/team-members', count: 3, people: 1, state: 'OPEN', companies: ['99 Technologies'] })
    expect((await a.get('/api/owner/errors?state=ALL').expect(200)).body.errors).toHaveLength(2)
    expect((await a.get('/api/owner/errors?state=ALL&since=7d').expect(200)).body.errors).toHaveLength(1)
    expect((await a.get('/api/owner/errors?state=ALL&q=team-members').expect(200)).body.errors).toHaveLength(1)
    await a.get('/api/owner/errors?since=year').expect(400)
  })

  it('one error in full, with the brief for Claude', async () => {
    const a = await owner()
    const r = (await a.get(`/api/owner/errors/${groupId}`).expect(200)).body
    expect(r.error.stack).toContain('adminController.ts:42')
    expect(r.error.people[0]).toMatchObject({ name: 'itad lead', company: '99 Technologies' })
    expect(r.error.events[0]).toMatchObject({ url: '/api/admin/team-members', status: 500 })
    expect(r.error.hours).toHaveLength(48)
    expect(r.brief).toContain('GET /api/admin/team-members')
    expect(r.brief).toContain('Companies: 99 Technologies')
    expect(r.brief).toContain('Stack trace:')
    await a.get('/api/owner/errors/nope').expect(404)
  })

  it('mark fixed, then open again; it is logged', async () => {
    const a = await owner()
    await a.patch(`/api/owner/errors/${groupId}`).send({ state: 'DONE' }).expect(400)
    await a.patch(`/api/owner/errors/${groupId}`).send({ state: 'RESOLVED' }).expect(200)
    expect((await prisma.errorGroup.findUniqueOrThrow({ where: { id: groupId } })).state).toBe('RESOLVED')
    await a.patch(`/api/owner/errors/${groupId}`).send({ state: 'OPEN' }).expect(200)
    expect(await prisma.ownerAuditLog.count({ where: { action: 'ERROR_STATE' } })).toBe(2)
  })
})
