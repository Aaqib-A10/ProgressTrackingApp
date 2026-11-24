import { describe, expect, it } from 'vitest'
import type { Asker } from '../access'
import { suggestionsFor } from '../agent'
import { ENTRIES, dataTool, entriesFor, entryOf, guideFor, lineOf, pick, readable } from './index'
import { dayOf, renderTable, sameName } from './table'
import type { Ctx, Entry, Row } from './types'
import { auto, dayLog, figures } from './load'
import { MORE_SCREENS } from './screens'
import { screenAt } from '../sources'

const asker = (role: Asker['role'], kinds: string[], name = 'Sara Khan', id = 'u1'): Asker => ({ id, name, role, companyId: 'c1', departmentId: 'd1', departmentName: null, kinds: kinds as never, principals: new Set(), sources: new Set() })
const ctx = (a: Asker): Ctx => ({ me: { id: a.id, name: a.name, role: a.role }, asker: a, today: '2026-11-15', zone: 'Asia/Karachi', now: new Date('2026-11-15T08:00:00Z') })

const STOCK: Entry = {
  key: 'test.stock', label: 'Stock tracking', area: 'Test', about: 'x', says: [], who: () => true, blocks: [], apis: [], models: [],
  table: {
    unit: ['stock request', 'stock requests'],
    columns: [{ key: 'item', label: 'item' }, { key: 'status', label: 'status' }, { key: 'assignee', label: 'assigned to' }, { key: 'assigneeId', label: 'id', hidden: true }, { key: 'qty', label: 'quantity', kind: 'number' }, { key: 'at', label: 'requested', kind: 'date' }, { key: 'note', label: 'note', kind: 'long' }],
    people: ['assignee'], mine: 'assigneeId', status: 'status', date: 'at', sums: ['qty'],
    words: { status: { REQUESTED: 'Requested', ASSIGNED: 'Assigned', RESOLVED: 'Resolved' } },
    flags: { open: { label: 'not resolved', says: ['pending', 'open', 'masla'], test: (r) => r.status !== 'RESOLVED' } },
  },
}
const rows: Row[] = [
  { item: 'HP EliteDesk 800 G4', status: 'REQUESTED', assignee: '', assigneeId: '', qty: 6, at: '2026-11-14', note: 'Pull it from Amazon' },
  { item: 'Dell Latitude 5490', status: 'ASSIGNED', assignee: 'Sara Khan', assigneeId: 'u1', qty: 3, at: '2026-11-14T06:00:00.000Z', note: '' },
  { item: 'Dell P2419H monitor', status: 'REQUESTED', assignee: '', assigneeId: '', qty: null, at: '2026-11-15', note: 'Only 2 left' },
  { item: 'Lenovo M720q', status: 'RESOLVED', assignee: 'Ali Raza', assigneeId: 'u2', qty: 12, at: '2026-11-11', note: 'Back in stock' },
]
const me = asker('MEMBER', ['ECOMMERCE'])
const read = (a: Record<string, unknown>) => renderTable(STOCK, { rows }, a, ctx(me))

