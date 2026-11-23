import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { ensureHomeCompany } from '../lib/company'

// Stage 0 of the plan: the Activity Log also records changes to people, roles, departments and company settings,
// each with a line saying what happened, and never with a password in it.

let w: SeededWorld
beforeAll(async () => { w = await seedWorld(); await ensureHomeCompany() })
afterAll(async () => { await prisma.$disconnect() })

describe('activity log', () => {
  it('records people, roles, departments and company settings, with a readable line each', async () => {
    const sa = auth(w.superAdmin)
    const made = (await request(app).post('/api/admin/users').set(...sa).send({ name: 'Nadia New', email: 'nadia.new@test.local', role: 'MEMBER', department: 'ITAD', password: 'Secret-pass-77' }).expect(201)).body.user
    await request(app).patch(`/api/admin/users/${made.id}`).set(...sa).send({ role: 'TEAM_LEAD' }).expect(200)
    const reset = (await request(app).post(`/api/admin/users/${made.id}/reset-password`).set(...sa).send({}).expect(200)).body.tempPassword
    await request(app).delete(`/api/admin/users/${made.id}`).set(...sa).expect(204)
    await request(app).post('/api/company/roles').set(...sa).send({ name: 'Floor manager', baseRole: 'TEAM_LEAD', areasOff: [], powers: [] }).expect(201)
    await request(app).post('/api/company/departments').set(...sa).send({ name: 'Back office', type: 'GENERAL' }).expect(201)
    await request(app).patch('/api/company').set(...sa).send({ name: '99 Technologies' }).expect(200)

    const entries = (await request(app).get('/api/admin/audit-log').set(...sa).expect(200)).body.entries as { action: string; entityType: string; summary: string | null }[]
    const lines = entries.map((e) => `${e.action} ${e.entityType}: ${e.summary}`)
    expect(lines).toEqual(expect.arrayContaining([
      'CREATE User: Added Nadia New (nadia.new@test.local) as MEMBER in ITAD',
      'UPDATE User: Nadia New: role TEAM_LEAD',
      'PASSWORD_RESET User: Reset the password of Nadia New',
      'DELETE User: Deleted Nadia New (nadia.new@test.local), TEAM_LEAD',
      'CREATE CompanyRole: Made the role Floor manager (from Team Lead)',
      'CREATE Department: Added the department Back office',
      'UPDATE Company: Company settings: name 99 Technologies',
    ]))
    // No password, given or generated, is ever written to the log.
    const raw = JSON.stringify(await prisma.auditLog.findMany())
    expect(raw).not.toContain('Secret-pass-77')
    expect(raw).not.toContain(reset)
  })

  it('a team lead sees only their own team, a member sees none', async () => {
    const lead = (await request(app).get('/api/admin/audit-log').set(...auth(w.itadLead)).expect(200)).body.entries as { summary: string | null }[]
    expect(lead.some((e) => e.summary?.startsWith('Company settings'))).toBe(false)
    await request(app).get('/api/admin/audit-log').set(...auth(w.itadMember)).expect(403)
  })
})
