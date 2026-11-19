import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import type { AddressInfo } from 'node:net'

/**
 * Does Metra know the whole app? (docs/metra/ROADMAP.md §2, "the gate that ends the patch cycle")
 *
 *   npm run metra:coverage -w server -- --erp
 *
 * Part 1, from the code alone. Nothing may be left unaccounted for:
 *   - every screen of the web app is in Metra's list of screens (lib/blocks.ts or lib/metra/catalog/screens.ts);
 *   - every screen of the menu is read by a catalog entry, has a tool of its own, or is named here as holding no data;
 *   - every read route of every router is read by an entry, read by a tool of its own, or named here with the reason
 *     it is not (a file, a setting, or left out on purpose);
 *   - every table is shown by an entry, in the search index, or named here with the reason it is not.
 * A new screen, route or table that nobody placed fails here, before it can fail for a person.
 *
 * Part 2, on the test database: every entry is read through the app's own API as each kind of person who may open it
 * (it must answer), and as a person who may not (it must refuse). While it reads, the addresses it calls are written
 * down: an entry must read every route it says it stands for, and no route it does not say.
 *
 * It runs on a database on this computer. It reads, except for the METRA-CHECK test rows of Lead Management and the
 * Daily Report (scripts/metraSeedMore.ts; `npm run metra:check -w server -- --erp --unseed` takes them out) and the
 * switches of those parts, which it turns on for the test company while it runs and puts back after.
 */

const argv = process.argv.slice(2)
const flag = (f: string) => argv.includes(f)
const url = process.env.DATABASE_URL ?? ''
if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) { console.error('metra:coverage runs on a database on this computer. Stopping.'); process.exit(1) }
if (flag('--erp')) process.env.DATABASE_URL = url.replace(/\/[^/?]+(\?|$)/, '/pulsetrack_erp$1')

/** Screens of the menu that hold settings, not data a person asks about. Where each is, Metra knows from its list of screens. */
const NOT_A_DATA_SCREEN: Record<string, string> = {
  connectors: 'a settings screen: the keys that connect Claude and other assistants',
}

/** Read routes Metra reads through a tool of its own (or its search), not through metriq_data. */
const OWN_TOOL: Record<string, string> = {
  '/api/itad/bids/team-active': 'deal_tracker',
  '/api/dialer/leads/:id': 'dialer_lead',
  '/api/dialer/leads-search': 'dialer_leads',
  '/api/leads': 'leads_list',
  '/api/leads/:id': 'lead_get',
  '/api/projects/tasks/:code': 'get_ticket',
  '/api/projects/:key': 'list_projects',
  '/api/projects/:key/board': 'list_project_tickets',
  '/api/projects/:key/members': 'list_project_members',
  '/api/chat/search': 'search (chat messages are in the search index, by conversation and day)',
  '/api/chat/conversations/:id': 'search (chat messages are in the search index)',
  '/api/chat/conversations/:id/messages': 'search (chat messages are in the search index)',
  '/api/chat/projects/:key': 'search (a project\'s chat is in the search index)',
  '/api/chat/calls/:callId/notes': 'search (call notes and transcripts are in the search index)',
  '/api/search': "search (Metra's own search reads the same records)",
  '/api/feedback/:id': 'search (feedback threads and their replies are in the search index)',
  '/api/worklog/search': 'search (to-dos and their notes are in the search index)',
}

