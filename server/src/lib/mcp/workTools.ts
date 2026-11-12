import { DateTime } from 'luxon'
import type { Role } from '@prisma/client'
import { apiAs, apiError } from './api'
import type { DeptTool } from './departmentTools'

/**
 * Connector tools for Lead Management, My To-Do and meetings (Nov 2026). Like the other tools
 * they call Metriq's API as the person, so the AI sees and changes only what the person could in
 * the app, with the same checks, history and alerts.
 */

type User = { id: string; role: Role; name: string }
const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] })
const fail = (t: string) => ({ content: [{ type: 'text' as const, text: t }], isError: true })
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

interface Me { id: string; name: string; role: Role; leadsRole?: 'MANAGER' | 'REP' | null; company?: { timeZone?: string } }
async function me(u: User): Promise<Me | null> {
  const r = await apiAs(u, 'GET', '/api/auth/me')
  return r.status === 200 ? (r.body as { user: Me }).user : null
}
const zoneOf = (m: Me | null) => m?.company?.timeZone || 'Asia/Karachi'

/** "YYYY-MM-DD HH:MM" (or "YYYY-MM-DDTHH:MM") on the company clock. */
function parseAt(v: unknown, zone: string): DateTime | null {
  const s = str(v).replace('T', ' ')
  if (!/^\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}$/.test(s)) return null
  const d = DateTime.fromFormat(s, 'yyyy-MM-dd H:mm', { zone })
  return d.isValid ? d : null
}

// ------------------------------------------------------------------ leads

interface MetaBiz { id: string; name: string; isActive: boolean; myRole: 'MANAGER' | 'REP' | null; members: { id: string; name: string; email: string; role: string }[] }
interface LeadRowT { id: string; businessId: string; name: string; email: string | null; phone: string | null; organization: string | null; status: string; source: string; createdAt: string; lastActivityAt: string; assignee: { id: string; name: string } | null; message: string | null; late: string | null; utmCampaign: string | null; repeats: number }

