import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { DateTime } from 'luxon'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { hashPassword } from '../lib/auth'
import { ensureHomeCompany, HOME_COMPANY_ID } from '../lib/company'
import { resetFlagCache } from '../lib/flags'
import { runBreakCutoffTick } from '../lib/breakCutoff'

// Phase 1, step 1 (safety net): on/off switches the owner flips in the owner console. A part
// that is switched off behaves as if it did not exist, within seconds, with no deploy.

const EMAIL = 'owner.switches@test.local'
const PASSWORD = 'Owner2026x'
let w: SeededWorld
const pk = (iso: string) => DateTime.fromISO(iso, { zone: 'Asia/Karachi' }).toJSDate()

async function owner() {
  const a = request.agent(app)
  await a.post('/api/owner/login').send({ email: EMAIL, password: PASSWORD }).expect(200)
  return a
}

beforeAll(async () => {
  w = await seedWorld()
  await prisma.featureFlag.deleteMany()
  await prisma.ownerAuditLog.deleteMany()
  await prisma.platformOwner.deleteMany()
  await prisma.platformOwner.create({ data: { name: 'Anees', email: EMAIL, passwordHash: await hashPassword(PASSWORD) } })
  await ensureHomeCompany()
  await prisma.company.update({ where: { id: HOME_COMPANY_ID }, data: { helpEnabled: true } })
  resetFlagCache()
})
afterAll(async () => {
  await prisma.featureFlag.deleteMany()
  await prisma.company.update({ where: { id: HOME_COMPANY_ID }, data: { helpEnabled: false } })
  await prisma.$disconnect()
})

describe('switches', () => {
  it('everything is on by default, and the app can read its switches', async () => {
    const a = await owner()
    const list = (await a.get('/api/owner/flags').expect(200)).body.flags
    expect(list.map((f: { key: string }) => f.key)).toEqual(['silent-updates', 'help-button', 'break-cutoff', 'dialer-sync', 'company-walls'])
    expect(list.every((f: { enabled: boolean; isDefault: boolean }) => f.enabled && f.isDefault)).toBe(true)
    const app1 = (await request(app).get('/api/flags').set(...auth(w.itadMember)).expect(200)).body.flags
    expect(app1).toEqual({ 'silent-updates': true, 'help-button': true })
    await request(app).get('/api/flags').expect(401)
  })

  it('only the owner flips them, and each flip is logged', async () => {
    await request(app).patch('/api/owner/flags/help-button').set(...auth(w.superAdmin)).send({ enabled: false }).expect(401)
    const a = await owner()
    await a.patch('/api/owner/flags/nope').send({ enabled: false }).expect(404)
    await a.patch('/api/owner/flags/help-button').send({ enabled: 'no' }).expect(400)
    const r = await a.patch('/api/owner/flags/help-button').send({ enabled: false }).expect(200)
    expect(r.body.flags.find((f: { key: string }) => f.key === 'help-button')).toMatchObject({ enabled: false, isDefault: false, updatedBy: 'Anees' })
    expect(await prisma.ownerAuditLog.count({ where: { action: 'SWITCH', target: 'Help button' } })).toBe(1)
  })

  it('Help off hides the button for every company and refuses new complaints', async () => {
    expect((await request(app).get('/api/support/status').set(...auth(w.itadMember)).expect(200)).body.enabled).toBe(false)
    await request(app).post('/api/support').set(...auth(w.itadMember)).send({ subject: 'Test', body: 'Testing the switch' }).expect(403)
    const a = await owner()
    await a.patch('/api/owner/flags/help-button').send({ enabled: true }).expect(200)
    expect((await request(app).get('/api/support/status').set(...auth(w.itadMember)).expect(200)).body.enabled).toBe(true)
  })

  it('Break cut-off off: a forgotten break keeps running', async () => {
    const date = '2026-10-23'
    const d = await prisma.attendanceDay.create({ data: { userId: w.leadgenMember.id, date: new Date(`${date}T00:00:00Z`), checkInAt: pk(`${date}T11:00`) } })
    const b = await prisma.breakEntry.create({ data: { dayId: d.id, type: 'BREAK', startAt: pk(`${date}T12:00`) } })
    const a = await owner()
    await a.patch('/api/owner/flags/break-cutoff').send({ enabled: false }).expect(200)
    await runBreakCutoffTick(pk(`${date}T16:00`))
    expect((await prisma.breakEntry.findUniqueOrThrow({ where: { id: b.id } })).endAt).toBeNull()
    await a.patch('/api/owner/flags/break-cutoff').send({ enabled: true }).expect(200)
    await runBreakCutoffTick(pk(`${date}T16:00`))
    expect((await prisma.breakEntry.findUniqueOrThrow({ where: { id: b.id } })).autoEnded).toBe(true)
  })
})
