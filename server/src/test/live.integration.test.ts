import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import http from 'node:http'
import request from 'supertest'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { HOME_COMPANY_ID } from '../lib/company'
import { setCompanyFlag, resetFlagCache } from '../lib/flags'
import { addClient, poke, liveStats, startLive, MAX_PER_PERSON } from '../lib/live'
import { startWebhooks } from '../lib/webhooks'

// Live updates (plan 2026-11, stage 4): an open tab hears at once that a notification or a chat message arrived.
// The line carries only the nudge, to the people it is for; the records are read through the usual requests.

let w: SeededWorld
let server: Server
let base = ''

/** Open GET /api/live as a person and collect what arrives. */
function listen(u: SeededWorld['superAdmin']): Promise<{ status: number; type: string; got: string[]; close: () => void }> {
  const [name, value] = auth(u)
  return new Promise((resolve, reject) => {
    const req = http.get(`${base}/api/live`, { headers: { [name]: value, Accept: 'text/event-stream' } }, (res) => {
      const got: string[] = []
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => got.push(chunk))
      resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? ''), got, close: () => req.destroy() })
    })
    req.on('error', reject)
  })
}
const soon = (ms = 150) => new Promise((r) => setTimeout(r, ms))

beforeAll(async () => {
  w = await seedWorld()
  startLive()
  startLive() // twice on purpose: it must not hook twice
  startWebhooks()
  await setCompanyFlag('live-updates', HOME_COMPANY_ID, true, 'test')
  resetFlagCache()
  server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(async () => { server.close(); await prisma.$disconnect() })

describe('the nudge itself', () => {
  it('reaches only the people named, on every tab they have open, and the oldest tab gives way', () => {
    const tab = () => { const lines: string[] = []; let ended = false; return { lines, get ended() { return ended }, sink: { write: (s: string) => { lines.push(s) }, end: () => { ended = true } } } }
    const a1 = tab(), a2 = tab(), b = tab()
    const off = [addClient('ann', a1.sink), addClient('ann', a2.sink), addClient('bob', b.sink)]
    expect(liveStats()).toMatchObject({ people: 2, connections: 3 })
    expect(poke(['ann', 'ann', 'nobody'], { topic: 'chat', conversationId: 'c1' })).toBe(2)
    expect(a1.lines).toEqual(['event: poke\ndata: {"topic":"chat","conversationId":"c1"}\n\n'])
    expect(a2.lines).toHaveLength(1)
    expect(b.lines).toEqual([])
    off.forEach((f) => f())
    expect(liveStats()).toMatchObject({ people: 0, connections: 0 })

    const tabs = Array.from({ length: MAX_PER_PERSON + 1 }, tab)
    const offs = tabs.map((t) => addClient('cara', t.sink))
    expect(tabs[0].ended).toBe(true) // the oldest connection was closed for the newest
    expect(liveStats().connections).toBe(MAX_PER_PERSON)
    offs.forEach((f) => f())
  })
})

describe('GET /api/live', () => {
  it('needs a sign-in, and is closed while the switch is off', async () => {
    const anon = await new Promise<number>((resolve) => http.get(`${base}/api/live`, (res) => { resolve(res.statusCode ?? 0); res.destroy() }))
    expect(anon).toBe(401)
    await setCompanyFlag('live-updates', HOME_COMPANY_ID, false, 'test')
    resetFlagCache()
    const off = await listen(w.itadMember)
    expect(off.status).toBe(204)
    off.close()
    await setCompanyFlag('live-updates', HOME_COMPANY_ID, true, 'test')
    resetFlagCache()
    // Anything that is not a browser's event stream (the hourly self check reads every address) is answered at once.
    await request(app).get('/api/live').set(...auth(w.itadMember)).expect(204)
  })

  it('tells a person at once about their notification and their chat, and tells nobody else', async () => {
    const mine = await listen(w.itadMember)
    const other = await listen(w.leadgenMember)
    expect(mine.status).toBe(200)
    expect(mine.type).toContain('text/event-stream')
    await soon()
    expect(mine.got.join('')).toContain('event: hello')

    await prisma.notification.create({ data: { userId: w.itadMember.id, type: 'TASK_ASSIGNED', title: 'A task for you', body: 'x' } })
    await soon()
    expect(mine.got.join('')).toContain('event: poke\ndata: {"topic":"notifications"}')
    expect(other.got.join('')).not.toContain('poke')

    // A chat message nudges the members of that chat, with the chat it is in and nothing of what was said.
    const conv = await prisma.chatConversation.create({ data: { type: 'DIRECT', createdById: w.itadMember.id, members: { create: [{ userId: w.itadMember.id }, { userId: w.itadLead.id }] } } })
    const lead = await listen(w.itadLead)
    await soon()
    await prisma.chatMessage.create({ data: { conversationId: conv.id, userId: w.itadLead.id, body: 'The secret price is 42' } })
    await soon(300)
    const line = `event: poke\ndata: {"topic":"chat","conversationId":"${conv.id}"}`
    expect(mine.got.join('')).toContain(line)
    expect(lead.got.join('')).toContain(line)
    expect(other.got.join('')).not.toContain('poke')
    expect([...mine.got, ...lead.got].join('')).not.toContain('secret price')

    for (const c of [mine, other, lead]) c.close()
    await soon()
    expect(liveStats().connections).toBe(0)
  })
})
