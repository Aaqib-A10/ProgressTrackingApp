import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Role } from '@prisma/client'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { hashPassword } from '../lib/auth'
import { setCompanyFlag, resetFlagCache } from '../lib/flags'
import { HOME_COMPANY_ID } from '../lib/company'
import { runAsCompany } from '../lib/tenancy'
import { askerOf, forgetAsker } from '../lib/metra/access'
import { searchMetriq } from '../lib/metra/search'
import { indexNow, indexSource } from '../lib/metra/indexer'
import { dropIndex } from '../lib/metra/store'
import { SOURCE_BY_TYPE } from '../lib/metra/sources'

// Metra's one rule (docs/metra/DESIGN.md §1): it can never show a person what the app would not. Real records are
// indexed (hash embedding, no model download), then each person searches; every rule of the access audit is checked.

type U = { id: string; role: Role }
let w: SeededWorld
let member2: U, bravoUser: U
let projectId = '', convId = ''
const B = 'metra-bravo-co'

const find = async (u: U, q: string, companyId = HOME_COMPANY_ID) => {
  forgetAsker(u.id)
  return runAsCompany(companyId, async () => (await searchMetriq(await askerOf(u.id), q)).map((h) => h.chunk.text).join('\n---\n'))
}

beforeAll(async () => {
  w = await seedWorld()
  await prisma.aiChunk.deleteMany({})
  await prisma.aiIndexState.deleteMany({})
  dropIndex()
  const itad = await prisma.department.findFirstOrThrow({ where: { type: 'ITAD', companyId: HOME_COMPANY_ID } })
  const passwordHash = await hashPassword('Pass-for-tests-9')
  const m2 = await prisma.user.create({ data: { name: 'Second Agent', email: 'second.agent@metra.local.test', role: 'MEMBER', status: 'ACTIVE', isActive: true, passwordHash, departmentId: itad.id } })
  member2 = { id: m2.id, role: m2.role }

  await runAsCompany(HOME_COMPANY_ID, async () => {
    // Lead Dialer: each agent's own leads and notes.
    const l1 = await prisma.dialerLead.create({ data: { ownerId: w.itadMember.id, matchKey: 'id:m1', company: 'Acme Printing', status: 'Interested', stage: 4, maxStage: 4 } })
    await prisma.dialerNote.create({ data: { leadId: l1.id, userId: w.itadMember.id, text: 'Acme wants 200 old servers recycled before March, ask for the CFO.' } })
    const l2 = await prisma.dialerLead.create({ data: { ownerId: member2.id, matchKey: 'id:m2', company: 'Birch Bank', status: 'Connected', stage: 3, maxStage: 3 } })
    await prisma.dialerNote.create({ data: { leadId: l2.id, userId: member2.id, text: 'Birch pricing is 777 per pallet, keep it confidential.' } })
    // A direct message between an ITAD member and a Lead Gen member.
    const dm = await prisma.chatConversation.create({ data: { type: 'DIRECT', directKey: `${w.itadMember.id}:${w.leadgenMember.id}`, members: { create: [{ userId: w.itadMember.id }, { userId: w.leadgenMember.id }] } } })
    convId = dm.id
    await prisma.chatMessage.create({ data: { conversationId: dm.id, seq: 1, userId: w.itadMember.id, body: 'The kangaroo budget for the offsite is approved, tell nobody yet.' } })
    // My To-Do: one private, one shared with the team lead.
    const today = new Date(new Date().toISOString().slice(0, 10))
    await prisma.workLogEntry.create({ data: { userId: w.itadMember.id, period: 'DAY', periodStart: today, title: 'Draft my salary raise request letter', private: true } })
    await prisma.workLogEntry.create({ data: { userId: w.itadMember.id, period: 'DAY', periodStart: today, title: 'Quarterly pipeline review for the ITAD team' } })
    // A project the ITAD member is in (and the Lead Gen member is not).
    const p = await prisma.pmProject.create({ data: { name: 'Falcon', key: 'FAL', ownerId: w.superAdmin.id, members: { create: [{ userId: w.itadMember.id, role: 'MEMBER' }] }, columns: { create: [{ name: 'To do', position: 1, category: 'TODO' }] } }, include: { columns: true } })
    projectId = p.id
    await prisma.pmTask.create({ data: { projectId: p.id, code: 'FAL-1', title: 'Falcon datacenter migration plan', columnId: p.columns[0].id, position: 1, createdById: w.superAdmin.id } })
  })

  // Another company with the same words.
  await prisma.company.deleteMany({ where: { id: B } })
  await prisma.company.create({ data: { id: B, name: 'Metra Bravo', slug: B, plan: 'business' } })
  const bd = await prisma.department.create({ data: { companyId: B, type: 'ITAD', name: 'Bravo ITAD' } })
  const bu = await prisma.user.create({ data: { companyId: B, name: 'Bravo Boss', email: 'boss@metra-bravo.local.test', role: 'SUPER_ADMIN', status: 'ACTIVE', isActive: true, passwordHash, departmentId: bd.id } })
  bravoUser = { id: bu.id, role: bu.role }
  await runAsCompany(B, async () => {
    const bl = await prisma.dialerLead.create({ data: { ownerId: bu.id, matchKey: 'id:b1', company: 'Acme Bravo Copy', status: 'Connected', stage: 3, maxStage: 3 } })
    await prisma.dialerNote.create({ data: { leadId: bl.id, userId: bu.id, text: 'Bravo note: Acme servers recycled at the bravo warehouse.' } })
  })

  for (const c of [HOME_COMPANY_ID, B]) await setCompanyFlag('metra', c, true, 'test')
  resetFlagCache()
  await indexNow(HOME_COMPANY_ID)
  await indexNow(B)
}, 120_000)

