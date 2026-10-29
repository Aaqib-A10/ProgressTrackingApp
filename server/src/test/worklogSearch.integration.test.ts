import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { searchTerms } from '../controllers/workLogController'

// The search box on My To-Do: type a word (an SKU, a client, a product) and see every day,
// week, month and year it shows up in, newest first, with notes and tags searched too.

let w: SeededWorld
type U = SeededWorld['itadMember']
const add = (u: U, body: object) => request(app).post('/api/worklog').set(...auth(u)).send(body).expect(201).then((r) => r.body.entry)
const find = (u: U, q: string) => request(app).get(`/api/worklog/search?${q}`).set(...auth(u))
const titles = (r: { body: { results: { title: string }[] } }) => r.body.results.map((e) => e.title)

beforeAll(async () => {
  w = await seedWorld()
  await prisma.workLogEntry.deleteMany({ where: { title: { contains: 'zebra', mode: 'insensitive' } } })
  await add(w.itadMember, { period: 'DAY', date: '2026-03-04', title: 'Listed Zebra SKU ZX-100 on eBay', status: 'DONE', tag: 'Listings' })
  await add(w.itadMember, { period: 'DAY', date: '2026-10-20', title: 'Repriced ZX-100', tag: 'Pricing' })
  await add(w.itadMember, { period: 'MONTH', date: '2026-09-15', title: 'Sell all zebra stock' })
  await add(w.itadMember, { period: 'WEEK', date: '2026-10-14', title: 'Secret zebra plan', private: true })
  const n = await add(w.itadMember, { period: 'DAY', date: '2026-08-01', title: 'Call the supplier' })
  await request(app).post(`/api/worklog/${n.id}/notes`).set(...auth(w.itadMember)).send({ body: 'Asked for the zebra price list', source: 'WhatsApp', sender: 'Bilal' }).expect(201)
  await add(w.itadLead, { period: 'DAY', date: '2026-10-21', title: 'Check zebra listings for the team' })
  await add(w.leadgenMember, { period: 'DAY', date: '2026-10-21', title: 'Zebra leads from Lead Gen' })
  await request(app).post('/api/todos').set(...auth(w.itadMember)).send({ title: 'Order zebra labels' }).expect(201)
})
afterAll(async () => {
  await prisma.workLogEntry.deleteMany({ where: { title: { contains: 'zebra', mode: 'insensitive' } } })
  await prisma.$disconnect()
})

describe('search terms', () => {
  it('words, and "exact phrases" in quotes', () => {
    expect(searchTerms('zebra  ZX-100')).toEqual(['zebra', 'ZX-100'])
    expect(searchTerms('"price list" zebra Zebra')).toEqual(['price list', 'zebra'])
    expect(searchTerms('a b c d e f g h')).toHaveLength(6)
  })
})

describe('My To-Do search', () => {
  it('finds it on every date, newest first, in titles, tags and notes, private ones included for the owner', async () => {
    const r = await find(w.itadMember, 'q=zebra').expect(200)
    expect(titles(r)).toEqual(['Secret zebra plan', 'Sell all zebra stock', 'Call the supplier', 'Listed Zebra SKU ZX-100 on eBay'])
    expect(r.body.results[2].notes[0]).toMatchObject({ source: 'WhatsApp', sender: 'Bilal' })
    expect(r.body.results[0]).toMatchObject({ period: 'WEEK', periodStart: '2026-10-12', userName: 'itad member' })
    expect(r.body.checklist.map((c: { title: string }) => c.title)).toEqual(['Order zebra labels'])
  })

  it('every word must match; tags, note senders and sources count', async () => {
    expect(titles(await find(w.itadMember, 'q=ZX-100').expect(200))).toEqual(['Repriced ZX-100', 'Listed Zebra SKU ZX-100 on eBay'])
    expect(titles(await find(w.itadMember, 'q=zebra%20ebay').expect(200))).toEqual(['Listed Zebra SKU ZX-100 on eBay'])
    expect(titles(await find(w.itadMember, 'q=pricing').expect(200))).toEqual(['Repriced ZX-100'])
    expect(titles(await find(w.itadMember, 'q=bilal').expect(200))).toEqual(['Call the supplier'])
    expect(titles(await find(w.itadMember, 'q=%22price%20list%22').expect(200))).toEqual(['Call the supplier'])
    expect((await find(w.itadMember, 'q=nothingmatcheszz').expect(200)).body.results).toEqual([])
  })

  it('needs two letters', async () => {
    await find(w.itadMember, 'q=z').expect(400)
    await find(w.itadMember, 'q=').expect(400)
  })

  it('a Team Lead searches one person (not private) or the whole department; a member cannot', async () => {
    const one = await find(w.itadLead, `q=zebra&userId=${w.itadMember.id}`).expect(200)
    expect(titles(one)).not.toContain('Secret zebra plan')
    expect(one.body.checklist).toEqual([])
    const team = await find(w.itadLead, 'q=zebra&scope=team').expect(200)
    expect(titles(team)).toContain('Check zebra listings for the team')
    expect(titles(team)).toContain('Listed Zebra SKU ZX-100 on eBay')
    expect(titles(team)).not.toContain('Secret zebra plan')
    expect(titles(team)).not.toContain('Zebra leads from Lead Gen') // another department
    await find(w.itadMember, 'q=zebra&scope=team').expect(403)
    await find(w.itadMember, `q=zebra&userId=${w.itadLead.id}`).expect(403)
    await find(w.leadgenMember, `q=zebra&userId=${w.itadMember.id}`).expect(403)
  })

  it('a Super Admin searches the whole company, still without other people’s private entries', async () => {
    const r = await find(w.superAdmin, 'q=zebra&scope=team').expect(200)
    expect(titles(r)).toEqual(expect.arrayContaining(['Zebra leads from Lead Gen', 'Check zebra listings for the team', 'Sell all zebra stock']))
    expect(titles(r)).not.toContain('Secret zebra plan')
  })

  it('the app-wide search box finds your own to-do entries and opens the right day', async () => {
    const r = (await request(app).get('/api/search?q=zebra').set(...auth(w.itadMember)).expect(200)).body
    const hit = r.tasks.find((t: { title: string }) => t.title === 'Listed Zebra SKU ZX-100 on eBay')
    expect(hit.link).toMatch(/^\/app\/todo\?period=DAY&date=2026-03-04&entry=/)
    expect(hit.sub).toContain('My To-Do')
    const lead = (await request(app).get('/api/search?q=zebra').set(...auth(w.itadLead)).expect(200)).body
    expect(lead.tasks.map((t: { title: string }) => t.title)).not.toContain('Listed Zebra SKU ZX-100 on eBay')
  })
})
