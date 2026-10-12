import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { runCleanup } from '../lib/cleanup'
import { dbDateFromString } from '../lib/time'

// The nightly tidy-up keeps growing tables small without losing anything people use.

let w: SeededWorld
const DAY = 24 * 3600 * 1000
beforeAll(async () => { w = await seedWorld() })
afterAll(async () => { await prisma.$disconnect() })

describe('nightly cleanup', () => {
  it('drops old reminder records and closes old unread notifications only', async () => {
    const old = new Date(Date.now() - 40 * DAY)
    const recent = new Date(Date.now() - 2 * DAY)
    await prisma.attendanceReminder.createMany({ data: [
      { userId: w.itadMember.id, date: dbDateFromString('2026-08-01'), kind: 'CHECK_IN', sentAt: old },
      { userId: w.itadMember.id, date: dbDateFromString('2026-10-10'), kind: 'CHECK_IN', sentAt: recent },
    ] })
    const mk = (createdAt: Date, title: string) => prisma.notification.create({ data: { userId: w.itadMember.id, type: 'MENTION', title, body: 'x', createdAt } })
    await mk(new Date(Date.now() - 70 * DAY), 'ancient')
    await mk(recent, 'fresh')
    const r = await runCleanup()
    expect(r).toEqual({ reminders: 1, notifications: 1 })
    expect(await prisma.attendanceReminder.count()).toBe(1)
    const n = await prisma.notification.findMany({ orderBy: { createdAt: 'asc' } })
    expect(n.map((x) => [x.title, !!x.readAt])).toEqual([['ancient', true], ['fresh', false]])
  })
})

describe('faster chat list', () => {
  it('shows the newest message of each chat, with who sent it', async () => {
    const g = await request(app).post('/api/chat/conversations').set(...auth(w.itadLead)).send({ type: 'GROUP', name: 'Speed', userIds: [w.itadMember.id] }).expect(201)
    const id = g.body.conversation.id
    await request(app).post(`/api/chat/conversations/${id}/messages`).set(...auth(w.itadLead)).send({ body: 'first' }).expect(201)
    await request(app).post(`/api/chat/conversations/${id}/messages`).set(...auth(w.itadMember)).send({ body: 'second' }).expect(201)
    const empty = await request(app).post('/api/chat/conversations').set(...auth(w.itadLead)).send({ type: 'GROUP', name: 'Quiet', userIds: [w.itadMember.id] }).expect(201)
    const list = (await request(app).get('/api/chat/conversations').set(...auth(w.itadLead)).expect(200)).body.conversations
    const c = list.find((x: { id: string }) => x.id === id)
    expect(c.lastMessage).toMatchObject({ body: 'second', userName: 'itad member', mine: false })
    expect(list.find((x: { id: string }) => x.id === empty.body.conversation.id).lastMessage).toBeNull()
  })
})
