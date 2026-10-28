import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Role } from '@prisma/client'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { hashPassword } from '../lib/auth'
import { refreshWalls } from '../lib/tenancy'
import { ensureHomeCompany, forEachCompany, HOME_COMPANY_ID } from '../lib/company'
import { runDeadlineTick } from '../lib/pm/deadlines'

// Phase 1, step 3: the company walls in real flows. A second company ("Delta") works next to
// 99 Technologies: it cannot pull 99 Technologies' people into its projects, tasks or chats,
// background jobs keep the two apart, files go in Delta's own folder, and the old sign-up
// page still makes 99 Technologies accounts.

const D = 'walls-delta'
let w: SeededWorld
let delta: { admin: { id: string; role: Role }; member: { id: string; role: Role }; other: { id: string; role: Role } }

beforeAll(async () => {
  w = await seedWorld()
  await ensureHomeCompany()
  await prisma.featureFlag.deleteMany({ where: { key: 'company-walls' } })
  await refreshWalls(prisma)
  await prisma.company.deleteMany({ where: { id: D } })
  await prisma.company.create({ data: { id: D, name: 'Delta Test Co', slug: D, plan: 'business' } })
  const itad = await prisma.department.create({ data: { companyId: D, type: 'ITAD', name: 'Delta ITAD' } })
  const passwordHash = await hashPassword('Pass-for-tests-9')
  const mk = (name: string, role: Role) => prisma.user.create({ data: { companyId: D, name, email: `${name.replace(/\s+/g, '.').toLowerCase()}@delta.local.test`, role, status: 'ACTIVE', isActive: true, passwordHash, departmentId: role === 'SUPER_ADMIN' ? null : itad.id } })
  const [admin, member, other] = await Promise.all([mk('Delta Admin', 'SUPER_ADMIN'), mk('Delta Member', 'MEMBER'), mk('Delta Other', 'MEMBER')])
  delta = { admin: { id: admin.id, role: admin.role }, member: { id: member.id, role: member.role }, other: { id: other.id, role: other.role } }
})
afterAll(async () => {
  await prisma.company.deleteMany({ where: { id: D } })
  await prisma.$disconnect()
})

describe("a company cannot reach another company's people", () => {
  it("Delta's project can only have Delta's people", async () => {
    const bad = await request(app).post('/api/projects').set(...auth(delta.admin)).send({ name: 'Delta One', key: 'DLT', members: [{ userId: w.itadMember.id, role: 'MEMBER' }] })
    expect(bad.status).toBeGreaterThanOrEqual(400)
    expect(bad.status).toBeLessThan(500)
    expect(await prisma.pmProjectMember.count({ where: { userId: w.itadMember.id } })).toBe(0)
    const ok = await request(app).post('/api/projects').set(...auth(delta.admin)).send({ name: 'Delta One', key: 'DLT', members: [{ userId: delta.member.id, role: 'MEMBER' }] }).expect(201)
    expect((await prisma.pmProject.findUniqueOrThrow({ where: { id: ok.body.project.id } })).companyId).toBe(D)
  })

  it('the same project key and task codes can exist in two companies', async () => {
    await request(app).post('/api/projects').set(...auth(w.superAdmin)).send({ name: 'Home One', key: 'DLT' }).expect(201)
    const t1 = await request(app).post('/api/projects/DLT/tasks').set(...auth(delta.member)).send({ title: 'Delta task' }).expect(201)
    const t2 = await request(app).post('/api/projects/DLT/tasks').set(...auth(w.superAdmin)).send({ title: 'Home task' }).expect(201)
    expect(t1.body.task.code).toBe('DLT-1')
    expect(t2.body.task.code).toBe('DLT-1')
    const seen = (await request(app).get('/api/projects/tasks/DLT-1').set(...auth(delta.member)).expect(200)).body.task
    expect(seen.title).toBe('Delta task')
  })

  it("a task cannot be given to someone in another company", async () => {
    const r = await request(app).post('/api/projects/DLT/tasks').set(...auth(delta.admin)).send({ title: 'Sneaky', assigneeIds: [w.itadMember.id] })
    expect(r.status).toBeGreaterThanOrEqual(400)
    expect(r.status).toBeLessThan(500)
    expect(await prisma.pmTaskAssignee.count({ where: { userId: w.itadMember.id } })).toBe(0)
  })

  it('no chat with someone in another company', async () => {
    const r = await request(app).post('/api/chat/conversations').set(...auth(delta.member)).send({ type: 'DIRECT', userId: w.itadMember.id })
    expect(r.status).toBe(422)
    await request(app).post('/api/chat/conversations').set(...auth(delta.member)).send({ type: 'DIRECT', userId: delta.other.id }).expect(201)
    const people = (await request(app).get('/api/chat/users').set(...auth(delta.member)).expect(200)).body
    expect(JSON.stringify(people)).not.toContain(w.itadMember.id)
  })
})

