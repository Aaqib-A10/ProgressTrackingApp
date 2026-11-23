import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { hashPassword } from '../lib/auth'
import { ensureHomeCompany } from '../lib/company'
import { setFlag } from '../lib/flags'

// Stage 0 of the plan: sign-up by invite. While "New companies can sign up" is off, the owner makes an invite link
// and a person with it can start a company; nobody else can. A link counts its uses and can be withdrawn.

const EMAIL = 'owner.invites@test.local'
const PASSWORD = 'Owner2026x'
let w: SeededWorld
const person = (n: string) => ({ mode: 'team', name: `Founder ${n}`, email: `founder.${n}@invite.local.test`, password: 'Invite2026x', companyName: `Invite Co ${n}` })

async function owner() {
  const a = request.agent(app)
  await a.post('/api/owner/login').send({ email: EMAIL, password: PASSWORD }).expect(200)
  return a
}
async function wipe() {
  const made = await prisma.user.findMany({ where: { email: { endsWith: '@invite.local.test' } }, select: { companyId: true } })
  await prisma.company.deleteMany({ where: { id: { in: made.map((u) => u.companyId) } } })
  await prisma.signupInvite.deleteMany()
}

beforeAll(async () => {
  w = await seedWorld()
  await ensureHomeCompany()
  await prisma.platformOwner.deleteMany()
  await prisma.platformOwner.create({ data: { name: 'Anees', email: EMAIL, passwordHash: await hashPassword(PASSWORD) } })
  await wipe()
  await prisma.featureFlag.deleteMany({ where: { key: 'new-companies' } })
  await setFlag('new-companies', false, 'test')
})
afterAll(async () => {
  await wipe()
  await prisma.featureFlag.deleteMany({ where: { key: 'new-companies' } })
  await prisma.platformOwner.deleteMany()
  await prisma.$disconnect()
})

describe('sign-up by invite', () => {
  let code = ''

  it('only the owner makes invites; without one, sign-up stays closed', async () => {
    await request(app).get('/api/owner/invites').set(...auth(w.superAdmin)).expect(401)
    const a = await owner()
    await a.post('/api/owner/invites').send({ note: 'x' }).expect(400)
    const r = await a.post('/api/owner/invites').send({ note: 'Ali at Northwind', maxUses: 1, days: 30 }).expect(201)
    code = r.body.invite.code
    expect(r.body.invite).toMatchObject({ note: 'Ali at Northwind', maxUses: 1, uses: 0, state: 'open' })
    expect(r.body.invite.link).toContain(`/start?invite=${code}`)

    expect((await request(app).get('/api/auth/open').expect(200)).body).toMatchObject({ newCompanies: false, invited: false })
    expect((await request(app).get('/api/auth/open?invite=not-a-real-code').expect(200)).body.newCompanies).toBe(false)
    expect((await request(app).get(`/api/auth/open?invite=${code}`).expect(200)).body).toMatchObject({ newCompanies: true, invited: true })
    await request(app).post('/api/auth/start').send(person('a')).expect(403)
    await request(app).post('/api/auth/start').send({ ...person('a'), invite: 'not-a-real-code' }).expect(403)
  })

  it('the link starts one company, then it is used up', async () => {
    // A form that is not filled in right does not use the link.
    await request(app).post('/api/auth/start').send({ ...person('a'), password: 'short', invite: code }).expect(400)
    await request(app).post('/api/auth/start').send({ ...person('a'), invite: code }).expect(201)
    expect(await prisma.user.count({ where: { email: 'founder.a@invite.local.test', role: 'SUPER_ADMIN' } })).toBe(1)
    expect((await prisma.signupInvite.findUniqueOrThrow({ where: { code } })).uses).toBe(1)
    expect(await prisma.ownerAuditLog.count({ where: { action: 'INVITE_USED', target: 'Invite Co a' } })).toBe(1)

    expect((await request(app).post('/api/auth/start').send({ ...person('b'), invite: code }).expect(403)).body.error).toMatch(/not open/)
    expect((await request(app).get(`/api/auth/open?invite=${code}`).expect(200)).body.newCompanies).toBe(false)
    const a = await owner()
    expect((await a.get('/api/owner/invites').expect(200)).body.invites[0]).toMatchObject({ uses: 1, state: 'used' })
  })

  it('a link can be for several companies, can run out of time, and can be withdrawn', async () => {
    const a = await owner()
    const two = (await a.post('/api/owner/invites').send({ note: 'Launch partners', maxUses: 2, days: null }).expect(201)).body.invite
    await request(app).post('/api/auth/start').send({ ...person('c'), invite: two.code }).expect(201)
    await a.post(`/api/owner/invites/${two.id}/withdraw`).expect(200)
    await request(app).post('/api/auth/start').send({ ...person('d'), invite: two.code }).expect(403)
    expect((await a.get('/api/owner/invites').expect(200)).body.invites.find((i: { id: string }) => i.id === two.id).state).toBe('withdrawn')

    const old = (await a.post('/api/owner/invites').send({ note: 'Old link', days: 7 }).expect(201)).body.invite
    await prisma.signupInvite.update({ where: { id: old.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
    await request(app).post('/api/auth/start').send({ ...person('e'), invite: old.code }).expect(403)
  })

  it('with sign-up open to everyone, no invite is needed and none is used', async () => {
    await setFlag('new-companies', true, 'test')
    const a = await owner()
    const spare = (await a.post('/api/owner/invites').send({ note: 'Spare' }).expect(201)).body.invite
    expect((await a.get('/api/owner/invites').expect(200)).body.openToAll).toBe(true)
    await request(app).post('/api/auth/start').send({ ...person('f'), invite: spare.code }).expect(201)
    expect((await prisma.signupInvite.findUniqueOrThrow({ where: { id: spare.id } })).uses).toBe(0)
    await setFlag('new-companies', false, 'test')
  })
})
