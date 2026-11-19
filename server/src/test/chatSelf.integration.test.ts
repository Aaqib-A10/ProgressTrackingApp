import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'

// "Message yourself" (like WhatsApp): a direct chat with only me in it, for notes, links and files to keep.

let w: SeededWorld
beforeAll(async () => { w = await seedWorld() })
afterAll(async () => { await prisma.$disconnect() })

describe('message yourself', () => {
  it('opens one chat with only me in it, the same one every time, that nobody else sees', async () => {
    const a = await request(app).post('/api/chat/conversations').set(...auth(w.itadMember)).send({ type: 'DIRECT', userId: w.itadMember.id }).expect(201)
    const id = a.body.conversation.id as string
    const again = await request(app).post('/api/chat/conversations').set(...auth(w.itadMember)).send({ type: 'DIRECT', userId: w.itadMember.id }).expect(200)
    expect(again.body.conversation.id).toBe(id)
    expect(await prisma.chatMember.count({ where: { conversationId: id } })).toBe(1)

    await request(app).post(`/api/chat/conversations/${id}/messages`).set(...auth(w.itadMember)).send({ body: 'Call Acme back on Monday' }).expect(201)
    const list = (await request(app).get('/api/chat/conversations').set(...auth(w.itadMember)).expect(200)).body.conversations
    const mine = list.find((c: { id: string }) => c.id === id)
    expect(mine).toMatchObject({ type: 'DIRECT', self: true, unread: 0, lastMessage: { body: 'Call Acme back on Monday', mine: true } })
    expect(mine.title).toMatch(/\(You\)$/)
    const detail = (await request(app).get(`/api/chat/conversations/${id}`).set(...auth(w.itadMember)).expect(200)).body.conversation
    expect(detail.self).toBe(true)
    expect(detail.title).toBe(mine.title)

    // Not a chat with anyone else, and nobody else can open or read it.
    const otherDm = (await request(app).post('/api/chat/conversations').set(...auth(w.itadMember)).send({ type: 'DIRECT', userId: w.itadLead.id }).expect(201)).body.conversation.id
    expect(otherDm).not.toBe(id)
    await request(app).get(`/api/chat/conversations/${id}`).set(...auth(w.itadLead)).expect(404)
    await request(app).get(`/api/chat/conversations/${id}/messages`).set(...auth(w.itadLead)).expect(404)
    const leadList = (await request(app).get('/api/chat/conversations').set(...auth(w.itadLead)).expect(200)).body.conversations
    expect(leadList.some((c: { id: string }) => c.id === id)).toBe(false)
    expect(leadList.find((c: { id: string }) => c.id === otherDm)?.self).toBe(false)

    // There is nobody to call.
    await request(app).post(`/api/chat/conversations/${id}/calls`).set(...auth(w.itadMember)).send({ video: false }).expect(422)
  })
})
