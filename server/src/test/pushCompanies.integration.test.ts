import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Role } from '@prisma/client'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { hashPassword } from '../lib/auth'
import { ensureHomeCompany, HOME_COMPANY_ID } from '../lib/company'

// One browser, two accounts in two companies (e.g. the owner tries a test company in the same
// Chrome): turning on pop-ups must hand this browser to the new person, not fail with a 500
// ("Unique constraint failed on the fields: (endpoint)").

const M = 'push-mike'
let w: SeededWorld
let mike: { id: string; role: Role }
const sub = { endpoint: 'https://push.example.com/send/shared-browser', keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } }

beforeAll(async () => {
  w = await seedWorld()
  await ensureHomeCompany()
  await prisma.company.deleteMany({ where: { id: M } })
  await prisma.company.create({ data: { id: M, name: 'Mike Test Co', slug: M, plan: 'business' } })
  const u = await prisma.user.create({ data: { companyId: M, name: 'Mike Admin', email: 'mike.admin@mike.local.test', role: 'SUPER_ADMIN', status: 'ACTIVE', isActive: true, passwordHash: await hashPassword('Pass-for-tests-9') } })
  mike = { id: u.id, role: u.role }
  await prisma.pushSubscription.deleteMany({ where: { endpoint: sub.endpoint } })
})
afterAll(async () => {
  await prisma.pushSubscription.deleteMany({ where: { endpoint: sub.endpoint } })
  await prisma.company.deleteMany({ where: { id: M } })
  await prisma.$disconnect()
})

describe('pop-ups on a browser shared by two companies', () => {
  it('the browser moves to the person who turned pop-ups on last, in any company', async () => {
    await request(app).post('/api/push/subscribe').set(...auth(w.itadMember)).send(sub).expect(200)
    // The same browser, now signed in to another company.
    await request(app).post('/api/push/subscribe').set(...auth(mike)).send(sub).expect(200)
    const rows = await prisma.pushSubscription.findMany({ where: { endpoint: sub.endpoint } })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ userId: mike.id, companyId: M })
    // And back again.
    await request(app).post('/api/push/subscribe').set(...auth(w.itadMember)).send(sub).expect(200)
    const back = await prisma.pushSubscription.findMany({ where: { endpoint: sub.endpoint } })
    expect(back).toHaveLength(1)
    expect(back[0]).toMatchObject({ userId: w.itadMember.id, companyId: HOME_COMPANY_ID })
    // Sending it again changes nothing.
    await request(app).post('/api/push/subscribe').set(...auth(w.itadMember)).send(sub).expect(200)
    expect(await prisma.pushSubscription.count({ where: { endpoint: sub.endpoint } })).toBe(1)
  })
})
