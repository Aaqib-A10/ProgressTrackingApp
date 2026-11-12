import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Role } from '@prisma/client'
import { app, auth, prisma, seedWorld } from './helpers'
import { hashPassword, signConnectorToken } from '../lib/auth'
import { syncAutoTasks } from '../lib/dialer/tasks'

// ITAD update 12 Nov 2026 (docs/itad-notes/DESIGN.md), acceptance criteria of section 7:
// the Earth Zone sync, notes with sources and overrides, the Claude log, touches from notes, follow-ups that
// close themselves. Metriq never talks to Earth Zone: the "file" here is rows the browser would send.

type U = { id: string; role: Role }
let agent: U, colleague: U
const HEADERS = ['Lead ID', 'Company', 'Contact', 'Email', 'Phone', 'State', 'Lead Status', 'Created', 'Updated At']
const MAPPING = { leadId: 'Lead ID', company: 'Company', contactName: 'Contact', email: 'Email', phone: 'Phone', state: 'State', status: 'Lead Status', leadDate: 'Created', lastActivity: 'Updated At' }
const ago = (days: number) => { const d = new Date(Date.now() - days * 86400000); return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}` }
const isoAgo = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
const imp = (u: U, rows: string[][]) => request(app).post('/api/dialer/imports').set(...auth(u)).send({ fileName: 'crm.csv', headers: HEADERS, mapping: MAPPING, rows })
const data = (u: U) => request(app).get('/api/dialer/data').set(...auth(u)).expect(200).then((r) => r.body)
const sync = (u: U, rows: Record<string, string | null>[], apply: boolean, replace = false) => request(app).post('/api/dialer/ez-sync').set(...auth(u)).send({ rows, apply, replace })
const asClaude = (u: U): [string, string] => ['Authorization', `Bearer ${signConnectorToken({ sub: u.id, role: u.role })}`]
type Lead = { id: string; company: string; lastTouchedAt: string | null; tries: number; quietFrom: string | null }
const leadOf = (d: { leads: Lead[] }, co: string) => d.leads.find((l) => l.company === co)!
const byCompany = (co: string) => prisma.dialerLead.findFirstOrThrow({ where: { ownerId: agent.id, company: co } })

const EZ = () => [
  // Matched by the Lead ID; the primary number in Alternative Numbers is not repeated.
  { ezId: 'EZ-1', company: 'Acme Printing', lastName: 'Doe', phone: '404-555-0101', email: 'jdoe@acme.test', altPhones: '(404) 555-2222, 404-555-0101 / Cell: 404 555 3333', email2: 'ap@acme.test', jobTitle: 'IT Manager',
    hiddenDescription: 'CFO: linkedin.com/in/acme-cfo\n400 laptops to retire in Q1.',
    notes: `[${isoAgo(20)}] Danyal  Ahmed: Called, left VM ---- [${isoAgo(6)}] Danyal Ahmed: Spoke with Kim Lee (kim.lee@acme.test), purchasing manager. || [${isoAgo(2)}] Sara Malik: Team update: Acme moved offices` },
  // Matched by the primary email (no ID in the file).
  { ezId: null, company: 'Birch Bank', lastName: 'Ray', phone: null, email: 'ray@birch.test', altPhones: '', email2: '', jobTitle: '', hiddenDescription: '', notes: `[${isoAgo(45)}] Danyal Ahmed: Sent the quote` },
  // Another agent's lead: never touched.
  { ezId: 'EZ-OTHER', company: 'Other Co', lastName: 'Zed', phone: '999-555-0000', email: 'zed@other.test', altPhones: '111-555-1111', email2: null, jobTitle: null, hiddenDescription: null, notes: null },
  // Two of the agent's leads share this number: ambiguous, left out.
  { ezId: null, company: null, lastName: null, phone: '212-555-0909', email: null, altPhones: '212-555-7777', email2: null, jobTitle: null, hiddenDescription: null, notes: null },
  // Blank cells never overwrite (Cedar already has a secondary email and a job title).
  { ezId: 'EZ-3', company: 'Cedar Co', lastName: 'Kay', phone: null, email: null, altPhones: null, email2: '', jobTitle: '   ', hiddenDescription: null, notes: null },
]

beforeAll(async () => {
  await seedWorld()
  const itad = await prisma.department.findFirstOrThrow({ where: { type: 'ITAD' } })
  const passwordHash = await hashPassword('Pass-for-tests-9')
  const mk = async (name: string) => { const u = await prisma.user.create({ data: { name, email: `${name.replace(/\s+/g, '.').toLowerCase()}@itad-notes.local.test`, role: 'MEMBER', status: 'ACTIVE', isActive: true, passwordHash, departmentId: itad.id } }); return { id: u.id, role: u.role } }
  agent = await mk('Danyal Ahmed'); colleague = await mk('Sara Malik')
  await imp(agent, [
    ['EZ-1', 'Acme Printing', 'John Doe', 'jdoe@acme.test', '404-555-0101', 'GA', 'Connected', ago(90), ago(40)],
    ['', 'Birch Bank', 'Amy Ray', 'ray@birch.test', '305-555-0102', 'FL', 'Interested', ago(90), ago(50)],
    ['EZ-3', 'Cedar Co', 'Al Kay', 'kay@cedar.test', '602-555-0103', 'AZ', 'Voicemail Sent', ago(90), ago(5)],
    ['EZ-4', 'Dune One', 'D One', 'one@dune.test', '212-555-0909', 'NY', 'Contact Attempted', ago(90), ago(5)],
    ['EZ-5', 'Dune Two', 'D Two', 'two@dune.test', '212-555-0909', 'NY', 'Contact Attempted', ago(90), ago(5)],
  ]).expect(201)
  await prisma.dialerLead.updateMany({ where: { ownerId: agent.id, company: 'Cedar Co' }, data: { email2: 'keep@cedar.test', jobTitle: 'Owner' } })
  await imp(colleague, [['EZ-OTHER', 'Other Co', 'Z Zed', 'zed@other.test', '999-555-0000', 'TX', 'Connected', ago(90), ago(5)]]).expect(201)
})
afterAll(async () => { await prisma.$disconnect() })

describe('Earth Zone sync (section 1)', () => {
  it('the preview shows matched, unmatched and ambiguous rows and saves nothing', async () => {
    const r = await sync(agent, EZ(), false).expect(200)
    // Cedar only gets its Earth Zone Lead ID saved (its blank cells change nothing else): 3 leads.
    expect(r.body).toMatchObject({ rows: 5, matched: 3, unmatchedCount: 1, ambiguousCount: 1, leadsToUpdate: 3 })
    expect(r.body.unmatched[0]).toMatchObject({ row: 4, reason: 'Not one of your leads' })
    expect(r.body.ambiguous[0]).toMatchObject({ by: 'phone' })
    expect(r.body.fields).toMatchObject({ altPhones: 2, email2: 1, jobTitle: 1, description: 1, links: 1, notes: 4, ezLeadId: 2 })
    expect(r.body.authors).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Danyal Ahmed', matched: true, isMe: true }), expect.objectContaining({ name: 'Sara Malik', matched: true, isMe: false })]))
    expect(await prisma.dialerNote.count({ where: { source: 'EARTHZONE' } })).toBe(0)
    expect((await byCompany('Acme Printing')).altPhones).toEqual([])
  })

  it('apply fills only the listed fields of the agent\'s own leads, from non-blank cells', async () => {
    const before = await byCompany('Acme Printing')
    const r = await sync(agent, EZ(), true).expect(200)
    expect(r.body).toMatchObject({ applied: true, updated: 3, notesAdded: 4 })
    const acme = await byCompany('Acme Printing')
    expect(acme).toMatchObject({ altPhones: ['(404) 555-2222', '404 555 3333'], email2: 'ap@acme.test', jobTitle: 'IT Manager', description: '400 laptops to retire in Q1.', ezLeadId: 'EZ-1' })
    expect(acme.ezLinks).toEqual([{ label: 'CFO LinkedIn', url: 'https://linkedin.com/in/acme-cfo' }])
    // Everything else untouched.
    expect(acme).toMatchObject({ city: before.city, state: before.state, status: before.status, lastActivityAt: before.lastActivityAt, assignedTo: before.assignedTo, createdAt: before.createdAt })
    // The Earth Zone Lead ID is saved on matched leads (Birch matched by email: none to save), blanks change nothing.
    expect((await byCompany('Birch Bank')).ezLeadId).toBeNull()
    const cedar = await byCompany('Cedar Co')
    expect(cedar).toMatchObject({ email2: 'keep@cedar.test', jobTitle: 'Owner' })
    // The other agent's lead and the ambiguous ones are untouched.
    expect((await prisma.dialerLead.findFirstOrThrow({ where: { company: 'Other Co' } })).altPhones).toEqual([])
    expect((await byCompany('Dune One')).altPhones).toEqual([])
  })

  it('notes keep their Earth Zone date, author and source; a new person in a note is offered as a contact', async () => {
    const acme = await byCompany('Acme Printing')
    const notes = await prisma.dialerNote.findMany({ where: { leadId: acme.id }, orderBy: { createdAt: 'asc' } })
    expect(notes.map((n) => [n.createdAt.toISOString().slice(0, 10), n.authorName, n.source, n.userId])).toEqual([
      [isoAgo(20), 'Danyal Ahmed', 'EARTHZONE', agent.id],
      [isoAgo(6), 'Danyal Ahmed', 'EARTHZONE', agent.id],
      [isoAgo(2), 'Sara Malik', 'EARTHZONE', colleague.id],
    ])
    const d = await request(app).get(`/api/dialer/leads/${acme.id}`).set(...auth(agent)).expect(200)
    expect(d.body.notes[0]).toMatchObject({ source: 'EARTHZONE', author: 'Sara Malik' })
    expect(d.body.contacts).toEqual([expect.objectContaining({ name: 'Kim Lee', email: 'kim.lee@acme.test', state: 'SUGGESTED' })])
  })

  it('running the sync again adds no duplicate notes or numbers', async () => {
    const r = await sync(agent, EZ(), true).expect(200)
    expect(r.body).toMatchObject({ notesAdded: 0, notesAlreadyHere: 4 })
    expect((await byCompany('Acme Printing')).altPhones).toHaveLength(2)
    expect(await prisma.dialerContact.count({ where: { lead: { ownerId: agent.id } } })).toBe(1)
  })

  it('a deleted or edited note stays so after any later sync', async () => {
    const acme = await byCompany('Acme Printing')
    const [first, second] = await prisma.dialerNote.findMany({ where: { leadId: acme.id }, orderBy: { createdAt: 'asc' } })
    await request(app).delete(`/api/dialer/notes/${first.id}`).set(...auth(agent)).expect(200)
    await request(app).patch(`/api/dialer/notes/${second.id}`).set(...auth(agent)).send({ text: 'Spoke with Kim Lee, purchasing manager: wants 200 laptops collected' }).expect(200)
    await sync(agent, EZ(), true).expect(200)
    const d = await request(app).get(`/api/dialer/leads/${acme.id}`).set(...auth(agent)).expect(200)
    expect(d.body.notes.map((n: { id: string }) => n.id)).not.toContain(first.id)
    expect(d.body.deletedEzNotes).toBe(1)
    const edited = d.body.notes.find((n: { id: string }) => n.id === second.id)
    expect(edited.text).toContain('wants 200 laptops')
    expect(edited.ezText).toContain('kim.lee@acme.test') // the "differs from Earth Zone" marker
  })
})

describe('touches from notes and follow-ups that close themselves (section 4)', () => {
  it('Last touched is the agent\'s latest note; a colleague\'s note does not move it; Updated At is the fallback', async () => {
    const d = await data(agent)
    expect(leadOf(d, 'Acme Printing').lastTouchedAt?.slice(0, 10)).toBe(isoAgo(6)) // Sara's note 2 days ago does not count
    expect(leadOf(d, 'Birch Bank').lastTouchedAt?.slice(0, 10)).toBe(isoAgo(45))
    const cedar = await byCompany('Cedar Co')
    expect(leadOf(d, 'Cedar Co').lastTouchedAt).toBe(cedar.lastActivityAt!.toISOString())
  })

  it('the agent\'s own note closes the open follow-up by itself, Task history names it, and it can be reopened', async () => {
    const birch = await byCompany('Birch Bank')
    await syncAutoTasks([agent.id])
    const open = await prisma.workLogEntry.findFirstOrThrow({ where: { dialerLeadId: birch.id, autoReason: 'FOLLOW_UP_RULE', status: { not: 'DONE' }, cancelledAt: null } })
    // A colleague's note never closes it.
    await prisma.dialerNote.create({ data: { leadId: birch.id, userId: colleague.id, text: 'Team: Birch merged with Bay Bank' } })
    await syncAutoTasks([agent.id])
    expect((await prisma.workLogEntry.findUniqueOrThrow({ where: { id: open.id } })).status).not.toBe('DONE')
    // Claude logs the agent's call from their daily log: a contact by the agent.
    await request(app).post(`/api/dialer/leads/${birch.id}/notes`).set(...asClaude(agent)).send({ text: 'Called Amy, she will review the quote next week' }).expect(201)
    const closed = await prisma.workLogEntry.findUniqueOrThrow({ where: { id: open.id } })
    expect(closed).toMatchObject({ status: 'DONE', outcome: 'Completed automatically', cancelledAt: null })
    expect(closed.autoClosedBy).toMatch(/^Note on .* \(Claude\)$/)
    const h = await request(app).get('/api/dialer/tasks/history').set(...auth(agent)).expect(200)
    expect(h.body.tasks.find((t: { id: string }) => t.id === open.id)).toMatchObject({ status: 'DONE', autoClosedBy: closed.autoClosedBy })
    // Reopened in one tap: it stays open (the note before the reopen does not close it again).
    await request(app).patch(`/api/dialer/tasks/${open.id}`).set(...auth(agent)).send({ done: false }).expect(200)
    await syncAutoTasks([agent.id])
    expect(await prisma.workLogEntry.findUniqueOrThrow({ where: { id: open.id } })).toMatchObject({ status: 'PLANNED', cancelledAt: null, autoClosedBy: null })
  })
})

describe('the Claude log (section 3)', () => {
  it('lists what Claude wrote (notes and numbers) with the lead and the date; each can be corrected or removed', async () => {
    const cedar = await byCompany('Cedar Co')
    await request(app).patch(`/api/dialer/leads/${cedar.id}`).set(...asClaude(agent)).send({ altPhones: ['602-555-4444'] }).expect(200)
    const log = await request(app).get('/api/dialer/claude-log').set(...auth(agent)).expect(200)
    const value = log.body.items.find((i: { kind: string }) => i.kind === 'VALUE')
    expect(value).toMatchObject({ company: 'Cedar Co', label: 'Alternative number', text: '602-555-4444', canEdit: true })
    expect(log.body.items.some((i: { kind: string; company: string }) => i.kind === 'NOTE' && i.company === 'Birch Bank')).toBe(true)
    await request(app).patch(`/api/dialer/claude-log/values/${value.id}`).set(...auth(agent)).send({ value: '602-555-4445' }).expect(200)
    expect((await byCompany('Cedar Co')).altPhones).toEqual(['602-555-4445'])
    await request(app).delete(`/api/dialer/claude-log/values/${value.id}`).set(...auth(agent)).expect(200)
    expect((await byCompany('Cedar Co')).altPhones).toEqual([])
    const after = await request(app).get('/api/dialer/claude-log?kind=values').set(...auth(agent)).expect(200)
    expect(after.body.items).toHaveLength(0)
  })

  it('another agent sees none of it, and cannot change it', async () => {
    const log = await request(app).get('/api/dialer/claude-log?source=ALL').set(...auth(colleague)).expect(200)
    expect(log.body.items.every((i: { company: string }) => i.company === 'Other Co')).toBe(true)
    const note = await prisma.dialerNote.findFirstOrThrow({ where: { lead: { ownerId: agent.id }, source: 'CLAUDE' } })
    await request(app).delete(`/api/dialer/notes/${note.id}`).set(...auth(colleague)).expect(404)
  })
})
