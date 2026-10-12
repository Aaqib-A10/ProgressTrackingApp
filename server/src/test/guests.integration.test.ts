import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { resetCalls } from '../lib/pm/calls'

// People outside Metriq joining a call by link: ask to join, wait, get let in, take part.

let w: SeededWorld
let convId = ''
let token = ''
let callId = ''

/** The guest's cookie jar (one browser). */
function guestAgent() {
  return request.agent(app)
}

beforeAll(async () => {
  w = await seedWorld()
  resetCalls()
  const g = await request(app).post('/api/chat/conversations').set(...auth(w.itadLead)).send({ type: 'GROUP', name: 'Client call', userIds: [w.itadMember.id] }).expect(201)
  convId = g.body.conversation.id
})
afterAll(async () => { await prisma.$disconnect() })

describe('guest links', () => {
  it('a member makes a link; outsiders cannot', async () => {
    const r = await request(app).post(`/api/chat/conversations/${convId}/guest-link`).set(...auth(w.itadMember)).send({}).expect(200)
    token = r.body.token
    expect(r.body.url).toContain(`/join/${token}`)
    // same link again unless a new one is asked for
    const again = await request(app).post(`/api/chat/conversations/${convId}/guest-link`).set(...auth(w.itadLead)).send({}).expect(200)
    expect(again.body.token).toBe(token)
    await request(app).post(`/api/chat/conversations/${convId}/guest-link`).set(...auth(w.leadgenMember)).send({}).expect(404)
  })

  it('before the call starts the guest is told to wait', async () => {
    const info = await request(app).get(`/api/guest/${token}`).expect(200)
    expect(info.body).toMatchObject({ title: 'Client call', live: false })
    await request(app).post(`/api/guest/${token}/knock`).send({ name: 'Sara Khan' }).expect(409)
    await request(app).get('/api/guest/not-a-real-link-at-all-xx').expect(404)
  })

  it('asks to join, waits, is let in, and takes part in the call only', async () => {
    const c = await request(app).post(`/api/chat/conversations/${convId}/calls`).set(...auth(w.itadLead)).send({ video: true }).expect(201)
    callId = c.body.call.id
    await request(app).post(`/api/chat/calls/${callId}/join`).set(...auth(w.itadLead)).send({}).expect(200)

    const guest = guestAgent()
    await guest.post(`/api/guest/${token}/knock`).send({ name: '<b>' }).expect(422)
    const k = await guest.post(`/api/guest/${token}/knock`).send({ name: 'Sara Khan' }).expect(200)
    expect(k.body.status).toBe('waiting')
    // not let in yet: cannot join
    await guest.post(`/api/chat/calls/${callId}/join`).set('X-PT-Guest', '1').send({}).expect(404)

    // the person in the call sees the request
    const p = await request(app).get(`/api/chat/calls/${callId}/poll`).set(...auth(w.itadLead)).expect(200)
    expect(p.body.lobby).toHaveLength(1)
    const gid = p.body.lobby[0].id as string
    expect(p.body.lobby[0].name).toBe('Sara Khan')
    // someone not in the call cannot let them in
    await request(app).post(`/api/chat/calls/${callId}/lobby`).set(...auth(w.itadMember)).send({ guestId: gid, admit: true }).expect(403)
    await request(app).post(`/api/chat/calls/${callId}/lobby`).set(...auth(w.itadLead)).send({ guestId: gid, admit: true }).expect(200)

    const st = await guest.get(`/api/guest/${token}/status`).expect(200)
    expect(st.body).toMatchObject({ status: 'admitted', callId, me: gid, name: 'Sara Khan (Guest)' })
    const j = await guest.post(`/api/chat/calls/${callId}/join`).set('X-PT-Guest', '1').send({ mic: true, cam: true }).expect(200)
    expect(j.body.others.map((o: { userId: string }) => o.userId)).toContain(w.itadLead.id)
    await guest.get(`/api/chat/calls/${callId}/poll`).set('X-PT-Guest', '1').expect(200)
    await guest.post(`/api/chat/calls/${callId}/state`).set('X-PT-Guest', '1').send({ mic: false }).expect(200)

    // everyone sees "Sara Khan (Guest)"
    const p2 = await request(app).get(`/api/chat/calls/${callId}/poll`).set(...auth(w.itadLead)).expect(200)
    expect(p2.body.participants.map((x: { name: string }) => x.name)).toContain('Sara Khan (Guest)')
    expect(p2.body.lobby).toHaveLength(0)

    // the guest pass opens nothing else
    await guest.get(`/api/chat/conversations/${convId}/messages`).set('X-PT-Guest', '1').expect(401)
    await guest.get('/api/chat/conversations').expect(401)
    await guest.post(`/api/chat/calls/${callId}/notes`).set('X-PT-Guest', '1').send({ on: true }).expect(401)
    await guest.get('/api/auth/me').expect(401)
    // ...and only for this chat's calls
    await guest.post(`/api/chat/calls/${callId}/leave`).set('X-PT-Guest', '1').send({}).expect(200)
  })

  it('a new link stops the old one; turning it off stops it too', async () => {
    const r = await request(app).post(`/api/chat/conversations/${convId}/guest-link`).set(...auth(w.itadLead)).send({ reset: true }).expect(200)
    expect(r.body.token).not.toBe(token)
    await request(app).get(`/api/guest/${token}`).expect(404)
    await request(app).delete(`/api/chat/conversations/${convId}/guest-link`).set(...auth(w.itadLead)).expect(204)
    await request(app).get(`/api/guest/${r.body.token}`).expect(404)
  })

  it('a refused guest stays out', async () => {
    const r = await request(app).post(`/api/chat/conversations/${convId}/guest-link`).set(...auth(w.itadLead)).send({}).expect(200)
    const guest = guestAgent()
    await guest.post(`/api/guest/${r.body.token}/knock`).send({ name: 'Unknown Person' }).expect(200)
    const p = await request(app).get(`/api/chat/calls/${callId}/poll`).set(...auth(w.itadLead)).expect(200)
    await request(app).post(`/api/chat/calls/${callId}/lobby`).set(...auth(w.itadLead)).send({ guestId: p.body.lobby[0].id, admit: false }).expect(200)
    expect((await guest.get(`/api/guest/${r.body.token}/status`).expect(200)).body.status).toBe('denied')
    await guest.post(`/api/chat/calls/${callId}/join`).set('X-PT-Guest', '1').send({}).expect(404)
  })
})
