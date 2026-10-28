import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import express from 'express'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { flushErrors } from '../lib/health/errors'
import { resetAlertLimits } from '../lib/health/alerts'
import { auditStore, openProbe, AuditWriteBlocked } from '../lib/health/auditContext'
import { errorHandler, requestMonitor } from '../lib/health/monitor'
import { listEndpoints, runAuditNow, setAuditBaseUrl } from '../lib/health/audit'
import { runTracked } from '../lib/health/jobs'
import { asyncHandler } from '../lib/asyncHandler'

// System Health: the error log, the hourly self check (with its test mode that never saves
// anything), job heartbeats, the outside uptime checker, and who may see any of it.

let w: SeededWorld
type U = SeededWorld['itadMember']

async function clearHealth() {
  await prisma.errorEvent.deleteMany()
  await prisma.errorGroup.deleteMany()
  await prisma.auditCheck.deleteMany()
  await prisma.auditRun.deleteMany()
  await prisma.jobHeartbeat.deleteMany()
  await prisma.uptimeEvent.deleteMany()
  await prisma.notification.deleteMany({ where: { type: 'SYSTEM_HEALTH' } })
}
const alerts = (u: U) => prisma.notification.findMany({ where: { userId: u.id, type: 'SYSTEM_HEALTH' }, orderBy: { createdAt: 'asc' } })

beforeAll(async () => {
  w = await seedWorld()
  await clearHealth()
})
beforeEach(() => resetAlertLimits())
afterAll(async () => {
  await clearHealth()
  await prisma.$disconnect()
})

describe('who can see System Health', () => {
  it('Super Admins get in, members do not, until a Super Admin makes them a developer', async () => {
    await request(app).get('/api/system-health/summary').set(...auth(w.superAdmin)).expect(200)
    await request(app).get('/api/system-health/summary').set(...auth(w.itadMember)).expect(403)
    await request(app).get('/api/system-health/errors').set(...auth(w.itadLead)).expect(403)

    // Only a Super Admin can choose developers.
    await request(app).patch(`/api/system-health/developers/${w.itadMember.id}`).set(...auth(w.itadLead)).send({ isDeveloper: true }).expect(403)
    await request(app).patch(`/api/system-health/developers/${w.itadMember.id}`).set(...auth(w.superAdmin)).send({ isDeveloper: true }).expect(200)

    const me = await request(app).get('/api/auth/me').set(...auth(w.itadMember)).expect(200)
    expect(me.body.user.isDeveloper).toBe(true)
    const s = await request(app).get('/api/system-health/summary').set(...auth(w.itadMember)).expect(200)
    expect(s.body.alertsTo).toBe('developers')
    expect(s.body.canManageDevelopers).toBe(false)
    await request(app).get('/api/system-health/developers').set(...auth(w.itadMember)).expect(403)
    const devs = await request(app).get('/api/system-health/developers').set(...auth(w.superAdmin)).expect(200)
    expect(devs.body.users.find((u: { id: string }) => u.id === w.itadMember.id).isDeveloper).toBe(true)
  })
})

