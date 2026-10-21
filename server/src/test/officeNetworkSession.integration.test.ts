import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import request from 'supertest'
import { DateTime } from 'luxon'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'

// Someone checks in on the office network; mid shift the office line hands out a different
// address (IPv4 to IPv6, a second line). Ending a break or checking out must still work.
// Check-in stays office only, and its refusal shows the address so an admin can add it.

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'
const OFFICE_IP = '182.177.47.7'
const OFFICE_V6 = '2400:adc1:1a2:3b00::/64'
const pk = (iso: string) => DateTime.fromISO(iso, { zone: 'Asia/Karachi' }).toJSDate()
const at = (iso: string) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(pk(iso)) }

let w: SeededWorld
const nets: string[] = []
beforeAll(async () => {
  w = await seedWorld()
  for (const u of [w.itadMember, w.leadgenMember]) {
    await prisma.attendanceShift.create({ data: { userId: u.id, startTime: '09:00', endTime: '18:00', graceMin: 10, requiredMinutes: 480, workingDays: [1, 2, 3, 4, 5], timeZone: null } })
  }
  nets.push((await prisma.officeNetwork.create({ data: { label: 'Office', cidr: OFFICE_IP } })).id)
})
afterEach(() => { vi.useRealTimers() })
afterAll(async () => {
  await prisma.officeNetwork.deleteMany({ where: { id: { in: nets } } })
  await prisma.blockedCheckIn.deleteMany({})
  await prisma.$disconnect()
})

const clock = (u: SeededWorld['itadMember'], path: string, ip: string) =>
  request(app).post(`/api/attendance/${path}`).set(...auth(u)).set('User-Agent', DESKTOP_UA).set('X-Client-Mobile', '0').set('CF-Connecting-IP', ip)

