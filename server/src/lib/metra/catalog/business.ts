import type { Asker } from '../access'
import type { Entry, Row, Table } from './types'
import { get, hours, loose } from './load'

/**
 * The business modules of plan 2026-11, stage 2: requests and approvals, leave balances, people records, quotes and
 * invoices, time spent on tasks, and saved reports. Shapes are those of controllers/approvalsController.ts,
 * peopleController.ts, salesDocsController.ts, pmExtrasController.ts and routes/business.ts.
 */

const sa = (a: Asker) => a.role === 'SUPER_ADMIN'
const lead = (a: Asker) => sa(a) || a.role === 'TEAM_LEAD'
const on = (flag: string) => (a: Asker) => a.principals.has(`on:${flag}`)
const dyn = (unit: [string, string]): Table => ({ unit, columns: [{ key: 'value', label: unit[0] }] })

interface Req { number: number; line: string; kind: string; status: string; requester: { name: string }; waitingOn: string[]; createdAt: string; amount: number | null; currency: string; details: string }
const reqRow = (r: Req): Row => ({ number: r.number, what: r.line, kind: r.kind.toLowerCase(), status: r.status === 'PENDING' ? 'waiting' : r.status === 'REJECTED' ? 'not approved' : r.status === 'CANCELLED' ? 'taken back' : 'approved', askedBy: r.requester.name, waitingOn: r.waitingOn.join(', '), amount: r.amount, currency: r.amount === null ? '' : r.currency, details: r.details, asked: r.createdAt })