describe('background jobs run company by company', () => {
  it("an overdue task alerts its own company's Super Admin, never another company's", async () => {
    const home = await prisma.pmProject.findFirstOrThrow({ where: { companyId: HOME_COMPANY_ID, key: 'DLT' } })
    const col = await prisma.pmColumn.findFirstOrThrow({ where: { projectId: home.id } })
    await prisma.pmTask.create({ data: { projectId: home.id, columnId: col.id, code: 'DLT-99', title: 'Late home task', createdById: w.superAdmin.id, dueAt: new Date(Date.now() - 3 * 3600_000), assignees: { create: { userId: w.superAdmin.id } } } })
    await forEachCompany(() => runDeadlineTick(new Date()))
    expect(await prisma.notification.count({ where: { userId: delta.admin.id } })).toBe(0)
    expect(await prisma.notification.count({ where: { userId: w.superAdmin.id, title: { contains: 'DLT-99' } } })).toBeGreaterThan(0)
  })
})

describe('files', () => {
  it("another company's files go in a folder of their own; 99 Technologies' stay where they always were", async () => {
    const dm = (await request(app).post('/api/chat/conversations').set(...auth(delta.member)).send({ type: 'DIRECT', userId: delta.other.id })).body.conversation.id
    const sent = await request(app).post(`/api/chat/conversations/${dm}/files?name=notes.txt`).set(...auth(delta.member)).set('Content-Type', 'text/plain').send(Buffer.from('hello delta')).expect(201)
    const msg = await prisma.chatMessage.findFirstOrThrow({ where: { conversationId: dm, fileStoredName: { not: null } }, orderBy: { createdAt: 'desc' } })
    expect(msg.fileStoredName!.startsWith(`${D}/`)).toBe(true)
    await fs.access(path.resolve('uploads', 'chat', msg.fileStoredName!))
    const back = await request(app).get(`/api/chat/files/${msg.id}`).set(...auth(delta.other)).expect(200)
    expect(back.text ?? back.body.toString()).toContain('hello delta')
    void sent
    const homeDm = (await request(app).post('/api/chat/conversations').set(...auth(w.itadMember)).send({ type: 'DIRECT', userId: w.itadLead.id })).body.conversation.id
    await request(app).post(`/api/chat/conversations/${homeDm}/files?name=a.txt`).set(...auth(w.itadMember)).set('Content-Type', 'text/plain').send(Buffer.from('home')).expect(201)
    const homeMsg = await prisma.chatMessage.findFirstOrThrow({ where: { conversationId: homeDm, fileStoredName: { not: null } } })
    expect(homeMsg.fileStoredName!.includes('/')).toBe(false)
    await request(app).get(`/api/chat/files/${msg.id}`).set(...auth(w.itadMember)).expect(404)
  })
})

describe('the old sign-up page', () => {
  it("still makes 99 Technologies accounts, in 99 Technologies' departments", async () => {
    await request(app).post('/api/auth/signup').send({ name: 'New Home Lead', email: 'new.home.lead@test.local', password: 'Password123!', department: 'ITAD' }).expect(201)
    const u = await prisma.user.findUniqueOrThrow({ where: { email: 'new.home.lead@test.local' }, include: { department: true } })
    expect(u.companyId).toBe(HOME_COMPANY_ID)
    expect(u.department?.companyId).toBe(HOME_COMPANY_ID)
  })
})
