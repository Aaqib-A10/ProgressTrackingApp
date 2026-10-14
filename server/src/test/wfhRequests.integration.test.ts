import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import request from 'supertest'
import { DateTime } from 'luxon'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'

// Employee asks their Team Lead to work from home; approved days allow check-in from any network.

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'
const HOME_IP = '39.50.1.2'
const pk = (iso: string) => DateTime.fromISO(iso, { zone: 'Asia/Karachi' }).toJSDate()
const at = (iso: string) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(pk(iso)) }

let w: SeededWorld
let netId: string
beforeAll(async () => {
  w = await seedWorld()
  for (const u of [w.itadMember, w.itadLead, w.leadgenMember]) {
    await prisma.attendanceShift.create({ data: { userId: u.id, startTime: '09:00', endTime: '18:00', graceMin: 10, requiredMinutes: 480, workingDays: [1, 2, 3, 4, 5], timeZone: null } })
  }
  netId = (await prisma.officeNetwork.create({ data: { label: 'Office', cidr: '182.177.47.7' } })).id
})
afterEach(() => { vi.useRealTimers() })
afterAll(async () => {
  await prisma.officeNetwork.delete({ where: { id: netId } })
  await prisma.$disconnect()
})

type U = SeededWorld['itadMember']
const ask = (u: U, body: object) => request(app).post('/api/attendance/wfh-requests').set(...auth(u)).send(body)
const mine = (u: U) => request(app).get('/api/attendance/wfh-requests/mine').set(...auth(u)).expect(200)
const inbox = (u: U, status = 'PENDING') => request(app).get(`/api/attendance/wfh-requests/team?status=${status}`).set(...auth(u))
const decide = (u: U, id: string, approve: boolean, note?: string) => request(app).post(`/api/attendance/wfh-requests/${id}/decision`).set(...auth(u)).send({ approve, note })
const checkIn = (u: U) => request(app).post('/api/attendance/check-in').set(...auth(u)).set('User-Agent', DESKTOP_UA).set('X-Client-Mobile', '0').set('CF-Connecting-IP', HOME_IP)
const bell = (u: U) => prisma.notification.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'desc' } })

describe('work from home requests', () => {
  it('member asks, lead is notified, approves; check-in from home works on those days only', async () => {
    at('2026-10-14T20:00') // Wednesday evening
    const r = await ask(w.itadMember, { startDate: '2026-10-16', endDate: '2026-10-19', reason: 'Internet engineer visiting home' }).expect(201)
    expect(r.body.request).toMatchObject({ status: 'PENDING', days: ['2026-10-16', '2026-10-19'] }) // Fri + Mon, weekend skipped

    const n = (await bell(w.itadLead))[0]
    expect(n).toMatchObject({ type: 'WFH_REQUESTED', title: 'itad member asks to work from home', link: '/app/attendance/team?wfh=1' })
    expect((await bell(w.leadgenLead)).some((x) => x.type === 'WFH_REQUESTED')).toBe(false) // other department not told

    const box = await inbox(w.itadLead).expect(200)
    expect(box.body.requests.map((x: { id: string }) => x.id)).toEqual([r.body.request.id])
    expect((await inbox(w.leadgenLead).expect(200)).body.requests).toEqual([])

    const d = await decide(w.itadLead, r.body.request.id, true, 'Fine').expect(200)
    expect(d.body.marked).toEqual(['2026-10-16', '2026-10-19'])
    expect((await bell(w.itadMember))[0]).toMatchObject({ type: 'WFH_DECIDED', title: 'Work from home approved' })
    expect((await mine(w.itadMember)).body.requests[0]).toMatchObject({ status: 'APPROVED', decidedBy: 'itad lead', decisionNote: 'Fine' })

    at('2026-10-15T09:00') // Thursday, not asked for
    await checkIn(w.itadMember).expect(403)
    at('2026-10-16T09:00')
    expect((await checkIn(w.itadMember).expect(200)).body.workMode).toBe('WFH')

    // Asking again for an approved day is refused.
    at('2026-10-16T12:00')
    expect((await ask(w.itadMember, { startDate: '2026-10-19', reason: 'again please' }).expect(409)).body.error).toMatch(/approved/)
  })

  it('reject, cancel, and the rules', async () => {
    at('2026-10-14T10:00')
    const a = await ask(w.itadMember, { startDate: '2026-10-21', reason: 'Plumber coming' }).expect(201)
    const rej = await decide(w.itadLead, a.body.request.id, false, 'Busy week').expect(200)
    expect(rej.body.marked).toEqual([])
    expect((await bell(w.itadMember))[0]).toMatchObject({ title: 'Work from home not approved' })
    await decide(w.itadLead, a.body.request.id, true).expect(409) // already decided
    expect(await prisma.leaveDay.count({ where: { userId: w.itadMember.id, date: new Date('2026-10-21T00:00:00Z') } })).toBe(0)

    const b = await ask(w.itadMember, { startDate: '2026-10-22', reason: 'Plumber again' }).expect(201)
    await request(app).delete(`/api/attendance/wfh-requests/${b.body.request.id}`).set(...auth(w.leadgenMember)).expect(404) // not theirs
    await request(app).delete(`/api/attendance/wfh-requests/${b.body.request.id}`).set(...auth(w.itadMember)).expect(204)
    await decide(w.itadLead, b.body.request.id, true).expect(409)

    expect((await ask(w.itadMember, { startDate: '2026-10-13', reason: 'yesterday' }).expect(400)).body.error).toMatch(/passed/)
    expect((await ask(w.itadMember, { startDate: '2026-10-24', endDate: '2026-10-25', reason: 'weekend' }).expect(400)).body.error).toMatch(/no working days/)
    await ask(w.itadMember, { startDate: '2026-10-20', endDate: '2026-12-31', reason: 'too long' }).expect(400)
    await ask(w.itadMember, { startDate: '2026-10-20', reason: 'x' }).expect(400) // reason too short
  })

  it('who can decide: own department lead or Super Admin, never yourself; a lead\'s request goes to Super Admins', async () => {
    at('2026-10-14T10:00')
    const m = await ask(w.itadMember, { startDate: '2026-10-27', reason: 'Family matter' }).expect(201)
    await decide(w.leadgenLead, m.body.request.id, true).expect(403)
    await decide(w.itadMember, m.body.request.id, true).expect(403)

    const l = await ask(w.itadLead, { startDate: '2026-10-27', reason: 'Car in the garage' }).expect(201)
    expect((await bell(w.superAdmin)).some((x) => x.type === 'WFH_REQUESTED' && x.entityId === l.body.request.id)).toBe(true)
    await decide(w.itadLead, l.body.request.id, true).expect(403) // own request
    expect((await inbox(w.itadLead).expect(200)).body.requests.some((x: { id: string }) => x.id === l.body.request.id)).toBe(false)
    await decide(w.superAdmin, l.body.request.id, true).expect(200)

    await inbox(w.itadMember).expect(403) // members have no inbox
  })
})