describe('the reader behind metriq_data', () => {
  it('applies a condition only when the person asked for it, and uses the one they asked for instead', () => {
    const BOARD: Entry = { ...STOCK, table: { ...STOCK.table!, flags: { ...STOCK.table!.flags, mine: { label: 'mine', says: ['assigned to me'], test: (r) => r.assigneeId === 'u1' } } } }
    const asking = (asked: string, a: Record<string, unknown>) => renderTable(BOARD, { rows }, a, { ...ctx(me), asked })
    // Asked plainly: the model's "not resolved" is not applied; all four are listed and the count is still given.
    const plain = asking('what is in stock tracking?', { only: 'not resolved' })
    expect(plain).toContain('The question does not ask for "not resolved", so all stock requests are listed')
    expect(plain).toContain('Lenovo M720q')
    expect(plain).toContain('not resolved 3')
    // Asked for it ("pending", one of its words): applied.
    expect(asking('which ones are pending?', { only: 'not resolved' })).not.toContain('Lenovo M720q')
    // The model picked another condition than the one asked for: the asked one is used.
    const other = asking('which are assigned to me?', { only: 'not resolved' })
    expect(other).toContain('The question asks for "mine", so that was used instead of "not resolved".')
    expect(other).toContain('Dell Latitude 5490')
    expect(other).not.toContain('HP EliteDesk')
    // A word must start a word of the question: "open" is not found in "reopened".
    expect(asking('which were reopened?', { only: 'open' })).toContain('does not ask for')
    // Without the question (tests, the coverage gate), the condition is applied as given.
    expect(read({ only: 'not resolved' })).not.toContain('Lenovo M720q')
  })

  it('words that are in no row are left out instead of leaving nothing', () => {
    const t = read({ search: 'Vendors' })
    expect(t).toContain('No stock request contains "Vendors", so the words were left out: all stock requests are listed.')
    expect(t).toContain('HP EliteDesk 800 G4')
    expect(read({ search: 'Dell' })).not.toContain('HP EliteDesk')
  })

  it('gives the totals of every row first, with each status, each condition and the sums', () => {
    const t = read({})
    expect(t).toContain('All: 4 stock requests; by status: Requested 2, Assigned 1, Resolved 1; not resolved 3; total quantity 21.')
    expect(t).not.toContain('Matching (')
  })

  it('every row has every column of the heading: an empty value is "-", never left out', () => {
    const lines = read({}).split('\n')
    const head = lines.find((l) => l.startsWith('item | '))!
    const body = lines.slice(lines.indexOf(head) + 1).filter((l) => l.includes(' | '))
    expect(body).toHaveLength(4)
    for (const l of body) expect(l.split(' | ')).toHaveLength(head.split(' | ').length)
    expect(body[0]).toBe('HP EliteDesk 800 G4 | Requested | - | 6 | Sat 14 Nov 2026 | Pull it from Amazon')
    expect(head).not.toContain('id') // internal ids are never printed
  })

  it('a condition in any wording, English or Roman Urdu, narrows the rows and keeps the totals', () => {
    for (const only of ['not resolved', 'pending', 'OPEN', 'masla']) {
      const t = read({ only })
      expect(t).toContain('All: 4 stock requests')
      expect(t).toContain('Matching (not resolved): 3 stock requests')
      expect(t).not.toContain('Lenovo M720q |')
    }
  })

  it('a status in any case, by its stored name or the word on the screen; several at once', () => {
    expect(read({ status: 'resolved' })).toContain('Matching (status Resolved): 1 stock request;')
    expect(read({ status: 'REQUESTED and assigned' })).toContain('Matching (status Requested or Assigned): 3 stock requests')
  })

  it('a status that does not exist is left out and said so, instead of answering "none"', () => {
    const t = read({ status: 'closed' })
    expect(t).toContain('There is no status "closed" here, so it was left out. The statuses are: Requested, Assigned, Resolved.')
    expect(t).not.toContain('Matching (')
    expect(t).toContain('HP EliteDesk 800 G4 |')
  })

  it('a status word that is really a condition ("pending") is read as the condition', () => {
    expect(read({ status: 'pending' })).toContain('Matching (not resolved): 3 stock requests')
  })

  it('a condition AND a status keeps every row of the condition and says how many have that status (no double narrowing)', () => {
    const t = read({ only: 'not resolved', status: 'Requested' })
    expect(t).toContain('Matching (not resolved): 3 stock requests')
    expect(t).toContain('All 3 that are not resolved are listed. 2 of them have the status Requested')
    expect(t).toContain('Dell Latitude 5490 | Assigned') // the assigned one is not dropped
    // A status that agrees with the condition narrows as usual.
    expect(read({ only: 'not resolved', status: 'Requested and Assigned' })).toContain('Matching (not resolved, status Requested or Assigned): 3 stock requests')
  })

  it('"me" is the person asking, by id; their own name works too; a stranger is left out with the people who are there', () => {
    for (const person of ['me', 'mera', 'Sara Khan', 'sara']) expect(read({ person })).toContain("Matching (Sara Khan's own): 1 stock request;")
    expect(read({ person: 'ali' })).toContain('Matching (person "ali"): 1 stock request;')
    const t = read({ person: 'Zubair' })
    expect(t).toContain('Nobody called "Zubair" is in this data, so that was left out. People here: Sara Khan, Ali Raza.')
    expect(t).not.toContain('Matching (')
  })

  it('"me" with nothing of their own says so and still gives the numbers for everyone', () => {
    const other = asker('SUPER_ADMIN', [], 'Test Super Admin', 'u9')
    const t = renderTable(STOCK, { rows }, { person: 'me' }, ctx(other))
    expect(t).toContain("None of these stock requests are Test Super Admin's own.")
    expect(t).toContain('All: 4 stock requests')
  })

  it('dates narrow on the day in the company clock; dates that leave nothing are dropped with a note', () => {
    expect(read({ from: '2026-11-14', to: '2026-11-14' })).toContain('Matching (requested 2026-11-14 to 2026-11-14): 2 stock requests')
    const t = read({ only: 'pending', from: '2026-12-01', to: '2026-12-31' })
    expect(t).toContain('so the dates were left out: what follows is for any date.')
    expect(t).toContain('Matching (not resolved): 3 stock requests')
  })

  it('words are looked for in every column; when no row has all of them, rows with some are given', () => {
    expect(read({ search: 'dell' })).toContain('Matching (words "dell"): 2 stock requests')
    expect(read({ search: 'dell amazon' })).toContain('No stock request has all of the words "dell amazon"; these have some of them.')
  })

  it('groups by a column named by its key or its label, and says what it has when the column is unknown', () => {
    expect(read({ group_by: 'assigned to' })).toContain('Grouped by assigned to: - 2, quantity 6; Sara Khan 1, quantity 3; Ali Raza 1, quantity 12.')
    expect(read({ group_by: 'colour' })).toContain('This data cannot be grouped by "colour". It has: item, status, assigned to, quantity, requested, note.')
  })

  it('the limit cuts the rows, never the counts', () => {
    const t = read({ limit: 2 })
    expect(t).toContain('The stock requests (2 of 4; the numbers above count all of them')
    expect(t).toContain('All: 4 stock requests')
  })

  it('an empty data set says there are none', () => {
    expect(renderTable(STOCK, { rows: [] }, {}, ctx(me))).toContain('All: 0 stock requests; not resolved 0.\n\nThere are no stock requests.')
  })
})

