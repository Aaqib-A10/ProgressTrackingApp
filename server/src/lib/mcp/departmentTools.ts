import { DateTime } from 'luxon'
import type { Role } from '@prisma/client'
import { apiAs, apiError } from './api'
import { LEADS_GUIDE, WORK_GUIDE } from './workTools'
import { dealMoney } from '../dealMoney'
import { STATUSES, normalizeStatus } from '../dialer/rules'
import {
  REGION_META, clock, filterLeads, followUpTabs, funnelOf, isDialable, lastActivity, latestActedToday, leadRegion, leadState,
  daysSince, pct, regionWindow, REGIONS, PRESET_VIEWS, fmtSpan, joinMulti, multiOf,
  type DialerLead, type DialerSettings, type FollowUp, type LeadFilters, type RegionCode,
} from '../dialer/view'

/**
 * Connector tools for each team's own data (ITAD Lead Dialer, E-commerce, Lead Gen, Marketing,
 * attendance, reports...). They call Metriq's API as the person (see api.ts), so a tool shows
 * exactly what that person can open in the app, and nothing else.
 *
 * ITAD asked (Oct 2026): "which high-priority leads need follow-up", "who do I call first".
 * The connector could only see project tickets, so ChatGPT and Claude had to guess.
 */

type User = { id: string; role: Role; name: string }
type Content = { type: 'text'; text: string }
interface ToolResult { content: Content[]; isError?: boolean }
export interface DeptTool {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: Record<string, boolean>
  run: (u: User, args: Record<string, unknown>) => Promise<ToolResult>
}

const text = (t: string): ToolResult => ({ content: [{ type: 'text', text: t }] })
const fail = (t: string): ToolResult => ({ content: [{ type: 'text', text: t }], isError: true })
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const PKT_ZONE = 'Asia/Karachi'

// ------------------------------------------------------------------ reading any screen's data

/** Never through the connector: sign-in, keys, other people's private chats, salaries, raw files. */
const BLOCKED = [
  /^\/api\/(auth|claude|mcp|guest|push|avatars|system-health|financials|chat|rdp)(\/|$)/,
  /\/(download|file|files|ics|recordings|attachments)(\/|$)/,
  /\.csv$/,
  /\/ip-check$/,
]

export function readablePath(path: string): string | null {
  const p = path.trim().split('?')[0]
  if (!/^\/api\/[a-z0-9/_:.-]+$/i.test(p) || p.includes('..') || p.includes('//')) return 'Give an API path that starts with /api/, e.g. /api/ecommerce/board.'
  if (BLOCKED.some((re) => re.test(p))) return 'That part of Metriq is not open to connectors (sign-in, keys, private chats, salaries and file downloads stay in the app).'
  return null
}

/**
 * JSON made short for the assistant: no nulls, no empty lists, cut at a size it can read. Totals and other single
 * values come before lists, and each list says how many items it has, so a cut never loses the summary numbers and
 * nobody has to count rows.
 */
export function compact(v: unknown, max = 40_000): string {
  const prune = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(prune)
    if (x && typeof x === 'object') {
      const single: [string, unknown][] = [], lists: [string, unknown][] = []
      for (const [k, val] of Object.entries(x)) {
        if (val == null || (Array.isArray(val) && val.length === 0) || val === '') continue
        if (Array.isArray(val)) {
          // A list of people or things with names also gets a plain "names" line, so "who..." is answered with names.
          const names = val.every((x) => x && typeof x === 'object' && typeof (x as { name?: unknown }).name === 'string') ? val.map((x) => (x as { name: string }).name.trim()) : []
          if (names.length) single.push([`${k} names`, names.join(', ')])
          lists.push([`${k} (${val.length} items)`, prune(val)])
        } else single.push([k, prune(val)])
      }
      return Object.fromEntries([...single, ...lists])
    }
    return x
  }
  const s = typeof v === 'string' ? v : JSON.stringify(prune(v))
  return s.length > max ? `${s.slice(0, max)}\n\n[CUT at ${max.toLocaleString()} characters of ${s.length.toLocaleString()}: the lists above are incomplete, so do not count them; use the totals and "(N items)" counts, or ask for a smaller range.]` : s
}

/**
 * The app's screens take range=today|week|month|rolling3m|custom. An assistant also asks for "year", "last month",
 * "yesterday"... (live, 13 Nov: range=year on the ITAD numbers failed). Those are turned into the custom range they
 * mean; the returned note says which dates were read.
 */
export function fixRange(query: Record<string, string>, now: DateTime = DateTime.now().setZone(PKT_ZONE)): string | null {
  const raw = query.range
  if (!raw) return null
  const r = raw.toLowerCase().replace(/[\s_-]+/g, '')
  if (['today', 'week', 'month', 'rolling3m', 'custom'].includes(r)) { query.range = r; return null }
  const custom = (a: DateTime, b: DateTime, what: string) => { query.range = 'custom'; query.start = a.toISODate()!; query.end = b.toISODate()!; return `"${raw}" was read as ${what}: ${query.start} to ${query.end}.` }
  const simple = (to: string) => { query.range = to; return `"${raw}" was read as range=${to}.` }
  if (/^(day|daily|thisday)$/.test(r)) return simple('today')
  if (/^(weekly|thisweek|wtd)$/.test(r)) return simple('week')
  if (/^(monthly|thismonth|mtd)$/.test(r)) return simple('month')
  if (/^(quarter|quarterly|3m|3months|last3months|rolling3|90d|90days)$/.test(r)) return simple('rolling3m')
  if (/^(year|yearly|thisyear|ytd|annual)$/.test(r)) return custom(now.startOf('year'), now, 'this year so far')
  if (r === 'yesterday') return custom(now.minus({ days: 1 }), now.minus({ days: 1 }), 'yesterday')
  if (r === 'lastweek') { const s = now.startOf('week').minus({ weeks: 1 }); return custom(s, s.plus({ days: 6 }), 'last week') }
  if (r === 'lastmonth') { const s = now.startOf('month').minus({ months: 1 }); return custom(s, s.endOf('month'), 'last month') }
  if (r === 'lastyear') { const s = now.startOf('year').minus({ years: 1 }); return custom(s, s.endOf('year'), 'last year') }
  return simple('month')
}

interface Me { id: string; name: string; role: Role; department: string | null; subDepartment: string | null; isDeveloper?: boolean; memberships?: { department: string }[]; leadsRole?: 'MANAGER' | 'REP' | null }

async function whoAmI(u: User): Promise<Me | null> {
  const r = await apiAs(u, 'GET', '/api/auth/me')
  return r.status === 200 ? (r.body as { user: Me }).user : null
}

