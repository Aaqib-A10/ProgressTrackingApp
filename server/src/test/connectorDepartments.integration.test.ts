import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import request from 'supertest'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { setAuditBaseUrl } from '../lib/health/audit'
import { compact, readablePath } from '../lib/mcp/departmentTools'

// ITAD asked ChatGPT "which high-priority leads need follow-up" and it could only see project
// tickets, so it asked for screenshots. The connector now reads each team's own data, as the
// person, through the same API (and checks) as the app.

let w: SeededWorld
let server: Server
let ecom: { id: string; role: 'MEMBER' }
const urls: Record<string, string> = {}

const call = (who: string, name: string, args: object = {}) =>
  request(app).post(urls[who]).send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }).expect(200).then((r) => r.body.result as { content: { text: string }[]; isError?: boolean })
const out = (r: { content: { text: string }[] }) => r.content.map((c) => c.text).join('\n')

beforeAll(async () => {
  w = await seedWorld()
  server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  setAuditBaseUrl(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
  const dept = await prisma.department.create({ data: { type: 'ECOMMERCE', name: 'E-commerce' } })
  const u = await prisma.user.create({ data: { name: 'ecom member', email: 'ecom.member@test.local', role: 'MEMBER', status: 'ACTIVE', isActive: true, passwordHash: 'x', departmentId: dept.id } })
  ecom = { id: u.id, role: 'MEMBER' }
  for (const [who, u2] of [['itad', w.itadMember], ['itadLead', w.itadLead], ['ecom', ecom], ['leadgen', w.leadgenMember]] as const) {
    const k = await request(app).post('/api/claude/keys').set(...auth(u2)).send({ name: 'k', client: 'chatgpt' }).expect(201)
    urls[who] = new URL(k.body.connectorUrl).pathname
  }
  // The ITAD member's leads: one overdue Interested lead, one fresh, one with a call back today, one in Arizona.
  const headers = ['Lead ID', 'Company', 'First Name', 'Last Name', 'Phone', 'State', 'Lead Status', 'Last Modified']
  const mapping = { leadId: 'Lead ID', company: 'Company', phone: 'Phone', state: 'State', status: 'Lead Status', lastActivity: 'Last Modified' }
  const old = new Date(Date.now() - 40 * 86400000).toISOString()
  await request(app).post('/api/dialer/imports').set(...auth(w.itadMember)).send({
    fileName: 'crm.csv', headers, mapping,
    rows: [
      ['A1', 'Harbor Cold Storage', 'Ann', 'Lee', '404-555-0101', 'GA', 'Interested', old],
      ['A2', 'Fresh Lead Co', 'Bob', 'Ray', '216-555-0102', 'Ohio', 'Assigned', new Date().toISOString()],
      ['A3', 'Mesa Data', 'Cy', 'Dale', '602-555-0103', 'Arizona', 'Pipeline', old],
    ],
  }).expect(201)
  // Another rep's lead the member must never see.
  await request(app).post('/api/dialer/imports').set(...auth(w.itadLead)).send({ fileName: 'x.csv', headers, mapping, rows: [['B1', 'Lead Of The Lead', 'Di', 'Ko', '305-555-0109', 'FL', 'Interested', old]] }).expect(201)
})
afterAll(async () => { server?.close(); await prisma.$disconnect() })

describe('the connector reads each team\'s data', () => {
  it('lists the new tools; metriq_guide shows each person their own team', async () => {
    const tools = await request(app).post(urls.itad).send({ jsonrpc: '2.0', id: 1, method: 'tools/list' }).expect(200)
    const names = tools.body.result.tools.map((t: { name: string }) => t.name)
    for (const n of ['metriq_guide', 'metriq_read', 'dialer_summary', 'dialer_leads', 'dialer_lead', 'dialer_update_lead', 'dialer_edit_lead']) expect(names).toContain(n)
    const itad = out(await call('itad', 'metriq_guide'))
    expect(itad).toContain('team ITAD')
    expect(itad).toContain('dialer_leads')
    expect(itad).not.toContain('/api/ecommerce/board')
    const e = out(await call('ecom', 'metriq_guide'))
    expect(e).toContain('/api/ecommerce/board')
    expect(e).not.toContain('dialer_leads')
  })

  it('ITAD: follow-ups and hot leads come from the real Lead Dialer, only the person\'s own', async () => {
    const sum = out(await call('itad', 'dialer_summary'))
    expect(sum).toContain('Leads: 3.')
    expect(sum).toMatch(/Follow-ups: \d+ overdue/)
    const fu = await call('itad', 'dialer_leads', { view: 'follow_ups' })
    expect(fu.isError).toBeFalsy()
    expect(out(fu)).toContain('Harbor Cold Storage')
    expect(out(fu)).toContain('Ann Lee')
    expect(out(fu)).not.toContain('Fresh Lead Co')
    const hot = out(await call('itad', 'dialer_leads', { view: 'hot' }))
    expect(hot).toContain('Harbor Cold Storage')
    expect(hot).toContain('Mesa Data')
    expect(hot).not.toContain('Lead Of The Lead') // another rep's lead
    const az = out(await call('itad', 'dialer_leads', { state: 'Arizona' }))
    expect(az).toContain('Mesa Data')
    expect(az).not.toContain('Harbor')
    // A manager can see the team.
    expect(out(await call('itadLead', 'dialer_leads', { view: 'hot', rep: 'all' }))).toContain('Harbor Cold Storage')
  })

  it('ITAD: a note and a call back go on the lead as the person', async () => {
    const n = await call('itad', 'dialer_update_lead', { lead: 'Harbor', action: 'note', text: 'Spoke to Ann, wants a quote', pinned: true })
    expect(out(n)).toContain('Note added to Harbor Cold Storage (pinned)')
    const when = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
    expect(out(await call('itad', 'dialer_update_lead', { lead: '404-555-0101', action: 'call_later', when: `${when} 20:00` }))).toContain('call back set')
    const lead = await prisma.dialerLead.findFirstOrThrow({ where: { company: 'Harbor Cold Storage' }, include: { notes: true } })
    expect(lead.notes[0]).toMatchObject({ text: 'Spoke to Ann, wants a quote', pinned: true, userId: w.itadMember.id })
    expect(lead.callLaterAt).not.toBeNull()
    expect(out(await call('itad', 'dialer_lead', { lead: lead.id }))).toContain('Spoke to Ann')
    // Not someone else's lead.
    expect((await call('itad', 'dialer_update_lead', { lead: 'Lead Of The Lead', action: 'note', text: 'x' })).isError).toBe(true)
  })

  it('ITAD: the second phone, second email and other extra details are set and removed through the connector', async () => {
    const r = await call('itad', 'dialer_edit_lead', { lead: 'Mesa Data', second_phone: '602-555-0199 ext 12', second_email: 'cy.dale@mesadata.test', decision_maker: 'Cy Dale, IT Director', best_time: 'Tue-Thu after 2 PM MT', tags: ['warm', 'servers'] })
    expect(r.isError).toBeFalsy()
    expect(out(r)).toContain('Mesa Data: second phone 602-555-0199 ext 12; second email cy.dale@mesadata.test')
    let lead = await prisma.dialerLead.findFirstOrThrow({ where: { company: 'Mesa Data' }, include: { actions: true } })
    expect(lead).toMatchObject({ phone2: '602-555-0199 ext 12', email2: 'cy.dale@mesadata.test', decisionMaker: 'Cy Dale, IT Director', bestTime: 'Tue-Thu after 2 PM MT', tags: ['warm', 'servers'] })
    expect(lead.actions.filter((x) => x.kind === 'EDIT' && x.userId === w.itadMember.id).length).toBe(5)
    // The lead page shows them, and the lead is found by its second phone.
    expect(out(await call('itad', 'dialer_lead', { lead: lead.id }))).toContain('cy.dale@mesadata.test')
    // Remove one, keep the rest; tick Done in Earthzone.
    expect(out(await call('itad', 'dialer_edit_lead', { lead: lead.id, second_email: '', done_in_earthzone: true }))).toContain('second email removed; marked done in Earthzone')
    lead = await prisma.dialerLead.findFirstOrThrow({ where: { company: 'Mesa Data' }, include: { actions: true } })
    expect(lead.email2).toBeNull()
    expect(lead.phone2).toBe('602-555-0199 ext 12')
    expect(lead.needsCrmUpdate).toBe(false)
    // Checks: a bad email or phone, nothing to change, someone else's lead, another team.
    expect(out(await call('itad', 'dialer_edit_lead', { lead: lead.id, second_email: 'not-an-email' }))).toContain('does not look like an email')
    expect(out(await call('itad', 'dialer_edit_lead', { lead: lead.id, second_phone: '12' }))).toContain('does not look like a phone')
    expect((await call('itad', 'dialer_edit_lead', { lead: lead.id })).isError).toBe(true)
    expect((await call('itad', 'dialer_edit_lead', { lead: 'Lead Of The Lead', second_phone: '305-555-0110' })).isError).toBe(true)
    expect((await call('ecom', 'dialer_edit_lead', { lead: 'Mesa Data', second_phone: '602-555-0100' })).isError).toBe(true)
    expect((await prisma.dialerLead.findFirstOrThrow({ where: { company: 'Lead Of The Lead' } })).phone2).toBeNull()
    // Alternative numbers are added to the ones the lead has (one it already has is skipped), and land in the Claude log.
    expect(out(await call('itad', 'dialer_edit_lead', { lead: lead.id, alt_phones: ['602-555-0300', '602.555.0300'] }))).toContain('alternative number 602-555-0300 added')
    expect(out(await call('itad', 'dialer_edit_lead', { lead: lead.id, alt_phones: ['(602) 555-0300', '602-555-0301'] }))).toContain('alternative number 602-555-0301 added')
    expect((await prisma.dialerLead.findFirstOrThrow({ where: { company: 'Mesa Data' } })).altPhones).toEqual(['602-555-0300', '602-555-0301'])
    expect(out(await call('itad', 'dialer_edit_lead', { lead: lead.id, alt_phones: ['602 555 0300'] }))).toContain('nothing changed')
    expect(out(await call('itad', 'dialer_edit_lead', { lead: lead.id, alt_phones: ['12'] }))).toContain('does not look like a phone')
    const log = await request(app).get('/api/dialer/claude-log?kind=values').set(...auth(w.itadMember)).expect(200)
    expect(log.body.items.filter((i: { company: string; label: string }) => i.company === 'Mesa Data' && i.label === 'Alternative number').map((i: { text: string }) => i.text).sort()).toEqual(['602-555-0300', '602-555-0301'])
    // A manager can fix a rep's lead.
    expect((await call('itadLead', 'dialer_edit_lead', { lead: 'Harbor', rep: 'itad member', second_phone: '404-555-0177' })).isError).toBeFalsy()
    expect((await prisma.dialerLead.findFirstOrThrow({ where: { company: 'Harbor Cold Storage' } })).phone2).toBe('404-555-0177')
  })

  it('other teams cannot reach the Lead Dialer, ITAD cannot reach E-commerce, and the app\'s checks hold', async () => {
    const r = await call('ecom', 'dialer_leads', { view: 'follow_ups' })
    expect(r.isError).toBe(true)
    expect(out(r)).toContain('ITAD')
    expect((await call('itad', 'metriq_read', { path: '/api/ecommerce/board' })).isError).toBe(true)
    const board = await call('ecom', 'metriq_read', { path: '/api/ecommerce/board' })
    expect(board.isError).toBeFalsy()
    const mine = await call('ecom', 'metriq_read', { path: '/api/attendance/history', query: { range: 'week' } })
    expect(mine.isError).toBeFalsy()
    // A member cannot read the team register, exactly like the app.
    expect((await call('leadgen', 'metriq_read', { path: '/api/attendance/register' })).isError).toBe(true)
  })

  it('sign-in, keys, chats, salaries and files are never open to connectors', async () => {
    for (const p of ['/api/auth/me', '/api/claude/keys', '/api/chat/conversations', '/api/financials/salaries', '/api/docs/abc/file', '/api/attendance/team.csv', '/api/mcp/x', 'https://evil.example/api/x', '/api/../auth/me'])
      expect((await call('itad', 'metriq_read', { path: p })).isError).toBe(true)
    expect(readablePath('/api/itad/bids')).toBeNull()
    expect(compact({ a: null, b: [], c: 'x', d: { e: '' } })).toBe('{"c":"x","d":{}}')
    expect(compact('x'.repeat(50), 10)).toContain('[CUT at 10')
  })
})
