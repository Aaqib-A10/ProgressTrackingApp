import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { withDefaults } from '../lib/dialer/rules'
import { shiftDayStart } from '../controllers/dialerController'

// Lead Dialer, ITAD changes (Oct 2026): lists, added-here fields, Earthzone tick, notes, follow-up
// backlog, per-rep settings, import change lists, bulk fill, calling hours, one lead count.

let w: SeededWorld
beforeAll(async () => { w = await seedWorld() })
afterAll(async () => { await prisma.$disconnect() })

type U = SeededWorld['itadMember']
const HEADERS = ['Lead ID', 'Company', 'Contact', 'Email', 'Phone', 'City', 'State', 'Lead Status', 'Industry', 'Website', 'Employees']
const MAPPING = { leadId: 'Lead ID', company: 'Company', contactName: 'Contact', email: 'Email', phone: 'Phone', city: 'City', state: 'State', status: 'Lead Status', industry: 'Industry', website: 'Website', companySize: 'Employees' }
const imp = (u: U, rows: (string | null)[][], listName?: string) =>
  request(app).post('/api/dialer/imports').set(...auth(u)).send({ fileName: 'x.csv', headers: HEADERS, mapping: MAPPING, rows, listName })
type Lead = { id: string; company: string; listName: string; phone2: string | null; needsCrmUpdate: boolean; crmUpdateWhat: string | null; followUpDropped: boolean; snoozeUntil: string | null; callLaterAt: string | null; backlogKeptAt: string | null; pinnedNote: string | null; noteCount: number; stateOverride: string | null; website: string | null; companySize: string | null }
const data = async (u: U) => (await request(app).get('/api/dialer/data').set(...auth(u)).expect(200)).body
const lead = async (u: U, company: string): Promise<Lead> => (await data(u)).leads.find((l: Lead) => l.company === company)

const CRM = [
  ['C1', 'Harbor Cold Storage', 'Ann', 'ann@harbor.com', '404-555-0101', 'Atlanta', 'GA', 'Connected', 'Logistics', 'harbor.com', '50-100'],
  ['C2', 'Apex Precision Parts', 'Bob', 'bob@apex.com', '216-555-0102', 'Cleveland', 'Ohio', 'Voicemail Sent', 'Manufacturing', '', ''],
  ['C3', 'No State Co', 'Di', 'di@nostate.com', '305-555-0104', '', '', 'Assigned', 'Healthcare', '', ''],
]

describe('lists and CRM fields', () => {
  it('a vendor list stays apart and never hides CRM leads; website and size come in', async () => {
    const a = await imp(w.itadMember, CRM).expect(201)
    expect(a.body.import.summary.listName).toBe('CRM')
    const v = await imp(w.itadMember, [['V1', 'Vendor Supply LLC', 'Vic', 'vic@vendor.com', '212-555-0199', 'New York', 'NY', 'Assigned', 'Recycling', '', '']], 'Vendors').expect(201)
    expect(v.body.import.summary).toMatchObject({ listName: 'Vendors', added: 1, notInFile: 0 })
    const d = await data(w.itadMember)
    expect(d.counts.byList).toEqual({ CRM: 3, Vendors: 1 })
    expect(d.counts.counted).toBe(4)
    const h = d.leads.find((l: Lead) => l.company === 'Harbor Cold Storage')
    expect(h).toMatchObject({ listName: 'CRM', website: 'harbor.com', companySize: '50-100' })
  })
})

