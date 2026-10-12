import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'

// The search box: finds people, projects, tasks, chats, files and meetings, but only
// what the person searching could already open.

let w: SeededWorld
const find = (who: SeededWorld[keyof SeededWorld], q: string) =>
  request(app).get(`/api/search?q=${encodeURIComponent(q)}`).set(...auth(who)).expect(200).then((r) => r.body)

beforeAll(async () => {
  w = await seedWorld()
  const g = await request(app).post('/api/chat/conversations').set(...auth(w.itadLead)).send({ type: 'GROUP', name: 'Purple Room', userIds: [w.itadMember.id] }).expect(201)
  await request(app).post(`/api/chat/conversations/${g.body.conversation.id}/messages`).set(...auth(w.itadLead)).send({ body: 'please send the purple invoice today' }).expect(201)
  await request(app).post('/api/projects').set(...auth(w.superAdmin)).send({ name: 'Purple Launch', key: 'PRP', members: [{ userId: w.itadMember.id, role: 'MEMBER' }] }).expect(201)
  await request(app).post('/api/projects/PRP/tasks').set(...auth(w.itadMember)).send({ title: 'Design the purple banner' }).expect(201)
  await request(app).post('/api/todos').set(...auth(w.leadgenMember)).send({ title: 'Buy purple pens' })
})
afterAll(async () => { await prisma.$disconnect() })

describe('search', () => {
  it('finds chats, projects and tasks for people who are in them', async () => {
    const r = await find(w.itadMember, 'purple')
    expect(r.chats.map((c: { title: string }) => c.title)).toEqual(expect.arrayContaining(['Purple Room', expect.stringContaining('purple invoice')]))
    expect(r.projects.map((p: { title: string }) => p.title)).toEqual(['Purple Launch'])
    expect(r.tasks[0]).toMatchObject({ title: 'Design the purple banner', link: '/app/projects/PRP?task=PRP-1' })
    expect(r.tasks.map((t: { title: string }) => t.title)).not.toContain('Buy purple pens')
  })

  it('never shows someone else’s chats, projects or to-dos', async () => {
    const r = await find(w.leadgenMember, 'purple')
    expect(r.chats).toEqual([])
    expect(r.projects).toEqual([])
    expect(r.tasks.map((t: { title: string }) => t.title)).toEqual(['Buy purple pens'])
  })

  it('finds people by name, and opens a direct chat with them', async () => {
    const r = await find(w.itadMember, 'leadgen')
    expect(r.people.map((p: { title: string }) => p.title).sort()).toEqual(['leadgen lead', 'leadgen member'])
    expect(r.people[0].link).toMatch(/^\/app\/chat\?dm=/)
  })

  it('ignores one-letter searches and needs a login', async () => {
    expect((await find(w.itadMember, 'p')).people).toEqual([])
    await request(app).get('/api/search?q=purple').expect(401)
  })
})
