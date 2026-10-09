import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest'
import request from 'supertest'

// The real push service is never called: record what would be sent.
const sent: { endpoint: string; payload: Record<string, unknown>; opts: Record<string, unknown> }[] = []
let failWith: number | null = null
vi.mock('web-push', () => ({
  default: {
    generateVAPIDKeys: () => ({ publicKey: 'BPUBLICKEY_test_1234567890', privateKey: 'private_test' }),
    sendNotification: async (sub: { endpoint: string }, body: string, opts: Record<string, unknown>) => {
      if (failWith) throw Object.assign(new Error('gone'), { statusCode: failWith })
      sent.push({ endpoint: sub.endpoint, payload: JSON.parse(body), opts })
      return { statusCode: 201 }
    },
  },
}))

import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { resetCalls } from '../lib/pm/calls'
import { isOneEmoji } from '../controllers/chatController'
import { fileLabel } from '../lib/chatPreview'

let w: SeededWorld
let dm = ''
const flush = () => new Promise((r) => setTimeout(r, 300))
const sub = (n: number) => ({ endpoint: `https://push.example.com/send/${n}`, keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } })

beforeAll(async () => {
  process.env.PUSH_IN_TESTS = '1'
  w = await seedWorld()
  resetCalls()
  const d = await request(app).post('/api/chat/conversations').set(...auth(w.itadLead)).send({ type: 'DIRECT', userId: w.itadMember.id })
  dm = d.body.conversation.id
})
afterAll(async () => { delete process.env.PUSH_IN_TESTS; await prisma.$disconnect() })
beforeEach(() => { sent.length = 0; failWith = null })

describe('pop-up notifications when PulseTrack is closed', () => {
  it('a device subscribes; the key is made once and kept', async () => {
    const k1 = await request(app).get('/api/push/key').set(...auth(w.itadMember)).expect(200)
    const k2 = await request(app).get('/api/push/key').set(...auth(w.itadLead)).expect(200)
    expect(k1.body.publicKey).toBe(k2.body.publicKey)
    await request(app).post('/api/push/subscribe').set(...auth(w.itadMember)).send(sub(1)).expect(200)
    await request(app).post('/api/push/subscribe').set(...auth(w.itadMember)).send(sub(1)).expect(200) // again: no duplicate
    await request(app).post('/api/push/subscribe').set(...auth(w.itadMember)).send({ endpoint: 'http://insecure.example.com/x', keys: sub(9).keys }).expect(422)
    expect(await prisma.pushSubscription.count({ where: { userId: w.itadMember.id } })).toBe(1)
    await request(app).post('/api/push/test').set(...auth(w.itadMember)).expect(200)
    expect(sent[0].payload).toMatchObject({ kind: 'test' })
  })

  it('a new message reaches the other person, not the sender; muted chats stay quiet', async () => {
    await request(app).post(`/api/chat/conversations/${dm}/messages`).set(...auth(w.itadLead)).send({ body: 'Are the pages ready?' }).expect(201)
    await flush()
    expect(sent).toHaveLength(1)
    expect(sent[0].payload).toMatchObject({ kind: 'msg', body: 'Are the pages ready?', tag: `chat-${dm}`, url: `/app/chat?c=${dm}` })
    sent.length = 0
    await prisma.chatMember.updateMany({ where: { conversationId: dm, userId: w.itadMember.id }, data: { mutedUntil: new Date(Date.now() + 3600_000) } })
    await request(app).post(`/api/chat/conversations/${dm}/messages`).set(...auth(w.itadLead)).send({ body: 'ping' }).expect(201)
    await flush()
    expect(sent).toHaveLength(0)
    await prisma.chatMember.updateMany({ where: { conversationId: dm, userId: w.itadMember.id }, data: { mutedUntil: null } })
  })

  it('nothing is pushed while the person has PulseTrack in front', async () => {
    await request(app).get('/api/chat/calls/active').set(...auth(w.itadMember)).set('X-PT-Visible', '1').expect(200)
    await request(app).post(`/api/chat/conversations/${dm}/messages`).set(...auth(w.itadLead)).send({ body: 'seen in the app' }).expect(201)
    await flush()
    expect(sent).toHaveLength(0)
  })

  it('an incoming call rings with Answer / Decline; a missed call replaces it', async () => {
    await new Promise((r) => setTimeout(r, 15_100)) // the "in front" mark from the last test runs out
    const c = await request(app).post(`/api/chat/conversations/${dm}/calls`).set(...auth(w.itadLead)).send({ video: true }).expect(201)
    await flush()
    const ring = sent.find((s) => s.payload.kind === 'call')!
    expect(ring.payload).toMatchObject({ callId: c.body.call.id, video: true, sticky: true, tag: `call-${c.body.call.id}` })
    expect(String(ring.payload.url)).toContain(`answer=${c.body.call.id}`)
    expect(ring.opts).toMatchObject({ urgency: 'high' })
    sent.length = 0
    // the caller gives up: the one who never answered gets "Missed video call"
    await request(app).post(`/api/chat/calls/${c.body.call.id}/join`).set(...auth(w.itadLead)).send({}).expect(200)
    await request(app).post(`/api/chat/calls/${c.body.call.id}/leave`).set(...auth(w.itadLead)).send({}).expect(200)
    await flush()
    expect(sent.find((s) => s.payload.kind === 'missed')?.payload).toMatchObject({ tag: `call-${c.body.call.id}`, title: 'Missed video call' })
  }, 30_000)

  it('a device the browser dropped is forgotten', async () => {
    failWith = 410
    await request(app).post(`/api/chat/conversations/${dm}/messages`).set(...auth(w.itadLead)).send({ body: 'hello?' }).expect(201)
    await flush()
    expect(await prisma.pushSubscription.count({ where: { userId: w.itadMember.id } })).toBe(0)
  })
})

