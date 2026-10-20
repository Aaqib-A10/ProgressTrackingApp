import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import request from 'supertest'
import { DateTime } from 'luxon'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'

// Left early only when the hours were not completed; full history with absent days; the
// Team Lead's register (every member x every day with check in and check out).

const pk = (iso: string) => DateTime.fromISO(iso, { zone: 'Asia/Karachi' }).toJSDate()
const day = (ds: string) => new Date(`${ds}T00:00:00.000Z`)

let w: SeededWorld
beforeAll(async () => {
  w = await seedWorld()
  const uid = w.leadgenMember.id
  await prisma.user.update({ where: { id: uid }, data: { createdAt: pk('2026-09-01T10:00') } })
  // Custom hours: 09:00 to 18:00, 8 hours required, Monday to Friday.
  await prisma.attendanceShift.create({ data: { userId: uid, startTime: '09:00', endTime: '18:00', graceMin: 10, requiredMinutes: 480, workingDays: [1, 2, 3, 4, 5], timeZone: null } })
  // Mon 19: came early 08:40, left 17:40, 45 min break -> 8h15m worked: full shift, NOT left early.
  const mon = await prisma.attendanceDay.create({ data: { userId: uid, date: day('2026-10-19'), checkInAt: pk('2026-10-19T08:40'), checkOutAt: pk('2026-10-19T17:40') } })
  await prisma.breakEntry.create({ data: { dayId: mon.id, type: 'BREAK', startAt: pk('2026-10-19T13:00'), endAt: pk('2026-10-19T13:45') } })
  // Tue 20: on time, left at 16:00 -> 7h worked: left early.
  await prisma.attendanceDay.create({ data: { userId: uid, date: day('2026-10-20'), checkInAt: pk('2026-10-20T09:00'), checkOutAt: pk('2026-10-20T16:00') } })
  // Wed 21: nothing (absent). Thu 22: on leave.
  await prisma.leaveDay.create({ data: { userId: uid, date: day('2026-10-22'), type: 'ON_LEAVE' } })
})
afterEach(() => { vi.useRealTimers() })
afterAll(async () => { await prisma.$disconnect() })

const at = (iso: string) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(pk(iso)) }
type Row = { date: string; label: string; checkIn: string | null; checkOut: string | null; earlyLeave: boolean; completed: boolean; workedMin: number | null }

describe('left early', () => {
  it('came early and completed the hours: full shift, not left early; short day: left early', async () => {
    at('2026-10-23T20:00')
    const r = await request(app).get('/api/attendance/history?range=custom&start=2026-10-19&end=2026-10-23').set(...auth(w.leadgenMember)).expect(200)
    const by = Object.fromEntries((r.body.rows as Row[]).map((x) => [x.date, x]))
    expect(by['2026-10-19']).toMatchObject({ checkIn: '08:40', checkOut: '17:40', workedMin: 495, completed: true, earlyLeave: false })
    expect(by['2026-10-20']).toMatchObject({ checkOut: '16:00', completed: false, earlyLeave: true })
  })

  it('the lead sees the same flags for that person', async () => {
    at('2026-10-23T20:00')
    const r = await request(app).get(`/api/attendance/history?range=custom&start=2026-10-19&end=2026-10-23&userId=${w.leadgenMember.id}`).set(...auth(w.leadgenLead)).expect(200)
    const by = Object.fromEntries((r.body.rows as Row[]).map((x) => [x.date, x]))
    expect(by['2026-10-19'].earlyLeave).toBe(false)
    expect(by['2026-10-20'].earlyLeave).toBe(true)
  })
})

describe('full history', () => {
  it('all=1 lists every day up to today, with the missed working day as Absent', async () => {
    at('2026-10-23T20:00')
    const r = await request(app).get('/api/attendance/history?range=custom&start=2026-10-19&end=2026-10-31&all=1').set(...auth(w.leadgenMember)).expect(200)
    const labels = Object.fromEntries((r.body.rows as Row[]).map((x) => [x.date, x.label]))
    expect(labels).toMatchObject({ '2026-10-19': 'PRESENT', '2026-10-20': 'PRESENT', '2026-10-21': 'ABSENT', '2026-10-22': 'ON_LEAVE', '2026-10-23': 'NOT_YET' })
    // Weekend days are weekly off (shown), future working days are not listed.
    expect(labels['2026-10-24']).toBe('WEEKLY_OFF')
    expect(labels['2026-10-26']).toBeUndefined()
    // Without all=1 the absent day is not invented (the old behaviour other screens rely on).
    const old = await request(app).get('/api/attendance/history?range=custom&start=2026-10-19&end=2026-10-23').set(...auth(w.leadgenMember)).expect(200)
    expect((old.body.rows as Row[]).some((x) => x.date === '2026-10-21')).toBe(false)
  })

  it('nothing before the person joined', async () => {
    at('2026-10-23T20:00')
    const r = await request(app).get('/api/attendance/history?range=custom&start=2026-08-20&end=2026-09-05&all=1').set(...auth(w.leadgenMember)).expect(200)
    expect((r.body.rows as Row[]).filter((x) => x.label === 'ABSENT').every((x) => x.date >= '2026-09-01')).toBe(true)
  })
})

