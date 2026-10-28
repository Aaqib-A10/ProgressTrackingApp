import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Request, Response } from 'express'
import { DateTime } from 'luxon'
import type { Role } from '@prisma/client'
import { prisma } from './prisma'
import { invokeAs, invokedError } from './pm/invoke'
import { ticketBrief, fmtWhen, type BriefTask } from './pm/brief'
import * as T from '../controllers/pmTasksController'
import * as P from '../controllers/projectsController'
import { COMPANY_TZ } from './time'
import { canSeeHealth } from '../controllers/systemHealthController'
import { auditReport, errorBrief, errorList } from './health/report'
import { startAudit } from './health/audit'
import { DEPARTMENT_TOOLS } from './mcp/departmentTools'
import { runAsCompany } from './tenancy'

/**
 * Metriq as a connector for Claude, ChatGPT and Gemini (Model Context Protocol, "streamable
 * HTTP", stateless). One endpoint serves all three.
 *
 * The person makes a private key under Connectors and adds https://<site>/api/mcp/<key> as a
 * custom connector in their AI app. The app can then list the tickets assigned to them, read a ticket
 * (with its files and comments), comment, tick the checklist and move the ticket, always as
 * that person and through the same checks, activity log and notifications as the app.
 */

const APP_URL = () => (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '')
const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']

export const KEY_PREFIX = 'mtq_'
export const hashKey = (key: string) => crypto.createHash('sha256').update(key).digest('hex')
export function newKey(): string { return KEY_PREFIX + crypto.randomBytes(32).toString('base64url') }

type User = { id: string; role: Role; name: string; companyId: string }

const INSTRUCTIONS = `Metriq is the team's work app: project tickets, plus each team's own work (ITAD Lead Dialer, daily logs and deals; E-commerce board, listings and stock; Lead Gen; Marketing; attendance; to-dos; reports).
For anything that is not a project ticket, call metriq_guide first: it lists what this person can see and how to read it (metriq_read, or the Lead Dialer tools dialer_summary, dialer_leads, dialer_lead, dialer_update_lead). Answer from that real data; never guess or ask for screenshots.
ITAD follow-ups and "who do I call first": dialer_leads with view follow_ups (overdue first), call_now or prime_time, and hot for Interested and Pipeline leads.
Tickets have codes like CMR-6 (project key + number).
To work on someone's tickets: list_my_tickets, then get_ticket for each one. "Where the work lives" in a ticket tells you the folder or repo to change.
When you finish a ticket: add_comment saying what you changed and where (files, links), tick checklist items you completed, then move_ticket to the review column (e.g. "In review").
Never move a ticket to Done unless the person asked you to. Comments and moves appear under the person's own name.
If a ticket needs something you cannot do (a phone call, a decision, a login), comment what is needed instead of guessing.
To give work to someone: list_project_members to find the right person (if a name fits more than one person, ask which one), list_board_columns for valid statuses, then create_ticket. update_ticket changes title, description, assignee, due date or priority. Only the person who created a ticket can delete it; confirm with the person before deleting.
Developers and Super Admins also get System Health tools: system_health, get_audit_report, list_errors and get_error show what is broken in Metriq itself (with stack traces) so you can fix it in the PulseTrack code; after the fix is deployed, set_error_state marks it resolved.`

// ------------------------------------------------------------------ tools

interface Tool {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: Record<string, boolean>
  /** System Health tools: only listed for, and usable by, developers and Super Admins. */
  health?: boolean
  run: (u: User, args: Record<string, unknown>) => Promise<ToolResult>
}
type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
interface ToolResult { content: Content[]; isError?: boolean }

const text = (t: string): ToolResult => ({ content: [{ type: 'text', text: t }] })
const fail = (t: string): ToolResult => ({ content: [{ type: 'text', text: t }], isError: true })
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const code = (v: unknown) => str(v).toUpperCase()
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

async function loadTicket(u: User, c: string): Promise<{ task?: BriefTask & { id: string }; error?: string }> {
  if (!/^[A-Z][A-Z0-9]{1,5}-\d+$/.test(c)) return { error: `"${c}" is not a ticket code. Codes look like CMR-6.` }
  const r = await invokeAs(T.getTask, u, { params: { code: c } })
  if (r.status >= 400) return { error: invokedError(r) }
  return { task: (r.body as { task: BriefTask & { id: string } }).task }
}


// ------------------------------------------------------------------ shared helpers (projects, people, dates)

type Card = { code: string; title: string; status: string; category: string; priority: string; dueAt: string | null; isOverdue: boolean; createdBy: { name: string }; assignees: { id: string; name: string }[] }

/** One ticket as a line: code | status | priority | due | title | given by / given to. */
function ticketLine(t: Card, who: 'from' | 'to' | 'both'): string {
  const due = t.dueAt ? ` | due ${fmtWhen(t.dueAt)}${t.isOverdue ? ' (OVERDUE)' : ''}` : ''
  const to = t.assignees.map((x) => x.name).join(', ') || 'nobody'
  const tail = who === 'from' ? `from ${t.createdBy.name}` : who === 'to' ? `to ${to}` : `to ${to}, from ${t.createdBy.name}`
  return `${t.code} | ${t.status} | ${t.priority.toLowerCase()}${due} | ${t.title} | ${tail}`
}