afterAll(async () => {
  await prisma.aiChunk.deleteMany({})
  await prisma.company.deleteMany({ where: { id: B } })
  await prisma.$disconnect()
})

describe('Metra retrieves only what the app shows each person', () => {
  it('indexes the records', async () => {
    expect(await prisma.aiChunk.count({ where: { companyId: HOME_COMPANY_ID } })).toBeGreaterThanOrEqual(7)
    expect(await prisma.aiChunk.count({ where: { companyId: B } })).toBeGreaterThanOrEqual(1)
  })

  it('Lead Dialer: an agent sees their own notes, not another agent\'s; the ITAD lead and Super Admin see both', async () => {
    expect(await find(w.itadMember, 'servers recycled CFO')).toContain('200 old servers')
    expect(await find(w.itadMember, 'Birch pricing pallet')).not.toContain('777')
    expect(await find(member2, 'Birch pricing pallet')).toContain('777')
    expect(await find(member2, 'servers recycled CFO')).not.toContain('200 old servers')
    expect(await find(w.itadLead, 'Birch pricing pallet')).toContain('777')
    expect(await find(w.superAdmin, 'servers recycled CFO')).toContain('200 old servers')
    expect(await find(w.leadgenLead, 'servers recycled CFO')).not.toContain('200 old servers')
  })

  it('direct messages: only the two people in them, never the Super Admin or a team lead', async () => {
    expect(await find(w.itadMember, 'kangaroo budget offsite')).toContain('kangaroo')
    expect(await find(w.leadgenMember, 'kangaroo budget offsite')).toContain('kangaroo')
    expect(await find(w.superAdmin, 'kangaroo budget offsite')).not.toContain('kangaroo')
    expect(await find(w.itadLead, 'kangaroo budget offsite')).not.toContain('kangaroo')
  })

  it('My To-Do: a private entry is the owner\'s alone; a shared one reaches their team lead, not other teams', async () => {
    expect(await find(w.itadMember, 'salary raise request letter')).toContain('salary raise')
    expect(await find(w.itadLead, 'salary raise request letter')).not.toContain('salary raise')
    expect(await find(w.superAdmin, 'salary raise request letter')).not.toContain('salary raise')
    expect(await find(w.itadLead, 'quarterly pipeline review')).toContain('Quarterly pipeline review')
    expect(await find(w.leadgenLead, 'quarterly pipeline review')).not.toContain('Quarterly pipeline review')
  })

  it('projects: members and Super Admins only, and leaving a project hides it at once (no re-index)', async () => {
    expect(await find(w.itadMember, 'Falcon datacenter migration')).toContain('Falcon datacenter')
    expect(await find(w.superAdmin, 'Falcon datacenter migration')).toContain('Falcon datacenter')
    expect(await find(w.leadgenMember, 'Falcon datacenter migration')).not.toContain('Falcon datacenter')
    await prisma.pmProjectMember.deleteMany({ where: { projectId, userId: w.itadMember.id } })
    expect(await find(w.itadMember, 'Falcon datacenter migration')).not.toContain('Falcon datacenter')
  })

  it('nothing crosses companies', async () => {
    expect(await find(w.superAdmin, 'bravo warehouse servers')).not.toContain('bravo warehouse')
    const bravo = await find(bravoUser, 'servers recycled CFO', B)
    expect(bravo).toContain('bravo warehouse')
    expect(bravo).not.toContain('200 old servers')
  })

  it('a deleted note leaves the index', async () => {
    const n = await prisma.dialerNote.findFirstOrThrow({ where: { userId: member2.id } })
    await prisma.dialerNote.update({ where: { id: n.id }, data: { deletedAt: new Date() } })
    await runAsCompany(HOME_COMPANY_ID, () => indexSource(HOME_COMPANY_ID, SOURCE_BY_TYPE.get('DIALER_NOTE')!, [n.id]))
    expect(await find(member2, 'Birch pricing pallet')).not.toContain('777')
  })
})