describe('team register', () => {
  it('lead gets every member x every day with in and out times and totals', async () => {
    at('2026-10-23T20:00')
    const r = await request(app).get('/api/attendance/register?start=2026-10-19&end=2026-10-25').set(...auth(w.leadgenLead)).expect(200)
    expect(r.body.dates).toHaveLength(7)
    const m = r.body.members.find((x: { userId: string }) => x.userId === w.leadgenMember.id)
    expect(m.hasOverride).toBe(true)
    expect(m.cells[0]).toMatchObject({ label: 'PRESENT', checkIn: '08:40', checkOut: '17:40', earlyLeave: false, completed: true })
    expect(m.cells[1]).toMatchObject({ label: 'PRESENT', checkOut: '16:00', earlyLeave: true })
    expect(m.cells[2].label).toBe('ABSENT')
    expect(m.cells[3].label).toBe('ON_LEAVE')
    expect(m.cells[4].label).toBe('NOT_YET')
    expect(m.cells[6]).toBeNull() // Sunday 25 is in the future
    expect(m.totals).toMatchObject({ present: 2, absent: 1, leave: 1, leftEarly: 1, fullShifts: 1, workedMin: 495 + 420, avgCheckIn: '08:50' })
    // Only their own department.
    expect(r.body.members.some((x: { userId: string }) => x.userId === w.itadMember.id)).toBe(false)
  })

  it('Super Admin can see one department; members and bad ranges are refused', async () => {
    at('2026-10-23T20:00')
    const sa = await request(app).get('/api/attendance/register?start=2026-10-19&end=2026-10-25&department=LEAD_GEN').set(...auth(w.superAdmin)).expect(200)
    expect(sa.body.members.some((x: { userId: string }) => x.userId === w.leadgenMember.id)).toBe(true)
    expect(sa.body.members.some((x: { userId: string }) => x.userId === w.itadMember.id)).toBe(false)
    await request(app).get('/api/attendance/register?start=2026-10-19&end=2026-10-25').set(...auth(w.leadgenMember)).expect(403)
    await request(app).get('/api/attendance/register?start=2026-10-25&end=2026-10-19').set(...auth(w.leadgenLead)).expect(400)
    await request(app).get('/api/attendance/register?start=2026-01-01&end=2026-06-30').set(...auth(w.leadgenLead)).expect(400)
  })
})

// Day shift 11:00 to 20:00, worked past midnight: that session belongs to the day before, so the
// next day's check-in is not blocked by a finished "today".
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'
const clock = (u: SeededWorld['itadLead'], path: string) => request(app).post(`/api/attendance/${path}`).set(...auth(u)).set('User-Agent', DESKTOP_UA).set('X-Client-Mobile', '0')

describe('day shift: worked past midnight', () => {
  it('in 00:19, out 04:05 files on the day before; the evening check-in works', async () => {
    const u = w.itadLead
    await prisma.attendanceShift.create({ data: { userId: u.id, startTime: '11:00', endTime: '20:00', graceMin: 10, requiredMinutes: 480, workingDays: [1, 2, 3, 4, 5], timeZone: null } })
    at('2026-10-20T00:19')
    const a = await clock(u, 'check-in').expect(200)
    expect(a.body.date).toBe('2026-10-19')
    expect(a.body.today.state).toBe('IN')
    at('2026-10-20T04:05') // after the 03:30 split: check-out still finds the open session
    const b = await clock(u, 'check-out').expect(200)
    expect(b.body.today.state).toBe('NOT_IN') // today (20th) is free
    const prev = await prisma.attendanceDay.findUnique({ where: { userId_date: { userId: u.id, date: day('2026-10-19') } } })
    expect(prev?.checkOutAt?.toISOString()).toBe(pk('2026-10-20T04:05').toISOString())
    at('2026-10-20T18:41')
    const me = await request(app).get('/api/attendance/me').set(...auth(u)).expect(200)
    expect(me.body).toMatchObject({ date: '2026-10-20', today: { state: 'NOT_IN' } })
    const c = await clock(u, 'check-in').expect(200)
    expect(c.body).toMatchObject({ date: '2026-10-20', today: { state: 'IN' } })
  })

  it('data saved under the old rule (session on today) no longer blocks; hours are not inflated', async () => {
    const u = w.leadgenLead
    await prisma.attendanceShift.create({ data: { userId: u.id, startTime: '11:00', endTime: '20:00', graceMin: 10, requiredMinutes: 480, workingDays: [1, 2, 3, 4, 5], timeZone: null } })
    await prisma.attendanceDay.create({ data: { userId: u.id, date: day('2026-10-19'), checkInAt: pk('2026-10-19T11:00'), checkOutAt: pk('2026-10-19T20:00') } })
    await prisma.attendanceDay.create({ data: { userId: u.id, date: day('2026-10-20'), checkInAt: pk('2026-10-20T00:19'), checkOutAt: pk('2026-10-20T04:05') } })
    at('2026-10-20T18:41')
    const me = await request(app).get('/api/attendance/me').set(...auth(u)).expect(200)
    expect(me.body.today.state).toBe('NOT_IN') // not "Done"
    const c = await clock(u, 'check-in').expect(200)
    expect(c.body).toMatchObject({ date: '2026-10-20', today: { state: 'IN' } })
    // The late session joined the 19th; the 20:00 to 00:19 gap is time away, not work.
    const h = await request(app).get('/api/attendance/history?range=custom&start=2026-10-19&end=2026-10-19').set(...auth(u)).expect(200)
    expect(h.body.rows[0]).toMatchObject({ checkIn: '11:00', checkOut: '04:05', workedMin: 540 + 226 })
  })

  it('still short while working is not shown; it appears once checked out', async () => {
    at('2026-10-20T19:30')
    const h = await request(app).get('/api/attendance/history?range=custom&start=2026-10-20&end=2026-10-20').set(...auth(w.itadLead)).expect(200)
    expect(h.body.rows[0]).toMatchObject({ label: 'PRESENT', checkOut: null, shortMin: null })
  })
})