/** What each team can ask about, with the API paths behind the screens. */
const AREAS: { title: string; for: (m: Me) => boolean; lines: string[] }[] = [
  {
    title: 'Everyone',
    for: () => true,
    lines: [
      '/api/attendance/me : my attendance today (check-in, breaks, hours)',
      '/api/attendance/history?range=month : my attendance history (range: today, week, month, rolling3m, or custom with start=YYYY-MM-DD&end=YYYY-MM-DD)',
      '/api/todos : my to-do list',
      '/api/worklog : my work log',
      '/api/tasks/mine : my tasks (the My Tasks screen: every open task given to me, from projects and my own Marketing and E-commerce tasks, with how many are open, due today, overdue and finished)',
      '/api/meetings : my meetings',
      '/api/notifications : my notifications',
      '/api/search?q=WORDS : search people, tasks and files',
      'Project tickets: use list_my_tickets, get_ticket, list_projects and the other ticket tools.',
      ...WORK_GUIDE,
    ],
  },
  {
    title: 'Leads',
    for: (m) => !!m.leadsRole || m.role === 'SUPER_ADMIN',
    lines: LEADS_GUIDE,
  },
  {
    title: 'ITAD',
    for: (m) => inDept(m, 'ITAD'),
    lines: [
      'Lead Dialer: use dialer_summary, dialer_leads (follow-ups, who to call now, hot leads, filters) and dialer_lead; dialer_update_lead to log a note, call later or snooze; dialer_edit_lead to set the second phone, second email, LinkedIn, decision maker, best time or tags, or add alternative numbers.',
      '/api/itad/entries?date=YYYY-MM-DD : my daily log for a day',
      '/api/itad/team?range=week : the team\'s daily logs (team leads)',
      '/api/itad/analytics?range=month : calls, connects and results over time',
      'Deal Tracker (bids and deals): use deal_tracker for counts, totals, win rate, overdue and lists (it counts every deal; never count them yourself).',
      '/api/docs : ITAD Docs & Links',
    ],
  },
  {
    title: 'E-commerce',
    for: (m) => inDept(m, 'ECOMMERCE'),
    lines: [
      '/api/ecommerce/entries?date=YYYY-MM-DD : my daily listings entry for a day',
      '/api/ecommerce/team?range=month : team tasks, listing totals per person and per marketplace',
      '/api/ecommerce/board : the e-commerce task board',
      '/api/ecommerce/tasks/TASK_ID : one board task with its comments',
      '/api/ecommerce/meeting-notes : meeting notes',
      '/api/ecommerce/stock : stock issues and who has them',
    ],
  },
  {
    title: 'Lead Gen',
    for: (m) => inDept(m, 'LEAD_GEN'),
    lines: [
      '/api/leadgen/entries?date=YYYY-MM-DD : my daily entry',
      '/api/leadgen/team?range=week : the team (team leads)',
      '/api/leadgen/breakdown?range=month : results by source (team leads)',
      '/api/leadgen/analytics?range=month : trends (team leads)',
    ],
  },
  {
    title: 'Marketing',
    for: (m) => inDept(m, 'MARKETING'),
    lines: [
      '/api/marketing/board : the marketing team\'s work by status (social posts, content pieces, SEO items; shown in the Social Planner, Content board and SEO). Everybody\'s work, not "my tasks": for those read /api/tasks/mine',
      '/api/marketing/plan : the marketing plan',
      '/api/marketing/content : content calendar',
      '/api/marketing/seo/entries : SEO work log',
      '/api/marketing/social/monthly : social media monthly numbers',
      '/api/marketing/blogs : blogs',
      '/api/marketing/ads/summary : ads results',
      '/api/marketing/email : email campaigns',
      '/api/marketing/analytics : marketing analytics',
    ],
  },
  {
    title: 'Inventory',
    for: (m) => inDept(m, 'INVENTORY'),
    lines: ['/api/inventory/items : stock items', '/api/inventory/requests : stock requests'],
  },
  {
    title: 'QA',
    for: (m) => m.role === 'QA' || m.role === 'QA_LEAD' || m.role === 'SUPER_ADMIN',
    lines: ['/api/qa/evaluations : evaluations', '/api/qa/scorecards : scorecards', '/api/qa/team-dashboard : QA dashboard'],
  },
  {
    title: 'Team leads and Super Admins',
    for: (m) => m.role === 'TEAM_LEAD' || m.role === 'SUPER_ADMIN',
    lines: [
      '/api/attendance/team?range=today : who is in, late or on leave',
      '/api/attendance/register?range=month : every member x every day',
      '/api/admin/leave : leave days off and work from home (date and type for each person)',
      '/api/dashboard/team?range=week : team dashboard',
      '/api/feedback : feedback threads',
      '/api/notifications/not-submitted : who has not submitted today\'s report',
    ],
  },
  {
    title: 'Super Admin',
    for: (m) => m.role === 'SUPER_ADMIN',
    lines: ['/api/dashboard/executive?range=month : the executive dashboard', '/api/reports/monthly : monthly reports'],
  },
]

function inDept(m: Me, dept: string): boolean {
  return m.role === 'SUPER_ADMIN' || m.department === dept || !!m.memberships?.some((x) => x.department === dept)
}

// ------------------------------------------------------------------ Deal Tracker

interface DealRow {
  number: number; title: string; company: string; type: string; district: string; agentName: string; status: 'ACTIVE' | 'SUBMITTED' | 'WON' | 'LOST'
  dueDate: string; submissionType: string | null; priceQuoted: number | null; awardedPrice: number | null; bidBond: boolean; bidBondAmount: number | null; closedDate: string | null; reminderSet: boolean
}
export interface DealTrackerData { bids: DealRow[]; summary: { active: number; submitted: number; won: number; lost: number; wonValue: number } }

const STATUS_WORD: Record<DealRow['status'], string> = { ACTIVE: 'Active', SUBMITTED: 'Submitted', WON: 'Won', LOST: 'Lost' }

/**
 * The Deal Tracker as text for an assistant: the page's own summary cards first (exact, every deal the person can
 * see), then totals for the asked filter, per agent, and the deals. Counting is done here, never by the model.
 */
