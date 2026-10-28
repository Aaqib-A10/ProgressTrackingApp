import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { hashPassword } from '../lib/auth'

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
