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
]