/** Read routes that are not data to ask about: files, pickers, settings and the app's own machinery. Each with its reason. */
const NOT_DATA: Record<string, string> = {
  '/api/health': 'a ping that says the server is up',
  '/api/dialer/settings': 'settings of the Lead Dialer',
  '/api/dialer/prefs': "a person's own Lead Dialer settings",
  '/api/dialer/integration': 'the Earth Zone connection (it holds a key)',
  '/api/dialer/imports/:id/changes': 'one import row by row; the list of imports gives its totals',
  '/api/reports/team.csv': 'a file to download',
  '/api/marketing/attachments/:id/download': 'a file to download',
  '/api/marketing/tasks/:id/attachments': 'the files of one marketing item; the item itself lists them',
  '/api/attendance/team.csv': 'a file to download (the same numbers as Team attendance over a period)',
  '/api/attendance/shift': "the team's shift hours as a setting; Team attendance gives the shift with its numbers",
  '/api/admin/leave/members': 'the people picker of the leave form',
  '/api/reports/monthly/preview': 'the monthly report laid out as the email that is sent; reports.monthly gives its numbers',
  '/api/reports/management/preview': 'the management report laid out as the email that is sent; reports.monthly gives its numbers',
  '/api/qa/unread-count': 'a badge count',
  '/api/qa/agents/:id/activity': "an agent's call numbers of the week and month, shown beside the evaluation form; reports and people.profile give the same numbers",
  '/api/feedback/unread-count': 'a badge count',
  '/api/worklog/people': 'the people picker of the to-do screen',
  '/api/notes/people': 'the people picker of Notes (share a note, @mention)',
  '/api/notes/:id': 'one note opened on its own (the same notes are read by the notes.mine entry)',
  '/api/worklog/note-sources': 'a helper of the to-do notes form',
  '/api/chat/unread': 'a badge count',
  '/api/custom/:id/summary': 'the cards above a custom block; custom.records counts its records itself',
  '/api/attendance/ip-check': 'checks the office network for check-in',
  '/api/attendance/shift/user/:userId': "one person's own shift setting; the team's shift is given with Team attendance",
  '/api/attendance/:userId/:date/breaks': "each single break of one person on one day; the day's break totals are given",
  '/api/notifications/muted': 'which kinds of notification a person muted (a setting)',
  '/api/qa/recordings/:id': 'a call recording (audio)',
  '/api/attachments': 'the files attached to a daily log',
  '/api/attachments/:id/download': 'a file to download',
  '/api/projects/notification-prefs': "a person's own notification settings",
  '/api/projects/users': 'the people picker of a form',
  '/api/projects/reports/export.csv': 'a file to download',
  '/api/projects/tasks/:code/brief': 'the same ticket written out as a brief for Claude',
  '/api/projects/attachments/:id/download': 'a file to download',
  '/api/chat/files/:messageId': 'a file to download',
  '/api/chat/calls/active': 'the calls going on right now',
  '/api/chat/calls/:callId/poll': 'a live call',
  '/api/chat/conversations/:id/guest-link': 'a link for a guest to join a call',
  '/api/meetings/:id': 'one meeting: the list gives the same fields',
  '/api/meetings/:id/ics': 'a calendar file to download',
  '/api/push/key': 'the set-up of phone notifications',
  '/api/docs/:id/file': 'a file to download (the list of documents is itad.docs)',
  '/api/leads/calls/:id/recording': 'a call recording (audio)',
  '/api/leads/unmatched/:id/recording': 'a call recording (audio)',
  '/api/leads/talkloop': 'the phone system connection',
  '/api/leads/export.csv': 'a file to download',
  '/api/leads/contacts.csv': 'a file to download',
  '/api/leads/check': 'the duplicate check while a lead is typed in',
  '/api/leads/businesses/:id/lists': "a business's do-not-call and customer lists (Lead Settings); each lead already says whether it is on them",
  '/api/leads/import-sheet/columns': 'a helper of the import form',
  '/api/flags': 'which parts of Metriq are switched on',
  '/api/company': 'Company Settings',
  '/api/company/roles': 'Company Settings: the roles',
  '/api/company/people': 'Company Settings: the people picker (people are read through people.directory)',
  '/api/daily-report/forms/:id/monthly.csv': 'a file to download',
  '/api/setup': 'the first-steps checklist of a new company',
}

