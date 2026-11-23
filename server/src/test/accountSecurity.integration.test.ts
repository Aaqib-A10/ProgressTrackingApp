import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { hashPassword } from '../lib/auth'
import { mailLog } from '../lib/mail'
import { totpCode } from '../lib/totp'
import { ensureHomeCompany, HOME_COMPANY_ID } from '../lib/company'

// Stage 0 of the plan: "Forgot password" really sends its email (and the link works once), and two-step sign-in
// for company users (set up, sign in with a code, recovery codes, an admin reset, a company that requires it).

const PASSWORD = 'Correct-Horse-9'
let w: SeededWorld
const email = (id: string) => prisma.user.findUniqueOrThrow({ where: { id }, select: { email: true } }).then((u) => u.email)

beforeAll(async () => {
  w = await seedWorld()
  await ensureHomeCompany()
  for (const id of [w.itadMember.id, w.itadLead.id, w.superAdmin.id]) await prisma.user.update({ where: { id }, data: { passwordHash: await hashPassword(PASSWORD) } })
})
afterAll(async () => {
  await prisma.company.update({ where: { id: HOME_COMPANY_ID }, data: { requireTwoStep: false } })
  await prisma.$disconnect()
})

describe('forgot password', () => {
  it('sends a reset email whose link sets a new password once', async () => {
    const to = await email(w.itadMember.id)
    mailLog.length = 0
    const r = await request(app).post('/api/auth/forgot-password').send({ email: to }).expect(200)
    await new Promise((done) => setTimeout(done, 50)) // the email is sent without waiting
    const mail = mailLog.find((m) => m.to === to)
    expect(mail?.subject).toBe('Reset your Metriq password')
    const token = decodeURIComponent(/reset-password\?token=([^\s"<]+)/.exec(mail!.text)![1])
    expect(token).toBe(r.body.devResetToken)

    await request(app).post('/api/auth/reset-password').send({ token, password: 'A-brand-new-pass-1' }).expect(200)
    await request(app).post('/api/auth/login').send({ email: to, password: 'A-brand-new-pass-1' }).expect(200)
    // The same link again: refused (it was made for the old password).
    await request(app).post('/api/auth/reset-password').send({ token, password: 'Another-pass-22' }).expect(400)
    await prisma.user.update({ where: { id: w.itadMember.id }, data: { passwordHash: await hashPassword(PASSWORD) } })
  })

  it('says the same thing for an unknown address and sends nothing', async () => {
    mailLog.length = 0
    const r = await request(app).post('/api/auth/forgot-password').send({ email: 'nobody@nowhere.test' }).expect(200)
    await new Promise((done) => setTimeout(done, 50))
    expect(r.body).toEqual({ ok: true })
    expect(mailLog).toHaveLength(0)
  })
})

describe('two-step sign-in', () => {
  let secret = ''
  let recovery: string[] = []

  it('a person turns it on with a code from their app and gets recovery codes once', async () => {
    const me = auth(w.itadMember)
    expect((await request(app).get('/api/auth/me/two-step').set(...me).expect(200)).body).toMatchObject({ on: false, required: false })
    const start = await request(app).post('/api/auth/me/two-step/start').set(...me).expect(200)
    secret = start.body.secret
    expect(start.body.url).toContain('otpauth://totp/')
    // Not on until a code proves the app works; a wrong code is refused.
    await request(app).post('/api/auth/me/two-step/confirm').set(...me).send({ code: '000000' }).expect(400)
    expect((await request(app).post('/api/auth/login').send({ email: await email(w.itadMember.id), password: PASSWORD }).expect(200)).body.user).toBeTruthy()
    const ok = await request(app).post('/api/auth/me/two-step/confirm').set(...me).send({ code: totpCode(secret) }).expect(200)
    recovery = ok.body.recoveryCodes
    expect(recovery).toHaveLength(8)
    expect((await request(app).get('/api/auth/me').set(...me).expect(200)).body.user.twoStep).toEqual({ on: true, required: false })
    // The codes are kept hashed, never as they were shown.
    const row = await prisma.user.findUniqueOrThrow({ where: { id: w.itadMember.id }, select: { twoStepRecovery: true } })
    expect(row.twoStepRecovery).toHaveLength(8)
    expect(row.twoStepRecovery.some((h) => recovery.includes(h))).toBe(false)
    expect(await prisma.auditLog.count({ where: { action: 'TWO_STEP_ON', entityId: w.itadMember.id } })).toBe(1)
  })

  it('signing in then needs the password and a code; a recovery code works once', async () => {
    const who = await email(w.itadMember.id)
    const first = await request(app).post('/api/auth/login').send({ email: who, password: PASSWORD }).expect(200)
    expect(first.body).toMatchObject({ twoStep: true })
    expect(first.body.user).toBeUndefined()
    expect(first.headers['set-cookie']).toBeUndefined()
    await request(app).post('/api/auth/login/two-step').send({ ticket: first.body.ticket, code: '123456' }).expect(401)
    const done = await request(app).post('/api/auth/login/two-step').send({ ticket: first.body.ticket, code: totpCode(secret) }).expect(200)
    expect(done.body.user.id).toBe(w.itadMember.id)
    expect(String(done.headers['set-cookie'])).toContain('token=')
    // A ticket is not a session, and a session token is not a ticket.
    await request(app).get('/api/auth/me').set('Authorization', `Bearer ${first.body.ticket}`).expect(401)

    const again = await request(app).post('/api/auth/login').send({ email: who, password: PASSWORD }).expect(200)
    const viaRecovery = await request(app).post('/api/auth/login/two-step').send({ ticket: again.body.ticket, code: recovery[0].toUpperCase() }).expect(200)
    expect(viaRecovery.body.recoveryLeft).toBe(7)
    const third = await request(app).post('/api/auth/login').send({ email: who, password: PASSWORD }).expect(200)
    await request(app).post('/api/auth/login/two-step').send({ ticket: third.body.ticket, code: recovery[0] }).expect(401)
  })

  it('a company can require it: until set up, a person only reaches their own account', async () => {
    // The admin must have their own on first.
    expect((await request(app).patch('/api/company').set(...auth(w.superAdmin)).send({ requireTwoStep: true }).expect(409)).body.error).toMatch(/your own two-step/)
    const s = (await request(app).post('/api/auth/me/two-step/start').set(...auth(w.superAdmin)).expect(200)).body.secret
    await request(app).post('/api/auth/me/two-step/confirm').set(...auth(w.superAdmin)).send({ code: totpCode(s) }).expect(200)
    await request(app).patch('/api/company').set(...auth(w.superAdmin)).send({ requireTwoStep: true }).expect(200)

    // The lead has none yet: their own account answers, the rest of the app does not.
    const lead = auth(w.itadLead)
    expect((await request(app).get('/api/auth/me').set(...lead).expect(200)).body.user.twoStep).toEqual({ on: false, required: true })
    expect((await request(app).get('/api/tasks/mine').set(...lead).expect(403)).body.code).toBe('TWO_STEP_REQUIRED')
    const ls = (await request(app).post('/api/auth/me/two-step/start').set(...lead).expect(200)).body.secret
    await request(app).post('/api/auth/me/two-step/confirm').set(...lead).send({ code: totpCode(ls) }).expect(200)
    await request(app).get('/api/tasks/mine').set(...lead).expect(200)
    // People who already have it are not interrupted.
    await request(app).get('/api/tasks/mine').set(...auth(w.itadMember)).expect(200)
    await request(app).patch('/api/company').set(...auth(w.superAdmin)).send({ requireTwoStep: false }).expect(200)
  })

  it('turning it off needs a code; a Super Admin can turn it off for someone who lost their phone', async () => {
    const me = auth(w.itadMember)
    await request(app).post('/api/auth/me/two-step/off').set(...me).send({ code: '000000' }).expect(400)
    // Nobody but a Super Admin resets someone else's.
    await request(app).post(`/api/admin/users/${w.itadMember.id}/two-step-off`).set(...auth(w.itadLead)).expect(403)
    await request(app).post(`/api/admin/users/${w.itadMember.id}/two-step-off`).set(...auth(w.superAdmin)).expect(200)
    expect(await prisma.auditLog.count({ where: { action: 'TWO_STEP_OFF_BY_ADMIN', entityId: w.itadMember.id } })).toBe(1)
    // Password alone signs in again, and the old secret is gone.
    expect((await request(app).post('/api/auth/login').send({ email: await email(w.itadMember.id), password: PASSWORD }).expect(200)).body.user.twoStep.on).toBe(false)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: w.itadMember.id }, select: { totpSecret: true } })).totpSecret).toBeNull()
    // Their own: with a code.
    const lead = auth(w.itadLead)
    const row = await prisma.user.findUniqueOrThrow({ where: { id: w.itadLead.id }, select: { totpSecret: true } })
    await request(app).post('/api/auth/me/two-step/off').set(...lead).send({ code: totpCode(row.totpSecret!) }).expect(200)
    expect((await request(app).get('/api/auth/me/two-step').set(...lead).expect(200)).body.on).toBe(false)
  })
})
