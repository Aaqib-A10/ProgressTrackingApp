import { DateTime } from 'luxon'
import type { Asker } from '../access'
import type { Args, Ctx, Entry, Loaded, Table } from './types'
import { auto, dayLog, figures, get, hours, loose, nameOf, pct, period, words, ymd } from './load'
import { norm, sameName } from './table'

/**
 * The rest of the app (found by the full audit of 15 Nov: every read route of every router, and every screen of the
 * menu, against the catalog): Lead Management, the Projects dashboard and reviews, a person's profile, the Lead
 * Dialer's imports and history, the QA team and one evaluation in full, a marketing item with its comments, the
 * marketing daily logs and social comparisons, the attendance register, the ITAD and Lead Gen trends and one day's
 * own entry, the Daily Report forms, tags and the employee of the month.
 *
 * These screens are read as they come (`auto` in load.ts): their own totals first, their longest list as the rows.
 */

const sa = (a: Asker) => a.role === 'SUPER_ADMIN'
const lead = (a: Asker) => sa(a) || a.role === 'TEAM_LEAD'
const has = (k: string) => (a: Asker) => sa(a) || a.kinds.includes(k as never)
const leadOf = (k: string) => (a: Asker) => sa(a) || (a.role === 'TEAM_LEAD' && a.kinds.includes(k as never))
const inLeads = (a: Asker) => a.sources.has('LEAD') && a.principals.has('leads')
/** The QA team list is for the QA lead and the Super Admin (controllers/qaController.ts, isQaLead). */
const qaLead = (a: Asker) => sa(a) || a.role === 'QA_LEAD'
const dialer = (a: Asker) => a.sources.has('DIALER_LEAD') && has('ITAD')(a)
const everyone = () => true
const dyn = (unit: [string, string]): Table => ({ unit, columns: [{ key: 'value', label: unit[0] }] })
type Opts = Parameters<typeof auto>[2]

/** The options a screen may take, from what the model passed: a period, one day, a month. Only what was given is sent. */
function asked(a: Args, ctx: Ctx, o: { range?: string; date?: boolean; month?: boolean } = {}): { query: Record<string, string>; notes: string[] } {
  const q: Record<string, string> = {}
  let notes: string[] = []
  if (o.range) { const p = period(a, ctx, o.range); Object.assign(q, p.query); notes = p.notes }
  if (o.date) q.date = ymd(a.date) || ymd(a.from) || ctx.today
  if (o.month) { const d = ymd(a.date) || ymd(a.from) || ymd(a.to); if (d) q.month = d.slice(0, 7) }
  return { query: q, notes }
}

/** One screen address read as it comes. */
const via = (path: string, unit: [string, string], o: Opts & { range?: string; day?: boolean; month?: boolean } = {}) => async (ctx: Ctx, a: Args): Promise<Loaded | { error: string }> => {
  const q = asked(a, ctx, { range: o.range, date: o.day, month: o.month })
  const r = await get<unknown>(ctx, path, q.query)
  if (r.error !== undefined) return { error: r.error }
  const d = auto(r.body, unit, o)
  return { ...d, notes: [...(d.notes ?? []), ...q.notes], dated: !!(o.range || o.day || o.month) }
}

/** One thing by its name among a list (exact, else the only one containing the words); otherwise the text to send back. */
function one<T>(list: T[], name: (x: T) => string, given: string | undefined, what: string): { hit: T } | { error: string } {
  // A long name is offered cut short ("Sell your retired tower..."): the cut form is matched by its start.
  const cut = /\.{3}$/.test((given ?? '').trim())
  const g = norm((given ?? '').trim().replace(/\.{3}$/, ''))
  const all = list.map(name).filter(Boolean).map((x) => (x.length > 70 ? `${x.slice(0, 67)}...` : x))
  if (!g) return list.length === 1 ? { hit: list[0] } : { error: `Say which ${what} (pass item with its name). There ${all.length === 1 ? 'is' : 'are'}: ${all.slice(0, 30).join('; ') || 'none'}${all.length > 30 ? `; and ${all.length - 30} more` : ''}.` }
  const exact = list.filter((x) => (cut ? norm(name(x)).startsWith(g) : norm(name(x)) === g))
  let hits = exact.length ? exact : list.filter((x) => norm(name(x)).includes(g) || sameName(given ?? '', name(x)))
  if (!hits.length) {
    // The words of the name that say what it is, not what kind of thing it is: "Freight Business" finds "Freight".
    const KIND = new Set(['business', 'businesses', 'company', 'the', 'our', 'my', 'team', 'board', 'deal', 'deals', 'block', 'form', 'list', what.toLowerCase()])
    const words = g.split(' ').filter((w) => w.length >= 3 && !KIND.has(w))
    if (words.length) hits = list.filter((x) => { const n = ` ${norm(name(x))} `; return words.every((w) => n.includes(` ${w}`)) })
  }
  if (hits.length === 1) return { hit: hits[0] }
  return { error: hits.length ? `"${given}" fits ${hits.length} ${what}s: ${hits.slice(0, 15).map(name).join('; ')}. Ask which one.` : `Nothing here: no ${what} is called "${given}". There ${all.length === 1 ? 'is' : 'are'}: ${all.slice(0, 50).join('; ') || 'none'}.` }
}

/** An analytics screen: whole months side by side as the rows; the rates and the funnel of the period asked about said first. */
const trend = (path: string, funnelKey: string) => async (ctx: Ctx, a: Args): Promise<Loaded | { error: string }> => {
  const p = period(a, ctx, 'month')
  type B = { range?: { startDate: string; endDate: string }; target?: unknown; kpis?: { label: string; value: number; format?: string }[]; periodComparison?: Record<string, unknown>[] } & Record<string, unknown>
  const r = await get<B>(ctx, path, p.query)
  if (r.error !== undefined) return { error: r.error }
  const b = r.body
  const funnel = (Array.isArray(b[funnelKey]) ? b[funnelKey] : []) as { stage: string; value: number }[]
  const rows = (b.periodComparison ?? []).map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k === 'label' ? 'period' : k, typeof v === 'number' && (/rate/i.test(k) || /To[A-Z]/.test(k)) ? pct(v) : v])))
  return {
    ...loose(rows, ['month compared', 'months compared']), dated: true, notes: p.notes,
    head: [
      b.range ? `The period asked about: ${b.range.startDate} to ${b.range.endDate}.` : '',
      (b.kpis ?? []).length ? `Rates for that period: ${(b.kpis ?? []).map((k) => `${k.label} ${k.format === 'percent' ? pct(k.value) : k.value}`).join('; ')}.` : '',
      funnel.length ? `Funnel for that period: ${funnel.map((s) => `${s.stage} ${s.value}`).join(', ')}.` : '',
      b.target && figures(b.target).length ? `Target: ${figures(b.target).join('; ')}.` : '',
      'The rows below are whole months side by side: this month so far, last month and the month before.',
    ].filter(Boolean),
  }
}

/** A Lead Dialer list: a manager reads the whole team's (rep=all, as the screen's "Everyone"), anyone else their own. */
async function dialerGet<T>(ctx: Ctx, path: string, q: Record<string, string> = {}) {
  if (lead(ctx.asker)) { const all = await get<T>(ctx, path, { ...q, rep: 'all' }); if (all.error === undefined) return all }
  return get<T>(ctx, path, q)
}

/** A daily form's own day: what the person entered that day as rows, their target and averages said first. */
const myDay = (path: string, name: string) => async (ctx: Ctx, a: Args): Promise<Loaded | { error: string }> => {
  const date = ymd(a.date) || ymd(a.from) || ctx.today
  const r = await get<{ entry?: unknown; stats?: unknown }>(ctx, path, { date })
  if (r.error !== undefined) return { error: r.error }
  const d = dayLog(`${ctx.me.name}'s ${name}`, date, r.body.entry)
  return { ...d, head: [...(d.head ?? []), ...(r.body.stats && figures(r.body.stats).length ? [`Target and averages: ${figures(r.body.stats).join('; ')}.`] : [])] }
}

type Biz = { id: string; name: string; isActive?: boolean; myRole?: string | null; isHead?: boolean; head?: unknown; members?: { name: string; role: string }[] }
/** The lead businesses this person works (the Leads menu's own list). */
async function bizAll(ctx: Ctx): Promise<Biz[] | { error: string }> {
  const r = await get<{ businesses?: Biz[] }>(ctx, '/api/leads/meta')
  return r.error !== undefined ? { error: r.error } : r.body.businesses ?? []
}
/** The business named (item), or the only one. `must`: the screen needs one; otherwise none named means all of them. */
async function bizOf(ctx: Ctx, given: unknown, must: boolean): Promise<{ hit: Biz | null } | { error: string }> {
  const list = await bizAll(ctx)
  if ('error' in list) return list
  const g = typeof given === 'string' ? given.trim() : ''
  if (!g && !must) return { hit: null }
  if (!list.length) return { error: 'Nothing here: this person works no lead business yet.' }
  return one(list, (b) => b.name, g, 'business')
}
/** Lead Management's own period words: week, month, last_month, all, or two dates. */
function leadRange(a: Args, ctx: Ctx): Record<string, string> {
  const from = ymd(a.from) || ymd(a.date), to = ymd(a.to) || ymd(a.date)
  if (from || to) return { range: 'custom', ...(from ? { from } : {}), ...(to ? { to } : {}) }
  const w = (typeof a.range === 'string' ? a.range : '').toLowerCase().replace(/[\s-]+/g, '_')
  const day = DateTime.fromISO(ctx.today, { zone: ctx.zone })
  if (w === 'today') return { range: 'custom', from: ctx.today, to: ctx.today }
  if (w === 'yesterday') { const y = day.minus({ days: 1 }).toISODate()!; return { range: 'custom', from: y, to: y } }
  if (/last_?month/.test(w)) return { range: 'last_month' }
  if (/week/.test(w)) return { range: 'week' }
  if (/^(all|all_time|ever|total)$/.test(w)) return { range: 'all' }
  if (/rolling|3m|quarter/.test(w)) return { range: 'custom', from: day.minus({ months: 3 }).toISODate()!, to: ctx.today }
  if (/year/.test(w)) return { range: 'custom', from: day.startOf('year').toISODate()!, to: ctx.today }
  return { range: 'month' }
}
/** One lead as a short row (a lead has dozens of fields; these are the ones a list shows). */
const leadRow = (l: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ lead: String(l.name ?? ''), organization: String(l.organization ?? ''), business: nameOf(l.business), status: String(l.statusLabel ?? l.status ?? ''), assignee: nameOf(l.assignee) || 'Unassigned', value: typeof l.value === 'number' ? l.value : null, nextStep: (l.nextStepDate as string | null) ?? null, lastActivity: (l.lastActivityAt as string | null) ?? null, overdue: l.overdue ? 'yes' : 'no', ...extra })
const DASH: Record<string, string> = {
  'cards: total': 'leads that came in during the period', 'cards: new this week': 'leads new this week', 'cards: recently updated': 'leads changed in the last 48 hours',
  'cards: no status': 'new leads of the period nobody has contacted yet', 'cards: assigned': 'leads of the period given to someone', 'cards: unassigned': 'open leads given to nobody',
  'cards: waiting': "leads waiting for the head's decision", 'cards: overdue': 'open leads whose next step is overdue', 'cards: prohibited': 'leads on the do-not-call list or already customers',
  'cards: below min': 'open leads below the minimum load', 'cards: calls': 'calls made in the period', 'cards: connected': 'calls that connected in the period',
  'cards: kept': 'phone-system calls to numbers that are not a lead yet', 'cards: late': 'new leads past their time limit to be assigned or contacted',
  'tasks: today': 'follow-up tasks due today', 'tasks: overdue': 'follow-up tasks overdue', 'tasks: total': 'follow-up tasks due today or overdue', 'open value': 'what the open deals add up to',
}
/** A part of Lead Management that is switched off for the company reads as "nothing here", not as a failure. */
const off = (e: string) => (/not switched on/i.test(e) ? `Nothing here: ${e.replace(/^.*\((.*)\)\.?$/, '$1')}` : e)

