import type { Asker } from './access'
import { apiAs, apiError } from '../mcp/api'
import type { DeptTool } from '../mcp/departmentTools'

/**
 * Changes Metra may PROPOSE (docs/metra/ROADMAP.md phase 4). None of them runs when the model calls it: the person
 * sees a card and presses Confirm (controllers/metraController.ts, decideAction); only then does `run` happen, as that
 * person, through the same API route the screen's own button uses. So every check of the app is made again, a person
 * can only do here what they can do on the screen, and text inside a note can never make Metra change anything.
 *
 * Each action is one thing a person does by hand on a screen today. Nothing here deletes, pays, or changes settings.
 */

export type ActionTool = DeptTool & { who: (a: Asker) => boolean }

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] })
const fail = (t: string) => ({ content: [{ type: 'text' as const, text: t }], isError: true })
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const ymd = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(str(v)) ? str(v) : '')
const whole = (v: unknown) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0 }
const sa = (a: Asker) => a.role === 'SUPER_ADMIN'
const has = (k: string) => (a: Asker) => sa(a) || a.kinds.includes(k as never)
const leadOf = (k: string) => (a: Asker) => sa(a) || (a.role === 'TEAM_LEAD' && a.kinds.includes(k as never))
/** A part of plan 2026-11 the person's company has switched on (lib/metra/access.ts). */
const on = (flag: string) => (a: Asker) => a.principals.has(`on:${flag}`)
/** Every day from the first to the last (YYYY-MM-DD), at most 60; none when the last is before the first. */
function daysFrom(first: string, last: string): string[] {
  const out: string[] = []
  const end = new Date(`${last}T00:00:00Z`).getTime()
  for (let t = new Date(`${first}T00:00:00Z`).getTime(); t <= end && out.length < 60; t += 86400_000) out.push(new Date(t).toISOString().slice(0, 10))
  return out
}
interface ReqMade { id: string; number: number; line: string; status: string; waitingOn: string[]; requester: { name: string } }
const sentTo = (r: ReqMade) => (r.status === 'APPROVED' ? 'Nobody else had to approve it: it is approved.' : r.waitingOn.length ? `It now waits on ${r.waitingOn.join(', ')}.` : 'It waits for approval.')
const direction = (v: unknown): 'STOCK_IN' | 'STOCK_OUT' | '' => { const s = norm(str(v)); return /\bin\b|stock in|add|receive|restock/.test(s) ? 'STOCK_IN' : /\bout\b|stock out|remove|issue|take|pull/.test(s) ? 'STOCK_OUT' : '' }

/** One thing by its name among a list: exact first, then the only one that contains the words. Never a guess between two. */
function byName<T>(list: T[], nameOf: (x: T) => string, given: string, what: string): { hit?: T; error?: string } {
  const g = norm(given)
  if (!g) return { error: `Say which ${what}.` }
  const exact = list.filter((x) => norm(nameOf(x)) === g)
  const hits = exact.length ? exact : list.filter((x) => norm(nameOf(x)).includes(g) || g.split(' ').every((w) => norm(nameOf(x)).includes(w)))
  if (hits.length === 1) return { hit: hits[0] }
  if (!hits.length) return { error: `No ${what} is called "${given}". There ${list.length === 1 ? 'is' : 'are'}: ${list.slice(0, 40).map(nameOf).join('; ') || 'none'}.` }
  return { error: `"${given}" fits ${hits.length} ${what}s: ${hits.slice(0, 12).map(nameOf).join('; ')}. Say which one.` }
}

