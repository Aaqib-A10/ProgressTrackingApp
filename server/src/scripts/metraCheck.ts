import 'dotenv/config'
import type { AddressInfo } from 'node:net'

/**
 * Metra's check before going live (docs/metra/DESIGN.md §8): real questions, asked as real kinds of people, on a
 * database with as much data as the live one, and every answer compared with what the screen shows.
 *
 * Why: Metra passed every test on a copy with 4 Lead Dialer leads, then on live (thousands of leads, a smaller model
 * filling in tool options its own way) it told an agent "you have no Interested leads" and "I can't read the total".
 * Nothing goes live unless this passes.
 *
 *   npm run metra:check -w server -- --erp            seed (once), ask everything, print pass / fail
 *   npm run metra:check -w server -- --erp --only 3,7 only those questions
 *   npm run metra:check -w server -- --erp --unseed   take the test rows out again
 *
 * --erp uses the local erp database (pulsetrack_erp, the one `npm run dev:erp` runs on). It only ever touches a
 * database on this computer, and only rows it made itself (Lead Dialer list "METRA-CHECK", bids titled "METRA-CHECK").
 * It needs the test accounts (npx tsx prisma/test-users.ts) and the model key in server/.env.
 */

const argv = process.argv.slice(2)
const flag = (f: string) => argv.includes(f)
const opt = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }

const url = process.env.DATABASE_URL ?? ''
if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) { console.error('metra:check only runs on a database on this computer. Stopping.'); process.exit(1) }
if (flag('--erp')) process.env.DATABASE_URL = url.replace(/\/[^/?]+(\?|$)/, '/pulsetrack_erp$1')

const MARK = 'METRA-CHECK'
const INTERESTED = ['Zephyr Dental Group', 'Halcyon Freight Lines', 'Orchid Research Labs', 'Marlow County Schools']
const PIPELINE = ['Kestrel Community Bank', 'Juniper Family Clinic', 'Tamarind Foods Inc']
const BULK: [string, number][] = [['Assigned', 1200], ['Contact Attempted', 600], ['Voicemail Sent', 400], ['Not Interested', 200], ['Connected', 93]]
const WON = [{ company: 'Quartz Valley Hospital', awarded: 5400 }, { company: 'Ridgeway Technical College', awarded: 12250 }]

type U = { id: string; role: import('@prisma/client').Role; name: string }
interface Truth { total: number; byStatus: Record<string, number>; interested: string[]; teamTotal: number; leadTotal: number; won: { company: string; awarded: number }[]; deals: { active: number; submitted: number; won: number; lost: number }; notSubmitted: number }
interface Case { as: 'member' | 'lead' | 'admin'; ask: string; history?: { role: 'user' | 'assistant'; content: string }[]; numbers?: (t: Truth) => number[]; names?: (t: Truth) => string[]; note: string }

const CASES: Case[] = [
  { as: 'member', ask: 'how many leads do i hv in total ?', numbers: (t) => [t.total], note: 'total leads' },
  { as: 'member', ask: 'can you let me know of my interested and won clients leads', names: (t) => [...t.interested, ...t.won.map((w) => w.company)], note: 'Interested leads and won deals' },
  { as: 'member', ask: 'can you not see interested clients in lead dialer', names: (t) => t.interested, note: 'Interested leads, by name',
    history: [{ role: 'user', content: 'my interested leads?' }, { role: 'assistant', content: 'No "Interested" leads are currently assigned to you in the Lead Dialer.' }] },
  { as: 'member', ask: 'show my intrested leads', names: (t) => t.interested, note: 'a misspelt status' },
  { as: 'member', ask: 'how many leads do I have in each status?', numbers: (t) => [t.byStatus.Interested, t.byStatus.Pipeline, t.byStatus.Assigned, t.byStatus['Voicemail Sent']], note: 'counts per status' },
  { as: 'member', ask: 'https://pulsetrack.online/app/itad/dialer this the url where all of my leads are. how many are there', numbers: (t) => [t.total], note: 'a Metriq address in the question' },
  { as: 'member', ask: 'which of my leads are in pipeline', names: () => PIPELINE, note: 'Pipeline leads, by name' },
  { as: 'member', ask: 'mere kitne deals won hain aur total kitna hai', numbers: (t) => [t.won.length, t.won.reduce((s, w) => s + w.awarded, 0)], note: 'won deals and their total (Roman Urdu)' },
  { as: 'lead', ask: 'how many leads does the whole ITAD team have in the lead dialer?', numbers: (t) => [t.teamTotal], note: 'team total (manager)' },
  { as: 'lead', ask: 'how many interested leads does Test ITAD Member have, and who are they', numbers: (t) => [t.interested.length], names: (t) => t.interested, note: 'one rep, named by a manager' },
  { as: 'lead', ask: 'how many leads do I have myself?', numbers: (t) => [t.leadTotal], note: "the manager's own leads" },
  { as: 'admin', ask: 'Give me a summary of the Deal Tracker: how many Active, Submitted, Won and Lost bids', numbers: (t) => [t.deals.active, t.deals.submitted, t.deals.won, t.deals.lost], note: 'Deal Tracker cards' },
  { as: 'admin', ask: "How many people haven't submitted their daily report today?", numbers: (t) => [t.notSubmitted], note: 'missing reports' },
  { as: 'member', ask: 'where in metriq do I add a new bid?', names: () => ['Deal Tracker'], note: 'knows its own screens' },
]