export function dealTrackerText(d: DealTrackerData, a: Record<string, unknown>, now: Date): string {
  const s = d.summary
  // A value that is not real (type "deal", status "pending") is ignored rather than turning every count into 0.
  const st = str(a.status).toLowerCase()
  const status = ['open', 'active', 'submitted', 'won', 'lost', 'closed'].includes(st) ? st : 'all'
  // An agent nobody here has deals under is left out, and said so. The model passes the asker's own name unasked; for
  // an admin with no deals of their own that turned "a summary of the Deal Tracker" into all zeros (metra:check, 14 Nov).
  const askedAgent = str(a.agent).toLowerCase()
  const agent = askedAgent && d.bids.some((b) => b.agentName.toLowerCase().includes(askedAgent)) ? askedAgent : ''
  const noAgent = askedAgent && !agent ? `No deal here is under an agent called "${str(a.agent)}", so that filter was left out: the numbers below cover every deal this person can see. (If they asked about their OWN deals: they have none.)` : ''
  const words = str(a.search).toLowerCase()
  const type = ['RFQ', 'RFP', 'BID', 'PO'].includes(str(a.type).toUpperCase()) ? str(a.type).toUpperCase() : ''
  const ymd = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(str(v)) ? str(v) : '')
  // "Overdue" already means "due before now": a from/to (often today's date) would hide them, so it is ignored.
  const from = a.overdue === true ? '' : ymd(a.from), to = a.overdue === true ? '' : ymd(a.to)
  const pkDay = (iso: string) => DateTime.fromISO(iso).setZone(PKT_ZONE).toISODate()!
  const fmtDay = (iso: string) => DateTime.fromISO(iso).setZone(PKT_ZONE).toFormat('ccc d LLL yyyy, h:mm a')
  const open = (b: DealRow) => b.status === 'ACTIVE' || b.status === 'SUBMITTED'
  const byStatus = (b: DealRow) => {
    if (status === 'open' && !open(b)) return false
    if (status === 'closed' && open(b)) return false
    if (['active', 'submitted', 'won', 'lost'].includes(status) && b.status !== status.toUpperCase()) return false
    return true
  }
  // Everything but the status filter: the win rate is always won / (won + lost), even when only won deals are asked for.
  const inScope = (b: DealRow, dates: boolean) => {
    if (agent && !b.agentName.toLowerCase().includes(agent)) return false
    if (type && b.type !== type) return false
    if (words && !`${b.title} ${b.company} ${b.district}`.toLowerCase().includes(words)) return false
    const when = pkDay(b.closedDate ?? b.dueDate) // same date rule as the page's range filter
    if (dates && from && when < from) return false
    if (dates && to && when > to) return false
    if (a.overdue === true && !(open(b) && new Date(b.dueDate) < now)) return false
    return true
  }
  const sameScope = d.bids.filter((b) => inScope(b, true))
  const rows = sameScope.filter(byStatus)
  const count = (st: DealRow['status']) => rows.filter((b) => b.status === st).length
  const wonInScope = sameScope.filter((b) => b.status === 'WON').length
  const decided = wonInScope + sameScope.filter((b) => b.status === 'LOST').length
  const won = rows.filter((b) => b.status === 'WON')
  const wonValue = won.reduce((t, b) => t + (b.awardedPrice ?? 0), 0)
  const filtered = status !== 'all' || agent || words || type || from || to || a.overdue === true
  const byAgent = new Map<string, Record<string, number>>()
  for (const b of rows) {
    const x = byAgent.get(b.agentName) ?? { total: 0, ACTIVE: 0, SUBMITTED: 0, WON: 0, LOST: 0, wonValue: 0 }
    x.total++; x[b.status]++
    if (b.status === 'WON') x.wonValue += b.awardedPrice ?? 0
    byAgent.set(b.agentName, x)
  }
  const limit = Math.min(60, Math.max(1, Number(a.limit) || 25))
  const list = [...rows].sort((x, y) => (open(x) === open(y) ? x.dueDate.localeCompare(y.dueDate) : open(x) ? -1 : 1)).slice(0, limit)
  return [
    `Deal Tracker cards (every deal this person can see, exactly as on the page): Active ${s.active}, Submitted ${s.submitted}, Won ${s.won} (${dealMoney(s.wonValue)} awarded), Lost ${s.lost}; ${d.bids.length} deals in all.`,
    noAgent,
    filtered
      ? `Matching the filter (${[status !== 'all' && `status ${status}`, agent && `agent "${str(a.agent)}"`, type && `type ${type}`, words && `"${str(a.search)}"`, from && `from ${from}`, to && `to ${to}`, a.overdue === true && 'overdue'].filter(Boolean).join(', ')}): ${rows.length} deals: Active ${count('ACTIVE')}, Submitted ${count('SUBMITTED')}, Won ${count('WON')} (${dealMoney(wonValue)}), Lost ${count('LOST')}.`
      : '',
    // The open deals with no date limit, so a from/to the model added on its own never hides overdue ones.
    (from || to) ? (() => {
      const allOpen = d.bids.filter((b) => open(b) && (!agent || b.agentName.toLowerCase().includes(agent)))
      // The same filter with no dates at all. "How many deals have I won" was once answered "none" because the model
      // added this month's dates on its own and both wins were closed last month (metra:check, 14 Nov).
      const any = d.bids.filter((b) => inScope(b, false)).filter(byStatus)
      const n = (st: DealRow['status']) => any.filter((b) => b.status === st).length
      const anyWon = any.filter((b) => b.status === 'WON').reduce((t, b) => t + (b.awardedPrice ?? 0), 0)
      return `Note: the dates above hide some deals. All open deals${agent ? ` for "${str(a.agent)}"` : ''} at any date: ${allOpen.length} (Active ${allOpen.filter((b) => b.status === 'ACTIVE').length}, Submitted ${allOpen.filter((b) => b.status === 'SUBMITTED').length}), ${allOpen.filter((b) => new Date(b.dueDate) < now).length} of them overdue. The same filter with NO dates: ${any.length} deals: Active ${n('ACTIVE')}, Submitted ${n('SUBMITTED')}, Won ${n('WON')} (${dealMoney(anyWon)}), Lost ${n('LOST')}. When the person did not name a period, answer with these no-date numbers (and say so), not with the dated ones.`
    })() : '',
    rows.some(open) ? (() => {
      const late = rows.filter((b) => open(b) && new Date(b.dueDate) < now).length
      const next = rows.filter((b) => open(b) && new Date(b.dueDate) >= now).sort((x, y) => x.dueDate.localeCompare(y.dueDate))[0]
      return `Open deals here: ${late} overdue (due date passed). Next due (still ahead): ${next ? `#${next.number} ${next.title} (${next.company}), due ${fmtDay(next.dueDate)}` : 'none, every open deal here is already overdue'}.`
    })() : '',
    decided ? `Win rate (won / (won + lost))${agent || type || words || from || to ? ' with these filters' : ''}: ${Math.round((wonInScope / decided) * 100)}% (${wonInScope} won of ${decided} decided).` : '',
    byAgent.size ? `By agent: ${[...byAgent].sort((x, y) => y[1].total - x[1].total).map(([n, x]) => `${n} ${x.total} (active ${x.ACTIVE}, submitted ${x.SUBMITTED}, won ${x.WON} ${dealMoney(x.wonValue)}, lost ${x.LOST})`).join('; ')}.` : 'No deals match.',
    rows.length ? `\nDeals (${list.length} of ${rows.length}${list.length < rows.length ? '; ask with a filter or a bigger limit for the rest' : ''}), open ones first by due date. Prices exactly as stored, in dollars:` : '',
    ...list.map((b) => [
      `#${b.number} ${b.title}`, b.company, b.type, b.district || null, b.agentName, STATUS_WORD[b.status],
      `due ${fmtDay(b.dueDate)}${open(b) && new Date(b.dueDate) < now ? ' (OVERDUE)' : ''}`,
      `quoted ${dealMoney(b.priceQuoted)}`, b.awardedPrice != null && b.status === 'WON' ? `awarded ${dealMoney(b.awardedPrice)}` : null,
      b.submissionType ? `sent by ${b.submissionType.toLowerCase()}` : null,
      b.bidBond ? `bid bond${b.bidBondAmount != null ? ` ${dealMoney(b.bidBondAmount)}` : ''}` : null,
      b.closedDate ? `closed ${DateTime.fromISO(b.closedDate).setZone(PKT_ZONE).toFormat('d LLL yyyy')}` : null,
    ].filter(Boolean).join(' | ')),
  ].filter(Boolean).join('\n')
}

// ------------------------------------------------------------------ Lead Dialer

