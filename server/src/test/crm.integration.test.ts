import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Role } from '@prisma/client'
import { app, auth, prisma, seedWorld } from './helpers'
import { hashPassword } from '../lib/auth'
import { ensureHomeCompany } from '../lib/company'
import { setCompanyFlag } from '../lib/flags'
import { runAsCompany } from '../lib/tenancy'
import { SALES_PIPELINE } from '../lib/leads/pipeline'

// The CRM views on top of Lead Management: the deal board (a column per stage, what each is worth,
// a company's own stages count as open) and contacts (several people per company, make one the
// main contact, the list and its export, a rep sees only their own leads' people).

const C = 'crm-co'
type U = { id: string; role: Role }
let admin: U, manager: U, rep: U, otherRep: U
let bizId = ''
const leads: Record<string, string> = {}

beforeAll(async () => {
  await seedWorld()
  await ensureHomeCompany()
  await prisma.company.deleteMany({ where: { id: C } })
  await prisma.company.create({ data: { id: C, name: 'CRM Co', slug: C, plan: 'business', setupDoneAt: new Date(), timeZone: 'Asia/Karachi' } })
  const dept = await prisma.department.create({ data: { companyId: C, name: 'Sales', type: 'GENERAL' } })
  const passwordHash = await hashPassword('Pass-for-tests-9')
  const mk = async (name: string, role: Role) => { const u = await prisma.user.create({ data: { companyId: C, name, email: `${name.replace(/\s/g, '.').toLowerCase()}@crm.local.test`, role, status: 'ACTIVE', isActive: true, passwordHash, departmentId: dept.id } }); return { id: u.id, role: u.role } }
  admin = await mk('Ada Admin', 'SUPER_ADMIN')
  manager = await mk('Mona Manager', 'TEAM_LEAD')
  rep = await mk('Ravi Rep', 'MEMBER')
  otherRep = await mk('Omar Other', 'MEMBER')
  await setCompanyFlag('lead-management', C, true, 'test')
})
afterAll(async () => {
  await prisma.company.deleteMany({ where: { id: C } })
  await prisma.$disconnect()
})

const api = (u: U) => ({
  get: (p: string) => request(app).get(`/api/leads${p}`).set(...auth(u)),
  post: (p: string, b: object = {}) => request(app).post(`/api/leads${p}`).set(...auth(u)).send(b),
  patch: (p: string, b: object) => request(app).patch(`/api/leads${p}`).set(...auth(u)).send(b),
  del: (p: string) => request(app).delete(`/api/leads${p}`).set(...auth(u)),
})