describe('browser errors', () => {
  it('groups the same error, hides secrets, and alerts the developer once', async () => {
    const report = { message: 'Cannot read properties of undefined (reading "title") Bearer abc.def.ghi', stack: 'TypeError: x\n    at TaskCard (https://pulsetrack.online/assets/index-AbC12345.js:10:20)', url: 'https://pulsetrack.online/app/projects/OPS?task=OPS-4&token=supersecret', kind: 'error' }
    await request(app).post('/api/system-health/client-error').set(...auth(w.leadgenMember)).send(report).expect(202)
    await request(app).post('/api/system-health/client-error').set(...auth(w.itadLead)).send(report).expect(202)
    await request(app).post('/api/system-health/client-error').send(report).expect(202) // not signed in: still reported
    await flushErrors()

    const groups = await prisma.errorGroup.findMany({ where: { source: 'BROWSER' } })
    expect(groups).toHaveLength(1)
    const g = groups[0]
    expect(g.count).toBe(3)
    expect(g.userIds.sort()).toEqual([w.leadgenMember.id, w.itadLead.id].sort())
    expect(g.route).toBe('/app/projects/OPS')
    expect(g.message).not.toContain('abc.def.ghi')
    expect(g.message).toContain('Bearer [hidden]')
    const ev = await prisma.errorEvent.findMany({ where: { groupId: g.id } })
    expect(ev.length).toBe(3)
    expect(ev.every((e) => !e.url?.includes('supersecret'))).toBe(true)

    // The developer (itadMember) got one bell alert; the Super Admin is not pinged while a developer exists.
    expect((await alerts(w.itadMember)).map((n) => n.title)).toEqual(['New error in a browser'])
    expect(await alerts(w.superAdmin)).toHaveLength(0)

    // The list and the detail show it.
    const list = await request(app).get('/api/system-health/errors?source=BROWSER').set(...auth(w.itadMember)).expect(200)
    expect(list.body.errors[0]).toMatchObject({ id: g.id, count: 3, people: 2, state: 'OPEN' })
    const one = await request(app).get(`/api/system-health/errors/${g.id}`).set(...auth(w.itadMember)).expect(200)
    expect(one.body.error.people.map((p: { name: string }) => p.name).sort()).toEqual(['itad lead', 'leadgen member'])
    expect(one.body.error.hours).toHaveLength(48)
    expect(one.body.error.hours[47]).toBe(3)
  })

  it('a resolved error that happens again reopens and says it came back', async () => {
    const g = await prisma.errorGroup.findFirstOrThrow({ where: { source: 'BROWSER' } })
    await request(app).patch(`/api/system-health/errors/${g.id}`).set(...auth(w.itadMember)).send({ state: 'RESOLVED' }).expect(200)
    expect((await prisma.errorGroup.findUniqueOrThrow({ where: { id: g.id } })).resolvedById).toBe(w.itadMember.id)

    await request(app).post('/api/system-health/client-error').set(...auth(w.leadgenMember)).send({ message: 'Cannot read properties of undefined (reading "title") Bearer zzz.yyy.xxx', stack: 'TypeError: x\n    at TaskCard (https://pulsetrack.online/assets/index-Zz999999.js:11:2)', url: '/app/projects/OPS' }).expect(202)
    await flushErrors()
    const after = await prisma.errorGroup.findUniqueOrThrow({ where: { id: g.id } })
    expect(after.state).toBe('OPEN')
    expect(after.reopenedAt).not.toBeNull()
    expect((await alerts(w.itadMember)).map((n) => n.title)).toContain('An error came back in a browser')
  })

  it('drops errors thrown by a browser extension or another script injected into the page', async () => {
    const before = await prisma.errorGroup.count({ where: { source: 'BROWSER' } })
    // The exact reports from Hassan Raza (/app/dashboard) and Muhammad Zeeshan (/app/attendance/me), 23 Oct 2026.
    const injected = [
      { message: 'Uncaught ReferenceError: _0x5229ea is not defined', stack: 'ReferenceError: _0x5229ea is not defined\n    at <anonymous>:1:30\n    at <anonymous>:1:303', url: 'https://pulsetrack.online/app/dashboard', kind: 'error' },
      { message: 'Uncaught ReferenceError: _0x5229ea is not defined', stack: 'ReferenceError: _0x5229ea is not defined\n    at <anonymous>:1:30\n    at <anonymous>:1:318', url: 'https://pulsetrack.online/app/attendance/me', kind: 'error' },
      { message: 'TypeError: x is not a function', stack: 'TypeError: x is not a function\n    at chrome-extension://abcdefgh/content.js:4:9', url: 'https://pulsetrack.online/app/dashboard', kind: 'error' },
      { message: 'TypeError: y', stack: 'TypeError: y\n    at track (https://ads.example.com/tag.js:1:99)', url: 'https://pulsetrack.online/app/dashboard', kind: 'rejection' },
      { message: 'TypeError: z', stack: 'z@moz-extension://1234/inject.js:2:3', url: 'https://pulsetrack.online/app/dashboard', kind: 'error' },
    ]
    for (const r of injected) {
      const res = await request(app).post('/api/system-health/client-error').set(...auth(w.leadgenMember)).send(r).expect(202)
      expect(res.body.ignored).toBe('not Metriq code')
    }
    // Our own code still gets logged, even when an injected frame is mixed in.
    await request(app).post('/api/system-health/client-error').set(...auth(w.leadgenMember)).send({ message: 'TypeError: ours', stack: 'TypeError: ours\n    at <anonymous>:1:1\n    at Dashboard (https://pulsetrack.online/assets/Dashboard-Ab12.js:3:40)', url: 'https://pulsetrack.online/app/dashboard', kind: 'error' }).expect(202)
    await flushErrors()
    const groups = await prisma.errorGroup.findMany({ where: { source: 'BROWSER' } })
    expect(groups).toHaveLength(before + 1)
    expect(groups.some((g) => g.message.includes('_0x5229ea'))).toBe(false)
    expect(groups.some((g) => g.message === 'TypeError: ours')).toBe(true)
  })

  it('rejects junk', async () => {
    await request(app).post('/api/system-health/client-error').send({}).expect(400)
    await request(app).post('/api/system-health/client-error').send({ message: 'x'.repeat(3000) }).expect(400)
  })
})

