import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { hashPassword } from '../lib/auth'
import { buildFinancialReport } from '../lib/financials'

// ITAD: everyone sees which deals the team is working on; Docs & Links stay private.

let w: SeededWorld
let second: SeededWorld['itadMember']
beforeAll(async () => {
  w = await seedWorld()
  const itad = await prisma.department.findFirstOrThrow({ where: { type: 'ITAD' } })
  const u = await prisma.user.create({ data: { name: 'itad second', email: 'itad.second@test.local', role: 'MEMBER', status: 'ACTIVE', isActive: true, passwordHash: await hashPassword('Password123!'), departmentId: itad.id } })
  second = { id: u.id, role: u.role }
})
afterAll(async () => { await prisma.$disconnect() })

const deal = (title: string, company: string, status = 'ACTIVE') => ({ title, company, type: 'BID', dueDate: '2026-11-01T10:00:00.000Z', priceQuoted: 5000, status })

describe('team active deals', () => {
  it('every ITAD person sees all open deals and who owns them, without prices', async () => {
    await request(app).post('/api/itad/bids').set(...auth(w.itadMember)).send(deal('Dell laptops buyback', 'Acme Schools')).expect(201)
    await request(app).post('/api/itad/bids').set(...auth(second)).send(deal('Server pallet', 'Globex')).expect(201)
    const closed = await request(app).post('/api/itad/bids').set(...auth(second)).send(deal('Old one', 'Initech')).expect(201)
    await request(app).patch(`/api/itad/bids/${closed.body.bid.id}`).set(...auth(second)).send({ status: 'LOST', awardedPrice: 0 }).expect(200)

    const r = await request(app).get('/api/itad/bids/team-active').set(...auth(w.itadMember)).expect(200)
    expect(r.body.deals.map((d: { title: string }) => d.title).sort()).toEqual(['Dell laptops buyback', 'Server pallet'])
    const theirs = r.body.deals.find((d: { title: string }) => d.title === 'Server pallet')
    expect(theirs).toMatchObject({ agentName: 'itad second', mine: false, company: 'Globex' })
    expect(theirs.priceQuoted).toBeUndefined()
    // My own list is still only mine, and I still cannot edit their deal.
    const mineList = await request(app).get('/api/itad/bids').set(...auth(w.itadMember)).expect(200)
    expect(mineList.body.bids).toHaveLength(1)
    await request(app).patch(`/api/itad/bids/${theirs.id}`).set(...auth(w.itadMember)).send({ title: 'mine now' }).expect(403)
  })

  it('other departments cannot see ITAD deals', async () => {
    await request(app).get('/api/itad/bids/team-active').set(...auth(w.leadgenMember)).expect(403)
  })

  it('total deal amount: the agent enters it, agent and lead each see the total of the deals they can see', async () => {
    const a = await request(app).post('/api/itad/bids').set(...auth(w.itadMember)).send({ ...deal('Totals A', 'Totals Co'), totalAmount: 14400 }).expect(201)
    expect(a.body.bid.totalAmount).toBe(14400)
    const b = await request(app).post('/api/itad/bids').set(...auth(second)).send({ ...deal('Totals B', 'Totals Co'), totalAmount: 1000.5 }).expect(201)
    // Winning keeps the total; it can be changed and cleared like any field.
    const won = await request(app).patch(`/api/itad/bids/${b.body.bid.id}`).set(...auth(second)).send({ status: 'WON', awardedPrice: 0.12, totalAmount: 2000.25 }).expect(200)
    expect(won.body.bid).toMatchObject({ status: 'WON', awardedPrice: 0.12, totalAmount: 2000.25 })
    await request(app).post('/api/itad/bids').set(...auth(w.itadMember)).send({ ...deal('Bad total', 'Totals Co'), totalAmount: -5 }).expect(400)

    // The agent: only their own deals add up (14,400; their other deal from above has none).
    const mine = (await request(app).get('/api/itad/bids').set(...auth(w.itadMember)).expect(200)).body.summary
    expect(mine).toMatchObject({ totalValue: 14400, wonTotal: 0 })
    // The team lead: every ITAD deal.
    const team = (await request(app).get('/api/itad/bids').set(...auth(w.itadLead)).expect(200)).body.summary
    expect(team).toMatchObject({ totalValue: 16400.25, wonTotal: 2000.25 })
    // The team's open-deals list still shows no money.
    const open = (await request(app).get('/api/itad/bids/team-active').set(...auth(w.itadMember)).expect(200)).body.deals
    expect(open.every((d: Record<string, unknown>) => d.totalAmount === undefined)).toBe(true)

    await request(app).patch(`/api/itad/bids/${a.body.bid.id}`).set(...auth(w.itadMember)).send({ totalAmount: null }).expect(200)
    expect((await request(app).get('/api/itad/bids').set(...auth(w.itadMember)).expect(200)).body.summary.totalValue).toBe(0)
  })

  it('Contract: won with a contract, no awarded price (a value only when known), and counts as won money', async () => {
    const month = new Date().toISOString().slice(0, 7)
    const itadRevenue = async () => (await buildFinancialReport({ from: month, to: month })).teams.find((t) => t.team === 'ITAD')!.revenue!
    const before = await itadRevenue()

    // A contract sent with no fixed price: nothing to enter, it is simply Contract.
    const noPrice = (await request(app).post('/api/itad/bids').set(...auth(w.itadMember)).send(deal('Contract, no price', 'Contract Co')).expect(201)).body.bid
    const np = (await request(app).patch(`/api/itad/bids/${noPrice.id}`).set(...auth(w.itadMember)).send({ status: 'CONTRACT' }).expect(200)).body.bid
    expect(np).toMatchObject({ status: 'CONTRACT', awardedPrice: null, totalAmount: null })
    expect(await itadRevenue()).toBeCloseTo(before, 2)
    await request(app).delete(`/api/itad/bids/${noPrice.id}`).set(...auth(w.itadMember)).expect(204)

    const c = (await request(app).post('/api/itad/bids').set(...auth(w.itadMember)).send(deal('Contract deal', 'Contract Co')).expect(201)).body.bid
    // An end before the start: refused.
    await request(app).patch(`/api/itad/bids/${c.id}`).set(...auth(w.itadMember)).send({ status: 'CONTRACT', totalAmount: 50000, contractStart: '2026-12-01', contractEnd: '2026-06-01' }).expect(400)
    // No awarded price needed; the closed date is set like any decided deal.
    const done = (await request(app).patch(`/api/itad/bids/${c.id}`).set(...auth(w.itadMember)).send({ status: 'CONTRACT', totalAmount: 50000, contractStart: '2026-12-01', contractEnd: '2027-11-30', awardedPrice: 9 }).expect(200)).body.bid
    expect(done).toMatchObject({ status: 'CONTRACT', totalAmount: 50000, awardedPrice: null, contractStart: '2026-12-01', contractEnd: '2027-11-30' })
    expect(done.closedDate).toBeTruthy()

    const mine = (await request(app).get('/api/itad/bids').set(...auth(w.itadMember)).expect(200)).body.summary
    expect(mine).toMatchObject({ contract: 1, contractValue: 50000 })
    expect(mine.amounts.CONTRACT).toBe(50000)
    expect((await request(app).get('/api/itad/bids').set(...auth(w.itadLead)).expect(200)).body.summary.contract).toBe(1)
    // The financial report counts the contract value as won ITAD revenue.
    expect(await itadRevenue()).toBeCloseTo(before + 50000, 2)

    // Re-opened: the contract dates go away and it is no longer revenue.
    const back = (await request(app).patch(`/api/itad/bids/${c.id}`).set(...auth(w.itadMember)).send({ status: 'ACTIVE' }).expect(200)).body.bid
    expect(back).toMatchObject({ status: 'ACTIVE', contractStart: null, contractEnd: null, closedDate: null })
    expect(await itadRevenue()).toBeCloseTo(before, 2)
  })
})

