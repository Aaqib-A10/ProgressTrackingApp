import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { app, prisma, seedWorld, type SeededWorld } from './helpers'
import { setAuditBaseUrl } from '../lib/health/audit'
import { setCompanyFlag, resetFlagCache } from '../lib/flags'
import { HOME_COMPANY_ID } from '../lib/company'
import { runAsCompany } from '../lib/tenancy'
import { companyTz } from '../lib/time'
import { askerOf, forgetAsker } from '../lib/metra/access'
import { readData, readable } from '../lib/metra/catalog'
import { seedMore, MORE_FLAGS, MORE_TRUTH as M } from '../scripts/metraSeedMore'

// The parts of the app the full audit added to Metra (docs/metra/ROADMAP.md §8), read the way Metra reads them: as the
// person, through the app's own API. The rule is the same as everywhere: Metra can never show a person what the app
// would not. A rep reads their own leads, a manager the business, a person outside it nothing.

type Who = { id: string }
let w: SeededWorld
let server: Server

const inCompany = <T>(f: () => Promise<T>) => runAsCompany(HOME_COMPANY_ID, f)
const read = (u: Who, what: string, more: Record<string, unknown> = {}) => inCompany(async () => {
  forgetAsker(u.id)
  const me = await prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { id: true, role: true, name: true } })
  return (await readData(await askerOf(u.id), me, { what, ...more })).text
})
const offered = (u: Who) => inCompany(async () => { forgetAsker(u.id); return readable(await askerOf(u.id)).map((e) => e.key) })
const switches = async (on: boolean, keys: readonly string[] = MORE_FLAGS) => { for (const k of keys) await setCompanyFlag(k as never, HOME_COMPANY_ID, on, 'test'); resetFlagCache() }