describe('office network during a running session', () => {
  it('checked in at the office: break, end break, overtime and check-out work from another address', async () => {
    at('2026-10-12T09:05')
    await clock(w.itadMember, 'check-in', OFFICE_IP).expect(200)
    at('2026-10-12T13:00')
    await clock(w.itadMember, 'break/start', '2400:adc1:1a2:3b00:1111:2222:3333:4444').expect(200)
    at('2026-10-12T14:00')
    const e = await clock(w.itadMember, 'break/end', '39.50.1.2').expect(200)
    expect(e.body.today.state).toBe('IN')
    expect(e.body.today.regularBreakMin).toBe(60)
    at('2026-10-12T18:00')
    await clock(w.itadMember, 'overtime', '39.50.1.2').expect(200)
    at('2026-10-12T18:30')
    await clock(w.itadMember, 'check-out', '39.50.1.2').expect(200)
    const day = await prisma.attendanceDay.findFirst({ where: { userId: w.itadMember.id }, orderBy: { date: 'desc' } })
    expect(day?.checkOutIp).toBe('39.50.1.2') // saved for the admin to see
  })

  it('check-in from outside is refused and the message shows the address', async () => {
    at('2026-10-13T09:05')
    const r = await clock(w.leadgenMember, 'check-in', '2400:adc1:1a2:3b00::99').expect(403)
    expect(r.body.error).toMatch(/office network/)
    expect(r.body.error).toContain('2400:adc1:1a2:3b00::99')
  })

  it('an IPv6 office range can be added and then lets check-in through', async () => {
    const bad = await request(app).post('/api/admin/office-networks').set(...auth(w.superAdmin)).send({ label: 'Bad', cidr: '2400:adc1::/129' })
    expect(bad.status).toBe(400)
    const ok = await request(app).post('/api/admin/office-networks').set(...auth(w.superAdmin)).send({ label: 'Office IPv6', cidr: OFFICE_V6 })
    expect(ok.status).toBeLessThan(300)
    nets.push(ok.body.network.id)
    at('2026-10-13T09:10')
    await clock(w.leadgenMember, 'check-in', '2400:adc1:1a2:3b00::99').expect(200)
  })

  it('a refused check-in is listed for the admin, the admin is told, and Allow range lets the person in', async () => {
    at('2026-10-14T09:05')
    const NEW_LINE = '119.73.100.25'
    const r = await clock(w.itadMember, 'check-in', NEW_LINE).expect(403)
    expect(r.body.error).toContain(NEW_LINE)
    await clock(w.itadMember, 'check-in', NEW_LINE).expect(403) // tried again

    const note = await prisma.notification.findMany({ where: { userId: w.superAdmin.id, type: 'NETWORK_BLOCKED', entityId: NEW_LINE } })
    expect(note).toHaveLength(1) // once, not per attempt
    expect(note[0].link).toBe('/app/admin/networks')

    const list = await request(app).get('/api/admin/office-networks').set(...auth(w.superAdmin)).set('CF-Connecting-IP', '119.73.100.40').expect(200)
    const row = list.body.blocked.find((b: { ip: string }) => b.ip === NEW_LINE)
    expect(row).toMatchObject({ count: 2, range: '119.73.100.0/24' })
    expect(row.people).toHaveLength(1)
    expect(list.body.you).toMatchObject({ ip: '119.73.100.40', allowed: false, range: '119.73.100.0/24' })

    // Team Leads cannot allow networks.
    await request(app).post('/api/admin/office-networks/allow').set(...auth(w.itadLead)).send({ ip: NEW_LINE, wholeRange: true }).expect(403)
    const ok = await request(app).post('/api/admin/office-networks/allow').set(...auth(w.superAdmin)).send({ ip: NEW_LINE, wholeRange: true }).expect(201)
    expect(ok.body.network.cidr).toBe('119.73.100.0/24')
    nets.push(ok.body.network.id)

    // The provider moves the office to another address in the range: still fine.
    await clock(w.itadMember, 'check-in', '119.73.100.77').expect(200)
    const after = await request(app).get('/api/admin/office-networks').set(...auth(w.superAdmin)).expect(200)
    expect(after.body.blocked.find((b: { ip: string }) => b.ip === NEW_LINE)).toBeUndefined()
  })

  it('IPv6 office line: one click lets every laptop on it in, also the next day when Windows changes the address', async () => {
    const LAPTOP_A = '2400:adc2:77:9a00:5d1:22ff:fe33:4401'
    const LAPTOP_B = '2400:adc2:77:9a00:c0de:1:2:3'
    at('2026-10-15T09:05')
    await clock(w.itadMember, 'check-in', LAPTOP_A).expect(403)
    await clock(w.leadgenMember, 'check-in', LAPTOP_B).expect(403)

    // One alert and one row for the office line, not one per laptop.
    const notes = await prisma.notification.findMany({ where: { userId: w.superAdmin.id, type: 'NETWORK_BLOCKED', entityId: '2400:adc2:77:9a00::/64' } })
    expect(notes).toHaveLength(1)
    const list = await request(app).get('/api/admin/office-networks').set(...auth(w.superAdmin)).expect(200)
    const rows = list.body.blocked.filter((b: { network: string }) => b.network === '2400:adc2:77:9a00::/64')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ ipv6: true, count: 2, range: '2400:adc2:77:9a00::/64' })
    expect(rows[0].people).toHaveLength(2)

    // The admin clicks the address of one laptop: the whole line is allowed.
    const ok = await request(app).post('/api/admin/office-networks/allow').set(...auth(w.superAdmin)).send({ ip: LAPTOP_A, wholeRange: false }).expect(201)
    expect(ok.body.network.cidr).toBe('2400:adc2:77:9a00::/64')
    nets.push(ok.body.network.id)

    await clock(w.leadgenMember, 'check-in', LAPTOP_B).expect(200)
    at('2026-10-16T09:05')
    await clock(w.itadMember, 'check-in', '2400:adc2:77:9a00:e1f0:7:8:9').expect(200) // new privacy address
  })

  it('an IPv6 address added earlier as a single address now covers its line', async () => {
    const old = await prisma.officeNetwork.create({ data: { label: 'Old single v6', cidr: '2400:adc3:5:6:aaaa:bbbb:cccc:dddd' } })
    nets.push(old.id)
    at('2026-10-17T09:05')
    await clock(w.itadMember, 'check-in', '2400:adc3:5:6:1:2:3:4').expect(200)
  })

  it('a phone is still refused mid session', async () => {
    at('2026-10-13T12:00')
    await request(app).post('/api/attendance/break/start').set(...auth(w.leadgenMember)).set('User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148').set('CF-Connecting-IP', OFFICE_IP).expect(403)
  })
})
