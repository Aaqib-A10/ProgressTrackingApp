import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Role } from '@prisma/client'
import { app, auth, prisma, seedWorld } from './helpers'
import { hashPassword } from '../lib/auth'
import { ensureHomeCompany } from '../lib/company'
import { setCompanyFlag } from '../lib/flags'
import { runTalkLoopSync, e164Of, dispositionOf } from '../lib/talkloop/sync'
import { useTalkLoopClientForTests, type TalkLoopCdr, type TalkLoopClient, type TalkLoopUser } from '../lib/talkloop/client'

// TalkLoop call sync: the phone system's call log lands on the leads by phone number, with the
// recording streamed through Metriq and the transcript picked up later. Stub client, no network.

const C = 'tl-co'
type U = { id: string; role: Role }
let admin: U, lead: U, mark: U
let bizId = '', acmeId = '', calId = ''

const TL_USERS: TalkLoopUser[] = [
  { id: 335, name: 'mark', email: 'mark@tl.local.test', role: 'agent', extension_id: '1001-cmr.talkloop.ai', registration_status: 'active' },
  { id: 336, name: 'mathew', email: 'other@tl.local.test', role: 'agent', extension_id: '1000-cmr.talkloop.ai', registration_status: 'active' },
]
const cdr = (o: Partial<TalkLoopCdr> & { uniqueid: string }): TalkLoopCdr => ({ calldate: new Date(Date.now() - 10 * 60_000).toISOString(), src: '+16025550100', dst: '6025550199', direction: 'outgoing', disposition: 'ANSWERED', duration: 70, billsec: 65, recording_file: `20261105/out-${o.uniqueid}.wav`, user_id: 335, user: { name: 'mark', extension_id: '1001-cmr.talkloop.ai' }, ...o })
let records: TalkLoopCdr[] = []
let transcripts: Record<string, string> = {}
const stub: TalkLoopClient = {
  users: async () => TL_USERS,
  cdrs: async (q) => ({ records: records.filter((c) => c.calldate >= q.startDate && c.calldate <= q.endDate), totalPages: 1 }), // like the real API: only the window asked for
  transcription: async (id) => transcripts[id] ?? null,
  recording: async (id, range) => new Response(`AUDIO-${id}`.slice(0, range ? 4 : undefined), { status: range ? 206 : 200, headers: { 'content-type': 'audio/wav', ...(range ? { 'content-range': 'bytes 0-3/11' } : {}) } }),
}

beforeAll(async () => {
  await seedWorld()
  await ensureHomeCompany()
  await prisma.company.deleteMany({ where: { id: C } })
  await prisma.company.create({ data: { id: C, name: 'TL Co', slug: C, plan: 'business', setupDoneAt: new Date(), timeZone: 'America/Phoenix' } })
  const passwordHash = await hashPassword('Pass-for-tests-9')
  const mk = async (name: string, email: string, role: Role) => { const u = await prisma.user.create({ data: { companyId: C, name, email, role, status: 'ACTIVE', isActive: true, passwordHash } }); return { id: u.id, role: u.role } }
  admin = await mk('Tia Admin', 'tia@tl.local.test', 'SUPER_ADMIN')
  lead = await mk('Lena Lead', 'lena@tl.local.test', 'TEAM_LEAD')
  mark = await mk('Mark Patel', 'mark@tl.local.test', 'MEMBER')
  await setCompanyFlag('cmr', C, true, 'test')
  await setCompanyFlag('lead-management', C, true, 'test')
  await prisma.platformSetting.deleteMany({ where: { key: 'talkloop-sync' } })
  useTalkLoopClientForTests(stub)
})
afterAll(async () => {
  useTalkLoopClientForTests(null)
  await prisma.platformSetting.deleteMany({ where: { key: 'talkloop-sync' } })
  await prisma.company.deleteMany({ where: { id: C } })
  await prisma.$disconnect()
})
const api = (u: U) => ({
  get: (p: string) => request(app).get(`/api/leads${p}`).set(...auth(u)),
  post: (p: string, b: object = {}) => request(app).post(`/api/leads${p}`).set(...auth(u)).send(b),
  patch: (p: string, b: object) => request(app).patch(`/api/leads${p}`).set(...auth(u)).send(b),
})