type ProjectRow = { key: string; name: string; workFolder: string | null; myRole: string | null; openCount: number; myOpenCount: number }

/** A project the person can see, by key or name. Unknown → a plain error naming the projects they have. */
async function resolveProject(u: User, given: unknown): Promise<{ project?: ProjectRow; error?: string }> {
  const want = norm(str(given))
  if (!want) return { error: 'Say which project (its key, e.g. CMR, or its name).' }
  const r = await invokeAs(P.listProjects, u)
  if (r.status >= 400) return { error: invokedError(r) }
  const rows = (r.body as { projects: ProjectRow[] }).projects
  const hit = rows.find((p) => norm(p.key) === want) ?? rows.find((p) => norm(p.name) === want)
  if (hit) return { project: hit }
  return { error: `No project "${str(given)}" that you can see. Your projects: ${rows.map((p) => `${p.key} (${p.name})`).join(', ') || 'none'}.` }
}

type Member = { userId: string; name: string; email: string; isActive: boolean; role: string }

async function projectMembers(u: User, key: string): Promise<{ members?: Member[]; error?: string }> {
  const r = await invokeAs(P.listMembers, u, { params: { key } })
  if (r.status >= 400) return { error: invokedError(r) }
  return { members: (r.body as { members: Member[] }).members }
}

/**
 * A project member by user id, email or name ("me" is the person). Only members can be picked.
 * A name that fits more than one person returns the candidates instead of guessing.
 */
function resolveMember(u: User, members: Member[], given: string, projectKey: string): { member?: Member; error?: string } {
  const g = given.trim()
  const active = members.filter((m) => m.isActive)
  if (/^(me|myself|i)$/i.test(g)) {
    const mine = active.find((m) => m.userId === u.id)
    return mine ? { member: mine } : { error: `You are not a member of ${projectKey}, so the ticket cannot be assigned to you.` }
  }
  const byId = active.find((m) => m.userId === g)
  if (byId) return { member: byId }
  const byEmail = active.find((m) => m.email.toLowerCase() === g.toLowerCase())
  if (byEmail) return { member: byEmail }
  const n = norm(g)
  const exact = active.filter((m) => norm(m.name) === n)
  const loose = exact.length ? exact : active.filter((m) => n.length >= 2 && (norm(m.name).includes(n) || m.name.toLowerCase().split(/\s+/).some((w) => norm(w) === n)))
  if (loose.length === 1) return { member: loose[0] }
  const list = (ms: Member[]) => ms.map((m) => `${m.name} (${m.email}, id ${m.userId})`).join('; ')
  if (loose.length > 1) return { error: `"${g}" matches more than one person in ${projectKey}: ${list(loose)}. Say which one (use the email or id).` }
  return { error: `"${g}" is not a member of ${projectKey}. Members: ${list(active) || 'none'}. Only project members can be given tickets.` }
}

/**
 * YYYY-MM-DD (end of that day) or "YYYY-MM-DD HH:MM", on the company clock like the app's date
 * picker. "none" or "" clears it (null). Returns an ISO string, null, or an error.
 */
function parseDue(v: unknown): { iso?: string | null; error?: string } {
  const s = str(v)
  if (!s || /^(none|no|clear|null)$/i.test(s)) return { iso: null }
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/)
  if (!m) return { error: `"${s}" is not a date. Use YYYY-MM-DD, e.g. 2026-10-30 (optionally with a time, 2026-10-30 17:00).` }
  const d = m[2] ? DateTime.fromISO(`${m[1]}T${m[2].padStart(2, '0')}:${m[3]}`, { zone: COMPANY_TZ }) : DateTime.fromISO(m[1], { zone: COMPANY_TZ }).set({ hour: 23, minute: 59 })
  if (!d.isValid) return { error: `"${s}" is not a real date.` }
  return { iso: d.toUTC().toISO() }
}

const PRIORITY: Record<string, string> = { low: 'LOW', medium: 'MEDIUM', high: 'HIGH', urgent: 'URGENT' }

type Column = { id: string; name: string; category: string; isDefault: boolean }
type Board = { columns: Column[]; tasks: (Card & { createdAt: string })[]; perms: Record<string, boolean> }

async function loadBoard(u: User, key: string, showOldDone = false): Promise<{ board?: Board; error?: string }> {
  const r = await invokeAs(P.getBoard, u, { params: { key }, query: showOldDone ? { showOldDone: '1' } : {} })
  if (r.status >= 400) return { error: invokedError(r) }
  return { board: r.body as Board }
}

function findColumn(cols: Column[], given: string): Column | undefined {
  const want = norm(given)
  return cols.find((x) => norm(x.name) === want) ?? cols.find((x) => want.length >= 4 && norm(x.name).includes(want))
}