describe('server errors', () => {
  it('logs a crash with its route and stack, and a 5xx answered without a throw', async () => {
    const mini = express()
    mini.use(requestMonitor)
    mini.get('/boom/:id', asyncHandler(async () => { throw new Error('Database said no for cmabcdefghijklmnopqrstuvw') }))
    mini.get('/busy', (_req, res) => { res.status(503).json({ error: 'busy' }) })
    mini.use(errorHandler)
    await request(mini).get('/boom/cm1111111111111111111111').expect(500)
    await request(mini).get('/boom/cm2222222222222222222222').expect(500)
    await request(mini).get('/busy').expect(503)
    await flushErrors()
    const crash = await prisma.errorGroup.findFirstOrThrow({ where: { source: 'SERVER', route: 'GET /boom/:id' } })
    expect(crash.count).toBe(2)
    expect(crash.stack).toContain('systemHealth.integration.test')
    const busy = await prisma.errorGroup.findFirstOrThrow({ where: { source: 'SERVER', route: 'GET /busy' } })
    expect(busy.message).toBe('The API answered 503')
    expect(busy.status).toBe(503)
  })

  it('gives Claude a brief and makes a ticket from an error', async () => {
    const g = await prisma.errorGroup.findFirstOrThrow({ where: { route: 'GET /boom/:id' } })
    const brief = await request(app).get(`/api/system-health/errors/${g.id}/brief`).set(...auth(w.superAdmin)).expect(200)
    expect(brief.body.text).toContain('Stack trace:')
    expect(brief.body.text).toContain('Seen 2 times')

    await request(app).post('/api/projects').set(...auth(w.superAdmin)).send({ name: 'Metriq Dev', key: 'DEV', members: [{ userId: w.itadMember.id, role: 'MEMBER' }] }).expect(201)
    const t = await request(app).post(`/api/system-health/errors/${g.id}/ticket`).set(...auth(w.superAdmin)).send({ project: 'dev', assigneeIds: [w.itadMember.id] }).expect(201)
    const task = await prisma.pmTask.findFirstOrThrow({ where: { code: t.body.code }, include: { assignees: true } })
    expect(task.title).toMatch(/^Fix error: Database said no/)
    expect(task.priority).toBe('HIGH')
    expect(task.description).toContain('Stack trace:')
    expect(task.assignees.map((a) => a.userId)).toEqual([w.itadMember.id])
  })
})

describe('test mode', () => {
  it('stops every kind of save and lets reads through', async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: w.itadMember.id } })
    const tried: string[] = []
    await auditStore.run(openProbe('t'), async () => {
      const attempts: [string, () => Promise<unknown>][] = [
        ['update', () => prisma.user.update({ where: { id: w.itadMember.id }, data: { name: 'changed' } })],
        ['batch', () => prisma.$transaction([prisma.claudeKey.deleteMany()])],
        ['interactive', () => prisma.$transaction(async (tx) => tx.user.update({ where: { id: w.itadMember.id }, data: { name: 'changed' } }))],
        ['raw', () => prisma.$executeRawUnsafe(`UPDATE "User" SET name = 'changed' WHERE id = '${w.itadMember.id}'`)],
      ]
      for (const [name, fn] of attempts) {
        try { await fn(); tried.push(`${name}: went through`) } catch (e) { tried.push(`${name}: ${e instanceof AuditWriteBlocked ? 'stopped' : (e as Error).message}`) }
      }
      expect(await prisma.user.count()).toBeGreaterThan(0)
    })
    expect(tried).toEqual(['update: stopped', 'batch: stopped', 'interactive: stopped', 'raw: stopped'])
    expect((await prisma.user.findUniqueOrThrow({ where: { id: w.itadMember.id } })).name).toBe(before.name)
  })
})

