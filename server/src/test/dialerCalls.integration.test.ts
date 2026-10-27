import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { isDialable, type DialerLead } from '../lib/dialer/view'
import { DEFAULT_SETTINGS } from '../lib/dialer/rules'

// ITAD, Oct 2026: the predictive dialer's call results update the right lead in Metriq with no
// typing: disposition, notes, agent, time, length; Callback → a call back; DNC → never dialed again.

let w: SeededWorld
let hook = ''
const headers = ['Lead ID', 'Company', 'First Name', 'Last Name', 'Phone', 'State', 'Lead Status']
const mapping = { leadId: 'Lead ID', company: 'Company', phone: 'Phone', state: 'State', status: 'Lead Status' }
const lead = (company: string) => prisma.dialerLead.findFirstOrThrow({ where: { company }, include: { calls: true, notes: true, actions: true } })
const send = (body: object) => request(app).post(hook).send(body)

beforeAll(async () => {
  w = await seedWorld()
  await request(app).post('/api/dialer/imports').set(...auth(w.itadMember)).send({
    fileName: 'crm.csv', headers, mapping,
    rows: [
      ['C1', 'Harbor Cold Storage', 'Ann', 'Lee', '(404) 555-0101', 'GA', 'Assigned'],
      ['C2', 'Apex Precision', 'Bob', 'Ray', '216-555-0102', 'Ohio', 'Interested'],
      ['C3', 'Mesa Data', 'Cy', 'Dale', '602-555-0103', 'Arizona', 'Assigned'],
      ['C4', 'Gulf Recycling', 'Di', 'Ko', '713-555-0104', 'Texas', 'Assigned'],
      ['C5', 'Shared Line One', 'Ed', 'Po', '305-555-0199', 'FL', 'Assigned'],
    ],
  }).expect(201)
  // Another rep has a lead on the same number as "Shared Line One".
  await request(app).post('/api/dialer/imports').set(...auth(w.itadLead)).send({ fileName: 'x.csv', headers, mapping, rows: [['D1', 'Shared Line Two', 'Fi', 'Lu', '305-555-0199', 'FL', 'Assigned']] }).expect(201)
})
afterAll(async () => { await prisma.$disconnect() })

describe('setting up the dialer link', () => {
  it('only ITAD team leads and Super Admins can; the link is shown once', async () => {
    await request(app).get('/api/dialer/integration').set(...auth(w.itadMember)).expect(403)
    await request(app).post('/api/dialer/integration').set(...auth(w.itadMember)).send({ name: 'x' }).expect(403)
    const r = await request(app).post('/api/dialer/integration').set(...auth(w.itadLead)).send({ name: 'Office dialer' }).expect(201)
    hook = new URL(r.body.hookUrl).pathname
    expect(hook).toMatch(/^\/api\/dialer-hook\/mdl_/)
    const g = await request(app).get('/api/dialer/integration').set(...auth(w.itadLead)).expect(200)
    expect(JSON.stringify(g.body)).not.toContain(hook.split('/').pop())
    expect(g.body.integration.name).toBe('Office dialer')
    // Agent 1003 in the dialer is the ITAD member; NOINT is this dialer's own "not interested" code.
    await request(app).put('/api/dialer/integration').set(...auth(w.itadLead)).send({ agentMap: { 1003: w.itadMember.id }, dispositionMap: { NOINT: 'NOT_INTERESTED' } }).expect(200)
  })
})