export const BUSINESS: Entry[] = [
  {
    key: 'requests.list', label: 'Requests', area: 'Requests', app: '/app/requests',
    about: "Requests for an expense, a purchase, leave or anything else: the asker's own, and for a team lead their team's (an admin: everyone's). Each with what was asked, the amount, who asked, whether it was approved and who it is waiting on.",
    says: ['my requests', 'requests', 'request', 'my request', 'was my request approved', 'request approved', 'expense request', 'expense', 'expenses', 'purchase request', 'purchase', 'leave request', 'my leave request', 'did my request get approved', 'approved requests', 'rejected requests', 'kharcha', 'chutti ki request'],
    who: on('requests'),
    blocks: ['requests'], apis: ['/api/approvals'], models: ['ApprovalRequest', 'ApprovalStep'],
    async load(ctx) {
      const team = lead(ctx.asker)
      const r = await get<{ requests: Req[] }>(ctx, '/api/approvals', { box: team ? 'all' : 'mine' })
      if (r.error !== undefined) return { error: r.error }
      return { ...loose(r.body.requests.map(reqRow), ['request', 'requests'], { people: ['askedBy'], status: 'status', date: 'asked', sums: ['amount'], groups: ['kind'] }), head: [team ? (sa(ctx.asker) ? "Everyone's requests." : "The team's requests and the asker's own.") : `${ctx.me.name}'s own requests.`] }
    },
    table: dyn(['request', 'requests']),
    brief: (rows) => { const n = rows.filter((r) => r.status === 'waiting').length; return n ? `${n} request${n === 1 ? '' : 's'} still waiting on a decision.` : null },
  },
  {
    key: 'requests.waiting', label: 'Waiting on me', area: 'Requests', app: '/app/requests',
    about: 'What needs the asker\'s decision: expense, purchase and leave requests waiting on them, and how many work-from-home, forgotten check-in and more-time requests wait on them.',
    says: ['waiting on me', 'what do i need to approve', 'pending approvals', 'approvals', 'approval inbox', 'anything to approve', 'requests to approve', 'mujhe kya approve karna hai'],
    who: on('requests'),
    blocks: ['requests'], apis: ['/api/approvals', '/api/approvals/inbox'], models: [],
    async load(ctx) {
      const [list, inbox] = await Promise.all([get<{ requests: Req[] }>(ctx, '/api/approvals', { box: 'waiting' }), get<{ inbox: { label: string; count: number }[] }>(ctx, '/api/approvals/inbox')])
      if (list.error !== undefined) return { error: list.error }
      const others = inbox.error === undefined ? inbox.body.inbox.filter((i) => i.count > 0).map((i) => `${i.label}: ${i.count}`) : []
      return { ...loose(list.body.requests.map(reqRow), ['request waiting on you', 'requests waiting on you'], { people: ['askedBy'], date: 'asked', sums: ['amount'], groups: ['kind'] }), head: [others.length ? `Waiting on ${ctx.me.name}, by kind: ${others.join('; ')}.` : `Nothing else is waiting on ${ctx.me.name}.`] }
    },
    table: dyn(['request waiting on you', 'requests waiting on you']),
  },
  {
    key: 'requests.rules', label: 'Who approves what', area: 'Requests', app: '/app/requests',
    about: "The company's approval rules: for each kind of request (expense, purchase, leave, other) and from what amount, who must approve it and in what order. With no rule a request goes to the person's team lead.",
    says: ['who approves', 'approval rules', 'who approves expenses', 'who approves leave', 'approval chain', 'approval limit'],
    who: on('requests'),
    blocks: ['requests'], apis: ['/api/approvals/rules'], models: ['ApprovalRule'],
    async load(ctx) {
      const r = await get<{ rules: { kind: string; minAmount: number | null; chain: string[] }[]; people: { id: string; name: string }[] }>(ctx, '/api/approvals/rules')
      if (r.error !== undefined) return { error: r.error }
      const who = (c: string) => (c === 'LEAD' ? "the person's team lead" : c === 'ADMIN' ? 'an admin' : r.body.people.find((p) => p.id === c)?.name ?? 'a named person')
      const rows = r.body.rules.map((x) => ({ kind: x.kind.toLowerCase(), fromAmount: x.minAmount ?? 'any amount', approvedBy: x.chain.map(who).join(', then ') }))
      return { ...loose(rows, ['approval rule', 'approval rules']), head: ["With no rule for a kind of request, it goes to the person's team lead (an admin when there is no lead)."] }
    },
    table: dyn(['approval rule', 'approval rules']),
  },
  {
    key: 'leave.balance', label: 'My leave', area: 'Requests', app: '/app/requests',
    about: "The asker's leave for this year, by kind (annual, sick, casual, unpaid): days allowed, days used, days waiting on a decision and days left. A kind with no yearly number set by the company has no limit.",
    says: ['my leave', 'leave balance', 'leaves left', 'how many leaves do i have', 'annual leave', 'sick leave', 'casual leave', 'days off left', 'meri chuttiyan', 'kitni chutti bachi'],
    who: on('requests'),
    blocks: ['requests'], apis: ['/api/approvals/leave-balance'], models: ['LeaveAllowance'],
    async load(ctx) {
      const r = await get<{ year: number; balance: Record<string, { allowed?: number | null; used: number; waiting: number; left?: number | null }> }>(ctx, '/api/approvals/leave-balance')
      if (r.error !== undefined) return { error: r.error }
      const rows = Object.entries(r.body.balance).map(([kind, b]) => ({ kind: kind.toLowerCase(), allowed: b.allowed ?? 'no limit set', used: b.used, waiting: b.waiting, left: b.left ?? 'no limit set' }))
      return { ...loose(rows, ['kind of leave', 'kinds of leave']), head: [`${ctx.me.name}'s leave in ${r.body.year}, in days.`] }
    },
    table: dyn(['kind of leave', 'kinds of leave']),
  },
  {
    key: 'people.records', label: 'People', area: 'People', app: '/app/people',
    about: "The company directory with each person's job title, team, who they report to and phone. For the asker themself, and for the people a team lead or admin looks after, also when they joined, their employment type and birthday.",
    says: ['people', 'directory', 'job title', 'who reports to', 'reports to', 'report to', 'who does report to', 'manager', 'manager of', 'reporting line', 'who is the manager', 'phone number of', 'when did join', 'joining date', 'employee number', 'birthday', 'org chart'],
    who: on('people-records'),
    blocks: ['people-records'], apis: ['/api/people'], models: ['PersonRecord'],
    async load(ctx) {
      const r = await get<{ people: { name: string; email: string; role: string; department: string | null; jobTitle: string | null; phone: string | null; manager: { name: string } | null; private: { joinedOn: string; employmentType: string | null; birthday: string | null; employeeCode: string | null } | null }[] }>(ctx, '/api/people')
      if (r.error !== undefined) return { error: r.error }
      // Address, emergency contact and HR notes are never given to the model.
      const rows = r.body.people.map((p) => ({ name: p.name, email: p.email, job: p.jobTitle, team: p.department, reportsTo: p.manager?.name ?? null, phone: p.phone, joined: p.private?.joinedOn ?? null, employment: p.private?.employmentType?.toLowerCase().replace('_', ' ') ?? null, birthday: p.private?.birthday ?? null, employeeNumber: p.private?.employeeCode ?? null }))
      return { ...loose(rows, ['person', 'people'], { people: ['name', 'reportsTo'], groups: ['team', 'job'], date: 'joined' }), head: ['Joining date, employment and birthday are only filled for people the asker may see them for.'] }
    },
    table: dyn(['person', 'people']),
  },
  {
    key: 'sales.docs', label: 'Quotes and invoices', area: 'Quotes and invoices', app: '/app/sales',
    about: 'Quotes and invoices: number, customer, date, due date, total, currency and status. An invoice is draft, not paid yet, overdue, paid or void; a quote is draft, sent with no answer yet, accepted or declined. Always name the customer of a document. A member sees the ones they made; team leads and admins see all.',
    says: ['quotes', 'quote', 'quotation', 'invoices', 'invoice', 'unpaid invoices', 'overdue invoices', 'who owes us', 'how much are we owed', 'paid invoices', 'open quotes', 'billed', 'bill'],
    who: on('sales-docs'),
    blocks: ['sales-docs'], apis: ['/api/sales-docs'], models: ['SalesDoc', 'SalesDocLine'],
    async load(ctx) {
      const r = await get<{ docs: { kind: string; number: string; customerName: string; issueDate: string; dueDate: string | null; total: number; currency: string; status: string; overdue: boolean; createdBy: string; lineCount: number }[]; summary: { openQuotes: number; owed: number; overdue: number; paidThisMonth: number } }>(ctx, '/api/sales-docs')
      if (r.error !== undefined) return { error: r.error }
      // Said the way people ask: an invoice that was sent is "not paid yet" (or "overdue"), a quote that was sent has "no answer yet".
      const status = (d: { kind: string; status: string; overdue: boolean }) => (d.kind === 'INVOICE' ? (d.overdue ? 'overdue, not paid' : d.status === 'SENT' ? 'not paid yet' : d.status.toLowerCase()) : d.status === 'SENT' ? 'sent, no answer yet' : d.status.toLowerCase())
      // The customer is named with the number: an answer that lists documents then says whose they are.
      const rows = r.body.docs.map((d) => ({ document: `${d.kind === 'INVOICE' ? 'Invoice' : 'Quote'} ${d.number} for ${d.customerName}`, kind: d.kind.toLowerCase(), customer: d.customerName, date: d.issueDate, due: d.dueDate, total: d.total, currency: d.currency, status: status(d), madeBy: d.createdBy, lines: d.lineCount }))
      const s = r.body.summary
      return { ...loose(rows, ['document', 'documents'], { people: ['madeBy'], status: 'status', date: 'date', sums: ['total'], groups: ['kind', 'customer'] }), head: [`Quotes sent with no answer yet: ${s.openQuotes}. Invoices not paid yet: ${s.owed} (of that overdue: ${s.overdue}). Paid this month: ${s.paidThisMonth}. Sums add the numbers whatever the currency.`] }
    },
    table: dyn(['document', 'documents']),
  },
  {
    key: 'projects.time', label: 'My time on tasks', area: 'Projects', app: '/app/projects',
    about: "The time the asker logged on project tasks in the last 30 days (a timer or minutes typed in): the day, the task, the project, how long, and a note. Says whether a timer is running now.",
    says: ['my time', 'time logged', 'timesheet', 'hours logged', 'how long did i spend', 'time on task', 'time tracking', 'my timer', 'is my timer running', 'kitna time laga'],
    who: on('project-extras'),
    blocks: ['projects'], apis: ['/api/projects/me/time'], models: ['PmTimeEntry'],
    async load(ctx) {
      const r = await get<{ entries: { day: string; code: string; title: string; project: string; minutes: number; running: boolean; note: string }[]; totalMinutes: number }>(ctx, '/api/projects/me/time', { days: '30' })
      if (r.error !== undefined) return { error: r.error }
      const rows = r.body.entries.map((e) => ({ day: e.day, task: `${e.code}: ${e.title}`, project: e.project, minutes: e.minutes, time: hours(e.minutes), note: e.running ? 'timer running now' : e.note }))
      return { ...loose(rows, ['time entry', 'time entries'], { date: 'day', sums: ['minutes'], groups: ['project', 'task'] }), head: [`${ctx.me.name} logged ${hours(r.body.totalMinutes) || '0 min'} in the last 30 days.`] }
    },
    table: dyn(['time entry', 'time entries']),
  },
  {
    key: 'reports.saved', label: 'Saved reports', area: 'Report builder', app: '/app/report-builder',
    about: 'The reports kept in the report builder: the name, who made it, what it counts, how it is split and its dates. The numbers themselves are on the Report builder page.',
    says: ['saved reports', 'report builder', 'my saved reports', 'custom reports'],
    who: (a) => lead(a) && on('report-builder')(a),
    blocks: ['report-builder'], apis: ['/api/report-builder/saved'], models: ['SavedReport'],
    async load(ctx) {
      const r = await get<{ reports: { name: string; owner: string; shared: boolean; spec: { source: string; measure: string; groupBy: string; range: string } }[] }>(ctx, '/api/report-builder/saved')
      if (r.error !== undefined) return { error: r.error }
      const rows = r.body.reports.map((x) => ({ name: x.name, madeBy: x.owner, shared: x.shared ? 'with leads and admins' : 'private', about: x.spec.source, counts: x.spec.measure, splitBy: x.spec.groupBy, dates: x.spec.range }))
      return { ...loose(rows, ['saved report', 'saved reports'], { people: ['madeBy'] }), head: ['Open Report builder to run one.'] }
    },
    table: dyn(['saved report', 'saved reports']),
  },
]
