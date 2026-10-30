import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Role } from '@prisma/client'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { hashPassword } from '../lib/auth'
import { runDialerReminderTick, syncAutoTasks } from '../lib/dialer/tasks'

// Lead Dialer, ITAD revised spec (30 Oct 2026): touches from imports and by hand, tasks inside
// Follow-ups (as My To-Do entries), automatic tasks without duplicates, reminders, ownership.

type U = { id: string; role: Role }
let w: SeededWorld
let a: U, b: U
const HEADERS = ['Lead ID', 'Company', 'Email', 'Phone', 'State', 'Lead Status', 'Created', 'Updated At']
const MAPPING = { leadId: 'Lead ID', company: 'Company', email: 'Email', phone: 'Phone', state: 'State', status: 'Lead Status', leadDate: 'Created', lastActivity: 'Updated At' }
const ago = (days: number) => { const d = new Date(Date.now() - days * 86400000); return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}` }
const imp = (u: U, rows: string[][]) => request(app).post('/api/dialer/imports').set(...auth(u)).send({ fileName: 'ez.csv', headers: HEADERS, mapping: MAPPING, rows })
const data = (u: U, rep = 'me') => request(app).get(`/api/dialer/data?rep=${rep}`).set(...auth(u)).expect(200).then((r) => r.body)
type Lead = { id: string; company: string; attempts: number; tries: number; reAttempts: number; manualTouches: number; lastTouchedAt: string | null; snoozeUntil: string | null; needsCrmUpdate: boolean }
type Task = { id: string; leadId: string; ownerId: string; kind: string; origin: string; reason: string | null; status: string; outcome: string | null; dueAt: string | null }
const lead = (d: { leads: Lead[] }, co: string) => d.leads.find((l) => l.company === co)!

const FIRST = () => [
  ['T-P1', 'Pine Pipeline', 'p1@pine.test', '404-555-0101', 'GA', 'Pipeline', ago(90), ago(60)],
  ['T-I1', 'Iris Interested', 'i1@iris.test', '216-555-0102', 'OH', 'Interested', ago(90), ago(3)],
  ['T-C1', 'Cedar Connected', 'c1@cedar.test', '602-555-0103', 'CA', 'Connected', ago(90), ago(40)],
  ['T-V1', 'Vale Voicemail', 'v1@vale.test', '305-555-0104', 'FL', 'Voicemail Sent', ago(90), ago(10)],
  ['T-A1', 'Ash Assigned', 'a1@ash.test', '312-555-0105', 'IL', 'Assigned', ago(35), ago(35)],
]
const SECOND = () => [
  ['T-P1', 'Pine Pipeline', 'p1@pine.test', '404-555-0101', 'GA', 'Not Interested', ago(90), ago(1)],
  ['T-I1', 'Iris Interested', 'i1@iris.test', '216-555-0102', 'OH', 'Pipeline', ago(90), ago(1)],
  ['T-C1', 'Cedar Connected', 'c1@cedar.test', '602-555-0103', 'CA', 'Connected', ago(90), ago(40)],
  ['T-V1', 'Vale Voicemail', 'v1@vale.test', '305-555-0104', 'FL', 'Voicemail Sent', ago(90), ago(2)],
  ['T-A1', 'Ash Assigned', 'a1@ash.test', '312-555-0105', 'IL', 'Assigned', ago(35), ago(35)],
]

beforeAll(async () => {
  w = await seedWorld()
  const itad = await prisma.department.findFirstOrThrow({ where: { type: 'ITAD' } })
  const passwordHash = await hashPassword('Pass-for-tests-9')
  const mk = async (name: string) => { const u = await prisma.user.create({ data: { name, email: `${name}@dialer-tasks.local.test`, role: 'MEMBER', status: 'ACTIVE', isActive: true, passwordHash, departmentId: itad.id } }); return { id: u.id, role: u.role } }
  a = await mk('rep.a'); b = await mk('rep.b')
})
afterAll(async () => { await prisma.$disconnect() })

describe('touches and automatic tasks', () => {
  it('the first import adds no touches; quiet leads past their rule get one follow-up task each', async () => {
    await imp(a, FIRST()).expect(201)
    const d = await data(a)
    expect(d.leads.every((l: Lead) => l.attempts === 0)).toBe(true)
    const auto = d.tasks.filter((t: Task) => t.reason === 'FOLLOW_UP_RULE')
    // Pipeline 60 days on a 7-day rule and Connected 40 on 30: due. Interested 3 of 14: not yet.
    expect(auto.map((t: Task) => d.leads.find((l: Lead) => l.id === t.leadId).company).sort()).toEqual(['Cedar Connected', 'Pine Pipeline'])
    expect(auto.every((t: Task) => t.ownerId === a.id && t.kind === 'CALL' && t.origin === 'AUTO')).toBe(true)
    // Opening it again, or two runs at once, never makes a second one.
    await Promise.all([syncAutoTasks([a.id]), syncAutoTasks([a.id]), data(a)])
    expect(await prisma.workLogEntry.count({ where: { userId: a.id, autoReason: 'FOLLOW_UP_RULE', cancelledAt: null, status: { not: 'DONE' } } })).toBe(2)
  })

  it('the second import counts a status change and a re-attempt; a lead that moved on has its task closed, not done', async () => {
    const r = await imp(a, SECOND()).expect(201)
    expect(r.body.import.summary.touches).toBe(3) // P1 and I1 status changes, V1 re-attempt
    const d = await data(a)
    expect(lead(d, 'Vale Voicemail')).toMatchObject({ attempts: 1, tries: 1, reAttempts: 1 })
    expect(lead(d, 'Iris Interested')).toMatchObject({ attempts: 1, tries: 0 })
    expect(lead(d, 'Cedar Connected')).toMatchObject({ attempts: 0 })
    const p1 = await prisma.dialerLead.findFirstOrThrow({ where: { ownerId: a.id, externalId: 'T-P1' } })
    const t = await prisma.workLogEntry.findFirstOrThrow({ where: { dialerLeadId: p1.id, autoReason: 'FOLLOW_UP_RULE' } })
    expect(t.cancelledAt).not.toBeNull()
    expect(t.status).not.toBe('DONE')
    // The same file again adds nothing.
    const again = await imp(a, SECOND()).expect(201)
    expect(again.body.import.summary.touches).toBe(0)
  })

  it('an outcome chip is one touch: the follow-up task is done with the outcome, and the lead is marked for Earthzone', async () => {
    const c1 = lead(await data(a), 'Cedar Connected')
    await request(app).post(`/api/dialer/leads/${c1.id}/touches`).set(...auth(a)).send({ outcome: 'VOICEMAIL' }).expect(201)
    const d = await data(a)
    expect(lead(d, 'Cedar Connected')).toMatchObject({ attempts: 1, manualTouches: 1, needsCrmUpdate: true })
    const done = await prisma.workLogEntry.findFirstOrThrow({ where: { dialerLeadId: c1.id, autoReason: 'FOLLOW_UP_RULE' } })
    expect(done).toMatchObject({ status: 'DONE', outcome: 'Voicemail', cancelledAt: null })
    // Touched today: no longer quiet, so no new follow-up task.
    expect(d.tasks.filter((x: Task) => x.leadId === c1.id && x.status === 'OPEN')).toHaveLength(0)
  })

  it('Call now only copies the number: no touch, nothing hidden', async () => {
    const v1 = lead(await data(a), 'Vale Voicemail')
    await request(app).post(`/api/dialer/leads/${v1.id}/actions`).set(...auth(a)).send({ kind: 'CALL_NOW' }).expect(201)
    expect(lead(await data(a), 'Vale Voicemail')).toMatchObject({ attempts: 1, snoozeUntil: null })
  })

  it('touches and tasks are the owner\'s: another rep cannot, a manager can look but not log', async () => {
    const c1 = lead(await data(a), 'Cedar Connected')
    await request(app).post(`/api/dialer/leads/${c1.id}/touches`).set(...auth(b)).send({}).expect(404)
    await request(app).post(`/api/dialer/leads/${c1.id}/touches`).set(...auth(w.itadLead)).send({}).expect(403)
    await request(app).post('/api/dialer/tasks').set(...auth(b)).send({ leadId: c1.id, kind: 'CALL', dueAt: new Date(Date.now() + 86400000).toISOString() }).expect(404)
    expect((await data(w.itadLead, a.id)).leads.length).toBe(5)
  })

  it('a backdated touch counts; dismissing a touch takes it back out', async () => {
    const a1 = lead(await data(a), 'Ash Assigned')
    await request(app).post(`/api/dialer/leads/${a1.id}/touches`).set(...auth(a)).send({ at: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10) }).expect(201)
    await request(app).post(`/api/dialer/leads/${a1.id}/touches`).set(...auth(a)).send({ at: new Date(Date.now() + 5 * 86400000).toISOString() }).expect(400)
    let d = await data(a)
    expect(lead(d, 'Ash Assigned')).toMatchObject({ attempts: 1, manualTouches: 1 })
    const detail = (await request(app).get(`/api/dialer/leads/${a1.id}`).set(...auth(a)).expect(200)).body
    expect(detail.touches).toHaveLength(1)
    expect(detail.touches[0]).not.toHaveProperty('source')
    await request(app).delete(`/api/dialer/touches/${detail.touches[0].id}`).set(...auth(a)).expect(204)
    d = await data(a)
    expect(lead(d, 'Ash Assigned')).toMatchObject({ attempts: 0, manualTouches: 0 })
  })
})

describe('tasks inside Follow-ups', () => {
  it('Call later makes one call-back task and moves it; reminders come 15 minutes before and at the due time, once each', async () => {
    const i1 = lead(await data(a), 'Iris Interested')
    const due1 = new Date(Date.now() + 2 * 3600000)
    const due2 = new Date(Date.now() + 3 * 3600000)
    await request(app).post(`/api/dialer/leads/${i1.id}/actions`).set(...auth(a)).send({ kind: 'CALL_LATER', at: due1.toISOString() }).expect(201)
    await request(app).post(`/api/dialer/leads/${i1.id}/actions`).set(...auth(a)).send({ kind: 'CALL_LATER', at: due2.toISOString() }).expect(201)
    const open = await prisma.workLogEntry.findMany({ where: { dialerLeadId: i1.id, autoReason: 'CALL_LATER', cancelledAt: null, status: { not: 'DONE' } } })
    expect(open).toHaveLength(1)
    expect(open[0].dueAt!.getTime()).toBe(due2.getTime())
    expect(open[0].remindMinutes).toEqual([15, 0])

    const before = await prisma.notification.count({ where: { userId: a.id, entityType: 'DialerTask' } })
    await runDialerReminderTick(new Date(due2.getTime() - 14 * 60000))
    await runDialerReminderTick(new Date(due2.getTime() - 13 * 60000))
    expect(await prisma.notification.count({ where: { userId: a.id, entityType: 'DialerTask' } })).toBe(before + 1)
    await runDialerReminderTick(new Date(due2.getTime() + 60000))
    const n = await prisma.notification.findMany({ where: { userId: a.id, entityType: 'DialerTask' }, orderBy: { createdAt: 'asc' } })
    expect(n).toHaveLength(before + 2)
    expect(n[n.length - 1].title).toMatch(/^Due now: Call back: Iris Interested/)
    expect(n[n.length - 1].body).toMatch(/their time/)
  })

  it('+ Add task, tick it with an outcome; only the owner can change it', async () => {
    const v1 = lead(await data(a), 'Vale Voicemail')
    const r = await request(app).post('/api/dialer/tasks').set(...auth(a)).send({ leadId: v1.id, kind: 'EMAIL', dueAt: new Date(Date.now() + 86400000).toISOString(), note: 'Send the price list' }).expect(201)
    expect(r.body.task).toMatchObject({ kind: 'EMAIL', origin: 'MANUAL', status: 'OPEN', ownerId: a.id, title: 'Email: Vale Voicemail', reminders: [15, 0] })
    await request(app).patch(`/api/dialer/tasks/${r.body.task.id}`).set(...auth(b)).send({ done: true }).expect(403)
    const done = await request(app).patch(`/api/dialer/tasks/${r.body.task.id}`).set(...auth(a)).send({ done: true, outcome: 'Sent' }).expect(200)
    expect(done.body.task).toMatchObject({ status: 'DONE', outcome: 'Sent' })
  })

  it('Task history: open and completed, with the summary', async () => {
    const h = (await request(app).get('/api/dialer/tasks/history').set(...auth(a)).expect(200)).body
    expect(h.tasks.some((t: Task & { onTime: boolean | null }) => t.status === 'DONE' && t.onTime === true)).toBe(true)
    expect(h.tasks.some((t: Task) => t.status === 'OPEN' && t.reason === 'CALL_LATER')).toBe(true)
    expect(h.summary.completedThisWeek).toBeGreaterThanOrEqual(2)
    await request(app).get(`/api/dialer/tasks/history?rep=${a.id}`).set(...auth(b)).expect(403)
  })

  it('My To-Do shows call backs and added tasks, not the automatic follow-ups or closed ones', async () => {
    const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
    const r = (await request(app).get(`/api/worklog?from=${day(-2)}&to=${day(3)}`).set(...auth(a)).expect(200)).body
    const titles = r.entries.map((e: { title: string }) => e.title)
    expect(titles).toContain('Call back: Iris Interested')
    expect(titles).toContain('Email: Vale Voicemail')
    expect(titles.some((t: string) => t.startsWith('Follow up:'))).toBe(false)
  })

  it('bulk: Log touch, Add task and Reassign the due date on my own leads only', async () => {
    const d = await data(a)
    const ids = d.leads.map((l: Lead) => l.id)
    const t = (await request(app).post('/api/dialer/bulk').set(...auth(a)).send({ leadIds: ids, action: 'ADD_TASK', kind: 'TODO', at: new Date(Date.now() + 2 * 86400000).toISOString() }).expect(200)).body
    expect(t.updated).toBe(5)
    const moved = (await request(app).post('/api/dialer/bulk').set(...auth(a)).send({ leadIds: ids, action: 'RESCHEDULE', at: new Date(Date.now() + 4 * 86400000).toISOString() }).expect(200)).body
    expect(moved.updated).toBeGreaterThanOrEqual(5)
    await request(app).post('/api/dialer/bulk').set(...auth(b)).send({ leadIds: ids, action: 'LOG_TOUCH' }).expect(404)
    const touched = (await request(app).post('/api/dialer/bulk').set(...auth(a)).send({ leadIds: [lead(d, 'Ash Assigned').id], action: 'LOG_TOUCH', outcome: 'NO_ANSWER' }).expect(200)).body
    expect(touched.updated).toBe(1)
    expect(lead(await data(a), 'Ash Assigned')).toMatchObject({ attempts: 1, manualTouches: 1 })
  })

  it('touches and tasks survive a re-import', async () => {
    const before = await prisma.dialerTouch.count({ where: { lead: { ownerId: a.id } } })
    const tasks = await prisma.workLogEntry.count({ where: { userId: a.id, dialerLeadId: { not: null } } })
    await imp(a, SECOND()).expect(201)
    expect(await prisma.dialerTouch.count({ where: { lead: { ownerId: a.id } } })).toBe(before)
    expect(await prisma.workLogEntry.count({ where: { userId: a.id, dialerLeadId: { not: null } } })).toBeGreaterThanOrEqual(tasks)
    expect(await prisma.workLogEntry.count({ where: { userId: a.id, dialerLeadId: null } })).toBe(0)
  })
})