/** A fingerprint of every table, to prove the self check changed nothing. */
async function snapshot(): Promise<Record<string, string>> {
  const skip = new Set(['ErrorGroup', 'ErrorEvent', 'AuditRun', 'AuditCheck', 'JobHeartbeat', 'AppSecret', '_prisma_migrations'])
  const tables = await prisma.$queryRawUnsafe<{ tablename: string }[]>(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`)
  const out: Record<string, string> = {}
  for (const { tablename } of tables) {
    if (skip.has(tablename)) continue
    const [r] = await prisma.$queryRawUnsafe<{ h: string | null }[]>(`SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h FROM "${tablename}" t`)
    out[tablename] = r.h ?? ''
  }
  return out
}

describe('the self check', () => {
  let server: Server
  beforeAll(async () => {
    server = app.listen(0)
    await new Promise((r) => server.once('listening', r))
    setAuditBaseUrl(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
    // Every department exists in a real install; some endpoints rely on that.
    const have = new Set((await prisma.department.findMany()).map((d) => d.type))
    for (const type of ['ITAD', 'LEAD_GEN', 'MARKETING', 'CSR', 'ECOMMERCE', 'TALKLOOP', 'INVENTORY'] as const) {
      if (!have.has(type)) await prisma.department.create({ data: { type, name: type } })
    }
    // Some real data for the endpoints to read.
    await request(app).post('/api/todos').set(...auth(w.itadMember)).send({ text: 'Call the vendor' })
  })
  afterAll(async () => { await new Promise((r) => server.close(r)) })

  it('finds every endpoint the app has', () => {
    const eps = listEndpoints()
    expect(eps.length).toBeGreaterThan(300)
    expect(eps).toContainEqual({ method: 'GET', path: '/api/projects' })
    expect(eps).toContainEqual({ method: 'POST', path: '/api/attendance/check-in' })
    expect(eps).toContainEqual({ method: 'GET', path: '/api/health' })
  })

  it('calls every API without a crash, and changes nothing in the database', async () => {
    const before = await snapshot()
    const notesBefore = await prisma.notification.count()
    const runId = await runAuditNow({ trigger: 'manual', startedById: w.superAdmin.id })
    const run = await prisma.auditRun.findUniqueOrThrow({ where: { id: runId } })
    const checks = await prisma.auditCheck.findMany({ where: { runId } })

    const apiFails = checks.filter((c) => c.category.startsWith('api') && c.result === 'FAIL').map((c) => `${c.name}: ${c.detail}`)
    expect(apiFails).toEqual([])
    expect(checks.filter((c) => c.category === 'api-read' && c.result !== 'SKIP').length).toBeGreaterThan(100)
    expect(checks.filter((c) => c.category === 'api-write' && c.result !== 'SKIP').length).toBeGreaterThan(150)
    // Write endpoints really reached their save and were stopped.
    expect(checks.some((c) => c.name === 'POST /api/attendance/check-in' && /stopped by test mode/.test(c.detail ?? ''))).toBe(true)
    expect(run.finishedAt).not.toBeNull()
    expect(run.total).toBe(checks.length)
    expect(['PASSED', 'WARN']).toContain(run.state)
    for (const cat of ['database', 'server', 'services', 'jobs', 'data', 'website']) expect(checks.some((c) => c.category === cat)).toBe(true)

    expect(await snapshot()).toEqual(before)
    expect(await prisma.notification.count()).toBe(notesBefore)
  }, 120_000)

  it('the next run compares with the one before', async () => {
    const runId = await runAuditNow({ trigger: 'manual' })
    const run = await prisma.auditRun.findUniqueOrThrow({ where: { id: runId } })
    expect(run.newProblems).toBe(0)
    const list = await request(app).get('/api/system-health/audits').set(...auth(w.itadMember)).expect(200)
    expect(list.body.runs[0].id).toBe(runId)
    const one = await request(app).get(`/api/system-health/audits/${runId}`).set(...auth(w.itadMember)).expect(200)
    expect(one.body.checks.length).toBe(run.total)
    // Problems first.
    const firstPass = one.body.checks.findIndex((c: { result: string }) => c.result === 'PASS')
    expect(one.body.checks.slice(firstPass).some((c: { result: string }) => c.result === 'FAIL' || c.result === 'WARN')).toBe(false)
  }, 120_000)

  it('starting a run while one is going hands back the running one', async () => {
    const a = await request(app).post('/api/system-health/audits/run').set(...auth(w.superAdmin)).expect(202)
    const b = await request(app).post('/api/system-health/audits/run').set(...auth(w.superAdmin)).expect(200)
    expect(b.body).toEqual({ runId: a.body.runId, already: true })
    for (let i = 0; i < 120; i++) {
      const r = await prisma.auditRun.findUniqueOrThrow({ where: { id: a.body.runId } })
      if (r.state !== 'RUNNING') break
      await new Promise((ok) => setTimeout(ok, 500))
    }
  }, 120_000)
})

describe('background jobs', () => {
  it('records each run, and a failing job lands in the error log', async () => {
    await runTracked('task-reminders', async () => undefined)
    let hb = await prisma.jobHeartbeat.findUniqueOrThrow({ where: { name: 'task-reminders' } })
    expect(hb).toMatchObject({ runs: 1, failures: 0, lastError: null })

    await expect(runTracked('task-reminders', async () => { throw new Error('SMTP timeout') })).rejects.toThrow('SMTP timeout')
    await flushErrors()
    hb = await prisma.jobHeartbeat.findUniqueOrThrow({ where: { name: 'task-reminders' } })
    expect(hb).toMatchObject({ runs: 2, failures: 1, lastError: 'SMTP timeout' })
    const g = await prisma.errorGroup.findFirstOrThrow({ where: { source: 'JOB' } })
    expect(g.route).toBe('job:task-reminders')

    const s = await request(app).get('/api/system-health/summary').set(...auth(w.superAdmin)).expect(200)
    expect(s.body.jobs.find((j: { name: string }) => j.name === 'task-reminders').state).toBe('failing')
    expect(s.body.status).toBe('fail')

    await runTracked('task-reminders', async () => undefined)
    hb = await prisma.jobHeartbeat.findUniqueOrThrow({ where: { name: 'task-reminders' } })
    expect(hb.lastError).toBeNull()
  })
})

describe('outside uptime checker', () => {
  it('needs its token, keeps the pings and reports an outage to the developer', async () => {
    delete process.env.UPTIME_TOKEN
    await request(app).post('/api/system-health/uptime').send({ event: 'ping' }).expect(401)
    process.env.UPTIME_TOKEN = 'test-uptime-token-1234567890'
    await request(app).post('/api/system-health/uptime').set('x-uptime-token', 'wrong-token-wrong-token-12').send({ event: 'ping' }).expect(401)
    await request(app).post('/api/system-health/uptime').set('x-uptime-token', process.env.UPTIME_TOKEN).send({ event: 'ping' }).expect(200)
    const r = await request(app).post('/api/system-health/uptime').set('x-uptime-token', process.env.UPTIME_TOKEN)
      .send({ event: 'outage', downAt: '2026-10-23T05:00:00Z', upAt: '2026-10-23T05:07:00Z', detail: 'HTTP 502' }).expect(201)
    expect(r.body.minutes).toBe(7)
    expect((await alerts(w.itadMember)).some((n) => n.title === 'The site was down for 7 min')).toBe(true)
    const s = await request(app).get('/api/system-health/summary').set(...auth(w.superAdmin)).expect(200)
    expect(s.body.uptime.configured).toBe(true)
    expect(s.body.uptime.lastPingAt).not.toBeNull()
    expect(s.body.uptime.outages[0]).toMatchObject({ minutes: 7, detail: 'HTTP 502' })
    delete process.env.UPTIME_TOKEN
  })
})

describe("Claude's connector", () => {
  const urls = new Map<string, string>()
  async function keyFor(u: U): Promise<string> {
    if (!urls.has(u.id)) {
      const r = await request(app).post('/api/claude/keys').set(...auth(u)).send({ name: 'test' }).expect(201)
      urls.set(u.id, new URL(r.body.connectorUrl).pathname)
    }
    return urls.get(u.id)!
  }
  const rpc = async (u: U, method: string, params: object = {}) => (await request(app).post(await keyFor(u)).send({ jsonrpc: '2.0', id: 1, method, params }).expect(200)).body.result

  it('shows the health tools only to developers and Super Admins', async () => {
    const names = async (u: U) => (await rpc(u, 'tools/list')).tools.map((t: { name: string }) => t.name)
    expect(await names(w.itadMember)).toContain('get_error')
    expect(await names(w.superAdmin)).toContain('run_audit')
    expect(await names(w.leadgenMember)).not.toContain('get_error')
    const denied = await rpc(w.leadgenMember, 'tools/call', { name: 'list_errors', arguments: {} })
    expect(denied.isError).toBe(true)
  })

  it('lets a developer read the errors and the last report, and resolve an error', async () => {
    const list = await rpc(w.itadMember, 'tools/call', { name: 'list_errors', arguments: {} })
    expect(list.content[0].text).toContain('job:task-reminders')
    const g = await prisma.errorGroup.findFirstOrThrow({ where: { source: 'JOB' } })
    const one = await rpc(w.itadMember, 'tools/call', { name: 'get_error', arguments: { id: g.id } })
    expect(one.content[0].text).toContain('SMTP timeout')
    const rep = await rpc(w.itadMember, 'tools/call', { name: 'get_audit_report', arguments: {} })
    expect(rep.content[0].text).toMatch(/Metriq self check .* checks\./s)
    await rpc(w.itadMember, 'tools/call', { name: 'set_error_state', arguments: { id: g.id, state: 'resolved' } })
    expect((await prisma.errorGroup.findUniqueOrThrow({ where: { id: g.id } })).state).toBe('RESOLVED')
  })
})
