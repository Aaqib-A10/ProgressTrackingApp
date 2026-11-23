import type { Response } from 'express'
import { randomBytes } from 'crypto'
import { z } from 'zod'
import { DateTime } from 'luxon'
import type { Role } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { hashPassword, signInviteToken } from '../lib/auth'
import { sendInviteEmail } from '../lib/mail'
import { checkPeopleRoom } from '../lib/plans'
import { recordActivity } from '../lib/audit'
import { sendCsv } from '../lib/csv'
import { companyTz } from '../lib/time'
import { loadProjectCtx } from '../lib/pm/access'
import { viewer } from '../lib/pm/http'
import { logActivity } from '../lib/pm/tasks'
import { RANK_STEP } from '../lib/pm/rank'

/**
 * Imports (plan 2026-11, 2.5): bring a company's people and tasks in from a spreadsheet saved as CSV, so nobody
 * types them one by one. Every import is first checked without saving anything ("dry run"): each row says what will
 * happen or what is wrong with it. Contacts come in through Lead Management's own import.
 */

/** Read CSV text: quoted cells, commas and line breaks inside quotes, "" for a quote. */
export function readCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const s = text.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++ } else quoted = false } else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((x) => x.trim())) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some((x) => x.trim())) rows.push(row)
  return rows
}

/** The rows as objects keyed by the header, whatever its capitals and spaces ("Job Title" → jobtitle). */
export function csvObjects(text: string): { line: number; get: (...names: string[]) => string }[] {
  const rows = readCsv(text)
  if (rows.length < 2) return []
  const head = rows[0].map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''))
  return rows.slice(1).map((r, i) => ({
    line: i + 2,
    get: (...names: string[]) => { for (const n of names) { const at = head.indexOf(n); if (at >= 0 && r[at]?.trim()) return r[at].trim() } return '' },
  }))
}

const bodySchema = z.object({ csv: z.string().min(1, 'The file is empty.').max(2_000_000, 'The file is too big (2 MB at most).'), dryRun: z.boolean().optional(), projectKey: z.string().max(12).optional() })
const MAX_ROWS = 1000
interface RowResult { line: number; ok: boolean; text: string }

const ROLE_WORDS: Record<string, Role> = { member: 'MEMBER', employee: 'MEMBER', staff: 'MEMBER', '': 'MEMBER', lead: 'TEAM_LEAD', teamlead: 'TEAM_LEAD', manager: 'TEAM_LEAD', admin: 'SUPER_ADMIN', superadmin: 'SUPER_ADMIN' }