describe('names and days', () => {
  it('a first name or a part of the name is the same person; another person is not', () => {
    expect(sameName('ali', 'Ali Raza')).toBe(true)
    expect(sameName('Ali Raza', 'ali')).toBe(true)
    expect(sameName('Sara K', 'Sara Khan')).toBe(false) // one letter is not a name
    expect(sameName('Alina', 'Ali Raza')).toBe(false)
    expect(sameName('', 'Ali')).toBe(false)
  })
  it('a day from a date or from a time, on the company clock', () => {
    expect(dayOf('2026-11-15', 'Asia/Karachi')).toBe('2026-11-15')
    expect(dayOf('2026-11-14T20:30:00.000Z', 'Asia/Karachi')).toBe('2026-11-15')
    expect(dayOf('soon', 'Asia/Karachi')).toBe('')
  })
})

describe('the catalog', () => {
  const ecom = asker('MEMBER', ['ECOMMERCE']), ecomLead = asker('TEAM_LEAD', ['ECOMMERCE']), inv = asker('MEMBER', ['INVENTORY']), itad = asker('MEMBER', ['ITAD']), admin = asker('SUPER_ADMIN', [])

  it('every entry is well formed: one name each, and every column a table refers to exists', () => {
    expect(new Set(ENTRIES.map((e) => e.key)).size).toBe(ENTRIES.length)
    for (const e of ENTRIES) {
      expect(e.guide || (e.load && e.table), e.key).toBeTruthy()
      if (!e.table) continue
      const cols = new Set(e.table.columns.map((c) => c.key))
      for (const k of [...(e.table.people ?? []), ...(e.table.groups ?? []), ...(e.table.sums ?? []), e.table.mine, e.table.status, e.table.date, ...Object.keys(e.table.words ?? {})]) if (k) expect(cols.has(k), `${e.key}: ${k}`).toBe(true)
      expect(e.says.length, e.key).toBeGreaterThan(3)
      expect(e.about.length, e.key).toBeGreaterThan(30)
    }
  })

  it('a person only gets the data sets of the screens they can open', () => {
    const keys = (a: Asker) => readable(a).map((e) => e.key)
    // Everyone: their own calendar, attendance, numbers, notifications, QA scores, feedback, chats and the people list.
    const personal = ['calendar.my', 'attendance.mine', 'people.directory', 'people.teams', 'people.top', 'notifications.mine', 'notifications.history', 'reports.mine', 'qa.mine', 'qa.evaluations', 'qa.evaluation', 'feedback.threads', 'wfh.requests', 'attendance.fixes', 'notes.mine', 'chat.list', 'projects.overview', 'projects.reviews', 'projects.ticket_history', 'work.people']
    expect(keys(itad).sort()).toEqual([...personal, 'itad.docs', 'itad.my_day'].sort())
    // A member never gets a team lead's data sets, another team's, the remote desktops, Lead Management or the admin lists.
    for (const k of keys(itad)) expect(k, k).not.toMatch(/^(attendance\.(now|team|register)|leave\.team|itad\.(team|trend)|leadgen\.|reports\.(missing|today|monthly)|todo\.team|targets\.|ecommerce\.|inventory\.|marketing\.|qa\.(team|scorecards?$|people)|people\.profile|leads\.|admin\.|daily_report\.entries|dialer\.)/)
    expect(keys(ecom)).toEqual(expect.arrayContaining(['ecommerce.listings', 'ecommerce.stock', 'ecommerce.meeting_notes', 'ecommerce.tasks', 'ecommerce.my_day']))
    expect(keys(ecom).some((k) => k.startsWith('inventory.') || k.includes('rdp') || k.startsWith('marketing.'))).toBe(false)
    expect(keys(ecomLead)).toEqual(expect.arrayContaining(['ecommerce.rdp', 'ecommerce.rdp_people', 'ecommerce.rdp_history', 'attendance.now', 'leave.team', 'todo.team']))
    expect(keys(inv).filter((k) => k.startsWith('inventory.'))).toEqual(['inventory.items', 'inventory.requests', 'inventory.item_history'])
    expect(keys(asker('TEAM_LEAD', ['ITAD']))).toEqual(expect.arrayContaining(['itad.team', 'attendance.now', 'attendance.team', 'reports.missing', 'reports.monthly']))
    expect(keys(asker('TEAM_LEAD', ['ITAD'])).some((k) => k.startsWith('leadgen.'))).toBe(false)
    expect(keys(asker('MEMBER', ['MARKETING']))).toEqual(expect.arrayContaining(['marketing.tasks', 'marketing.blogs', 'marketing.ads', 'marketing.brands']))
    // The Super Admin reads every data set, once the parts behind a switch (Lead Management, Daily Report, Lead Dialer,
    // and the plan 2026-11 modules: requests, people records, quotes and invoices, the report builder, project extras) are on.
    const everySwitch = ['leads', 'on:requests', 'on:people-records', 'on:sales-docs', 'on:report-builder', 'on:project-extras']
    expect(keys({ ...admin, principals: new Set(everySwitch), sources: new Set(['LEAD', 'REPORT_ENTRY', 'DIALER_LEAD']) }).length).toBe(ENTRIES.filter((e) => e.load && e.table).length)
    // With those modules off (as for 99 Technologies), none of their data sets is offered, to anyone.
    expect(keys({ ...admin, principals: new Set(['leads']), sources: new Set(['LEAD', 'REPORT_ENTRY', 'DIALER_LEAD']) }).filter((k) => /^(requests\.|leave\.balance|people\.records|sales\.|projects\.time|reports\.saved)/.test(k))).toEqual([])
    expect(keys({ ...itad, principals: new Set([...itad.principals, 'on:requests']) }).filter((k) => k.startsWith('requests.') || k === 'leave.balance').sort()).toEqual(['leave.balance', 'requests.list', 'requests.rules', 'requests.waiting'])
    expect((dataTool(itad)!.parameters as { properties: { what: { enum: string[] } } }).properties.what.enum).toEqual(keys(itad))
  })

  it('the guide keeps every line the old one had for that person, word for word where it mattered', () => {
    const g = guideFor(itad, 'how many leads do i have').join('\n')
    expect(g).toContain('MY TASKS ("my task", "my tasks", "tasks assigned to me"')
    expect(g).toContain('Never answer "my tasks" from a team board')
    expect(g).toContain('→ deal_tracker.')
    expect(g).toContain('MY CALENDAR (Calendar)')
    // A member's own numbers are always in their guide; the team's pages are not offered to them at all.
    expect(g).toContain('metriq_data what="reports.mine"')
    expect(g).toContain('metriq_data what="attendance.mine"')
    expect(g).not.toContain('itad.team')
    expect(g).not.toContain('attendance.now')
    expect(g).not.toContain('ecommerce.')
    const leadGuide = guideFor(asker('TEAM_LEAD', ['ITAD']), '').join('\n')
    for (const k of ['attendance.now', 'attendance.team', 'leave.team', 'reports.missing', 'itad.team', 'todo.team']) expect(leadGuide, k).toContain(`metriq_data what="${k}"`)
    // What every data set can be narrowed with is said once, not on every line.
    expect(leadGuide.split('DATA SETS read with metriq_data').length).toBe(2)
  })

  it("a team's own data sets are always in its people's guide; for others they come when the question fits", () => {
    expect(guideFor(ecom, 'hello').join('\n')).toContain('metriq_data what="ecommerce.stock"')
    expect(guideFor(inv, 'hello').join('\n')).toContain('metriq_data what="inventory.items"')
    const quiet = guideFor(admin, 'give me a summary of the deal tracker').join('\n')
    expect(quiet).not.toContain('metriq_data what="inventory.items"')
    expect(quiet).toContain('"inventory.items" = Stock list (Inventory)') // still named, so it can be asked for
    expect(guideFor(admin, 'which inventory items are low in stock?').join('\n')).toContain('metriq_data what="inventory.items"')
  })

  it('the entries that fit a question are picked, in English and Roman Urdu, and for a follow-up', () => {
    const top = (q: string, earlier = '') => pick(admin, q, earlier)[0]?.key
    expect(top('which items are out of stock in the inventory?')).toBe('inventory.items')
    expect(top('what was decided in the last meeting notes')).toBe('ecommerce.meeting_notes')
    expect(top('how many listings did the team add this week')).toBe('ecommerce.listings')
    expect(top('what is on my calendar tomorrow')).toBe('calendar.my')
    expect(top('kal meri koi meeting hai')).toBe('calendar.my')
    expect(top('which rdp is free')).toBe('ecommerce.rdp')
    expect(top('and last week?', 'how many listings did I add this month')).toBe('ecommerce.listings')
    expect(pick(admin, 'who won the football world cup')).toEqual([])
  })

  it('the model may name a data set by its key, its name on the screen or plain words', () => {
    expect(entryOf(admin, 'inventory.items')?.key).toBe('inventory.items')
    expect(entryOf(admin, 'Stock list')?.key).toBe('inventory.items')
    expect(entryOf(admin, 'E-commerce Meeting notes')?.key).toBe('ecommerce.meeting_notes')
    expect(entryOf(itad, 'inventory.items')).toBeNull() // not theirs
    expect(entryOf(admin, '')).toBeNull()
  })

  it('a generated guide line names the data set, how to call it and what it can be narrowed to', () => {
    const l = lineOf(ENTRIES.find((e) => e.key === 'inventory.items')!)
    expect(l).toContain('STOCK LIST (Inventory)')
    expect(l).toContain('metriq_data what="inventory.items"')
    expect(l).toContain('[only: low stock / out of stock / needs restocking (low or out) / not active]')
    expect(lineOf(ENTRIES.find((e) => e.key === 'ecommerce.listings')!)).toContain('range (today, week, month, rolling3m) or from and to')
  })

  it('the starter questions under a new chat are about the person\'s own screens', () => {
    const withDialer = (a: Asker): Asker => ({ ...a, sources: new Set(['DIALER_LEAD', 'PM_TASK']) })
    const e = suggestionsFor(withDialer(ecom)), i = suggestionsFor(withDialer(inv)), d = suggestionsFor(withDialer(itad))
    expect(e).toEqual(expect.arrayContaining(['How many listings did I add this month?', 'Which stock issues are still not resolved?']))
    expect(i).toEqual(expect.arrayContaining(['Which items are low or out of stock?', 'Which stock requests are still open?']))
    // The Lead Dialer questions are for the ITAD team only (an inventory member was shown "Who should I call first today?").
    expect(d[0]).toBe('Who should I call first today?')
    for (const s of [e, i]) expect(s.join(' ')).not.toContain('call first')
    for (const s of [e, i, d]) { expect(s.length).toBeLessThanOrEqual(5); expect(new Set(s).size).toBe(s.length) }
  })

  it('entriesFor never offers a hand-written line to someone it is not for', () => {
    expect(entriesFor(itad).some((e) => e.key === 'dashboard.company')).toBe(false)
    expect(entriesFor(admin).some((e) => e.key === 'dashboard.company')).toBe(true)
  })
})

