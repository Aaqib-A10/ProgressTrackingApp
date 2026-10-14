import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import request from 'supertest'
import { DateTime } from 'luxon'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'

// My Attendance with "Today" picked before check-in used to be blank. Today now always shows.

const pk = (iso: string) => DateTime.fromISO(iso, { zone: 'Asia/Karachi' }).toJSDate()
const at = (iso: string) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(pk(iso)) }

let w: SeededWorld
beforeAll(async () => {
  w = await seedWorld()
  await prisma.attendanceShift.create({ data: { userId: w.itadMember.id, startTime: '09:00', endTime: '18:00', graceMin: 10, requiredMinutes: 480, workingDays: [1, 2, 3, 4, 5], timeZone: null } })
  // Night shift, 19:00 to 04:00.
  await prisma.attendanceShift.create({ data: { userId: w.leadgenMember.id, startTime: '19:00', endTime: '04:00', graceMin: 10, requiredMinutes: 480, workingDays: [1, 2, 3, 4, 5], timeZone: null } })
})
afterEach(() => { vi.useRealTimers() })
afterAll(async () => { await prisma.$disconnect() })

const hist = (u: SeededWorld['itadMember'], range: string) => request(app).get(`/api/attendance/history?range=${range}`).set(...auth(u)).expect(200)

describe('My Attendance, Today', () => {
  it('shows today as "not checked in yet" before check-in, not an empty page', async () => {
    at('2026-10-14T04:57') // a Wednesday, before the 09:00 shift
    const r = await hist(w.itadMember, 'today')
    expect(r.body.rows).toEqual([expect.objectContaining({ date: '2026-10-14', label: 'NOT_YET', checkIn: null })])
    expect(r.body.summary).toMatchObject({ presentDays: 0, lateDays: 0 })
  })

  it('a past working day without check-in is still absent', async () => {
    at('2026-10-14T04:57')
    const r = await hist(w.itadMember, 'week')
    const byDate = Object.fromEntries(r.body.rows.map((x: { date: string; label: string }) => [x.date, x.label]))
    expect(byDate['2026-10-14']).toBe('NOT_YET')
    expect(byDate['2026-10-12']).toBeUndefined() // past days with nothing are not invented
  })

  it('a night shift at 02:00 sees the shift that started last evening under Today', async () => {
    await prisma.attendanceDay.create({ data: { userId: w.leadgenMember.id, date: new Date('2026-10-13T00:00:00Z'), checkInAt: pk('2026-10-13T19:02') } })
    at('2026-10-14T02:00')
    const r = await hist(w.leadgenMember, 'today')
    expect(r.body.rows).toEqual([expect.objectContaining({ date: '2026-10-13', label: 'PRESENT' })])
  })
})