describe('call results land on the right lead', () => {
  it('No answer by phone: the call is logged, the status moves forward, the same call twice is logged once', async () => {
    const r = await send({ phone_number: '+1 404 555 0101', dispo: 'NA', user: '1003', talk_time: '0', uniqueid: 'u-1' }).expect(200)
    expect(r.body).toMatchObject({ ok: true, matched: true, outcome: 'NO_ANSWER' })
    await send({ phone_number: '+1 404 555 0101', dispo: 'NA', user: '1003', talk_time: '0', uniqueid: 'u-1' }).expect(200).then((x) => expect(x.body.duplicate).toBe(true))
    const l = await lead('Harbor Cold Storage')
    expect(l.status).toBe('Contact Attempted')
    expect(l.calls).toHaveLength(1)
    expect(l.calls[0]).toMatchObject({ disposition: 'NA', outcome: 'NO_ANSWER', agentId: w.itadMember.id, matchedBy: 'phone', durationSec: 0 })
    expect(l.actions.map((a) => a.kind)).toContain('DIALER_CALL')
    expect(l.needsCrmUpdate).toBe(true)
    expect(l.crmUpdateWhat).toContain('Assigned → Contact Attempted')
  })

  it('Voicemail with notes: the notes go in the notes history with agent, time and length', async () => {
    await send({ phone: '4045550101', disposition: 'Voicemail', agent: '1003', duration: '1:35', notes: 'Left a message about pickup', call_id: 'u-2' }).expect(200)
    const l = await lead('Harbor Cold Storage')
    expect(l.status).toBe('Voicemail Sent')
    const n = l.notes.find((x) => x.text.includes('Left a message'))!
    expect(n.userId).toBe(w.itadMember.id)
    expect(n.text).toContain('Voicemail')
    expect(n.text).toContain('1m 35s')
  })

  it('a status only moves forward: No answer on an Interested lead keeps Interested', async () => {
    await send({ phone: '216-555-0102', dispo: 'N', call_id: 'u-3' }).expect(200)
    expect((await lead('Apex Precision')).status).toBe('Interested')
  })

  it('Callback sets a call back at the time the dialer sends (or tomorrow)', async () => {
    const at = new Date(Date.now() + 3 * 86400000)
    at.setUTCSeconds(0, 0)
    await send({ phone: '602-555-0103', dispo: 'CALLBK', callback_datetime: at.toISOString(), comments: 'Call Tuesday after lunch', call_id: 'u-4' }).expect(200)
    const l = await lead('Mesa Data')
    expect(l.status).toBe('Connected')
    expect(l.callLaterAt?.toISOString()).toBe(at.toISOString())
    expect(l.notes[0].nextActionAt?.toISOString()).toBe(at.toISOString())
    await send({ phone: '713-555-0104', dispo: 'callback', call_id: 'u-5' }).expect(200)
    const g = await lead('Gulf Recycling')
    expect(g.callLaterAt!.getTime() - Date.now()).toBeGreaterThan(23 * 3600_000)
  })

  it('DNC: status DNC and never dialed again; Wrong number: out of dialing until the CRM sends a new phone', async () => {
    await send({ phone: '713-555-0104', dispo: 'DNC', call_id: 'u-6' }).expect(200)
    const g = await lead('Gulf Recycling')
    expect(g).toMatchObject({ status: 'DNC', doNotCall: true, callLaterAt: null })
    const asView = { ...g, region: 'CT', createdAt: g.createdAt.toISOString() } as unknown as DialerLead
    expect(isDialable(asView, DEFAULT_SETTINGS as never, new Date())).toBe(false)
    // Wrong number on Harbor.
    await send({ phone: '404-555-0101', dispo: 'DC', call_id: 'u-7' }).expect(200)
    expect((await lead('Harbor Cold Storage')).wrongNumber).toBe(true)
    const data = await request(app).get('/api/dialer/data').set(...auth(w.itadMember)).expect(200)
    expect(data.body.leads.find((l: { company: string }) => l.company === 'Harbor Cold Storage').wrongNumber).toBe(true)
    // The next import keeps DNC; a new phone from the CRM clears "wrong number".
    await request(app).post('/api/dialer/imports').set(...auth(w.itadMember)).send({
      fileName: 'crm2.csv', headers, mapping,
      rows: [['C1', 'Harbor Cold Storage', 'Ann', 'Lee', '404-555-0111', 'GA', 'Voicemail Sent'], ['C4', 'Gulf Recycling', 'Di', 'Ko', '713-555-0104', 'Texas', 'Assigned']],
    }).expect(201)
    expect((await lead('Harbor Cold Storage')).wrongNumber).toBe(false)
    expect((await lead('Gulf Recycling')).doNotCall).toBe(true)
  })

  it('the Metriq lead ID wins over a shared phone number; the dialer\'s own codes work', async () => {
    const two = await prisma.dialerLead.findFirstOrThrow({ where: { company: 'Shared Line Two' } })
    // Agent 1003 is the member, but the lead ID says it was the team lead's lead.
    await send({ phone_number: '305-555-0199', vendor_lead_code: two.id, dispo: 'NOINT', user: '1003', uniqueid: 'u-8' }).expect(200)
    expect((await lead('Shared Line Two')).status).toBe('Not Interested')
    expect((await lead('Shared Line One')).status).toBe('Assigned')
    // Without the ID, the shared number goes to the agent's own lead.
    await send({ phone_number: '305-555-0199', dispo: 'VM', user: '1003', uniqueid: 'u-9' }).expect(200)
    expect((await lead('Shared Line One')).status).toBe('Voicemail Sent')
  })

  it('works as a link with ?fields (GET) and as a web form', async () => {
    await request(app).get(`${hook}?phone_number=6025550103&dispo=XFER&user=1003&talk_time=200&uniqueid=u-10&comments=--A--comments--B--`).expect(200)
    const m = await lead('Mesa Data')
    expect(m.calls.find((c) => c.externalCallId === 'u-10')).toMatchObject({ outcome: 'CONNECTED', durationSec: 200, notes: null })
    await request(app).post(hook).type('form').send({ phone_number: '6025550103', dispo: 'SALE', uniqueid: 'u-11' }).expect(200)
    expect((await lead('Mesa Data')).status).toBe('Interested')
  })

  it('an unknown number waits for a manager, who matches it to the lead', async () => {
    const r = await send({ phone: '999-555-0000', dispo: 'CALLBK', notes: 'Wants a call back', call_id: 'u-12' }).expect(202)
    expect(r.body.matched).toBe(false)
    const g = await request(app).get('/api/dialer/integration').set(...auth(w.itadLead)).expect(200)
    const call = g.body.unmatched.find((c: { phone: string }) => c.phone === '999-555-0000')
    expect(call).toBeTruthy()
    const apex = await prisma.dialerLead.findFirstOrThrow({ where: { company: 'Apex Precision' } })
    await request(app).post(`/api/dialer/calls/${call.id}/link`).set(...auth(w.itadMember)).send({ leadId: apex.id }).expect(403)
    await request(app).post(`/api/dialer/calls/${call.id}/link`).set(...auth(w.itadLead)).send({ leadId: apex.id }).expect(200)
    const a = await lead('Apex Precision')
    expect(a.callLaterAt).not.toBeNull()
    expect(a.notes.some((n) => n.text.includes('Wants a call back'))).toBe(true)
    await request(app).post(`/api/dialer/calls/${call.id}/link`).set(...auth(w.itadLead)).send({ leadId: apex.id }).expect(409)
  })

  it('the lead panel shows the calls; the dry run explains a message without saving it', async () => {
    const m = await prisma.dialerLead.findFirstOrThrow({ where: { company: 'Mesa Data' } })
    const d = await request(app).get(`/api/dialer/leads/${m.id}`).set(...auth(w.itadMember)).expect(200)
    expect(d.body.calls.length).toBeGreaterThanOrEqual(3)
    expect(d.body.calls[0]).toHaveProperty('outcomeLabel')
    const before = await prisma.dialerCall.count()
    const t = await request(app).post('/api/dialer/integration/test').set(...auth(w.itadLead)).send({ message: 'https://x/api/dialer-hook/k?phone_number=6025550103&dispo=WEIRD&user=777' }).expect(200)
    expect(t.body.lead.company).toBe('Mesa Data')
    expect(t.body.problems.join(' ')).toContain('"WEIRD" is not mapped')
    expect(t.body.problems.join(' ')).toContain('"777" is not linked')
    expect(await prisma.dialerCall.count()).toBe(before)
  })

  it('a wrong link is refused; a switched-off link is refused; messages without a disposition are refused', async () => {
    await request(app).post('/api/dialer-hook/mdl_madeupmadeupmadeupmadeup').send({ phone: '1', dispo: 'NA' }).expect(404)
    await send({ phone: '404-555-0111' }).expect(400)
    await request(app).put('/api/dialer/integration').set(...auth(w.itadLead)).send({ enabled: false }).expect(200)
    await send({ phone: '404-555-0111', dispo: 'NA', call_id: 'u-off' }).expect(403)
    await request(app).put('/api/dialer/integration').set(...auth(w.itadLead)).send({ enabled: true }).expect(200)
    // A new link stops the old one.
    const r = await request(app).post('/api/dialer/integration').set(...auth(w.itadLead)).send({ name: 'Office dialer' }).expect(201)
    await send({ phone: '404-555-0111', dispo: 'NA', call_id: 'u-old' }).expect(404)
    hook = new URL(r.body.hookUrl).pathname
    await send({ phone: '404-555-0111', dispo: 'NA', call_id: 'u-new' }).expect(200)
  })
})