describe('CRM: the deal board', () => {
  it('a business takes the sales pipeline (Proposal, Negotiation) and a currency; its own open stages count as open', async () => {
    const b = (await api(admin).post('/businesses', { name: 'Sales' }).expect(201)).body.business
    bizId = b.id
    await api(admin).post(`/businesses/${bizId}/members`, { userId: manager.id, role: 'MANAGER' }).expect(200)
    await api(admin).post(`/businesses/${bizId}/members`, { userId: rep.id, role: 'REP' }).expect(200)
    await api(admin).post(`/businesses/${bizId}/members`, { userId: otherRep.id, role: 'REP' }).expect(200)
    const saved = (await api(admin).patch(`/businesses/${bizId}`, { pipeline: SALES_PIPELINE, settings: { currency: 'PKR' } }).expect(200)).body.business
    expect(saved.pipeline.map((x: { key: string }) => x.key)).toContain('PROPOSAL')
    await api(admin).patch(`/businesses/${bizId}`, { settings: { currency: 'DOGE' } }).expect(422)
    const add = async (organization: string, name: string, value: number | null, assignTo: string, phone?: string) => (await api(manager).post('/', { businessId: bizId, organization, name, value, assignTo, phone: phone ?? null }).expect(201)).body.lead.id as string
    leads.north = await add('Northgate Foods', 'Sara Ahmed', 120000, rep.id, '+1 602 555 0141')
    leads.blue = await add('Blue Sky Logistics', 'Omar Khan', 80000, rep.id)
    leads.hill = await add('Hillside Clinics', 'Ayesha K', null, otherRep.id)
    // Move two along the pipeline: a custom open stage, and Won.
    await api(rep).patch(`/${leads.north}`, { status: 'PROPOSAL' }).expect(200)
    await api(manager).post(`/${leads.blue}/close`, { status: 'WON' }).expect(200)
    // The leads list's "open" filter knows Proposal is open for this business.
    const open = (await api(manager).get(`/?business=${bizId}&status=open`).expect(200)).body
    expect(open.leads.map((l: { id: string }) => l.id).sort()).toEqual([leads.north, leads.hill].sort())
    expect((await api(manager).get(`/?business=${bizId}&status=PROPOSAL`).expect(200)).body.total).toBe(1)
  })

  it('the board has a column per stage with its count and value, the totals, and no Spam column', async () => {
    const b = (await api(manager).get(`/board?business=${bizId}`).expect(200)).body
    expect(b.currency).toBe('PKR')
    expect(b.canManage).toBe(true)
    expect(b.columns.map((c: { key: string }) => c.key)).toEqual(['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'])
    const col = (k: string) => b.columns.find((c: { key: string }) => c.key === k)
    expect(col('PROPOSAL')).toMatchObject({ count: 1, value: 120000, open: true })
    expect(col('PROPOSAL').leads[0]).toMatchObject({ id: leads.north, organization: 'Northgate Foods', value: 120000 })
    expect(col('NEW')).toMatchObject({ count: 1, value: 0 })
    expect(col('WON')).toMatchObject({ count: 1, value: 80000, open: false })
    expect(b.totals).toEqual({ open: { count: 2, value: 120000 }, won: { count: 1, value: 80000 } })
  })

  it('a rep sees only their own deals on the board; a filter by person and a search work; outsiders get nothing', async () => {
    const mine = (await api(rep).get(`/board?business=${bizId}`).expect(200)).body
    expect(mine.canManage).toBe(false)
    expect(mine.totals.open).toEqual({ count: 1, value: 120000 })
    expect(mine.columns.find((c: { key: string }) => c.key === 'NEW').count).toBe(0)
    const byPerson = (await api(manager).get(`/board?business=${bizId}&assignee=${otherRep.id}`).expect(200)).body
    expect(byPerson.totals.open.count).toBe(1)
    const found = (await api(manager).get(`/board?business=${bizId}&q=northgate`).expect(200)).body
    expect(found.totals.open).toEqual({ count: 1, value: 120000 })
    await api(manager).get('/board').expect(422)
    const outsider = await runAsCompany(C, () => prisma.user.create({ data: { companyId: C, name: 'Out Sider', email: 'out.sider@crm.local.test', role: 'MEMBER', status: 'ACTIVE', isActive: true, passwordHash: 'x' } }))
    await api({ id: outsider.id, role: 'MEMBER' }).get(`/board?business=${bizId}`).expect(403)
  })

  it('moving a card is a status change: the value moves with it', async () => {
    await api(rep).patch(`/${leads.north}`, { status: 'NEGOTIATION', value: 150000 }).expect(200)
    const b = (await api(manager).get(`/board?business=${bizId}`).expect(200)).body
    const col = (k: string) => b.columns.find((c: { key: string }) => c.key === k)
    expect(col('PROPOSAL').count).toBe(0)
    expect(col('NEGOTIATION')).toMatchObject({ count: 1, value: 150000 })
    // A rep cannot mark a deal Won; a manager can.
    await api(rep).post(`/${leads.north}/close`, { status: 'WON' }).expect(403)
  })
})

