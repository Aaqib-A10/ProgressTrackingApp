import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import request from 'supertest'
import { DateTime } from 'luxon'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { repairNightShiftDays } from '../lib/nightShiftRepair'

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'
const pk = (iso: string) => DateTime.fromISO(iso, { zone: 'Asia/Karachi' }).toJSDate()

let w: SeededWorld
beforeAll(async () => {
  w = await seedWorld()
  // Night shift in company time (Karachi), like the US-hours team: 19:00–04:00.
  await prisma.attendanceShift.create({
    data: { userId: w.itadMember.id, startTime: '19:00', endTime: '04:00', graceMin: 10, requiredMinutes: 480, workingDays: [1, 2, 3, 4, 5], timeZone: null },
  })
})
afterEach(() => { vi.useRealTimers() })
afterAll(async () => { await prisma.$disconnect() })

const at = (iso: string) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(pk(iso)) }
const post = (path: string) => request(app).post(`/api/attendance/${path}`).set(...auth(w.itadMember)).set('User-Agent', DESKTOP_UA).set('X-Client-Mobile', '0')

describe('night shift: early check-in the next evening', () => {
  it('last night: late check-in 19:21, check-out 04:00', async () => {
    at('2026-10-08T19:21')
    const a = await post('check-in').expect(200)
    expect(a.body.date).toBe('2026-10-08')
    expect(a.body.today.late).toBe(true)
    at('2026-10-09T04:00')
    const b = await post('check-out').expect(200)
    expect(b.body.date).toBe('2026-10-08')
    expect(b.body.today.workedMin).toBe(8 * 60 + 39)
  })

  it('the next afternoon the widget is a fresh day, not last night "Done"', async () => {
    at('2026-10-09T18:40')
    const me = await request(app).get('/api/attendance/me').set(...auth(w.itadMember)).expect(200)
    expect(me.body.date).toBe('2026-10-09')
    expect(me.body.today.state).toBe('NOT_IN')
  })

  it('an 18:45 check-in works, lands on tonight and is not late', async () => {
    at('2026-10-09T18:45')
    const r = await post('check-in').expect(200)
    expect(r.body.date).toBe('2026-10-09')
    expect(r.body.today.state).toBe('IN')
    expect(r.body.today.late).toBe(false)
    // Last night's record is untouched.
    const last = await prisma.attendanceDay.findFirst({ where: { userId: w.itadMember.id, date: new Date('2026-10-08T00:00:00Z') } })
    expect(last?.checkOutAt).not.toBeNull()
  })

  it('the 04:00 check-out closes tonight\'s shift', async () => {
    at('2026-10-10T04:02')
    const r = await post('check-out').expect(200)
    expect(r.body.date).toBe('2026-10-09')
    expect(r.body.today.state).toBe('OUT')
    expect(r.body.today.earlyLeave).toBe(false)
  })
})

describe('repair of check-ins the old rule filed a day early', () => {
  const day = (d: string) => new Date(`${d}T00:00:00Z`)
  it('unwinds a chain of early check-ins and leaves day-shift history alone', async () => {
    const uid = w.leadgenMember.id
    await prisma.attendanceShift.create({ data: { userId: uid, startTime: '19:00', endTime: '04:00', graceMin: 10, requiredMinutes: 480, workingDays: [1, 2, 3, 4, 5], timeZone: null } })
    await prisma.attendanceDay.createMany({
      data: [
        // Old day-shift record before the switch (10:30–19:00): must not move.
        { userId: uid, date: day('2026-10-02'), checkInAt: pk('2026-10-02T10:30'), checkOutAt: pk('2026-10-02T19:00') },
        // Mon 18:59 check-in filed on Sun.
        { userId: uid, date: day('2026-10-04'), checkInAt: pk('2026-10-05T18:59') },
        // Tue 18:58 check-in filed on Mon (on top of Monday night's 04:16 check-out).
        { userId: uid, date: day('2026-10-05'), checkInAt: pk('2026-10-06T18:58'), checkOutAt: pk('2026-10-06T04:16') },
        // Wed 18:45 check-in filed on Tue, with a check-out and a break that follow it.
        { userId: uid, date: day('2026-10-06'), checkInAt: pk('2026-10-07T18:45'), checkOutAt: pk('2026-10-08T04:00') },
      ],
    })
    const tue = await prisma.attendanceDay.findFirstOrThrow({ where: { userId: uid, date: day('2026-10-06') } })
    await prisma.breakEntry.create({ data: { dayId: tue.id, startAt: pk('2026-10-07T23:00'), endAt: pk('2026-10-07T23:30') } })

    const preview = await repairNightShiftDays({ apply: false, since: '2026-10-01' })
    expect(preview.moved).toBe(3)
    expect(await prisma.attendanceDay.count({ where: { userId: uid } })).toBe(4) // nothing saved

    const r = await repairNightShiftDays({ apply: true, since: '2026-10-01' })
    expect(r.moved).toBe(3)
    expect(r.manual).toEqual([])
    const rows = await prisma.attendanceDay.findMany({ where: { userId: uid }, orderBy: { date: 'asc' }, include: { breaks: true } })
    const view = rows.map((x) => [x.date.toISOString().slice(0, 10), x.checkInAt?.toISOString() ?? null, x.checkOutAt?.toISOString() ?? null, x.breaks.length])
    expect(view).toEqual([
      ['2026-10-02', pk('2026-10-02T10:30').toISOString(), pk('2026-10-02T19:00').toISOString(), 0],
      ['2026-10-05', pk('2026-10-05T18:59').toISOString(), pk('2026-10-06T04:16').toISOString(), 0],
      ['2026-10-06', pk('2026-10-06T18:58').toISOString(), null, 0],
      ['2026-10-07', pk('2026-10-07T18:45').toISOString(), pk('2026-10-08T04:00').toISOString(), 1],
    ])
  })
})
