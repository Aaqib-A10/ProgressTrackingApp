import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'

/**
 * Quick Log (the floating ITAD activity panel and its pop-out window): numbers are ADDED on the
 * server, so two windows, or the panel and the full Daily Log page, never overwrite each other.
 */
let w: SeededWorld
beforeAll(async () => { w = await seedWorld() })
afterAll(async () => { await prisma.$disconnect() })

describe('Quick Log adds to today’s Daily Activity Log', () => {
  it('two windows adding at the same time both count; nothing goes below zero', async () => {
    const me = w.itadMember
    // Start the day from the full page: 10 dials.
    await request(app).put('/api/itad/entries').set(...auth(me)).send({ status: 'SUBMITTED', callsDialed: 10 }).expect((r) => expect([200, 201]).toContain(r.status))
    // The floating panel and the pop-out window each add some, at once.
    await Promise.all([
      request(app).put('/api/itad/entries').set(...auth(me)).send({ add: { callsDialed: 3, connected: 1 } }).expect(200),
      request(app).put('/api/itad/entries').set(...auth(me)).send({ add: { callsDialed: 2, emailsSent: 4 } }).expect(200),
    ])
    let r = await request(app).get('/api/itad/entries').set(...auth(me)).expect(200)
    expect(r.body.entry).toMatchObject({ callsDialed: 15, connected: 1, emailsSent: 4, status: 'SUBMITTED' })
    expect(typeof r.body.entry.updatedAt).toBe('string')
    // Taking away more than there is stops at zero; notes only change when sent.
    await request(app).put('/api/itad/entries').set(...auth(me)).send({ add: { connected: -5 }, notes: 'from the quick log' }).expect(200)
    await request(app).put('/api/itad/entries').set(...auth(me)).send({ add: { rfqs: 1 } }).expect(200)
    r = await request(app).get('/api/itad/entries').set(...auth(me)).expect(200)
    expect(r.body.entry).toMatchObject({ connected: 0, rfqs: 1, notes: 'from the quick log', callsDialed: 15 })
    // There is still exactly one entry for the day (no duplicate records).
    const n = await prisma.itadDailyEntry.count({ where: { userId: me.id } })
    expect(n).toBe(1)
  })

  it('a day marked On Leave refuses quick adds until the full log changes it', async () => {
    const me = w.itadMember
    await request(app).put('/api/itad/entries').set(...auth(me)).send({ status: 'ON_LEAVE' }).expect(200)
    const r = await request(app).put('/api/itad/entries').set(...auth(me)).send({ add: { callsDialed: 1 } }).expect(409)
    expect(r.body.error).toMatch(/leave/i)
    await request(app).put('/api/itad/entries').set(...auth(me)).send({ status: 'SUBMITTED', callsDialed: 0 }).expect(200)
  })

  it('people outside ITAD get no quick log', async () => {
    await request(app).put('/api/itad/entries').set(...auth(w.leadgenMember)).send({ add: { callsDialed: 1 } }).expect(403)
  })
})
