import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import request from 'supertest'
import { DateTime } from 'luxon'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'

// A Team Lead lets someone work from home: on those days (or always) they check in from any
// network, not only the office IP, and the lead sees their attendance as usual.

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'
const OFFICE_IP = '182.177.47.7'
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
  netId = (await prisma.officeNetwork.create({ data: { label: 'Office', cidr: OFFICE_IP } })).id
})
afterEach(() => { vi.useRealTimers() })
afterAll(async () => {
  await prisma.officeNetwork.delete({ where: { id: netId } })
  await prisma.$disconnect()
})

const clock = (u: SeededWorld['itadMember'], path: string, ip: string) =>
  request(app).post(`/api/attendance/${path}`).set(...auth(u)).set('User-Agent', DESKTOP_UA).set('X-Client-Mobile', '0').set('CF-Connecting-IP', ip)
const lead = (u: SeededWorld['itadLead']) => ({
  leave: (userId: string, date: string, body: object) => request(app).put(`/api/attendance/${userId}/leave/${date}`).set(...auth(u)).send(body),
  remote: (userId: string, remote: boolean) => request(app).put(`/api/attendance/${userId}/remote`).set(...auth(u)).send({ remote }),
  team: () => request(app).get('/api/attendance/team?range=week').set(...auth(u)).expect(200),
  history: (userId: string, q: string) => request(app).get(`/api/attendance/history?userId=${userId}&${q}`).set(...auth(u)).expect(200),
})

describe('work from home', () => {
  it('from home without permission: refused; office: fine', async () => {
    at('2026-10-12T09:05') // Monday
    const r = await clock(w.itadMember, 'check-in', HOME_IP).expect(403)
    expect(r.body.error).toMatch(/office network/)
    await clock(w.leadgenMember, 'check-in', OFFICE_IP).expect(200)
  })

  it('lead marks Wed to next Tue as work from home: only working days, check-in from home works on them', async () => {
    const L = lead(w.itadLead)
    const r = await L.leave(w.itadMember.id, '2026-10-14', { type: 'WFH', until: '2026-10-20' }).expect(200)
    expect(r.body.dates).toEqual(['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-19', '2026-10-20']) // no weekend

    at('2026-10-14T09:02')
    const c = await clock(w.itadMember, 'check-in', HOME_IP).expect(200)
    expect(c.body.workMode).toBe('WFH')

    // The lead sees it: WFH today in the team list, and the day is Present + WFH in their history.
    const t = await L.team()
    const row = t.body.rows.find((x: { userId: string }) => x.userId === w.itadMember.id)
    expect(row).toMatchObject({ workModeToday: 'WFH', todayState: 'IN', leaveDays: 0 })
    expect(t.body.board.find((b: { userId: string }) => b.userId === w.itadMember.id).workMode).toBe('WFH')
    const h = await L.history(w.itadMember.id, 'range=custom&start=2026-10-14&end=2026-10-14')
    expect(h.body.rows[0]).toMatchObject({ date: '2026-10-14', label: 'PRESENT', wfh: true, checkIn: '09:02' })

    // A day that is not marked is still office only.
    at('2026-10-21T09:00')
    await clock(w.itadMember, 'check-in', HOME_IP).expect(403)
  })

  it('"always works from home": check in from anywhere, any day, until switched off', async () => {
    const L = lead(w.itadLead)
    await L.remote(w.itadMember.id, true).expect(200)
    at('2026-10-22T09:00')
    const c = await clock(w.itadMember, 'check-in', HOME_IP).expect(200)
    expect(c.body.workMode).toBe('REMOTE')
    const t = await L.team()
    expect(t.body.rows.find((x: { userId: string }) => x.userId === w.itadMember.id)).toMatchObject({ remote: true, workModeToday: 'REMOTE' })

    await L.remote(w.itadMember.id, false).expect(200)
    at('2026-10-23T09:00')
    await clock(w.itadMember, 'check-in', HOME_IP).expect(403)
  })

  it('a lead cannot do it for another department or for themselves; a member cannot at all', async () => {
    await lead(w.itadLead).remote(w.leadgenMember.id, true).expect(403)
    await lead(w.itadLead).leave(w.leadgenMember.id, '2026-10-26', { type: 'WFH' }).expect(403)
    await lead(w.itadLead).remote(w.itadLead.id, true).expect(403)
    await lead(w.itadLead).leave(w.itadLead.id, '2026-10-26', { type: 'WFH' }).expect(403)
    await request(app).put(`/api/attendance/${w.itadMember.id}/remote`).set(...auth(w.itadMember)).send({ remote: true }).expect(403)
    // Super Admin can set it for a Team Lead.
    await request(app).put(`/api/attendance/${w.itadLead.id}/remote`).set(...auth(w.superAdmin)).send({ remote: true }).expect(200)
  })

  it('bad runs are refused', async () => {
    const L = lead(w.itadLead)
    expect((await L.leave(w.itadMember.id, '2026-10-20', { type: 'WFH', until: '2026-10-10' }).expect(400)).body.error).toMatch(/on or after/)
    await L.leave(w.itadMember.id, '2026-10-01', { type: 'WFH', until: '2026-12-31' }).expect(400)
    expect((await L.leave(w.itadMember.id, '2026-10-24', { type: 'WFH', until: '2026-10-25' }).expect(400)).body.error).toMatch(/no working days/)
  })
})
