import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Role } from '@prisma/client'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { hashPassword } from '../lib/auth'
import { ensureHomeCompany } from '../lib/company'
import { mailLog } from '../lib/mail'

// Stage 0 of the plan: a company's own admins take all their data as one file and can remove the company for good.

const C = 'data-delta-co'
const PASSWORD = 'Delta-pass-2026'
let w: SeededWorld
let delta: { admin: { id: string; role: Role }; member: { id: string; role: Role } }

beforeAll(async () => {
  w = await seedWorld()
  await ensureHomeCompany()
  await prisma.company.deleteMany({ where: { id: C } })
  await prisma.company.create({ data: { id: C, name: 'Delta Data Co', slug: C, status: 'ACTIVE', plan: 'business' } })
  const passwordHash = await hashPassword(PASSWORD)
  const mk = (name: string, role: Role) => prisma.user.create({ data: { companyId: C, name, email: `${name.replace(/\s+/g, '.').toLowerCase()}@delta.local.test`, role, status: 'ACTIVE', isActive: true, passwordHash, totpSecret: 'JBSWY3DPEHPK3PXP', twoStepRecovery: ['aaaa'] } })
  const [admin, member] = await Promise.all([mk('Delta Admin', 'SUPER_ADMIN'), mk('Delta Member', 'MEMBER')])
  delta = { admin: { id: admin.id, role: admin.role }, member: { id: member.id, role: member.role } }
  await prisma.note.create({ data: { companyId: C, ownerId: admin.id, title: 'A note of Delta', body: 'kept' } })
})
afterAll(async () => {
  await prisma.company.deleteMany({ where: { id: C } })
  await prisma.$disconnect()
})

describe('your data', () => {
  it('an admin downloads everything their company has, and nothing of another company or any secret', async () => {
    await request(app).get('/api/company/export').set(...auth(delta.member)).expect(403)
    await request(app).get('/api/company/export').expect(401)
    const r = await request(app).get('/api/company/export').set(...auth(delta.admin)).expect(200)
    expect(r.headers['content-disposition']).toContain(`metriq-${C}-`)
    const file = JSON.parse(r.text) as { company: { id: string }; tables: Record<string, Record<string, unknown>[]> }
    expect(file.company.id).toBe(C)
    expect(file.tables.User.map((u) => u.name).sort()).toEqual(['Delta Admin', 'Delta Member'])
    expect(file.tables.Note.map((n) => n.title)).toEqual(['A note of Delta'])
    // No row of 99 Technologies, and no password, authenticator secret or recovery code.
    for (const rows of Object.values(file.tables)) for (const row of rows) expect(row.companyId).toBe(C)
    expect(r.text).not.toContain('passwordHash')
    expect(r.text).not.toContain('JBSWY3DPEHPK3PXP')
    expect(r.text).not.toContain('twoStepRecovery')
    expect(await prisma.auditLog.count({ where: { companyId: C, action: 'COMPANY_EXPORT' } })).toBe(1)
  })

  it('99 Technologies can never be removed; a company is removed only by its Super Admin, with its name and their password', async () => {
    await request(app).post('/api/company/remove').set(...auth(w.superAdmin)).send({ confirm: 'anything', password: 'x' }).expect(400)
    await request(app).post('/api/company/remove').set(...auth(delta.member)).send({ confirm: 'Delta Data Co', password: PASSWORD }).expect(403)
    expect((await request(app).post('/api/company/remove').set(...auth(delta.admin)).send({ confirm: 'delta', password: PASSWORD }).expect(400)).body.error).toMatch(/Type the company's name/)
    expect((await request(app).post('/api/company/remove').set(...auth(delta.admin)).send({ confirm: 'Delta Data Co', password: 'wrong' }).expect(400)).body.error).toMatch(/not your password/)
    expect(await prisma.company.count({ where: { id: C } })).toBe(1)

    mailLog.length = 0
    await request(app).post('/api/company/remove').set(...auth(delta.admin)).send({ confirm: 'Delta Data Co', password: PASSWORD }).expect(204)
    expect(await prisma.company.count({ where: { id: C } })).toBe(0)
    expect(await prisma.user.count({ where: { companyId: C } })).toBe(0)
    expect(await prisma.note.count({ where: { companyId: C } })).toBe(0)
    // Its people can no longer sign in, the owner sees it in the activity log, and 99 Technologies is untouched.
    await request(app).get('/api/auth/me').set(...auth(delta.admin)).expect(401)
    expect(await prisma.ownerAuditLog.count({ where: { action: 'COMPANY_SELF_DELETE', companyId: C } })).toBe(1)
    await new Promise((done) => setTimeout(done, 50))
    expect(mailLog.some((m) => m.subject === 'Delta Data Co has been removed from Metriq')).toBe(true)
    await request(app).get('/api/auth/me').set(...auth(w.superAdmin)).expect(200)
  })
})