beforeAll(async () => {
  w = await seedWorld()
  server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  setAuditBaseUrl(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
  await setCompanyFlag('metra', HOME_COMPANY_ID, true, 'test')
  await switches(true)
  // The Lead Gen lead manages the business and leads the form's department; the Lead Gen member is the rep.
  await inCompany(() => seedMore(prisma as never, { admin: w.superAdmin, manager: w.leadgenLead, rep: w.leadgenMember, dialer: w.itadMember }, companyTz()))
}, 120_000)

afterAll(async () => { server.close(); await prisma.$disconnect() })

describe('Metra reads the rest of the app as the person', () => {
  it('Lead Management: a manager reads the business, a rep only their own leads and calls', async () => {
    const all = M.leads.map((l) => l.name), own = M.leads.filter((l) => l.mine).map((l) => l.name), others = M.leads.filter((l) => !l.mine).map((l) => l.name)
    const manager = await read(w.leadgenLead, 'leads.contacts')
    for (const n of all) expect(manager, n).toContain(n)
    const rep = await read(w.leadgenMember, 'leads.contacts', { item: M.business })
    for (const n of own) expect(rep, n).toContain(n)
    for (const n of others) expect(rep, n).not.toContain(n)

    // The dashboard counts what each of them can see.
    expect(await read(w.leadgenLead, 'leads.dashboard', { range: 'all', item: M.business })).toContain(`leads that came in during the period | ${all.length}`)
    expect(await read(w.leadgenMember, 'leads.dashboard', { range: 'all', item: M.business })).toContain(`leads that came in during the period | ${own.length}`)
    // With no business named: every business the person works (the two leads of the second one are the rep's too).
    expect(await read(w.leadgenMember, 'leads.dashboard', { range: 'all' })).toContain(`leads that came in during the period | ${own.length + M.review.length}`)

    // The deal board: the open deals of the business for the manager, the rep's own for the rep.
    const worth = (list: typeof M.leads) => list.filter((l) => l.status !== 'CLOSED_WON').reduce((s, l) => s + (l.value ?? 0), 0)
    // Two businesses: the board is one business's, so Metra is told to ask which.
    expect(await read(w.leadgenLead, 'leads.board')).toMatch(/^Say which business/)
    expect(await read(w.leadgenLead, 'leads.board', { item: M.business })).toContain(`worth ${worth(M.leads)} `)
    expect(await read(w.leadgenMember, 'leads.board', { item: M.business })).toContain(`worth ${worth(M.leads.filter((l) => l.mine))} `)

    // A call the manager made on the rep's lead is the manager's: the rep's list does not hold its summary.
    const calls = await read(w.leadgenMember, 'leads.calls')
    expect(calls).toContain('Wants a quote for 6 pallets a week to Phoenix.')
    expect(calls).not.toContain('Agreed to a site visit next week.')
    expect(await read(w.leadgenLead, 'leads.calls')).toContain('Agreed to a site visit next week.')

    // Follow-up tasks, with the state the screen gives each.
    const tasks = await read(w.leadgenMember, 'leads.tasks')
    expect(tasks).toContain('Send the rate sheet')
    expect(tasks).toMatch(/Send the rate sheet \|[^\n]*\| Overdue \|/)
    expect(tasks).toMatch(/Confirm the first order \|[^\n]*\| Done \|/)
  })

  it('the lead daily report', async () => {
    // The daily report is counted from the calls of the day; the rep reads their own, a manager each rep's.
    const r = M.leadReport
    const line = `| ${r.dials} | ${r.connected} | ${r.voicemails} | ${r.emails} | ${r.interested} | 0 | Sent | ${r.note}`
    expect(await read(w.leadgenMember, 'leads.report')).toContain(line)
    const team = await read(w.leadgenLead, 'leads.report')
    expect(team).toContain(line)
    expect(team).toContain('For the manager to look at:')
    // With the review flow switched off for the company there is no such report to read.
    await switches(false, ['cmr'])
    expect(await read(w.leadgenMember, 'leads.report')).not.toContain(r.note)
    await switches(true, ['cmr'])
  })

  it('Lead Management: a person outside it is offered none of it and reads none of it; switched off, nobody is offered it', async () => {
    for (const u of [w.itadMember, w.inventoryLead]) {
      expect((await offered(u)).filter((k) => k.startsWith('leads.'))).toEqual([])
      for (const what of ['leads.contacts', 'leads.calls', 'leads.tasks', 'leads.board', 'leads.dashboard']) {
        const text = await read(u, what)
        for (const l of M.leads) expect(text, `${what}: ${l.name}`).not.toContain(l.name)
        expect(text).not.toContain(M.business)
      }
    }
    // Seven since the review queue (Jesse Queue) was removed, 25 Nov 2026.
    expect((await offered(w.leadgenMember)).filter((k) => k.startsWith('leads.')).length).toBe(7)
    await switches(false, ['lead-management'])
    expect((await offered(w.leadgenMember)).filter((k) => k.startsWith('leads.'))).toEqual([])
    expect((await offered(w.superAdmin)).filter((k) => k.startsWith('leads.'))).toEqual([])
    expect(await read(w.leadgenMember, 'leads.contacts')).not.toContain(M.leads[0].name)
    await switches(true, ['lead-management'])
  })

  it('the Daily Report: a member reads their own day, their team lead the whole team, and another team nothing', async () => {
    const mine = await read(w.leadgenMember, 'daily_report.entries')
    expect(mine).toContain(`${M.fields[0]} | ${M.reports[0].calls}`)
    expect(mine).toContain(M.reports[0].blockers)
    expect(mine).toContain('sent the report for that day')

    const team = await read(w.leadgenLead, 'daily_report.entries')
    expect(team).toMatch(/\d+ people fill it in: 1 sent, \d+ not sent, 0 on leave\./)
    expect(team).toContain(`| Sent | ${M.reports[0].calls} | ${M.reports[0].quotes} |`)
    expect(team).toContain(`${M.fields[0]} ${M.reports.reduce((s, r) => s + r.calls, 0)}`) // the last 30 days added up

    for (const u of [w.itadMember, w.itadLead]) {
      const text = await read(u, 'daily_report.entries')
      expect(text).not.toContain(M.fields[0])
      expect(text).not.toContain(M.reports[0].blockers)
    }
  })

  it('a custom block: the Super Admin reads its records in the block\'s own field order with the total; a team without it reads nothing', async () => {
    const text = await read(w.superAdmin, 'custom.records', { item: 'Vendors' })
    for (const v of M.vendors) expect(text, v.vendor).toContain(v.vendor)
    expect(text).toContain('vendor | amount | note')
    expect(text).toContain(`total amount ${M.vendors.reduce((s, v) => s + v.amount, 0).toLocaleString('en-US')}`)
    for (const u of [w.itadMember, w.leadgenMember]) expect(await read(u, 'custom.records', { item: 'Vendors' })).not.toContain(M.vendors[0].vendor)
  })

  it('the Lead Dialer import list: an agent\'s own, the whole team\'s for their lead, and not offered to another team', async () => {
    expect(await read(w.itadMember, 'dialer.imports')).toContain(M.importFile)
    expect(await read(w.itadLead, 'dialer.imports')).toContain(M.importFile)
    expect(await offered(w.leadgenMember)).not.toContain('dialer.imports')
    expect(await read(w.leadgenMember, 'dialer.imports')).not.toContain(M.importFile)
  })

  it('what only leads see stays with leads: the register, a profile, the trend screens and the tags', async () => {
    const member = await offered(w.itadMember), lead = await offered(w.itadLead)
    for (const k of ['attendance.register', 'people.profile', 'itad.trend', 'admin.tags']) { expect(member, k).not.toContain(k); expect(lead, k).toContain(k) }
    // A lead of one team cannot open the profile of a person of another team.
    const other = await prisma.user.findUniqueOrThrow({ where: { id: w.leadgenMember.id }, select: { name: true } })
    expect(await read(w.itadLead, 'people.profile', { item: other.name })).not.toContain('Profile of')
    const own = await prisma.user.findUniqueOrThrow({ where: { id: w.itadMember.id }, select: { name: true } })
    expect(await read(w.itadLead, 'people.profile', { item: own.name })).toContain(`Profile of ${own.name.trim()}`)
  })
})