describe('added here fields and the Earthzone tick', () => {
  it('a second phone is kept across imports and marks the lead for Earthzone until done', async () => {
    const h = await lead(w.itadMember, 'Harbor Cold Storage')
    await request(app).patch(`/api/dialer/leads/${h.id}`).set(...auth(w.itadMember)).send({ phone2: '404-555-0999', linkedin: 'linkedin.com/in/ann', tags: ['hot'] }).expect(200)
    let x = await lead(w.itadMember, 'Harbor Cold Storage')
    expect(x).toMatchObject({ phone2: '404-555-0999', needsCrmUpdate: true, crmUpdateWhat: 'second phone, LinkedIn' })
    await imp(w.itadMember, CRM).expect(201) // the CRM export never touches added-here fields
    x = await lead(w.itadMember, 'Harbor Cold Storage')
    expect(x).toMatchObject({ phone2: '404-555-0999', needsCrmUpdate: true })
    await request(app).patch(`/api/dialer/leads/${h.id}`).set(...auth(w.itadMember)).send({ crmDone: true }).expect(200)
    x = await lead(w.itadMember, 'Harbor Cold Storage')
    expect(x).toMatchObject({ needsCrmUpdate: false, crmUpdateWhat: null })
    // Tags alone, or needsCrm=false, do not mark it.
    await request(app).patch(`/api/dialer/leads/${h.id}`).set(...auth(w.itadMember)).send({ tags: ['hot', 'big'], bestTime: 'Mornings', needsCrm: false }).expect(200)
    expect((await lead(w.itadMember, 'Harbor Cold Storage')).needsCrmUpdate).toBe(false)
  })

  it('a state corrected here is kept across imports and marked for Earthzone', async () => {
    const n = await lead(w.itadMember, 'No State Co')
    await request(app).patch(`/api/dialer/leads/${n.id}`).set(...auth(w.itadMember)).send({ state: 'Florida' }).expect(200)
    await imp(w.itadMember, CRM).expect(201)
    expect(await lead(w.itadMember, 'No State Co')).toMatchObject({ stateOverride: 'Florida', needsCrmUpdate: true, crmUpdateWhat: 'state' })
  })
})

describe('notes', () => {
  it('author, time, one pinned note, edited marker, next-action date feeds follow-ups', async () => {
    const h = await lead(w.itadMember, 'Harbor Cold Storage')
    const thu = new Date(Date.now() + 3 * 86400000).toISOString()
    const a = await request(app).post(`/api/dialer/leads/${h.id}/notes`).set(...auth(w.itadMember)).send({ text: 'Call back Thursday, wants a quote', pinned: true, nextActionAt: thu }).expect(201)
    expect(a.body.note).toMatchObject({ pinned: true, editedAt: null, nextActionAt: thu })
    let x = await lead(w.itadMember, 'Harbor Cold Storage')
    expect(x.callLaterAt).toBe(thu)
    expect(x.pinnedNote).toBe('Call back Thursday, wants a quote')
    const b = await request(app).post(`/api/dialer/leads/${h.id}/notes`).set(...auth(w.itadMember)).send({ text: 'Second note', pinned: true }).expect(201)
    x = await lead(w.itadMember, 'Harbor Cold Storage')
    expect(x.pinnedNote).toBe('Second note') // only one pinned
    const e = await request(app).patch(`/api/dialer/notes/${a.body.note.id}`).set(...auth(w.itadMember)).send({ text: 'Call back Thursday, wants a quote for 40 laptops' }).expect(200)
    expect(e.body.note.editedAt).not.toBeNull()
    // The lead can read and pin, but not rewrite someone's note.
    await request(app).patch(`/api/dialer/notes/${b.body.note.id}`).set(...auth(w.itadLead)).send({ text: 'changed' }).expect(403)
    await request(app).patch(`/api/dialer/notes/${b.body.note.id}`).set(...auth(w.itadLead)).send({ pinned: false }).expect(200)
    // Another department cannot see it at all.
    await request(app).patch(`/api/dialer/notes/${b.body.note.id}`).set(...auth(w.superAdmin)).send({ pinned: true }).expect(200)
    const detail = await request(app).get(`/api/dialer/leads/${h.id}`).set(...auth(w.itadMember)).expect(200)
    expect(detail.body.notes[0]).toMatchObject({ text: 'Second note', pinned: true, author: expect.any(String) })
    // Export: my notes, and a lead's notes.
    const mine = await request(app).get('/api/dialer/notes').set(...auth(w.itadMember)).expect(200)
    expect(mine.body.notes.length).toBe(2)
    expect(mine.body.notes[0]).toMatchObject({ company: 'Harbor Cold Storage', rep: expect.any(String) })
    const one = await request(app).get(`/api/dialer/notes?leadId=${h.id}`).set(...auth(w.itadMember)).expect(200)
    expect(one.body.notes.length).toBe(2)
  })
})