export const MORE: Entry[] = [
  // ------------------------------------------------------------------ Lead Management
  {
    key: 'leads.dashboard', label: 'Lead Dashboard', area: 'Lead Management', app: '/app/leads/dashboard',
    about: 'Lead Management at a glance for a period (this month unless a period is given; item = one business): leads in total, new this week, assigned and unassigned, waiting for review, overdue, calls and connected calls, tasks due, leads by status, and what the open deals add up to.',
    says: ['lead dashboard', 'leads dashboard', 'new leads', 'leads this week', 'leads this month', 'leads by status', 'how many leads came in', 'how many leads', 'unassigned leads', 'lead numbers', 'open value', 'kitni leads'],
    who: inLeads, pin: (a) => inLeads(a) && !sa(a), takes: ['range', 'item'],
    blocks: [], apis: ['/api/leads/dashboard', '/api/leads/meta'], models: ['Lead', 'LeadBusiness'],
    async load(ctx, a) {
      const biz = await bizOf(ctx, a.item, false)
      if ('error' in biz) return { error: biz.error }
      const q = leadRange(a, ctx)
      const r = await get<Record<string, unknown>>(ctx, '/api/leads/dashboard', { ...q, ...(biz.hit ? { business: biz.hit.id } : {}) })
      if (r.error !== undefined) return { error: r.error }
      const d = auto(r.body, ['figure', 'figures'], { skip: /^currency$/ })
      // The screen's short card names, said as what each one counts (controllers/leadsWorkController.ts, dashboard).
      d.rows = d.rows.map((x) => ({ ...x, figure: DASH[String(x.figure)] ?? String(x.figure).replace(/^by status: /, 'leads of the period in the stage ') }))
      return { ...d, dated: true, head: [`${biz.hit ? `Business: ${biz.hit.name}.` : 'Every business this person works.'}${r.body.currency ? ` Money is in ${String(r.body.currency)}.` : ''}`, ...(d.head ?? [])] }
    },
    table: dyn(['figure', 'figures']),
    tip: 'The leads themselves (who, status, last activity) are read with leads_list.',
  },
  {
    key: 'leads.board', label: 'Deal Board', area: 'Lead Management', app: '/app/leads/board',
    about: 'The deals of ONE business by stage (item = the business; the only one is taken when there is one): each deal, its stage, its value, who has it, its next step and when it last moved; with the count and value of every stage.',
    says: ['deal board', 'deals by stage', 'pipeline value', 'lead deals', 'won deals', 'stage of the deal', 'deals in negotiation', 'pipeline'],
    who: inLeads, takes: ['item'],
    blocks: [], apis: ['/api/leads/board', '/api/leads/meta'], models: ['Lead', 'LeadListEntry'],
    async load(ctx, a) {
      const biz = await bizOf(ctx, a.item, true)
      if ('error' in biz) return { error: biz.error }
      type Col = { label: string; count: number; value: number; leads: Record<string, unknown>[] }
      const r = await get<{ currency?: string; closedDays?: number; columns?: Col[]; totals?: { open: { count: number; value: number }; won: { count: number; value: number } } }>(ctx, '/api/leads/board', { business: biz.hit!.id })
      if (r.error !== undefined) return { error: off(r.error) }
      const cols = r.body.columns ?? []
      const cur = r.body.currency ? ` ${r.body.currency}` : ''
      const listed = cols.reduce((n, c) => n + c.leads.length, 0), all = cols.reduce((n, c) => n + c.count, 0)
      return {
        ...loose(cols.flatMap((c) => c.leads.map((l) => { const { status: _status, business: _business, ...row } = leadRow(l); return { ...row, stage: c.label } })), ['deal', 'deals'], { people: ['assignee'], status: 'stage', sums: ['value'], date: 'lastActivity' }),
        head: [
          `Business: ${biz.hit!.name}.`,
          r.body.totals ? `Open deals: ${r.body.totals.open.count}, worth ${r.body.totals.open.value}${cur}. Won in the last ${r.body.closedDays ?? 90} days: ${r.body.totals.won.count}, worth ${r.body.totals.won.value}${cur}.` : '',
          `Every stage (all its deals): ${cols.map((c) => `${c.label} ${c.count} (${c.value}${cur})`).join('; ') || 'none'}.`,
        ].filter(Boolean),
        notes: listed < all ? [`The board shows the newest deals of each stage: ${listed} of ${all} are listed below. The stage counts above cover all of them.`] : [],
      }
    },
    table: dyn(['deal', 'deals']),
  },
  {
    key: 'leads.contacts', label: 'Lead contacts', area: 'Lead Management', app: '/app/leads/contacts',
    about: 'The people behind the leads this person can see: name, role, company, email and phone, and whether they decide (item = one business).',
    says: ['lead contacts', 'contacts', 'contact list', 'decision maker', 'who is the contact at', 'contact person'],
    who: inLeads, takes: ['item'],
    blocks: [], apis: ['/api/leads/contacts', '/api/leads/meta'], models: ['LeadContact'],
    async load(ctx, a) {
      const biz = await bizOf(ctx, a.item, false)
      if ('error' in biz) return { error: biz.error }
      const r = await get<unknown>(ctx, '/api/leads/contacts', { pageSize: '200', ...(biz.hit ? { business: biz.hit.id } : {}) })
      if (r.error !== undefined) return { error: off(r.error) }
      return auto(r.body, ['contact', 'contacts'], { rows: 'contacts', skip: /^capped$/, drop: /^(primary|status|statusColor|open)$/, status: 'statusLabel', people: ['assignee'], groups: ['business'] })
    },
    table: dyn(['contact', 'contacts']),
  },
  {
    key: 'leads.tasks', label: 'Agent Tasks', area: 'Lead Management', app: '/app/leads/tasks',
    about: "The follow-up tasks on leads (the asker's own; a manager also sees their businesses'): what to do, for which lead, who has it, when it is due, and whether it is due today, overdue, upcoming or done.",
    says: ['lead tasks', 'agent tasks', 'follow up tasks', 'lead follow ups', 'tasks on leads', 'overdue lead tasks', 'who do i have to call back', 'callbacks'],
    who: inLeads,
    blocks: [], apis: ['/api/leads/tasks'], models: ['LeadTask'],
    async load(ctx) {
      type T = { title: string; notes?: string; dueAt: string; doneAt?: string | null; outcome?: string | null; overdue?: boolean; today?: boolean; assignee?: unknown; lead?: { name?: string; organization?: string; business?: { name: string } } }
      // The screen keeps the tasks still to do ("all") and the finished ones ("done") on two tabs: both are read.
      const [r, done] = await Promise.all([get<{ tasks?: T[]; counts?: { today: number; overdue: number; upcoming: number } }>(ctx, '/api/leads/tasks', { tab: 'all' }), get<{ tasks?: T[] }>(ctx, '/api/leads/tasks', { tab: 'done' })])
      if (r.error !== undefined) return { error: r.error }
      const c = r.body.counts
      return {
        ...loose([...(r.body.tasks ?? []), ...(done.body?.tasks ?? [])].map((t) => ({ task: t.title, lead: [t.lead?.name, t.lead?.organization].filter(Boolean).join(', '), business: t.lead?.business?.name ?? '', assignee: nameOf(t.assignee) || 'Unassigned', due: t.dueAt, state: t.doneAt ? 'Done' : t.overdue ? 'Overdue' : t.today ? 'Due today' : 'Upcoming', outcome: t.outcome ?? '', notes: t.notes ?? '' })), ['task', 'tasks'], { people: ['assignee'], status: 'state', date: 'due', groups: ['business'] }),
        head: [c ? `Not done yet: ${c.today} due today, ${c.overdue} overdue, ${c.upcoming} upcoming.` : '', `Finished: ${(done.body?.tasks ?? []).length}${(done.body?.tasks ?? []).length >= 300 ? ' or more (the newest 300 are listed)' : ''}.`].filter(Boolean),
      }
    },
    table: dyn(['task', 'tasks']),
  },
  {
    key: 'leads.calls', label: 'Lead calls', area: 'Lead Management', app: '/app/leads/calls',
    about: 'The phone calls logged on leads, newest first: which lead, who called, when, how long, the result and the summary written; and how many calls went to numbers that are not a lead yet.',
    says: ['lead calls', 'calls on leads', 'call log', 'calls made', 'unmatched calls', 'call duration', 'who called the lead', 'call summary', 'calls today'],
    who: inLeads,
    blocks: [], apis: ['/api/leads/calls', '/api/leads/unmatched'], models: ['LeadCall', 'LeadUnmatchedCall'],
    async load(ctx) {
      type C = { at: string; direction?: string; durationSec?: number; disposition?: string; summary?: string; outcome?: string | null; user?: unknown; lead?: { name?: string; organization?: string; business?: { name: string } } }
      const [calls, stray] = await Promise.all([get<{ calls?: C[]; total?: number }>(ctx, '/api/leads/calls'), get<{ numbers?: unknown[]; total?: number }>(ctx, '/api/leads/unmatched')])
      if (calls.error !== undefined) return { error: calls.error }
      const list = calls.body.calls ?? [], total = calls.body.total ?? list.length
      return {
        ...loose(list.map((c) => ({ when: c.at, lead: [c.lead?.name, c.lead?.organization].filter(Boolean).join(', '), business: c.lead?.business?.name ?? '', caller: nameOf(c.user), direction: (c.direction ?? '').toLowerCase(), seconds: c.durationSec ?? 0, result: (c.disposition ?? '').replace(/_/g, ' ').toLowerCase(), outcome: c.outcome ?? '', summary: c.summary ?? '' })), ['call', 'calls'], { people: ['caller'], status: 'result', date: 'when', sums: ['seconds'], groups: ['business'] }),
        head: [`Calls logged on leads in all: ${total}.`, stray.body ? `Calls to numbers that are not a lead yet: ${stray.body.total ?? 0}, from ${(stray.body.numbers ?? []).length} numbers.` : ''].filter(Boolean),
        notes: total > list.length ? [`Only the newest ${list.length} of the ${total} calls are listed and counted below.`] : [],
      }
    },
    table: dyn(['call', 'calls']),
  },
  {
    key: 'leads.report', label: 'Lead daily report', area: 'Lead Management', app: '/app/leads/report',
    about: "The Lead Management daily report for ONE day: for a rep, their own day (dials, connected, voicemails, emails, interested, and their note); for a manager, each rep's day and what needs their review.",
    says: ['lead daily report', 'lead report', 'my lead report', 'team lead report', 'dials today', 'leads contacted today', 'sdr report', 'did i submit my lead report', 'how many dials', 'dials did i', 'my dials', 'voicemails today'],
    who: inLeads, takes: ['date'],
    blocks: [], apis: ['/api/leads/report', '/api/leads/report/team'], models: ['LeadDailyReport'],
    async load(ctx, a) {
      const date = ymd(a.date) || ymd(a.from) || ctx.today
      type Day = { dials?: number; connected?: number; voicemails?: number; emails?: number; interested?: number; shortConnected?: number }
      type Rep = (Day & { note?: string }) | null
      const [team, mine] = await Promise.all([
        get<{ business: { name: string }; rows?: { sdr: { name: string }; counted: Day; report: Rep }[]; review?: Record<string, unknown> }>(ctx, '/api/leads/report/team', { date }),
        get<{ business: { name: string }; counted: Day; report: Rep }>(ctx, '/api/leads/report', { date }),
      ])
      const day = (c: Day, r: Rep) => ({ dials: c.dials ?? 0, connected: c.connected ?? 0, voicemails: c.voicemails ?? 0, emails: c.emails ?? 0, interested: c.interested ?? 0, shortCalls: c.shortConnected ?? 0, sent: r ? 'Sent' : 'Not sent', note: r?.note ?? '' })
      if (team.body) {
        const v = team.body.review ?? {}
        const n = (k: string) => (Array.isArray(v[k]) ? (v[k] as unknown[]).length : 0)
        return {
          ...loose((team.body.rows ?? []).map((x) => ({ rep: x.sdr.name, ...day(x.counted, x.report) })), ['rep', 'reps'], { people: ['rep'], status: 'sent', sums: ['dials', 'connected', 'voicemails', 'emails', 'interested'] }),
          dated: true, head: [`Business: ${team.body.business.name}. Day: ${date}. The numbers are counted from the calls and emails of the day.`, `For the manager to look at: ${n('toApprove')} leads to approve, ${n('overdue')} leads overdue, ${n('noSummary')} connected calls with no summary, ${n('shortConnected')} connected calls too short to count, ${n('outcomeDue')} meetings with no outcome yet.`],
        }
      }
      if (mine.error !== undefined) return { error: /No CMR business/i.test(mine.error) ? 'Nothing here: there is no lead business with a daily report for this person.' : off(mine.error) }
      return { ...loose([{ rep: ctx.me.name, ...day(mine.body.counted, mine.body.report) }], ['rep', 'reps'], { people: ['rep'], status: 'sent' }), dated: true, head: [`Business: ${mine.body.business.name}. Day: ${date}. ${ctx.me.name}'s own day, counted from their calls and emails.`] }
    },
    table: dyn(['rep', 'reps']),
  },
  {
    key: 'leads.queue', label: 'Review queue and summary', area: 'Lead Management', app: '/app/leads/queue',
    about: 'The leads waiting for the head of the business to decide (the review queue): each lead, who flagged it and how many working days it has waited; with how many were decided and closed lately. For managers, also the business summary: key numbers, leads per stage, calls per rep and how many leads each rep qualified.',
    says: ['jesse queue', 'jesse summary', 'review queue', 'leads waiting for review', 'waiting for decision', 'head summary', 'calls per rep', 'qualify rate', 'leads waiting'],
    who: inLeads,
    blocks: [], apis: ['/api/leads/queue', '/api/leads/summary'], models: ['Lead', 'LeadCmr'],
    async load(ctx) {
      type Q = { queue?: Record<string, unknown>[]; decided?: unknown[]; closed?: unknown[] }
      type S = { business?: unknown; keyNumbers?: { total: number; waiting: number; qualified: number; overdue: number; callsWeek: number; calls30: number; avgWaitDays: number; avgDecideDays: number; meetingsMonth: number }; pipeline?: { label: string; count: number }[]; callsBySdr?: { name: string; calls: number }[]; bySegment?: { segment: string; count: number }[]; qualifyRate?: { name: string; leads: number; qualified: number; rate: number }[] }
      const [queue, sum] = await Promise.all([get<Q>(ctx, '/api/leads/queue'), get<S>(ctx, '/api/leads/summary')])
      if (queue.error !== undefined) return { error: queue.error }
      const b = sum.body, k = b?.keyNumbers
      return {
        ...loose((queue.body.queue ?? []).map((l) => leadRow(l, { flaggedBy: nameOf(l.flaggedBy), waitingDays: typeof l.waitingDays === 'number' ? l.waitingDays : null, askedOfTheHead: typeof l.jesseAsk === 'string' ? l.jesseAsk : '' })), ['lead waiting', 'leads waiting'], { people: ['assignee', 'flaggedBy'], groups: ['business'] }),
        head: [
          `Decided by the head in the last 30 days: ${(queue.body.decided ?? []).length}. Leads closed in the last 90 days: ${(queue.body.closed ?? []).length}.`,
          // The summary is for the managers of the business; a rep gets the queue alone.
          ...(b && k ? [
            `Summary of ${nameOf(b.business) || 'the business'}: ${k.total} leads in all, ${k.waiting} waiting for the head, ${k.qualified} qualified, ${k.overdue} open with an overdue next step. Calls: ${k.callsWeek} this week, ${k.calls30} in the last 30 days. Meetings set up this month: ${k.meetingsMonth}. A lead waits ${k.avgWaitDays} working days for the head on average; decided ones took ${k.avgDecideDays}.`,
            (b.pipeline ?? []).length ? `Leads per stage: ${(b.pipeline ?? []).map((x) => `${x.label} ${x.count}`).join(', ')}.` : '',
            (b.callsBySdr ?? []).length ? `Calls per rep in the last 30 days: ${(b.callsBySdr ?? []).map((x) => `${x.name} ${x.calls}`).join(', ')}.` : '',
            (b.qualifyRate ?? []).length ? `Per rep: ${(b.qualifyRate ?? []).map((x) => `${x.name} has ${x.leads} leads, ${x.qualified} of them qualified or won (${x.rate}%)`).join('; ')}.` : '',
            (b.bySegment ?? []).length ? `Leads per segment: ${(b.bySegment ?? []).map((x) => `${x.segment} ${x.count}`).join(', ')}.` : '',
          ] : []),
        ].filter(Boolean),
      }
    },
    table: dyn(['lead waiting', 'leads waiting']),
  },
  {
    key: 'leads.businesses', label: 'Lead businesses', area: 'Lead Management', app: '/app/leads',
    about: "The businesses leads come in for, as far as this person works them: each one, whether it is active, its head, its managers and reps, and this person's own role in it.",
    says: ['lead businesses', 'which businesses', 'who manages the business', 'reps of the business', 'business head', 'who works the leads of', 'my businesses'],
    who: inLeads,
    blocks: [], apis: ['/api/leads/meta', '/api/leads/businesses'], models: ['LeadBusiness', 'LeadBusinessMember'],
    async load(ctx) {
      const list = await bizAll(ctx)
      if ('error' in list) return { error: list.error }
      // The settings list (Lead Management admins only) adds how many leads each business has.
      const admin = await get<{ businesses?: { id: string; openLeads?: number; leadCount?: number }[] }>(ctx, '/api/leads/businesses')
      const n = new Map((admin.body?.businesses ?? []).map((b) => [b.id, b]))
      return loose(list.map((b) => ({ business: b.name, state: b.isActive === false ? 'Not active' : 'Active', head: nameOf(b.head), managers: (b.members ?? []).filter((m) => m.role === 'MANAGER').map((m) => m.name).join(', '), reps: (b.members ?? []).filter((m) => m.role !== 'MANAGER').map((m) => m.name).join(', '), myRole: b.isHead ? 'head' : (b.myRole ?? '').toLowerCase(), ...(n.has(b.id) ? { openLeads: n.get(b.id)!.openLeads ?? 0, leads: n.get(b.id)!.leadCount ?? 0 } : {}) })), ['business', 'businesses'], { people: ['head', 'managers', 'reps'], status: 'state', sums: ['openLeads', 'leads'] })
    },
    table: dyn(['business', 'businesses']),
  },

  // ------------------------------------------------------------------ Projects
  {
    key: 'projects.overview', label: 'Projects Dashboard', area: 'Projects', app: '/app/projects/dashboard',
    about: 'All the projects the asker can see at a glance (the last 30 days unless dates are given): for each project its open, in-progress, overdue and done tasks; for each person their open, overdue and completed tasks; the overdue tasks by name; how much was finished on time; and the asker\'s own numbers.',
    says: ['projects dashboard', 'project dashboard', 'projects overview', 'how are the projects', 'which project is behind', 'tasks per project', 'workload', 'who has the most tasks', 'tasks per person', 'completed on time', 'overdue per project', 'on time rate'],
    who: everyone, takes: ['from_to'],
    blocks: ['projects'], apis: ['/api/projects/reports/overview', '/api/projects/me/metrics'], models: ['PmProject', 'PmTask', 'PmActivity'],
    async load(ctx, a) {
      type Tot = { open: number; overdue: number; completed: number; completedWithDue: number; completedOnTime: number; onTimeRate: number | null; avgDaysLate: number | null }
      type Over = { from: string; to: string; overall: Tot; byProject: { key: string; name: string; open: number; inProgress: number; overdue: number; done: number }[]; byMember: ({ name: string } & Tot)[]; overdue: { code: string; title: string; project?: unknown; status: string; assignees?: unknown[]; daysOverdue: number }[] }
      const q: Record<string, string> = { ...(ymd(a.from) ? { from: ymd(a.from) } : {}), ...(ymd(a.to) ? { to: ymd(a.to) } : {}) }
      const [all, mine] = await Promise.all([get<Over>(ctx, '/api/projects/reports/overview', q), get<{ metrics: Tot }>(ctx, '/api/projects/me/metrics', q)])
      // The dashboard of all projects is for project admins; everyone has their own task numbers.
      if (all.error !== undefined) {
        if (!mine.body) return { error: all.error }
        const m = mine.body.metrics
        return {
          ...loose([{ person: ctx.me.name, open: m.open, overdue: m.overdue, completed: m.completed, completedOnTime: m.completedOnTime, completedWithDueDate: m.completedWithDue, onTime: m.onTimeRate != null ? pct(m.onTimeRate) : '' }], ['person', 'people'], { people: ['person'] }),
          dated: true, head: [`The dashboard of all projects is for project admins, so these are ${ctx.me.name}'s own task numbers across their projects ("completed" counts the last 30 days unless dates were given; open and overdue are as of now).`],
        }
      }
      const o = all.body
      const tot = (t: Tot) => `open ${t.open}, overdue ${t.overdue}, completed ${t.completed}${t.completedWithDue ? ` (${t.completedOnTime} of the ${t.completedWithDue} with a due date were on time${t.onTimeRate != null ? `, ${pct(t.onTimeRate)}` : ''}${t.avgDaysLate != null ? `; late ones were ${Math.round(t.avgDaysLate * 10) / 10} days late on average` : ''})` : ''}`
      return {
        ...loose(o.byProject.map((p) => ({ project: `${p.key} ${p.name}`, open: p.open, inProgress: p.inProgress, overdue: p.overdue, done: p.done })), ['project', 'projects'], { sums: ['open', 'inProgress', 'overdue', 'done'] }),
        dated: true,
        head: [
          `From ${o.from} to ${o.to} ("completed" counts tasks finished in these days; open and overdue are as of now).`,
          `All projects together: ${tot(o.overall)}.`,
          o.byMember.length ? `Per person: ${o.byMember.map((m) => `${m.name.trim()}: ${tot(m)}`).join(' | ')}.` : '',
          o.overdue.length ? `Overdue tasks (${o.overdue.length}): ${o.overdue.slice(0, 30).map((t) => `${t.code} ${t.title} (${nameOf(t.project)}, ${t.status}, ${t.daysOverdue} days overdue${(t.assignees ?? []).length ? `, ${(t.assignees ?? []).map((x) => nameOf(x).trim()).filter(Boolean).join(' and ')}` : ', nobody assigned'})`).join('; ')}${o.overdue.length > 30 ? '; and more' : ''}.` : 'No task is overdue.',
          mine.body ? `${ctx.me.name}'s own tasks: ${tot(mine.body.metrics)}.` : '',
        ].filter(Boolean),
      }
    },
    table: dyn(['project', 'projects']),
    tip: 'The tickets themselves are read with list_projects and list_project_tickets.',
  },
  {
    key: 'projects.reviews', label: 'Project reviews', area: 'Projects', app: '/app/projects',
    about: 'The reviews written on the tasks of ONE project (item = the project): which task, who reviewed it, the verdict, the rating and what was said.',
    says: ['project reviews', 'reviews in the project', 'who reviewed', 'review feedback', 'changes requested', 'review rating'],
    who: everyone, takes: ['item'],
    blocks: ['projects'], apis: ['/api/projects', '/api/projects/:key/reviews'], models: ['PmReview'],
    async load(ctx, a) {
      const list = await get<{ projects?: { key: string; name: string }[] }>(ctx, '/api/projects')
      if (list.error !== undefined) return { error: list.error }
      const p = one(list.body.projects ?? [], (x) => `${x.key} ${x.name}`, a.item, 'project')
      if ('error' in p) return { error: p.error }
      type R = { verdict?: string; rating?: number | null; body?: string; createdAt?: string; reviewer?: unknown; task?: { code: string; title: string; status?: string; assignees?: unknown[] } }
      const r = await get<{ reviews?: R[] }>(ctx, `/api/projects/${encodeURIComponent(p.hit.key)}/reviews`)
      if (r.error !== undefined) return { error: r.error }
      return {
        ...loose((r.body.reviews ?? []).map((x) => ({ task: `${x.task?.code ?? ''} ${x.task?.title ?? ''}`.trim(), taskStatus: x.task?.status ?? '', doneBy: (x.task?.assignees ?? []).map((u) => nameOf(u).trim()).filter(Boolean).join(', '), reviewer: nameOf(x.reviewer).trim(), verdict: (x.verdict ?? '').replace(/_/g, ' ').toLowerCase(), rating: x.rating ?? null, said: x.body ?? '', when: x.createdAt ?? null })), ['review', 'reviews'], { people: ['reviewer', 'doneBy'], status: 'verdict', date: 'when' }),
        head: [`Reviews in project ${p.hit.key} ${p.hit.name}.`],
      }
    },
    table: dyn(['review', 'reviews']),
  },

  // ------------------------------------------------------------------ People
  {
    key: 'people.profile', label: "A person's profile", area: 'People', app: '/app/team/members',
    about: "For team leads: ONE person of their team as their profile page shows them (item = the person; this month unless a period is given): their role and team, whether today's log is in, their totals and rates for the period against the period before, and each day's log with its notes. Daily numbers are kept for ITAD and Lead Generation people.",
    says: ['profile of', 'performance of', 'tell me about', 'member profile', 'how is he doing', 'how is she doing', 'how did he do', 'day by day', 'ki performance', 'kaisa kaam', 'how is', 'doing this month', 'doing this week', 'how has', 'numbers of'],
    who: lead, takes: ['item', 'range'],
    blocks: ['my-team'], apis: ['/api/admin/team-members', '/api/members/:id'], models: ['User'],
    async load(ctx, a) {
      const team = await get<{ members: { id: string; name: string }[] }>(ctx, '/api/admin/team-members')
      if (team.error !== undefined) return { error: team.error }
      const p = one(team.body.members, (m) => m.name.trim(), a.item || a.person, 'person')
      if ('error' in p) return { error: p.error }
      const q = period(a, ctx, 'month')
      type P = { user: { name: string; role: string; department: string | null; subDepartment: string | null }; kind: string; range: { startDate: string; endDate: string }; today: { status: string }; summary: unknown; deltas: unknown; entries: Record<string, unknown>[] }
      const r = await get<P>(ctx, `/api/members/${encodeURIComponent(p.hit.id)}`, q.query)
      if (r.error !== undefined) return { error: r.error }
      const b = r.body
      const nums = Object.entries(b.entries[0] ?? {}).filter(([, v]) => typeof v === 'number').map(([k]) => k)
      return {
        ...loose(b.entries, ['day logged', 'days logged'], { status: 'status', date: 'date', sums: nums }),
        dated: true, notes: q.notes,
        head: [
          `Profile of ${b.user.name.trim()}: ${b.user.role.replace(/_/g, ' ').toLowerCase()}, ${[b.user.department, b.user.subDepartment].filter(Boolean).join(' / ') || 'no team'}. Period ${b.range.startDate} to ${b.range.endDate}. Today's log: ${b.today.status.replace(/_/g, ' ').toLowerCase()}.`,
          b.kind === 'NONE' ? `The profile page keeps daily numbers only for ITAD and Lead Generation people, so there are none here for ${b.user.name.trim()}. Their attendance, tasks and their team's own screens are other data sets.` : '',
          ...(b.summary ? [`Totals and rates for the period: ${figures(b.summary).join('; ')}.`] : []),
          ...(b.deltas && figures(b.deltas).length ? [`Against the period before: ${figures(b.deltas).join('; ')}.`] : []),
        ].filter(Boolean),
      }
    },
    table: dyn(['day logged', 'days logged']),
  },
  {
    key: 'people.top', label: 'Employee of the month', area: 'People', app: '/app/dashboard',
    about: 'The employee of the month for each team this month: who it is and on what basis, or why there is none yet.',
    says: ['employee of the month', 'top achiever', 'top performer', 'best employee', 'who is the best this month', 'winner of the month'],
    who: everyone,
    blocks: ['dashboard'], apis: ['/api/dashboard/top-achiever'], models: [],
    async load(ctx) {
      const r = await get<{ month?: string; winners?: { label: string; basis: string; winner: unknown; note?: string | null }[] }>(ctx, '/api/dashboard/top-achiever')
      if (r.error !== undefined) return { error: r.error }
      return { ...loose((r.body.winners ?? []).map((w) => ({ team: w.label, winner: nameOf(w.winner) || 'Nobody yet', basis: w.basis, note: w.note ?? '' })), ['team', 'teams'], { people: ['winner'] }), head: r.body.month ? [`Month ${r.body.month}.`] : [] }
    },
    table: dyn(['team', 'teams']),
  },
  {
    key: 'attendance.register', label: 'Attendance register', area: 'Attendance', app: '/app/attendance/team',
    about: 'For team leads: every person of the team against every day of a period (this week unless dates are given): present, late, absent, on leave or off on each day, with each person\'s totals and hours worked.',
    says: ['attendance register', 'register', 'was present on', 'who was absent on', 'absent yesterday', 'present yesterday', 'day by day attendance', 'attendance on', 'who came late on', 'kal kaun nahi aaya'],
    who: lead, takes: ['range', 'date'],
    blocks: ['attendance-team'], apis: ['/api/attendance/register'], models: ['AttendanceDay', 'LeaveDay'],
    async load(ctx, a) {
      const p = period(a, ctx, 'week')
      const day = DateTime.fromISO(ctx.today, { zone: ctx.zone })
      // The register takes two dates: a period word is turned into its dates here.
      const word = p.query.range
      const start = p.query.start ?? (word === 'today' ? ctx.today : word === 'month' ? day.startOf('month').toISODate()! : word === 'rolling3m' ? day.minus({ days: 60 }).toISODate()! : day.startOf('week').toISODate()!)
      const end = p.query.end ?? ctx.today
      type Cell = { label?: string; offName?: string | null; late?: boolean; earlyLeave?: boolean; wfh?: boolean }
      type M = { userId: string; name: string; department?: string; cells?: Cell[]; totals?: { present?: number; absent?: number; leave?: number; late?: number; leftEarly?: number; fullShifts?: number; workedMin?: number } }
      const r = await get<{ start: string; end: string; dates?: string[]; members?: M[] }>(ctx, '/api/attendance/register', { start, end })
      if (r.error !== undefined) return { error: r.error }
      const dates = r.body.dates ?? []
      const perDay = dates.length <= 14
      const cell = (c?: Cell) => (c ? `${c.offName || (c.label ?? '').replace(/_/g, ' ').toLowerCase()}${c.late ? ', late' : ''}${c.earlyLeave ? ', left early' : ''}${c.wfh ? ', from home' : ''}` : '')
      const rows = (r.body.members ?? []).map((m) => ({ id: m.userId, name: m.name.trim(), team: m.department ?? '', present: m.totals?.present ?? 0, absent: m.totals?.absent ?? 0, leave: m.totals?.leave ?? 0, late: m.totals?.late ?? 0, leftEarly: m.totals?.leftEarly ?? 0, fullShifts: m.totals?.fullShifts ?? 0, worked: hours(m.totals?.workedMin), ...(perDay ? Object.fromEntries(dates.map((d, i) => [d, cell((m.cells ?? [])[i])])) : {}) }))
      return {
        rows, dated: true, notes: [...p.notes, ...(perDay ? [] : [`The period is ${dates.length} days long, so the totals per person are given and not each day. Ask for 14 days or fewer to see each day.`])],
        head: [`Register from ${r.body.start} to ${r.body.end} (${dates.length} days).`],
        table: {
          unit: ['person', 'people'], people: ['name'], mine: 'id', sums: ['present', 'absent', 'leave', 'late', 'leftEarly'],
          columns: [{ key: 'id', label: 'id', hidden: true }, { key: 'name', label: 'person' }, { key: 'team', label: 'team' }, { key: 'present', label: 'days present', kind: 'number' }, { key: 'absent', label: 'days absent', kind: 'number' }, { key: 'leave', label: 'days on leave', kind: 'number' }, { key: 'late', label: 'days late', kind: 'number' }, { key: 'leftEarly', label: 'days left early', kind: 'number' }, { key: 'fullShifts', label: 'full shifts', kind: 'number' }, { key: 'worked', label: 'worked' }, ...(perDay ? dates.map((d) => ({ key: d, label: d })) : [])],
        },
      }
    },
    table: dyn(['person', 'people']),
    tip: 'One column per day: for "who was absent on a day", read that day\'s column.',
  },

  // ------------------------------------------------------------------ Numbers: trends and one day
  {
    key: 'itad.trend', label: 'ITAD analytics', area: 'Sales calling', app: '/app/itad/analytics',
    about: 'For ITAD team leads: this month against last month and the month before (dials, connect rate, interested, closed), the headline rates of the period, and the call funnel from dialed to closed.',
    says: ['compared to last month', 'compare with last month', 'itad analytics', 'calling trend', 'better or worse than last month', 'are we improving', 'month over month', 'last 3 months', 'call funnel', 'pichle mahine se'],
    who: leadOf('ITAD'), takes: ['range'],
    blocks: ['itad-analytics'], apis: ['/api/itad/analytics'], models: ['ItadDailyEntry'],
    load: trend('/api/itad/analytics', 'lifecycle'), table: dyn(['period', 'periods']),
  },
  {
    key: 'leadgen.trend', label: 'Lead Gen analytics', area: 'Lead Generation', app: '/app/leadgen/analytics',
    about: 'For Lead Gen team leads: this month against last month and the month before (leads, qualified, MQL to SQL, contacts), the headline rates of the period, and the funnel from researched to handed to sales.',
    says: ['lead gen analytics', 'lead gen trend', 'leads compared to last month', 'lead gen funnel', 'lead to qualified', 'are leads improving', 'month over month'],
    who: leadOf('LEAD_GEN'), takes: ['range'],
    blocks: ['leadgen-analytics'], apis: ['/api/leadgen/analytics'], models: ['LeadGenDailyEntry'],
    load: trend('/api/leadgen/analytics', 'funnel'), table: dyn(['period', 'periods']),
  },
  {
    key: 'itad.my_day', label: 'My ITAD daily log', area: 'Sales calling', app: '/app/itad/log',
    about: "The asker's own ITAD daily log for ONE day (today unless a date is given): what they entered (dials, connected, voicemails, emails, interested, working on, closed, RFQs) and their notes; with their daily dial target and their averages.",
    says: ['my daily log', 'my log today', 'what did i enter', 'did i submit my log', 'my notes today', 'todays log', 'my log for', 'aaj ka log', 'what did i log', 'did i log', 'log today', 'my log'],
    who: has('ITAD'), takes: ['date'],
    blocks: ['itad-log'], apis: ['/api/itad/entries'], models: ['ItadDailyEntry'],
    load: myDay('/api/itad/entries', 'ITAD daily log'), table: dyn(['field', 'fields']),
    tip: 'One day only. A week or a month of days is what="reports.mine".',
  },
  {
    key: 'leadgen.my_day', label: 'My Lead Gen daily log', area: 'Lead Generation', app: '/app/leadgen/log',
    about: "The asker's own Lead Gen daily log for ONE day (today unless a date is given): leads by industry and lead type, accounts, contacts, MQL and SQL, and their notes; with their weekly target and their averages.",
    says: ['my daily log', 'my leads today', 'what did i enter', 'did i submit my log', 'leads by industry today', 'todays log', 'my log for', 'what did i log', 'did i log', 'log today', 'my log'],
    who: has('LEAD_GEN'), takes: ['date'],
    blocks: ['leadgen-log'], apis: ['/api/leadgen/entries'], models: ['LeadGenDailyEntry', 'LeadGenVerticalCount'],
    load: myDay('/api/leadgen/entries', 'Lead Gen daily log'), table: dyn(['field', 'fields']),
    tip: 'One day only. A week or a month of days is what="reports.mine".',
  },

  // ------------------------------------------------------------------ Lead Dialer: imports and history
  {
    key: 'dialer.imports', label: 'Lead Dialer imports', area: 'Sales calling', app: '/app/itad/dialer',
    about: 'Each time a lead list was brought into the Lead Dialer: when, by whom, the file, how many rows it had and what became of them; and for managers the companies that two people hold at once (duplicates).',
    says: ['imports', 'last import', 'when was the list imported', 'imported leads', 'duplicate leads', 'duplicates', 'crm import', 'import history', 'who imported', 'imported', 'last imported', 'import'],
    who: dialer,
    blocks: ['itad-dialer'], apis: ['/api/dialer/imports', '/api/dialer/duplicates'], models: ['DialerImport', 'DialerLead'],
    async load(ctx) {
      type I = { createdAt: string; fileName: string; rowCount: number; summary?: unknown; user?: unknown }
      type D = { company: string; holders: { ownerName: string; status: string; first: boolean }[] }
      const [imp, dup] = await Promise.all([dialerGet<{ imports?: I[] }>(ctx, '/api/dialer/imports'), get<{ duplicates?: D[] }>(ctx, '/api/dialer/duplicates')])
      if (imp.error !== undefined) return { error: imp.error }
      const flat = (v: unknown) => Object.fromEntries(Object.entries((v && typeof v === 'object' ? v : {}) as Record<string, unknown>).filter(([, x]) => typeof x === 'number'))
      const dups = dup.body?.duplicates
      return {
        ...loose((imp.body.imports ?? []).map((i) => ({ when: i.createdAt, file: i.fileName, by: nameOf(i.user), rows: i.rowCount, ...flat(i.summary) })), ['import', 'imports'], { people: ['by'], date: 'when', sums: ['rows'] }),
        head: dups ? [dups.length ? `Companies held by more than one person (${dups.length}): ${dups.slice(0, 25).map((d) => `${d.company} (${d.holders.map((h) => `${h.ownerName}${h.first ? ', first' : ''}`).join(' and ')})`).join('; ')}${dups.length > 25 ? '; and more' : ''}.` : 'No company is held by two people at once.'] : [],
      }
    },
    table: dyn(['import', 'imports']),
  },
  {
    key: 'dialer.history', label: 'Lead Dialer history', area: 'Sales calling', app: '/app/itad/dialer',
    about: 'The follow-ups of the Lead Dialer that were finished or closed in a period (the last 30 days unless dates are given): which company, what was due, when it was done and whether on time. With item "notes": the notes written on leads, newest first, with the company and who wrote them. With item "claude" (or "earth zone"): what Claude or the Earth Zone sync wrote on the leads.',
    says: ['follow up history', 'completed follow ups', 'finished follow ups', 'task history', 'what did i finish', 'follow ups done', 'on time follow ups', 'recent notes', 'notes i wrote', 'latest notes', 'notes history', 'notes this week', 'claude log', 'what did claude change', 'what did claude write', 'earth zone notes'],
    who: dialer, takes: ['item', 'from_to'],
    blocks: ['itad-dialer'], apis: ['/api/dialer/tasks/history', '/api/dialer/notes', '/api/dialer/claude-log'], models: ['DialerNote', 'DialerAction', 'DialerTouch', 'DialerContact'],
    async load(ctx, a) {
      const mode = `${a.only ?? ''} ${a.item ?? ''}`
      const notes = /note/i.test(mode)
      const q: Record<string, string> = { ...(ymd(a.from) || ymd(a.date) ? { from: ymd(a.from) || ymd(a.date) } : {}), ...(ymd(a.to) || ymd(a.date) ? { to: ymd(a.to) || ymd(a.date) } : {}) }
      // What Claude (or the Earth Zone sync) wrote on leads: its notes, and the contact details it filled in.
      if (/claude|earth ?zone/i.test(mode)) {
        const source = /earth/i.test(mode) ? 'EARTHZONE' : 'CLAUDE'
        const c = await dialerGet<{ items?: { company: string; contactName?: string | null; label: string; text: string; at: string; author?: unknown }[] }>(ctx, '/api/dialer/claude-log', { ...q, source })
        if (c.error !== undefined) return { error: c.error }
        return { ...loose((c.body.items ?? []).map((x) => ({ when: x.at, company: x.company, contact: x.contactName ?? '', what: x.label, text: x.text, by: nameOf(x.author) })), ['entry', 'entries'], { people: ['by'], date: 'when', groups: ['what'] }), dated: true, head: [`What ${source === 'CLAUDE' ? 'Claude' : 'the Earth Zone sync'} wrote on the leads, newest first.`] }
      }
      type H = { tasks?: unknown[]; summary?: { completedThisWeek?: number; onTimePct?: number | null; avgDaysLate?: number | null }; range?: { from: string; to: string } }
      const [hist, n] = await Promise.all([dialerGet<H>(ctx, '/api/dialer/tasks/history', q), dialerGet<{ notes?: unknown[] }>(ctx, '/api/dialer/notes', q)])
      if (notes) {
        if (n.error !== undefined) return { error: n.error }
        return { ...loose(n.body.notes ?? [], ['note', 'notes'], { people: ['rep', 'author', 'by'], date: 'createdAt', drop: /^(phone|crmId|mentions)$/ }), dated: true, head: [`Finished follow-ups are also here: ${(hist.body?.tasks ?? []).length} (ask without "notes").`] }
      }
      if (hist.error !== undefined) return { error: hist.error }
      const s = hist.body.summary
      return {
        ...loose(hist.body.tasks ?? [], ['follow-up', 'follow-ups'], { people: ['owner'], status: 'status', date: 'doneAt' }), dated: true,
        head: [hist.body.range ? `From ${hist.body.range.from.slice(0, 10)} to ${hist.body.range.to.slice(0, 10)}.` : '', s ? `Finished this week: ${s.completedThisWeek ?? 0}.${s.onTimePct != null ? ` On time: ${Math.round(s.onTimePct)}%.` : ''}${s.avgDaysLate != null ? ` Late ones were ${Math.round(s.avgDaysLate * 10) / 10} days late on average.` : ''}` : '', `Notes written on leads in the same days: ${(n.body?.notes ?? []).length} (pass item "notes" to read them).`].filter(Boolean),
      }
    },
    table: dyn(['follow-up', 'follow-ups']),
    tip: 'The leads themselves and what is due now are read with dialer_leads and dialer_summary.',
  },

  // ------------------------------------------------------------------ QA
  {
    key: 'qa.people', label: 'QA Team', area: 'Quality', app: '/app/qa/evaluators',
    about: 'The people who evaluate calls: each evaluator, how many evaluations they completed, the average score they gave and when they last evaluated; and the agents who can be evaluated.',
    says: ['qa team', 'evaluators', 'who evaluates', 'how many evaluations did', 'which agents are evaluated', 'average score given'],
    who: qaLead,
    blocks: [], apis: ['/api/qa/evaluators', '/api/qa/agents'], models: ['QaEvaluation'],
    async load(ctx) {
      const [ev, ...ag] = await Promise.all([get<unknown>(ctx, '/api/qa/evaluators'), ...['ITAD', 'CSR'].map((department) => get<unknown>(ctx, '/api/qa/agents', { department }))])
      if (ev.error !== undefined) return { error: ev.error }
      const d = auto(ev.body, ['evaluator', 'evaluators'], { people: ['name'], drop: /^email$/ })
      const agents = [...new Set(ag.flatMap((x) => (x.body ? auto(x.body, ['agent', 'agents']).rows.map((r) => String(r.name ?? '').trim()) : [])).filter(Boolean))]
      return { ...d, head: [...(d.head ?? []), agents.length ? `Agents who can be evaluated (${agents.length}): ${agents.slice(0, 80).join(', ')}${agents.length > 80 ? ', and more' : ''}.` : ''].filter(Boolean) }
    },
    table: dyn(['evaluator', 'evaluators']),
  },
  {
    key: 'qa.evaluation', label: 'One QA evaluation in full', area: 'Quality', app: '/app/qa/evaluations',
    about: "ONE call-quality evaluation in full: the score, the band and the pass mark, each category's score, each question and how it was marked, the evaluator's comments and the agent's reply. For an agent, their own newest one; for QA and team leads, the newest of the agent named in item.",
    says: ['why did i lose points', 'where did i lose marks', 'evaluation details', 'what did qa say', 'qa comments', 'qa comment', 'did qa leave a comment', 'evaluator comment', 'comment on my evaluation','qa feedback on my call', 'breakdown of my score', 'category scores', 'which questions did i fail', 'my last evaluation', 'latest evaluation of'],
    who: everyone, takes: ['item'],
    blocks: ['my-qa'], apis: ['/api/qa/my-evaluations', '/api/qa/evaluations', '/api/qa/evaluations/:id'], models: ['QaEvaluation', 'QaEvaluationCategory', 'QaAnswer', 'QaCategory', 'QaQuestion'],
    async load(ctx, a) {
      type E = { id: string; agentName?: string }
      const want = (typeof a.item === 'string' ? a.item : typeof a.person === 'string' ? a.person : '').trim()
      const mine = !want || /^(me|my|mine|mera|meri|main)$/i.test(want) || sameName(want, ctx.me.name)
      const list = await get<{ evaluations?: E[] }>(ctx, mine ? '/api/qa/my-evaluations' : '/api/qa/evaluations')
      if (list.error !== undefined) return { error: list.error }
      const all = list.body.evaluations ?? []
      const pool = mine ? all : all.filter((e) => sameName(want, e.agentName ?? ''))
      if (!pool.length) return { error: mine ? `Nothing here: ${ctx.me.name} has no QA evaluations.` : `Nothing here: no evaluation of "${want}" among the newest ones ${ctx.me.name} can see. Agents there: ${[...new Set(all.map((e) => e.agentName ?? ''))].filter(Boolean).slice(0, 40).join(', ') || 'none'}.` }
      type V = { scorecardName?: string; bands?: { passThreshold?: number; bandGood?: number; bandExcellent?: number }; evaluator?: unknown; agent?: unknown; callReference?: string | null; callDate?: string | null; totalScore?: number; band?: string; passed?: boolean; criticalFailTriggered?: boolean; coachingNeeded?: boolean; overallComments?: string | null; agentAcknowledgedAt?: string | null; agentRebuttal?: string | null; createdAt?: string; categories?: Record<string, unknown>[]; answers?: Record<string, unknown>[] }
      const r = await get<{ evaluation?: V }>(ctx, `/api/qa/evaluations/${encodeURIComponent(pool[0].id)}`)
      if (r.error !== undefined) return { error: r.error }
      const v = r.body.evaluation ?? {}
      const cats = loose(v.categories ?? [], ['category', 'categories']).rows
      const line = (row: Record<string, unknown>) => Object.entries(row).filter(([, x]) => x != null && x !== '').map(([k, x]) => `${words(k)} ${typeof x === 'boolean' ? (x ? 'yes' : 'no') : String(x)}`).join(', ')
      return {
        ...loose(v.answers ?? [], ['question', 'questions'], { drop: /^(evaluation|category)$/ }),
        head: [
          `The newest evaluation of ${nameOf(v.agent) || pool[0].agentName || ctx.me.name}: ${v.totalScore ?? '?'} out of 100, ${v.band ?? ''}${v.passed === false ? ', not passed' : v.passed ? ', passed' : ''}. Scorecard "${v.scorecardName ?? ''}". Evaluated by ${nameOf(v.evaluator) || 'QA'} on ${(v.createdAt ?? '').slice(0, 10)}.${pool.length > 1 ? ` ${pool.length - 1} older ones are not shown here.` : ''}`,
          v.bands ? `Pass mark ${v.bands.passThreshold ?? '?'}; "Good" from ${v.bands.bandGood ?? '?'}; "Excellent" from ${v.bands.bandExcellent ?? '?'}.` : '',
          `Critical fail: ${v.criticalFailTriggered ? 'yes' : 'no'}. Coaching needed: ${v.coachingNeeded ? 'yes' : 'no'}.${v.callReference ? ` Call: ${v.callReference}.` : ''}${v.callDate ? ` Call date: ${String(v.callDate).slice(0, 10)}.` : ''}`,
          v.overallComments ? `The evaluator's comments: ${v.overallComments}` : 'The evaluator wrote no overall comment.',
          v.agentRebuttal ? `The agent's reply: ${v.agentRebuttal}` : v.agentAcknowledgedAt ? 'The agent has acknowledged it.' : 'The agent has not acknowledged it yet.',
          cats.length ? `Categories: ${cats.map(line).join(' | ')}.` : 'This evaluation has no category scores saved.',
        ].filter(Boolean),
      }
    },
    table: dyn(['question', 'questions']),
  },

  {
    key: 'qa.scorecard', label: 'One QA scorecard in full', area: 'Quality', app: '/app/qa/scorecards',
    about: 'ONE scorecard in full (item = its name): its pass mark and bands, and every question of every category with the most points it can give and whether failing it fails the whole call.',
    says: ['questions on the scorecard', 'what is on the scorecard', 'scorecard questions', 'scorecard categories', 'critical fail questions', 'how many points', 'what does qa check', 'what are calls scored on', 'questions are on', 'questions on', 'questions in the scorecard'],
    who: (a) => sa(a) || a.role === 'QA' || a.role === 'QA_LEAD', takes: ['item'],
    blocks: [], apis: ['/api/qa/scorecards', '/api/qa/scorecards/:id'], models: ['QaScorecard', 'QaCategory', 'QaQuestion'],
    async load(ctx, a) {
      const list = await get<{ scorecards?: { id: string; name: string; departmentType?: string | null }[] }>(ctx, '/api/qa/scorecards')
      if (list.error !== undefined) return { error: list.error }
      // Scorecards may share a name: each is told apart by its team, and then by a number.
      const seen = new Map<string, number>()
      const cards = (list.body.scorecards ?? []).map((x) => { const base = `${x.name}${x.departmentType ? ` (${x.departmentType})` : ''}`; const n = (seen.get(base) ?? 0) + 1; seen.set(base, n); return { ...x, name: n > 1 ? `${base} no. ${n}` : base } })
      const c = one(cards, (x) => x.name, a.item, 'scorecard')
      if ('error' in c) return { error: c.error }
      type Q = { text: string; type?: string; maxScore?: number; criticalFail?: boolean; allowNA?: boolean }
      const r = await get<{ scorecard?: { name: string; description?: string | null; departmentType?: string | null; passThreshold?: number; bandGood?: number; bandExcellent?: number; categories?: { name: string; questions: Q[] }[] } }>(ctx, `/api/qa/scorecards/${encodeURIComponent(c.hit.id)}`)
      if (r.error !== undefined) return { error: r.error }
      const s = r.body.scorecard
      const cats = s?.categories ?? []
      return {
        ...loose(cats.flatMap((cat) => cat.questions.map((q) => ({ category: cat.name, question: q.text, kind: (q.type ?? '').replace(/_/g, ' ').toLowerCase(), points: q.maxScore ?? null, criticalFail: q.criticalFail ? 'yes' : 'no', canBeSkipped: q.allowNA ? 'yes' : 'no' }))), ['question', 'questions'], { groups: ['category', 'criticalFail'], sums: ['points'] }),
        head: [`Scorecard "${s?.name ?? c.hit.name}"${s?.departmentType ? ` for ${s.departmentType}` : ''}: pass mark ${s?.passThreshold ?? '?'}, "Good" from ${s?.bandGood ?? '?'}, "Excellent" from ${s?.bandExcellent ?? '?'}. ${cats.length} categories.`, s?.description ? `What it is for: ${s.description}` : ''].filter(Boolean),
      }
    },
    table: dyn(['question', 'questions']),
  },

  // ------------------------------------------------------------------ Marketing: one item, the daily logs, social comparisons
  {
    key: 'marketing.task', label: 'One marketing item and its comments', area: 'Marketing', app: '/app/marketing/content',
    about: 'ONE marketing item (a social post, content piece or SEO item) in full: its description, who has it, its dates, its attached files by name, and every comment on it. Pass item with its title.',
    says: ['comments on the post', 'what did they say on', 'details of the post', 'details of the content', 'updates on the post', 'feedback on the post', 'attachments on', 'description of the post', 'comments on', 'the comments', 'what was said on'],
    who: has('MARKETING'), takes: ['item'],
    blocks: ['mkt-content', 'mkt-seo', 'mkt-planner'], apis: ['/api/marketing/board', '/api/marketing/tasks/:id'], models: ['MarketingTask', 'MarketingTaskComment'],
    async load(ctx, a) {
      const board = await get<{ columns?: { tasks: { id: string; title: string }[] }[] }>(ctx, '/api/marketing/board')
      if (board.error !== undefined) return { error: board.error }
      const t = one((board.body.columns ?? []).flatMap((c) => c.tasks), (x) => x.title, a.item, 'marketing item')
      if ('error' in t) return { error: t.error }
      const r = await get<{ task?: Record<string, unknown>; comments?: Record<string, unknown>[]; attachments?: Record<string, unknown>[] }>(ctx, `/api/marketing/tasks/${encodeURIComponent(t.hit.id)}`)
      if (r.error !== undefined) return { error: r.error }
      const k = r.body.task ?? {}
      const names = (r.body.attachments ?? []).map((f) => String(f.name ?? f.fileName ?? f.filename ?? '')).filter(Boolean)
      const d = dayLog('', '', k, /^(title|description|position|attachments|comments|commentCount|attachmentCount)$/)
      return {
        ...loose((r.body.comments ?? []).map((c) => ({ when: (c.createdAt as string) ?? null, by: nameOf(c.author) || nameOf(c.user) || String(c.authorName ?? ''), comment: String(c.body ?? c.text ?? '') })), ['comment', 'comments'], { people: ['by'], date: 'when' }),
        head: [`Item: ${String(k.title ?? t.hit.title)}.`, d.rows.length ? `${d.rows.map((x) => `${String(x.field)}: ${String(x.value)}`).join('; ')}.` : '', k.description ? `Description: ${String(k.description)}` : 'It has no description.', names.length ? `Files attached (${names.length}): ${names.join(', ')}.` : 'No files are attached.'].filter(Boolean),
      }
    },
    table: dyn(['comment', 'comments']),
  },
  {
    key: 'marketing.my_day', label: 'My marketing daily log', area: 'Marketing', app: '/app/marketing/seo',
    about: "The asker's own SEO and content daily logs for ONE day (today unless a date is given): what they entered and their notes.",
    says: ['my seo log', 'my content log', 'my daily log', 'what did i log', 'seo work today', 'content written today', 'did i submit my log', 'my log for', 'did i log', 'log today', 'my log'],
    who: has('MARKETING'), takes: ['date'],
    blocks: ['mkt-seo', 'mkt-content-log'], apis: ['/api/marketing/seo/entries', '/api/marketing/content/entries'], models: ['SeoDailyEntry', 'ContentDailyEntry'],
    async load(ctx, a) {
      const date = ymd(a.date) || ymd(a.from) || ctx.today
      const [seo, content] = await Promise.all([get<{ entry?: unknown }>(ctx, '/api/marketing/seo/entries', { date }), get<{ entry?: unknown }>(ctx, '/api/marketing/content/entries', { date })])
      if (seo.error !== undefined && content.error !== undefined) return { error: seo.error }
      const s = dayLog('SEO daily log', date, seo.body?.entry), c = dayLog('Content daily log', date, content.body?.entry)
      return { rows: [...s.rows.map((r) => ({ log: 'SEO', ...r })), ...c.rows.map((r) => ({ log: 'Content', ...r }))], table: { unit: ['field', 'fields'], columns: [{ key: 'log', label: 'log' }, { key: 'field', label: 'field' }, { key: 'value', label: 'value' }], groups: ['log'] }, dated: true, head: [...(seo.body ? s.head ?? [] : []), ...(content.body ? c.head ?? [] : [])] }
    },
    table: dyn(['field', 'fields']),
  },
  {
    key: 'marketing.social_compare', label: 'Social numbers compared', area: 'Marketing', app: '/app/marketing/social/analytics',
    about: 'Social media numbers compared. With item = a brand: that brand this month against last month (followers, impressions, engagement, new followers, visitors, clicks, reactions), platform by platform, and its last six months. Without item: every brand side by side by followers for a month.',
    says: ['social analytics', 'compare brands', 'which brand has the most followers', 'followers growth', 'social month by month', 'social trend', 'followers over time', 'across brands', 'social this month vs last month', 'compare our brands', 'brands by followers', 'most followers', 'compare brands by'],
    who: leadOf('MARKETING'), takes: ['item', 'date'],
    blocks: ['mkt-social-analytics'], apis: ['/api/marketing/brands', '/api/marketing/social/monthly/cross', '/api/marketing/social/monthly/compare'], models: ['BrandSocialMonthly'],
    async load(ctx, a) {
      const month = (ymd(a.date) || ymd(a.from) || '').slice(0, 7)
      const want = (typeof a.item === 'string' ? a.item : '').trim()
      if (want) {
        const brands = await get<{ brands?: { id: string; name: string }[] }>(ctx, '/api/marketing/brands')
        if (brands.error !== undefined) return { error: brands.error }
        const b = one(brands.body.brands ?? [], (x) => x.name, want, 'brand')
        if ('error' in b) return { error: b.error }
        type C = { month: string; prevMonth: string; platforms?: unknown[]; totals?: Record<string, unknown>; trends?: Record<string, { label: string; value: number }[]> }
        const r = await get<C>(ctx, '/api/marketing/social/monthly/compare', { brandId: b.hit.id, ...(month ? { month } : {}) })
        if (r.error !== undefined) return { error: r.error }
        const tot = Object.entries(r.body.totals ?? {}).filter(([k, v]) => typeof v === 'number' && !/Delta$|Pp$/.test(k)).map(([k, v]) => { const dl = r.body.totals![`${k}Delta`]; return `${words(k)} ${v as number}${typeof dl === 'number' && r.body.totals!.hadPrev ? ` (${dl >= 0 ? '+' : ''}${dl} against ${r.body.prevMonth})` : ''}` })
        return {
          ...loose(r.body.platforms ?? [], ['platform', 'platforms']), dated: true,
          head: [`${b.hit.name}, ${r.body.month}${r.body.totals?.hadPrev ? ` against ${r.body.prevMonth}` : ` (nothing was entered for ${r.body.prevMonth} to compare with)`}.`, tot.length ? `All platforms together: ${tot.join('; ')}.` : '', ...Object.entries(r.body.trends ?? {}).map(([k, pts]) => `${words(k).replace(/^./, (c) => c.toUpperCase())} by month: ${pts.map((p) => `${p.label} ${p.value}`).join(', ')}.`)].filter(Boolean),
        }
      }
      const r = await get<{ month?: string; metric?: string; brands?: unknown[] }>(ctx, '/api/marketing/social/monthly/cross', month ? { month } : {})
      if (r.error !== undefined) return { error: r.error }
      return { ...loose(r.body.brands ?? [], ['brand', 'brands'], { sums: ['value'] }), dated: true, head: [`Every brand side by side for ${r.body.month ?? 'this month'}: "value" is ${r.body.metric ?? 'followers'}, "delta" its change against the month before.`] }
    },
    table: dyn(['brand', 'brands']),
  },

  // ------------------------------------------------------------------ Daily Report (the forms a company builds)
  {
    key: 'daily_report.entries', label: 'Daily Report', area: 'Daily Report', app: '/app/daily-report',
    about: "The Daily Report forms the company built (item = the form's name when there is more than one). For a person who fills one in: what they sent on a day and the days they sent lately. For a team lead: what each person of the team sent on a day (sent, not sent, on leave) with the team's totals against target; with range \"month\": each person's month (reports sent out of those due, and each number's total and daily average).",
    says: ['daily report', 'my daily report', 'team reports', 'what did i report', 'did i send my report', 'who has not sent the report', 'daily report totals', 'monthly totals of the report', 'report this month', 'aaj ki report'],
    who: (a) => a.sources.has('REPORT_ENTRY'), takes: ['item', 'date', 'range'],
    blocks: ['daily-report', 'daily-report-team'], apis: ['/api/daily-report/forms', '/api/daily-report/forms/:id/entry', '/api/daily-report/forms/:id/team', '/api/daily-report/forms/:id/monthly', '/api/daily-report/forms/:id/trend'], models: ['ReportForm', 'ReportField', 'ReportEntry'],
    async load(ctx, a) {
      type F = { id: string; name: string; department?: string | null; active?: boolean; canSeeTeam?: boolean; fills?: boolean; fields?: { id: string; label: string; unit?: string | null; target?: number | null }[] }
      const forms = await get<{ forms?: F[] }>(ctx, '/api/daily-report/forms')
      if (forms.error !== undefined) return { error: /not switched on/i.test(forms.error) ? 'Nothing here: the Daily Report is not switched on for this company.' : forms.error }
      const list = forms.body.forms ?? []
      if (!list.length) return { error: `Nothing here: there is no Daily Report form for ${ctx.me.name} to fill in or look after.` }
      const f = one(list, (x) => x.name, a.item, 'Daily Report form')
      if ('error' in f) return { error: f.error }
      const form = f.hit
      const date = ymd(a.date) || ymd(a.from) || ctx.today
      const label = new Map((form.fields ?? []).map((x) => [x.id, `${x.label}${x.unit ? ` (${x.unit})` : ''}`]))
      // Answers under the form's own field names, in the form's own order (answers are kept under field ids).
      const named = (v: unknown): Record<string, string | number> => {
        const given = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
        return Object.fromEntries((form.fields ?? []).filter((f) => f.id in given).map((f) => { const x = given[f.id]; return [label.get(f.id)!, Array.isArray(x) ? x.join(', ') : typeof x === 'number' ? x : typeof x === 'boolean' ? (x ? 'yes' : 'no') : String(x ?? '')] }))
      }
      const base = `/api/daily-report/forms/${encodeURIComponent(form.id)}`
      const title = `Form "${form.name}"${form.department ? ` of ${form.department}` : ''}${form.active === false ? ' (switched off)' : ''}`
      if (!form.canSeeTeam) {
        const mine = await get<{ entry?: { values?: unknown } | null; onLeave?: boolean; holiday?: string | null; recent?: { date: string }[] }>(ctx, `${base}/entry`, { date })
        if (mine.error !== undefined) return { error: mine.error }
        const sent = Object.entries(named(mine.body.entry?.values))
        return {
          ...loose(sent.map(([field, value]) => ({ field, value })), ['answer', 'answers']), dated: true,
          head: [`${title}, ${date}.`, mine.body.entry ? `${ctx.me.name} sent the report for that day.` : `${ctx.me.name} sent no report for that day${mine.body.holiday ? ` (a holiday: ${mine.body.holiday})` : mine.body.onLeave ? ' (on leave)' : ''}.`, (mine.body.recent ?? []).length ? `Days ${ctx.me.name} sent a report lately: ${(mine.body.recent ?? []).map((x) => x.date).join(', ')}.` : ''].filter(Boolean),
        }
      }
      type Tm = { counts?: { people: number; sent: number; missing: number; onLeave: number }; holiday?: string | null; totals?: { fieldId: string; total: number; average: number; answers: number; target: number | null }[]; rows?: { name: string; status: string; values: unknown }[] }
      type Mo = { month: string; workDays: number; rows?: { name: string; sent: number; due: number; onLeave: number; fields: Record<string, { total: number; average: number }> }[] }
      type Tr = { from: string; to: string; days?: { sent: number; totals: Record<string, number> }[] }
      const [team, monthly, trendR, own] = await Promise.all([get<Tm>(ctx, `${base}/team`, { date }), get<Mo>(ctx, `${base}/monthly`, { month: date.slice(0, 7) }), get<Tr>(ctx, `${base}/trend`), form.fills ? get<{ entry?: unknown }>(ctx, `${base}/entry`, { date }) : Promise.resolve(null)])
      if (team.error !== undefined) return { error: team.error }
      const state: Record<string, string> = { SENT: 'Sent', MISSING: 'Not sent', ON_LEAVE: 'On leave', HOLIDAY: 'Holiday' }
      const c = team.body.counts
      const last = trendR.body ? `From ${trendR.body.from} to ${trendR.body.to}: ${(trendR.body.days ?? []).reduce((n, d) => n + d.sent, 0)} reports sent${[...label].map(([id, l]) => { const t = (trendR.body!.days ?? []).reduce((n, d) => n + (d.totals[id] ?? 0), 0); return (trendR.body!.days ?? []).some((d) => id in d.totals) ? `; ${l} ${Math.round(t * 100) / 100}` : '' }).join('')}.` : ''
      if (/month/i.test(`${a.range ?? ''} ${a.only ?? ''}`) && monthly.body) {
        const m = monthly.body
        return {
          ...loose((m.rows ?? []).map((r) => ({ person: r.name, sent: r.sent, due: r.due, onLeave: r.onLeave, ...Object.fromEntries(Object.entries(r.fields).flatMap(([id, v]) => (label.has(id) ? [[`${label.get(id)} total`, v.total], [`${label.get(id)} daily average`, Math.round(v.average * 100) / 100]] : []))) })), ['person', 'people'], { people: ['person'], sums: ['sent', 'due', 'onLeave', ...[...label.values()].map((l) => `${l} total`)] }),
          dated: true, head: [`${title}, the month ${m.month} (${m.workDays} working days).`, last].filter(Boolean),
        }
      }
      return {
        ...loose((team.body.rows ?? []).map((r) => ({ person: r.name, report: state[r.status] ?? r.status, ...named(r.values) })), ['person', 'people'], { people: ['person'], status: 'report' }),
        dated: true,
        head: [
          `${title}, ${date}${team.body.holiday ? ` (a holiday: ${team.body.holiday})` : ''}.`,
          c ? `${c.people} people fill it in: ${c.sent} sent, ${c.missing} not sent, ${c.onLeave} on leave.` : '',
          (team.body.totals ?? []).length ? `Team totals for the day: ${(team.body.totals ?? []).map((t) => `${label.get(t.fieldId) ?? 'a field'} ${t.total} (average ${Math.round(t.average * 100) / 100} over ${t.answers} answers${t.target != null ? `, team target ${t.target}` : ''})`).join('; ')}.` : '',
          own?.body ? ((own.body as { entry?: unknown }).entry ? `${ctx.me.name}'s own report for the day is in.` : `${ctx.me.name}'s own report for the day is not in.`) : '',
          last, `For each person's month, ask again with range "month".`,
        ].filter(Boolean),
      }
    },
    table: dyn(['person', 'people']),
  },

  // ------------------------------------------------------------------ Histories
  {
    key: 'notifications.history', label: 'Notification history', area: 'Notifications', app: '/app/notifications',
    about: 'The notifications this person received before, newest first (the last 50, read and unread): what each said, who caused it, when, and whether it was read.',
    says: ['notification history', 'old notifications', 'earlier notifications', 'past notifications', 'notifications last week', 'who mentioned me', 'did i get a notification', 'read notifications'],
    who: everyone,
    blocks: [], apis: ['/api/notifications/history'], models: [],
    async load(ctx) {
      type N = { title: string; body?: string | null; actorName?: string | null; readAt?: string | null; createdAt: string; category?: string | null }
      const r = await get<{ notifications?: N[]; nextCursor?: string | null }>(ctx, '/api/notifications/history')
      if (r.error !== undefined) return { error: r.error }
      return {
        ...loose((r.body.notifications ?? []).map((n) => ({ notification: n.title, says: n.body ?? '', from: n.actorName ?? '', when: n.createdAt, read: n.readAt ? 'Read' : 'Unread', about: n.category ?? '' })), ['notification', 'notifications'], { people: ['from'], status: 'read', date: 'when', groups: ['about'] }),
        notes: r.body.nextCursor ? ['Only the newest 50 are here; older ones are on the Notifications screen.'] : [],
      }
    },
    table: dyn(['notification', 'notifications']),
  },
  {
    key: 'projects.ticket_history', label: 'History of one ticket', area: 'Projects', app: '/app/projects',
    about: 'What happened to ONE project ticket, step by step (item = its code, like WEB-12): who created it, moved it, changed its dates or its people, and when.',
    says: ['history of the ticket', 'ticket history', 'who moved', 'who changed the ticket', 'when was it moved', 'activity on the ticket', 'who closed the ticket', 'who reassigned', 'what happened to the ticket'],
    who: everyone, takes: ['item'],
    blocks: ['projects'], apis: ['/api/projects/tasks/:code/activity'], models: ['PmActivity'],
    async load(ctx, a) {
      const code = (typeof a.item === 'string' ? a.item : '').trim().toUpperCase().match(/[A-Z][A-Z0-9]*-\d+/)?.[0]
      if (!code) return { error: 'Say which ticket (pass item with its code, like WEB-12). The codes are in list_my_tickets and list_project_tickets.' }
      const r = await get<{ activity?: { action: string; meta?: unknown; user?: unknown; createdAt: string }[] }>(ctx, `/api/projects/tasks/${encodeURIComponent(code)}/activity`)
      if (r.error !== undefined) return { error: /not found/i.test(r.error) ? `Nothing here: there is no ticket ${code} that ${ctx.me.name} can open.` : r.error }
      const said = (m: unknown) => Object.entries((m && typeof m === 'object' ? m : {}) as Record<string, unknown>).filter(([k, v]) => !/Id$|^id$/.test(k) && v != null && v !== '' && typeof v !== 'object').map(([k, v]) => `${words(k)} ${String(v)}`).join(', ')
      return { ...loose((r.body.activity ?? []).map((x) => ({ when: x.createdAt, who: nameOf(x.user).trim(), did: x.action.replace(/[._]/g, ' ').toLowerCase(), details: said(x.meta) })), ['step', 'steps'], { people: ['who'], date: 'when', groups: ['did'] }), head: [`History of ticket ${code}, newest step first.`] }
    },
    table: dyn(['step', 'steps']),
  },

  // ------------------------------------------------------------------ Settings people ask about
  {
    key: 'admin.tags', label: 'Tags', area: 'Settings', app: '/app/admin/tags',
    about: 'For team leads: the lists the team picks from when logging work (marketplaces, platforms, kinds of work, lead types, industries), each with its team and whether it is active.',
    says: ['tags', 'marketplaces list', 'which marketplaces', 'lead types', 'industries list', 'verticals list', 'options in the form', 'task types'],
    who: lead,
    blocks: [], apis: ['/api/admin/tags'], models: ['Tag'],
    load: via('/api/admin/tags', ['tag', 'tags'], { groups: ['type', 'department'] }), table: dyn(['tag', 'tags']),
  },
]
