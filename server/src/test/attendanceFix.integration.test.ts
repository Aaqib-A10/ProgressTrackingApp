import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import request from 'supertest'
import { DateTime } from 'luxon'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'

// A forgotten check-in: the day shows as Absent, the person asks for the times, their Team Lead approves (the times
// go on the day, audited) or rejects; nobody else decides, and the person is told either way.

const pk = (iso: string) => DateTime.fromISO(iso, { zone: 'Asia/Karachi' }).toJSDate()
const day = (ds: string) => new Date(`${ds}T00:00:00.000Z`)
const at = (iso: string) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(pk(iso)) }

let w: SeededWorld
beforeAll(async () => {
  w = await seedWorld()
  const uid = w.itadMember.id
  await prisma.user.update({ where: { id: uid }, data: { createdAt: pk('2026-09-01T10:00') } })
  await prisma.attendanceShift.create({ data: { userId: uid, startTime: '09:00', endTime: '18:00', graceMin: 10, requiredMinutes: 480, workingDays: [1, 2, 3, 4, 5], timeZone: null } })
  // Mon 19 present; Tue 20 forgotten (nothing); Wed 21 on leave.
  await prisma.attendanceDay.create({ data: { userId: uid, date: day('2026-10-19'), checkInAt: pk('2026-10-19T09:00'), checkOutAt: pk('2026-10-19T18:00') } })
  await prisma.leaveDay.create({ data: { userId: uid, date: day('2026-10-21'), type: 'ON_LEAVE' } })
})
afterEach(() => { vi.useRealTimers() })
afterAll(async () => { await prisma.$disconnect() })

type Row = { date: string; label: string; checkIn: string | null; checkOut: string | null }
const historyOf = async (who: { id: string; role: string }, userId?: string) =>
  (await request(app).get(`/api/attendance/history?range=custom&start=2026-10-19&end=2026-10-23${userId ? `&userId=${userId}` : ''}`).set(...auth(who as never)).expect(200)).body.rows as Row[]

describe('attendance fix requests', () => {
  it('the forgotten day shows as Absent to the person and to their lead', async () => {
    at('2026-10-22T20:00')
    expect((await historyOf(w.itadMember)).find((r) => r.date === '2026-10-20')?.label).toBe('ABSENT')
    expect((await historyOf(w.itadLead, w.itadMember.id)).find((r) => r.date === '2026-10-20')?.label).toBe('ABSENT')
  })

  it('checks what is asked for', async () => {
    at('2026-10-22T20:00')
    const ask = (body: object) => request(app).post('/api/attendance/fix-requests').set(...auth(w.itadMember))
      .send({ date: '2026-10-20', checkIn: '09:05', checkOut: '18:00', reason: 'Forgot to press check in', ...body })
    await ask({ date: '2026-10-25' }).expect(400) // not come yet
    await ask({ date: '2026-08-01' }).expect(400) // too old
    await ask({ date: '2026-10-21' }).expect(400) // a leave day
    await ask({ date: '2026-10-18' }).expect(400) // Sunday, not a working day
    await ask({ checkOut: '08:00' }).expect(400) // out before in
    await ask({ reason: 'x' }).expect(400)
    await ask({ checkIn: '9am' }).expect(400)
  })

  it('a lead approves: the times go on the day, the person is told, nobody else can decide', async () => {
    at('2026-10-22T20:00')
    const r = await request(app).post('/api/attendance/fix-requests').set(...auth(w.itadMember))
      .send({ date: '2026-10-20', checkIn: '09:05', checkOut: '18:00', reason: 'Forgot to press check in' }).expect(201)
    const id = r.body.request.id as string
    expect(r.body.request).toMatchObject({ date: '2026-10-20', checkIn: '09:05', checkOut: '18:00', status: 'PENDING' })
    // One waiting request per day.
    await request(app).post('/api/attendance/fix-requests').set(...auth(w.itadMember)).send({ date: '2026-10-20', checkIn: '09:00', reason: 'Again' }).expect(409)
    // The lead was told and sees it; a lead of another department does not, and cannot decide it.
    expect(await prisma.notification.count({ where: { userId: w.itadLead.id, type: 'ATTENDANCE_FIX_REQUESTED', entityId: id } })).toBe(1)
    const team = (await request(app).get('/api/attendance/fix-requests/team').set(...auth(w.itadLead)).expect(200)).body.requests
    expect(team.map((x: { id: string }) => x.id)).toContain(id)
    const other = (await request(app).get('/api/attendance/fix-requests/team').set(...auth(w.leadgenLead)).expect(200)).body.requests
    expect(other.map((x: { id: string }) => x.id)).not.toContain(id)
    await request(app).post(`/api/attendance/fix-requests/${id}/decision`).set(...auth(w.leadgenLead)).send({ approve: true }).expect(403)
    await request(app).post(`/api/attendance/fix-requests/${id}/decision`).set(...auth(w.itadMember)).send({ approve: true }).expect(403)

    await request(app).post(`/api/attendance/fix-requests/${id}/decision`).set(...auth(w.itadLead)).send({ approve: true, note: 'ok' }).expect(200)
    const row = (await historyOf(w.itadMember)).find((x) => x.date === '2026-10-20')
    expect(row).toMatchObject({ label: 'PRESENT', checkIn: '09:05', checkOut: '18:00' })
    expect(await prisma.notification.count({ where: { userId: w.itadMember.id, type: 'ATTENDANCE_FIX_DECIDED', entityId: id } })).toBe(1)
    expect(await prisma.auditLog.count({ where: { entityType: 'AttendanceDay', userId: w.itadLead.id } })).toBeGreaterThan(0)
    // Decided once.
    await request(app).post(`/api/attendance/fix-requests/${id}/decision`).set(...auth(w.itadLead)).send({ approve: false }).expect(409)
    const mine = (await request(app).get('/api/attendance/fix-requests/mine').set(...auth(w.itadMember)).expect(200)).body.requests
    expect(mine[0]).toMatchObject({ id, status: 'APPROVED', decisionNote: 'ok' })
  })

  it('rejected or taken back: the day stays as it was', async () => {
    at('2026-10-24T20:00')
    const a = (await request(app).post('/api/attendance/fix-requests').set(...auth(w.itadMember)).send({ date: '2026-10-22', checkIn: '09:00', reason: 'Phone died' }).expect(201)).body.request.id
    await request(app).post(`/api/attendance/fix-requests/${a}/decision`).set(...auth(w.itadLead)).send({ approve: false, note: 'You were not in' }).expect(200)
    expect((await historyOf(w.itadMember)).find((x) => x.date === '2026-10-22')?.label).toBe('ABSENT')
    const b = (await request(app).post('/api/attendance/fix-requests').set(...auth(w.itadMember)).send({ date: '2026-10-23', checkIn: '09:00', reason: 'Forgot' }).expect(201)).body.request.id
    await request(app).delete(`/api/attendance/fix-requests/${b}`).set(...auth(w.itadLead)).expect(404) // only the asker takes it back
    await request(app).delete(`/api/attendance/fix-requests/${b}`).set(...auth(w.itadMember)).expect(204)
    await request(app).post(`/api/attendance/fix-requests/${b}/decision`).set(...auth(w.itadLead)).send({ approve: true }).expect(409)
    expect((await historyOf(w.itadMember)).find((x) => x.date === '2026-10-23')?.label).toBe('ABSENT')
  })
})
