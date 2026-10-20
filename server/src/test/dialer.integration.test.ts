import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { normalizeStatus, funnel, DEFAULT_SETTINGS, stageOf } from '../lib/dialer/rules'
import { findState, stateFromPhone } from '../lib/dialer/states'
import { parseDate, matchKeyOf } from '../controllers/dialerController'

// Lead Dialer: import, matching, cleaning, funnel, follow-up actions, privacy, duplicates.

let w: SeededWorld
beforeAll(async () => { w = await seedWorld() })
afterAll(async () => { await prisma.$disconnect() })

type U = SeededWorld['itadMember']
const HEADERS = ['Lead ID', 'Company', 'Contact', 'Email', 'Phone', 'City', 'State', 'Lead Status', 'Industry', 'Source', 'Created', 'Last Modified']
const MAPPING = { leadId: 'Lead ID', company: 'Company', contactName: 'Contact', email: 'Email', phone: 'Phone', city: 'City', state: 'State', status: 'Lead Status', industry: 'Industry', source: 'Source', leadDate: 'Created', lastActivity: 'Last Modified' }
const imp = (u: U, rows: (string | null)[][], fileName = 'leads.csv') =>
  request(app).post('/api/dialer/imports').set(...auth(u)).send({ fileName, headers: HEADERS, mapping: MAPPING, rows })
const data = (u: U, rep = 'me') => request(app).get(`/api/dialer/data?rep=${rep}`).set(...auth(u))

describe('cleaning rules', () => {
  it('states, statuses, dates, keys, area codes', () => {
    expect(findState(' ca ')?.name).toBe('California')
    expect(findState('CALIFORNIA')?.region).toBe('PT')
    expect(findState('Arizona')?.region).toBe('AZ')
    expect(findState('Texas')).toMatchObject({ region: 'CT', split: true })
    expect(findState('')).toBeNull()
    expect(findState('Narnia')).toBeNull()
    expect(normalizeStatus('  voicemail   sent ')).toBe('Voicemail Sent')
    expect(normalizeStatus('')).toBe('Unknown')
    expect(normalizeStatus('Some New Thing')).toBe('Some New Thing')
    expect(stageOf('Working On', DEFAULT_SETTINGS)).toBe(3)
    expect(stageOf('Report to Lead Gen', DEFAULT_SETTINGS)).toBe(2)
    expect(stageOf('Some New Thing', DEFAULT_SETTINGS)).toBe(1)
    expect(parseDate('10/15/2026')?.toISOString().slice(0, 10)).toBe('2026-10-15')
    expect(parseDate('10/15/2026 3:22 PM')?.toISOString()).toBe('2026-10-15T15:22:00.000Z')
    expect(parseDate(46310)?.toISOString().slice(0, 10)).toBe('2026-10-15')
    expect(matchKeyOf({ leadId: 'L-9', email: 'a@b.com', company: 'X', contactName: null, phone: null })).toBe('id:l-9')
    expect(matchKeyOf({ leadId: null, email: 'A@B.com', company: 'X', contactName: null, phone: null })).toBe('email:a@b.com')
    expect(stateFromPhone('+1 (305) 555-0100')).toBe('Florida')
  })

  it('funnel numbers match the plan (6 positive of 145 connected and 481 total)', () => {
    const stages = [...Array(6).fill(4), ...Array(139).fill(3), ...Array(165).fill(2), ...Array(171).fill(1)]
    const f = funnel(stages)
    expect(f).toMatchObject({ total: 481, connected: 145, positive: 6 })
    expect(Math.round(f.winRate! * 1000) / 10).toBe(4.1)
    expect(Math.round(f.positiveRate! * 1000) / 10).toBe(1.2)
  })
})