const ticketUrl = (key: string, c: string) => `${APP_URL()}/app/projects/${encodeURIComponent(key)}?task=${encodeURIComponent(c)}`

const TOOLS: Tool[] = [
  {
    name: 'list_my_tickets',
    title: 'List my tickets',
    description: 'Tickets assigned to the person (or created by them for others), open ones first by due date. Optionally only one project.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project key or name, e.g. CMR. Leave out for all projects.' },
        scope: { type: 'string', enum: ['assigned', 'created'], description: 'assigned (default): tickets assigned to me. created: tickets I gave to others.' },
        include_done: { type: 'boolean', description: 'Also list tickets finished in the last 7 days.' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    async run(u, a) {
      const scope = a.scope === 'created' ? 'created' : 'assigned'
      const r = await invokeAs(T.myTasks, u, { query: { scope } })
      if (r.status >= 400) return fail(invokedError(r))
      type Row = { code: string; title: string; status: string; category: string; priority: string; dueAt: string | null; isOverdue: boolean; createdBy: { name: string }; assignees: { id: string; name: string }[]; project: { key: string; name: string } }
      let rows = (r.body as { tasks: Row[] }).tasks
      const p = str(a.project)
      if (p) rows = rows.filter((t) => norm(t.project.key) === norm(p) || norm(t.project.name) === norm(p))
      if (!a.include_done) rows = rows.filter((t) => t.category !== 'DONE')
      if (!rows.length) return text(`No ${a.include_done ? '' : 'open '}tickets ${scope === 'assigned' ? 'assigned to you' : 'you gave to others'}${p ? ` in ${p}` : ''}.`)
      const lines = rows.map((t) => ticketLine(t, scope === 'assigned' ? 'from' : 'to'))
      return text(`${rows.length} ticket${rows.length === 1 ? '' : 's'} (code | status | priority | due | title | ${scope === 'assigned' ? 'given by' : 'given to'}):\n${lines.join('\n')}\n\nUse get_ticket with a code for the full brief.`)
    },
  },
  {
    name: 'get_ticket',
    title: 'Read a ticket',
    description: 'The full brief of one ticket: what to do, where the work lives (folder or repo), checklist, files (with attachment_id for read_attachment), reviews and every comment.',
    inputSchema: { type: 'object', properties: { code: { type: 'string', description: 'Ticket code, e.g. CMR-6' } }, required: ['code'], additionalProperties: false },
    annotations: { readOnlyHint: true },
    async run(u, a) {
      const { task, error } = await loadTicket(u, code(a.code))
      if (!task) return fail(error!)
      const project = await prisma.pmProject.findFirst({ where: { key: task.projectKey }, select: { workFolder: true } })
      const brief = ticketBrief(task, { workFolder: project?.workFolder ?? null, appUrl: APP_URL(), forConnector: true })
      const ids = task.checklist.length ? `\n\nChecklist item ids (for update_checklist_item): ${task.checklist.map((c) => `${c.id} = "${c.text}"`).join('; ')}` : ''
      return text(brief + ids)
    },
  },
  {
    name: 'list_projects',
    title: 'List my projects',
    description: 'Projects the person can see, with their key, open ticket counts and where the work lives.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    async run(u) {
      const r = await invokeAs(P.listProjects, u)
      if (r.status >= 400) return fail(invokedError(r))
      type Row = { key: string; name: string; workFolder: string | null; myRole: string | null; openCount: number; myOpenCount: number }
      const rows = (r.body as { projects: Row[] }).projects
      if (!rows.length) return text('No projects.')
      return text(rows.map((p) => `${p.key} | ${p.name} | ${p.myOpenCount} open for me, ${p.openCount} open in total | work lives: ${p.workFolder || 'not set'}`).join('\n'))
    },
  },
  {
    name: 'add_comment',
    title: 'Comment on a ticket',
    description: 'Adds a comment to a ticket under the person\'s name (watchers are notified). Use it to report what was done, or to ask for what is missing.',
    inputSchema: { type: 'object', properties: { code: { type: 'string', description: 'Ticket code, e.g. CMR-6' }, text: { type: 'string', description: 'The comment, plain text.' } }, required: ['code', 'text'], additionalProperties: false },
    async run(u, a) {
      const c = code(a.code)
      const body = str(a.text)
      if (!body) return fail('Write the comment text.')
      const r = await invokeAs(T.addComment, u, { params: { code: c }, body: { body: body.slice(0, 5000) } })
      if (r.status >= 400) return fail(invokedError(r))
      return text(`Comment added to ${c}.`)
    },
  },
  {
    name: 'move_ticket',
    title: 'Move a ticket',
    description: 'Moves a ticket to another column of its board, e.g. "In progress" or "In review". Only move to Done when the person asked.',
    inputSchema: { type: 'object', properties: { code: { type: 'string', description: 'Ticket code, e.g. CMR-6' }, status: { type: 'string', description: 'Column name on the board, e.g. In review' } }, required: ['code', 'status'], additionalProperties: false },
    async run(u, a) {
      const c = code(a.code)
      const { task, error } = await loadTicket(u, c)
      if (!task) return fail(error!)
      const cols = await prisma.pmColumn.findMany({ where: { project: { key: task.projectKey } }, orderBy: { position: 'asc' }, select: { id: true, name: true, category: true } })
      const want = norm(str(a.status))
      const col = cols.find((x) => norm(x.name) === want) ?? cols.find((x) => norm(x.name).includes(want) && want.length >= 4)
      if (!col) return fail(`No column "${str(a.status)}" on ${task.projectKey}. Columns: ${cols.map((x) => x.name).join(', ')}.`)
      if (norm(col.name) === norm(task.status)) return text(`${c} is already in ${col.name}.`)
      const r = await invokeAs(T.moveTask, u, { params: { code: c }, body: { columnId: col.id } })
      if (r.status >= 400) return fail(invokedError(r))
      return text(`${c} moved from ${task.status} to ${col.name}.`)
    },
  },
  {
    name: 'update_checklist_item',
    title: 'Tick a checklist item',
    description: 'Marks a checklist item of a ticket as done (or not done). Give the item id from get_ticket, or its exact text.',
    inputSchema: { type: 'object', properties: { code: { type: 'string' }, item: { type: 'string', description: 'Item id or its text' }, done: { type: 'boolean' } }, required: ['code', 'item', 'done'], additionalProperties: false },
    async run(u, a) {
      const { task, error } = await loadTicket(u, code(a.code))
      if (!task) return fail(error!)
      const want = str(a.item)
      const item = task.checklist.find((x) => x.id === want) ?? task.checklist.find((x) => norm(x.text) === norm(want))
      if (!item) return fail(`No checklist item "${want}" on ${task.code}. Items: ${task.checklist.map((x) => `"${x.text}"`).join(', ') || 'none'}.`)
      const r = await invokeAs(T.updateChecklistItem, u, { params: { id: item.id }, body: { isDone: a.done === true } })
      if (r.status >= 400) return fail(invokedError(r))
      return text(`"${item.text}" marked ${a.done === true ? 'done' : 'not done'} on ${task.code}.`)
    },
  },
  {
    name: 'read_attachment',
    title: 'Read a file on a ticket',
    description: 'Opens a file attached to a ticket: images are shown, text files (txt, md, csv, json, html, code) are returned as text. Get the attachment_id from get_ticket.',
    inputSchema: { type: 'object', properties: { attachment_id: { type: 'string' } }, required: ['attachment_id'], additionalProperties: false },
    annotations: { readOnlyHint: true },
    async run(u, a) {
      const att = await prisma.pmAttachment.findUnique({ where: { id: str(a.attachment_id) }, include: { task: { select: { code: true, deletedAt: true } } } })
      if (!att || att.task.deletedAt) return fail('File not found.')
      const { task, error } = await loadTicket(u, att.task.code) // same access as the ticket itself
      if (!task) return fail(error!)
      let buf: Buffer
      try { buf = await fs.readFile(path.join(path.resolve('uploads', 'projects'), att.storedName)) } catch { return fail('The file is missing on the server.') }
      const mime = att.mimeType.toLowerCase()
      if (/^image\/(png|jpe?g|gif|webp)$/.test(mime)) {
        if (buf.length > 5 * 1048576) return fail(`${att.originalName} is too big to show here (over 5 MB). Open it from the ticket in Metriq.`)
        return { content: [{ type: 'text', text: `${att.originalName} (from ${task.code}):` }, { type: 'image', data: buf.toString('base64'), mimeType: mime === 'image/jpg' ? 'image/jpeg' : mime }] }
      }
      const textLike = mime.startsWith('text/') || /json|xml|javascript|typescript|csv|markdown|yaml/.test(mime) || /\.(txt|md|csv|json|html?|css|js|ts|tsx|jsx|py|sql|ya?ml|xml|log)$/i.test(att.originalName)
      if (textLike) {
        const max = 200_000
        const body = buf.subarray(0, max).toString('utf8')
        return text(`${att.originalName} (from ${task.code})${buf.length > max ? ', first 200 KB' : ''}:\n\n${body}`)
      }
      return text(`${att.originalName} is a ${att.mimeType} file (${Math.round(att.size / 1024)} KB). It cannot be opened here; ask the person to download it from ${APP_URL()}/app/projects/${task.projectKey}?task=${task.code}.`)
    },
  },
  {
    name: 'list_board_columns',
    title: 'List board columns',
    description: 'The columns of a project\'s board in order (e.g. To Do, In Progress, In Review, Done). Use these names as the status for create_ticket and move_ticket.',
    inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Project key or name, e.g. CMR' } }, required: ['project'], additionalProperties: false },
    annotations: { readOnlyHint: true },
    async run(u, a) {
      const { project, error } = await resolveProject(u, a.project)
      if (!project) return fail(error!)
      const { board, error: e2 } = await loadBoard(u, project.key)
      if (!board) return fail(e2!)
      return text(`${project.key} columns, in order:\n${board.columns.map((c, i) => `${i + 1}. ${c.name}${c.isDefault ? ' (new tickets start here)' : ''}${c.category === 'DONE' ? ' (finished)' : ''}`).join('\n')}`)
    },
  },
  {
    name: 'list_project_members',
    title: 'List project members',
    description: 'Everyone in a project with their name, email, role and user id. Tickets can only be given to these people.',
    inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Project key or name, e.g. CMR' } }, required: ['project'], additionalProperties: false },
    annotations: { readOnlyHint: true },
    async run(u, a) {
      const { project, error } = await resolveProject(u, a.project)
      if (!project) return fail(error!)
      const { members, error: e2 } = await projectMembers(u, project.key)
      if (!members) return fail(e2!)
      const role: Record<string, string> = { ADMIN: 'admin', MEMBER: 'member', VIEWER: 'viewer (cannot be given tickets to work on)' }
      return text(`${members.length} member${members.length === 1 ? '' : 's'} of ${project.key} (name | email | role | user id):\n${members.map((m) => `${m.name}${m.userId === u.id ? ' (you)' : ''} | ${m.email} | ${role[m.role] ?? m.role.toLowerCase()}${m.isActive ? '' : ' | account switched off'} | ${m.userId}`).join('\n')}`)
    },
  },
  {
    name: 'list_project_tickets',
    title: 'List project tickets',
    description: 'All tickets in one project (not only mine), open ones by default. Can filter by column and by assignee (a name, email, "me" or "unassigned").',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project key or name, e.g. CMR' },
        status: { type: 'string', description: 'Only this column, e.g. In Progress' },
        assignee: { type: 'string', description: 'Only tickets given to this person (name, email, id, "me"), or "unassigned"' },
        include_done: { type: 'boolean', description: 'Also list finished tickets (default false)' },
      },
      required: ['project'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    async run(u, a) {
      const { project, error } = await resolveProject(u, a.project)
      if (!project) return fail(error!)
      const { board, error: e2 } = await loadBoard(u, project.key, a.include_done === true)
      if (!board) return fail(e2!)
      let rows = board.tasks
      if (str(a.status)) {
        const col = findColumn(board.columns, str(a.status))
        if (!col) return fail(`No column "${str(a.status)}" on ${project.key}. Columns: ${board.columns.map((x) => x.name).join(', ')}.`)
        rows = rows.filter((t) => t.status === col.name)
      } else if (a.include_done !== true) {
        rows = rows.filter((t) => t.category !== 'DONE')
      }
      if (str(a.assignee)) {
        if (/^(unassigned|nobody|none)$/i.test(str(a.assignee))) rows = rows.filter((t) => !t.assignees.length)
        else {
          const { members, error: e3 } = await projectMembers(u, project.key)
          if (!members) return fail(e3!)
          const { member, error: e4 } = resolveMember(u, members, str(a.assignee), project.key)
          if (!member) return fail(e4!)
          rows = rows.filter((t) => t.assignees.some((x) => x.id === member.userId))
        }
      }
      if (!rows.length) return text(`No ${a.include_done === true || str(a.status) ? '' : 'open '}tickets in ${project.key} match.`)
      return text(`${rows.length} ticket${rows.length === 1 ? '' : 's'} in ${project.key} (code | status | priority | due | title | given to, given by):\n${rows.map((t) => ticketLine(t, 'both')).join('\n')}\n\nUse get_ticket with a code for the full brief.`)
    },
  },
  {
    name: 'create_ticket',
    title: 'Create a ticket',
    description: 'Adds a ticket to a project board, exactly like "+ Add task" in Metriq: it gets the next code (e.g. CMR-7), the person who connected is "given by", and the assignee is notified. Only project members can be assignees.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project key or name, e.g. CMR' },
        title: { type: 'string' },
        description: { type: 'string', description: 'What to do (markdown is fine)' },
        assignee: { type: 'string', description: 'Who does it: name, email, user id, or "me". Leave out for nobody yet.' },
        due_date: { type: 'string', description: 'YYYY-MM-DD (end of that day, Pakistan time), or "YYYY-MM-DD HH:MM"' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], description: 'Default medium' },
        status: { type: 'string', description: 'Board column to start in (see list_board_columns). Default: the board\'s first column for new tickets.' },
        checklist: { type: 'array', items: { type: 'string' }, description: 'Checklist items' },
      },
      required: ['project', 'title'],
      additionalProperties: false,
    },
    async run(u, a) {
      const { project, error } = await resolveProject(u, a.project)
      if (!project) return fail(error!)
      const title = str(a.title)
      if (!title) return fail('Give the ticket a title.')
      const body: Record<string, unknown> = { title, description: str(a.description) || null }
      if (a.priority !== undefined) {
        const p = PRIORITY[str(a.priority).toLowerCase()]
        if (!p) return fail(`Priority must be low, medium, high or urgent (not "${str(a.priority)}").`)
        body.priority = p
      }
      if (a.due_date !== undefined) {
        const d = parseDue(a.due_date)
        if (d.error) return fail(d.error)
        body.dueAt = d.iso
      }
      let assigneeName = 'nobody yet'
      if (str(a.assignee)) {
        const { members, error: e2 } = await projectMembers(u, project.key)
        if (!members) return fail(e2!)
        const { member, error: e3 } = resolveMember(u, members, str(a.assignee), project.key)
        if (!member) return fail(e3!)
        body.assigneeIds = [member.userId]
        assigneeName = member.name
      }
      if (str(a.status)) {
        const { board, error: e4 } = await loadBoard(u, project.key)
        if (!board) return fail(e4!)
        const col = findColumn(board.columns, str(a.status))
        if (!col) return fail(`No column "${str(a.status)}" on ${project.key}. Columns: ${board.columns.map((x) => x.name).join(', ')}.`)
        body.columnId = col.id
      }
      if (Array.isArray(a.checklist)) body.checklist = a.checklist.map((x) => String(x).trim()).filter(Boolean)
      const r = await invokeAs(T.createTask, u, { params: { key: project.key }, body })
      if (r.status >= 400) return fail(invokedError(r))
      const t = (r.body as { task: Card }).task
      return text([
        `Created ${t.code}: ${t.title}`,
        `Project: ${project.key}  |  Status: ${t.status}  |  Priority: ${t.priority.toLowerCase()}`,
        `Assigned to: ${assigneeName}  |  Given by: ${u.name}`,
        `Due: ${t.dueAt ? fmtWhen(t.dueAt) : 'no due date'}`,
        `Open it: ${ticketUrl(project.key, t.code)}`,
      ].join('\n'))
    },
  },
  {
    name: 'update_ticket',
    title: 'Edit a ticket',
    description: 'Changes a ticket\'s title, description, assignee, due date or priority. Only the fields you pass change. Same rules as editing in Metriq: the creator, an assignee or a project admin can edit; only the creator or an admin can change the due date.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Ticket code, e.g. CMR-7' },
        title: { type: 'string' },
        description: { type: 'string' },
        assignee: { type: 'string', description: 'New assignee (replaces the current ones): name, email, user id, "me", or "nobody"' },
        due_date: { type: 'string', description: 'YYYY-MM-DD, "YYYY-MM-DD HH:MM", or "none" to remove it' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
      },
      required: ['code'],
      additionalProperties: false,
    },
    async run(u, a) {
      const c = code(a.code)
      const { task, error } = await loadTicket(u, c)
      if (!task) return fail(error!)
      const body: Record<string, unknown> = {}
      const changed: string[] = []
      if (a.title !== undefined) { if (!str(a.title)) return fail('The title cannot be empty.'); body.title = str(a.title); changed.push('title') }
      if (a.description !== undefined) { body.description = str(a.description) || null; changed.push('description') }
      if (a.priority !== undefined) {
        const p = PRIORITY[str(a.priority).toLowerCase()]
        if (!p) return fail(`Priority must be low, medium, high or urgent (not "${str(a.priority)}").`)
        body.priority = p; changed.push(`priority to ${p.toLowerCase()}`)
      }
      if (a.due_date !== undefined) {
        const d = parseDue(a.due_date)
        if (d.error) return fail(d.error)
        body.dueAt = d.iso; changed.push(d.iso ? `due date to ${fmtWhen(d.iso)}` : 'due date removed')
      }
      if (a.assignee !== undefined) {
        if (/^(nobody|none|unassigned)$/i.test(str(a.assignee)) || !str(a.assignee)) { body.assigneeIds = []; changed.push('assignee removed') }
        else {
          const { members, error: e2 } = await projectMembers(u, task.projectKey)
          if (!members) return fail(e2!)
          const { member, error: e3 } = resolveMember(u, members, str(a.assignee), task.projectKey)
          if (!member) return fail(e3!)
          body.assigneeIds = [member.userId]; changed.push(`assigned to ${member.name}`)
        }
      }
      if (!changed.length) return fail('Nothing to change. Pass a title, description, assignee, due_date or priority.')
      const r = await invokeAs(T.updateTask, u, { params: { code: c }, body })
      if (r.status >= 400) return fail(invokedError(r))
      return text(`${c} updated: ${changed.join(', ')}.\nOpen it: ${ticketUrl(task.projectKey, c)}`)
    },
  },
  {
    name: 'add_checklist_item',
    title: 'Add a checklist item',
    description: 'Adds an item to the end of a ticket\'s checklist.',
    inputSchema: { type: 'object', properties: { code: { type: 'string', description: 'Ticket code, e.g. CMR-7' }, text: { type: 'string' } }, required: ['code', 'text'], additionalProperties: false },
    async run(u, a) {
      const c = code(a.code)
      const t = str(a.text)
      if (!t) return fail('Write the checklist item.')
      const r = await invokeAs(T.addChecklistItem, u, { params: { code: c }, body: { text: t.slice(0, 300) } })
      if (r.status >= 400) return fail(r.status === 403 ? `You cannot change ${c}: only its creator, an assignee or a project admin can edit it.` : invokedError(r))
      return text(`Added "${t.slice(0, 300)}" to the checklist of ${c}.`)
    },
  },
  {
    name: 'delete_ticket',
    title: 'Delete a ticket',
    description: 'Deletes a ticket. Only the person who created it can delete it (same rule as Metriq). It is removed from the board; nothing else is lost.',
    inputSchema: { type: 'object', properties: { code: { type: 'string', description: 'Ticket code, e.g. CMR-7' } }, required: ['code'], additionalProperties: false },
    annotations: { destructiveHint: true },
    async run(u, a) {
      const c = code(a.code)
      const { task, error } = await loadTicket(u, c)
      if (!task) return fail(error!)
      const r = await invokeAs(T.deleteTask, u, { params: { code: c } })
      if (r.status === 403) return fail(`You cannot delete ${c}: only the person who created it (${task.createdBy.name}) can delete it.`)
      if (r.status >= 400) return fail(invokedError(r))
      return text(`${c} "${task.title}" deleted.`)
    },
  },
  // ---------------------------------------------------------------- System Health (developers and Super Admins)
  {
    name: 'system_health',
    title: 'Metriq system health',
    description: 'How Metriq itself is doing: the last hourly self check, open errors, background jobs and outages. Start here before fixing Metriq.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    health: true,
    async run() {
      const [run, open, newDay, jobs] = await Promise.all([
        prisma.auditRun.findFirst({ where: { state: { not: 'RUNNING' } }, orderBy: { startedAt: 'desc' } }),
        prisma.errorGroup.count({ where: { state: 'OPEN', source: { not: 'SLOW' } } }),
        prisma.errorGroup.count({ where: { firstSeenAt: { gte: new Date(Date.now() - 86400_000) }, source: { not: 'SLOW' } } }),
        prisma.jobHeartbeat.findMany({ where: { lastError: { not: null } } }),
      ])
      const lines = [
        run ? `Last self check ${run.id}: ${run.state.toLowerCase()}, ${run.passed} passed, ${run.failed} failed, ${run.warned} warnings (${run.startedAt.toISOString()}).` : 'No self check has run yet.',
        `Open errors: ${open} (${newDay} new in the last 24 hours).`,
        jobs.length ? `Failing jobs: ${jobs.map((j) => `${j.name} (${j.lastError})`).join('; ')}` : 'Background jobs: no failures.',
        'Next: get_audit_report for the failed checks, list_errors and get_error for the errors.',
      ]
      return text(lines.join('\n'))
    },
  },
  {
    name: 'list_errors',
    title: 'List Metriq errors',
    description: 'Errors from the Metriq error log (server crashes, pages that broke in browsers, failed jobs, slow requests), newest first. Each line starts with the error id for get_error.',
    inputSchema: { type: 'object', properties: { state: { type: 'string', enum: ['open', 'resolved', 'ignored', 'all'], description: 'Default open.' } }, additionalProperties: false },
    annotations: { readOnlyHint: true },
    health: true,
    async run(_u, a) {
      const st = str(a.state).toUpperCase() || 'OPEN'
      if (!['OPEN', 'RESOLVED', 'IGNORED', 'ALL'].includes(st)) return fail('State must be open, resolved, ignored or all.')
      return text(await errorList({ state: st as 'OPEN' }))
    },
  },
  {
    name: 'get_error',
    title: 'Read a Metriq error',
    description: 'One error from the log with its stack trace, the page or API, who it hit and when. Use it to find and fix the cause in the PulseTrack code.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Error id from list_errors.' } }, required: ['id'], additionalProperties: false },
    annotations: { readOnlyHint: true },
    health: true,
    async run(_u, a) {
      const t = await errorBrief(str(a.id))
      return t ? text(t) : fail('No error with that id. Use list_errors to see the ids.')
    },
  },
  {
    name: 'set_error_state',
    title: 'Resolve or ignore a Metriq error',
    description: 'Marks an error as resolved (after the fix is deployed), ignored, or open again. A resolved error that happens again reopens by itself and alerts the developers.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, state: { type: 'string', enum: ['resolved', 'ignored', 'open'] } }, required: ['id', 'state'], additionalProperties: false },
    health: true,
    async run(u, a) {
      const st = str(a.state).toUpperCase()
      if (!['OPEN', 'RESOLVED', 'IGNORED'].includes(st)) return fail('State must be resolved, ignored or open.')
      const g = await prisma.errorGroup.findUnique({ where: { id: str(a.id) }, select: { id: true } })
      if (!g) return fail('No error with that id.')
      await prisma.errorGroup.update({ where: { id: g.id }, data: { state: st as 'OPEN', resolvedAt: st === 'RESOLVED' ? new Date() : null, resolvedById: st === 'RESOLVED' ? u.id : null } })
      return text(`Error ${g.id} is now ${st.toLowerCase()}.`)
    },
  },
  {
    name: 'get_audit_report',
    title: 'Read a self check report',
    description: 'The hourly self check: every API, the database, server, services, jobs, data and website. Shows what failed, what is new since the run before and what got fixed. Leave run_id out for the latest.',
    inputSchema: { type: 'object', properties: { run_id: { type: 'string' } }, additionalProperties: false },
    annotations: { readOnlyHint: true },
    health: true,
    async run(_u, a) {
      const t = await auditReport(str(a.run_id) || undefined)
      return t ? text(t) : fail(str(a.run_id) ? 'No self check with that id.' : 'No self check has run yet. Use run_audit.')
    },
  },
  {
    name: 'run_audit',
    title: 'Run the self check now',
    description: 'Starts the full self check now (takes a minute or two; nothing in Metriq is changed by it). Then call get_audit_report with the run id.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    health: true,
    async run(u) {
      const r = await startAudit({ trigger: 'claude', startedById: u.id })
      return text(r.already ? `A self check is already running: ${r.runId}. Call get_audit_report with that id in a minute.` : `Self check ${r.runId} started. Call get_audit_report with run_id ${r.runId} in a minute or two.`)
    },
  },
  ...DEPARTMENT_TOOLS,
]