describe('chat extras', () => {
  it('any emoji can be a reaction, text cannot', async () => {
    const m = await request(app).post(`/api/chat/conversations/${dm}/messages`).set(...auth(w.itadLead)).send({ body: 'react to me' }).expect(201)
    await request(app).post(`/api/chat/messages/${m.body.message.id}/react`).set(...auth(w.itadMember)).send({ emoji: '🔥' }).expect(200)
    await request(app).post(`/api/chat/messages/${m.body.message.id}/react`).set(...auth(w.itadMember)).send({ emoji: '👍🏽' }).expect(200)
    await request(app).post(`/api/chat/messages/${m.body.message.id}/react`).set(...auth(w.itadMember)).send({ emoji: 'lol' }).expect(422)
    expect(isOneEmoji('🏳️‍🌈')).toBe(true)
    expect(isOneEmoji('<script>')).toBe(false)
  })

  it('voice messages, photos and videos have short names in the chat list', () => {
    expect(fileLabel('voice-note-75s.webm', 'audio/webm')).toBe('🎤 Voice message (1:15)')
    expect(fileLabel('IMG_1.jpg', 'image/jpeg')).toBe('📷 Photo')
    expect(fileLabel('clip.mp4', 'video/mp4')).toBe('🎥 Video')
    expect(fileLabel('report.pdf', 'application/pdf')).toBe('📎 report.pdf')
  })

  it('a team lead in a group can change its picture, and everyone sees who did', async () => {
    const g = await request(app).post('/api/chat/conversations').set(...auth(w.itadMember)).send({ type: 'GROUP', name: 'Pics', userIds: [w.itadLead.id, w.leadgenMember.id] }).expect(201)
    const id = g.body.conversation.id
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)])
    // a plain member who is not the group admin cannot
    await request(app).post(`/api/avatars/chat/${id}`).set(...auth(w.leadgenMember)).set('Content-Type', 'image/jpeg').send(jpeg).expect(403)
    // the team lead can (not the admin of this group)
    await request(app).post(`/api/avatars/chat/${id}`).set(...auth(w.itadLead)).set('Content-Type', 'image/jpeg').send(jpeg).expect(200)
    const msgs = await request(app).get(`/api/chat/conversations/${id}/messages`).set(...auth(w.leadgenMember)).expect(200)
    const line = msgs.body.messages.find((m: { system: string | null }) => m.system === 'picture')
    expect(line.body).toBe("changed this group's picture")
    expect(line.user.id).toBe(w.itadLead.id)
    const c = await request(app).get(`/api/chat/conversations/${id}`).set(...auth(w.leadgenMember)).expect(200)
    expect(c.body.conversation.picture.by).toBeTruthy()
    expect(c.body.conversation.canChangePicture).toBe(false)
    // app lines cannot be edited
    await request(app).patch(`/api/chat/messages/${line.id}`).set(...auth(w.itadLead)).send({ body: 'hacked' }).expect(422)
  })
})
