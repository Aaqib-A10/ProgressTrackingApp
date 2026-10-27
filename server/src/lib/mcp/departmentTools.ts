import { DateTime } from 'luxon'
import type { Role } from '@prisma/client'
import { apiAs, apiError } from './api'
import {
  REGION_META, clock, filterLeads, followUpTabs, funnelOf, isDialable, lastActivity, latestActedToday, leadRegion, leadState,
  daysSince, pct, regionWindow, REGIONS, PRESET_VIEWS, fmtSpan,
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

/** JSON made short for the assistant: no nulls, no empty lists, cut at a size it can read. */
export function compact(v: unknown, max = 40_000): string {
  const prune = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(prune)
    if (x && typeof x === 'object') {
      const o: Record<string, unknown> = {}
      for (const [k, val] of Object.entries(x)) {
        if (val == null || (Array.isArray(val) && val.length === 0) || val === '') continue
        o[k] = prune(val)
      }
      return o
    }
    return x
  }
  const s = typeof v === 'string' ? v : JSON.stringify(prune(v))
  return s.length > max ? `${s.slice(0, max)}\n\n[Cut at ${max.toLocaleString()} characters of ${s.length.toLocaleString()}. Ask for a smaller range, a date, or one item.]` : s
}

interface Me { id: string; name: string; role: Role; department: string | null; subDepartment: string | null; isDeveloper?: boolean; memberships?: { department: string }[] }

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
      '/api/tasks/mine : my tasks',
      '/api/meetings : my meetings',
      '/api/notifications : my notifications',
      '/api/search?q=WORDS : search people, tasks and files',
      'Project tickets: use list_my_tickets, get_ticket, list_projects and the other ticket tools.',
    ],
  },
  {
    title: 'ITAD',
    for: (m) => inDept(m, 'ITAD'),
    lines: [
      'Lead Dialer: use dialer_summary, dialer_leads (follow-ups, who to call now, hot leads, filters) and dialer_lead; dialer_update_lead to log a note, call later or snooze.',
      '/api/itad/entries?date=YYYY-MM-DD : my daily log for a day',
      '/api/itad/team?range=week : the team\'s daily logs (team leads)',
      '/api/itad/analytics?range=month : calls, connects and results over time',
      '/api/itad/bids : Deal Tracker (bids and deals)',
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
      '/api/marketing/board : the marketing task board',
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
  if (!g || /^(me|mine|my)$/i.test(g)) return 'me'
  if (/^(all|team|everyone)$/i.test(g)) return 'all'
  const hit = data?.reps?.find((r) => r.id === g || r.name.toLowerCase() === g.toLowerCase())
  return hit?.id ?? g
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

async function findLead(u: User, given: unknown, rep: string): Promise<{ lead?: DialerLead; data?: DialerData; error?: string }> {
  const g = str(given)
  if (!g) return { error: 'Say which lead: its id (from dialer_leads), company name or phone number.' }
  const { data, error } = await loadDialer(u, rep)
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
      const r = await apiAs(u, 'GET', path, { query })
      if (r.status === 404) return fail(`${path}: not found. Check the path with metriq_guide.`)
      if (r.status >= 400) return fail(`${path}: ${apiError(r)}`)
      if (!r.contentType.includes('json')) return fail(`${path} is not data (it is a file or a page). Open it in the app.`)
      return text(compact(r.body))
    },
  },
  {
    name: 'dialer_summary',
    title: 'Lead Dialer at a glance',
    description: 'ITAD Lead Dialer: which US regions are open for calling right now (and prime time), how many leads can be called in each, follow-ups due (overdue, due today, scheduled), hot leads, and the funnel. For a rep, their own leads; managers can ask for rep "all" or one rep.',
    inputSchema: { type: 'object', properties: { rep: { type: 'string', description: 'Managers only: "all", a rep\'s name or id. Leave out for your own leads.' } }, additionalProperties: false },
    annotations: { readOnlyHint: true },
    async run(u, a) {
      const { data, error } = await loadDialer(u, repParam(a.rep))
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
        `Lead Dialer for ${data.me.name}${repParam(a.rep) !== 'me' ? ` (showing ${str(a.rep)})` : ''}, ${pkt} Pakistan time.`,
        `Leads: ${f.total}. Attempted ${f.attempted} (${pct(f.attemptRate)}), connected ${f.connected} (${pct(f.connectRate)} of attempted), positive ${f.positive} (${pct(f.winRate)} win).`,
        `Follow-ups: ${t.overdue.length} overdue, ${t.dueToday.length} due today, ${t.scheduled.length} scheduled, ${t.snoozed.length} snoozed, ${t.done.length} done today, ${t.backlog.length} in the 90+ day backlog.`,
        `Hot leads (Interested or Pipeline): ${live.filter((l) => l.status === 'Interested' || l.status === 'Pipeline').length}.`,
        'Calling right now (9 AM to 5 PM on the lead\'s own clock):',
        ...regions,
        '',
        'Use dialer_leads with view follow_ups, call_now, prime_time or hot for the names.',
      ].join('\n'))
    },
  },
  {
    name: 'dialer_leads',
    title: 'Find Lead Dialer leads',
    description: 'ITAD Lead Dialer leads as one line each (company | contact | phone | place | their local time and whether they can be called now | status | days quiet | call back | pinned note | id). Views: follow_ups (overdue then due today: the high-priority list), overdue, due_today, scheduled, snoozed, call_now, prime_time, hot (Interested and Pipeline), never_attempted, stuck, no_state, changed (since last import), needs_earthzone, all. Filters narrow any view.',
    inputSchema: {
      type: 'object',
      properties: {
        view: { type: 'string', enum: [...VIEWS], description: 'Default all.' },
        search: { type: 'string', description: 'Words in the company, contact, phone, email or notes.' },
        state: { type: 'string', description: 'US state name, e.g. Texas' },
        region: { type: 'string', enum: ['ET', 'CT', 'MT', 'PT'] },
        status: { type: 'string', description: 'Exact status, e.g. Interested, Voicemail Sent' },
        industry: { type: 'string' },
        list: { type: 'string', description: 'List name, e.g. CRM or Vendors' },
        tag: { type: 'string' },
        rep: { type: 'string', description: 'Managers only: "all", a rep\'s name or id.' },
        limit: { type: 'number', description: 'Most leads to list (default 50, up to 300).' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    async run(u, a) {
      const { data, error } = await loadDialer(u, repParam(a.rep))
      if (!data) return fail(error!)
      const now = new Date()
      const view = VIEWS.includes(str(a.view) as (typeof VIEWS)[number]) ? str(a.view) : 'all'
      const f: LeadFilters = { q: str(a.search) || undefined, state: str(a.state) || undefined, region: str(a.region) || undefined, status: str(a.status) || undefined, industry: str(a.industry) || undefined, list: str(a.list) || undefined, tag: str(a.tag) || undefined }
      const { rows, why } = pickLeads(data, view, f, now)
      const limit = Math.min(300, Math.max(1, Number(a.limit) || 50))
      if (!rows.length) return text(`No leads for view "${view}"${Object.values(f).some(Boolean) ? ' with those filters' : ''}.`)
      const hint = PRESET_VIEWS.find((p) => (view === 'hot' && p.id === 'pipeline') || (view === 'never_attempted' && p.id === 'never') || p.id === view)?.hint
      return text([
        `${rows.length} lead${rows.length === 1 ? '' : 's'} (${view.replace(/_/g, ' ')}${hint ? `: ${hint}` : ''})${rows.length > limit ? `, first ${limit}` : ''}. Times are now, ${DateTime.now().setZone(PKT_ZONE).toFormat('h:mm a')} Pakistan time.`,
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
      const { lead, error } = await findLead(u, a.lead, repParam(a.rep))
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
]