export const ACTION_TOOLS: ActionTool[] = [
  {
    name: 'inventory_request', title: 'Ask for stock in or out', who: has('INVENTORY'),
    description: 'Inventory: log a request to put stock IN or take stock OUT of one item of the stock list (the same as "New request" on the Inventory Requests screen). The inventory team then assigns and completes it; the quantity in stock changes only when they complete it.',
    inputSchema: {
      type: 'object',
      properties: {
        item: { type: 'string', description: 'The item, by its name in the stock list.' },
        direction: { type: 'string', enum: ['in', 'out'], description: 'in = stock arrives; out = stock is taken.' },
        quantity: { type: 'number', description: 'How many (a whole number above zero).' },
        requested_by: { type: 'string', description: 'Who is asking for it (a person or a desk), when it is not the asker.' },
        note: { type: 'string', description: 'Why, or for which order.' },
      },
      required: ['item', 'direction', 'quantity'], additionalProperties: false,
    },
    async run(u, a) {
      const type = direction(a.direction)
      const quantity = whole(a.quantity)
      if (!type) return fail('Say whether the stock goes in or out.')
      if (!quantity) return fail('Give the quantity as a whole number above zero.')
      const list = await apiAs(u, 'GET', '/api/inventory/items')
      if (list.status >= 400) return fail(apiError(list))
      const found = byName((list.body as { items: { id: string; name: string; quantity: number }[] }).items, (i) => i.name, str(a.item), 'item')
      if (!found.hit) return fail(found.error!)
      const r = await apiAs(u, 'POST', '/api/inventory/movements', { body: { itemId: found.hit.id, type, quantity, ...(str(a.requested_by) ? { requestedByName: str(a.requested_by).slice(0, 120) } : {}), ...(str(a.note) ? { note: str(a.note).slice(0, 1000) } : {}) } })
      if (r.status >= 400) return fail(apiError(r))
      return text(`Logged a stock ${type === 'STOCK_IN' ? 'in' : 'out'} request for ${quantity} x ${found.hit.name} (now ${found.hit.quantity} in stock; that changes when the inventory team completes the request).`)
    },
  },
  {
    name: 'ecommerce_stock_log', title: 'Log a stock problem', who: has('ECOMMERCE'),
    description: 'E-commerce: add a line to Stock tracking, the list of stock problems the team fixes on the marketplaces (an item ran out and its listings must come down, or it is back and must be relisted).',
    inputSchema: {
      type: 'object',
      properties: {
        item: { type: 'string', description: 'The product, as the team writes it.' },
        direction: { type: 'string', enum: ['in', 'out'], description: 'out = out of stock, take listings down; in = back in stock, relist.' },
        quantity: { type: 'number', description: 'How many, when known.' },
        requested_by: { type: 'string', description: 'Who reported it (default: the asker).' },
        note: { type: 'string', description: 'What to do, on which marketplaces.' },
      },
      required: ['item', 'direction'], additionalProperties: false,
    },
    async run(u, a) {
      const action = direction(a.direction)
      if (!str(a.item)) return fail('Say which product.')
      if (!action) return fail('Say whether it is out of stock (out) or back in stock (in).')
      const quantity = whole(a.quantity)
      const r = await apiAs(u, 'POST', '/api/ecommerce/stock', { body: { itemName: str(a.item).slice(0, 200), action, quantity: quantity || null, requestedByName: (str(a.requested_by) || u.name).slice(0, 120), ...(str(a.note) ? { note: str(a.note).slice(0, 1000) } : {}) } })
      if (r.status >= 400) return fail(apiError(r))
      return text(`Added to Stock tracking: ${str(a.item)} (${action === 'STOCK_OUT' ? 'out of stock' : 'back in stock'}${quantity ? `, ${quantity}` : ''}). Nobody is assigned to it yet.`)
    },
  },
  {
    name: 'ecommerce_meeting_note', title: 'Save meeting notes', who: has('ECOMMERCE'),
    description: 'E-commerce: save notes of a team meeting on the Meeting notes screen, where the whole e-commerce team reads them. Only what the person told you to write; never add decisions of your own.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'A short title for the meeting.' },
        notes: { type: 'string', description: 'The notes, in the person\'s own words.' },
        meeting_date: { type: 'string', description: 'YYYY-MM-DD (default today).' },
        deadline: { type: 'string', description: 'YYYY-MM-DD, when the notes set one.' },
      },
      required: ['title', 'notes'], additionalProperties: false,
    },
    async run(u, a) {
      if (!str(a.title) || !str(a.notes)) return fail('A title and the notes are both needed.')
      const r = await apiAs(u, 'POST', '/api/ecommerce/meeting-notes', { body: { title: str(a.title).slice(0, 200), body: str(a.notes).slice(0, 10000), meetingDate: ymd(a.meeting_date) || undefined, deadline: ymd(a.deadline) || undefined } })
      if (r.status >= 400) return fail(apiError(r))
      return text(`Saved the meeting notes "${str(a.title)}"${ymd(a.deadline) ? ` with the deadline ${ymd(a.deadline)}` : ''}.`)
    },
  },
  {
    name: 'ecommerce_task_add', title: 'Add a task to the e-commerce board', who: leadOf('ECOMMERCE'),
    description: 'E-commerce team lead: put a new task on the team board, optionally given to one person with a due date. The person is told, as when it is added on the board.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        assignee: { type: 'string', description: 'A team member\'s name. Leave out for nobody yet.' },
        due_date: { type: 'string', description: 'YYYY-MM-DD' },
        source: { type: 'string', description: 'Where the task came from (a meeting, a marketplace).' },
      },
      required: ['title'], additionalProperties: false,
    },
    async run(u, a) {
      if (!str(a.title)) return fail('Give the task a title.')
      let assignedToId: string | null = null, who = ''
      if (str(a.assignee)) {
        const board = await apiAs(u, 'GET', '/api/ecommerce/board')
        if (board.status >= 400) return fail(apiError(board))
        const found = byName((board.body as { members: { id: string; name: string }[] }).members, (m) => m.name, str(a.assignee), 'team member')
        if (!found.hit) return fail(found.error!)
        assignedToId = found.hit.id; who = found.hit.name
      }
      const r = await apiAs(u, 'POST', '/api/ecommerce/tasks', { body: { title: str(a.title).slice(0, 300), ...(str(a.description) ? { description: str(a.description).slice(0, 2000) } : {}), ...(str(a.source) ? { source: str(a.source).slice(0, 200) } : {}), assignedToId, dueDate: ymd(a.due_date) || null } })
      if (r.status >= 400) return fail(apiError(r))
      return text(`Added the task "${str(a.title)}" to the e-commerce board${who ? `, given to ${who}` : ', not assigned yet'}${ymd(a.due_date) ? `, due ${ymd(a.due_date)}` : ''}.`)
    },
  },
  {
    name: 'wfh_request', title: 'Ask to work from home', who: () => true,
    description: 'Send the asker\'s own request to work from home for a day or several days in a row. Their team lead approves or declines it, as when it is sent from My Attendance.',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'YYYY-MM-DD, today or later.' },
        end_date: { type: 'string', description: 'YYYY-MM-DD, for several days (default the same day).' },
        reason: { type: 'string', description: 'The person\'s reason, in their words (at least a few words).' },
      },
      required: ['start_date', 'reason'], additionalProperties: false,
    },
    async run(u, a) {
      if (!ymd(a.start_date)) return fail('Give the day as YYYY-MM-DD.')
      if (str(a.reason).length < 3) return fail('A short reason is needed.')
      const r = await apiAs(u, 'POST', '/api/attendance/wfh-requests', { body: { startDate: ymd(a.start_date), ...(ymd(a.end_date) ? { endDate: ymd(a.end_date) } : {}), reason: str(a.reason).slice(0, 500) } })
      if (r.status >= 400) return fail(apiError(r))
      return text(`Sent the request to work from home ${ymd(a.end_date) && ymd(a.end_date) !== ymd(a.start_date) ? `from ${ymd(a.start_date)} to ${ymd(a.end_date)}` : `on ${ymd(a.start_date)}`}. It waits for the team lead's answer.`)
    },
  },
  {
    name: 'leave_add', title: 'Enter leave for a team member', who: (a) => sa(a) || a.role === 'TEAM_LEAD',
    description: 'Team lead: enter one day of leave, a day off, or a work-from-home day for a person of the team (the same as on the Holidays & Leave screen). That day then does not count against their targets.',
    inputSchema: {
      type: 'object',
      properties: {
        person: { type: 'string', description: 'The team member\'s name.' },
        date: { type: 'string', description: 'YYYY-MM-DD' },
        kind: { type: 'string', enum: ['leave', 'off', 'work from home'], description: 'Default leave.' },
        note: { type: 'string' },
      },
      required: ['person', 'date'], additionalProperties: false,
    },
    async run(u, a) {
      if (!ymd(a.date)) return fail('Give the day as YYYY-MM-DD.')
      const members = await apiAs(u, 'GET', '/api/admin/leave/members')
      if (members.status >= 400) return fail(apiError(members))
      const found = byName((members.body as { members: { id: string; name: string }[] }).members, (m) => m.name, str(a.person), 'team member')
      if (!found.hit) return fail(found.error!)
      const k = norm(str(a.kind))
      const type = /home|wfh|remote/.test(k) ? 'WFH' : /\boff\b/.test(k) ? 'OFF' : 'ON_LEAVE'
      const r = await apiAs(u, 'POST', '/api/admin/leave', { body: { userId: found.hit.id, date: ymd(a.date), type, ...(str(a.note) ? { note: str(a.note).slice(0, 300) } : {}) } })
      if (r.status >= 400) return fail(apiError(r))
      return text(`Entered ${type === 'WFH' ? 'a work-from-home day' : type === 'OFF' ? 'a day off' : 'leave'} for ${found.hit.name.trim()} on ${ymd(a.date)}.`)
    },
  },
  // ---------------------------------------------------------------- plan 2026-11: requests, quotes, time, meeting tasks
  {
    name: 'request_send', title: 'Send a request for approval', who: on('requests'),
    description: 'Send the asker\'s own request for approval, as "New request" on the Requests screen does: an expense or a purchase (with an amount), leave (with the days and the kind of leave), or anything else. The people the company\'s rules name then approve it; nothing is approved here.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['expense', 'purchase', 'leave', 'other'] },
        title: { type: 'string', description: 'What it is for (not needed for leave).' },
        amount: { type: 'number', description: 'Expense or purchase: the amount.' },
        currency: { type: 'string', description: 'Three letters, like USD or PKR (default USD).' },
        leave_kind: { type: 'string', enum: ['annual', 'sick', 'casual', 'unpaid'], description: 'Leave: which kind.' },
        start_date: { type: 'string', description: 'Leave: the first day, YYYY-MM-DD.' },
        end_date: { type: 'string', description: 'Leave: the last day, YYYY-MM-DD (default the same day).' },
        details: { type: 'string', description: 'Anything else the approver should know, in the person\'s words.' },
      },
      required: ['kind'], additionalProperties: false,
    },
    async run(u, a) {
      const k = norm(str(a.kind))
      const kind = /leave|chutti|day off/.test(k) ? 'LEAVE' : /purchase|buy/.test(k) ? 'PURCHASE' : /expense|kharcha|claim/.test(k) ? 'EXPENSE' : 'OTHER'
      const details = str(a.details).slice(0, 2000) || undefined
      if (kind === 'LEAVE') {
        if (!ymd(a.start_date)) return fail('Give the first day of the leave as YYYY-MM-DD.')
        const lk = norm(str(a.leave_kind))
        const leaveKind = /sick|bimar/.test(lk) ? 'SICK' : /casual/.test(lk) ? 'CASUAL' : /unpaid/.test(lk) ? 'UNPAID' : /annual|yearly|vacation|holiday/.test(lk) ? 'ANNUAL' : ''
        if (!leaveKind) return fail('Say which kind of leave: annual, sick, casual or unpaid.')
        const days = daysFrom(ymd(a.start_date), ymd(a.end_date) || ymd(a.start_date))
        if (!days.length) return fail('The last day is before the first day.')
        const r = await apiAs(u, 'POST', '/api/approvals', { body: { kind, leaveKind, days, details } })
        if (r.status >= 400) return fail(apiError(r))
        const made = (r.body as { request: ReqMade }).request
        return text(`Sent request #${made.number}: ${made.line}. ${sentTo(made)}`)
      }
      if (!str(a.title)) return fail('Say what it is for.')
      const amount = Number(a.amount)
      if ((kind === 'EXPENSE' || kind === 'PURCHASE') && !(Number.isFinite(amount) && amount > 0)) return fail('Give the amount.')
      const currency = /^[a-z]{3}$/i.test(str(a.currency)) ? str(a.currency).toUpperCase() : 'USD'
      const r = await apiAs(u, 'POST', '/api/approvals', { body: { kind, title: str(a.title).slice(0, 160), details, ...(Number.isFinite(amount) && amount > 0 ? { amount, currency } : {}) } })
      if (r.status >= 400) return fail(apiError(r))
      const made = (r.body as { request: ReqMade }).request
      return text(`Sent request #${made.number}: ${made.line}. ${sentTo(made)}`)
    },
  },
  {
    name: 'request_decide', title: 'Approve or decline a request', who: on('requests'),
    description: 'Decide a request that is waiting on the asker (Requests, "Waiting on me"): approve it, or decline it with a reason. Only requests waiting on the asker can be decided; the request is named by its number.',
    inputSchema: {
      type: 'object',
      properties: {
        number: { type: 'number', description: 'The request\'s number, as in "Waiting on me".' },
        decision: { type: 'string', enum: ['approve', 'decline'] },
        note: { type: 'string', description: 'A note for the person who asked. Needed when declining.' },
      },
      required: ['number', 'decision'], additionalProperties: false,
    },
    async run(u, a) {
      const n = whole(a.number)
      const d = norm(str(a.decision))
      const approve = /approve|yes|accept|ok|manzoor/.test(d) && !/not|dis|decline|reject/.test(d)
      if (!approve && !/decline|reject|no|deny|refuse|not/.test(d)) return fail('Say approve or decline.')
      if (!approve && str(a.note).length < 2) return fail('Say why, so the person knows.')
      const list = await apiAs(u, 'GET', '/api/approvals', { query: { box: 'waiting' } })
      if (list.status >= 400) return fail(apiError(list))
      const waiting = (list.body as { requests: ReqMade[] }).requests.sort((x, y) => x.number - y.number)
      const hit = waiting.find((x) => x.number === n)
      if (!hit) return fail(`No request #${n || '?'} is waiting on ${u.name}. Waiting on them: ${waiting.map((x) => `#${x.number} ${x.line}`).join('; ') || 'nothing'}.`)
      const r = await apiAs(u, 'POST', `/api/approvals/${hit.id}/decide`, { body: { approve, ...(str(a.note) ? { note: str(a.note).slice(0, 500) } : {}) } })
      if (r.status >= 400) return fail(apiError(r))
      const after = (r.body as { request: ReqMade }).request
      return text(`${approve ? 'Approved' : 'Declined'} request #${hit.number} (${hit.line}) from ${hit.requester.name}. ${after.status === 'PENDING' ? sentTo(after) : `It is now ${after.status === 'APPROVED' ? 'approved' : 'not approved'}.`}`)
    },
  },
  {
    name: 'sales_doc_draft', title: 'Draft a quote or an invoice', who: on('sales-docs'),
    description: 'Write a quote or an invoice as a DRAFT on the Quotes and invoices screen: the customer and the lines (what, how many, price each). It is not sent to anyone: the person opens the draft, checks it and sends it themself.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['quote', 'invoice'] },
        customer: { type: 'string', description: 'The customer\'s name.' },
        customer_email: { type: 'string' },
        lines: { type: 'array', description: 'One per item.', items: { type: 'object', properties: { description: { type: 'string' }, quantity: { type: 'number' }, price: { type: 'number', description: 'Price for one.' } }, required: ['description', 'price'] } },
        currency: { type: 'string', description: 'Three letters (default USD).' },
        tax_percent: { type: 'number' },
        discount: { type: 'number' },
        due_date: { type: 'string', description: 'YYYY-MM-DD: an invoice\'s due date, or the day a quote stops being valid.' },
        notes: { type: 'string', description: 'Text printed on the document (payment details, terms).' },
      },
      required: ['kind', 'customer', 'lines'], additionalProperties: false,
    },
    async run(u, a) {
      const kind = /invoice|bill/.test(norm(str(a.kind))) ? 'INVOICE' : 'QUOTE'
      if (!str(a.customer)) return fail('Say who it is for.')
      const lines = (Array.isArray(a.lines) ? a.lines : []).map((l) => l as Record<string, unknown>).map((l) => ({ description: str(l.description).slice(0, 300), quantity: Number(l.quantity) > 0 ? Number(l.quantity) : 1, unitPrice: Number(l.price ?? l.unitPrice ?? l.unit_price) })).filter((l) => l.description)
      if (!lines.length) return fail('Give at least one line: what it is and its price.')
      if (lines.some((l) => !Number.isFinite(l.unitPrice) || l.unitPrice < 0)) return fail('Every line needs a price.')
      const email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str(a.customer_email)) ? str(a.customer_email) : ''
      const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0)
      const r = await apiAs(u, 'POST', '/api/sales-docs', { body: { kind, customerName: str(a.customer).slice(0, 160), customerEmail: email, lines, currency: /^[a-z]{3}$/i.test(str(a.currency)) ? str(a.currency).toUpperCase() : 'USD', taxRate: Math.min(100, num(a.tax_percent)), discount: num(a.discount), dueDate: ymd(a.due_date) || null, notes: str(a.notes).slice(0, 2000) } })
      if (r.status >= 400) return fail(apiError(r))
      const d = (r.body as { doc: { number: string; total: number; currency: string } }).doc
      return text(`Drafted ${kind === 'INVOICE' ? 'invoice' : 'quote'} ${d.number} for ${str(a.customer)}: ${lines.length} line${lines.length === 1 ? '' : 's'}, total ${d.currency} ${d.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}. It is a draft and has not been sent: open Quotes and invoices to check and send it.`)
    },
  },
  {
    name: 'task_time_log', title: 'Log time on a task', who: on('project-extras'),
    description: 'Add time the asker spent on a project task (the same as "Add time" in the task window): the task by its code, the minutes, and optionally what it was spent on.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'The task\'s code, like RTI-12.' },
        minutes: { type: 'number', description: 'Minutes spent (90 for an hour and a half).' },
        note: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD when it was not today.' },
      },
      required: ['task', 'minutes'], additionalProperties: false,
    },
    async run(u, a) {
      const code = str(a.task).toUpperCase().replace(/\s+/g, '')
      if (!/^[A-Z][A-Z0-9]{1,5}-\d{1,7}$/.test(code)) return fail('Give the task\'s code, like RTI-12.')
      const minutes = whole(a.minutes)
      if (!minutes || minutes > 1440) return fail('Give the minutes spent (at most a day in one entry).')
      const r = await apiAs(u, 'POST', `/api/projects/tasks/${code}/time`, { body: { minutes, ...(str(a.note) ? { note: str(a.note).slice(0, 300) } : {}), ...(ymd(a.date) ? { date: ymd(a.date) } : {}) } })
      if (r.status >= 400) return fail(apiError(r))
      const total = (r.body as { totalMinutes: number }).totalMinutes
      return text(`Logged ${minutes} minutes on ${code}${ymd(a.date) ? ` for ${ymd(a.date)}` : ''}. The task now has ${Math.floor(total / 60)} h ${total % 60} min in all.`)
    },
  },
  {
    name: 'meeting_tasks', title: 'Make tasks from meeting notes', who: () => true,
    description: 'Turn the action items of a meeting (or of any notes the person gave) into tasks on a project board, all with ONE confirmation. Pass each task with its title and, when the notes say so, who does it and by when. Only action items that are in the notes: never invent a task, a person or a date.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'The project the tasks go into, by its name or key.' },
        source: { type: 'string', description: 'Where they came from, for the task\'s description ("Weekly sales meeting, 20 Nov").' },
        tasks: { type: 'array', description: 'One per action item, at most 15.', items: { type: 'object', properties: { title: { type: 'string' }, assignee: { type: 'string', description: 'A project member\'s name, when the notes name who does it.' }, due_date: { type: 'string', description: 'YYYY-MM-DD, when the notes give a date.' }, details: { type: 'string' } }, required: ['title'] } },
      },
      required: ['project', 'tasks'], additionalProperties: false,
    },
    async run(u, a) {
      const wanted = (Array.isArray(a.tasks) ? a.tasks : []).map((t) => t as Record<string, unknown>).filter((t) => str(t.title))
      if (!wanted.length) return fail('Give at least one task with a title.')
      if (wanted.length > 15) return fail('At most 15 tasks at once. Send the rest in a second go.')
      const projects = await apiAs(u, 'GET', '/api/projects')
      if (projects.status >= 400) return fail(apiError(projects))
      const open = (projects.body as { projects: { key: string; name: string; status?: string }[] }).projects.filter((p) => !p.status || p.status === 'ACTIVE')
      const byKey = open.find((p) => p.key.toLowerCase() === str(a.project).toLowerCase())
      const found = byKey ? { hit: byKey } : byName(open, (p) => p.name, str(a.project), 'project')
      if (!found.hit) return fail(found.error!)
      const p = found.hit
      const mem = await apiAs(u, 'GET', `/api/projects/${p.key}/members`)
      if (mem.status >= 400) return fail(apiError(mem))
      const members = (mem.body as { members: { userId: string; name: string; isActive: boolean }[] }).members.filter((m) => m.isActive)
      // Check every task before making any: one unknown name stops the whole card, so half a meeting is never made.
      const plan: { title: string; description: string | null; assigneeIds: string[]; who: string; dueAt: string | null }[] = []
      for (const t of wanted) {
        let who = '', assigneeIds: string[] = []
        if (str(t.assignee)) {
          const m = byName(members, (x) => x.name, str(t.assignee), 'project member')
          if (!m.hit) return fail(`Task "${str(t.title)}": ${m.error}`)
          who = m.hit.name; assigneeIds = [m.hit.userId]
        }
        const description = [str(t.details), str(a.source) ? `From: ${str(a.source)}` : ''].filter(Boolean).join('\n\n').slice(0, 4000) || null
        plan.push({ title: str(t.title).slice(0, 255), description, assigneeIds, who, dueAt: ymd(t.due_date) ? `${ymd(t.due_date)}T23:59:00` : null })
      }
      const made: string[] = []
      for (const t of plan) {
        const r = await apiAs(u, 'POST', `/api/projects/${p.key}/tasks`, { body: { title: t.title, description: t.description, assigneeIds: t.assigneeIds, ...(t.dueAt ? { dueAt: new Date(t.dueAt).toISOString() } : {}) } })
        if (r.status >= 400) return fail(`${made.length ? `Made ${made.join(', ')}; then stopped. ` : ''}"${t.title}": ${apiError(r)}`)
        made.push(`${(r.body as { task: { code: string } }).task.code} ${t.title}${t.who ? ` (${t.who})` : ''}`)
      }
      return text(`Made ${made.length} task${made.length === 1 ? '' : 's'} in ${p.name}: ${made.join('; ')}.`)
    },
  },
]
