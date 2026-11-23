import type { Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { HttpError, loadProjectCtx } from '../lib/pm/access'
import { parse, viewer } from '../lib/pm/http'
import { companyToday, dbDateFromString } from '../lib/time'
import { EVERY, firstOn, recurrenceView, type Every } from '../lib/pm/recurrence'

/**
 * Projects, the extras (plan 2026-11, 2.8): tasks that repeat, "this task waits on that one", and time spent on a
 * task (a timer, or minutes typed in). Same access as the rest of Projects: only people who can open the project.
 */

async function taskCtx(req: AuthedRequest, codeParam = req.params.code) {
  const code = String(codeParam || '').toUpperCase()
  const task = await prisma.pmTask.findFirst({ where: { OR: [{ code }, { id: codeParam }], deletedAt: null }, select: { id: true, code: true, title: true, projectId: true } })
  if (!task) throw new HttpError(404, 'Task not found')
  const ctx = await loadProjectCtx(task.projectId, viewer(req)) // 404s when the project is hidden from the caller
  return { task, ctx }
}

// ------------------------------------------------------------------ repeating tasks

const recurrenceSchema = z.object({
  title: z.string().trim().min(1, 'Give the task a title.').max(200),
  description: z.string().trim().max(4000).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  assigneeIds: z.array(z.string().min(1)).max(20).optional(),
  every: z.enum(EVERY),
  onDay: z.number().int().min(1).max(28).nullable().optional(),
  dueInDays: z.number().int().min(0).max(60).optional(),
  active: z.boolean().optional(),
})

function checkDay(every: Every, onDay: number | null | undefined): number | null {
  if (every === 'DAILY') return null
  if (onDay == null) throw new HttpError(422, every === 'WEEKLY' ? 'Pick the day of the week.' : 'Pick the day of the month.')
  if (every === 'WEEKLY' && onDay > 7) throw new HttpError(422, 'Pick a day of the week.')
  return onDay
}

/** GET /api/projects/:key/recurrences */
export async function listRecurrences(req: AuthedRequest, res: Response): Promise<void> {
  const ctx = await loadProjectCtx(req.params.key, viewer(req))
  const rows = await prisma.pmRecurrence.findMany({ where: { projectId: ctx.project.id }, orderBy: { createdAt: 'asc' } })
  res.json({ recurrences: rows.map(recurrenceView), canManage: ctx.canManage })
}

/** POST /api/projects/:key/recurrences: people who manage the project. */
export async function createRecurrence(req: AuthedRequest, res: Response): Promise<void> {
  const ctx = await loadProjectCtx(req.params.key, viewer(req))
  if (!ctx.canManage) throw new HttpError(403, 'Only people who manage the project set repeating tasks.')
  const b = parse(recurrenceSchema, req.body)
  const onDay = checkDay(b.every, b.onDay)
  const assigneeIds = [...new Set(b.assigneeIds ?? [])]
  const members = await prisma.pmProjectMember.count({ where: { projectId: ctx.project.id, userId: { in: assigneeIds } } })
  if (members !== assigneeIds.length) throw new HttpError(422, 'Give it to people who are in the project.')
  const row = await prisma.pmRecurrence.create({
    data: { projectId: ctx.project.id, title: b.title, description: b.description || null, priority: b.priority ?? 'MEDIUM', assigneeIds, every: b.every, onDay, dueInDays: b.dueInDays ?? 1, nextOn: dbDateFromString(firstOn(b.every, onDay, companyToday())), active: b.active ?? true, createdById: ctx.me.id },
  })
  res.status(201).json({ recurrence: recurrenceView(row) })
}

/** PATCH /api/projects/recurrences/:id */
export async function updateRecurrence(req: AuthedRequest, res: Response): Promise<void> {
  const row = await prisma.pmRecurrence.findUnique({ where: { id: req.params.id } })
  if (!row) throw new HttpError(404, 'Repeating task not found')
  const ctx = await loadProjectCtx(row.projectId, viewer(req))
  if (!ctx.canManage) throw new HttpError(403, 'Only people who manage the project change repeating tasks.')
  const b = parse(recurrenceSchema.partial(), req.body)
  const every = (b.every ?? row.every) as Every
  const onDay = b.every !== undefined || b.onDay !== undefined ? checkDay(every, b.onDay === undefined ? row.onDay : b.onDay) : row.onDay
  const reschedule = b.every !== undefined || b.onDay !== undefined
  const after = await prisma.pmRecurrence.update({
    where: { id: row.id },
    data: {
      ...(b.title !== undefined ? { title: b.title } : {}),
      ...(b.description !== undefined ? { description: b.description || null } : {}),
      ...(b.priority !== undefined ? { priority: b.priority } : {}),
      ...(b.assigneeIds !== undefined ? { assigneeIds: [...new Set(b.assigneeIds)] } : {}),
      ...(b.dueInDays !== undefined ? { dueInDays: b.dueInDays } : {}),
      ...(b.active !== undefined ? { active: b.active } : {}),
      ...(reschedule ? { every, onDay, nextOn: dbDateFromString(firstOn(every, onDay, companyToday())) } : {}),
    },
  })
  res.json({ recurrence: recurrenceView(after) })
}

/** DELETE /api/projects/recurrences/:id (the tasks it already made stay). */
export async function deleteRecurrence(req: AuthedRequest, res: Response): Promise<void> {
  const row = await prisma.pmRecurrence.findUnique({ where: { id: req.params.id } })
  if (!row) throw new HttpError(404, 'Repeating task not found')
  const ctx = await loadProjectCtx(row.projectId, viewer(req))
  if (!ctx.canManage) throw new HttpError(403, 'Only people who manage the project remove repeating tasks.')
  await prisma.pmRecurrence.delete({ where: { id: row.id } })
  res.status(204).end()
}

// ------------------------------------------------------------------ "waits on"

const depCard = { select: { id: true, code: true, title: true, completedAt: true, column: { select: { name: true, category: true } } } } as const
const depView = (t: { id: string; code: string; title: string; completedAt: Date | null; column: { name: string; category: string } }) => ({ id: t.id, code: t.code, title: t.title, status: t.column.name, done: t.column.category === 'DONE' || !!t.completedAt })

/** GET /api/projects/tasks/:code/dependencies: what this task waits on, and what waits on it. */
export async function listDependencies(req: AuthedRequest, res: Response): Promise<void> {
  const { task } = await taskCtx(req)
  const [waitsOn, blocks] = await Promise.all([
    prisma.pmTaskDependency.findMany({ where: { taskId: task.id, blockedBy: { deletedAt: null } }, select: { id: true, blockedBy: depCard } }),
    prisma.pmTaskDependency.findMany({ where: { blockedById: task.id, task: { deletedAt: null } }, select: { id: true, task: depCard } }),
  ])
  const a = waitsOn.map((d) => ({ linkId: d.id, ...depView(d.blockedBy) }))
  res.json({ waitsOn: a, blocks: blocks.map((d) => ({ linkId: d.id, ...depView(d.task) })), blocked: a.some((d) => !d.done) })
}

/** POST /api/projects/tasks/:code/dependencies { on: "RTI-12" }: this task waits on that one (same project). */
export async function addDependency(req: AuthedRequest, res: Response): Promise<void> {
  const { task, ctx } = await taskCtx(req)
  if (!ctx.canContribute) throw new HttpError(403, 'Viewers cannot change tasks')
  const b = parse(z.object({ on: z.string().trim().min(1).max(40) }), req.body)
  const other = await prisma.pmTask.findFirst({ where: { OR: [{ code: b.on.toUpperCase() }, { id: b.on }], deletedAt: null, projectId: task.projectId }, select: { id: true } })
  if (!other) throw new HttpError(404, 'There is no task with that code in this project.')
  if (other.id === task.id) throw new HttpError(422, 'A task cannot wait on itself.')
  // No circles: if the other task already waits (directly or through others) on this one, refuse.
  const seen = new Set<string>([other.id])
  let frontier = [other.id]
  while (frontier.length) {
    const next = await prisma.pmTaskDependency.findMany({ where: { taskId: { in: frontier } }, select: { blockedById: true } })
    frontier = []
    for (const n of next) {
      if (n.blockedById === task.id) throw new HttpError(422, 'That task already waits on this one.')
      if (!seen.has(n.blockedById)) { seen.add(n.blockedById); frontier.push(n.blockedById) }
    }
  }
  await prisma.pmTaskDependency.upsert({ where: { taskId_blockedById: { taskId: task.id, blockedById: other.id } }, update: {}, create: { taskId: task.id, blockedById: other.id } })
  await listDependencies(req, res)
}

/** DELETE /api/projects/dependencies/:id */
export async function removeDependency(req: AuthedRequest, res: Response): Promise<void> {
  const link = await prisma.pmTaskDependency.findUnique({ where: { id: req.params.id }, select: { id: true, task: { select: { projectId: true } } } })
  if (!link) throw new HttpError(404, 'Link not found')
  const ctx = await loadProjectCtx(link.task.projectId, viewer(req))
  if (!ctx.canContribute) throw new HttpError(403, 'Viewers cannot change tasks')
  await prisma.pmTaskDependency.delete({ where: { id: link.id } })
  res.status(204).end()
}

// ------------------------------------------------------------------ time on a task

const minutesBetween = (a: Date, b: Date) => Math.max(1, Math.round((b.getTime() - a.getTime()) / 60000))

/** GET /api/projects/tasks/:code/time: who spent how long, and whether my timer is running here. */
export async function listTime(req: AuthedRequest, res: Response): Promise<void> {
  const { task, ctx } = await taskCtx(req)
  const rows = await prisma.pmTimeEntry.findMany({ where: { taskId: task.id }, include: { user: { select: { id: true, name: true } } }, orderBy: { startedAt: 'desc' }, take: 200 })
  const now = new Date()
  const entries = rows.map((e) => ({ id: e.id, user: e.user.name, mine: e.userId === ctx.me.id, startedAt: e.startedAt.toISOString(), endedAt: e.endedAt?.toISOString() ?? null, minutes: e.endedAt ? e.minutes : minutesBetween(e.startedAt, now), note: e.note ?? '', running: !e.endedAt }))
  res.json({ entries, totalMinutes: entries.reduce((s, e) => s + e.minutes, 0), running: entries.find((e) => e.mine && e.running)?.id ?? null })
}

/** Stop a person's running timer, wherever it is (one timer at a time). */
async function stopRunning(userId: string, now = new Date()): Promise<void> {
  const open = await prisma.pmTimeEntry.findMany({ where: { userId, endedAt: null } })
  for (const e of open) await prisma.pmTimeEntry.update({ where: { id: e.id }, data: { endedAt: now, minutes: minutesBetween(e.startedAt, now) } })
}

/** POST /api/projects/tasks/:code/timer/start: my timer starts here (and stops anywhere else). */
export async function startTimer(req: AuthedRequest, res: Response): Promise<void> {
  const { task, ctx } = await taskCtx(req)
  if (!ctx.canContribute) throw new HttpError(403, 'Viewers cannot log time')
  await stopRunning(ctx.me.id)
  await prisma.pmTimeEntry.create({ data: { taskId: task.id, userId: ctx.me.id, startedAt: new Date() } })
  await listTime(req, res)
}

/** POST /api/projects/tasks/:code/timer/stop { note } */
export async function stopTimer(req: AuthedRequest, res: Response): Promise<void> {
  const { task, ctx } = await taskCtx(req)
  const b = parse(z.object({ note: z.string().trim().max(300).optional() }), req.body ?? {})
  const open = await prisma.pmTimeEntry.findFirst({ where: { taskId: task.id, userId: ctx.me.id, endedAt: null } })
  if (!open) throw new HttpError(409, 'Your timer is not running on this task.')
  const now = new Date()
  await prisma.pmTimeEntry.update({ where: { id: open.id }, data: { endedAt: now, minutes: minutesBetween(open.startedAt, now), note: b.note || null } })
  await listTime(req, res)
}

/** POST /api/projects/tasks/:code/time { minutes, note, date }: time typed in afterwards. */
export async function addTime(req: AuthedRequest, res: Response): Promise<void> {
  const { task, ctx } = await taskCtx(req)
  if (!ctx.canContribute) throw new HttpError(403, 'Viewers cannot log time')
  const b = parse(z.object({ minutes: z.number().int().min(1, 'Give the minutes.').max(24 * 60, 'One entry is at most a day.'), note: z.string().trim().max(300).optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), req.body)
  const end = b.date ? new Date(`${b.date}T12:00:00.000Z`) : new Date()
  await prisma.pmTimeEntry.create({ data: { taskId: task.id, userId: ctx.me.id, startedAt: new Date(end.getTime() - b.minutes * 60000), endedAt: end, minutes: b.minutes, note: b.note || null } })
  await listTime(req, res)
}

/** DELETE /api/projects/time/:id: my own entry (or anyone's, for people who manage the project). */
export async function deleteTime(req: AuthedRequest, res: Response): Promise<void> {
  const e = await prisma.pmTimeEntry.findUnique({ where: { id: req.params.id }, select: { id: true, userId: true, task: { select: { projectId: true } } } })
  if (!e) throw new HttpError(404, 'Entry not found')
  const ctx = await loadProjectCtx(e.task.projectId, viewer(req))
  if (e.userId !== ctx.me.id && !ctx.canManage) throw new HttpError(403, 'That is someone else’s time.')
  await prisma.pmTimeEntry.delete({ where: { id: e.id } })
  res.status(204).end()
}

/** GET /api/projects/me/time?days=7: my timesheet: each day, each task, the minutes. */
export async function myTime(req: AuthedRequest, res: Response): Promise<void> {
  const days = Math.min(92, Math.max(1, Number(req.query.days) || 7))
  const since = new Date(Date.now() - days * 86400_000)
  const rows = await prisma.pmTimeEntry.findMany({ where: { userId: req.user!.id, startedAt: { gte: since } }, include: { task: { select: { code: true, title: true, project: { select: { key: true, name: true } } } } }, orderBy: { startedAt: 'desc' }, take: 1000 })
  const now = new Date()
  const entries = rows.map((e) => ({ id: e.id, day: companyToday(e.startedAt), code: e.task.code, title: e.task.title, project: e.task.project.name, projectKey: e.task.project.key, minutes: e.endedAt ? e.minutes : minutesBetween(e.startedAt, now), running: !e.endedAt, note: e.note ?? '' }))
  res.json({ entries, totalMinutes: entries.reduce((s, e) => s + e.minutes, 0), running: entries.find((e) => e.running) ?? null })
}
