import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'

// A rep changes a lead's status in Metriq. The stage follows, the change is in the status path,
// and the next import does not undo it while Earthzone still shows the old status.

let w: SeededWorld
const HEADERS = ['Lead ID', 'Company', 'Phone', 'State', 'Lead Status']
const MAPPING = { leadId: 'Lead ID', company: 'Company', phone: 'Phone', state: 'State', status: 'Lead Status' }
const imp = (rows: string[][]) => request(app).post('/api/dialer/imports').set(...auth(w.itadMember)).send({ fileName: 'leads.csv', headers: HEADERS, mapping: MAPPING, rows })
const lead = (company: string) => prisma.dialerLead.findFirstOrThrow({ where: { company, ownerId: w.itadMember.id } })
const setStatus = (id: string, status: string, note?: string, who = w.itadMember) => request(app).post(`/api/dialer/leads/${id}/status`).set(...auth(who)).send({ status, note })

beforeAll(async () => {
  w = await seedWorld()
  await imp([
    ['S1', 'Status Alpha', '404-555-0201', 'GA', 'Contact Attempted'],
    ['S2', 'Status Bravo', '404-555-0202', 'GA', 'Contact Attempted'],
  ]).expect(201)
})
afterAll(async () => { await prisma.$disconnect() })

describe('changing a lead status in Metriq', () => {
  it('sets the status and stage, logs who, marks Earthzone, clears snoozes', async () => {
    const a = await lead('Status Alpha')
    await prisma.dialerLead.update({ where: { id: a.id }, data: { snoozeUntil: new Date(Date.now() + 86400_000) } })
    await setStatus(a.id, 'Not a status').expect(400)
    await setStatus(a.id, 'Interested', 'Wants a quote for 40 laptops').expect(200)
    const after = await lead('Status Alpha')
    expect(after).toMatchObject({ status: 'Interested', stage: 4, maxStage: 4, statusHere: 'Interested', statusHereFrom: 'Contact Attempted', needsCrmUpdate: true, snoozeUntil: null })
    expect(after.crmUpdateWhat).toContain('status Interested')
    const d = (await request(app).get(`/api/dialer/leads/${a.id}`).set(...auth(w.itadMember)).expect(200)).body
    expect(d.changes.at(-1)).toMatchObject({ fromStatus: 'Contact Attempted', toStatus: 'Interested', importId: null, byName: 'itad member' })
    expect(d.notes[0].text).toContain('Wants a quote')
  })

  it('only the owner (or an ITAD manager) can change it', async () => {
    const b = await lead('Status Bravo')
    // Another department is stopped at the door; another ITAD rep would not even find it.
    expect([403, 404]).toContain((await setStatus(b.id, 'Connected', undefined, w.leadgenMember)).status)
    await setStatus(b.id, 'Connected', undefined, w.itadLead).expect(200)
  })

  it('an import that still brings the old status keeps the one set here', async () => {
    const r = await imp([
      ['S1', 'Status Alpha', '404-555-0201', 'GA', 'Contact Attempted'],
      ['S2', 'Status Bravo', '404-555-0202', 'GA', 'Contact Attempted'],
    ]).expect(201)
    expect(r.body.import.summary.keptChangedHere).toBe(2)
    expect(await lead('Status Alpha')).toMatchObject({ status: 'Interested', stage: 4, statusHere: 'Interested' })
  })

  it('once Earthzone shows it (or moves on), the CRM leads again', async () => {
    await imp([
      ['S1', 'Status Alpha', '404-555-0201', 'GA', 'Interested'],
      ['S2', 'Status Bravo', '404-555-0202', 'GA', 'Not Interested'],
    ]).expect(201)
    expect(await lead('Status Alpha')).toMatchObject({ status: 'Interested', statusHere: null, statusHereFrom: null })
    expect(await lead('Status Bravo')).toMatchObject({ status: 'Not Interested', stage: 3, statusHere: null })
  })

  it('changing it back to what Earthzone has clears the marker', async () => {
    const a = await lead('Status Alpha')
    await setStatus(a.id, 'Pipeline').expect(200)
    expect(await lead('Status Alpha')).toMatchObject({ statusHere: 'Pipeline', statusHereFrom: 'Interested' })
    await setStatus(a.id, 'Interested').expect(200)
    const back = await lead('Status Alpha')
    expect(back).toMatchObject({ status: 'Interested', statusHere: null, statusHereFrom: null })
    expect(back.crmUpdateWhat ?? '').not.toContain('status')
  })
})
