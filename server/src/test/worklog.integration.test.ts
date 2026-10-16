import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { periodStartOf, nextPeriodStart } from '../controllers/workLogController'

// My To-Do: Day / Week / Month / Year. Log past work, plan ahead; leads can read, not edit.

let w: SeededWorld
beforeAll(async () => { w = await seedWorld() })
afterAll(async () => { await prisma.$disconnect() })

type U = SeededWorld['itadMember']
const add = (u: U, body: object) => request(app).post('/api/worklog').set(...auth(u)).send(body)
const list = (u: U, q: string) => request(app).get(`/api/worklog?${q}`).set(...auth(u))

describe('periods', () => {
  it('start of day, week (Monday), month, year, and the next one', () => {
    expect(periodStartOf('DAY', '2026-10-15')).toBe('2026-10-15')
    expect(periodStartOf('WEEK', '2026-10-15')).toBe('2026-10-12')
    expect(periodStartOf('WEEK', '2026-10-18')).toBe('2026-10-12') // Sunday belongs to the week that began Monday
    expect(periodStartOf('MONTH', '2026-10-15')).toBe('2026-10-01')
    expect(periodStartOf('YEAR', '2026-10-15')).toBe('2026-01-01')
    expect(nextPeriodStart('MONTH', '2026-12-01')).toBe('2027-01-01')
    expect(nextPeriodStart('WEEK', '2026-10-12')).toBe('2026-10-19')
  })
})

describe('work log', () => {
  it('logs past work as done, plans the month and the year, and lists by range', async () => {
    const past = await add(w.itadMember, { period: 'DAY', date: '2026-10-10', title: 'Listed 25 products on Amazon UK', status: 'DONE', quantity: 25, hours: 3, tag: 'Listings' }).expect(201)
    expect(past.body.entry).toMatchObject({ period: 'DAY', periodStart: '2026-10-10', status: 'DONE', quantity: 25, hours: 3, tag: 'Listings' })
    expect(past.body.entry.doneAt).not.toBeNull()
    await add(w.itadMember, { period: 'MONTH', date: '2026-10-20', title: 'Launch 3 new perfume listings' }).expect(201)
    await add(w.itadMember, { period: 'YEAR', date: '2026-03-03', title: 'Reach 500 orders a month' }).expect(201)
    await add(w.itadMember, { period: 'DAY', date: '2026-10-11', title: 'Private thing', private: true }).expect(201)

    const r = await list(w.itadMember, 'from=2026-01-01&to=2026-12-31').expect(200)
    expect(r.body.entries.map((e: { period: string; periodStart: string }) => `${e.period}:${e.periodStart}`)).toEqual(['YEAR:2026-01-01', 'MONTH:2026-10-01', 'DAY:2026-10-10', 'DAY:2026-10-11'])
    expect(r.body.readOnly).toBe(false)
  })

  it('tick done, move, carry over, delete; only the owner can change', async () => {
    const e = (await add(w.itadMember, { period: 'WEEK', date: '2026-10-14', title: 'Answer all buyer messages' }).expect(201)).body.entry
    expect(e.periodStart).toBe('2026-10-12')
    const c = await request(app).post(`/api/worklog/${e.id}/carry`).set(...auth(w.itadMember)).expect(200)
    expect(c.body.entry.periodStart).toBe('2026-10-19')
    const d = await request(app).patch(`/api/worklog/${e.id}`).set(...auth(w.itadMember)).send({ status: 'DONE' }).expect(200)
    expect(d.body.entry.status).toBe('DONE')
    await request(app).post(`/api/worklog/${e.id}/carry`).set(...auth(w.itadMember)).expect(400) // done things stay
    const m = await request(app).patch(`/api/worklog/${e.id}`).set(...auth(w.itadMember)).send({ period: 'DAY', date: '2026-10-16' }).expect(200)
    expect(m.body.entry).toMatchObject({ period: 'DAY', periodStart: '2026-10-16' })
    await request(app).patch(`/api/worklog/${e.id}`).set(...auth(w.itadLead)).send({ title: 'hijack' }).expect(404)
    await request(app).delete(`/api/worklog/${e.id}`).set(...auth(w.itadLead)).expect(404)
    await request(app).delete(`/api/worklog/${e.id}`).set(...auth(w.itadMember)).expect(204)
  })

  it('their Team Lead and Super Admin read it (not private entries); others cannot', async () => {
    const q = `from=2026-10-01&to=2026-10-31&userId=${w.itadMember.id}`
    const lead = await list(w.itadLead, q).expect(200)
    expect(lead.body.readOnly).toBe(true)
    expect(lead.body.entries.some((e: { title: string }) => e.title === 'Private thing')).toBe(false)
    expect(lead.body.entries.length).toBeGreaterThan(0)
    await list(w.superAdmin, q).expect(200)
    await list(w.leadgenLead, q).expect(403) // another department's lead
    await list(w.leadgenMember, q).expect(403)
    const people = await request(app).get('/api/worklog/people').set(...auth(w.itadLead)).expect(200)
    expect(people.body.people.map((p: { id: string }) => p.id)).toContain(w.itadMember.id)
    expect((await request(app).get('/api/worklog/people').set(...auth(w.itadMember)).expect(200)).body.people).toEqual([])
  })

  it('bad input is refused', async () => {
    await add(w.leadgenMember, { period: 'DAY', date: '2026-10-10', title: '' }).expect(400)
    await add(w.itadMember, { period: 'DAY', date: '1990-01-01', title: 'old' }).expect(400)
    await add(w.itadMember, { period: 'DECADE', date: '2026-10-10', title: 'x' }).expect(400)
    await list(w.itadMember, 'from=2026-10-10&to=2026-01-01').expect(400)
  })
})