describe('Metra API', () => {
  it('conversations are private to their owner; the chat says when the model is not set up', async () => {
    const conv = await prisma.aiConversation.create({ data: { userId: w.itadMember.id, title: 'Mine', companyId: HOME_COMPANY_ID } })
    await request(app).get(`/api/metra/conversations/${conv.id}`).set(...auth(w.itadMember)).expect(200)
    await request(app).get(`/api/metra/conversations/${conv.id}`).set(...auth(w.superAdmin)).expect(404)
    // The list too: nobody, not even a Super Admin or the person's team lead, is handed another person's chats,
    // and no browser or proxy may keep a copy of the answer.
    const mine = await request(app).get('/api/metra/conversations').set(...auth(w.itadMember)).expect(200)
    expect(mine.body.conversations.map((c: { id: string }) => c.id)).toContain(conv.id)
    expect(mine.headers['cache-control']).toContain('no-store')
    for (const other of [w.superAdmin, w.itadLead, w.leadgenMember]) {
      const theirs = await request(app).get('/api/metra/conversations').set(...auth(other)).expect(200)
      expect(theirs.body.conversations.map((c: { id: string }) => c.id)).not.toContain(conv.id)
    }
    const key = process.env.GROQ_API_KEY
    delete process.env.GROQ_API_KEY
    delete process.env.METRA_LLM_API_KEY
    const r = await request(app).post('/api/metra/chat').set(...auth(w.itadMember)).send({ message: 'hello' })
    expect(r.status).toBe(503)
    if (key) process.env.GROQ_API_KEY = key
  })

  it('feedback on Metra: anyone sends it, only a Super Admin reads it, and a rated answer shows the question and note but never the answer', async () => {
    // The form: "needs changes" must say what; "it helps" may be empty.
    await request(app).post('/api/metra/feedback').set(...auth(w.itadMember)).send({ rating: 'NEEDS_CHANGES' }).expect(400)
    await request(app).post('/api/metra/feedback').set(...auth(w.itadMember)).send({ rating: 'NEEDS_CHANGES', text: 'It gave a wrong count for my deals.' }).expect(201)
    await request(app).post('/api/metra/feedback').set(...auth(w.leadgenMember)).send({ rating: 'HELPS' }).expect(201)
    // The Super Admin is told, with a link to the Metra tab.
    const note = await prisma.notification.findFirst({ where: { userId: w.superAdmin.id, type: 'AI_INSIGHT', entityType: 'AiInsight' }, orderBy: { createdAt: 'desc' } })
    expect(note?.link).toBe('/app/admin/company?tab=metra')
    // A thumbs down with a note on one answer.
    const conv = await prisma.aiConversation.create({ data: { userId: w.itadMember.id, title: 'Deals', companyId: HOME_COMPANY_ID } })
    await prisma.aiMessage.create({ data: { conversationId: conv.id, role: 'USER', content: 'How many deals did I win?', companyId: HOME_COMPANY_ID } })
    const ans = await prisma.aiMessage.create({ data: { conversationId: conv.id, role: 'ASSISTANT', content: 'SECRET-ANSWER-TEXT you won 0', tools: [{ name: 'deal_tracker', args: {}, ok: true }], companyId: HOME_COMPANY_ID } })
    await request(app).post(`/api/metra/messages/${ans.id}/feedback`).set(...auth(w.itadMember)).send({ feedback: 'DOWN', note: 'I won 3, not 0' }).expect(200)

    // Reading it: Super Admin only.
    await request(app).get('/api/metra/admin/feedback').set(...auth(w.itadMember)).expect(403)
    await request(app).get('/api/metra/admin/feedback').set(...auth(w.itadLead)).expect(403)
    const r = await request(app).get('/api/metra/admin/feedback').set(...auth(w.superAdmin)).expect(200)
    expect(r.body.general.map((g: { rating: string; text: string; handled: boolean }) => [g.rating, g.text, g.handled])).toEqual(expect.arrayContaining([['NEEDS_CHANGES', 'It gave a wrong count for my deals.', false], ['HELPS', '', false]]))
    const rated = r.body.answers.find((a: { id: string }) => a.id === ans.id)
    expect(rated).toMatchObject({ feedback: 'DOWN', note: 'I won 3, not 0', question: 'How many deals did I win?', tools: ['deal_tracker'] })
    expect(JSON.stringify(r.body)).not.toContain('SECRET-ANSWER-TEXT')
    // A thumbs up or down with no note keeps the question private: the admin sees that it was rated, not what was asked.
    await prisma.aiMessage.create({ data: { conversationId: conv.id, role: 'USER', content: 'PRIVATE-QUESTION about my salary', companyId: HOME_COMPANY_ID } })
    const quiet = await prisma.aiMessage.create({ data: { conversationId: conv.id, role: 'ASSISTANT', content: 'x', companyId: HOME_COMPANY_ID } })
    await request(app).post(`/api/metra/messages/${quiet.id}/feedback`).set(...auth(w.itadMember)).send({ feedback: 'DOWN' }).expect(200)
    const r2 = await request(app).get('/api/metra/admin/feedback').set(...auth(w.superAdmin)).expect(200)
    expect(r2.body.answers.find((a: { id: string }) => a.id === quiet.id).question).toBe('')
    expect(JSON.stringify(r2.body)).not.toContain('PRIVATE-QUESTION')

    // Ticking one as handled (Super Admin only).
    const id = r.body.general.find((g: { rating: string }) => g.rating === 'NEEDS_CHANGES').id
    await request(app).patch(`/api/metra/admin/feedback/${id}`).set(...auth(w.itadMember)).send({ handled: true }).expect(403)
    await request(app).patch(`/api/metra/admin/feedback/${id}`).set(...auth(w.superAdmin)).send({ handled: true }).expect(200)
    const again = await request(app).get('/api/metra/admin/feedback').set(...auth(w.superAdmin)).expect(200)
    expect(again.body.general.find((g: { id: string }) => g.id === id).handled).toBe(true)
    // Feedback is not an insight: it never shows in the person's own insights list.
    const ins = await request(app).get('/api/metra/insights').set(...auth(w.itadMember)).expect(200)
    expect(ins.body.insights.some((i: { kind: string }) => i.kind === 'FEEDBACK')).toBe(false)
  })

  it('status lists only the sources a person may read, and the switch turns Metra off', async () => {
    const s = await request(app).get('/api/metra/status').set(...auth(w.leadgenMember)).expect(200)
    expect(s.body.enabled).toBe(true)
    expect(s.body.suggestions.length).toBeGreaterThan(0)
    await setCompanyFlag('metra', HOME_COMPANY_ID, false, 'test')
    resetFlagCache()
    await request(app).post('/api/metra/chat').set(...auth(w.itadMember)).send({ message: 'hello' }).expect(403)
    await setCompanyFlag('metra', HOME_COMPANY_ID, true, 'test')
    resetFlagCache()
    void convId
  })
})