describe('CRM: contacts', () => {
  let cfo = ''
  it('more people are added to a company; the lead keeps its main contact', async () => {
    const r = (await api(rep).post(`/${leads.north}/contacts`, { name: 'Bilal Raza', role: 'CFO', email: 'Bilal@Northgate.example', phone: '(602) 555-0177', decisionMaker: true }).expect(201)).body
    cfo = r.contact.id
    expect(r.contact).toMatchObject({ name: 'Bilal Raza', role: 'CFO', email: 'bilal@northgate.example', phoneE164: '+16025550177', decisionMaker: true })
    await api(rep).post(`/${leads.north}/contacts`, { name: 'Hina Buyer', role: 'Procurement' }).expect(201)
    await api(rep).post(`/${leads.north}/contacts`, { name: '' }).expect(422)
    await api(rep).post(`/${leads.north}/contacts`, { name: 'Bad Mail', email: 'nope' }).expect(422)
    const d = (await api(rep).get(`/${leads.north}`).expect(200)).body.lead
    expect(d.name).toBe('Sara Ahmed')
    expect(d.contacts.map((c: { name: string }) => c.name)).toEqual(['Bilal Raza', 'Hina Buyer']) // the decision maker first
    expect(d.events.some((e: { text: string }) => e.text === 'Added contact Bilal Raza (CFO)')).toBe(true)
    // Someone else's lead: not theirs to change.
    await api(otherRep).post(`/${leads.north}/contacts`, { name: 'Nope' }).expect(404)
    await api(rep).post(`/${leads.hill}/contacts`, { name: 'Nope' }).expect(404)
  })

  it('the contacts list has the main contacts and the others, by name; search finds a person or a company; a lead is found by its other contact', async () => {
    const all = (await api(manager).get(`/contacts?business=${bizId}`).expect(200)).body
    expect(all.total).toBe(5)
    expect(all.contacts.map((c: { name: string }) => c.name)).toEqual(['Ayesha K', 'Bilal Raza', 'Hina Buyer', 'Omar Khan', 'Sara Ahmed'])
    const bilal = all.contacts.find((c: { name: string }) => c.name === 'Bilal Raza')
    expect(bilal).toMatchObject({ primary: false, contactId: cfo, leadId: leads.north, company: 'Northgate Foods', role: 'CFO', decisionMaker: true, statusLabel: 'Negotiation', open: true })
    expect(all.contacts.find((c: { name: string }) => c.name === 'Sara Ahmed')).toMatchObject({ primary: true, contactId: null, leadId: leads.north })
    expect((await api(manager).get(`/contacts?business=${bizId}&q=procure`).expect(200)).body.contacts.map((c: { name: string }) => c.name)).toEqual(['Hina Buyer'])
    expect((await api(manager).get(`/contacts?business=${bizId}&q=northgate`).expect(200)).body.total).toBe(3)
    // A rep sees only the people on their own leads.
    expect((await api(otherRep).get(`/contacts?business=${bizId}`).expect(200)).body.contacts.map((c: { name: string }) => c.name)).toEqual(['Ayesha K'])
    // The leads list search finds Northgate by its CFO's name and by his number.
    expect((await api(manager).get(`/?business=${bizId}&status=all&q=bilal`).expect(200)).body.leads.map((l: { id: string }) => l.id)).toEqual([leads.north])
    expect((await api(manager).get(`/?business=${bizId}&status=all&q=${encodeURIComponent('602-555-0177')}`).expect(200)).body.leads.map((l: { id: string }) => l.id)).toEqual([leads.north])
  })

  it('the export has one row per person; a rep exports only their own', async () => {
    const csv = (await api(manager).get(`/contacts.csv?business=${bizId}`).expect(200)).text
    const lines = csv.trim().split('\n')
    expect(lines[0]).toContain('Name')
    expect(lines[0]).toContain('Main contact')
    expect(lines).toHaveLength(6)
    expect(csv).toContain('Bilal Raza')
    const own = (await api(otherRep).get(`/contacts.csv?business=${bizId}`).expect(200)).text
    expect(own).toContain('Ayesha K')
    expect(own).not.toContain('Bilal Raza')
  })

  it('a contact is edited and removed; "make primary" swaps with the lead’s main contact', async () => {
    const up = (await api(rep).patch(`/contacts/${cfo}`, { role: 'Finance Director', mobile: '0300 1234567' }).expect(200)).body.contact
    expect(up).toMatchObject({ role: 'Finance Director', mobile: '0300 1234567', name: 'Bilal Raza' })
    await api(otherRep).patch(`/contacts/${cfo}`, { role: 'x' }).expect(404)
    await api(rep).post(`/contacts/${cfo}/primary`).expect(200)
    const d = (await api(rep).get(`/${leads.north}`).expect(200)).body.lead
    expect(d).toMatchObject({ name: 'Bilal Raza', email: 'bilal@northgate.example', phoneE164: '+16025550177', jobTitle: 'Finance Director' })
    // Sara, who was the main contact, is now one of the others, with her number kept for call matching.
    const sara = d.contacts.find((c: { name: string }) => c.name === 'Sara Ahmed')
    expect(sara).toMatchObject({ phoneE164: '+16025550141', decisionMaker: false })
    expect(d.contacts).toHaveLength(2)
    await api(rep).del(`/contacts/${sara.id}`).expect(200)
    expect((await api(rep).get(`/${leads.north}`).expect(200)).body.lead.contacts.map((c: { name: string }) => c.name)).toEqual(['Hina Buyer'])
    expect((await api(manager).get(`/contacts?business=${bizId}`).expect(200)).body.total).toBe(4)
  })

  it('contacts live inside the company walls', async () => {
    const row = await prisma.leadContact.findFirst({ where: { leadId: leads.north } })
    expect(row?.companyId).toBe(C)
    // Another company's admin sees neither the board nor the people.
    const other = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN', companyId: { not: C } }, select: { id: true, role: true } })
    const theirs = (await prisma.user.findUniqueOrThrow({ where: { id: other!.id }, select: { companyId: true } })).companyId
    await setCompanyFlag('lead-management', theirs, true, 'test')
    await setCompanyFlag('deal-board', theirs, true, 'test')
    await api(other!).get(`/board?business=${bizId}`).expect(404)
    expect((await api(other!).get(`/contacts?business=${bizId}`).expect(200)).body.total).toBe(0)
    await setCompanyFlag('lead-management', theirs, false, 'test')
    await setCompanyFlag('deal-board', theirs, null, 'test')
  })
})

