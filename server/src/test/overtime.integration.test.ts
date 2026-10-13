import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import request from 'supertest'
import { DateTime } from 'luxon'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { runAutoCheckoutTick } from '../lib/autoCheckout'

// Checked out by PulseTrack when the shift's 9 hours are up, unless "Start overtime" was pressed.

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'
const pk = (iso: string) => DateTime.fromISO(iso, { zone: 'Asia/Karachi' }).toJSDate()

let w: SeededWorld
beforeAll(async () => {
  w = await seedWorld()
  // 11:00–20:00 (9 hours) for both people, company time.
  for (const u of [w.itadMember, w.leadgenMember]) {
    await prisma.attendanceShift.create({ data: { userId: u.id, startTime: '11:00', endTime: '20:00', graceMin: 10, requiredMinutes: 480, workingDays: [1, 2, 3, 4, 5], timeZone: null } })
  }
})
afterEach(() => { vi.useRealTimers() })
afterAll(async () => { await prisma.$disconnect() })

const at = (iso: string) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(pk(iso)) }
const as = (u: SeededWorld['itadMember']) => ({
  post: (path: string) => request(app).post(`/api/attendance/${path}`).set(...auth(u)).set('User-Agent', DESKTOP_UA).set('X-Client-Mobile', '0'),
  me: () => request(app).get('/api/attendance/me').set(...auth(u)),
})

describe('automatic check-out after the shift hours', () => {
  it('shows when it will happen, then checks out at exactly 9 hours and leaves a notice', async () => {
    const a = as(w.itadMember)
    at('2026-10-13T11:20')
    const r = await a.post('check-in').expect(200)
    expect(r.body.today).toMatchObject({ overtime: false, autoCheckoutLabel: '8:20 PM', shiftHoursMin: 540 })
    expect(Date.parse(r.body.serverNow)).toBe(pk('2026-10-13T11:20').getTime())

    expect((await runAutoCheckoutTick({ now: pk('2026-10-13T20:19') })).closed).toBe(0)
    const t = await runAutoCheckoutTick({ now: pk('2026-10-13T20:21') })
    expect(t.rows).toEqual([expect.objectContaining({ userId: w.itadMember.id, checkOutAt: pk('2026-10-13T20:20').toISOString(), overtime: false })])

    at('2026-10-13T20:22')
    const after = await a.me().expect(200)
    expect(after.body.today).toMatchObject({ state: 'OUT', checkOutLabel: '8:20 PM', workedMin: 540 })
    // Pressing check-out on a stale screen gets a clear answer, not a crash.
    expect((await a.post('check-out').expect(409)).body.error).toMatch(/already checked out/i)
    const n = await prisma.notification.findFirst({ where: { userId: w.itadMember.id, type: 'AUTO_CHECKOUT' } })
    expect(n?.body).toContain('8:20 PM')
  })

  it('with "Start overtime" the clock keeps running and the extra time is counted', async () => {
    const a = as(w.leadgenMember)
    at('2026-10-13T11:00')
    await a.post('overtime').expect(409) // not checked in yet
    await a.post('check-in').expect(200)
    at('2026-10-13T19:50')
    const o = await a.post('overtime').expect(200)
    expect(o.body.today).toMatchObject({ overtime: true, autoCheckoutLabel: '12:00 AM' })

    expect((await runAutoCheckoutTick({ now: pk('2026-10-13T21:30') })).closed).toBe(0)
    at('2026-10-13T21:30')
    expect((await a.me().expect(200)).body.today).toMatchObject({ state: 'IN', overtime: true, overtimeMin: 90 })

    await a.post('check-out').expect(200)
    const h = await request(app).get('/api/attendance/history?range=custom&start=2026-10-13&end=2026-10-13').set(...auth(w.leadgenMember)).expect(200)
    expect(h.body.rows[0]).toMatchObject({ overtimeMin: 90 })
  })

  it('a forgotten overtime clock is closed after 4 hours of overtime', async () => {
    const day = await prisma.attendanceDay.create({
      data: { userId: w.inventoryMember.id, date: new Date('2026-10-12T00:00:00Z'), checkInAt: pk('2026-10-12T11:00'), overtimeAt: pk('2026-10-12T19:00') },
    })
    const t = await runAutoCheckoutTick({ now: pk('2026-10-13T09:00') })
    expect(t.rows.find((r) => r.userId === w.inventoryMember.id)).toMatchObject({ overtime: true, checkOutAt: pk('2026-10-13T00:00').toISOString() })
    expect((await prisma.attendanceDay.findUniqueOrThrow({ where: { id: day.id } })).note).toMatch(/overtime/)
  })
})