/** Whole routers that are never read, on purpose. A decision, not an oversight (docs/metra/DESIGN.md §6). */
const LEFT_OUT: Record<string, string> = {
  '/api/auth': 'signing in and out',
  '/api/avatars': 'profile pictures',
  '/api/guest': 'a guest joining a call',
  '/api/admin/login-events': 'sign-ins: they hold IP addresses',
  '/api/admin/audit-log': 'the log of changes: it holds IP addresses',
  '/api/admin/attendance-activity': 'check-in attempts: they hold IP addresses',
  '/api/admin/office-networks': 'the office network addresses',
  '/api/financials': 'money and salaries',
  '/api/claude': 'the keys of connected assistants',
  '/api/mcp': 'the keys of connected assistants',
  '/api/metra': "Metra's own chats and settings",
  '/api/system-health': 'errors and checks of the software, for the developers',
  '/api/support': 'messages between the company and Metriq support',
  '/api/owner': "the platform owner's console, not a company's data",
  '/api/billing': 'the plan, invoices and payment',
  '/api/lead-in': 'where website forms and the phone system send new leads in',
  '/api/dialer-hook': 'where the Earth Zone sync sends leads in',
}

/** Tables Metra must never read or index (docs/metra/DESIGN.md §6): secrets, logins, billing, its own records, machinery. */
const NEVER = new Set(['AppSecret', 'ClaudeKey', 'LoginEvent', 'AuditLog', 'PushSubscription', 'PushDevice', 'SalaryRecord', 'Subscription', 'Invoice', 'BillingEvent', 'PlatformOwner', 'OwnerAuditLog', 'PlatformSetting', 'FeatureFlag', 'FeatureFlagCompany', 'CompanyUsage', 'ErrorGroup', 'ErrorEvent', 'AuditRun', 'AuditCheck', 'JobHeartbeat', 'UptimeEvent', 'AiChunk', 'AiConversation', 'AiMessage', 'AiInsight', 'AiIndexState', 'Notification', 'BlockedCheckIn', 'OfficeNetwork', 'DialerIntegration', 'CallRecording', 'EntryAttachment', 'PmAttachment', 'SentMonthlyReport', 'AttendanceReminder', 'PmDispatchLog', 'PmNotifyPref', 'DialerUserPrefs', 'Company', 'SupportTicket', 'SupportMessage'])

/** Tables that are neither shown nor searched, each with the reason. A table in no list fails the gate. */
const TABLE_NOTES: Record<string, string> = {
  PmChecklistItem: "a ticket's checklist: get_ticket gives it",
  PmLabel: "the labels of a project: get_ticket gives a ticket's labels",
  PmTaskLabel: "a ticket's labels: get_ticket gives them",
  PmTaskWatcher: 'who follows a ticket (a notification setting)',
  PmExtensionRequest: 'a request for more time on a ticket: each one is a step in projects.ticket_history',
  ChatReaction: 'emoji reactions on chat messages',
  DialerSettings: 'settings of the Lead Dialer',
  CompanyRole: "the company's own roles (Company Settings); each person's role is in people.directory",
  LeadEvent: "the timeline of a lead: lead_get gives it",
}

const ACCOUNTS = ['admin', 'ecommerce.lead', 'ecommerce.member', 'inventory.lead', 'inventory.member', 'itad.lead', 'itad.member', 'leadgen.lead', 'leadgen.member', 'marketing.lead', 'marketing.seo', 'marketing.content', 'qa', 'csr.member']