describe('CRM: the "deal-board" switch', () => {
  it('starts switched off for 99 Technologies (its migration says so), on for everyone else', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const sql = readFileSync(join(__dirname, '../../prisma/migrations/20261111100000_lead_contacts/migration.sql'), 'utf8')
    expect(sql).toMatch(/VALUES \('deal-board', 'company-1', false,/)
    const { isOn } = await import('../lib/flags')
    expect(await isOn('deal-board', C)).toBe(true)
  })

  it('off: no board, no contacts, the lead and the export read as before; on again: everything is back', async () => {
    await setCompanyFlag('deal-board', C, false, 'test')
    await api(admin).get(`/board?business=${bizId}`).expect(403)
    await api(admin).get('/contacts').expect(403)
    await api(admin).get('/contacts.csv').expect(403)
    await api(manager).post(`/${leads.north}/contacts`, { name: 'Nobody New' }).expect(403)
    const d = (await api(admin).get(`/${leads.north}`).expect(200)).body
    expect(d.can.crm).toBe(false)
    const csv = (await api(admin).get(`/export.csv?business=${bizId}`).expect(200)).text
    expect(csv.split('\n')[0]).not.toContain('Deal value')
    // The leads list and the lead itself still work.
    expect((await api(admin).get(`/?business=${bizId}`).expect(200)).body.total).toBeGreaterThan(0)

    await setCompanyFlag('deal-board', C, null, 'test')
    await api(admin).get(`/board?business=${bizId}`).expect(200)
    expect((await api(admin).get(`/${leads.north}`).expect(200)).body.can.crm).toBe(true)
    expect((await api(admin).get(`/export.csv?business=${bizId}`).expect(200)).text.split('\n')[0]).toContain('Deal value')
  })
})

describe('CRM: another company never touches 99 Technologies’ own things', () => {
  it('the phone system on the server is not offered: no users listed, no linking, no sync, no calling through it', async () => {
    const info = (await api(admin).get('/talkloop').expect(200)).body
    expect(info.available).toBe(false)
    expect(info.configured).toBe(false)
    expect(info.talkloopUsers).toEqual([])
    expect(info.people).toEqual([])
    expect(info.pbxDomain).toBeNull()
    await api(admin).patch('/talkloop/link', { auto: true }).expect(403)
    await api(admin).patch('/talkloop/link', { userId: rep.id, talkloopUserId: 1 }).expect(403)
    await api(admin).post('/talkloop/sync').expect(403)
    await api(rep).post(`/${leads.north}/dial`).expect(403)
    // How the Call buttons dial is the company's own setting and still works.
    await api(admin).patch('/talkloop/dial', { scheme: 'tel' }).expect(200)
    expect((await api(rep).get('/meta').expect(200)).body.talkloopDial).toBe(false)
  })

  it('a usual pipeline lists everyday industries, not CMR’s segments, until it sets its own', async () => {
    const meta = (await api(rep).get('/meta').expect(200)).body
    const biz = meta.businesses.find((b: { id: string }) => b.id === bizId)
    expect(biz.settings.segments).toContain('Healthcare')
    expect(biz.settings.segments.join(' ')).not.toMatch(/Battery|E-waste|HHW/)
    expect((await api(rep).get(`/${leads.north}`).expect(200)).body.industries).toContain('Retail')
    // Saving another setting does not bring CMR's list back.
    await api(admin).patch(`/businesses/${bizId}`, { settings: { currency: 'USD' } }).expect(200)
    expect((await api(admin).get('/businesses').expect(200)).body.businesses.find((b: { id: string }) => b.id === bizId).settings.segments).toContain('Healthcare')
    // Its own list wins.
    await api(admin).patch(`/businesses/${bizId}`, { settings: { segments: ['Bakeries', 'Clinics'] } }).expect(200)
    expect((await api(rep).get('/meta').expect(200)).body.businesses.find((b: { id: string }) => b.id === bizId).settings.segments).toEqual(['Bakeries', 'Clinics'])
  })
})