interface DialerData {
  me: { id: string; name: string; isManager: boolean }
  settings: DialerSettings
  leads: DialerLead[]
  dayStart: string
  actedToday: { leadId: string; kind: string; at: string }[]
  followUpByOwner: Record<string, Record<string, number>>
  lastImport: { id: string; at: string } | null
  reps?: { id: string; name: string }[]
}

async function loadDialer(u: User, rep: string): Promise<{ data?: DialerData; error?: string }> {
  const r = await apiAs(u, 'GET', '/api/dialer/data', { query: { rep: rep || 'me' } })
  if (r.status === 403) return { error: `${apiError(r)} The Lead Dialer is for the ITAD team.` }
  if (r.status >= 400) return { error: apiError(r) }
  return { data: r.body as DialerData }
}

/** A rep by id or name for managers ("all" for everyone). */
function repParam(given: unknown, data?: DialerData): string {
  const g = str(given)
  if (!g || ME_WORDS.test(g)) return 'me'
  if (ALL_WORDS.test(g)) return 'all'
  const hit = data?.reps?.find((r) => r.id === g || r.name.toLowerCase() === g.toLowerCase())
  return hit?.id ?? g
}

const ME_WORDS = /^(me|mine|my|myself|self|i|own)$/i
const ALL_WORDS = /^(all|everyone|everybody|itad|company|(the |our |my )?(whole |entire |all )?(itad )?(team|reps|agents|department|dept)( all)?)$/i
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean)
/** "Usama", "usama shabir" and "Usama S." all mean the person named Usama Shabir. */
const sameName = (given: string, name: string): boolean => {
  const g = words(given), n = words(name)
  if (!g.length || !g.every((w) => n.some((x) => x === w || (w.length >= 3 && x.startsWith(w))))) return false
  // One word must be the first name ("Usama"), not any word in it ("ITAD" in "Test ITAD Lead" is the team, not the person).
  return g.length >= 2 || n[0] === g[0] || n[0].startsWith(g[0]) || n.length === 1
}

/**
 * The Lead Dialer data for the rep asked for. An assistant often fills "rep" with the person's own name, or with a
 * rep's name instead of their id; the dialer itself answers 403 to both ("how many leads do I have" then failed for
 * good). Here: your own name or "me" = your leads; someone who is not a manager always gets their own leads, with a
 * note; a manager's rep is found by id, full name or part of the name.
 */
async function loadDialerFor(u: User, given: unknown): Promise<{ data?: DialerData; error?: string; note?: string; who?: string }> {
  const g = str(given)
  if (!g || ME_WORDS.test(g) || g === u.id || sameName(g, u.name)) return loadDialer(u, 'me')
  const mine = await loadDialer(u, 'me')
  if (!mine.data) return mine
  if (!mine.data.me.isManager) return { ...mine, note: `These are your own leads (you see only yours, so rep "${g}" was left out).` }
  if (ALL_WORDS.test(g)) return { ...(await loadDialer(u, 'all')), who: 'the whole team' }
  const reps = mine.data.reps ?? []
  const exact = reps.filter((r) => r.id === g || r.name.trim().toLowerCase() === g.toLowerCase())
  const hit = exact.length ? exact : reps.filter((r) => sameName(g, r.name))
  if (hit.length === 1) return { ...(await loadDialer(u, hit[0].id)), who: hit[0].name }
  if (hit.length > 1) return { error: `"${g}" fits ${hit.length} reps: ${hit.map((r) => r.name).join(', ')}. Say which one.` }
  return { error: `No rep called "${g}". The reps are: ${reps.map((r) => r.name).join(', ') || 'none'}. Use "all" for the whole team.` }
}

/**
 * What an assistant typed for a filter, matched to the values that really exist (any letter case, extra words like
 * "leads" dropped). The dialer's own filter is exact, so "interested" used to give "no leads" while four were there.
 */
export function matchValues(given: unknown, real: string[], fix: (s: string) => string = (s) => s): { values: string[]; unknown: string[] } {
  const asked = (Array.isArray(given) ? given.map(String) : [str(given)]).flatMap((s) => s.split(/\s*(?:,|;|\/|\||\u001f|\band\b|\bor\b|&)\s*/i)).map((s) => s.trim()).filter(Boolean)
  const byLower = new Map(real.map((r) => [r.toLowerCase(), r]))
  const values: string[] = [], unknown: string[] = []
  for (const a of asked) {
    const tries = [a, fix(a), a.replace(/\b(leads?|clients?|customers?|status|stage|ones?|the|my)\b/gi, ' ').replace(/\s+/g, ' ').trim()].flatMap((t) => [t, fix(t)])
    const hit = tries.map((t) => byLower.get(t.toLowerCase())).find(Boolean)
    if (hit) values.push(hit); else unknown.push(a)
  }
  return { values: [...new Set(values)], unknown: [...new Set(unknown)] }
}

/** Leads counted by status, biggest first: "Interested 4, Pipeline 2, ...". */
function statusCounts(leads: DialerLead[]): string {
  const n = new Map<string, number>()
  for (const l of leads) if (!l.duplicate) n.set(l.status, (n.get(l.status) ?? 0) + 1)
  return [...n].sort((a, b) => b[1] - a[1]).map(([s, c]) => `${s} ${c.toLocaleString('en-US')}`).join(', ') || 'none'
}

const VIEWS = ['all', 'call_now', 'prime_time', 'follow_ups', 'overdue', 'due_today', 'scheduled', 'snoozed', 'hot', 'never_attempted', 'stuck', 'no_state', 'changed', 'needs_earthzone'] as const

function leadLine(l: DialerLead, now: Date, s: DialerSettings, extra?: string): string {
  const r = leadRegion(l, now)
  const local = r ? `${clock(REGION_META[r].zone, now)} ${r}` : 'no region'
  const open = r ? regionWindow(r, s, now) : null
  const callable = isDialable(l, s, now) && !!open?.open
  const back = l.callLaterAt ? ` | call back ${DateTime.fromISO(l.callLaterAt).setZone(PKT_ZONE).toFormat('d LLL h:mm a')} PKT` : ''
  const quiet = daysSince(lastActivity(l), now)
  return [
    l.company,
    l.contactName ?? 'no contact name',
    l.phone ?? 'no phone',
    [l.city, leadState(l)].filter(Boolean).join(', ') || 'no state',
    `their time ${local}${callable ? ' (can call now)' : open && !open.open ? ' (outside calling hours)' : ''}`,
    l.doNotCall ? `${l.status}, DO NOT CALL` : l.wrongNumber ? `${l.status}, WRONG NUMBER` : l.status,
    `${quiet}d since last activity${back}`,
    l.pinnedNote ? `note: ${l.pinnedNote.slice(0, 120)}` : null,
    extra ?? null,
    `id ${l.id}`,
  ].filter(Boolean).join(' | ')
}

