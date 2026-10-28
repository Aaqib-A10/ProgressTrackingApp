import { describe, it, expect, beforeAll, afterAll, vi, onTestFinished } from 'vitest'
import request from 'supertest'
import { DateTime } from 'luxon'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { runBreakCutoffTick } from '../lib/breakCutoff'

// E-commerce, Oct 2026: "access of breaks of our employees, overtime, break cut-off if he forgets;
// no changes allowed in stock tracking, add an edit option".

const pk = (iso: string) => DateTime.fromISO(iso, { zone: 'Asia/Karachi' }).toJSDate()
const DAY = '2026-10-20'

let w: SeededWorld
let dayId: string
let lunchId: string
let ecom: { lead: { id: string; role: 'TEAM_LEAD' }; m1: { id: string; role: 'MEMBER' }; m2: { id: string; role: 'MEMBER' }; m2Name: string }

beforeAll(async () => {
  w = await seedWorld()
  await prisma.attendanceShift.create({ data: { userId: w.itadMember.id, startTime: '11:00', endTime: '20:00', graceMin: 10, requiredMinutes: 480, workingDays: [1, 2, 3, 4, 5], timeZone: null } })
  const day = await prisma.attendanceDay.create({ data: { userId: w.itadMember.id, date: new Date(`${DAY}T00:00:00Z`), checkInAt: pk(`${DAY}T11:00`), checkOutAt: pk(`${DAY}T20:00`) } })
  dayId = day.id
  lunchId = (await prisma.breakEntry.create({ data: { dayId, type: 'BREAK', startAt: pk(`${DAY}T14:00`), endAt: pk(`${DAY}T14:30`) } })).id

  const dept = await prisma.department.create({ data: { type: 'ECOMMERCE', name: 'E-commerce' } })
  const mk = (name: string, role: 'TEAM_LEAD' | 'MEMBER') => prisma.user.create({ data: { name, email: `${name.replace(/\s+/g, '.')}@test.local`, role, status: 'ACTIVE', isActive: true, passwordHash: 'x', departmentId: dept.id } })
  const [lead, m1, m2] = await Promise.all([mk('ecom lead', 'TEAM_LEAD'), mk('ecom one', 'MEMBER'), mk('ecom two', 'MEMBER')])
  ecom = { lead: { id: lead.id, role: 'TEAM_LEAD' }, m1: { id: m1.id, role: 'MEMBER' }, m2: { id: m2.id, role: 'MEMBER' }, m2Name: m2.name }
})
afterAll(async () => { await prisma.$disconnect() })

const breaksUrl = (userId: string, date = DAY) => `/api/attendance/${userId}/${date}/breaks`