/** POST /api/import/people { csv, dryRun }: columns name, email, role, team, job title. Admins. */
export async function importPeople(req: AuthedRequest, res: Response): Promise<void> {
  if (req.user!.role !== 'SUPER_ADMIN') { res.status(403).json({ error: 'Only an admin adds people.' }); return }
  const p = bodySchema.safeParse(req.body)
  if (!p.success) { res.status(400).json({ error: p.error.issues[0]?.message ?? 'Check the file.' }); return }
  const rows = csvObjects(p.data.csv)
  if (!rows.length) { res.status(400).json({ error: 'The file needs a first line with the column names (name, email) and at least one person.' }); return }
  if (rows.length > MAX_ROWS) { res.status(400).json({ error: `At most ${MAX_ROWS} people in one file.` }); return }
  const departments = await prisma.department.findMany({ select: { id: true, name: true } })
  const known = new Set((await prisma.user.findMany({ where: { email: { in: rows.map((r) => r.get('email', 'emailaddress').toLowerCase()).filter(Boolean) } }, select: { email: true } })).map((u) => u.email))
  const seen = new Set<string>()
  const results: RowResult[] = []
  const good: { line: number; name: string; email: string; role: Role; departmentId: string | null; team: string; jobTitle: string }[] = []
  for (const r of rows) {
    const name = r.get('name', 'fullname')
    const email = r.get('email', 'emailaddress').toLowerCase()
    const roleWord = r.get('role').toLowerCase().replace(/[^a-z]/g, '')
    const team = r.get('team', 'department')
    const bad = (text: string) => results.push({ line: r.line, ok: false, text })
    if (!name) { bad('No name.'); continue }
    if (!z.string().email().safeParse(email).success) { bad(`"${email || '(empty)'}" is not an email address.`); continue }
    if (known.has(email)) { bad(`${email} is already in Metriq.`); continue }
    if (seen.has(email)) { bad(`${email} is in the file twice.`); continue }
    if (!(roleWord in ROLE_WORDS)) { bad(`Role "${r.get('role')}" is not known. Use member, team lead or admin.`); continue }
    const dept = team ? departments.find((d) => d.name.toLowerCase() === team.toLowerCase()) : null
    if (team && !dept) { bad(`There is no team called "${team}". Make it first, or leave the team empty.`); continue }
    seen.add(email)
    const role = ROLE_WORDS[roleWord]
    good.push({ line: r.line, name, email, role, departmentId: dept?.id ?? null, team: dept?.name ?? '', jobTitle: r.get('jobtitle', 'title', 'position') })
    results.push({ line: r.line, ok: true, text: `${name} (${email}) as ${role === 'SUPER_ADMIN' ? 'admin' : role === 'TEAM_LEAD' ? 'team lead' : 'member'}${dept ? ` in ${dept.name}` : ''}` })
  }
  results.sort((a, b) => a.line - b.line)
  if (p.data.dryRun || !good.length) { res.json({ dryRun: true, made: 0, willMake: good.length, rows: results }); return }
  await checkPeopleRoom(good.length) // the plan's number of people: all or nothing
  const inviter = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { name: true } })
  let made = 0
  for (const g of good) {
    const user = await prisma.user.create({
      data: {
        name: g.name, email: g.email, role: g.role, passwordHash: await hashPassword(randomBytes(12).toString('base64url')), departmentId: g.departmentId,
        ...(g.departmentId ? { memberships: { create: { departmentId: g.departmentId, role: g.role } } } : {}),
        ...(g.jobTitle ? { personRecord: { create: { jobTitle: g.jobTitle } } } : {}),
      },
    })
    // Each person gets a link to choose their own password; no password is shown or kept anywhere.
    void sendInviteEmail({ to: user.email, name: user.name, token: signInviteToken(user.id), inviterName: inviter?.name }).catch(() => undefined)
    made++
  }
  await recordActivity(req.user!.id, 'CREATE', 'User', 'import', { after: { summary: `Imported ${made} ${made === 1 ? 'person' : 'people'} from a file` } })
  res.status(201).json({ dryRun: false, made, willMake: 0, rows: results })
}

const PRIORITY: Record<string, 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'> = { '': 'MEDIUM', low: 'LOW', medium: 'MEDIUM', normal: 'MEDIUM', high: 'HIGH', urgent: 'URGENT' }