function pickLeads(d: DialerData, view: string, f: LeadFilters, now: Date): { rows: DialerLead[]; why: Map<string, string> } {
  const why = new Map<string, string>()
  const s = d.settings
  const tabs = () => followUpTabs(d.leads, s, now, new Date(d.dayStart), latestActedToday(d.actedToday), d.followUpByOwner)
  const fromFollow = (xs: FollowUp[], label: string) => {
    for (const x of xs) why.set(x.lead.id, x.callBackDue ? `${label}: call back due` : `${label}: quiet ${x.days} days (follow up after ${x.threshold})`)
    return xs.map((x) => x.lead)
  }
  const lastImport = d.lastImport ? { id: d.lastImport.id, at: new Date(d.lastImport.at) } : null
  const base = (extra: LeadFilters) => filterLeads(d.leads, { ...f, ...extra }, now, lastImport, s)
  switch (view) {
    case 'call_now': return { rows: base({ callAt: 'now' }), why }
    case 'prime_time': return { rows: base({ callAt: 'prime' }), why }
    case 'follow_ups': { const t = tabs(); return { rows: keep([...fromFollow(t.overdue, 'overdue'), ...fromFollow(t.dueToday, 'due today')], base({})), why } }
    case 'overdue': return { rows: keep(fromFollow(tabs().overdue, 'overdue'), base({})), why }
    case 'due_today': return { rows: keep(fromFollow(tabs().dueToday, 'due today'), base({})), why }
    case 'scheduled': return { rows: keep(fromFollow(tabs().scheduled, 'scheduled'), base({})), why }
    case 'snoozed': return { rows: keep(fromFollow(tabs().snoozed, 'snoozed'), base({})), why }
    case 'hot': return { rows: base({ preset: 'pipeline' }), why }
    case 'never_attempted': return { rows: base({ preset: 'never' }), why }
    case 'stuck': return { rows: base({ preset: 'stuck' }), why }
    case 'no_state': return { rows: base({ preset: 'nostate' }), why }
    case 'changed': return { rows: base({ preset: 'changed' }), why }
    case 'needs_earthzone': return { rows: base({ preset: 'earthzone' }), why }
    default: return { rows: base({}), why }
  }
}
/** Keep the follow-up order, but only leads that also pass the filters. */
const keep = (ordered: DialerLead[], allowed: DialerLead[]) => { const ok = new Set(allowed.map((l) => l.id)); return ordered.filter((l) => ok.has(l.id)) }

async function findLead(u: User, given: unknown, rep: unknown): Promise<{ lead?: DialerLead; data?: DialerData; error?: string }> {
  const g = str(given)
  if (!g) return { error: 'Say which lead: its id (from dialer_leads), company name or phone number.' }
  const { data, error } = await loadDialerFor(u, rep)
  if (!data) return { error }
  const byId = data.leads.find((l) => l.id === g)
  if (byId) return { lead: byId, data }
  const digits = g.replace(/\D/g, '')
  const hits = data.leads.filter((l) => !l.duplicate && ((digits.length >= 7 && (l.phone ?? '').replace(/\D/g, '').endsWith(digits.slice(-10))) || l.company.toLowerCase().includes(g.toLowerCase())))
  if (hits.length === 1) return { lead: hits[0], data }
  if (hits.length > 1) return { error: `"${g}" fits ${hits.length} leads: ${hits.slice(0, 10).map((l) => `${l.company} (${l.phone ?? 'no phone'}, id ${l.id})`).join('; ')}. Say which one by id.` }
  return { error: `No lead "${g}" in your Lead Dialer.` }
}

/** "2026-10-30 15:00" on the Pakistan clock (default) or the lead's own clock → ISO. */
function parseWhen(v: unknown, zone: string): { iso?: string; error?: string } {
  const s = str(v)
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/)
  if (!m) return { error: `"${s}" is not a date and time. Use YYYY-MM-DD HH:MM, e.g. 2026-10-30 19:30.` }
  const d = DateTime.fromISO(`${m[1]}T${(m[2] ?? '09').padStart(2, '0')}:${m[3] ?? '00'}`, { zone })
  if (!d.isValid) return { error: `"${s}" is not a real date.` }
  return { iso: d.toUTC().toISO()! }
}

// ------------------------------------------------------------------ the tools