describe('import and dashboard', () => {
  it('imports, cleans, and shows only my leads', async () => {
    const r = await imp(w.itadMember, [
      ['L1', 'Harbor Cold Storage', 'Ann', 'ann@harbor.com', '404-555-0101', 'Atlanta', 'GA', 'Connected', 'Logistics', 'Web', '09/01/2026', '09/12/2026'],
      ['L2', 'Apex Precision Parts', 'Bob', 'bob@apex.com', '216-555-0102', 'Cleveland', 'Ohio', 'Interested', 'Manufacturing', 'Web', '09/01/2026', '09/30/2026'],
      ['L3', 'Mesa Data Hosting', 'Cy', 'cy@mesa.com', '602-555-0103', 'Phoenix', 'arizona ', 'voicemail sent', 'Data Centers', 'List', '09/02/2026', '10/02/2026'],
      ['L4', 'No State Co', 'Di', 'di@nostate.com', '305-555-0104', '', '', '', 'Healthcare', 'List', '09/03/2026', '10/03/2026'],
      ['L5', 'Dallas DC', 'Ed', 'ed@dal.com', '214-555-0105', 'Dallas', 'TX', 'DNC', 'Data Centers', 'List', '09/03/2026', '10/03/2026'],
      ['', '', '', '', '', '', '', '', '', '', '', ''],
    ]).expect(201)
    expect(r.body.import.summary).toMatchObject({ leads: 5, added: 5, changed: 0, missingState: 1 })
    expect(r.body.import.summary.newIndustries.map((x: { name: string }) => x.name).sort()).toEqual(['Data Centers', 'Healthcare', 'Logistics', 'Manufacturing'])

    const d = await data(w.itadMember).expect(200)
    const byCo = Object.fromEntries(d.body.leads.map((l: { company: string }) => [l.company, l]))
    expect(byCo['Mesa Data Hosting']).toMatchObject({ state: 'Arizona', region: 'AZ', status: 'Voicemail Sent', stage: 2 })
    expect(byCo['No State Co']).toMatchObject({ state: null, status: 'Unknown', stage: 1, suggestedState: 'Florida' })
    expect(byCo['Dallas DC']).toMatchObject({ region: 'CT', verifyZone: true, stage: 3 })

    // Another rep sees none of them; a member cannot look at someone else's.
    expect((await data(w.itadLead).expect(200)).body.leads).toHaveLength(0)
    await data(w.itadMember, w.itadLead.id).expect(403)
    await data(w.leadgenMember).expect(403) // not ITAD
  })

  it('a second import updates, logs movement, keeps notes and snoozes, and compares the funnel', async () => {
    const before = (await data(w.itadMember)).body.leads
    const harbor = before.find((l: { company: string }) => l.company === 'Harbor Cold Storage')
    await request(app).post(`/api/dialer/leads/${harbor.id}/actions`).set(...auth(w.itadMember)).send({ kind: 'NOTE', note: 'Asked to call after the 20th' }).expect(201)
    await request(app).post(`/api/dialer/leads/${harbor.id}/actions`).set(...auth(w.itadMember)).send({ kind: 'SNOOZE', at: new Date(Date.now() + 5 * 86400000).toISOString() }).expect(201)
    const nostate = before.find((l: { company: string }) => l.company === 'No State Co')
    await request(app).patch(`/api/dialer/leads/${nostate.id}`).set(...auth(w.itadMember)).send({ state: 'FL' }).expect(200)

    const r = await imp(w.itadMember, [
      ['L1', 'Harbor Cold Storage', 'Ann', 'ann@harbor.com', '404-555-0101', 'Atlanta', 'GA', 'Connected', 'Logistics', 'Web', '09/01/2026', '09/12/2026'], // unchanged
      ['L2', 'Apex Precision Parts', 'Bob', 'bob@apex.com', '216-555-0102', 'Cleveland', 'Ohio', 'Pipeline', 'Manufacturing', 'Web', '09/01/2026', '10/10/2026'], // forward
      ['L3', 'Mesa Data Hosting', 'Cy', 'cy@mesa.com', '602-555-0103', 'Phoenix', 'AZ', 'Connected', 'Data Centers', 'List', '09/02/2026', '10/12/2026'], // forward
      ['L4', 'No State Co', 'Di', 'di@nostate.com', '305-555-0104', '', '', '', 'Healthcare', 'List', '09/03/2026', '10/03/2026'], // still blank state
      ['L6', 'New One LLC', 'Fa', 'fa@new.com', '503-555-0106', 'Portland', 'OR', 'Assigned', 'IT Management Services', 'List', '10/14/2026', '10/14/2026'],
    ]).expect(201)
    const s = r.body.import.summary
    expect(s).toMatchObject({ added: 1, unchanged: 2, changed: 2, movedForward: 1, movedBack: 0, notInFile: 1 }) // Interested -> Pipeline stays in stage 4
    expect(s.newIndustries).toEqual([{ name: 'IT Management Services', count: 1 }])
    expect(s.topChanges).toEqual(expect.arrayContaining([{ from: 'Voicemail Sent', to: 'Connected', count: 1 }, { from: 'Interested', to: 'Pipeline', count: 1 }]))
    expect(s.funnelBefore.total).toBe(5)
    expect(s.funnelNow.total).toBe(5) // L5 dropped out of the export, L6 came in

    const d = (await data(w.itadMember)).body.leads
    const h = d.find((l: { company: string }) => l.company === 'Harbor Cold Storage')
    expect(h.snoozeUntil).not.toBeNull() // snooze survived the import
    expect(h.actionCount).toBe(1) // the snooze; the note is kept as a note
    expect(h.noteCount).toBe(1)
    const ns = d.find((l: { company: string }) => l.company === 'No State Co')
    expect(ns).toMatchObject({ stateOverride: 'Florida', region: 'ET' }) // the fix survived a blank CRM state
    expect(d.find((l: { company: string }) => l.company === 'Dallas DC')).toBeUndefined()

    const det = await request(app).get(`/api/dialer/leads/${d.find((l: { company: string }) => l.company === 'Mesa Data Hosting').id}`).set(...auth(w.itadMember)).expect(200)
    expect(det.body.changes.map((c: { toStatus: string }) => c.toStatus)).toEqual(['Voicemail Sent', 'Connected'])
    const hist = await request(app).get('/api/dialer/imports').set(...auth(w.itadMember)).expect(200)
    expect(hist.body.imports).toHaveLength(2)

    // Someone else's lead: not found.
    await request(app).get(`/api/dialer/leads/${h.id}`).set(...auth(w.leadgenLead)).expect(403) // not ITAD at all
  })

  it('the same lead in two reps\' files goes to a manager', async () => {
    // itadLead imports a lead the member already holds.
    const r = await imp(w.itadLead, [['L2', 'Apex Precision Parts', 'Bob', 'bob@apex.com', '216-555-0102', 'Cleveland', 'OH', 'Assigned', 'Manufacturing', 'Web', '', '']]).expect(201)
    expect(r.body.import.summary.duplicates).toBe(1)
    const dups = await request(app).get('/api/dialer/duplicates').set(...auth(w.itadLead)).expect(200)
    expect(dups.body.duplicates).toHaveLength(1)
    expect(dups.body.duplicates[0].holders.map((h: { ownerName: string }) => h.ownerName).sort()).toEqual(['itad lead', 'itad member'])
    await request(app).get('/api/dialer/duplicates').set(...auth(w.itadMember)).expect(403)
    await request(app).post('/api/dialer/duplicates/resolve').set(...auth(w.itadLead)).send({ matchKey: dups.body.duplicates[0].matchKey, keepOwnerId: w.itadMember.id }).expect(200)
    expect((await request(app).get('/api/dialer/duplicates').set(...auth(w.itadLead))).body.duplicates).toHaveLength(0)
    expect((await data(w.itadLead)).body.leads).toHaveLength(0) // the lead's copy is hidden for the losing rep
    // The manager sees the team.
    const all = await data(w.itadLead, 'all').expect(200)
    expect(all.body.leads.length).toBe(5)
    expect(all.body.me.isManager).toBe(true)
  })

  it('settings: only a manager, and a stage change re-stages leads', async () => {
    const cur = (await request(app).get('/api/dialer/settings').set(...auth(w.itadMember)).expect(200)).body.settings
    await request(app).put('/api/dialer/settings').set(...auth(w.itadMember)).send(cur).expect(403)
    const next = { ...cur, stageMap: { ...cur.stageMap, 'Working On': 4 } }
    await request(app).put('/api/dialer/settings').set(...auth(w.itadLead)).send(next).expect(200)
    expect((await request(app).get('/api/dialer/settings').set(...auth(w.itadMember))).body.settings.stageMap['Working On']).toBe(4)
    await request(app).put('/api/dialer/settings').set(...auth(w.itadLead)).send(cur).expect(200)
  })

  it('bad imports are refused', async () => {
    await request(app).post('/api/dialer/imports').set(...auth(w.itadMember)).send({ fileName: 'x.csv', headers: ['A'], mapping: { company: 'A' }, rows: [['x']] }).expect(400)
    await request(app).post(`/api/dialer/leads/nope/actions`).set(...auth(w.itadMember)).send({ kind: 'NOTE', note: 'x' }).expect(404)
  })
})
