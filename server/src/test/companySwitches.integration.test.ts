import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { hashPassword } from '../lib/auth'
import { ensureHomeCompany, HOME_COMPANY_ID } from '../lib/company'
import { isOn, resetFlagCache } from '../lib/flags'

// Company-wise switches: a part can be shown to some companies and not to others. A company
// with no setting of its own follows the all-companies setting.

const EMAIL = 'owner.companyswitches@test.local'
const PASSWORD = 'Owner2026x'
const PW = 'Pass-for-tests-9'
let w: SeededWorld

async function owner() {
  const a = request.agent(app)
  await a.post('/api/owner/login').send({ email: EMAIL, password: PASSWORD }).expect(200)
  return a
}
async function signIn(username: string) {
  const a = request.agent(app)
  await a.post('/api/auth/login').send({ email: username, password: PW }).expect(200)
  return a
}

beforeAll(async () => {
  w = await seedWorld()
  await prisma.featureFlag.deleteMany()
  await prisma.featureFlagCompany.deleteMany()
  await prisma.ownerAuditLog.deleteMany()
  await prisma.platformOwner.deleteMany()
  await prisma.platformOwner.create({ data: { name: 'Anees', email: EMAIL, passwordHash: await hashPassword(PASSWORD) } })
  await ensureHomeCompany()
  await prisma.company.update({ where: { id: HOME_COMPANY_ID }, data: { helpEnabled: true } })
  await prisma.company.deleteMany({ where: { id: { in: ['sw-a', 'sw-b'] } } })
  await prisma.company.create({ data: { id: 'sw-a', name: 'Alpha Test', slug: 'sw-a', helpEnabled: true } })
  await prisma.company.create({ data: { id: 'sw-b', name: 'Beta Test', slug: 'sw-b', helpEnabled: true } })
  const passwordHash = await hashPassword(PW)
  await prisma.user.deleteMany({ where: { email: { in: ['sw.a@local.test', 'sw.b@local.test'] } } })
  await prisma.user.create({ data: { name: 'Alpha Person', email: 'sw.a@local.test', username: 'swalpha', passwordHash, companyId: 'sw-a' } })
  await prisma.user.create({ data: { name: 'Beta Person', email: 'sw.b@local.test', username: 'swbeta', passwordHash, companyId: 'sw-b' } })
  resetFlagCache()
})
afterAll(async () => {
  await prisma.featureFlag.deleteMany()
  await prisma.featureFlagCompany.deleteMany()
  await prisma.user.deleteMany({ where: { email: { in: ['sw.a@local.test', 'sw.b@local.test'] } } })
  await prisma.company.deleteMany({ where: { id: { in: ['sw-a', 'sw-b'] } } })
  await prisma.company.update({ where: { id: HOME_COMPANY_ID }, data: { helpEnabled: false } })
  await prisma.$disconnect()
})

describe('company-wise switches', () => {
  it('a company with no setting of its own follows the all-companies setting', async () => {
    const a = await owner()
    const list = (await a.get('/api/owner/companies/sw-a/flags').expect(200)).body.flags
    expect(list.every((f: { own: unknown; enabled: boolean }) => f.own === null && f.enabled)).toBe(true)
    await a.get('/api/owner/companies/nope/flags').expect(404)
  })

  it('off for one company only: that company loses the part, the others keep it', async () => {
    const a = await owner()
    const r = await a.patch('/api/owner/companies/sw-a/flags/help-button').send({ enabled: false }).expect(200)
    expect(r.body.flags.find((f: { key: string }) => f.key === 'help-button')).toMatchObject({ enabled: false, own: false, allCompanies: true, updatedBy: 'Anees' })
    expect(r.body.all.find((f: { key: string }) => f.key === 'help-button').overrides).toEqual([expect.objectContaining({ companyId: 'sw-a', companyName: 'Alpha Test', enabled: false })])

    const alpha = await signIn('swalpha')
    expect((await alpha.get('/api/support/status').expect(200)).body.enabled).toBe(false)
    expect((await alpha.get('/api/flags').expect(200)).body.flags['help-button']).toBe(false)
    await alpha.post('/api/support').send({ subject: 'Test', body: 'Should be refused' }).expect(403)

    const beta = await signIn('swbeta')
    expect((await beta.get('/api/support/status').expect(200)).body.enabled).toBe(true)
    expect((await beta.get('/api/flags').expect(200)).body.flags['help-button']).toBe(true)
    // 99 Technologies is untouched.
    expect((await request(app).get('/api/flags').set(...auth(w.itadMember)).expect(200)).body.flags['help-button']).toBe(true)
    expect(await prisma.ownerAuditLog.count({ where: { action: 'SWITCH', companyId: 'sw-a', target: 'Help button for Alpha Test' } })).toBe(1)
  })

  it('off for all, on for one company: only that company has the part (try it with one company first)', async () => {
    const a = await owner()
    await a.patch('/api/owner/flags/break-cutoff').send({ enabled: false }).expect(200)
    await a.patch('/api/owner/companies/sw-b/flags/break-cutoff').send({ enabled: true }).expect(200)
    expect(await isOn('break-cutoff', 'sw-b')).toBe(true)
    expect(await isOn('break-cutoff', 'sw-a')).toBe(false)
    expect(await isOn('break-cutoff', HOME_COMPANY_ID)).toBe(false)
    expect(await isOn('break-cutoff')).toBe(false)
  })

  it('taking a company setting away puts it back on the all-companies setting', async () => {
    const a = await owner()
    await a.patch('/api/owner/companies/sw-a/flags/help-button').send({ enabled: null }).expect(200)
    expect(await isOn('help-button', 'sw-a')).toBe(true)
    expect(await prisma.featureFlagCompany.count({ where: { companyId: 'sw-a' } })).toBe(0)
    await a.patch('/api/owner/companies/sw-a/flags/help-button').send({ enabled: 'x' }).expect(400)
    await a.patch('/api/owner/companies/sw-a/flags/nope').send({ enabled: true }).expect(404)
  })

  it('only the owner can set them', async () => {
    await request(app).patch('/api/owner/companies/sw-a/flags/help-button').set(...auth(w.superAdmin)).send({ enabled: false }).expect(401)
    const alpha = await signIn('swalpha')
    await alpha.patch('/api/owner/companies/sw-a/flags/help-button').send({ enabled: false }).expect(401)
  })
})

describe('the company walls switch', () => {
  it('cannot be turned off while other companies use Metriq, and is not set per company', async () => {
    const a = await owner()
    const r = await a.patch('/api/owner/flags/company-walls').send({ enabled: false }).expect(409)
    expect(r.body.error).toMatch(/cannot be turned off/)
    await a.patch('/api/owner/companies/sw-a/flags/company-walls').send({ enabled: false }).expect(400)
    expect((await a.get('/api/owner/companies/sw-a/flags').expect(200)).body.flags.map((f: { key: string }) => f.key)).not.toContain('company-walls')
  })
})
