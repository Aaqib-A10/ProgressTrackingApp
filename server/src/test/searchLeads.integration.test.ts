import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'

// The app-wide search box (Ctrl K) finds Lead Dialer leads by company, contact, email or phone
// number, written any way. Reps find their own; the ITAD team lead finds the team's.

let w: SeededWorld
type U = SeededWorld['itadMember']
const find = (u: U, q: string) => request(app).get(`/api/search?q=${encodeURIComponent(q)}`).set(...auth(u)).expect(200).then((r) => r.body.leads as { title: string; sub: string; link: string }[])

beforeAll(async () => {
  w = await seedWorld()
  await prisma.dialerLead.deleteMany({ where: { company: { startsWith: 'Zephyr' } } })
  await prisma.dialerLead.create({ data: { ownerId: w.itadMember.id, matchKey: 'zephyr-1', company: 'Zephyr Recycling', contactName: 'Dana Smith', email: 'dana@zephyr-recycle.example', phone: '(555) 123-4567', status: 'Interested', stage: 2, maxStage: 2 } })
  await prisma.dialerLead.create({ data: { ownerId: w.itadLead.id, matchKey: 'zephyr-2', company: 'Zephyr Metals', contactName: 'Omar Khan', phone: '+1 555 987 6543', status: 'New', stage: 0, maxStage: 0 } })
})
afterAll(async () => {
  await prisma.dialerLead.deleteMany({ where: { company: { startsWith: 'Zephyr' } } })
  await prisma.$disconnect()
})

describe('finding leads', () => {
  it('a rep finds their own leads by company, contact, email and phone written any way', async () => {
    expect((await find(w.itadMember, 'zephyr')).map((l) => l.title)).toEqual(['Zephyr Recycling · Dana Smith'])
    expect((await find(w.itadMember, 'dana smith'))[0].title).toContain('Zephyr Recycling')
    expect((await find(w.itadMember, 'dana@zephyr'))).toHaveLength(1)
    for (const q of ['5551234567', '555-123-4567', '(555) 123 4567', '+1 555 123 4567', '1234567']) expect((await find(w.itadMember, q)).length, q).toBe(1)
    const hit = (await find(w.itadMember, 'zephyr'))[0]
    expect(hit.link).toMatch(/^\/app\/itad\/dialer\?lead=/)
    expect(hit.sub).toContain('Interested')
  })

  it("the team lead finds the team's leads, opening them as that rep", async () => {
    const r = await find(w.itadLead, 'zephyr')
    expect(r.map((l) => l.title).sort()).toEqual(['Zephyr Metals · Omar Khan', 'Zephyr Recycling · Dana Smith'])
    expect(r.find((l) => l.title.startsWith('Zephyr Recycling'))!.link).toContain(`rep=${w.itadMember.id}`)
    expect((await find(w.itadLead, '555 987 6543')).length).toBe(1)
  })

  it('people outside the calling team find no leads; the Super Admin finds them all', async () => {
    expect(await find(w.leadgenMember, 'zephyr')).toEqual([])
    expect((await find(w.superAdmin, 'zephyr')).length).toBe(2)
  })
})
