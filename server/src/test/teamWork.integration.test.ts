import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { dbDateFromString, companyToday } from '../lib/time'

// "What everyone is working on" on the dashboard (24 Nov 2026): real work from projects and to-dos, for every kind of
// person (a marketer who builds websites or edits videos showed nothing before). Who sees whom, and what stays private.

let w: SeededWorld
type Person = { id: string; name: string; doing: { title: string; kind: string }[]; done: { total: number; tasks: number; todos: number; recent: { title: string }[] }; open: number; overdue: number }
const work = async (u: { id: string; role: SeededWorld['itadLead']['role'] }) => (await request(app).get('/api/dashboard/work?range=week').set(...auth(u)).expect(200)).body as { scope: string; people: Person[] }
const titles = (p: Person | undefined) => (p?.doing ?? []).map((d) => d.title)

beforeAll(async () => {
  w = await seedWorld()
  // A project only the ITAD member is in: their lead may see that they work on it, not what the task is.
  const project = await prisma.pmProject.create({ data: { name: 'Website rebuild', key: 'WEBX', ownerId: w.superAdmin.id } })
  const [todo, doing, done] = await Promise.all([
    prisma.pmColumn.create({ data: { projectId: project.id, name: 'To do', category: 'TODO', isDefault: true } }),
    prisma.pmColumn.create({ data: { projectId: project.id, name: 'Doing', category: 'IN_PROGRESS', position: 1 } }),
    prisma.pmColumn.create({ data: { projectId: project.id, name: 'Done', category: 'DONE', position: 2 } }),
  ])
  await prisma.pmProjectMember.create({ data: { projectId: project.id, userId: w.itadMember.id, role: 'MEMBER' } })
  const task = (code: string, title: string, columnId: string, extra: Record<string, unknown> = {}) =>
    prisma.pmTask.create({ data: { projectId: project.id, code, title, columnId, createdById: w.superAdmin.id, assignees: { create: [{ userId: w.itadMember.id }] }, ...extra } })
  await task('WEBX-1', 'Build the landing page', doing.id)
  await task('WEBX-2', 'Edit the product video', done.id, { completedAt: new Date() })
  await task('WEBX-3', 'Design the pricing page', todo.id, { dueAt: new Date(Date.now() - 2 * 86_400_000) })
  const today = dbDateFromString(companyToday())
  await prisma.workLogEntry.create({ data: { userId: w.itadMember.id, period: 'DAY', periodStart: today, title: 'Design the brochure', status: 'IN_PROGRESS' } })
  await prisma.workLogEntry.create({ data: { userId: w.itadMember.id, period: 'DAY', periodStart: today, title: 'Look for a new job', status: 'IN_PROGRESS', private: true } })
  await prisma.workLogEntry.create({ data: { userId: w.itadMember.id, period: 'DAY', periodStart: today, title: 'Send the logo files', status: 'DONE', doneAt: new Date() } })
})
afterAll(async () => { await prisma.$disconnect() })

describe('What everyone is working on', () => {
  it('a member sees only themself: all their own work, private to-dos too', async () => {
    const r = await work(w.itadMember)
    expect(r.scope).toBe('me')
    expect(r.people.map((p) => p.id)).toEqual([w.itadMember.id])
    const me = r.people[0]
    expect(titles(me)).toEqual(expect.arrayContaining(['Build the landing page', 'Design the brochure', 'Look for a new job']))
    expect(me.done).toMatchObject({ total: 2, tasks: 1, todos: 1 })
    expect(me.done.recent.map((d) => d.title)).toEqual(expect.arrayContaining(['Edit the product video', 'Send the logo files']))
    expect(me.open).toBe(2) // in progress and to do; the finished one is not open
    expect(me.overdue).toBe(1)
  })

  it('a team lead sees their team, themself included, never another team or a private to-do', async () => {
    const r = await work(w.itadLead)
    expect(r.scope).toBe('team')
    const ids = r.people.map((p) => p.id)
    expect(ids).toEqual(expect.arrayContaining([w.itadLead.id, w.itadMember.id]))
    expect(ids).not.toContain(w.leadgenMember.id)
    const member = r.people.find((p) => p.id === w.itadMember.id)
    expect(titles(member)).toContain('Design the brochure')
    expect(titles(member)).not.toContain('Look for a new job')
    // Not in the project: the work counts, its title stays in the project.
    expect(titles(member)).toContain('A task in another project')
    expect(titles(member)).not.toContain('Build the landing page')
    expect(member!.done.total).toBe(2)
    // The busiest person comes first.
    expect(r.people[0].id).toBe(w.itadMember.id)
  })

  it('another team lead does not see this team; the Super Admin sees everyone and every project', async () => {
    expect((await work(w.leadgenLead)).people.map((p) => p.id)).not.toContain(w.itadMember.id)
    const all = await work(w.superAdmin)
    expect(all.scope).toBe('company')
    const member = all.people.find((p) => p.id === w.itadMember.id)
    expect(titles(member)).toContain('Build the landing page')
    expect(titles(member)).not.toContain('Look for a new job')
    expect(all.people.map((p) => p.id)).toContain(w.leadgenMember.id)
  })

  it('needs a sign-in', async () => {
    await request(app).get('/api/dashboard/work').expect(401)
  })
})