export const DEPARTMENT_TOOLS: DeptTool[] = [
  {
    name: 'metriq_guide',
    title: 'What I can see in Metriq',
    description: 'START HERE for anything that is not a project ticket: lists the person\'s team (ITAD, E-commerce, Lead Gen, Marketing...) and every part of Metriq they can ask about, with the tool or metriq_read path for each.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    async run(u) {
      const me = await whoAmI(u)
      if (!me) return fail('Could not read your Metriq account.')
      const areas = AREAS.filter((a) => a.for(me))
      const team = [me.department, ...(me.memberships ?? []).map((x) => x.department)].filter((v, i, a) => v && a.indexOf(v) === i).join(', ') || 'none'
      return text([
        `${me.name}: ${me.role.replace(/_/g, ' ').toLowerCase()}, team ${team}${me.subDepartment ? ` (${me.subDepartment})` : ''}.`,
        'Read any path below with metriq_read. You see exactly what this person sees in the app.',
        ...areas.map((a) => `\n${a.title}:\n${a.lines.map((l) => `- ${l}`).join('\n')}`),
      ].join('\n'))
    },
  },
  {
    name: 'metriq_read',
    title: 'Read data from Metriq',
    description: 'Reads any Metriq screen\'s data as the person (GET only), e.g. /api/ecommerce/board or /api/attendance/history?range=month. Use metriq_guide first for the paths that fit this person. Returns JSON; dates are in Pakistan time unless marked.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'API path starting with /api/, e.g. /api/ecommerce/team' },
        query: { type: 'object', additionalProperties: { type: 'string' }, description: 'Query options, e.g. {"range":"week"} or {"date":"2026-10-27"}' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    async run(u, a) {
      const raw = str(a.path)
      const bad = readablePath(raw)
      if (bad) return fail(bad)
      const [path, inline] = raw.split('?')
      const query: Record<string, string> = Object.fromEntries(new URLSearchParams(inline ?? ''))
      if (a.query && typeof a.query === 'object') for (const [k, v] of Object.entries(a.query as Record<string, unknown>)) if (v != null) query[k] = String(v)
      const ranged = fixRange(query)
      const r = await apiAs(u, 'GET', path, { query })
      if (r.status === 404) return fail(`${path}: not found. Check the path with metriq_guide.`)
      // A page this person may not open (team pages are for team leads): say where their own numbers are, so the
      // assistant goes there instead of reporting that nothing could be read.
      if (r.status === 403) return fail(`${path}: ${apiError(r)}. This screen is not open to this person (team and analytics pages are for team leads). Their own daily numbers are at /api/reports/me?range=month; metriq_guide lists everything they can open.`)
      if (r.status >= 400) return fail(`${path}: ${apiError(r)}`)
      if (!r.contentType.includes('json')) return fail(`${path} is not data (it is a file or a page). Open it in the app.`)
      return text(compact(r.body) + (ranged ? `\n\n[Note: ${ranged}]` : ''))
    },
  },
  {
    name: 'deal_tracker',
    title: 'ITAD Deal Tracker',
    description: 'ITAD Deal Tracker (bids and deals): exact counts per status (Active, Submitted, Won, Lost), won value, win rate, per-agent totals, and the deals themselves. Use it for ANY question about bids, deals, RFQs, RFPs or POs: how many, totals, overdue, won or lost, by agent or month. Filters are optional.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['all', 'open', 'active', 'submitted', 'won', 'lost', 'closed'], description: 'open = Active + Submitted; closed = Won + Lost. Default all.' },
        agent: { type: 'string', description: 'Only this agent (name or part of it).' },
        type: { type: 'string', enum: ['RFQ', 'RFP', 'BID', 'PO'] },
        search: { type: 'string', description: 'Words in the title, company or district.' },
        from: { type: 'string', description: 'YYYY-MM-DD, ONLY when the person names a period. Like the page: a closed deal counts on its closed date, an open one on its due date. "My open bids" has no dates.' },
        to: { type: 'string', description: 'YYYY-MM-DD (inclusive).' },
        overdue: { type: 'boolean', description: 'Only open deals whose due date has passed (any date; leave from/to out).' },
        limit: { type: 'number', description: 'How many deals to list (default 25, max 60). Totals always cover every match.' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    async run(u, a) {
      const r = await apiAs(u, 'GET', '/api/itad/bids')
      if (r.status === 403) return fail('The Deal Tracker is for the ITAD team.')
      if (r.status >= 400) return fail(apiError(r))
      // "me", "my", "mine" as the agent means the person asking.
      return text(dealTrackerText(r.body as DealTrackerData, ME_WORDS.test(str(a.agent)) ? { ...a, agent: u.name } : a, new Date()))
    },
  },
  {
    name: 'dialer_summary',
    title: 'Lead Dialer at a glance',
    description: 'ITAD Lead Dialer: which US regions are open for calling right now (and prime time), how many leads can be called in each, follow-ups due (overdue, due today, scheduled), hot leads, and the funnel. For a rep, their own leads; managers can ask for rep "all" or one rep.',
    inputSchema: { type: 'object', properties: { rep: { type: 'string', description: 'Managers only: "all", a rep\'s name or id. Leave out for your own leads.' } }, additionalProperties: false },
    annotations: { readOnlyHint: true },
    async run(u, a) {
      const { data, error, note, who } = await loadDialerFor(u, a.rep)
      if (!data) return fail(error!)
      const now = new Date()
      const s = data.settings
      const live = data.leads.filter((l) => !l.duplicate)
      const f = funnelOf(live)
      const t = followUpTabs(data.leads, s, now, new Date(data.dayStart), latestActedToday(data.actedToday), data.followUpByOwner)
      const pkt = DateTime.now().setZone(PKT_ZONE).toFormat('ccc d LLL, h:mm a')
      const regions = REGIONS.map((r: RegionCode) => {
        const w = regionWindow(r, s, now)
        const n = live.filter((l) => leadRegion(l, now) === r && isDialable(l, s, now)).length
        const state = w.prime ? `PRIME TIME, ${fmtSpan(w.primeLeft ?? 0)} left` : w.open ? (w.closingSoon ? `open, closes in ${fmtSpan(w.minutesLeft)}` : 'open') : w.weekend ? 'weekend' : `opens in ${fmtSpan(w.minutesUntilOpen)}`
        return `- ${REGION_META[r].name} (${r}): ${w.localTime} there, ${state}; ${n} leads to dial`
      })
      return text([
        `Lead Dialer for ${data.me.name}${who ? ` (showing ${who})` : ''}, ${pkt} Pakistan time.`,
        note ?? '',
        `Leads: ${f.total}. Attempted ${f.attempted} (${pct(f.attemptRate)}), connected ${f.connected} (${pct(f.connectRate)} of attempted), positive ${f.positive} (${pct(f.winRate)} win).`,
        `Leads by status: ${statusCounts(live)}.`,
        `Follow-ups: ${t.overdue.length} overdue, ${t.dueToday.length} due today, ${t.scheduled.length} scheduled, ${t.snoozed.length} snoozed, ${t.done.length} done today, ${t.backlog.length} in the 90+ day backlog.`,
        `Hot leads (Interested or Pipeline): ${live.filter((l) => l.status === 'Interested' || l.status === 'Pipeline').length}.`,
        'Calling right now (9 AM to 5 PM on the lead\'s own clock):',
        ...regions,
        '',
        'Use dialer_leads with view follow_ups, call_now, prime_time or hot for the names, or with a status for the leads in it. Won and lost deals are in the Deal Tracker (deal_tracker), not here.',
      ].filter((x) => x !== '').join('\n'))
    },
  },
  {
    name: 'dialer_leads',
    title: 'Find Lead Dialer leads',
    description: 'ITAD Lead Dialer leads as one line each (company | contact | phone | place | their local time and whether they can be called now | status | days quiet | call back | pinned note | id). Views: follow_ups (overdue then due today: the high-priority list), overdue, due_today, scheduled, snoozed, call_now, prime_time, hot (Interested and Pipeline), never_attempted, stuck, no_state, changed (since last import), needs_earthzone, all. Filters narrow any view.',
    inputSchema: {
      type: 'object',
      properties: {
        view: { type: 'string', enum: [...VIEWS], description: 'Default all (every lead). Pick another view ONLY when the person asks for that list (their follow-ups, who to call now...); for "my Interested leads" use status alone.' },
        search: { type: 'string', description: 'Words in the company, contact, phone, email or notes.' },
        state: { type: 'string', description: 'US state name, e.g. Texas' },
        region: { type: 'string', enum: ['ET', 'CT', 'MT', 'PT'] },
        status: { type: 'string', description: 'Exact status, e.g. Interested, Voicemail Sent' },
        industry: { type: 'string' },
        list: { type: 'string', description: 'Only when the person names an import list.' },
        tag: { type: 'string' },
        rep: { type: 'string', description: 'Managers only: "all", a rep\'s name or id.' },
        limit: { type: 'number', description: 'Most leads to list (default 50, up to 300).' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    async run(u, a) {
      const { data, error, note, who } = await loadDialerFor(u, a.rep)
      if (!data) return fail(error!)
      const now = new Date()
      const live = data.leads.filter((l) => !l.duplicate)
      const notes: string[] = note ? [note] : []
      const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))]
      let view = VIEWS.find((v) => v === str(a.view).toLowerCase().replace(/[\s-]+/g, '_')) ?? 'all'
      let search = str(a.search)

      // Each filter is matched to the values that exist (any letter case); what does not exist is said, not turned into "no leads".
      const real = { status: uniq([...STATUSES, ...live.map((l) => l.status)]), state: uniq(live.map((l) => leadState(l))), industry: uniq(live.map((l) => l.industry)), list: uniq(live.map((l) => l.listName)), tag: uniq(live.flatMap((l) => l.tags)) }
      const asked = { status: str(a.status), state: str(a.state), industry: str(a.industry), list: str(a.list), tag: str(a.tag) }
      // A status typed into the search box ("interested") is a status, not words to look for in the notes.
      if (search && !asked.status && matchValues(search, real.status, normalizeStatus).unknown.length === 0) { asked.status = search; search = '' }
      const f: LeadFilters = { q: search || undefined, region: ['ET', 'CT', 'MT', 'PT'].find((r) => r === str(a.region).toUpperCase()) }
      for (const key of ['status', 'state', 'industry', 'list', 'tag'] as const) {
        if (!asked[key]) continue
        let { values, unknown } = matchValues(asked[key], real[key], key === 'status' ? normalizeStatus : undefined)
        if (key === 'status') {
          if (unknown.some((x) => /^(hot|warm|positive)$/i.test(x))) { values = uniq([...values, 'Interested', 'Pipeline']); unknown = unknown.filter((x) => !/^(hot|warm|positive)$/i.test(x)) }
          const deals = unknown.filter((x) => /\b(won|win|lost|lose|closed|close|deal|deals|awarded)\b/i.test(x))
          if (deals.length) { notes.push(`"${deals.join('", "')}" is not a Lead Dialer status: won, lost and closed deals are in the Deal Tracker (use deal_tracker).`); unknown = unknown.filter((x) => !deals.includes(x)) }
        }
        if (unknown.length) notes.push(`No ${key} called "${unknown.join('", "')}" here, so it was left out. The ${key === 'status' ? 'statuses' : `${key} values`} are: ${real[key].slice(0, 40).join(', ') || 'none'}.`)
        if (values.length) f[key] = joinMulti(values)
      }
      // "hot" with a status that is not hot would always be empty: the status wins.
      if (view === 'hot' && f.status) view = 'all'

      let { rows, why } = pickLeads(data, view, f, now)
      // Nothing matched: before saying "none", the extra narrowing an assistant tends to add on its own (a view, a
      // list, a tag...) is taken off one by one, keeping what the person asked for (the status, the search words).
      if (!rows.length) {
        const dropped: string[] = []
        const tryAgain = () => { const r = pickLeads(data, view, f, now); rows = r.rows; why = r.why; return rows.length > 0 }
        const steps: [string, () => boolean, () => void][] = [
          [`view ${view.replace(/_/g, ' ')}`, () => view !== 'all' && !!(f.status || f.q), () => { view = 'all' }],
          [`list ${f.list ? multiOf(f.list).join(' or ') : ''}`, () => !!f.list, () => { f.list = undefined }],
          [`tag ${f.tag ? multiOf(f.tag).join(' or ') : ''}`, () => !!f.tag, () => { f.tag = undefined }],
          [`industry ${f.industry ? multiOf(f.industry).join(' or ') : ''}`, () => !!f.industry && !!(f.status || f.q), () => { f.industry = undefined }],
          [`region ${f.region ?? ''}`, () => !!f.region && !!(f.status || f.q), () => { f.region = undefined }],
        ]
        for (const [label, applies, drop] of steps) {
          if (!applies()) continue
          drop(); dropped.push(label)
          if (tryAgain()) break
        }
        if (rows.length && dropped.length) notes.push(`Nothing matched together with ${dropped.join(' and ')}, so that was left out; these are the leads without it.`)
      }
      const limit = Math.min(300, Math.max(1, Number(a.limit) || 50))
      const applied = [view !== 'all' && `view ${view.replace(/_/g, ' ')}`, f.status && `status ${multiOf(f.status).join(' or ')}`, f.state && `state ${multiOf(f.state).join(' or ')}`, f.region && `region ${f.region}`, f.industry && `industry ${multiOf(f.industry).join(' or ')}`, f.list && `list ${multiOf(f.list).join(' or ')}`, f.tag && `tag ${multiOf(f.tag).join(' or ')}`, f.q && `search "${f.q}"`].filter(Boolean).join(', ')
      // Every answer says how many leads there are in all and in each status, so a count never needs a second call,
      // and "none" for a filter can be told from "none at all".
      const head = [
        `Lead Dialer for ${data.me.name}${who ? ` (showing ${who})` : ''}: ${live.length.toLocaleString('en-US')} leads in total. By status: ${statusCounts(live)}.`,
        ...notes,
      ]
      if (!rows.length) return text([...head, `No leads match ${applied || 'that'}. (The totals above are every lead, with no filter.)`].join('\n'))
      const hint = PRESET_VIEWS.find((p) => (view === 'hot' && p.id === 'pipeline') || (view === 'never_attempted' && p.id === 'never') || p.id === view)?.hint
      return text([
        ...head,
        `${rows.length.toLocaleString('en-US')} lead${rows.length === 1 ? '' : 's'} match${applied ? ` (${applied}${hint ? `: ${hint}` : ''})` : ' (all leads)'}${rows.length > limit ? `; the first ${limit} are listed, the count is exact` : ''}. Times are now, ${DateTime.now().setZone(PKT_ZONE).toFormat('h:mm a')} Pakistan time.`,
        ...rows.slice(0, limit).map((l) => leadLine(l, now, data.settings, why.get(l.id))),
      ].join('\n'))
    },
  },
  {
    name: 'dialer_lead',
    title: 'One lead in full',
    description: 'One Lead Dialer lead with every field, its notes (newest first), what was done (calls, call laters, snoozes) and its status history. Give its id, company name or phone.',
    inputSchema: { type: 'object', properties: { lead: { type: 'string', description: 'Lead id, company name or phone number' }, rep: { type: 'string', description: 'Managers: the rep who owns it, or "all".' } }, required: ['lead'], additionalProperties: false },
    annotations: { readOnlyHint: true },
    async run(u, a) {
      const { lead, error } = await findLead(u, a.lead, a.rep)
      if (!lead) return fail(error!)
      const r = await apiAs(u, 'GET', `/api/dialer/leads/${encodeURIComponent(lead.id)}`)
      if (r.status >= 400) return fail(apiError(r))
      return text(compact(r.body))
    },
  },
  {
    name: 'dialer_update_lead',
    title: 'Log on a lead',
    description: 'On a Lead Dialer lead, as the person: add a note (optionally pinned, with a next-action date that brings it back in follow-ups), set a call back time, snooze it, mark it called now, or clear a call back/snooze. Times are Pakistan time unless clock is "lead".',
    inputSchema: {
      type: 'object',
      properties: {
        lead: { type: 'string', description: 'Lead id, company name or phone number' },
        action: { type: 'string', enum: ['note', 'call_later', 'snooze', 'called_now', 'clear'] },
        text: { type: 'string', description: 'The note (for note; optional for the others).' },
        pinned: { type: 'boolean', description: 'note: pin it on the lead' },
        when: { type: 'string', description: 'call_later, snooze or a note\'s next action: YYYY-MM-DD HH:MM' },
        clock: { type: 'string', enum: ['pakistan', 'lead'], description: 'Which clock "when" is on (default pakistan).' },
      },
      required: ['lead', 'action'],
      additionalProperties: false,
    },
    async run(u, a) {
      const { lead, error } = await findLead(u, a.lead, 'me')
      if (!lead) return fail(error!)
      const action = str(a.action)
      const note = str(a.text)
      const r0 = leadRegion(lead, new Date())
      const zone = str(a.clock) === 'lead' && r0 ? REGION_META[r0].zone : PKT_ZONE
      let at: string | undefined
      if (str(a.when)) { const w = parseWhen(a.when, zone); if (!w.iso) return fail(w.error!); at = w.iso }
      const id = encodeURIComponent(lead.id)
      if (action === 'note') {
        if (!note) return fail('Write the note text.')
        const r = await apiAs(u, 'POST', `/api/dialer/leads/${id}/notes`, { body: { text: note.slice(0, 4000), pinned: !!a.pinned, nextActionAt: at ?? null } })
        if (r.status >= 400) return fail(apiError(r))
        return text(`Note added to ${lead.company}${a.pinned ? ' (pinned)' : ''}${at ? `; it comes back in follow-ups on ${DateTime.fromISO(at).setZone(PKT_ZONE).toFormat('d LLL h:mm a')} PKT` : ''}.`)
      }
      const kind = action === 'call_later' ? 'CALL_LATER' : action === 'snooze' ? 'SNOOZE' : action === 'called_now' ? 'CALL_NOW' : action === 'clear' ? 'CLEAR' : null
      if (!kind) return fail('Pick an action: note, call_later, snooze, called_now or clear.')
      if ((kind === 'CALL_LATER' || kind === 'SNOOZE') && !at) return fail('Say when: YYYY-MM-DD HH:MM.')
      const r = await apiAs(u, 'POST', `/api/dialer/leads/${id}/actions`, { body: { kind, ...(at ? { at } : {}), ...(note ? { note: note.slice(0, 2000) } : {}) } })
      if (r.status >= 400) return fail(apiError(r))
      const whenTxt = at ? ` ${DateTime.fromISO(at).setZone(PKT_ZONE).toFormat('d LLL h:mm a')} PKT` : ''
      return text(kind === 'CALL_LATER' ? `${lead.company}: call back set for${whenTxt}.` : kind === 'SNOOZE' ? `${lead.company}: snoozed until${whenTxt}.` : kind === 'CALL_NOW' ? `${lead.company}: marked as called now.` : `${lead.company}: call back and snooze cleared.`)
    },
  },
  {
    name: 'dialer_edit_lead',
    title: 'Edit a lead\'s extra contact details',
    description: 'On a Lead Dialer lead, as the person: set or change the extra details kept in Metriq (second phone, second email, LinkedIn, decision maker, best time to call, tags), or tick "Done in Earthzone". Give only what changes; an empty text ("") removes that detail. The CRM import never overwrites these. Changes are marked "needs Earthzone" (when that tick is on) unless earthzone is false.',
    inputSchema: {
      type: 'object',
      properties: {
        lead: { type: 'string', description: 'Lead id, company name or phone number' },
        rep: { type: 'string', description: 'Managers: "all" (or the rep\'s name) to find the lead among the team\'s leads.' },
        second_phone: { type: 'string', description: 'Second phone number ("" removes it)' },
        second_email: { type: 'string', description: 'Second email address ("" removes it)' },
        linkedin: { type: 'string', description: 'LinkedIn profile link ("" removes it)' },
        decision_maker: { type: 'string', description: 'Decision maker\'s name and role ("" removes it)' },
        best_time: { type: 'string', description: 'Best time to call, e.g. "Tue-Thu after 2 PM ET" ("" removes it)' },
        tags: { type: 'array', items: { type: 'string' }, description: 'The lead\'s tags (replaces them; [] removes all)' },
        alt_phones: { type: 'array', items: { type: 'string' }, description: 'Alternative phone numbers to ADD to the lead (kept with the ones it has; a number it already has is skipped). Each gets its own copy button and shows in the Claude log.' },
        earthzone: { type: 'boolean', description: 'false: this change does not need to go into Earthzone. Default true.' },
        done_in_earthzone: { type: 'boolean', description: 'true: the marked changes are now in Earthzone (clears "needs Earthzone").' },
      },
      required: ['lead'],
      additionalProperties: false,
    },
    async run(u, a) {
      // Managers: any rep given looks through the whole team's leads (the app checks the lead is theirs to edit).
      const { lead, error } = await findLead(u, a.lead, repParam(a.rep) === 'me' ? 'me' : 'all')
      if (!lead) return fail(error!)
      const body: Record<string, unknown> = {}
      const fields: [string, string, string, number][] = [
        ['second_phone', 'phone2', 'second phone', 200], ['second_email', 'email2', 'second email', 200], ['linkedin', 'linkedin', 'LinkedIn', 300],
        ['decision_maker', 'decisionMaker', 'decision maker', 120], ['best_time', 'bestTime', 'best time to call', 80],
      ]
      const said: string[] = []
      for (const [arg, key, label, max] of fields) {
        if (a[arg] === undefined || a[arg] === null) continue
        if (typeof a[arg] !== 'string') return fail(`${label} must be text.`)
        const v = str(a[arg])
        if (v.length > max) return fail(`The ${label} is too long (at most ${max} characters).`)
        if (key === 'phone2' && v && v.replace(/\D/g, '').length < 7) return fail(`"${v}" does not look like a phone number.`)
        if (key === 'email2' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return fail(`"${v}" does not look like an email address.`)
        body[key] = v || null
        said.push(v ? `${label} ${v}` : `${label} removed`)
      }
      if (a.tags !== undefined) {
        if (!Array.isArray(a.tags)) return fail('tags must be a list.')
        const tags = [...new Set(a.tags.map(str).filter(Boolean))]
        if (tags.length > 20 || tags.some((t) => t.length > 30)) return fail('At most 20 tags, each up to 30 characters.')
        body.tags = tags
        said.push(tags.length ? `tags ${tags.join(', ')}` : 'tags removed')
      }
      if (a.alt_phones !== undefined) {
        // Added to the numbers the lead has; sent through PATCH /api/dialer/leads/:id, so each lands in the Claude log.
        if (!Array.isArray(a.alt_phones)) return fail('alt_phones must be a list of phone numbers.')
        const have = ((lead as { altPhones?: unknown }).altPhones as string[] | undefined ?? []).filter((x) => typeof x === 'string')
        const digits = (x: string) => x.replace(/\D/g, '')
        const known = new Set([lead.phone, (lead as { phone2?: string | null }).phone2, ...have].filter((x): x is string => !!x).map(digits))
        const add: string[] = []
        for (const raw of a.alt_phones) {
          const v = str(raw)
          if (!v) continue
          if (v.length > 40 || digits(v).length < 7) return fail(`"${v}" does not look like a phone number.`)
          if (known.has(digits(v))) continue
          known.add(digits(v)); add.push(v)
        }
        if (have.length + add.length > 20) return fail('A lead keeps at most 20 alternative numbers.')
        if (add.length) { body.altPhones = [...have, ...add]; said.push(`alternative number${add.length > 1 ? 's' : ''} ${add.join(', ')} added`) }
        else if (!said.length && a.done_in_earthzone !== true) return text(`${lead.company} already has ${a.alt_phones.length > 1 ? 'these numbers' : 'this number'}; nothing changed.`)
      }
      if (a.earthzone === false) body.needsCrm = false
      if (a.done_in_earthzone === true) { body.crmDone = true; said.push('marked done in Earthzone') }
      if (!said.length) return fail('Say what to change: second_phone, second_email, linkedin, decision_maker, best_time, tags, alt_phones or done_in_earthzone.')
      const r = await apiAs(u, 'PATCH', `/api/dialer/leads/${encodeURIComponent(lead.id)}`, { body })
      if (r.status >= 400) return fail(apiError(r))
      return text(`${lead.company}: ${said.join('; ')}.`)
    },
  },
]
