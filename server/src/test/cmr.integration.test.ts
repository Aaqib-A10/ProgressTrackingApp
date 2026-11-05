import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Role } from '@prisma/client'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { hashPassword } from '../lib/auth'
import { ensureHomeCompany, HOME_COMPANY_ID } from '../lib/company'
import { setCompanyFlag } from '../lib/flags'
import { runAsCompany } from '../lib/tenancy'
import { mailLog } from '../lib/mail'
import { runLeadTaskTick } from '../lib/leads/tasks'

// Lead Management like LeadWise, with the CMR flow inside it: a CMR business (head: Jesse),
// SDRs log calls with the five facts, Send info, Qualify → team lead approves → Jesse decides
// (meeting with a slot) → invite with three time zones → reconfirm + brief → outcome. Agent
// tasks are made by the flow; the daily report counts from the calls; the sheet imports; the
// lists block calls; a GENERAL business keeps the usual pipeline.

const C = 'cmr-co'
type U = { id: string; role: Role }
let w: SeededWorld
let admin: U, lead: U, jesse: U, matthew: U, mark: U, stranger: U
let cmrId = '', genId = '', acmeId = ''

beforeAll(async () => {
  w = await seedWorld()
  await ensureHomeCompany()
  await prisma.company.deleteMany({ where: { id: C } })
  await prisma.company.create({ data: { id: C, name: 'CMR Co', slug: C, plan: 'business', setupDoneAt: new Date(), timeZone: 'America/Phoenix' } })
  const dept = await prisma.department.create({ data: { companyId: C, name: 'CMR', type: 'CMR' } })
  // People in the CMR department join the CMR business by themselves, so the stranger sits elsewhere.
  const other = await prisma.department.create({ data: { companyId: C, name: 'Office', type: 'GENERAL' } })
  const passwordHash = await hashPassword('Pass-for-tests-9')
  const mk = async (name: string, role: Role, d = dept) => { const u = await prisma.user.create({ data: { companyId: C, name, email: `${name.replace(/\s/g, '.').toLowerCase()}@cmr.local.test`, role, status: 'ACTIVE', isActive: true, passwordHash, departmentId: d.id } }); return { id: u.id, role: u.role } }
  admin = await mk('Cara Admin', 'SUPER_ADMIN')
  lead = await mk('Lena Lead', 'TEAM_LEAD')
  jesse = await mk('Jesse McCullough', 'TEAM_LEAD')
  matthew = await mk('Matthew', 'MEMBER')
  mark = await mk('Mark', 'MEMBER')
  stranger = await mk('Sam Stranger', 'MEMBER', other)
  await setCompanyFlag('cmr', C, true, 'test')
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
const notes = (u: U, types: string[]) => prisma.notification.findMany({ where: { userId: u.id, type: { in: types as never[] } }, orderBy: { createdAt: 'asc' } })
const openTasks = (leadId: string) => prisma.leadTask.findMany({ where: { leadId, doneAt: null }, orderBy: { dueAt: 'asc' } })

describe('CMR flow inside Lead Management', () => {
  it('the CMR flow is switched off for 99 Technologies; a CMR business needs the switch', async () => {
    await setCompanyFlag('cmr', HOME_COMPANY_ID, false, 'test')
    await setCompanyFlag('lead-management', HOME_COMPANY_ID, true, 'test')
    await request(app).post('/api/leads/businesses').set(...auth(w.superAdmin)).send({ name: 'Nope', kind: 'CMR' }).expect(403)
    await setCompanyFlag('lead-management', HOME_COMPANY_ID, false, 'test')
  })

  it('the Super Admin makes a CMR business with Jesse as head, its SDRs and team lead; and a usual business next to it', async () => {
    const b = (await api(admin).post('/businesses', { name: 'CMR', kind: 'CMR', headId: jesse.id }).expect(201)).body.business
    cmrId = b.id
    expect(b.kind).toBe('CMR')
    expect(b.pipeline.map((s: { key: string }) => s.key)).toEqual(['NEW', 'INFO_SENT', 'FOLLOW_UP', 'QUALIFIED', 'EXISTING_CUSTOMER', 'REFERRAL_PARTNER', 'NOT_A_FIT', 'CLOSED_WON', 'CLOSED_LOST'])
    expect(b.settings.segments).toContain('HHW program')
    expect(b.settings.consentStates).toEqual(['CA', 'WA'])
    await api(admin).post(`/businesses/${cmrId}/members`, { userId: lead.id, role: 'MANAGER' }).expect(200)
    await api(admin).post(`/businesses/${cmrId}/members`, { userId: matthew.id, role: 'REP' }).expect(200)
    await api(admin).post(`/businesses/${cmrId}/members`, { userId: mark.id, role: 'REP' }).expect(200)
    // The head is a manager without being a member; a stranger sees nothing.
    const metaJ = (await api(jesse).get('/meta').expect(200)).body
    expect(metaJ.businesses.find((x: { id: string }) => x.id === cmrId)).toMatchObject({ myRole: 'MANAGER', isHead: true })
    expect((await api(stranger).get('/meta').expect(200)).body.businesses).toHaveLength(0)
    const me = (await request(app).get('/api/auth/me').set(...auth(matthew)).expect(200)).body.user
    expect(me.leadsRole).toBe('REP')
    expect(me.leadsCmr).toBe(true)
    genId = (await api(admin).post('/businesses', { name: 'Plain Co' }).expect(201)).body.business.id
    await api(admin).post(`/businesses/${genId}/members`, { userId: mark.id, role: 'REP' }).expect(200)
    // Settings and the email template: no price promises beyond the rate.
    await api(admin).patch(`/businesses/${cmrId}`, { settings: { copyEmail: 'aaqib@cmr.local.test', copyName: 'Aaqib', infoBody: 'Hi {{contact}}, we pay $0.40/lb guaranteed. {{sdr}}' } }).expect(422)
    await api(admin).patch(`/businesses/${cmrId}`, { settings: { copyEmail: 'aaqib@cmr.local.test', copyName: 'Aaqib' } }).expect(200)
    // A manager may change settings; not the name.
    await api(lead).patch(`/businesses/${cmrId}`, { settings: { connectedSecs: 20 } }).expect(200)
    await api(lead).patch(`/businesses/${cmrId}`, { name: 'Hijack' }).expect(403)
  })

  it('the Prohibited and customer lists are the pre-call check', async () => {
    const r = (await api(lead).post(`/businesses/${cmrId}/lists`, { kind: 'PROHIBITED', entries: [{ name: 'S&P Global', website: 'https://www.spglobal.com/' }] }).expect(201)).body
    expect(r.added).toBe(1)
    await api(lead).post(`/businesses/${cmrId}/lists`, { kind: 'CUSTOMER', entries: [{ name: 'KBI' }, { name: 'LRI, Inc.' }] }).expect(201)
    await api(matthew).post(`/businesses/${cmrId}/lists`, { kind: 'CUSTOMER', entries: [{ name: 'X' }] }).expect(403)
    const check = (await api(matthew).get(`/check?business=${cmrId}&organization=LRI&website=spglobal.com`).expect(200)).body
    expect(check.prohibited).toBe(true)
    expect(check.existingCustomer).toBe(true)
    // A prohibited company cannot have calls logged.
    const bad = (await api(matthew).post('/', { businessId: cmrId, organization: 'S and P Global', website: 'spglobal.com', name: 'Someone' }).expect(201)).body
    expect(bad.lead.prohibited).toBe(true)
    expect(bad.lead.warnings[0].level).toBe('stop')
    await api(matthew).post(`/${bad.lead.id}/calls`, { disposition: 'CONNECTED' }).expect(422)
  })

  it('an SDR adds a company, is warned about a duplicate, and logs the discovery call with facts and a next step', async () => {
    const r = (await api(matthew).post('/', { businessId: cmrId, organization: 'Acme Recycling', name: 'Ada', contactRole: 'Ops', phone: '(602) 555-0100', email: 'ada@acme.example', industry: 'E-waste recycler', state: 'CA' }).expect(201)).body
    acmeId = r.lead.id
    expect(r.lead).toMatchObject({ organization: 'Acme Recycling', phone: '602-555-0100', phoneE164: '+16025550100', status: 'NEW', assigneeId: matthew.id, factsDone: 0, zone: 'America/Los_Angeles' })
    expect(r.lead.warnings.some((x: { key: string }) => x.key === 'consent')).toBe(true)
    // The same company again: 409 with the existing id, unless forced.
    const dup = await api(mark).post('/', { businessId: cmrId, organization: 'ACME Recycling Inc', name: 'Bob' }).expect(409)
    expect(dup.body.duplicateId).toBe(acmeId)
    // Mark cannot see Matthew's lead; the team lead and Jesse can.
    await api(mark).get(`/${acmeId}`).expect(404)
    await api(jesse).get(`/${acmeId}`).expect(200)
    const call = (await api(matthew).post(`/${acmeId}/calls`, {
      disposition: 'CONNECTED', durationSec: 540, outcome: 'interested, wants the profile', consentGiven: true, nextStep: 'Send the info email', nextStepDate: '2030-01-10', owner: 'REP',
      facts: { handlesAlkaline: 'YES', material: ['ALKALINE_SORTED'], materialForm: ['TAPED'], lbsPerShipment: 1800, lbsPerMonth: 3000, currentVendor: 'Call2Recycle', paysUnit: 'NONE', decisionMakerName: 'Ada', dmAgreed: 'YES' },
    }).expect(201)).body
    expect(call.call.summary).toContain('Acme Recycling (Ada): interested, wants the profile.')
    expect(call.call.summary).toContain('Handles alkaline: yes.')
    expect(call.call.summary).toContain('Current vendor: Call2Recycle, pays nothing.')
    expect(call.lead).toMatchObject({ callsCount: 1, factsDone: 4, nextStep: 'Send the info email', belowMin: true })
    expect(call.lead.warnings.map((x: { key: string }) => x.key)).toEqual(expect.arrayContaining(['battery-network', 'below-min']))
    const tasks = await openTasks(acmeId)
    expect(tasks.map((t) => t.kind)).toEqual(['NEXT_STEP'])
    expect(tasks[0].title).toBe('Send the info email')
  })

  it('Send info: the template email goes out, Info Sent, follow-up in 2 business days; no price promises in the note', async () => {
    await api(matthew).post(`/${acmeId}/send-info`, { note: 'We can pay $0.30 per lb and cover freight' }).expect(422)
    const before = mailLog.length
    const r = (await api(matthew).post(`/${acmeId}/send-info`, { note: 'Good to talk today.' }).expect(200)).body
    expect(r.sentTo).toBe('ada@acme.example')
    expect(r.lead.status).toBe('INFO_SENT')
    expect(r.lead.nextStep).toBe('Follow up on the info email')
    const mail = mailLog[mailLog.length - 1]
    expect(mailLog.length).toBe(before + 1)
    expect(mail.subject).toBe('CMR alkaline battery recycling – information for Acme Recycling')
    expect(mail.text).toContain('Hi Ada,')
    expect(mail.text).toContain('$0.25/lb')
    expect(mail.text).toContain('Good to talk today.')
    expect(mail.replyTo).toBe('matthew@cmr.local.test')
    const tasks = await openTasks(acmeId)
    expect(tasks.map((t) => t.kind)).toEqual(['FOLLOW_UP'])
    const twoDays = (tasks[0].dueAt.getTime() - Date.now()) / 86400_000
    expect(twoDays).toBeGreaterThan(1)
    expect(twoDays).toBeLessThan(5)
  })

  it('a connected follow-up call moves Info Sent to Follow Up and closes the follow-up task; the fifth fact gets filled', async () => {
    const r = (await api(matthew).post(`/${acmeId}/calls`, { disposition: 'CONNECTED', durationSec: 300, outcome: 'ships from Fresno, next load in March, they book freight', consentGiven: true, facts: { pickupCity: 'Fresno', nextShipmentDate: '2030-03-01', freight: 'BOOKS' }, nextStep: 'Qualify', nextStepDate: '2030-01-12' }).expect(201)).body
    expect(r.lead.status).toBe('FOLLOW_UP')
    expect(r.lead.factsDone).toBe(5)
    expect((await openTasks(acmeId)).map((t) => t.kind)).toEqual(['NEXT_STEP'])
  })

  it('Qualify: the SDR asks, the team lead approves, Jesse is flagged and told; a lead missing facts is refused', async () => {
    const other = (await api(mark).post('/', { businessId: cmrId, organization: 'Half Facts LLC', name: 'Hal' }).expect(201)).body.lead
    await api(mark).post(`/${other.id}/qualify`, { ask: 'Approve a meeting?' }).expect(422)
    const r = (await api(matthew).post(`/${acmeId}/qualify`, { ask: 'Approve a meeting? 3,000 lb/month sorted alkaline, below the load minimum, pays nothing today.' }).expect(200)).body
    expect(r.flagged).toBe(false)
    expect(r.lead.qualifyRequestedAt).toBeTruthy()
    // The team lead got an Approve task; Jesse nothing yet.
    expect((await prisma.leadTask.findMany({ where: { leadId: acmeId, kind: 'APPROVE', doneAt: null } })).map((t) => t.assigneeId)).toContain(lead.id)
    expect(await notes(jesse, ['LEAD_REVIEW'])).toHaveLength(0)
    await api(mark).post(`/${acmeId}/approve`).expect(404)
    const a = (await api(lead).post(`/${acmeId}/approve`).expect(200)).body.lead
    expect(a).toMatchObject({ status: 'QUALIFIED', owner: 'HEAD', jesseInputNeeded: true, nextStep: 'Jesse review' })
    expect(a.waitingDays).toBe(0)
    const n = await notes(jesse, ['LEAD_REVIEW'])
    expect(n.at(-1)).toMatchObject({ title: 'Waiting on you: Acme Recycling', link: `/app/leads/${acmeId}` })
    expect((await openTasks(acmeId)).map((t) => t.kind)).toEqual(['HEAD_REVIEW'])
    // The queue shows it to Jesse (and to Matthew, his own) but not to Mark.
    expect((await api(jesse).get(`/queue?business=${cmrId}`).expect(200)).body).toMatchObject({ canDecide: true })
    expect((await api(jesse).get(`/queue?business=${cmrId}`).expect(200)).body.queue.map((l: { id: string }) => l.id)).toEqual([acmeId])
    expect((await api(mark).get(`/queue?business=${cmrId}`).expect(200)).body.queue).toHaveLength(0)
    expect((await api(matthew).get(`/queue?business=${cmrId}`).expect(200)).body).toMatchObject({ canDecide: false })
  })

  it('Jesse comments with an @mention: the SDR is notified and gets a reply task; the SDR offers slots', async () => {
    const c = (await api(jesse).post(`/${acmeId}/comments`, { body: '@Matthew ask them whether the alkaline is sorted by chemistry.', mentions: [matthew.id] }).expect(201)).body.comment
    expect(c.mentionNames).toEqual(['Matthew'])
    expect((await notes(matthew, ['MENTION'])).at(-1)).toMatchObject({ title: 'Jesse McCullough mentioned you' })
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: acmeId }, include: { cmr: true } })).cmr?.jesseComment).toContain('sorted by chemistry')
    expect((await openTasks(acmeId)).map((t) => t.kind).sort()).toEqual(['HEAD_REVIEW', 'REPLY'])
    await api(matthew).post(`/${acmeId}/comments`, { body: 'Yes, sorted and taped.' }).expect(201)
    expect((await notes(jesse, ['LEAD_COMMENT'])).at(-1)).toMatchObject({ title: 'Matthew on Acme Recycling' })
    // Only Jesse decides.
    await api(lead).post(`/${acmeId}/decide`, { action: 'DIRECTION', text: 'x' }).expect(403)
    await api(matthew).post(`/${acmeId}/slots`, { slots: ['2030-02-04T18:00:00.000Z', '2030-02-05T17:00:00.000Z'] }).expect(200)
  })

  it('Jesse approves a meeting with a slot: the SDR gets the invite task; the invite goes to the prospect, Jesse and Aaqib with three time zones', async () => {
    await api(jesse).post(`/${acmeId}/decide`, { action: 'MEETING', slot: '2030-02-06T17:00:00.000Z' }).expect(422)
    const r = (await api(jesse).post(`/${acmeId}/decide`, { action: 'MEETING', slot: '2030-02-04T18:00:00.000Z', text: 'Bring the volume numbers.' }).expect(200)).body.lead
    expect(r).toMatchObject({ jesseInputNeeded: false, jesseDecision: 'MEETING', nextStep: 'Send the Teams invite', owner: 'REP' })
    expect(r.jesseComment).toContain('Meeting approved')
    expect(r.jesseComment).toContain('(Phoenix)')
    expect((await notes(matthew, ['LEAD_DECISION'])).at(-1)?.title).toBe('Jesse approved a meeting with Acme Recycling')
    expect((await openTasks(acmeId)).map((t) => t.kind).sort()).toEqual(['REPLY', 'SEND_INVITE'])
    await api(matthew).post(`/${acmeId}/invite`, { link: 'not a link' }).expect(422)
    const before = mailLog.length
    const inv = (await api(matthew).post(`/${acmeId}/invite`, { link: 'https://teams.microsoft.com/l/meetup-join/abc', minutes: 30 }).expect(200)).body
    expect(inv.sentTo.sort()).toEqual(['aaqib@cmr.local.test', 'ada@acme.example', 'jesse.mccullough@cmr.local.test'].sort())
    expect(inv.times.line).toContain('(prospect)')
    expect(inv.times.line).toContain('(Phoenix)')
    expect(inv.times.line).toContain('(Pacific)')
    const mail = mailLog[mailLog.length - 1]
    expect(mailLog.length).toBe(before + 1)
    expect(mail.attachments?.[0]).toMatchObject({ filename: 'invite.ics' })
    const ics = Buffer.from(mail.attachments![0].content, 'base64').toString('utf8')
    expect(ics).toContain('BEGIN:VEVENT')
    expect(ics).toContain('DTSTART:20300204T180000Z')
    expect(ics).toContain('ATTENDEE;CN=Aaqib')
    expect(inv.lead).toMatchObject({ nextStep: 'Meeting', inviteSentAt: expect.any(String), meetingLink: 'https://teams.microsoft.com/l/meetup-join/abc' })
    const kinds = (await openTasks(acmeId)).map((t) => t.kind).sort()
    expect(kinds).toEqual(['OUTCOME', 'RECONFIRM', 'REPLY'])
  })

  it('the day before: reconfirm with the 3-line brief (to Jesse); within 2 days: the outcome', async () => {
    const r = (await api(matthew).post(`/${acmeId}/reconfirm`, { brief: 'Who: Ada, ops.\nWhat: sorted alkaline, 1,800 lb/load.\nAsk: rate.' }).expect(200)).body.lead
    expect(r.reconfirmedAt).toBeTruthy()
    expect(r.jesseComment).toContain('Brief:')
    expect((await notes(jesse, ['LEAD_COMMENT'])).at(-1)?.title).toBe('Brief for Acme Recycling')
    const o = (await api(matthew).post(`/${acmeId}/outcome`, { outcome: 'QUOTE_SENT', note: 'Quote at $0.22/lb sent by Jesse' }).expect(200)).body.lead
    expect(o).toMatchObject({ status: 'FOLLOW_UP', meetingOutcome: 'QUOTE_SENT', nextStep: 'Follow up on the quote' })
    expect((await openTasks(acmeId)).map((t) => t.kind).sort()).toEqual(['NEXT_STEP', 'REPLY'])
  })

  it('agent tasks: today / overdue / done, Complete with a next step, Schedule moves the date; the tick tells people once', async () => {
    const past = new Date(Date.now() - 3 * 86400_000).toISOString()
    const t = (await api(matthew).post('/tasks', { leadId: acmeId, title: 'Call about the drum count', dueAt: past, kind: 'CALL' }).expect(201)).body.task
    const overdue = (await api(matthew).get(`/tasks?tab=overdue&business=${cmrId}`).expect(200)).body
    expect(overdue.tasks.map((x: { id: string }) => x.id)).toContain(t.id)
    expect(overdue.counts.overdue).toBeGreaterThanOrEqual(1)
    // Mark sees none of Matthew's tasks; the team lead sees them all.
    expect((await api(mark).get(`/tasks?tab=all&business=${cmrId}`).expect(200)).body.tasks.map((x: { id: string }) => x.id)).not.toContain(t.id)
    expect((await api(lead).get(`/tasks?tab=all&business=${cmrId}`).expect(200)).body.tasks.map((x: { id: string }) => x.id)).toContain(t.id)
    const tick = await runAsCompany(C, () => runLeadTaskTick())
    expect(tick.due).toBeGreaterThanOrEqual(1)
    expect((await notes(matthew, ['LEAD_TASK'])).some((n) => n.title === 'Due now: Call about the drum count')).toBe(true)
    expect((await runAsCompany(C, () => runLeadTaskTick())).due).toBe(0)
    const moved = (await api(matthew).patch(`/tasks/${t.id}`, { dueAt: '2030-05-01T17:00:00.000Z' }).expect(200)).body.task
    expect(moved.dueAt).toBe('2030-05-01T17:00:00.000Z')
    await api(matthew).post(`/tasks/${t.id}/complete`, { outcome: 'Three drums', nextStep: 'Send the drum labels', nextStepDate: '2030-05-03' }).expect(200)
    await api(matthew).post(`/tasks/${t.id}/complete`, {}).expect(409)
    const l = (await api(matthew).get(`/${acmeId}`).expect(200)).body.lead
    expect(l.nextStep).toBe('Send the drum labels')
    expect(l.tasks.filter((x: { doneAt: string | null }) => !x.doneAt).map((x: { kind: string }) => x.kind).sort()).toEqual(['NEXT_STEP', 'REPLY'])
  })

  it('the list has LeadWise-style filters and the export; the dashboard and the Jesse Summary count', async () => {
    const all = (await api(lead).get(`/?business=${cmrId}&status=all`).expect(200)).body
    expect(all.total).toBeGreaterThanOrEqual(3)
    expect(all.counts).toMatchObject({ waiting: 0 })
    const ca = (await api(lead).get(`/?business=${cmrId}&status=all&state=CA&industry=E-waste%20recycler`).expect(200)).body
    expect(ca.leads.map((x: { id: string }) => x.id)).toEqual([acmeId])
    expect((await api(lead).get(`/?business=${cmrId}&status=all&q=602-555`).expect(200)).body.leads.map((x: { id: string }) => x.id)).toEqual([acmeId])
    expect((await api(lead).get(`/?business=${cmrId}&status=all&belowMin=1`).expect(200)).body.leads.map((x: { id: string }) => x.id)).toEqual([acmeId])
    expect((await api(lead).get(`/?business=${cmrId}&status=all&prohibited=1`).expect(200)).body.leads.every((x: { prohibited: boolean }) => x.prohibited)).toBe(true)
    const csv = (await api(lead).get(`/export.csv?business=${cmrId}&status=all`).expect(200)).text
    expect(csv.split('\n')[0]).toContain('Jesse Input Needed')
    expect(csv).toContain('Acme Recycling')
    await api(matthew).get(`/export.csv?business=${cmrId}`).expect(403)
    const d = (await api(lead).get(`/dashboard?business=${cmrId}&range=all`).expect(200)).body
    expect(d.cards.total).toBeGreaterThanOrEqual(3)
    expect(d.cards.prohibited).toBeGreaterThanOrEqual(1)
    expect(d.byStatus.FOLLOW_UP).toBeGreaterThanOrEqual(1)
    const s = (await api(jesse).get(`/summary?business=${cmrId}`).expect(200)).body
    expect(s.keyNumbers.total).toBeGreaterThanOrEqual(3)
    expect(s.keyNumbers.meetingsMonth).toBe(1)
    expect(s.callsBySdr.find((x: { name: string }) => x.name === 'Matthew')?.calls).toBe(2)
    expect(s.pipeline.find((x: { status: string }) => x.status === 'FOLLOW_UP')?.count).toBeGreaterThanOrEqual(1)
    await api(matthew).get(`/summary?business=${cmrId}`).expect(403)
    // Calls: Matthew his own, the team lead all; the recording route is only for those.
    expect((await api(matthew).get(`/calls?business=${cmrId}`).expect(200)).body.calls.every((c: { userId: string }) => c.userId === matthew.id)).toBe(true)
    expect((await api(lead).get(`/calls?business=${cmrId}&minSecs=400`).expect(200)).body.total).toBe(1)
  })

  it('the daily report counts dials, connected (over the cut-off), voicemails, emails and interested from the day; the team view has the review list', async () => {
    const my = (await api(matthew).get(`/report?business=${cmrId}`).expect(200)).body
    expect(my.counted).toMatchObject({ dials: 2, connected: 2, voicemails: 0, emails: 1 })
    expect(my.counted.interested).toBeGreaterThanOrEqual(1)
    await api(matthew).post(`/${acmeId}/calls`, { disposition: 'VOICEMAIL', durationSec: 10 }).expect(201)
    const r = (await api(matthew).post('/report', { business: cmrId, date: my.date, dials: 3, connected: 2, voicemails: 1, emails: 1, interested: 1, note: 'ok' }).expect(200)).body.report
    expect(r.dials).toBe(3)
    const team = (await api(lead).get(`/report/team?business=${cmrId}&date=${my.date}`).expect(200)).body
    expect(team.rows.find((x: { sdr: { id: string } }) => x.sdr.id === matthew.id)).toMatchObject({ counted: { dials: 3, voicemails: 1 }, report: { dials: 3 } })
    expect(team.rows.some((x: { sdr: { id: string } }) => x.sdr.id === lead.id)).toBe(false)
    await api(matthew).get(`/report/team?business=${cmrId}`).expect(403)
  })

  it('side exits: Existing Customer by an SDR goes to Jesse to confirm; Jesse closes with a reason; a manager reopens', async () => {
    const l = (await api(mark).post('/', { businessId: cmrId, organization: 'Known Buyer', name: 'Kay' }).expect(201)).body.lead
    const c = (await api(mark).post(`/${l.id}/close`, { status: 'EXISTING_CUSTOMER', reason: 'EXISTING_CUSTOMER', note: 'They said they already sell to CMR' }).expect(200)).body.lead
    expect(c).toMatchObject({ status: 'EXISTING_CUSTOMER', jesseInputNeeded: true, owner: 'HEAD' })
    const dec = (await api(jesse).post(`/${l.id}/decide`, { action: 'CLOSE', status: 'EXISTING_CUSTOMER', reason: 'EXISTING_CUSTOMER', text: 'Yes, since 2024.' }).expect(200)).body.lead
    expect(dec).toMatchObject({ jesseInputNeeded: false, status: 'EXISTING_CUSTOMER', lostReason: 'EXISTING_CUSTOMER' })
    await api(mark).post(`/${l.id}/reopen`).expect(403)
    expect((await api(lead).post(`/${l.id}/reopen`).expect(200)).body.lead.status).toBe('FOLLOW_UP')
    // Statuses: QUALIFIED only through Qualify; CLOSED_WON only by a manager; unknown refused.
    await api(mark).patch(`/${l.id}`, { status: 'QUALIFIED' }).expect(422)
    await api(mark).patch(`/${l.id}`, { status: 'CLOSED_WON' }).expect(403)
    await api(mark).patch(`/${l.id}`, { status: 'WON' }).expect(422)
  })

  it('the CMR_Lead_Tracker sheet imports: one lead per company, a call per row, the Lists words, problems listed', async () => {
    const headers = ['Date', 'SDR', 'Company', 'Segment', 'State', 'Contact', 'Role', 'Decision Maker', 'Phone', 'Email', 'Website', 'Handles Alkaline', 'Est. Volume (lbs/month)', 'Current Vendor', 'Pays Today', 'Status', 'Call Summary', 'Next Step', 'Next Step Date', 'Owner', 'Jesse Input Needed', 'Jesse Comment']
    const rows = [
      ['10/20/2026', 'Matthew', 'Desert HHW', 'HHW program', 'AZ', 'Dan', 'Manager', 'Yes', '480-555-0101', 'dan@deserthhw.example', 'deserthhw.example', 'Yes', '4000', 'Battery Solutions', '0.08', 'Info Sent', 'Collects alkaline from 3 sites. Sent profile.', 'Follow up', '10/22/2026', 'SDR', 'No', ''],
      ['10/24/2026', 'Matthew', 'Desert HHW', 'HHW program', 'AZ', 'Dan', 'Manager', 'Yes', '480-555-0101', '', '', 'Yes', '4500', 'Battery Solutions', '0.08', 'Qualified', 'Wants a rate; ships monthly from Mesa.', 'Jesse review', '10/27/2026', 'Jesse', 'Yes', 'Approve a meeting next week.'],
      ['10/21/2026', 'Mark', 'Metro Transit', 'Transit', 'TX', 'Tia', '', 'Unknown', '(214) 555-0102', 'tia@metro.example', '', 'No', '', '', '', 'Not a Fit', 'Only lead acid from buses.', '', '', 'SDR', 'No', ''],
      ['10/22/2026', 'Marvin', 'Bad Rows Co', 'Unknown segment', 'NV', 'Bo', '', '', '', '', '', '', '', '', '', 'Maybe', '', '', '', 'SDR', '', ''],
      // Cells the way the real sheet writes them: a volume range, "Nothing" for the fee, two emails, four phones, a trailing newline in the name.
      ['10/19/2026', 'Matthew', 'Integritrade LLC \n', 'E-waste recycler', 'CA', 'Ian Ziyer', 'Owner', 'Yes', '888-694-4978 / 972-427-7770 / 903-217-8090', 'info@integritrade.example\nian@integritrade.example', 'integritrade.example', 'Yes', '1,500-2,000 (growing)', 'Unnamed downstream (NDA)', 'Nothing (no charge, no rebate)', 'Follow Up', 'Owner on the call.', 'Get the start date.', '10/24/2026', 'SDR', 'No', ''],
      ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ]
    await api(matthew).post('/import-sheet', { businessId: cmrId, headers, rows }).expect(403)
    const r = (await api(lead).post('/import-sheet', { businessId: cmrId, fileName: 'CMR_Lead_Tracker.csv', headers, rows }).expect(200)).body
    expect(r).toMatchObject({ companies: 4, calls: 5, skipped: 1 })
    const integ = await prisma.lead.findFirstOrThrow({ where: { businessId: cmrId, organization: 'Integritrade LLC' }, include: { cmr: true } })
    expect(integ).toMatchObject({ phone: '888-694-4978', phoneE164: '+18886944978', email: 'info@integritrade.example', orgKey: 'integritrade' })
    expect(integ.cmr).toMatchObject({ lbsPerMonth: 1500, paysToday: 0, paysUnit: 'NONE' })
    expect(r.problems.some((p: string) => p.includes('"Marvin"'))).toBe(true)
    expect(r.problems.some((p: string) => p.includes('"Maybe"'))).toBe(true)
    const desert = await prisma.lead.findFirstOrThrow({ where: { businessId: cmrId, organization: 'Desert HHW' }, include: { cmr: true, calls: true, comments: true } })
    expect(desert).toMatchObject({ status: 'QUALIFIED', assigneeId: matthew.id, phone: '480-555-0101', email: 'dan@deserthhw.example', owner: 'HEAD', callsCount: 2 })
    expect(desert.cmr).toMatchObject({ handlesAlkaline: 'YES', lbsPerMonth: 4500, paysToday: 0.08, paysUnit: 'LB', jesseInputNeeded: true, jesseComment: 'Approve a meeting next week.' })
    expect(desert.calls).toHaveLength(2)
    expect(desert.comments[0]).toMatchObject({ userId: jesse.id, body: 'Approve a meeting next week.' })
    expect((await api(jesse).get(`/queue?business=${cmrId}`).expect(200)).body.queue.map((l: { organization: string }) => l.organization)).toContain('Desert HHW')
    const transit = await prisma.lead.findFirstOrThrow({ where: { businessId: cmrId, organization: 'Metro Transit' } })
    expect(transit).toMatchObject({ status: 'NOT_A_FIT', assigneeId: mark.id, state: 'TX', nextStep: null })

    // The same sheet again adds nothing (no second call, no second comment); a row whose SDR was not a member before now gets them.
    await prisma.leadBusinessMember.create({ data: { businessId: cmrId, userId: stranger.id, role: 'REP' } })
    const rows2 = rows.map((r) => (r[1] === 'Marvin' ? r.map((c, i) => (i === 1 ? 'Sam' : c)) : r))
    const again = (await api(lead).post('/import-sheet', { businessId: cmrId, fileName: 'CMR_Lead_Tracker.csv', headers, rows: rows2 }).expect(200)).body
    expect(again).toMatchObject({ companies: 0, calls: 0, alreadyThere: 5, totalCompanies: r.totalCompanies })
    const desert2 = await prisma.lead.findFirstOrThrow({ where: { id: desert.id }, include: { calls: true, comments: true } })
    expect(desert2.calls).toHaveLength(2)
    expect(desert2.comments).toHaveLength(1)
    const bad = await prisma.lead.findFirstOrThrow({ where: { businessId: cmrId, organization: 'Bad Rows Co' }, include: { calls: true } })
    expect(bad.assigneeId).toBe(stranger.id)
    expect(bad.calls[0].userId).toBe(stranger.id)
    await prisma.leadBusinessMember.delete({ where: { businessId_userId: { businessId: cmrId, userId: stranger.id } } })
  })

  it('bulk assign: several leads to one rep at once, their open tasks and SDR-less calls follow; reps may not', async () => {
    const ids = (await prisma.lead.findMany({ where: { businessId: cmrId, organization: { in: ['Desert HHW', 'Metro Transit', 'Integritrade LLC'] } }, select: { id: true } })).map((x) => x.id)
    await api(mark).post('/bulk-assign', { ids, assigneeId: matthew.id }).expect(403)
    await api(lead).post('/bulk-assign', { ids, assigneeId: 'nobody-here' }).expect(422)
    const r = (await api(lead).post('/bulk-assign', { ids, assigneeId: matthew.id }).expect(200)).body
    expect(r.assigned).toBe(1) // Desert HHW and Integritrade were Matthew's already
    const after = await prisma.lead.findMany({ where: { id: { in: ids } }, select: { assigneeId: true, tasks: { where: { doneAt: null }, select: { assigneeId: true } } } })
    expect(after.every((l) => l.assigneeId === matthew.id)).toBe(true)
    expect(after.flatMap((l) => l.tasks).every((t) => t.assigneeId === matthew.id)).toBe(true)
    expect((await api(lead).post('/bulk-assign', { ids, assigneeId: null }).expect(200)).body.assigned).toBe(3)
  })

  it('a usual business keeps the usual pipeline: a call moves New to Contacted, no CMR actions, LeadWise details still there', async () => {
    const l = (await api(mark).post('/', { businessId: genId, name: 'Grace', organization: 'Plain Buyer', phone: '555-0199', jobTitle: 'Buyer', employees: '50', industry: 'Retail', street: '1 Main St', city: 'Austin', state: 'TX', zip: '78701', country: 'US', tags: ['hot', 'q4'], productInfo: '40 laptops' }).expect(201)).body.lead
    expect(l).toMatchObject({ status: 'NEW', jobTitle: 'Buyer', tags: ['hot', 'q4'], facts: [] })
    expect(l.handlesAlkaline).toBeUndefined()
    const c = (await api(mark).post(`/${l.id}/calls`, { disposition: 'CONNECTED', durationSec: 120, outcome: 'Wants a quote', nextStep: 'Send quote', nextStepDate: '2030-01-05' }).expect(201)).body
    expect(c.lead.status).toBe('CONTACTED')
    expect(c.call.summary).toBe('Wants a quote')
    await api(mark).post(`/${l.id}/send-info`).expect(422)
    await api(mark).post(`/${l.id}/qualify`, { ask: 'x' }).expect(422)
    expect((await api(mark).patch(`/${l.id}`, { status: 'QUALIFIED' }).expect(200)).body.lead.status).toBe('QUALIFIED')
    expect((await api(mark).get(`/?business=${genId}&status=open&tag=hot`).expect(200)).body.leads.map((x: { id: string }) => x.id)).toEqual([l.id])
    expect((await api(mark).post(`/${l.id}/close`, { status: 'LOST', reason: 'Price', note: 'Went elsewhere' }).expect(200)).body.lead).toMatchObject({ status: 'LOST', lostReason: 'Price' })
    // Across both businesses: Mark's list spans them.
    expect((await api(mark).get('/?status=all').expect(200)).body.leads.some((x: { businessId: string }) => x.businessId === genId)).toBe(true)
  })
})
