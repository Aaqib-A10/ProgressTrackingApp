import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Request, Response } from 'express'
import type { Role } from '@prisma/client'
import { prisma } from './prisma'
import { invokeAs, invokedError } from './pm/invoke'
import { ticketBrief, fmtWhen, type BriefTask } from './pm/brief'
import * as T from '../controllers/pmTasksController'
import * as P from '../controllers/projectsController'

/**
 * Metriq as a Claude connector (Model Context Protocol, "streamable HTTP", stateless).
 *
 * The person creates a private key in Settings and adds https://<site>/api/mcp/<key> as a
 * custom connector in Claude. Claude can then list the tickets assigned to them, read a ticket
 * (with its files and comments), comment, tick the checklist and move the ticket, always as
 * that person and through the same checks, activity log and notifications as the app.
 */

const APP_URL = () => (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '')
const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']

export const KEY_PREFIX = 'mtq_'
export const hashKey = (key: string) => crypto.createHash('sha256').update(key).digest('hex')
export function newKey(): string { return KEY_PREFIX + crypto.randomBytes(32).toString('base64url') }

type User = { id: string; role: Role; name: string }

const INSTRUCTIONS = `Metriq is the team's work app. Tickets have codes like CMR-6 (project key + number).
To work on someone's tickets: list_my_tickets, then get_ticket for each one. "Where the work lives" in a ticket tells you the folder or repo to change.
When you finish a ticket: add_comment saying what you changed and where (files, links), tick checklist items you completed, then move_ticket to the review column (e.g. "In review").
Never move a ticket to Done unless the person asked you to. Comments and moves appear under the person's own name.
If a ticket needs something you cannot do (a phone call, a decision, a login), comment what is needed instead of guessing.`

// ------------------------------------------------------------------ tools

interface Tool {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: Record<string, boolean>
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
      type Row = { code: string; title: string; status: string; category: string; priority: string; dueAt: string | null; isOverdue: boolean; createdBy: { name: string }; assignees: { name: string }[]; project: { key: string; name: string } }
      let rows = (r.body as { tasks: Row[] }).tasks
      const p = str(a.project)
      if (p) rows = rows.filter((t) => norm(t.project.key) === norm(p) || norm(t.project.name) === norm(p))
      if (!a.include_done) rows = rows.filter((t) => t.category !== 'DONE')
      if (!rows.length) return text(`No ${a.include_done ? '' : 'open '}tickets ${scope === 'assigned' ? 'assigned to you' : 'you gave to others'}${p ? ` in ${p}` : ''}.`)
      const lines = rows.map((t) => `${t.code} | ${t.status} | ${t.priority.toLowerCase()}${t.dueAt ? ` | due ${fmtWhen(t.dueAt)}${t.isOverdue ? ' (OVERDUE)' : ''}` : ''} | ${t.title} | ${scope === 'assigned' ? `from ${t.createdBy.name}` : `to ${t.assignees.map((x) => x.name).join(', ')}`}`)
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
      const project = await prisma.pmProject.findUnique({ where: { key: task.projectKey }, select: { workFolder: true } })
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
      return { jsonrpc: '2.0', id: m.id, result: { tools: TOOLS.map(({ run: _run, ...t }) => t) } }
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === m.params?.name)
      if (!tool) return rpcError(m.id, -32602, `Unknown tool: ${String(m.params?.name)}`)
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
  const k = await prisma.claudeKey.findUnique({ where: { tokenHash: hashKey(key) }, include: { user: { select: { id: true, role: true, name: true, isActive: true, status: true } } } })
  if (!k || k.revokedAt || !k.user.isActive || k.user.status !== 'ACTIVE') return null
  if (!k.lastUsedAt || Date.now() - k.lastUsedAt.getTime() > 5 * 60_000) await prisma.claudeKey.update({ where: { id: k.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined)
  return { id: k.user.id, role: k.user.role, name: k.user.name }
}

/** POST /api/mcp/:key — every MCP message. GET / DELETE answer 405 (no server-sent stream, no sessions). */
export async function mcpEndpoint(req: Request, res: Response): Promise<void> {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); res.status(405).json({ error: 'Use POST' }); return }
  const u = await userForKey(String(req.params.key ?? ''))
  if (!u) { res.status(401).json(rpcError(null, -32001, 'This Metriq key is not valid or was switched off. Make a new one in Metriq Settings.')); return }
  const body = req.body as Rpc | Rpc[]
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handle(u, m)))).filter(Boolean)
    if (!out.length) { res.status(202).end(); return }
    res.json(out)
    return
  }
  const out = await handle(u, body)
  if (!out) { res.status(202).end(); return }
  res.json(out)
}