/** Words that mean Metra gave up; never right when the data is there. */
const GAVE_UP = /couldn['’]?t (find|pull|get|read)|could not (find|read|pull)|unable to|not able to|try again|isn['’]?t returning|not returning|no data (is )?available|don['’]?t have (any )?(data|access|information)/i

async function main() {
  // Loaded only now: the database address above must be set first.
  const { prisma } = await import('../lib/prisma')
  const { runAsCompany } = await import('../lib/tenancy')
  const { HOME_COMPANY_ID } = await import('../lib/company')
  const { createApp } = await import('../app')
  const { setAuditBaseUrl } = await import('../lib/health/audit')
  const { apiAs } = await import('../lib/mcp/api')
  const { askerOf } = await import('../lib/metra/access')
  const { answer } = await import('../lib/metra/agent')
  const { llmReady, llmModel, llmBase } = await import('../lib/metra/llm')
  const { setCompanyFlag } = await import('../lib/flags')
  const { DEFAULT_STAGE_MAP } = await import('../lib/dialer/rules')

  const find = async (email: string): Promise<U> => {
    const u = await prisma.user.findFirst({ where: { email, isActive: true }, select: { id: true, role: true, name: true } })
    if (!u) { console.error(`The test account ${email} is missing. Run: npx tsx prisma/test-users.ts`); process.exit(1) }
    return u
  }
  const people = { member: await find('itad.member@test.local'), lead: await find('itad.lead@test.local'), admin: await find('admin@test.local') }

  const unseed = () => runAsCompany(HOME_COMPANY_ID, async () => {
    const a = await prisma.dialerLead.deleteMany({ where: { listName: MARK } })
    const b = await prisma.bid.deleteMany({ where: { title: { startsWith: MARK } } })
    return a.count + b.count
  })
  if (flag('--unseed')) { console.log(`Took out ${await unseed()} test rows.`); await prisma.$disconnect(); return }

  await runAsCompany(HOME_COMPANY_ID, async () => {
    const have = await prisma.dialerLead.count({ where: { listName: MARK, ownerId: people.member.id } })
    const want = INTERESTED.length + PIPELINE.length + BULK.reduce((s, [, n]) => s + n, 0)
    if (have === want && !flag('--reseed')) return
    await prisma.dialerLead.deleteMany({ where: { listName: MARK } })
    await prisma.bid.deleteMany({ where: { title: { startsWith: MARK } } })
    const states = ['Texas', 'Ohio', 'Florida', 'Georgia', 'Nevada', 'Oregon']
    const row = (ownerId: string, i: number, company: string, status: string) => ({ ownerId, matchKey: `check:${i}`, company, status, stage: DEFAULT_STAGE_MAP[status] ?? 1, maxStage: DEFAULT_STAGE_MAP[status] ?? 1, listName: MARK, contactName: `Contact ${i}`, phone: `555${String(1000000 + i)}`, state: states[i % states.length], industry: i % 3 ? 'Education' : 'Health Care' })
    let i = 0
    const rows = [
      ...INTERESTED.map((c) => row(people.member.id, i++, c, 'Interested')),
      ...PIPELINE.map((c) => row(people.member.id, i++, c, 'Pipeline')),
      ...BULK.flatMap(([status, n]) => Array.from({ length: n }, () => { i++; return row(people.member.id, i, `Check Company ${i}`, status) })),
      ...Array.from({ length: 300 }, () => { i++; return row(people.lead.id, i, `Lead Own Company ${i}`, i % 2 ? 'Assigned' : 'Connected') }),
    ]
    for (let k = 0; k < rows.length; k += 500) await prisma.dialerLead.createMany({ data: rows.slice(k, k + 500) })
    const itad = await prisma.department.findFirst({ where: { type: 'ITAD' }, select: { id: true } })
    const soon = new Date(Date.now() + 5 * 86400000), past = new Date(Date.now() - 20 * 86400000)
    const bid = (title: string, company: string, status: 'ACTIVE' | 'WON' | 'LOST', awarded: number | null) => ({ title: `${MARK} ${title}`, company, type: 'PO' as const, agentId: people.member.id, departmentId: itad?.id ?? null, status, dueDate: status === 'ACTIVE' ? soon : past, priceQuoted: 3000, awardedPrice: awarded, closedDate: status === 'ACTIVE' ? null : past })
    await prisma.bid.createMany({ data: [...WON.map((w, k) => bid(`buyback ${k + 1}`, w.company, 'WON', w.awarded)), bid('lost one', 'Sable Logistics', 'LOST', 0), bid('open one', 'Tindall Motors', 'ACTIVE', null)] })
    console.log(`Seeded ${rows.length.toLocaleString('en-US')} Lead Dialer leads and 4 bids (list / title "${MARK}").`)
  })
  await setCompanyFlag('metra', HOME_COMPANY_ID, true, 'metra:check')
  // What Metra knows about Metriq's own screens is part of its index: make sure it is there.
  const { indexNow } = await import('../lib/metra/indexer')
  await runAsCompany(HOME_COMPANY_ID, () => indexNow(HOME_COMPANY_ID, ['APP_SCREEN']))
  if (!llmReady()) { console.error('No model key in server/.env (GROQ_API_KEY or METRA_LLM_API_KEY). Stopping.'); process.exit(1) }

  // The app itself, on a free port: tools read through its real API, with every permission check.
  const server = createApp().listen(0)
  setAuditBaseUrl(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)

  // What the screens show (read through the same API the pages use), to compare the answers with.
  type Lead = { company: string; status: string; duplicate: boolean }
  const leadsOf = async (u: U, rep: string) => ((await apiAs(u, 'GET', '/api/dialer/data', { query: { rep } })).body as { leads: Lead[] }).leads.filter((l) => !l.duplicate)
  const truth: Truth = await runAsCompany(HOME_COMPANY_ID, async () => {
    const mine = await leadsOf(people.member, 'me')
    const byStatus: Record<string, number> = {}
    for (const l of mine) byStatus[l.status] = (byStatus[l.status] ?? 0) + 1
    const deals = (await apiAs(people.admin, 'GET', '/api/itad/bids')).body as { summary: Truth['deals'] }
    const myDeals = (await apiAs(people.member, 'GET', '/api/itad/bids')).body as { bids: { company: string; status: string; awardedPrice: number | null }[] }
    const missing = (await apiAs(people.admin, 'GET', '/api/notifications/not-submitted')).body as { total: number }
    return {
      total: mine.length, byStatus, interested: mine.filter((l) => l.status === 'Interested').map((l) => l.company),
      teamTotal: (await leadsOf(people.lead, 'all')).length, leadTotal: (await leadsOf(people.lead, 'me')).length,
      won: myDeals.bids.filter((b) => b.status === 'WON').map((b) => ({ company: b.company, awarded: b.awardedPrice ?? 0 })),
      deals: deals.summary, notSubmitted: missing.total,
    }
  })
  console.log(`Model: ${llmModel()} at ${llmBase().replace(/^https?:\/\//, '')}. The agent has ${truth.total.toLocaleString('en-US')} leads; the team ${truth.teamTotal.toLocaleString('en-US')}.\n`)

  const only = opt('--only')?.split(',').map(Number)
  const digits = (s: string) => s.replace(/(\d)[,   ](?=\d{3}\b)/g, '$1')
  const hasNumber = (text: string, n: number) => new RegExp(`(^|[^\\d.])${n}(\\.0+)?(?![\\d])`).test(digits(text))
  let failed = 0, asked = 0
  for (const [i, c] of CASES.entries()) {
    if (only && !only.includes(i + 1)) continue
    asked++
    const who = people[c.as]
    const t0 = Date.now()
    let text = '', problems: string[] = [], tools = ''
    try {
      const r = await runAsCompany(HOME_COMPANY_ID, async () => answer(await askerOf(who.id), c.history ?? [], c.ask, () => undefined))
      text = r.content
      tools = r.tools.map((x) => `${x.name}${x.ok ? '' : ' (FAILED: ' + (x.error ?? '').slice(0, 80) + ')'} ${JSON.stringify(x.args)}`).join(' ; ')
      for (const n of c.numbers?.(truth) ?? []) if (!hasNumber(text, n)) problems.push(`the number ${n.toLocaleString('en-US')} is missing`)
      for (const n of c.names?.(truth) ?? []) if (!text.toLowerCase().includes(n.toLowerCase())) problems.push(`"${n}" is missing`)
      if (GAVE_UP.test(text)) problems.push('it says it could not find or read something')
      if (r.tools.some((x) => !x.ok)) problems.push('a lookup failed')
      if (!text.trim()) problems.push('empty answer')
    } catch (e) { problems = [`error: ${(e as Error).message.slice(0, 200)}`] }
    const ok = problems.length === 0
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(i + 1).padStart(2)}. [${c.as}] ${c.ask}   (${c.note}; ${((Date.now() - t0) / 1000).toFixed(1)} s)`)
    if (!ok || flag('--show')) console.log(`      ${problems.join('; ') || 'ok'}\n      lookups: ${tools || 'none'}\n      answer: ${text.replace(/\s+/g, ' ').slice(0, 600)}\n`)
  }
  console.log(`\n${asked - failed} of ${asked} passed.${failed ? ' NOT ready to go live.' : ' Ready.'}`)
  server.close()
  await prisma.$disconnect()
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