// ------------------------------------------------------------------ JSON-RPC over HTTP

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }
const rpcError = (id: Rpc['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

async function handle(u: User, m: Rpc): Promise<object | null> {
  const isNotification = m.id === undefined || m.id === null
  if (!m || typeof m !== 'object' || typeof m.method !== 'string') return rpcError(m?.id, -32600, 'Invalid request')
  if (isNotification) return null // notifications/initialized, cancelled, ...
  switch (m.method) {
    case 'initialize': {
      const asked = String(m.params?.protocolVersion ?? '')
      return {
        jsonrpc: '2.0', id: m.id,
        result: {
          protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[1],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'metriq', title: 'Metriq', version: '1.0.0' },
          instructions: `${INSTRUCTIONS}\nYou are working as ${u.name}.`,
        },
      }
    }
    case 'ping': return { jsonrpc: '2.0', id: m.id, result: {} }
    case 'tools/list':
    {
      const health = await canSeeHealth(u)
      return { jsonrpc: '2.0', id: m.id, result: { tools: TOOLS.filter((t) => !t.health || health).map(({ run: _run, health: _h, ...t }) => t) } }
    }
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === m.params?.name)
      if (!tool) return rpcError(m.id, -32602, `Unknown tool: ${String(m.params?.name)}`)
      if (tool.health && !(await canSeeHealth(u))) return { jsonrpc: '2.0', id: m.id, result: fail('Only developers and Super Admins can use System Health.') }
      const args = (m.params?.arguments && typeof m.params.arguments === 'object' ? m.params.arguments : {}) as Record<string, unknown>
      try {
        return { jsonrpc: '2.0', id: m.id, result: await tool.run(u, args) }
      } catch (e) {
        console.error('[mcp] tool failed', tool.name, e)
        return { jsonrpc: '2.0', id: m.id, result: fail('Something went wrong in Metriq. Try again, or open the ticket in the app.') }
      }
    }
    default: return rpcError(m.id, -32601, `Method not found: ${m.method}`)
  }
}