async function leadsMeta(u: User): Promise<{ meta?: { me: { id: string; admin: boolean }; businesses: MetaBiz[] }; error?: string }> {
  const r = await apiAs(u, 'GET', '/api/leads/meta')
  if (r.status === 403) return { error: `${apiError(r)}` }
  if (r.status >= 400) return { error: apiError(r) }
  return { meta: r.body as { me: { id: string; admin: boolean }; businesses: MetaBiz[] } }
}
function pickBiz(list: MetaBiz[], given: unknown): MetaBiz | null | 'many' {
  const g = str(given).toLowerCase()
  if (!g) return list.length === 1 ? list[0] : null
  const hits = list.filter((b) => b.id === str(given) || b.name.toLowerCase() === g)
  if (hits.length === 1) return hits[0]
  const loose = list.filter((b) => b.name.toLowerCase().includes(g))
  return loose.length === 1 ? loose[0] : loose.length ? 'many' : null
}
function pickPerson(biz: MetaBiz[], given: unknown): { id: string; name: string } | null {
  const g = str(given).toLowerCase()
  if (!g) return null
  const all = biz.flatMap((b) => b.members)
  return all.find((p) => p.id === str(given) || p.email.toLowerCase() === g || p.name.toLowerCase() === g) ?? all.find((p) => p.name.toLowerCase().includes(g)) ?? null
}
const ago = (iso: string) => {
  const h = (Date.now() - new Date(iso).getTime()) / 3600_000
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`
}
function leadLine(l: LeadRowT, biz: Map<string, string>): string {
  return [
    `${l.name || l.organization || l.email || l.phone} [id ${l.id}]`,
    biz.get(l.businessId),
    l.organization && l.organization !== l.name ? l.organization : null,
    l.phone, l.email,
    l.status + (l.late ? ` (LATE: ${l.late === 'assign' ? 'not assigned in time' : 'not contacted in time'})` : ''),
    l.assignee ? `with ${l.assignee.name}` : 'not assigned',
    `${l.source.toLowerCase()} ${ago(l.createdAt)}`,
    l.utmCampaign ? `campaign ${l.utmCampaign}` : null,
    l.repeats ? `came back ${l.repeats}x` : null,
    l.message ? `"${l.message.replace(/\s+/g, ' ').slice(0, 140)}"` : null,
  ].filter(Boolean).join(' | ')
}

async function findLead(u: User, given: unknown): Promise<{ id?: string; error?: string }> {
  const g = str(given)
  if (!g) return { error: 'Say which lead: its id, email, phone or name.' }
  const direct = await apiAs(u, 'GET', `/api/leads/${encodeURIComponent(g)}`)
  if (direct.status === 200) return { id: g }
  const r = await apiAs(u, 'GET', '/api/leads', { query: { q: g, status: 'all' } })
  if (r.status >= 400) return { error: apiError(r) }
  const leads = (r.body as { leads: LeadRowT[] }).leads
  if (!leads.length) return { error: `No lead matches "${g}" among the leads this person can see.` }
  if (leads.length > 1) return { error: `"${g}" matches ${leads.length} leads: ${leads.slice(0, 5).map((l) => `${l.name || l.email} [id ${l.id}]`).join('; ')}. Use the id.` }
  return { id: leads[0].id }
}

export const WORK_TOOLS: DeptTool[] = [
  {
    name: 'leads_list',
    title: 'List leads',
    description: 'Lead Management: the leads this person can see (managers: their whole business; reps: the leads given to them). Filter by business, status, who has it, late ones, or words. Newest first, 50 at a time.',
    inputSchema: {
      type: 'object',
      properties: {
        business: { type: 'string', description: 'Business name (e.g. "Recycle Technologies"); empty for all' },
        status: { type: 'string', enum: ['open', 'NEW', 'CONTACTED', 'QUALIFIED', 'WON', 'LOST', 'SPAM', 'all'], description: 'Default open' },
        assignee: { type: 'string', description: '"me", "none" (not assigned yet) or a person\'s name' },
        late: { type: 'boolean', description: 'Only leads not assigned or not contacted in time' },
        search: { type: 'string', description: 'Words in the name, email, phone, company or message' },
        page: { type: 'number' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    async run(u, a) {
      const { meta, error } = await leadsMeta(u)
      if (!meta) return fail(error!)
      if (!meta.businesses.length) return text('This person does not work leads for any business (Lead Management, Lead Settings).')
      const query: Record<string, string> = { status: str(a.status) || 'open' }
      if (str(a.business)) {
        const b = pickBiz(meta.businesses, a.business)
        if (!b || b === 'many') return fail(`Business "${str(a.business)}" ${b === 'many' ? 'matches several' : 'not found'}. Businesses: ${meta.businesses.map((x) => x.name).join(', ')}.`)
        query.business = b.id
      }
      const as = str(a.assignee).toLowerCase()
      if (as === 'me' || as === 'none') query.assignee = as
      else if (as) { const p = pickPerson(meta.businesses, a.assignee); if (!p) return fail(`No one called "${str(a.assignee)}" works these leads.`); query.assignee = p.id }
      if (a.late) query.late = '1'
      if (str(a.search)) query.q = str(a.search)
      if (typeof a.page === 'number' && a.page > 1) query.page = String(Math.floor(a.page))
      const r = await apiAs(u, 'GET', '/api/leads', { query })
      if (r.status >= 400) return fail(apiError(r))
      const d = r.body as { leads: LeadRowT[]; total: number; page: number; counts: { unassigned: number; mine: number; late: number; byStatus: Record<string, number> } }
      const names = new Map(meta.businesses.map((b) => [b.id, b.name]))
      return text([
        `${d.total} lead${d.total === 1 ? '' : 's'} (page ${d.page}). Open: ${['NEW', 'CONTACTED', 'QUALIFIED'].map((s) => `${s.toLowerCase()} ${d.counts.byStatus[s] ?? 0}`).join(', ')}; not assigned ${d.counts.unassigned}; mine ${d.counts.mine}; late ${d.counts.late}.`,
        ...d.leads.map((l) => `- ${leadLine(l, names)}`),
      ].join('\n'))
    },
  },
  {
    name: 'lead_get',
    title: 'One lead',
    description: 'Lead Management: everything about one lead (contact, message, where it came from, campaign, who has it, full history of calls, emails, notes and status changes).',
    inputSchema: { type: 'object', properties: { lead: { type: 'string', description: 'Lead id, email, phone or name' } }, required: ['lead'], additionalProperties: false },
    annotations: { readOnlyHint: true },
    async run(u, a) {
      const f = await findLead(u, a.lead)
      if (!f.id) return fail(f.error!)
      const r = await apiAs(u, 'GET', `/api/leads/${encodeURIComponent(f.id)}`)
      if (r.status >= 400) return fail(apiError(r))
      const { lead: l, canManage } = r.body as { lead: Record<string, unknown> & { events: { kind: string; text: string; createdAt: string; user: { name: string } | null; toName?: string | null; data: { from?: string; to?: string } | null }[]; business: { name: string }; assignee: { name: string } | null }; canManage: boolean }
      const hist = l.events.map((e) => `- ${e.createdAt.slice(0, 16).replace('T', ' ')} UTC ${e.kind}${e.kind === 'STATUS' ? ` ${e.data?.from} -> ${e.data?.to}` : ''}${e.kind === 'ASSIGNED' ? (e.toName ? ` to ${e.toName}` : ' back to no one') : ''}${e.user ? ` by ${e.user.name}` : ''}${e.text ? `: ${e.text.replace(/\s+/g, ' ').slice(0, 400)}` : ''}`)
      const { events: _e, raw: _r, ...rest } = l
      return text(`${JSON.stringify({ ...rest, business: l.business.name, assignee: l.assignee?.name ?? null }, (k, v) => (v === null || v === '' ? undefined : v))}\nThis person ${canManage ? 'manages this business (can assign)' : 'works this lead (cannot assign)'}.\nHistory (newest first):\n${hist.join('\n')}`)
    },
  },
  {
    name: 'lead_update',
    title: 'Work a lead',
    description: 'Lead Management, as the person: log a call or an email (counts as contact; a New lead becomes Contacted), add a note, change the status (CONTACTED, QUALIFIED, WON, LOST with a reason, SPAM), or (managers) give the lead to someone or take it back.',
    inputSchema: {
      type: 'object',
      properties: {
        lead: { type: 'string', description: 'Lead id, email, phone or name' },
        action: { type: 'string', enum: ['call', 'email', 'note', 'status', 'assign'] },
        text: { type: 'string', description: 'What was said (call/email), the note, or the reason it was lost' },
        status: { type: 'string', enum: ['NEW', 'CONTACTED', 'QUALIFIED', 'WON', 'LOST', 'SPAM'] },
        assignee: { type: 'string', description: 'assign: a person\'s name or email, "me", or "none" to take it back' },
      },
      required: ['lead', 'action'],
      additionalProperties: false,
    },
    async run(u, a) {
      const f = await findLead(u, a.lead)
      if (!f.id) return fail(f.error!)
      const id = encodeURIComponent(f.id)
      const action = str(a.action)
      if (action === 'call') {
        // A call goes on the lead's call log (connected, with the summary), like one logged in the app.
        const r = await apiAs(u, 'POST', `/api/leads/${id}/calls`, { body: { disposition: 'CONNECTED', summary: str(a.text).slice(0, 5000) } })
        return r.status >= 400 ? fail(apiError(r)) : text('Call logged.')
      }
      if (action === 'email' || action === 'note') {
        const r = await apiAs(u, 'POST', `/api/leads/${id}/events`, { body: { kind: action.toUpperCase(), text: str(a.text).slice(0, 5000) } })
        return r.status >= 400 ? fail(apiError(r)) : text(action === 'note' ? 'Note added.' : 'Email logged.')
      }
      if (action === 'status') {
        const s = str(a.status)
        if (!s) return fail('Give the status.')
        const r = await apiAs(u, 'PATCH', `/api/leads/${id}`, { body: { status: s, ...(s === 'LOST' && str(a.text) ? { lostReason: str(a.text).slice(0, 300) } : {}) } })
        return r.status >= 400 ? fail(apiError(r)) : text(`Status set to ${s}.`)
      }
      if (action === 'assign') {
        const g = str(a.assignee).toLowerCase()
        let assigneeId: string | null = null
        if (g === 'me') assigneeId = u.id
        else if (g && g !== 'none') {
          const { meta, error } = await leadsMeta(u)
          if (!meta) return fail(error!)
          const p = pickPerson(meta.businesses, a.assignee)
          if (!p) return fail(`No one called "${str(a.assignee)}" works these leads.`)
          assigneeId = p.id
        }
        const r = await apiAs(u, 'POST', `/api/leads/${id}/assign`, { body: { assigneeId } })
        return r.status >= 400 ? fail(apiError(r)) : text(assigneeId ? 'Assigned; they were told.' : 'Taken back: not assigned now.')
      }
      return fail('Pick an action: call, email, note, status or assign.')
    },
  },
  {
    name: 'lead_add',
    title: 'Add a lead',
    description: 'Lead Management: add a lead from a phone call or a meeting, as the person. A rep\'s new lead is theirs; a manager can leave it unassigned or give it to someone.',
    inputSchema: {
      type: 'object',
      properties: {
        business: { type: 'string', description: 'Business name (needed when the person works for more than one)' },
        name: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' }, company: { type: 'string' }, location: { type: 'string' },
        message: { type: 'string', description: 'What they need' },
        assign_to: { type: 'string', description: 'Managers: "me", "none", or a person\'s name' },
      },
      additionalProperties: false,
    },
    async run(u, a) {
      const { meta, error } = await leadsMeta(u)
      if (!meta) return fail(error!)
      const active = meta.businesses.filter((b) => b.isActive)
      const b = pickBiz(active, a.business)
      if (!b || b === 'many') return fail(`Say which business: ${active.map((x) => x.name).join(', ') || 'none set up'}.`)
      let assignTo: string | null | undefined
      const g = str(a.assign_to).toLowerCase()
      if (g === 'me') assignTo = 'me'
      else if (g === 'none') assignTo = null
      else if (g) { const p = pickPerson([b], a.assign_to); if (!p) return fail(`No one called "${str(a.assign_to)}" works ${b.name} leads.`); assignTo = p.id }
      const r = await apiAs(u, 'POST', '/api/leads', { body: { businessId: b.id, name: str(a.name), phone: str(a.phone), email: str(a.email), organization: str(a.company), location: str(a.location), message: str(a.message), ...(assignTo !== undefined ? { assignTo } : {}) } })
      if (r.status >= 400) return fail(apiError(r))
      return text(`Lead added to ${b.name} [id ${(r.body as { lead: { id: string } }).lead.id}].`)
    },
  },

  // ------------------------------------------------------------------ My To-Do

  {
    name: 'todo_list',
    title: 'My to-dos',
    description: 'My To-Do: the person\'s to-do items for a day (default today), a week or a month, with their status.',
    inputSchema: {
      type: 'object',
      properties: { from: { type: 'string', description: 'YYYY-MM-DD (default today)' }, to: { type: 'string', description: 'YYYY-MM-DD (default same as from)' } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    async run(u, a) {
      const zone = zoneOf(await me(u))
      const today = DateTime.now().setZone(zone).toISODate()!
      const from = /^\d{4}-\d{2}-\d{2}$/.test(str(a.from)) ? str(a.from) : today
      const to = /^\d{4}-\d{2}-\d{2}$/.test(str(a.to)) ? str(a.to) : from
      const r = await apiAs(u, 'GET', '/api/worklog', { query: { from, to } })
      if (r.status >= 400) return fail(apiError(r))
      const entries = (r.body as { entries: { id: string; title: string; status: string; period: string; date?: string; periodStart?: string; tag?: string | null; blocked?: boolean }[] }).entries
      if (!entries.length) return text(`No to-dos from ${from} to ${to}.`)
      return text(entries.map((e) => `- [${e.status === 'DONE' ? 'x' : e.status === 'IN_PROGRESS' ? '~' : ' '}] ${e.title.replace(/\s+/g, ' ').slice(0, 300)} (${e.period.toLowerCase()} ${e.periodStart ?? e.date ?? ''}${e.tag ? `, #${e.tag}` : ''}${e.blocked ? ', blocked' : ''}) [id ${e.id}]`).join('\n'))
    },
  },
  {
    name: 'todo_add',
    title: 'Add to-dos',
    description: 'My To-Do: add one or more items (one per line) for today or another day, week or month.',
    inputSchema: {
      type: 'object',
      properties: {
        items: { type: 'string', description: 'One to-do per line' },
        date: { type: 'string', description: 'YYYY-MM-DD (default today)' },
        period: { type: 'string', enum: ['DAY', 'WEEK', 'MONTH'], description: 'Default DAY' },
        tag: { type: 'string' },
      },
      required: ['items'],
      additionalProperties: false,
    },
    async run(u, a) {
      const zone = zoneOf(await me(u))
      const date = /^\d{4}-\d{2}-\d{2}$/.test(str(a.date)) ? str(a.date) : DateTime.now().setZone(zone).toISODate()!
      const lines = str(a.items).split('\n').map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean).slice(0, 50)
      if (!lines.length) return fail('Give at least one item.')
      let ok = 0
      const errors: string[] = []
      for (const title of lines) {
        const r = await apiAs(u, 'POST', '/api/worklog', { body: { title: title.slice(0, 3000), date, period: str(a.period) || 'DAY', ...(str(a.tag) ? { tag: str(a.tag).slice(0, 40) } : {}) } })
        // Counted only when Metriq returns the saved item (never "added" on a reply that saved nothing).
        const saved = r.status === 201 && !!(r.body as { entry?: { id?: string } } | null)?.entry?.id
        if (!saved) errors.push(`${title.slice(0, 60)}: ${r.status >= 400 ? apiError(r) : `not saved (Metriq answered ${r.status})`}`); else ok++
      }
      return errors.length ? fail(`Added ${ok}. Not added: ${errors.join('; ')}`) : text(`Added ${ok} to-do${ok === 1 ? '' : 's'} for ${date}.`)
    },
  },
  {
    name: 'todo_update',
    title: 'Update a to-do',
    description: 'My To-Do: mark an item done, in progress or planned, or change its text. Use todo_list for the id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, status: { type: 'string', enum: ['PLANNED', 'IN_PROGRESS', 'DONE'] }, title: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
    async run(u, a) {
      const body: Record<string, unknown> = {}
      if (str(a.status)) body.status = str(a.status)
      if (str(a.title)) body.title = str(a.title).slice(0, 3000)
      if (!Object.keys(body).length) return fail('Give a status or new text.')
      const r = await apiAs(u, 'PATCH', `/api/worklog/${encodeURIComponent(str(a.id))}`, { body })
      return r.status >= 400 ? fail(apiError(r)) : text('Updated.')
    },
  },

  // ------------------------------------------------------------------ meetings

  {
    name: 'meetings_list',
    title: 'My meetings',
    description: 'Meetings on the person\'s calendar between two dates (default the next 7 days), with who is invited.',
    inputSchema: { type: 'object', properties: { from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' } }, additionalProperties: false },
    annotations: { readOnlyHint: true },
    async run(u, a) {
      const zone = zoneOf(await me(u))
      const from = /^\d{4}-\d{2}-\d{2}$/.test(str(a.from)) ? DateTime.fromISO(str(a.from), { zone }) : DateTime.now().setZone(zone).startOf('day')
      const to = /^\d{4}-\d{2}-\d{2}$/.test(str(a.to)) ? DateTime.fromISO(str(a.to), { zone }).endOf('day') : from.plus({ days: 7 }).endOf('day')
      const r = await apiAs(u, 'GET', '/api/meetings', { query: { from: from.toUTC().toISO()!, to: to.toUTC().toISO()! } })
      if (r.status >= 400) return fail(apiError(r))
      const list = (r.body as { meetings: { id: string; title: string; startsAt: string; endsAt: string; cancelledAt?: string | null; attendees?: { name: string }[]; organizer?: { name: string } }[] }).meetings
      if (!list.length) return text('No meetings in that time.')
      return text(list.map((m) => `- ${DateTime.fromISO(m.startsAt).setZone(zone).toFormat('ccc d LLL HH:mm')}-${DateTime.fromISO(m.endsAt).setZone(zone).toFormat('HH:mm')} ${m.title}${m.cancelledAt ? ' (CANCELLED)' : ''}${m.attendees?.length ? ` with ${m.attendees.map((x) => x.name).join(', ')}` : ''} [id ${m.id}]`).join('\n') + `\nTimes are ${zone}.`)
    },
  },
  {
    name: 'meeting_schedule',
    title: 'Schedule a meeting',
    description: 'Put a meeting on the calendar as the person and invite people by name (they get the invite and a reminder). Time is the company\'s clock.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        start: { type: 'string', description: 'YYYY-MM-DD HH:MM on the company clock' },
        minutes: { type: 'number', description: 'Length in minutes (default 30)' },
        people: { type: 'array', items: { type: 'string' }, description: 'Names or emails to invite' },
        agenda: { type: 'string' },
      },
      required: ['title', 'start'],
      additionalProperties: false,
    },
    async run(u, a) {
      const zone = zoneOf(await me(u))
      const start = parseAt(a.start, zone)
      if (!start) return fail('Give the start as YYYY-MM-DD HH:MM.')
      const minutes = typeof a.minutes === 'number' && a.minutes > 0 ? Math.min(720, Math.round(a.minutes)) : 30
      const ids: string[] = []
      const missing: string[] = []
      for (const who of Array.isArray(a.people) ? a.people.slice(0, 50) : []) {
        const q = str(who)
        if (!q) continue
        const r = await apiAs(u, 'GET', '/api/chat/users', { query: { q } })
        const users = r.status === 200 ? (r.body as { users: { id: string; name: string; email?: string }[] }).users : []
        const hit = users.find((x) => x.name.toLowerCase() === q.toLowerCase() || x.email?.toLowerCase() === q.toLowerCase()) ?? (users.length === 1 ? users[0] : null)
        if (hit) ids.push(hit.id); else missing.push(users.length > 1 ? `${q} (several: ${users.slice(0, 4).map((x) => x.name).join(', ')})` : q)
      }
      if (missing.length) return fail(`Could not tell who these are: ${missing.join('; ')}. Use full names or emails.`)
      const r = await apiAs(u, 'POST', '/api/meetings', { body: { title: str(a.title).slice(0, 120), agenda: str(a.agenda).slice(0, 5000), startsAt: start.toUTC().toISO(), endsAt: start.plus({ minutes }).toUTC().toISO(), attendeeIds: ids } })
      if (r.status >= 400) return fail(apiError(r))
      return text(`Scheduled "${str(a.title)}" on ${start.toFormat('ccc d LLL HH:mm')} (${zone}) for ${minutes} minutes${ids.length ? `, ${ids.length} invited` : ''}.`)
    },
  },
]

/** Lines for metriq_guide. */
export const LEADS_GUIDE = [
  'Leads: leads_list (filters: business, status, assignee, late, search), lead_get for one lead and its history, lead_update to log a call or email, add a note, change status or (managers) assign, lead_add for a phone lead.',
]
export const WORK_GUIDE = [
  'My To-Do: todo_list, todo_add (one per line), todo_update (done / in progress / text).',
  'Meetings: meetings_list, meeting_schedule (invite people by name).',
  'Daily Report: /api/daily-report/forms (my forms), /api/daily-report/forms/FORM_ID/entry?date=YYYY-MM-DD (my entry), /api/daily-report/forms/FORM_ID/team?date=YYYY-MM-DD (team leads)',
]
