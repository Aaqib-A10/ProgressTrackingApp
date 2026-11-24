import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'

// "My menu" (each person hides sidebar items for themselves) and deleting a leftover Marketing board task from My Tasks.

let w: SeededWorld
beforeAll(async () => { w = await seedWorld() })
afterAll(async () => { await prisma.$disconnect() })

describe('My menu', () => {
  it('a person hides items on their own sidebar, and brings them back', async () => {
    const me = () => request(app).get('/api/auth/me').set(...auth(w.itadMember)).expect(200)
    expect((await me()).body.user.navHidden).toEqual([])

    const hidden = ['/app/notes', 'g:Marketing', 's:Marketing › Social Media', '/app/notes']
    const saved = await request(app).put('/api/auth/me/nav').set(...auth(w.itadMember)).send({ hidden }).expect(200)
    expect(saved.body.navHidden).toEqual(['/app/notes', 'g:Marketing', 's:Marketing › Social Media']) // repeats removed
    expect((await me()).body.user.navHidden).toEqual(saved.body.navHidden)
    // Only their own menu: nobody else's changed.
    expect((await request(app).get('/api/auth/me').set(...auth(w.itadLead)).expect(200)).body.user.navHidden).toEqual([])

    await request(app).put('/api/auth/me/nav').set(...auth(w.itadMember)).send({ hidden: [] }).expect(200)
    expect((await me()).body.user.navHidden).toEqual([])
  })

  it('refuses junk and needs a sign-in', async () => {
    await request(app).put('/api/auth/me/nav').set(...auth(w.itadMember)).send({ hidden: 'everything' }).expect(400)
    await request(app).put('/api/auth/me/nav').set(...auth(w.itadMember)).send({ hidden: [''] }).expect(400)
    await request(app).put('/api/auth/me/nav').send({ hidden: [] }).expect(401)
  })
})

describe('My Tasks: delete a Marketing board task', () => {
  it('the person it is assigned to deletes it; nobody else can', async () => {
    const mine = await prisma.marketingTask.create({ data: { title: 'testing', discipline: 'SOCIAL', status: 'SCHEDULED', assigneeId: w.superAdmin.id } })
    const theirs = await prisma.marketingTask.create({ data: { title: 'someone else', discipline: 'CONTENT', status: 'BACKLOG', assigneeId: w.itadLead.id } })
    const list = async () => (await request(app).get('/api/tasks/mine').set(...auth(w.superAdmin)).expect(200)).body.pending.filter((t: { source: string }) => t.source === 'marketing')
    expect((await list()).map((t: { title: string }) => t.title)).toEqual(['testing'])

    // Not mine: refused, and it stays.
    await request(app).delete(`/api/tasks/mine/marketing/${theirs.id}`).set(...auth(w.superAdmin)).expect(404)
    await request(app).delete(`/api/tasks/mine/marketing/${mine.id}`).set(...auth(w.itadMember)).expect(404)
    await request(app).delete(`/api/tasks/mine/marketing/${mine.id}`).expect(401)
    expect(await prisma.marketingTask.count()).toBe(2)

    await request(app).delete(`/api/tasks/mine/marketing/${mine.id}`).set(...auth(w.superAdmin)).expect(204)
    expect(await list()).toEqual([])
    expect(await prisma.marketingTask.findUnique({ where: { id: theirs.id } })).not.toBeNull()
  })
})