/** The person behind a key, or null (unknown, switched off, or the account is no longer active). */
async function userForKey(key: string): Promise<User | null> {
  if (!key.startsWith(KEY_PREFIX) || key.length < 20 || key.length > 100) return null
  const k = await prisma.claudeKey.findUnique({ where: { tokenHash: hashKey(key) }, include: { user: { select: { id: true, role: true, name: true, isActive: true, status: true, companyId: true, company: { select: { status: true } } } } } })
  if (!k || k.revokedAt || k.user.company.status === 'SUSPENDED' || !k.user.isActive || k.user.status !== 'ACTIVE') return null
  if (!k.lastUsedAt || Date.now() - k.lastUsedAt.getTime() > 5 * 60_000) await prisma.claudeKey.update({ where: { id: k.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined)
  return { id: k.user.id, role: k.user.role, name: k.user.name, companyId: k.user.companyId }
}

/** POST /api/mcp/:key — every MCP message. GET / DELETE answer 405 (no server-sent stream, no sessions). */
export async function mcpEndpoint(req: Request, res: Response): Promise<void> {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); res.status(405).json({ error: 'Use POST' }); return }
  const u = await userForKey(String(req.params.key ?? ''))
  if (!u) { res.status(401).json(rpcError(null, -32001, 'This Metriq key is not valid or was switched off. Make a new one in Metriq, under Connectors.')); return }
  const body = req.body as Rpc | Rpc[]
  // Company walls: the connector only ever sees the person's own company.
  if (Array.isArray(body)) {
    const out = (await runAsCompany(u.companyId, () => Promise.all(body.map((m) => handle(u, m))))).filter(Boolean)
    if (!out.length) { res.status(202).end(); return }
    res.json(out)
    return
  }
  const out = await runAsCompany(u.companyId, () => handle(u, body))
  if (!out) { res.status(202).end(); return }
  res.json(out)
}