describe('team lead edits breaks', () => {
  it('only the team lead of that team (or a Super Admin) can see and change them', async () => {
    const r = await request(app).get(breaksUrl(w.itadMember.id)).set(...auth(w.itadLead)).expect(200)
    expect(r.body).toMatchObject({ checkIn: '11:00', checkOut: '20:00', overtime: null, allowance: { breakCutoffMin: 90, brbCutoffMin: 30 } })
    expect(r.body.breaks).toEqual([expect.objectContaining({ id: lunchId, type: 'BREAK', start: '14:00', end: '14:30', minutes: 30, running: false })])
    await request(app).get(breaksUrl(w.itadMember.id)).set(...auth(w.superAdmin)).expect(200)
    await request(app).get(breaksUrl(w.itadMember.id)).set(...auth(w.leadgenLead)).expect(403)
    await request(app).get(breaksUrl(w.itadMember.id)).set(...auth(w.itadMember)).expect(403)
    await request(app).patch(`/api/attendance/breaks/${lunchId}`).set(...auth(w.leadgenLead)).send({ end: '14:20' }).expect(403)
    await request(app).delete(`/api/attendance/breaks/${lunchId}`).set(...auth(w.itadMember)).expect(403)
  })

  it('adds a missed break, but not outside the day or over another break', async () => {
    const add = (body: object) => request(app).post(breaksUrl(w.itadMember.id)).set(...auth(w.itadLead)).send(body)
    expect((await add({ type: 'BRB', start: '14:10', end: '14:20' }).expect(400)).body.error).toMatch(/overlaps/i)
    expect((await add({ type: 'BRB', start: '10:00', end: '10:15' }).expect(400)).body.error).toMatch(/before check-in/i)
    expect((await add({ type: 'BRB', start: '19:50', end: '20:30' }).expect(400)).body.error).toMatch(/after check-out/i)
    expect((await add({ type: 'BRB', start: '16:15', end: '16:00' }).expect(400)).body.error).toMatch(/end after it starts/i)
    const r = await add({ type: 'BRB', start: '16:00', end: '16:15' }).expect(201)
    expect(r.body.break).toMatchObject({ type: 'BRB', start: '16:00', end: '16:15', minutes: 15, edited: true })
    // No check-in that day → nothing to add a break to.
    await request(app).post(breaksUrl(w.itadMember.id, '2026-10-19')).set(...auth(w.itadLead)).send({ type: 'BREAK', start: '14:00', end: '14:30' }).expect(400)
  })

  it('changes a break, tells the person, and keeps it in the activity log', async () => {
    const r = await request(app).patch(`/api/attendance/breaks/${lunchId}`).set(...auth(w.itadLead)).send({ end: '14:45' }).expect(200)
    expect(r.body.break).toMatchObject({ start: '14:00', end: '14:45', minutes: 45, edited: true })
    const n = await prisma.notification.findFirst({ where: { userId: w.itadMember.id, type: 'ATTENDANCE_EDITED' }, orderBy: { createdAt: 'desc' } })
    expect(n?.body).toContain('14:00 to 14:30 is now 14:00 to 14:45')
    const log = await prisma.auditLog.findFirst({ where: { entityType: 'BreakEntry', entityId: lunchId, action: 'UPDATE' } })
    expect(log?.userId).toBe(w.itadLead.id)
    // Moving it onto the BRB added above is refused.
    await request(app).patch(`/api/attendance/breaks/${lunchId}`).set(...auth(w.itadLead)).send({ start: '15:50', end: '16:05' }).expect(400)
  })

  it('deletes a wrong break', async () => {
    const extra = await prisma.breakEntry.create({ data: { dayId, type: 'BREAK', startAt: pk(`${DAY}T18:00`), endAt: pk(`${DAY}T18:10`) } })
    await request(app).delete(`/api/attendance/breaks/${extra.id}`).set(...auth(w.itadLead)).expect(204)
    expect(await prisma.breakEntry.findUnique({ where: { id: extra.id } })).toBeNull()
    expect(await prisma.auditLog.count({ where: { entityType: 'BreakEntry', entityId: extra.id, action: 'DELETE' } })).toBe(1)
  })

  // Run at a fixed time of day, including just after midnight: the test used to file the day under
  // the calendar date instead of the check-in day, so it failed when GitHub ran it after midnight.
  it.each(['2026-10-22T15:00', '2026-10-23T00:30'])('ends a break that is still running, right now (at %s)', async (at) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(pk(at))
    onTestFinished(() => { vi.useRealTimers() })
    const now = Date.now()
    const checkIn = new Date(now - 2 * 3600_000)
    // The attendance day is the day the person checked in (as the app files it).
    const day = DateTime.fromJSDate(checkIn).setZone('Asia/Karachi').toISODate()!
    const d = await prisma.attendanceDay.create({ data: { userId: w.itadMember.id, date: new Date(`${day}T00:00:00Z`), checkInAt: checkIn } })
    const b = await prisma.breakEntry.create({ data: { dayId: d.id, type: 'BREAK', startAt: new Date(now - 20 * 60_000) } })
    const team = await request(app).get('/api/attendance/team').set(...auth(w.itadLead)).expect(200)
    const rows = JSON.stringify(team.body)
    expect(rows).toContain(b.id) // the board shows who is on a break, with an End button
    const r = await request(app).patch(`/api/attendance/breaks/${b.id}`).set(...auth(w.itadLead)).send({ end: 'now' }).expect(200)
    expect(r.body.break).toMatchObject({ running: false })
    expect(r.body.break.minutes).toBeGreaterThanOrEqual(19)
    await prisma.attendanceDay.delete({ where: { id: d.id } })
  })
})

describe('overtime set by the team lead', () => {
  const fix = (body: object) => request(app).patch(`/api/attendance/${w.itadMember.id}/${DAY}`).set(...auth(w.itadLead)).send(body)
  it('sets, checks and clears when overtime started', async () => {
    expect((await fix({ overtime: '19:00' }).expect(200)).body.day).toMatchObject({ overtime: '19:00', checkOut: '20:00' })
    expect((await prisma.attendanceDay.findUniqueOrThrow({ where: { id: dayId } })).overtimeAt?.toISOString()).toBe(pk(`${DAY}T19:00`).toISOString())
    expect((await fix({ overtime: '20:30' }).expect(400)).body.error).toMatch(/overtime/i)
    expect((await fix({ overtime: '' }).expect(200)).body.day.overtime).toBeNull()
    await request(app).patch(`/api/attendance/${w.itadMember.id}/${DAY}`).set(...auth(w.leadgenLead)).send({ overtime: '19:00' }).expect(403)
  })
})

