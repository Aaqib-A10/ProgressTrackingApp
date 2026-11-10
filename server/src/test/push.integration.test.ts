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
import { fcmBody, useNativeSenderForTests, type NativeMessage, type NativeResult } from '../lib/nativePush'
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
    const posted = await request(app).post(`/api/chat/conversations/${dm}/messages`).set(...auth(w.itadLead)).send({ body: 'Are the pages ready?' }).expect(201)
    await flush()
    expect(sent).toHaveLength(1)
    // The message id lets the browser show each message once (push and open tab agree).
    expect(sent[0].payload).toMatchObject({ kind: 'msg', body: 'Are the pages ready?', tag: `chat-${dm}`, url: `/app/chat?c=${dm}`, messageId: posted.body.message.id })
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

  it('every bell notification reaches the phone too, and a tap opens the same place', async () => {
    // itadMember subscribed in the first test; a lead-style alert is just a Notification row.
    await prisma.notification.create({ data: { userId: w.itadMember.id, type: 'TASK_DUE_SOON', title: 'Due now: Call Dan', body: 'Desert HHW', link: '/app/leads/abc', entityType: 'Lead', entityId: 'abc' } })
    await flush()
    const mine = sent.filter((s) => s.payload.title === 'Due now: Call Dan')
    expect(mine.length).toBeGreaterThanOrEqual(1)
    expect(mine[0].payload).toMatchObject({ kind: 'alert', type: 'TASK_DUE_SOON', body: 'Desert HHW', url: '/app/leads/abc' })
    expect(String(mine[0].payload.tag)).toMatch(/^n-Lead-abc/)
    // Several people in one createMany: one pop-up each; nobody looking at Metriq right now is counted.
    sent.length = 0
    await prisma.notification.createMany({ data: [w.itadMember.id, w.itadLead.id].map((userId) => ({ userId, type: 'MENTION' as const, title: 'Sam mentioned you', body: 'on a card' })) })
    await flush()
    expect(sent.filter((s) => s.payload.title === 'Sam mentioned you').length).toBeGreaterThanOrEqual(1)
    expect(sent.find((s) => s.payload.title === 'Sam mentioned you')?.payload.url).toBe('/app/notifications')
  })

  it('one notification is one pop-up: the push carries the id the bell shows, so a browser shows it once', async () => {
    await request(app).post('/api/push/subscribe').set(...auth(w.itadLead)).send(sub(2)).expect(200)
    sent.length = 0
    const one = await prisma.notification.create({ data: { userId: w.itadMember.id, type: 'GRACE_EXCEEDED', title: 'Late sign-in', body: 'Sam exceeded the 10m sign-in grace today.' } })
    await flush()
    const mine = sent.filter((s) => s.payload.title === 'Late sign-in')
    expect(mine).toHaveLength(1)
    expect(mine[0].payload.nid).toBe(one.id)
    // Several people in one save: each gets one pop-up, with the id of their own row.
    sent.length = 0
    await prisma.notification.createMany({ data: [w.itadMember.id, w.itadLead.id].map((userId) => ({ userId, type: 'BREAK_OVERRUN' as const, title: 'Break exceeded limit', body: 'Sam’s break is 50m (limit 30m) today.' })) })
    await flush()
    const many = sent.filter((s) => s.payload.title === 'Break exceeded limit')
    expect(many).toHaveLength(2)
    const rows = await prisma.notification.findMany({ where: { title: 'Break exceeded limit' }, select: { id: true } })
    expect(many.map((m) => String(m.payload.nid)).sort()).toEqual(rows.map((r) => r.id).sort())
    // The same alert saved twice for one person in one go is still one pop-up.
    sent.length = 0
    await prisma.notification.createMany({ data: [1, 2].map(() => ({ userId: w.itadMember.id, type: 'MENTION' as const, title: 'Twice in one save', body: 'same words' })) })
    await flush()
    expect(sent.filter((s) => s.payload.title === 'Twice in one save')).toHaveLength(1)
  })

  it('the Metriq phone app registers its phone, and gets the same notifications as native push', async () => {
    const TOKEN = 'fcm-token-of-sams-phone_AAAA:1234567890abcdefghij'
    // No push key on the server: the app is told so and does not register.
    expect((await request(app).get('/api/push/key').set(...auth(w.itadMember)).expect(200)).body.nativePush).toBe(false)
    const phone: NativeMessage[] = []
    let answer: NativeResult = 'ok'
    useNativeSenderForTests(async (m) => { phone.push(m); return answer })
    expect((await request(app).get('/api/push/key').set(...auth(w.itadMember)).expect(200)).body.nativePush).toBe(true)
    await request(app).post('/api/push/device').set(...auth(w.itadMember)).send({ token: 'short', platform: 'android' }).expect(422)
    await request(app).post('/api/push/device').set(...auth(w.itadMember)).send({ token: TOKEN, platform: 'windows' }).expect(422)
    await request(app).post('/api/push/device').send({ token: TOKEN, platform: 'android' }).expect(401)
    await request(app).post('/api/push/device').set(...auth(w.itadMember)).send({ token: TOKEN, platform: 'android', appVersion: '1.0' }).expect(200)
    await request(app).post('/api/push/device').set(...auth(w.itadMember)).send({ token: TOKEN, platform: 'android', appVersion: '1.0' }).expect(200) // again: no duplicate
    expect(await prisma.pushDevice.count({ where: { userId: w.itadMember.id } })).toBe(1)

    // A bell notification reaches the phone once, with the place to open and the id the bell shows.
    const n = await prisma.notification.create({ data: { userId: w.itadMember.id, type: 'TASK_DUE_SOON', title: 'Due now: Call Dan', body: 'Desert HHW', link: '/app/leads/abc', entityType: 'Lead', entityId: 'abc' } })
    await flush()
    expect(phone).toHaveLength(1)
    expect(phone[0]).toMatchObject({ token: TOKEN, platform: 'android', urgent: false })
    expect(phone[0].payload).toMatchObject({ kind: 'alert', title: 'Due now: Call Dan', url: '/app/leads/abc', nid: n.id })
    // What Google is sent: title and body to show, the address and id as data, Metriq's own channel.
    const body = fcmBody(phone[0]) as { message: { token: string; notification: { title: string }; data: Record<string, string>; android: { priority: string; notification: { channel_id: string; tag: string } } } }
    expect(body.message.token).toBe(TOKEN)
    expect(body.message.notification.title).toBe('Due now: Call Dan')
    expect(body.message.data).toMatchObject({ kind: 'alert', url: '/app/leads/abc', nid: n.id })
    expect(body.message.android).toMatchObject({ priority: 'NORMAL', notification: { channel_id: 'metriq_alerts' } })
    expect(Object.values(body.message.data).every((v) => typeof v === 'string')).toBe(true)

    // A chat message is urgent (wakes the phone).
    phone.length = 0
    await request(app).post(`/api/chat/conversations/${dm}/messages`).set(...auth(w.itadLead)).send({ body: 'On the phone too?' }).expect(201)
    await flush()
    expect(phone).toHaveLength(1)
    expect(phone[0].payload).toMatchObject({ kind: 'msg', body: 'On the phone too?' })
    expect(phone[0].urgent).toBe(true)

    // The same phone signs in as someone else: the notifications follow the new person.
    await request(app).post('/api/push/device').set(...auth(w.itadLead)).send({ token: TOKEN, platform: 'android' }).expect(200)
    expect(await prisma.pushDevice.count({ where: { userId: w.itadMember.id } })).toBe(0)
    expect(await prisma.pushDevice.count({ where: { userId: w.itadLead.id } })).toBe(1)
    // Someone else cannot remove my phone; I can (sign-out).
    await request(app).post('/api/push/device/remove').set(...auth(w.itadMember)).send({ token: TOKEN }).expect(200)
    expect(await prisma.pushDevice.count({ where: { token: TOKEN } })).toBe(1)
    // The app was removed from the phone: Google says so, the phone is forgotten.
    answer = 'gone'
    await prisma.notification.create({ data: { userId: w.itadLead.id, type: 'MENTION', title: 'Gone phone', body: 'x' } })
    await flush()
    expect(await prisma.pushDevice.count({ where: { token: TOKEN } })).toBe(0)
    await request(app).post('/api/push/device').set(...auth(w.itadLead)).send({ token: TOKEN, platform: 'ios' }).expect(200)
    await request(app).post('/api/push/device/remove').set(...auth(w.itadLead)).send({ token: TOKEN }).expect(200)
    expect(await prisma.pushDevice.count({ where: { token: TOKEN } })).toBe(0)
    useNativeSenderForTests(null)
  })

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