describe('TalkLoop call sync', () => {
  it('numbers and words', () => {
    expect(e164Of('6312420300')).toBe('+16312420300')
    expect(e164Of('+16312420300')).toBe('+16312420300')
    expect(e164Of('16312420300')).toBe('+16312420300')
    expect(e164Of('1001')).toBeNull()
    expect(dispositionOf(cdr({ uniqueid: 'x', billsec: 65 }), 30)).toBe('CONNECTED')
    expect(dispositionOf(cdr({ uniqueid: 'x', billsec: 12 }), 30)).toBe('VOICEMAIL')
    expect(dispositionOf(cdr({ uniqueid: 'x', disposition: 'NO ANSWER', billsec: 0 }), 30)).toBe('NO_ANSWER')
    expect(dispositionOf(cdr({ uniqueid: 'x', disposition: 'BUSY' }), 30)).toBe('BUSY')
  })

  it('the Super Admin links people to TalkLoop users (by email, or by hand); the token never reaches the browser', async () => {
    const b = (await api(admin).post('/businesses', { name: 'CMR', kind: 'CMR' }).expect(201)).body.business
    bizId = b.id
    await api(admin).post(`/businesses/${bizId}/members`, { userId: lead.id, role: 'MANAGER' }).expect(200)
    await api(admin).post(`/businesses/${bizId}/members`, { userId: mark.id, role: 'REP' }).expect(200)
    acmeId = (await api(lead).post('/', { businessId: bizId, organization: 'Acme Recycling', name: 'Ada', phone: '(602) 555-0199', state: 'AZ', assignTo: mark.id, force: true }).expect(201)).body.lead.id
    calId = (await api(lead).post('/', { businessId: bizId, organization: 'Cal Battery', name: 'Cal', phone: '559-555-0123', state: 'CA', assignTo: mark.id, force: true }).expect(201)).body.lead.id
    await api(mark).get('/talkloop').expect(403)
    const info = (await api(admin).get('/talkloop').expect(200)).body
    expect(info.configured).toBe(true)
    expect(info.talkloopUsers.map((u: { id: number; extension: string }) => [u.id, u.extension])).toEqual([[335, '1001'], [336, '1000']])
    expect(JSON.stringify(info)).not.toMatch(/password|token/i)
    // Auto: Mark's email matches; nobody else does.
    expect((await api(admin).patch('/talkloop/link', { auto: true }).expect(200)).body.linked).toBe(1)
    expect(await prisma.user.findUnique({ where: { id: mark.id }, select: { talkloopUserId: true, talkloopExt: true } })).toEqual({ talkloopUserId: 335, talkloopExt: '1001' })
    // By hand: a TalkLoop user already taken is refused; unlinking and relinking works.
    await api(admin).patch('/talkloop/link', { userId: lead.id, talkloopUserId: 335 }).expect(409)
    await api(admin).patch('/talkloop/link', { userId: lead.id, talkloopUserId: 336 }).expect(200)
    await api(admin).patch('/talkloop/link', { userId: lead.id, talkloopUserId: null }).expect(200)
    await api(admin).patch('/talkloop/link', { userId: lead.id, talkloopUserId: 999 }).expect(422)
  })

  it("Mark's calls land on his leads: who, when, how long, answered or voicemail, recording and transcript; CA waits for consent; nothing twice", async () => {
    records = [
      cdr({ uniqueid: 'u1', dst: '6025550199', billsec: 65 }),                                       // Acme, connected
      cdr({ uniqueid: 'u2', dst: '5595550123', billsec: 10, calldate: new Date(Date.now() - 20 * 60_000).toISOString() }), // Cal Battery, short: voicemail; CA: consent needed
      cdr({ uniqueid: 'u3', dst: '2145550000', disposition: 'NO ANSWER', billsec: 0, recording_file: null }), // nobody has this number
      cdr({ uniqueid: 'u4', src: '6025550199', dst: '1001-cmr.talkloop.ai', direction: 'incoming', billsec: 40, recording_file: 'in-grp.wav' }), // Acme called back: Mark answered…
      cdr({ uniqueid: 'u4b', src: '6025550199', dst: '1000-cmr.talkloop.ai', direction: 'incoming', disposition: 'NO ANSWER', billsec: 0, user_id: 336, recording_file: 'in-grp.wav' }), // …the other extension's leg is the same call
      cdr({ uniqueid: 'u5', user_id: 336, dst: '6025550199' }),                                      // a TalkLoop user nobody is linked to
      cdr({ uniqueid: 'u6', user_id: null, dst: '6001-cmr.talkloop.ai', direction: 'incoming' }),   // ring group leg
    ]
    transcripts = { u1: 'Hi, this is Mark with CMR…' }
    const st = await runTalkLoopSync(stub)
    expect(st).toMatchObject({ lastRunSynced: 3, lastRunUnmatched: 1, lastError: null })
    const acme = await prisma.lead.findUniqueOrThrow({ where: { id: acmeId }, include: { calls: { orderBy: { at: 'asc' } }, events: true } })
    expect(acme.callsCount).toBe(2)
    expect(acme.calls.map((c) => [c.direction, c.disposition, c.durationSec, c.userId, c.provider, c.recordingKept])).toEqual([['OUT', 'CONNECTED', 65, mark.id, 'TALKLOOP', true], ['IN', 'CONNECTED', 40, mark.id, 'TALKLOOP', true]])
    expect(acme.calls[0].transcript).toBe('Hi, this is Mark with CMR…')
    expect(acme.status).toBe('NEW') // the CMR flow waits for the SDR's summary
    expect(acme.events.some((e) => e.kind === 'CALL' && /TalkLoop/.test(e.text))).toBe(true)
    const cal = await prisma.lead.findUniqueOrThrow({ where: { id: calId }, include: { calls: true } })
    expect(cal.calls[0]).toMatchObject({ disposition: 'VOICEMAIL', recordingKept: false, consentGiven: false })
    // Again: nothing doubles.
    const again = await runTalkLoopSync(stub)
    expect(again.lastRunSynced).toBe(0)
    expect(await prisma.leadCall.count({ where: { provider: 'TALKLOOP' } })).toBe(3)
    // Someone linked later still gets their week: "Sync now" re-reads it and files u5 (made two days ago).
    records = records.map((c) => (c.uniqueid === 'u5' ? { ...c, calldate: new Date(Date.now() - 2 * 86400_000).toISOString() } : c))
    await api(admin).patch('/talkloop/link', { userId: lead.id, talkloopUserId: 336 }).expect(200)
    expect((await runTalkLoopSync(stub)).lastRunSynced).toBe(0) // the cron only reads what is new
    expect((await api(admin).post('/talkloop/sync').expect(200)).body.status.lastRunSynced).toBe(1)
    expect(await prisma.leadCall.count({ where: { provider: 'TALKLOOP', userId: lead.id } })).toBe(1)
    await api(admin).patch('/talkloop/link', { userId: lead.id, talkloopUserId: null }).expect(200)
  })

  it('the recording streams through Metriq (with Range) for the SDR, the manager and the admin; a CA recording opens once consent is ticked', async () => {
    const acme = (await api(mark).get(`/${acmeId}`).expect(200)).body
    const call = acme.lead.calls.find((c: { externalId: string }) => c.externalId === 'u1')
    expect(call.hasRecording).toBe(true)
    expect(call.recordingUrl).toBe(`/api/leads/calls/${call.id}/recording`)
    expect(call.transcript).toContain('Mark with CMR')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bytes = ((res: any, cb: (err: Error | null, body: Buffer) => void) => { const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))) }) as unknown as (res: import('superagent').Response, cb: (err: Error | null, body: unknown) => void) => void
    const r = await request(app).get(call.recordingUrl).set(...auth(mark)).buffer(true).parse(bytes).expect(200)
    expect(r.headers['content-type']).toBe('audio/wav')
    expect((r.body as Buffer).toString()).toBe('AUDIO-u1')
    const part = await request(app).get(call.recordingUrl).set(...auth(mark)).set('Range', 'bytes=0-3').buffer(true).parse(bytes).expect(206)
    expect(part.headers['content-range']).toBe('bytes 0-3/11')
    expect((part.body as Buffer).toString()).toBe('AUDI')
    await request(app).get(call.recordingUrl).set(...auth(lead)).expect(200)
    await request(app).get(call.recordingUrl).set(...auth(admin)).expect(200)
    expect((await prisma.leadEvent.count({ where: { leadId: acmeId, kind: 'LISTEN' } }))).toBe(4) // a play from the start counts (browsers ask bytes=0-), a seek further in would not
    // CA: locked until consent.
    const cal = (await api(mark).get(`/${calId}`).expect(200)).body
    const locked = cal.lead.calls[0]
    expect(locked.hasRecording).toBe(false)
    await request(app).get(`/api/leads/calls/${locked.id}/recording`).set(...auth(mark)).expect(404)
    const ok = (await api(mark).patch(`/calls/${locked.id}`, { consentGiven: true }).expect(200)).body.call
    expect(ok).toMatchObject({ consentGiven: true, recordingKept: true, hasRecording: true })
    await request(app).get(`/api/leads/calls/${locked.id}/recording`).set(...auth(mark)).expect(200)
    // Someone outside the business: not found.
    await request(app).get(call.recordingUrl).set(...auth({ id: (await prisma.user.findFirstOrThrow({ where: { companyId: C, name: 'Tia Admin' } })).id, role: 'SUPER_ADMIN' })).expect(200)
  })

  it('a call to a number no lead has is kept aside; "Add as lead" or "Attach" moves it under the lead, and a lead added later takes its calls on the next run', async () => {
    // u3 (214-555-0000, nobody answered) was kept by the first run: Mark sees his own, the manager and the admin too.
    const mine = (await api(mark).get('/unmatched').expect(200)).body
    expect(mine.numbers).toHaveLength(1)
    expect(mine.numbers[0]).toMatchObject({ phone: '+12145550000', calls: 1, connected: 0 })
    expect(mine.numbers[0].items[0]).toMatchObject({ disposition: 'NO_ANSWER', recordingUrl: null, user: { id: mark.id } })
    expect((await api(lead).get('/unmatched').expect(200)).body.total).toBe(1)
    expect((await api(admin).get('/unmatched').expect(200)).body.total).toBe(1)
    // Add as lead: the SDR adds the company with that number, then the kept call moves under it.
    const dallas = (await api(mark).post('/', { businessId: bizId, organization: 'Dallas Metals', phone: '214-555-0000', state: 'TX', force: true }).expect(201)).body.lead.id
    const moved = (await api(mark).post('/unmatched/attach', { phone: '+12145550000', leadId: dallas }).expect(200)).body
    expect(moved.moved).toBe(1)
    const d = await prisma.lead.findUniqueOrThrow({ where: { id: dallas }, include: { calls: true, events: true } })
    expect(d.callsCount).toBe(1)
    expect(d.calls[0]).toMatchObject({ provider: 'TALKLOOP', externalId: 'u3', disposition: 'NO_ANSWER', userId: mark.id })
    expect(d.events.some((e) => /earlier TalkLoop call/.test(e.text))).toBe(true)
    expect((await api(mark).get('/unmatched').expect(200)).body.total).toBe(0)
    await api(mark).post('/unmatched/attach', { phone: '+12145550000', leadId: dallas }).expect(404) // nothing left to move
    // Two more calls to a new number, with a recording on the answered one; the manager attaches them to a lead already here.
    records = [cdr({ uniqueid: 'u8', dst: '4805550111', billsec: 90 }), cdr({ uniqueid: 'u9', dst: '4805550111', disposition: 'NO ANSWER', billsec: 0, recording_file: null, calldate: new Date(Date.now() - 5 * 60_000).toISOString() })]
    expect((await runTalkLoopSync(stub)).lastRunUnmatched).toBe(2)
    const kept = (await api(lead).get('/unmatched').expect(200)).body.numbers[0]
    expect(kept).toMatchObject({ phone: '+14805550111', calls: 2, connected: 1 })
    const rec = kept.items.find((c: { id: string; recordingUrl: string | null }) => c.recordingUrl)
    expect(rec.recordingUrl).toBe(`/api/leads/unmatched/${rec.id}/recording`)
    const audio = await request(app).get(rec.recordingUrl).set(...auth(lead)).buffer(true).parse((res, cb) => { const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))) }).expect(200)
    expect(audio.body.toString()).toBe('AUDIO-u8')
    await request(app).get(rec.recordingUrl).set(...auth(mark)).expect(200) // his own call
    expect((await api(lead).post('/unmatched/attach', { phone: '+14805550111', leadId: acmeId }).expect(200)).body.moved).toBe(2)
    const acme = await prisma.lead.findUniqueOrThrow({ where: { id: acmeId }, include: { calls: { where: { externalId: { in: ['u8', 'u9'] } } } } })
    expect(acme.calls.map((c) => [c.externalId, c.disposition, c.recordingUrl]).sort()).toEqual([['u8', 'CONNECTED', 'talkloop:u8'], ['u9', 'NO_ANSWER', null]])
    expect(acme.phoneE164).toBe('+16025550199') // the lead keeps its own number
    // A lead added after the call (an import, say) takes the kept calls on the next run, with nobody clicking.
    records = [cdr({ uniqueid: 'u10', dst: '5205550222', billsec: 40 })]
    expect((await runTalkLoopSync(stub)).lastRunUnmatched).toBe(1)
    const tucson = (await api(lead).post('/', { businessId: bizId, organization: 'Tucson Scrap', phone: '520-555-0222', assignTo: mark.id, force: true }).expect(201)).body.lead.id
    const run = await runTalkLoopSync(stub)
    expect(run.lastRunSynced).toBe(1)
    expect(run.waiting).toBe(0)
    expect(await prisma.leadCall.count({ where: { leadId: tucson, externalId: 'u10' } })).toBe(1)
    records = []
  })

  it('sync now and the status (admin only)', async () => {
    await api(lead).post('/talkloop/sync').expect(403)
    const r = (await api(admin).get('/talkloop').expect(200)).body
    expect(r.status.synced).toBe(5) // 3 + the late-linked one + the one that found its lead by itself
    expect(r.people.find((p: { id: string }) => p.id === mark.id)).toMatchObject({ talkloopUserId: 335, talkloopExt: '1001' })
    records = [cdr({ uniqueid: 'u7', dst: '6025550199' })]
    expect((await api(admin).post('/talkloop/sync').expect(200)).body.status.lastRunSynced).toBe(1)
  })
})