describe('follow-up backlog and per-rep settings', () => {
  it('Keep, Snooze 30 days, Drop; a status change brings a dropped lead back', async () => {
    const ap = await lead(w.itadMember, 'Apex Precision Parts')
    const ns = await lead(w.itadMember, 'No State Co')
    const v = await lead(w.itadMember, 'Vendor Supply LLC')
    await request(app).post('/api/dialer/followups/bulk').set(...auth(w.itadMember)).send({ leadIds: [ap.id], action: 'DROP' }).expect(200)
    await request(app).post('/api/dialer/followups/bulk').set(...auth(w.itadMember)).send({ leadIds: [ns.id], action: 'SNOOZE30' }).expect(200)
    await request(app).post('/api/dialer/followups/bulk').set(...auth(w.itadMember)).send({ leadIds: [v.id], action: 'KEEP' }).expect(200)
    expect((await lead(w.itadMember, 'Apex Precision Parts')).followUpDropped).toBe(true)
    const snoozed = await lead(w.itadMember, 'No State Co')
    expect(new Date(snoozed.snoozeUntil!).getTime()).toBeGreaterThan(Date.now() + 29 * 86400000)
    expect((await lead(w.itadMember, 'Vendor Supply LLC')).backlogKeptAt).not.toBeNull()
    // Someone else's leads are refused.
    await request(app).post('/api/dialer/followups/bulk').set(...auth(w.leadgenMember)).send({ leadIds: [ap.id], action: 'DROP' }).expect(403)
    // Apex moves to Connected in the CRM: back in follow-ups.
    await imp(w.itadMember, CRM.map((r) => (r[0] === 'C2' ? [...r.slice(0, 7), 'Connected', ...r.slice(8)] : r))).expect(201)
    expect((await lead(w.itadMember, 'Apex Precision Parts')).followUpDropped).toBe(false)
    // Done today: counted from this shift day.
    const d = await data(w.itadMember)
    expect(new Set(d.actedToday.map((a: { leadId: string }) => a.leadId))).toEqual(new Set([ap.id, ns.id, v.id, (await lead(w.itadMember, 'Harbor Cold Storage')).id, (await lead(w.itadMember, 'No State Co')).id]))
  })

  it('my follow-up days (3 to 60) and saved views; back to the defaults', async () => {
    await request(app).put('/api/dialer/prefs').set(...auth(w.itadMember)).send({ followUp: { Connected: 2 } }).expect(400)
    await request(app).put('/api/dialer/prefs').set(...auth(w.itadMember)).send({ followUp: { Connected: 61 } }).expect(400)
    await request(app).put('/api/dialer/prefs').set(...auth(w.itadMember)).send({ followUp: { Connected: 10 }, views: [{ id: 'v1', name: 'Georgia hot', filters: { state: 'Georgia', tag: 'hot' } }] }).expect(200)
    let d = await data(w.itadMember)
    expect(d.followUpByOwner[w.itadMember.id]).toMatchObject({ Connected: 10, Interested: 14, Pipeline: 7 })
    expect(d.prefs.views[0]).toMatchObject({ name: 'Georgia hot' })
    // Changing the days keeps the views.
    await request(app).put('/api/dialer/prefs').set(...auth(w.itadMember)).send({ followUp: {} }).expect(200)
    d = await data(w.itadMember)
    expect(d.followUpByOwner[w.itadMember.id].Connected).toBe(30)
    expect(d.prefs.views).toHaveLength(1)
  })
})

describe('import history', () => {
  it('each top status change opens the leads behind it', async () => {
    const hist = await request(app).get('/api/dialer/imports').set(...auth(w.itadMember)).expect(200)
    const last = hist.body.imports[0]
    expect(last.summary.topChanges).toEqual([{ from: 'Voicemail Sent', to: 'Connected', count: 1 }])
    const r = await request(app).get(`/api/dialer/imports/${last.id}/changes?from=Voicemail%20Sent&to=Connected`).set(...auth(w.itadMember)).expect(200)
    expect(r.body.leads).toEqual([expect.objectContaining({ company: 'Apex Precision Parts', from: 'Voicemail Sent', to: 'Connected' })])
    await request(app).get(`/api/dialer/imports/${last.id}/changes`).set(...auth(w.leadgenMember)).expect(403)
  })
})