const routeRe = (p: string) => new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z]+/g, '[^/]+')}$`)

async function main() {
  const { BLOCKS, BLOCK_GROUPS } = await import('../lib/blocks')
  const { ENTRIES, readable, readData, ctxOf } = await import('../lib/metra/catalog')
  const { MORE_SCREENS, NOT_A_SCREEN } = await import('../lib/metra/catalog/screens')
  const { traceCalls } = await import('../lib/metra/catalog/load')
  const { SOURCES } = await import('../lib/metra/sources')
  const problems: string[] = []

  // ---------------------------------------------------------------- 1. screens
  const group = new Map(BLOCK_GROUPS.map((g) => [g.key as string, g.label]))
  const keys = new Set(BLOCKS.map((b) => b.key as string))
  for (const e of ENTRIES) for (const b of e.blocks) if (!keys.has(b)) problems.push(`Entry ${e.key} names a screen that does not exist: ${b}`)
  const dupes = ENTRIES.map((e) => e.key).filter((k, i, all) => all.indexOf(k) !== i)
  if (dupes.length) problems.push(`Two entries share a name: ${[...new Set(dupes)].join(', ')}`)
  let counted = 0, guided = 0
  console.log('SCREENS OF THE MENU (Department Studio)')
  for (const b of BLOCKS) {
    const es = ENTRIES.filter((e) => e.blocks.includes(b.key))
    const readers = es.filter((e) => e.load && e.table)
    const name = `${group.get(b.group) ?? b.group} > ${b.label}`
    if (readers.length) { counted++; console.log(`  counted   ${name.padEnd(42)} ${readers.map((e) => e.key).join(', ')}`) }
    else if (es.length) { guided++; console.log(`  own tool  ${name.padEnd(42)} ${es.map((e) => e.key).join(', ')}`) }
    else if (NOT_A_DATA_SCREEN[b.key]) console.log(`  left out  ${name.padEnd(42)} (${NOT_A_DATA_SCREEN[b.key]})`)
    else problems.push(`The screen ${name} is covered by no entry`)
  }
  console.log(`  ${BLOCKS.length} screens: ${counted} read and counted by Metriq (metriq_data), ${guided} with a guide line and a tool of their own, ${Object.keys(NOT_A_DATA_SCREEN).length} with no data to ask about.`)

  // Every address of the web app is a screen Metra knows (so it can say where things are, and which page a person is on).
  console.log('\nEVERY SCREEN OF THE WEB APP')
  const router = fs.readFileSync(path.resolve(__dirname, '../../../client/src/routes/router.tsx'), 'utf8')
  const inApp = router.slice(router.indexOf("path: '/app'"))
  const rel = [...inApp.matchAll(/path: *'([^']*)'/g)].map((m) => m[1]).slice(1).filter((p) => p !== '*')
  // The pages of Lead Management are written under "leads" in the router.
  const li = rel.indexOf('leads'), afterLeads = rel.findIndex((p, k) => k > li && p.includes('/') && !p.startsWith('inbox'))
  const screens = [...new Set(rel.map((p, k) => `/app/${li >= 0 && k > li && k < afterLeads ? `leads/${p}` : p}`))]
  const known = (p: string) => BLOCKS.some((b) => b.app.some((a) => { const exact = a.endsWith('$'), at = exact ? a.slice(0, -1) : a; return exact ? p === at : p === at || p.startsWith(`${at}/`) })) || MORE_SCREENS.some((x) => x.app.some((at) => p === at || p.startsWith(`${at}/`)))
  let extra = 0
  for (const p of screens) {
    if (known(p)) continue
    if (NOT_A_SCREEN[p]) { extra++; console.log(`  not a screen  ${p}  (${NOT_A_SCREEN[p]})`); continue }
    problems.push(`The web app has the screen ${p}, which is in neither lib/blocks.ts nor lib/metra/catalog/screens.ts`)
  }
  for (const e of ENTRIES) if (e.app && !known(e.app)) problems.push(`Entry ${e.key} points to ${e.app}, which is not a screen Metra knows`)
  console.log(`  ${screens.length} addresses: ${screens.length - extra} are screens Metra knows (${BLOCKS.length} of the menu, ${MORE_SCREENS.length} others), ${extra} only send the person on.`)

  // ---------------------------------------------------------------- 2. every read route of every router
  console.log('\nEVERY READ ROUTE OF THE APP')
  const appSrc = fs.readFileSync(path.resolve(__dirname, '../app.ts'), 'utf8')
  const fileOf = new Map([...appSrc.matchAll(/import \{([^}]+)\} from '\.\/routes\/(\w+)'/g)].flatMap((m) => m[1].split(',').map((x) => [x.trim(), m[2]] as [string, string])))
  const mounts = [...[...appSrc.matchAll(/\['(\/api[^']*)',\s*(\w+)\]/g)].map((m) => [m[1], m[2]]), ...[...appSrc.matchAll(/app\.use\(\s*'(\/api[^']*)'\s*,\s*(\w+Router)\b/g)].map((m) => [m[1], m[2]])]
  const files = fs.readdirSync(path.resolve(__dirname, '../routes')).map((f) => f.replace(/\.ts$/, ''))
  for (const f of files) if (![...fileOf.values()].includes(f)) problems.push(`The route file routes/${f}.ts is not read by this check (it is not imported in app.ts the usual way)`)
  const claimed = new Map<string, string[]>()
  for (const e of ENTRIES) for (const a of e.apis) claimed.set(a, [...(claimed.get(a) ?? []), e.key])
  const real = new Set<string>()
  const tally = { entry: 0, tool: 0, notData: 0, leftOut: 0 }
  const leftOutSeen = new Map<string, number>()
  for (const [mount, name] of mounts as [string, string][]) {
    const file = fileOf.get(name)
    if (!file) { problems.push(`The router ${name} at ${mount} has no route file this check can read`); continue }
    const src = fs.readFileSync(path.resolve(__dirname, `../routes/${file}.ts`), 'utf8')
    for (const m of src.matchAll(new RegExp(`\\b${name}\\.get\\(\\s*'([^']*)'`, 'g'))) {
      const p = `${mount}${m[1] === '/' ? '' : m[1]}`
      real.add(p)
      const off = Object.keys(LEFT_OUT).find((k) => p === k || p.startsWith(`${k}/`))
      if (claimed.has(p)) tally.entry++
      else if (OWN_TOOL[p]) tally.tool++
      else if (NOT_DATA[p]) tally.notData++
      else if (off) { tally.leftOut++; leftOutSeen.set(off, (leftOutSeen.get(off) ?? 0) + 1) }
      else problems.push(`The read route ${p} is read by no entry and no tool, and is not named as left out`)
    }
  }
  for (const a of claimed.keys()) if (!real.has(a)) problems.push(`Entry ${claimed.get(a)!.join(', ')} says it reads ${a}, which is not a route of the app`)
  for (const [list, what] of [[OWN_TOOL, 'OWN_TOOL'], [NOT_DATA, 'NOT_DATA']] as const) for (const p of Object.keys(list)) {
    if (!real.has(p)) problems.push(`${what} in this script names ${p}, which is not a route of the app any more`)
    else if (claimed.has(p)) problems.push(`${what} in this script names ${p}, but the entry ${claimed.get(p)!.join(', ')} reads it now: take it off the list`)
  }
  console.log(`  ${real.size} read routes: ${tally.entry} read by a catalog entry, ${tally.tool} read by a tool of their own or by search, ${tally.notData} not data (files, pickers, settings), ${tally.leftOut} left out on purpose.`)
  console.log('  Read by a tool of their own:')
  for (const [p, t] of Object.entries(OWN_TOOL)) console.log(`    ${p.padEnd(44)} ${t}`)
  console.log('  Not data:')
  for (const [p, t] of Object.entries(NOT_DATA)) console.log(`    ${p.padEnd(44)} ${t}`)
  console.log('  Left out on purpose:')
  for (const [p, t] of Object.entries(LEFT_OUT)) console.log(`    ${p.padEnd(34)} ${String(leftOutSeen.get(p) ?? 0).padStart(2)} read routes   ${t}`)

  // ---------------------------------------------------------------- 3. tables
  console.log('\nTABLES')
  const schema = fs.readFileSync(path.resolve(__dirname, '../../prisma/schema.prisma'), 'utf8')
  const models = [...schema.matchAll(/^model (\w+) \{/gm)].map((m) => m[1])
  const shown = new Set(ENTRIES.flatMap((e) => e.models))
  const indexed = new Set(SOURCES.flatMap((s) => Object.keys(s.watch)))
  for (const m of [...shown]) if (!models.includes(m)) problems.push(`An entry names a table that does not exist: ${m}`)
  for (const m of [...shown]) if (NEVER.has(m)) problems.push(`The table ${m} is on the never-read list but an entry shows it`)
  for (const m of [...NEVER, ...Object.keys(TABLE_NOTES)]) if (!models.includes(m)) problems.push(`This script names the table ${m}, which does not exist any more`)
  const noted = models.filter((m) => !shown.has(m) && !indexed.has(m) && !NEVER.has(m) && TABLE_NOTES[m])
  const neither = models.filter((m) => !shown.has(m) && !indexed.has(m) && !NEVER.has(m) && !TABLE_NOTES[m])
  for (const m of neither) problems.push(`The table ${m} is shown by no entry, is not in the search index, and is not named as left out`)
  console.log(`  ${models.length} tables: ${models.filter((m) => shown.has(m)).length} shown by an entry, ${models.filter((m) => indexed.has(m)).length} in the search index, ${models.filter((m) => NEVER.has(m)).length} never read (secrets, logins, billing, machinery), ${noted.length} left out with a reason.`)
  for (const m of noted) console.log(`    ${m.padEnd(26)} ${TABLE_NOTES[m]}`)

  // ---------------------------------------------------------------- 4. every entry, read as real kinds of people
  console.log('\nEVERY ENTRY, READ THROUGH THE APP AS EACH KIND OF PERSON')
  const { prisma } = await import('../lib/prisma')
  const { runAsCompany } = await import('../lib/tenancy')
  const { HOME_COMPANY_ID } = await import('../lib/company')
  const { createApp } = await import('../app')
  const { setAuditBaseUrl } = await import('../lib/health/audit')
  const { askerOf, forgetAsker } = await import('../lib/metra/access')
  const { setCompanyFlag, resetFlagCache } = await import('../lib/flags')
  const { companyTz } = await import('../lib/time')
  const { seedMore, MORE_FLAGS, MORE_TRUTH } = await import('./metraSeedMore')
  const server = createApp().listen(0)
  setAuditBaseUrl(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)

  // Lead Management and the Daily Report are switched off for the test company: on while this runs, then back.
  const before = await prisma.featureFlagCompany.findMany({ where: { companyId: HOME_COMPANY_ID, key: { in: [...MORE_FLAGS] } } })
  for (const k of MORE_FLAGS) await setCompanyFlag(k, HOME_COMPANY_ID, true, 'metra:coverage')
  resetFlagCache(); forgetAsker()

  const readBy = new Map<string, number>()
  const called = new Map<string, Set<string>>()
  let reads = 0, refused = 0, empty = 0
  try {
    await runAsCompany(HOME_COMPANY_ID, async () => {
      const find = async (name: string) => prisma.user.findFirst({ where: { email: `${name}@test.local`, isActive: true }, select: { id: true, role: true, name: true } })
      const [admin, manager, rep, dialer] = await Promise.all([find('admin'), find('leadgen.lead'), find('leadgen.member'), find('itad.member')])
      if (admin && manager && rep && dialer) await seedMore(prisma, { admin, manager, rep, dialer }, companyTz())
      // Entries that take a choice are also read with it, so every route they stand for is really read.
      const ticket = await prisma.pmTask.findFirst({ select: { code: true }, orderBy: { createdAt: 'desc' } })
      const brand = await prisma.brand.findFirst({ where: { isActive: true }, select: { name: true }, orderBy: { name: 'asc' } })
      const evaluated = await prisma.qaEvaluation.findFirst({ select: { agent: { select: { name: true } } }, orderBy: { createdAt: 'desc' } })
      const more: Record<string, Record<string, unknown>[]> = {
        'dialer.history': [{ item: 'notes' }, { item: 'claude' }],
        'daily_report.entries': [{ range: 'month' }],
        'leads.dashboard': [{ item: MORE_TRUTH.business, range: 'week' }],
        'leads.contacts': [{ item: MORE_TRUTH.business }],
        'projects.ticket_history': ticket ? [{ item: ticket.code }] : [],
        'marketing.social_compare': brand ? [{ item: brand.name }] : [],
        'qa.evaluation': evaluated ? [{ item: evaluated.agent.name }] : [],
      }
      for (const name of ACCOUNTS) {
        const u = await find(name)
        if (!u) { problems.push(`The test account ${name}@test.local is missing (npx tsx prisma/test-users.ts)`); continue }
        const a = await askerOf(u.id)
        const open = readable(a)
        for (const e of open) {
          const note = (calls: string[]) => { const s = called.get(e.key) ?? new Set<string>(); for (const c of calls) s.add(c); called.set(e.key, s) }
          traceCalls(true)
          const r = await readData(a, u, { what: e.key })
          note(traceCalls(false))
          reads++
          // An entry about ONE item answers "say which" when none is named: that is the entry working.
          const which = /^Say (which|whose)/.test(r.text)
          const fine = r.ok || (e.takes?.includes('item') && which)
          if (!fine) problems.push(`${e.key} as ${name}: ${r.text.slice(0, 200)}`)
          else readBy.set(e.key, (readBy.get(e.key) ?? 0) + 1)
          if (flag('--show') && r.ok) console.log(`\n--- ${e.key} as ${name}\n${r.text.slice(0, 1500)}`)
          // Then with a choice: the first thing it offered, and the choices written above.
          // "Say which X (...). There are: A; B; C." (or "Tasks: A; B", "Agents: A, B"): the first one offered.
          const offered = which ? r.text.replace(/^[^:]*:\s*/, '') : ''
          const first = offered && offered !== r.text ? offered.split(/;\s|,\s/)[0].replace(/\.$/, '').trim() : undefined
          for (const args of [...(first && first !== 'none' ? [{ item: first }] : []), ...(more[e.key] ?? [])]) {
            traceCalls(true)
            const again = await readData(a, u, { what: e.key, ...args })
            note(traceCalls(false))
            reads++
            if (!again.ok && !/^Nothing here|^Say (which|whose)|fits \d+ /.test(again.text)) problems.push(`${e.key} as ${name} with ${JSON.stringify(args)}: ${again.text.slice(0, 200)}`)
            if (flag('--show') && again.ok) console.log(`\n--- ${e.key} as ${name} with ${JSON.stringify(args)}\n${again.text.slice(0, 1500)}`)
          }
        }
        // What this person may NOT open must be refused by the app itself, not only hidden from the list.
        for (const e of ENTRIES.filter((x) => x.load && x.table && !open.includes(x))) {
          const got = await e.load!(ctxOf(a, u), {})
          if ('error' in got) { refused++; continue }
          // Some screens answer anyone with what is theirs (Lead Management: your own leads). For a person who has
          // none, that must be nothing at all: no rows, or figures that are all zero.
          const nothing = got.rows.length === 0 || got.rows.every((r) => 'figure' in r && Number(r.value) === 0)
          if (nothing) empty++
          else problems.push(`${e.key} was readable by ${name}, who should not be able to open it`)
        }
        console.log(`  ${name.padEnd(18)} reads ${open.length} data sets: ${open.map((e) => e.key).join(', ')}`)
      }
    })
  } finally {
    for (const k of MORE_FLAGS) { const b = before.find((x) => x.key === k); await setCompanyFlag(k, HOME_COMPANY_ID, b ? b.enabled : null, 'metra:coverage') }
  }
  for (const e of ENTRIES.filter((x) => x.load && x.table)) {
    if (!readBy.get(e.key)) { problems.push(`${e.key} was not read successfully by any test account`); continue }
    // What it says it reads, and what it read.
    const got = [...(called.get(e.key) ?? [])]
    for (const a of e.apis) if (!got.some((c) => routeRe(a).test(c))) problems.push(`${e.key} says it reads ${a} but never did`)
    for (const c of got) if (!e.apis.some((a) => routeRe(a).test(c))) problems.push(`${e.key} reads ${c} without saying so in its list of routes`)
  }
  console.log(`  ${reads} reads made. Of the screens a person may not open: ${refused} reads refused by the app, ${empty} answered with nothing (the screen gives everyone their own, and they have none). Every entry was checked against the routes it says it reads.`)
  server.close()
  await prisma.$disconnect()

  console.log(problems.length ? `\nNOT COVERED (${problems.length}):\n${problems.map((p) => `  - ${p}`).join('\n')}` : '\nCovered: every screen, every read route and every table of the app is read by Metra or named with the reason it is not; every entry reads what it says, and nobody reads an entry of a screen they may not open.')
  process.exit(problems.length ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
