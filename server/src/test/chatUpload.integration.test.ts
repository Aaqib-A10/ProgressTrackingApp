import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'

let w: SeededWorld
let convId = ''
beforeAll(async () => {
  w = await seedWorld()
  const g = await request(app).post('/api/chat/conversations').set(...auth(w.itadLead)).send({ type: 'GROUP', name: 'Video team', userIds: [w.itadMember.id] }).expect(201)
  convId = g.body.conversation.id
})
afterAll(async () => { await prisma.$disconnect() })

describe('sending big files in pieces', () => {
  it('a video arrives in pieces, retries are safe, and it plays in the browser', async () => {
    const data = Buffer.from('0123456789AB')
    const s = await request(app).post(`/api/chat/conversations/${convId}/uploads`).set(...auth(w.itadMember)).send({ name: 'clip.mov', mime: 'video/quicktime', size: data.length }).expect(201)
    const id = s.body.uploadId
    // someone else cannot add to it
    await request(app).post(`/api/chat/uploads/${id}/piece?index=0`).set(...auth(w.itadLead)).set('Content-Type', 'application/octet-stream').send(data.subarray(0, 7)).expect(404)
    await request(app).post(`/api/chat/uploads/${id}/piece?index=0`).set(...auth(w.itadMember)).set('Content-Type', 'application/octet-stream').send(data.subarray(0, 7)).expect(200)
    await request(app).post(`/api/chat/uploads/${id}/piece?index=0`).set(...auth(w.itadMember)).set('Content-Type', 'application/octet-stream').send(data.subarray(0, 7)).expect(200) // retry
    await request(app).post(`/api/chat/uploads/${id}/piece?index=2`).set(...auth(w.itadMember)).set('Content-Type', 'application/octet-stream').send(data.subarray(7)).expect(409)
    // not complete yet
    await request(app).post(`/api/chat/uploads/${id}/finish`).set(...auth(w.itadMember)).send({}).expect(409)
    await request(app).post(`/api/chat/uploads/${id}/piece?index=1`).set(...auth(w.itadMember)).set('Content-Type', 'application/octet-stream').send(data.subarray(7)).expect(200)
    const f = await request(app).post(`/api/chat/uploads/${id}/finish`).set(...auth(w.itadMember)).send({ caption: 'site visit' }).expect(201)
    expect(f.body.message.body).toBe('site visit')
    expect(f.body.message.file.name).toBe('clip.mov')
    const dl = await request(app).get(`${f.body.message.file.url.replace(/^\/api/, '/api')}?inline=1`).set(...auth(w.itadLead)).buffer(true).parse((res, cb) => { const b: Buffer[] = []; res.on('data', (c: Buffer) => b.push(c)); res.on('end', () => cb(null, Buffer.concat(b))) }).expect(200)
    expect(dl.headers['content-type']).toContain('video/quicktime')
    expect(dl.headers['content-disposition']).toMatch(/^inline/)
    expect(Buffer.compare(dl.body as Buffer, data)).toBe(0)
  })

  it('refuses blocked types, files over 500 MB, and outsiders', async () => {
    await request(app).post(`/api/chat/conversations/${convId}/uploads`).set(...auth(w.itadMember)).send({ name: 'x.exe', size: 10 }).expect(415)
    await request(app).post(`/api/chat/conversations/${convId}/uploads`).set(...auth(w.itadMember)).send({ name: 'big.mp4', mime: 'video/mp4', size: 501 * 1024 * 1024 }).expect(413)
    const r = await request(app).post(`/api/chat/conversations/${convId}/uploads`).set(...auth(w.leadgenMember)).send({ name: 'a.mp4', mime: 'video/mp4', size: 10 })
    expect([403, 404]).toContain(r.status)
  })

  it('a cancelled upload is gone', async () => {
    const s = await request(app).post(`/api/chat/conversations/${convId}/uploads`).set(...auth(w.itadMember)).send({ name: 'a.mp4', mime: 'video/mp4', size: 4 }).expect(201)
    await request(app).delete(`/api/chat/uploads/${s.body.uploadId}`).set(...auth(w.itadMember)).expect(204)
    await request(app).post(`/api/chat/uploads/${s.body.uploadId}/finish`).set(...auth(w.itadMember)).send({}).expect(404)
  })
})