describe('bulk fill', () => {
  it('preview shows matched, not matched and conflicts; nothing is overwritten unless asked', async () => {
    const harbor = await lead(w.itadMember, 'Harbor Cold Storage')
    const key = (await prisma.dialerLead.findUniqueOrThrow({ where: { id: harbor.id } })).matchKey
    const rows = [
      { matchKey: key, phone2: '404-555-1111', email2: 'ann.alt@harbor.com', note: 'From my sheet' }, // phone2 conflicts (already 404-555-0999)
      { crmId: 'C2', company: 'Apex Precision Parts', phone2: '216-555-2222' },
      { crmId: 'NOPE', company: 'Somebody Else', phone2: '1' },
      { company: '', phone2: '2' },
    ]
    const pre = await request(app).post('/api/dialer/bulk-fill').set(...auth(w.itadMember)).send({ rows, apply: false }).expect(200)
    expect(pre.body).toMatchObject({ matched: 2, willUpdate: 2, notes: 1, unmatchedCount: 2, conflictCount: 1 })
    expect(pre.body.conflicts[0]).toMatchObject({ field: 'phone2', current: '404-555-0999', incoming: '404-555-1111' })
    expect((await lead(w.itadMember, 'Apex Precision Parts')).phone2).toBeNull() // preview saved nothing
    await request(app).post('/api/dialer/bulk-fill').set(...auth(w.itadMember)).send({ rows, apply: true }).expect(200)
    let h = await prisma.dialerLead.findUniqueOrThrow({ where: { id: harbor.id } })
    expect(h).toMatchObject({ phone2: '404-555-0999', email2: 'ann.alt@harbor.com' }) // conflict kept the old value
    expect((await lead(w.itadMember, 'Apex Precision Parts')).phone2).toBe('216-555-2222')
    await request(app).post('/api/dialer/bulk-fill').set(...auth(w.itadMember)).send({ rows, apply: true, overwrite: true }).expect(200)
    h = await prisma.dialerLead.findUniqueOrThrow({ where: { id: harbor.id } })
    expect(h.phone2).toBe('404-555-1111')
    expect(await prisma.dialerNote.count({ where: { leadId: harbor.id, text: 'From my sheet' } })).toBe(2)
    // Another rep's sheet cannot attach anything to my lead.
    const other = await request(app).post('/api/dialer/bulk-fill').set(...auth(w.itadLead)).send({ rows: [{ matchKey: key, phone2: '9' }], apply: false }).expect(200)
    expect(other.body).toMatchObject({ matched: 0, unmatchedCount: 1 })
  })
})

describe('calling hours and the working day', () => {
  it('old saved settings move to 9 to 5 local with prime time; the day starts at noon PKT', () => {
    const s = withDefaults({ clockMode: 'FIXED_PKT', slots: { ET: { pktStart: '19:00', pktEnd: '00:00', localStart: '10:00', localEnd: '15:00' } }, followUp: { Connected: 20 } })
    expect(s).toMatchObject({ version: 2, clockMode: 'FIXED_LOCAL', followUp: { Connected: 20 } })
    expect(s.slots.ET).toMatchObject({ localStart: '09:00', localEnd: '17:00' })
    expect(s.primeTimes).toEqual([{ start: '10:00', end: '11:00' }, { start: '14:00', end: '16:00' }])
    // Saved after the change: kept as saved.
    expect(withDefaults({ version: 2, clockMode: 'FIXED_PKT' }).clockMode).toBe('FIXED_PKT')
    expect(shiftDayStart(new Date('2026-10-21T21:30:00Z')).toISOString()).toBe('2026-10-21T07:00:00.000Z') // 02:30 PKT on the 22nd belongs to the 21st's shift
    expect(shiftDayStart(new Date('2026-10-21T08:00:00Z')).toISOString()).toBe('2026-10-21T07:00:00.000Z') // 13:00 PKT
  })
})