/** POST /api/import/tasks { csv, projectKey, dryRun }: columns title, description, assignee (email), due, priority. */
export async function importTasks(req: AuthedRequest, res: Response): Promise<void> {
  const p = bodySchema.safeParse(req.body)
  if (!p.success || !p.data.projectKey) { res.status(400).json({ error: p.success ? 'Pick the project the tasks go into.' : p.error.issues[0]?.message ?? 'Check the file.' }); return }
  let ctx
  try { ctx = await loadProjectCtx(p.data.projectKey, viewer(req)) } catch { res.status(404).json({ error: 'Project not found' }); return }
  if (!ctx.canContribute) { res.status(403).json({ error: 'You cannot add tasks to this project.' }); return }
  if (ctx.project.status !== 'ACTIVE') { res.status(409).json({ error: 'This project is archived.' }); return }
  const rows = csvObjects(p.data.csv)
  if (!rows.length) { res.status(400).json({ error: 'The file needs a first line with the column names (title) and at least one task.' }); return }
  if (rows.length > MAX_ROWS) { res.status(400).json({ error: `At most ${MAX_ROWS} tasks in one file.` }); return }
  const members = await prisma.pmProjectMember.findMany({ where: { projectId: ctx.project.id }, select: { userId: true, user: { select: { email: true, name: true } } } })
  const zone = companyTz()
  const results: RowResult[] = []
  const good: { title: string; description: string; assigneeId: string | null; dueAt: Date | null; priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' }[] = []
  for (const r of rows) {
    const title = r.get('title', 'task', 'name')
    const who = r.get('assignee', 'assignedto', 'email', 'owner').toLowerCase()
    const due = r.get('due', 'duedate', 'deadline')
    const prio = r.get('priority').toLowerCase()
    const bad = (text: string) => results.push({ line: r.line, ok: false, text })
    if (!title) { bad('No title.'); continue }
    if (title.length > 200) { bad('The title is longer than 200 characters.'); continue }
    const member = who ? members.find((m) => m.user.email.toLowerCase() === who || m.user.name.toLowerCase() === who) : null
    if (who && !member) { bad(`"${who}" is not in this project. Add them to the project, or leave the assignee empty.`); continue }
    const day = due ? DateTime.fromISO(due, { zone }) : null
    if (day && !day.isValid) { bad(`"${due}" is not a date. Write it as 2026-12-31.`); continue }
    if (!(prio in PRIORITY)) { bad(`Priority "${prio}" is not known. Use low, medium, high or urgent.`); continue }
    good.push({ title, description: r.get('description', 'details', 'notes'), assigneeId: member?.userId ?? null, dueAt: day ? day.endOf('day').toJSDate() : null, priority: PRIORITY[prio] })
    results.push({ line: r.line, ok: true, text: `${title}${member ? `, for ${member.user.name}` : ''}${day ? `, due ${day.toISODate()}` : ''}` })
  }
  if (p.data.dryRun || !good.length) { res.json({ dryRun: true, made: 0, willMake: good.length, rows: results }); return }
  const column = (await prisma.pmColumn.findFirst({ where: { projectId: ctx.project.id, isDefault: true } })) ?? (await prisma.pmColumn.findFirst({ where: { projectId: ctx.project.id, category: 'TODO' }, orderBy: { position: 'asc' } }))
  if (!column) { res.status(409).json({ error: 'This board has no column to put new tasks in.' }); return }
  let made = 0
  for (const g of good) {
    await prisma.$transaction(async (tx) => {
      const pr = await tx.pmProject.update({ where: { id: ctx.project.id }, data: { taskCounter: { increment: 1 } }, select: { taskCounter: true, key: true } })
      const max = await tx.pmTask.aggregate({ where: { columnId: column.id, deletedAt: null }, _max: { position: true } })
      const t = await tx.pmTask.create({
        data: {
          projectId: ctx.project.id, code: `${pr.key}-${pr.taskCounter}`, title: g.title, description: g.description || null, columnId: column.id,
          position: (max._max.position ?? 0) + RANK_STEP, priority: g.priority, createdById: ctx.me.id, dueAt: g.dueAt,
          assignees: { create: g.assigneeId ? [{ userId: g.assigneeId, assignedById: ctx.me.id }] : [] },
          watchers: { create: [...new Set([ctx.me.id, ...(g.assigneeId ? [g.assigneeId] : [])])].map((userId) => ({ userId })) },
        },
      })
      await logActivity(t.id, ctx.me.id, 'created', { column: column.name, imported: true }, tx)
    })
    made++
  }
  // One notification per person for the whole file, not one per task.
  const perPerson = new Map<string, number>()
  for (const g of good) if (g.assigneeId && g.assigneeId !== ctx.me.id) perPerson.set(g.assigneeId, (perPerson.get(g.assigneeId) ?? 0) + 1)
  if (perPerson.size) await prisma.notification.createMany({ data: [...perPerson].map(([userId, n]) => ({ userId, actorId: ctx.me.id, type: 'TASK_ASSIGNED' as const, title: `${n} new task${n === 1 ? '' : 's'} for you in ${ctx.project.name}`, body: 'They were brought in from a file.', link: `/app/projects/${ctx.project.key}` })) })
  await recordActivity(ctx.me.id, 'CREATE', 'PmTask', 'import', { after: { summary: `Imported ${made} task${made === 1 ? '' : 's'} into ${ctx.project.name} from a file` } })
  res.status(201).json({ dryRun: false, made, willMake: 0, rows: results })
}

/** GET /api/import/template/:what: an example file with the right columns. */
export async function importTemplate(req: AuthedRequest, res: Response): Promise<void> {
  if (req.params.what === 'people') { sendCsv(res, 'metriq-people.csv', [['name', 'email', 'role', 'team', 'job title'], ['Sara Khan', 'sara@example.com', 'member', '', 'Sales executive'], ['Omar Ali', 'omar@example.com', 'team lead', '', 'Sales manager']]); return }
  if (req.params.what === 'tasks') { sendCsv(res, 'metriq-tasks.csv', [['title', 'description', 'assignee', 'due', 'priority'], ['Call the supplier', 'Ask for the new price list', 'sara@example.com', '2026-12-15', 'high'], ['Update the price sheet', '', '', '', 'medium']]); return }
  res.status(404).json({ error: 'There is no template for that.' })
}
