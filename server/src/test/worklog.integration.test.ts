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

  it('keeps long, multi-line entries whole', async () => {
    const text = 'Worked on returns report & reviewed feedback\n• eBay & Temu platforms\nUpdated variation listings and single listing pricing\n- eBay SJ\n' + 'x'.repeat(600)
    const e = (await add(w.itadMember, { period: 'DAY', date: '2026-10-09', title: text }).expect(201)).body.entry
    expect(e.title).toBe(text)
    await add(w.itadMember, { period: 'DAY', date: '2026-10-09', title: 'y'.repeat(3001) }).expect(400)
  })
})

describe('team view and reviews', () => {
  it('lead sees the team for a period: entries, needs help, leave, and nothing private', async () => {
    await add(w.itadMember, { period: 'DAY', date: '2026-10-14', title: 'Called 60 leads', status: 'DONE', quantity: 60, hours: 4 }).expect(201)
    const stuck = (await add(w.itadMember, { period: 'DAY', date: '2026-10-14', title: 'Quote for Acme', blocked: true }).expect(201)).body.entry
    expect(stuck.blocked).toBe(true)
    await add(w.itadMember, { period: 'DAY', date: '2026-10-14', title: 'Secret', private: true }).expect(201)
    await add(w.itadMember, { period: 'WEEK', date: '2026-10-14', title: 'Close 2 deals' }).expect(201)

    const day = await request(app).get('/api/worklog/team?period=DAY&date=2026-10-14').set(...auth(w.itadLead)).expect(200)
    const me = day.body.members.find((m: { id: string }) => m.id === w.itadMember.id)
    expect(me.entries.map((e: { title: string }) => e.title)).toEqual(['Called 60 leads', 'Quote for Acme'])
    expect(me).toMatchObject({ done: 1, planned: 1, blocked: 1, hours: 4, quantity: 60 })
    expect(day.body.members.some((m: { id: string }) => m.id === w.leadgenMember.id)).toBe(false) // other department
    expect(day.body.members.some((m: { id: string }) => m.id === w.itadLead.id)).toBe(false) // not themselves

    // A week includes its day entries and the week goal.
    const week = await request(app).get('/api/worklog/team?period=WEEK&date=2026-10-14').set(...auth(w.itadLead)).expect(200)
    expect(week.body.members.find((m: { id: string }) => m.id === w.itadMember.id).entries.map((e: { title: string }) => e.title)).toEqual(expect.arrayContaining(['Called 60 leads', 'Close 2 deals']))

    // Finishing clears "needs help".
    const fixed = await request(app).patch(`/api/worklog/${stuck.id}`).set(...auth(w.itadMember)).send({ status: 'DONE' }).expect(200)
    expect(fixed.body.entry.blocked).toBe(false)

    // In progress counts as started, not done.
    const ip = (await add(w.itadMember, { period: 'DAY', date: '2026-10-14', title: 'Updating 40 prices', status: 'IN_PROGRESS' }).expect(201)).body.entry
    expect(ip).toMatchObject({ status: 'IN_PROGRESS', doneAt: null })
    const t2 = await request(app).get('/api/worklog/team?period=DAY&date=2026-10-14').set(...auth(w.itadLead)).expect(200)
    expect(t2.body.members.find((m: { id: string }) => m.id === w.itadMember.id)).toMatchObject({ done: 2, inProgress: 1, planned: 1, blocked: 0 })

    await request(app).get('/api/worklog/team?period=DAY&date=2026-10-14').set(...auth(w.itadMember)).expect(403)
    const sa = await request(app).get('/api/worklog/team?period=DAY&date=2026-10-14&department=ITAD').set(...auth(w.superAdmin)).expect(200)
    expect(sa.body.members.some((m: { id: string }) => m.id === w.itadMember.id)).toBe(true)
  })

  it('lead reviews a day; the person sees it and is notified; others cannot review', async () => {
    const r = await request(app).put('/api/worklog/review').set(...auth(w.itadLead)).send({ userId: w.itadMember.id, period: 'DAY', date: '2026-10-14', rating: 'GOOD', comment: 'Nice work on the calls' }).expect(200)
    expect(r.body.review).toMatchObject({ rating: 'GOOD', comment: 'Nice work on the calls', periodStart: '2026-10-14' })
    const n = await prisma.notification.findFirst({ where: { userId: w.itadMember.id, type: 'WORKLOG_REVIEW' } })
    expect(n?.link).toBe('/app/todo?period=DAY&date=2026-10-14')

    const mine = await list(w.itadMember, 'from=2026-10-01&to=2026-10-31').expect(200)
    expect(mine.body.reviews).toHaveLength(1)
    expect(mine.body.reviews[0]).toMatchObject({ rating: 'GOOD', reviewerName: expect.any(String) })

    const team = await request(app).get('/api/worklog/team?period=DAY&date=2026-10-14').set(...auth(w.itadLead)).expect(200)
    expect(team.body.members.find((m: { id: string }) => m.id === w.itadMember.id).review.rating).toBe('GOOD')

    await request(app).put('/api/worklog/review').set(...auth(w.itadMember)).send({ userId: w.itadMember.id, period: 'DAY', date: '2026-10-14', rating: 'GOOD' }).expect(403)
    await request(app).put('/api/worklog/review').set(...auth(w.leadgenLead)).send({ userId: w.itadMember.id, period: 'DAY', date: '2026-10-14', rating: 'GOOD' }).expect(403)
    await request(app).put('/api/worklog/review').set(...auth(w.leadgenMember)).send({ userId: w.leadgenLead.id, period: 'DAY', date: '2026-10-14' }).expect(403)
    await request(app).put('/api/worklog/review').set(...auth(w.itadLead)).send({ userId: w.itadMember.id, period: 'DAY', date: '2026-10-14', clear: true }).expect(200)
    expect((await list(w.itadMember, 'from=2026-10-01&to=2026-10-31')).body.reviews).toHaveLength(0)
  })
})