describe('Docs & Links', () => {
  it('saves links and files that only their owner can see', async () => {
    const a = await request(app).post('/api/docs').set(...auth(w.itadMember)).send({ title: 'Dell price list', url: 'https://example.com/prices', brand: 'Dell', category: 'PRICE_LIST' }).expect(201)
    await request(app).post('/api/docs').set(...auth(w.itadMember)).send({ title: 'bad', url: 'javascript:alert(1)' }).expect(400)
    const id = a.body.doc.id
    const f = await request(app).post(`/api/docs/${id}/file?name=contract.pdf&type=application/pdf`).set(...auth(w.itadMember)).set('Content-Type', 'application/octet-stream').send(Buffer.from('%PDF-1.4 test')).expect(200)
    expect(f.body.doc.file).toMatchObject({ name: 'contract.pdf', mime: 'application/pdf' })
    await request(app).post(`/api/docs/${id}/file?name=run.exe`).set(...auth(w.itadMember)).set('Content-Type', 'application/octet-stream').send(Buffer.from('MZ')).expect(415)
    const dl = await request(app).get(`/api/docs/${id}/file`).set(...auth(w.itadMember)).expect(200)
    expect(dl.headers['content-disposition']).toContain('contract.pdf')

    // Someone else in ITAD sees nothing of it and cannot open, change or delete it.
    expect((await request(app).get('/api/docs').set(...auth(second)).expect(200)).body.docs).toEqual([])
    await request(app).get(`/api/docs/${id}/file`).set(...auth(second)).expect(404)
    await request(app).patch(`/api/docs/${id}`).set(...auth(second)).send({ title: 'x' }).expect(404)
    await request(app).delete(`/api/docs/${id}`).set(...auth(second)).expect(204)
    expect(await prisma.savedDoc.count({ where: { id } })).toBe(1)

    const p = await request(app).patch(`/api/docs/${id}`).set(...auth(w.itadMember)).send({ pinned: true, notes: 'Q4 rates' }).expect(200)
    expect(p.body.doc).toMatchObject({ pinned: true, notes: 'Q4 rates', brand: 'Dell', category: 'PRICE_LIST' })
    await request(app).delete(`/api/docs/${id}`).set(...auth(w.itadMember)).expect(204)
    expect(await prisma.savedDoc.count({ where: { id } })).toBe(0)
  })

  it('is for the ITAD team', async () => {
    await request(app).get('/api/docs').set(...auth(w.leadgenMember)).expect(403)
  })
})