describe('screens read as they come, and the rest of the app (the full audit of 15 Nov)', () => {
  it('a screen of figures only becomes rows of figures, never "there is nothing"', () => {
    const d = auto({ range: 'This month', cards: { total: 6, unassigned: 2 }, byStatus: { NEW: 3, CLOSED_WON: 1 }, openValue: 0 }, ['line', 'lines'])
    expect(d.rows).toEqual([{ figure: 'open value', value: 0 }, { figure: 'cards: total', value: 6 }, { figure: 'cards: unassigned', value: 2 }, { figure: 'by status: new', value: 3 }, { figure: 'by status: closed won', value: 1 }])
    expect(d.head).toEqual(['range This month.'])
  })

  it('a screen with a list gives the list as rows, its own figures first, and says when the list is one page of more', () => {
    const d = auto({ calls: [{ id: 'c1', at: '2026-11-15T09:00:00Z', user: { id: 'u1', name: 'Sara Khan' }, seconds: 240 }], total: 80, page: 1, pageSize: 50, counts: { today: 2, overdue: 1 } }, ['call', 'calls'])
    expect(d.rows).toEqual([{ at: '2026-11-15T09:00:00Z', user: 'Sara Khan', seconds: 240 }])
    expect(d.head).toEqual(['total 80.', 'Counts: today 2, overdue 1.'])
    expect(d.notes?.[0]).toContain('Only 1 of the 80 calls are listed here')
    // The list to use can be named; a name that is not there means "no list": the figures.
    expect(auto({ businesses: [], people: [{ name: 'A' }, { name: 'B' }] }, ['business', 'businesses'], { rows: 'businesses' }).rows).toEqual([])
  })

  it('figures two levels down keep the names that lead to them, and rates are said as percentages', () => {
    expect(figures({ summary: { totals: { callsDialed: 120 }, kpis: { connectRate: 0.25 }, workingDays: 1 } })).toEqual(['summary: working days 1', 'summary totals: calls dialed 120', 'summary kpis: connect rate 25%'])
    expect(figures({ weeklyLeadTarget: 40, leadToQualified: 0.32 })).toEqual(['weekly lead target 40', 'lead to qualified 32%'])
  })

  it('a day with no log says so in words; a day with one lists what was entered, lists included', () => {
    expect(dayLog("Sara Khan's ITAD daily log", '2026-11-15', null)).toMatchObject({ rows: [], head: ["Sara Khan's ITAD daily log: nothing was logged for 2026-11-15."] })
    const d = dayLog('Lead Gen daily log', '2026-11-13', { id: 'e1', userId: 'u1', date: '2026-11-13', leadsGenerated: 12, notes: 'Slow morning', status: 'SUBMITTED', verticalCounts: [{ verticalId: 'v1', vertical: { name: 'Education' }, count: 7 }], createdAt: 'x' })
    expect(d.rows).toEqual([{ field: 'leads generated', value: 12 }, { field: 'notes', value: 'Slow morning' }, { field: 'status', value: 'SUBMITTED' }, { field: 'vertical counts: Education', value: 'count 7' }])
  })

  it('Metra knows the screens outside the Department Studio menu, and which one an address belongs to', () => {
    expect(screenAt('/app/leads/board')?.label).toBe('Deal Board')
    // One lead's own page is part of Leads; an evaluation being edited is part of Evaluations.
    expect(screenAt('/app/leads/cmabc123')?.label).toBe('Leads')
    expect(screenAt('/app/qa/evaluations/cmx/edit')?.label).toBe('Evaluations')
    expect(screenAt('/app/admin/tags')?.label).toBe('Tags')
    expect(screenAt('/app/itad/dialer')?.label).toBe('Lead Dialer')
    const keys = MORE_SCREENS.map((x) => x.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const x of MORE_SCREENS) { expect(x.description.length, x.key).toBeGreaterThan(20); for (const a of x.app) expect(a.startsWith('/app/'), x.key).toBe(true) }
  })

  it('Lead Management is offered only to people who have a place in it, with the switch on', () => {
    const base = asker('MEMBER', ['LEAD_GEN'])
    const leads = (a: Asker) => readable(a).filter((e) => e.key.startsWith('leads.')).map((e) => e.key)
    expect(leads(base)).toEqual([])
    // In a business, but the switch is off for the company (the LEAD source is then left out).
    expect(leads({ ...base, principals: new Set(['leads']) })).toEqual([])
    expect(leads({ ...base, principals: new Set(['leads']), sources: new Set(['LEAD']) }).sort()).toEqual(['leads.board', 'leads.businesses', 'leads.calls', 'leads.contacts', 'leads.dashboard', 'leads.queue', 'leads.report', 'leads.tasks'])
  })

  it('the team lists, the register and a profile are for team leads; the QA team list for the QA lead; the social numbers for the social team and the leads', () => {
    const has = (a: Asker, k: string) => readable(a).some((e) => e.key === k)
    const member = asker('MEMBER', ['MARKETING']), lead = asker('TEAM_LEAD', ['MARKETING'])
    for (const k of ['attendance.register', 'people.profile', 'admin.tags', 'marketing.social_compare']) { expect(has(member, k), k).toBe(false); expect(has(lead, k), k).toBe(true) }
    expect(has(member, 'marketing.social')).toBe(false)
    expect(has({ ...member, principals: new Set(['sub:social']) }, 'marketing.social')).toBe(true)
    expect(has(lead, 'marketing.social')).toBe(true)
    expect(has(asker('QA' as Asker['role'], []), 'qa.people')).toBe(false)
    expect(has(asker('QA_LEAD' as Asker['role'], []), 'qa.people')).toBe(true)
    expect(has(asker('QA' as Asker['role'], []), 'qa.scorecard')).toBe(true)
    expect(has(member, 'qa.scorecard')).toBe(false)
  })

  it('every entry points to a real screen address and no two entries share a name', () => {
    const keys = ENTRIES.map((e) => e.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const e of ENTRIES) if (e.app) expect(screenAt(e.app), `${e.key} -> ${e.app}`).not.toBeNull()
  })
})