describe('break cut-off', () => {
  it('ends a forgotten break at the cut-off and tells the person and their team lead', async () => {
    const date = '2026-10-21'
    const d = await prisma.attendanceDay.create({ data: { userId: w.leadgenMember.id, date: new Date(`${date}T00:00:00Z`), checkInAt: pk(`${date}T11:00`) } })
    const brk = await prisma.breakEntry.create({ data: { dayId: d.id, type: 'BREAK', startAt: pk(`${date}T13:00`) } })
    const d2 = await prisma.attendanceDay.create({ data: { userId: w.itadLead.id, date: new Date(`${date}T00:00:00Z`), checkInAt: pk(`${date}T11:00`) } })
    const brb = await prisma.breakEntry.create({ data: { dayId: d2.id, type: 'BRB', startAt: pk(`${date}T14:20`) } })

    // 14:29: the break is at 89 min, the BRB at 9 min — nothing ends yet.
    await runBreakCutoffTick(pk(`${date}T14:29`))
    expect((await prisma.breakEntry.findUniqueOrThrow({ where: { id: brk.id } })).endAt).toBeNull()

    await runBreakCutoffTick(pk(`${date}T14:40`))
    const ended = await prisma.breakEntry.findUniqueOrThrow({ where: { id: brk.id } })
    expect(ended).toMatchObject({ autoEnded: true, endAt: pk(`${date}T14:30`) })
    expect((await prisma.breakEntry.findUniqueOrThrow({ where: { id: brb.id } })).endAt).toBeNull()
    const mine = await prisma.notification.findFirst({ where: { userId: w.leadgenMember.id, type: 'BREAK_CUTOFF' } })
    expect(mine?.title).toMatch(/ended at 90 minutes/)
    const lead = await prisma.notification.findFirst({ where: { userId: w.leadgenLead.id, type: 'BREAK_CUTOFF' } })
    expect(lead?.title).toMatch(/leadgen member's break was cut off/)
    expect(await prisma.notification.count({ where: { userId: w.itadLead.id, type: 'BREAK_CUTOFF' } })).toBe(0)

    // A second tick does not end it again or send more alerts.
    await runBreakCutoffTick(pk(`${date}T15:00`))
    expect(await prisma.notification.count({ where: { userId: w.leadgenMember.id, type: 'BREAK_CUTOFF' } })).toBe(1)
    // The BRB ends at 30 minutes.
    expect((await prisma.breakEntry.findUniqueOrThrow({ where: { id: brb.id } })).endAt?.toISOString()).toBe(pk(`${date}T14:50`).toISOString())
  })

  it('a cut-off of 0 means never, and a checked-out day is left alone', async () => {
    const date = '2026-10-22'
    const inv = await prisma.user.findUniqueOrThrow({ where: { id: w.inventoryMember.id } })
    await prisma.attendanceShift.create({ data: { departmentId: inv.departmentId, startTime: '11:00', endTime: '20:00', graceMin: 10, requiredMinutes: 480, workingDays: [1, 2, 3, 4, 5], timeZone: null, breakCutoffMin: 0 } })
    const d = await prisma.attendanceDay.create({ data: { userId: inv.id, date: new Date(`${date}T00:00:00Z`), checkInAt: pk(`${date}T11:00`) } })
    const b = await prisma.breakEntry.create({ data: { dayId: d.id, type: 'BREAK', startAt: pk(`${date}T12:00`) } })
    await runBreakCutoffTick(pk(`${date}T18:00`))
    expect((await prisma.breakEntry.findUniqueOrThrow({ where: { id: b.id } })).endAt).toBeNull()
    await prisma.attendanceShift.update({ where: { departmentId: inv.departmentId! }, data: { breakCutoffMin: 60 } })
    await prisma.attendanceDay.update({ where: { id: d.id }, data: { checkOutAt: pk(`${date}T19:00`) } })
    await runBreakCutoffTick(pk(`${date}T19:30`))
    expect((await prisma.breakEntry.findUniqueOrThrow({ where: { id: b.id } })).autoEnded).toBe(false)
  })

  it('the cut-off is saved with the working hours', async () => {
    const base = { startTime: '11:00', endTime: '20:00', graceMin: 10, requiredMinutes: 480, brbAllowanceMin: 20, breakAllowanceMin: 65, workingDays: [1, 2, 3, 4, 5] }
    const r = await request(app).put('/api/attendance/shift').set(...auth(w.superAdmin))
      .send({ ...base, breakCutoffMin: 75, brbCutoffMin: 25 })
    expect(r.status).toBeLessThan(300)
    expect(JSON.stringify(r.body)).toContain('"breakCutoffMin":75')
    // An older screen that does not send the cut-offs keeps them.
    const again = await request(app).put('/api/attendance/shift').set(...auth(w.superAdmin)).send(base)
    expect(JSON.stringify(again.body)).toContain('"brbCutoffMin":25')
  })
})

describe('stock log edit', () => {
  const as = (u: { id: string; role: 'TEAM_LEAD' | 'MEMBER' }) => ({
    edit: (id: string, body: object) => request(app).patch(`/api/ecommerce/stock/${id}`).set(...auth(u)).send(body),
  })
  let id: string

  it('a member fixes an open log; only the team lead changes the assignee or status', async () => {
    const c = await request(app).post('/api/ecommerce/stock').set(...auth(ecom.m1)).send({ itemName: 'Dell 7090', quantity: 3, action: 'STOCK_OUT', requestedByName: 'Ali' }).expect(201)
    id = c.body.request.id
    expect(c.body.request).toMatchObject({ quantity: 3, createdBy: { id: ecom.m1.id }, editedAt: null })

    const e = await as(ecom.m1).edit(id, { quantity: 5, note: 'two more boxes' }).expect(200)
    expect(e.body.request).toMatchObject({ quantity: 5, note: 'two more boxes' })
    expect(e.body.request.editedAt).toBeTruthy()
    await as(ecom.m1).edit(id, { status: 'RESOLVED' }).expect(403)
    await as(ecom.m1).edit(id, { assignedToId: ecom.m2.id }).expect(403)
    await request(app).patch(`/api/ecommerce/stock/${id}`).set(...auth(w.itadMember)).send({ quantity: 1 }).expect(403)

    const a = await as(ecom.lead).edit(id, { assignedToId: ecom.m2.id }).expect(200)
    expect(a.body.request).toMatchObject({ status: 'ASSIGNED', assignee: { id: ecom.m2.id } })
    const done = await as(ecom.lead).edit(id, { status: 'RESOLVED' }).expect(200)
    expect(done.body.request.resolvedAt).toBeTruthy()
    // Done: members can no longer change it; the team lead can reopen it.
    expect((await as(ecom.m1).edit(id, { quantity: 6 }).expect(403)).body.error).toMatch(/team lead/i)
    const re = await as(ecom.lead).edit(id, { status: 'ASSIGNED' }).expect(200)
    expect(re.body.request).toMatchObject({ status: 'ASSIGNED', resolvedAt: null })
    // Taking the assignee off puts it back to Open.
    expect((await as(ecom.lead).edit(id, { assignedToId: null }).expect(200)).body.request).toMatchObject({ status: 'REQUESTED', assignee: null })
  })

  it('shows who changed what', async () => {
    const h = await request(app).get(`/api/ecommerce/stock/${id}/history`).set(...auth(ecom.m1)).expect(200)
    const lines = h.body.history.map((x: { by: string; what: string }) => `${x.by}: ${x.what}`)
    expect(lines[0]).toBe('ecom one: Logged it')
    expect(lines[1]).toBe('ecom one: quantity: 3 → 5; note: none → two more boxes')
    expect(lines[2]).toBe(`ecom lead: assignee: none → ${ecom.m2Name}; status: Open → Assigned`)
    expect(lines).toContain('ecom lead: status: Assigned → Done')
    await request(app).get(`/api/ecommerce/stock/${id}/history`).set(...auth(w.itadMember)).expect(403)
  })

  it('only the team lead deletes a log, and the delete is recorded', async () => {
    await request(app).delete(`/api/ecommerce/stock/${id}`).set(...auth(ecom.m1)).expect(403)
    await request(app).delete(`/api/ecommerce/stock/${id}`).set(...auth(ecom.lead)).expect(204)
    const list = await request(app).get('/api/ecommerce/stock').set(...auth(ecom.m1)).expect(200)
    expect(list.body.requests.find((r: { id: string }) => r.id === id)).toBeUndefined()
    expect(await prisma.auditLog.count({ where: { entityType: 'StockRequest', entityId: id, action: 'DELETE', userId: ecom.lead.id } })).toBe(1)
  })
})
