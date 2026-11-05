import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import request from 'supertest'
import type { Role } from '@prisma/client'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { hashPassword } from '../lib/auth'
import { ensureHomeCompany, HOME_COMPANY_ID } from '../lib/company'
import { setCompanyFlag } from '../lib/flags'
import { runAsCompany } from '../lib/tenancy'
import { runLeadSlaTick } from '../lib/leads/sla'
import { setAuditBaseUrl } from '../lib/health/audit'

// Lead Management: a business gets leads from its website form, a phone call or a sheet; its
// managers give each lead to a rep; reps only see their own; late leads raise an alert once.
// 99 Technologies has it switched off until it is set up.

const C = 'leads-co'
type U = { id: string; role: Role }
let w: SeededWorld
let admin: U, manager: U, rep: U, rep2: U, outsider: U
let bizId = '', otherBizId = '', formKey = ''
let server: Server

beforeAll(async () => {
  w = await seedWorld()
  await ensureHomeCompany()
  // The AI connector calls the API over HTTP, as the person.
  server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  setAuditBaseUrl(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
  await prisma.company.deleteMany({ where: { id: C } })
  await prisma.company.create({ data: { id: C, name: 'Leads Co', slug: C, plan: 'business', setupDoneAt: new Date() } })
  const dept = await prisma.department.create({ data: { companyId: C, name: 'Sales', type: 'GENERAL' } })
  const passwordHash = await hashPassword('Pass-for-tests-9')
  const mk = async (name: string, role: Role) => { const u = await prisma.user.create({ data: { companyId: C, name, email: `${name.replace(/\s/g, '.')}@leads.local.test`, role, status: 'ACTIVE', isActive: true, passwordHash, departmentId: dept.id } }); return { id: u.id, role: u.role } }
  admin = await mk('lena admin', 'SUPER_ADMIN')
  manager = await mk('mona manager', 'TEAM_LEAD')
  rep = await mk('rafi rep', 'MEMBER')
  rep2 = await mk('rita rep', 'MEMBER')
  outsider = await mk('olly other', 'MEMBER')
})
afterAll(async () => {
  server?.close()
  await prisma.company.deleteMany({ where: { id: C } })
  await prisma.$disconnect()
})

const api = (u: U) => ({
  get: (p: string) => request(app).get(`/api/leads${p}`).set(...auth(u)),
  post: (p: string, b: object = {}) => request(app).post(`/api/leads${p}`).set(...auth(u)).send(b),
  patch: (p: string, b: object) => request(app).patch(`/api/leads${p}`).set(...auth(u)).send(b),
  put: (p: string, b: object) => request(app).put(`/api/leads${p}`).set(...auth(u)).send(b),
  del: (p: string) => request(app).delete(`/api/leads${p}`).set(...auth(u)),
})
const notes = (u: U) => prisma.notification.findMany({ where: { userId: u.id, type: { in: ['LEAD_NEW', 'LEAD_ASSIGNED', 'LEAD_SLA'] } }, orderBy: { createdAt: 'asc' } })

describe('Lead Management', () => {
  it('is switched off for 99 Technologies until the owner turns it on', async () => {
    // As the migration leaves it (other tests may have cleared the company switches).
    await setCompanyFlag('lead-management', HOME_COMPANY_ID, false, 'test')
    await request(app).get('/api/leads/meta').set(...auth(w.superAdmin)).expect(403)
  })

  it('only the Super Admin sets up businesses and their people', async () => {
    await api(manager).post('/businesses', { name: 'Nope' }).expect(403)
    const b = (await api(admin).post('/businesses', { name: 'Recycle Co', website: 'https://recycle.example.com', slaAssignMins: 10, slaContactMins: 60 }).expect(201)).body.business
    bizId = b.id; formKey = b.formUrl.split('/').pop()
    expect(b.formUrl).toMatch(/\/api\/lead-in\/lf_/)
    expect(b).not.toHaveProperty('inboxPassEnc')
    otherBizId = (await api(admin).post('/businesses', { name: 'Other Brand' }).expect(201)).body.business.id
    await api(admin).post(`/businesses/${bizId}/members`, { userId: manager.id, role: 'MANAGER' }).expect(200)
    await api(admin).post(`/businesses/${bizId}/members`, { userId: rep.id, role: 'REP' }).expect(200)
    const r = await api(admin).post(`/businesses/${bizId}/members`, { userId: rep2.id, role: 'REP' }).expect(200)
    expect(r.body.business.members.map((m: { role: string }) => m.role).sort()).toEqual(['MANAGER', 'REP', 'REP'])
    // The menu shows Leads only to people who work leads.
    expect((await request(app).get('/api/auth/me').set(...auth(rep)).expect(200)).body.user.leadsRole).toBe('REP')
    expect((await request(app).get('/api/auth/me').set(...auth(outsider)).expect(200)).body.user.leadsRole).toBeNull()
  })

  it('a website form sends a lead (JSON or a plain form, any field names) and the managers hear of it', async () => {
    const r = await request(app).post(`/api/lead-in/${formKey}`).set('Origin', 'https://recycle.example.com')
      .send({ first_name: 'Ada', last_name: 'Lovelace', Email: 'ADA@Example.com ', 'Phone Number': '+1 612 555 0101', service: 'Laptop pickup', utm_campaign: 'fall-ads', gclid: 'abc123', page: 'https://recycle.example.com/contact' })
      .expect(200)
    expect(r.body).toEqual({ ok: true })
    expect(r.headers['access-control-allow-origin']).toBe('https://recycle.example.com')
    const lead = await prisma.lead.findFirstOrThrow({ where: { businessId: bizId, email: 'ada@example.com' } })
    expect(lead).toMatchObject({ name: 'Ada Lovelace', phone: '+1 612 555 0101', source: 'FORM', status: 'NEW', utmCampaign: 'fall-ads', gclid: 'abc123', assigneeId: null })
    expect(lead.message).toContain('service: Laptop pickup')
    expect((await notes(manager)).at(-1)).toMatchObject({ type: 'LEAD_NEW', link: `/app/leads/${lead.id}` })
    expect(await notes(rep)).toHaveLength(0)

    // An ordinary HTML form, sent back to the site's thank-you page.
    const f = await request(app).post(`/api/lead-in/${formKey}`).type('form')
      .send({ name: 'Grace Hopper', email: 'grace@example.com', message: 'Need 40 servers recycled', _redirect: 'https://recycle.example.com/thanks' })
      .expect(303)
    expect(f.headers.location).toBe('https://recycle.example.com/thanks')
    // Never to another site.
    await request(app).post(`/api/lead-in/${formKey}`).type('form').send({ email: 'x@example.com', _redirect: 'https://evil.example.net/' }).expect(200)
  })

  it('bots, empty forms and unknown keys get nothing in', async () => {
    const before = await prisma.lead.count({ where: { businessId: bizId } })
    await request(app).post(`/api/lead-in/${formKey}`).send({ email: 'bot@spam.example', _hp: 'http://spam' }).expect(200)
    await request(app).post(`/api/lead-in/${formKey}`).send({ comment: 'hi' }).expect(422)
    await request(app).post('/api/lead-in/lf_notarealkey123456').send({ email: 'a@b.example' }).expect(404)
    await request(app).get(`/api/lead-in/${formKey}`).expect(405)
    expect(await prisma.lead.count({ where: { businessId: bizId } })).toBe(before)
  })

  it('the same person again folds into their open lead', async () => {
    await request(app).post(`/api/lead-in/${formKey}`).send({ email: 'ada@example.com', message: 'Any update?' }).expect(200)
    const ada = await prisma.lead.findMany({ where: { businessId: bizId, email: 'ada@example.com' }, include: { events: true } })
    expect(ada).toHaveLength(1)
    expect(ada[0].repeats).toBe(1)
    expect(ada[0].events.some((e) => e.kind === 'REPEAT' && e.text.includes('Any update?'))).toBe(true)
  })

  it('managers see the whole business; reps only what they are given; others nothing', async () => {
    const m = (await api(manager).get('/?status=open').expect(200)).body
    expect(m.total).toBe(3)
    expect(m.counts.unassigned).toBe(3)
    expect((await api(rep).get('/').expect(200)).body.total).toBe(0)
    expect((await api(outsider).get('/').expect(200)).body.total).toBe(0)
    const id = m.leads[0].id
    await api(rep).get(`/${id}`).expect(404)
    await api(outsider).get(`/${id}`).expect(404)
  })

  it('only a manager assigns, and only to people of the business; the rep hears of it', async () => {
    const ada = await prisma.lead.findFirstOrThrow({ where: { email: 'ada@example.com' } })
    // Before it is theirs a rep cannot even see it.
    await api(rep).post(`/${ada.id}/assign`, { assigneeId: rep.id }).expect(404)
    await api(manager).post(`/${ada.id}/assign`, { assigneeId: outsider.id }).expect(422)
    await api(manager).post(`/${ada.id}/assign`, { assigneeId: rep.id }).expect(200)
    expect((await notes(rep)).at(-1)).toMatchObject({ type: 'LEAD_ASSIGNED', title: 'New lead for you: Ada Lovelace' })
    const mine = (await api(rep).get('/?assignee=me').expect(200)).body
    expect(mine.leads.map((l: { id: string }) => l.id)).toEqual([ada.id])
    const one = (await api(rep).get(`/${ada.id}`).expect(200)).body
    expect(one.can.manage).toBe(false)
    expect(one.lead.events.find((e: { kind: string }) => e.kind === 'ASSIGNED').toName).toBe('rafi rep')
  })

  it('a logged call counts as contact and moves New to Contacted; status changes are kept', async () => {
    const ada = await prisma.lead.findFirstOrThrow({ where: { email: 'ada@example.com' } })
    await api(rep).post(`/${ada.id}/events`, { kind: 'NOTE', text: '' }).expect(422)
    await api(rep).post(`/${ada.id}/events`, { kind: 'CALL', text: 'Left a voicemail' }).expect(201)
    let l = await prisma.lead.findUniqueOrThrow({ where: { id: ada.id } })
    expect(l.status).toBe('CONTACTED')
    expect(l.firstContactAt).not.toBeNull()
    await api(rep).patch(`/${ada.id}`, { status: 'WON', value: 4500 }).expect(200)
    await api(rep).patch(`/${ada.id}`, { email: 'not an email' }).expect(422)
    l = await prisma.lead.findUniqueOrThrow({ where: { id: ada.id } })
    expect(l).toMatchObject({ status: 'WON', value: 4500 })
  })

  it('a rep adds a phone lead for themselves; only managers give leads to others', async () => {
    const r = (await api(rep2).post('/', { businessId: bizId, name: 'Walk-in Caller', phone: '612 555 0199', message: 'Called about e-waste' }).expect(201)).body.lead
    expect(r).toMatchObject({ source: 'PHONE', assigneeId: rep2.id })
    await api(rep2).post('/', { businessId: bizId, name: 'X', phone: '1', assignTo: rep.id }).expect(403)
    await api(rep2).post('/', { businessId: otherBizId, name: 'X', phone: '1' }).expect(403)
    await api(rep2).post('/', { businessId: bizId }).expect(422)
  })

  it('a sheet of leads comes in once (open duplicates are skipped); the importer gets no alert of their own', async () => {
    const body = {
      businessId: bizId, fileName: 'expo.csv', headers: ['Full Name', 'E-mail', 'Tel', 'Firm'], mapping: { name: 'Full Name', email: 'E-mail', phone: 'Tel', organization: 'Firm' },
      rows: [['Alan Turing', 'alan@example.com', '', 'Bletchley'], ['', '', '', ''], ['Grace again', 'grace@example.com', '', ''], ['Linus', 'linus@example.com', '555', 'Kernel Inc']],
    }
    await api(outsider).post('/import', body).expect(403) // not in the business; a rep may import (the leads become theirs)
    const r = (await api(manager).post('/import', body).expect(200)).body
    expect(r).toEqual({ added: 2, skipped: 1, already: 1 })
    expect(await prisma.lead.count({ where: { businessId: bizId, source: 'IMPORT' } })).toBe(2)
    expect((await notes(manager)).some((n) => n.title.includes('imported'))).toBe(false)
    const csv = await api(manager).get('/export.csv').expect(200)
    expect(csv.text).toContain('Alan Turing')
    expect((await api(rep).get('/export.csv').expect(200)).text).not.toContain('Alan Turing') // a rep exports only their own leads
    await api(outsider).get('/export.csv').expect(403)
  })

  it('late leads raise one alert each: not assigned in time, then not contacted in time', async () => {
    const grace = await prisma.lead.findFirstOrThrow({ where: { email: 'grace@example.com' } })
    await prisma.lead.update({ where: { id: grace.id }, data: { createdAt: new Date(Date.now() - 30 * 60_000) } })
    const before = (await notes(manager)).length
    const t1 = await runAsCompany(C, () => runLeadSlaTick())
    expect(t1.unassigned).toBeGreaterThanOrEqual(1)
    expect((await notes(manager)).slice(before).some((n) => n.title === 'Not assigned yet: Grace Hopper')).toBe(true)
    const again = await runAsCompany(C, () => runLeadSlaTick())
    expect(again.unassigned).toBe(0)
    expect((await api(manager).get('/?late=1').expect(200)).body.leads.some((l: { id: string; late: string }) => l.id === grace.id && l.late === 'assign')).toBe(true)

    await api(manager).post(`/${grace.id}/assign`, { assigneeId: rep2.id }).expect(200)
    await prisma.lead.update({ where: { id: grace.id }, data: { assignedAt: new Date(Date.now() - 2 * 3600_000) } })
    const t2 = await runAsCompany(C, () => runLeadSlaTick())
    expect(t2.uncontacted).toBeGreaterThanOrEqual(1)
    expect((await notes(rep2)).some((n) => n.type === 'LEAD_SLA' && n.title === 'No contact yet: Grace Hopper')).toBe(true)
  })

  it('a rep who leaves the business hands their open leads back', async () => {
    const r = (await api(admin).del(`/businesses/${bizId}/members/${rep2.id}`).expect(200)).body
    expect(r.returned).toBeGreaterThanOrEqual(1)
    expect(await prisma.lead.count({ where: { businessId: bizId, assigneeId: rep2.id, status: { in: ['NEW', 'CONTACTED', 'QUALIFIED'] } } })).toBe(0)
    await api(admin).del(`/businesses/${bizId}`).expect(409)
    await api(admin).del(`/businesses/${otherBizId}`).expect(200)
  })

  it('the inbox password is stored encrypted and never sent back', async () => {
    await api(admin).put(`/businesses/${bizId}/inbox`, { inboxOn: true, inboxHost: null, inboxPort: 993, inboxSecure: true, inboxUser: null, inboxFolder: 'INBOX' }).expect(422)
    const r = (await api(admin).put(`/businesses/${bizId}/inbox`, { inboxOn: false, inboxHost: 'imap.example.com', inboxPort: 993, inboxSecure: true, inboxUser: 'sales@example.com', password: 'Pass-for-tests-9', inboxFolder: 'INBOX' }).expect(200)).body.business
    expect(r.inboxHasPassword).toBe(true)
    expect(JSON.stringify(r)).not.toContain('Pass-for-tests-9')
    const row = await prisma.leadBusiness.findUniqueOrThrow({ where: { id: bizId } })
    expect(row.inboxPassEnc).toMatch(/^v1:/)
    expect(row.inboxPassEnc).not.toContain('Pass-for-tests-9')
  })

  it('an AI connector works the same leads, to-dos and meetings as the person', async () => {
    const url = new URL((await request(app).post('/api/claude/keys').set(...auth(rep)).send({ name: 'My ChatGPT', client: 'chatgpt' }).expect(201)).body.connectorUrl).pathname
    const call = async (name: string, args: object) => {
      const r = await request(app).post(url).send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }).expect(200)
      const res = r.body.result as { content: { text: string }[]; isError?: boolean }
      return { isError: !!res.isError, text: res.content.map((c) => c.text).join('\n') }
    }
    const guide = await call('metriq_guide', {})
    expect(guide.text).toContain('leads_list')
    const list = await call('leads_list', { status: 'all' })
    expect(list.text).toContain('Ada Lovelace')
    expect(list.text).not.toContain('Alan Turing') // not given to this rep
    expect((await call('lead_get', { lead: 'alan@example.com' })).isError).toBe(true)
    const note = await call('lead_update', { lead: 'ada@example.com', action: 'note', text: 'Sent the certificate' })
    expect(note.isError).toBe(false)
    expect((await call('lead_get', { lead: 'ada@example.com' })).text).toContain('Sent the certificate')
    expect((await call('lead_update', { lead: 'ada@example.com', action: 'assign', assignee: 'rita rep' })).isError).toBe(true)
    const added = await call('lead_add', { name: 'Phone Caller', phone: '612 555 0177', message: 'Called from the AI' })
    expect(added.text).toContain('Lead added to Recycle Co')
    expect((await call('todo_add', { items: '- Call Ada back\n- Send quote', date: '2026-11-05' })).text).toBe('Added 2 to-dos for 2026-11-05.')
    expect((await call('todo_list', { from: '2026-11-05' })).text).toContain('Send quote')
    const meet = await call('meeting_schedule', { title: 'Quote review', start: '2030-01-15 10:00', minutes: 45, people: ['mona manager'] })
    expect(meet.isError).toBe(false)
    expect(meet.text).toContain('1 invited')
  })

  it('a switched-off business stops its form', async () => {
    await api(admin).patch(`/businesses/${bizId}`, { isActive: false }).expect(200)
    await request(app).post(`/api/lead-in/${formKey}`).send({ email: 'late@example.com' }).expect(404)
  })
})
