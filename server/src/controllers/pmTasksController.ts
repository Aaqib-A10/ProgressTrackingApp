import type { Response } from 'express'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { PmColumnCategory, Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import {
  HttpError,
  canChangeDue,
  canDecideExtension,
  canDeleteTask,
  canEditTask,
  loadProjectCtx,
  projectAdminIds,
  projectMemberIds,
  visibleProjectIds,
  type ProjectCtx,
} from '../lib/pm/access'
import { parse, viewer } from '../lib/pm/http'
import { needsRebalance, rankBetween, RANK_STEP } from '../lib/pm/rank'
import { CARD_INCLUDE, clearOverdueIfResolved, isTaskOverdue, logActivity, rebalanceColumn, serializeCard } from '../lib/pm/tasks'
import { fmtDue, pmNotify, taskLink, trunc } from '../lib/pm/pmNotify'

/**
 * Tasks inside a project: create/edit/move/delete, assignees, comments,
 * checklist, attachments, activity log, due date extensions and "my tasks".
 * Every handler resolves the task's project and re-checks the caller's
 * permission there (see lib/pm/access.ts).
 */

const UPLOAD_DIR = path.resolve('uploads', 'projects')
const MAX_BYTES = 25 * 1024 * 1024
const BLOCKED_EXT = new Set(['exe', 'bat', 'cmd', 'com', 'msi', 'scr', 'sh', 'ps1', 'vbs', 'js', 'mjs', 'cjs', 'jar', 'apk', 'app', 'html', 'htm', 'svg'])

const priorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
const isoDate = z.string().datetime({ offset: true }).or(z.string().datetime())
const optDate = isoDate.nullable().optional()

const toDate = (v: string | null | undefined) => (v == null ? (v as null | undefined) : new Date(v))
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

async function loadTaskCtx(req: AuthedRequest, codeParam = req.params.code) {
  const me = viewer(req)
  const code = String(codeParam || '').toUpperCase()
  const task = await prisma.pmTask.findFirst({
    where: { OR: [{ code }, { id: codeParam }], deletedAt: null },
    include: { assignees: { select: { userId: true } }, column: { select: { id: true, name: true, category: true } } },
  })
  if (!task) throw new HttpError(404, 'Task not found')
  const ctx = await loadProjectCtx(task.projectId, me) // 404s if the project is hidden from the caller
  return { task, ctx }
}

async function cardById(id: string) {
  const t = await prisma.pmTask.findUniqueOrThrow({ where: { id }, include: CARD_INCLUDE })
  return serializeCard(t)
}

async function assertMembers(ctx: ProjectCtx, userIds: string[]): Promise<void> {
  if (!userIds.length) return
  const members = await projectMemberIds(ctx.project.id)
  const bad = userIds.filter((id) => !members.has(id))
  if (bad.length) throw new HttpError(422, 'Tasks can only be assigned to members of this project')
}

async function userName(id: string): Promise<string> {
  return (await prisma.user.findUnique({ where: { id }, select: { name: true } }))?.name ?? 'Someone'
}

function notifyAssigned(ctx: ProjectCtx, taskId: string, code: string, title: string, dueAt: Date | null, userIds: string[], actorName: string) {
  const due = dueAt ? ` Due ${fmtDue(dueAt)}.` : ''
  return pmNotify({
    userIds,
    actorId: ctx.me.id,
    type: 'TASK_ASSIGNED',
    title: `${actorName} assigned you ${code}`,
    body: `${trunc(title)}.${due}`,
    link: taskLink(ctx.project.key, code),
    taskId,
    email: {
      pref: 'emailAssigned',
      subject: `New task assigned to you: ${code} ${trunc(title, 60)}`,
      heading: `New task in ${ctx.project.name}`,
      lines: [`${actorName} assigned you ${code} "${title}".`, dueAt ? `It is due on ${fmtDue(dueAt)}.` : 'It has no due date yet.'],
      cta: 'Open the task',
    },
  })
}

// ---------- Create ----------

const createSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(255),
  description: z.string().max(20000).nullable().optional(),
  columnId: z.string().optional(),
  assigneeIds: z.array(z.string()).max(20).optional(),
  priority: priorityEnum.optional(),
  startAt: optDate,
  dueAt: optDate,
  estimateHours: z.number().min(0).max(10000).nullable().optional(),
  labelIds: z.array(z.string()).max(20).optional(),
  checklist: z.array(z.string().trim().min(1).max(300)).max(50).optional(),
})

/** POST /api/projects/:key/tasks */
export async function createTask(req: AuthedRequest, res: Response): Promise<void> {
  const ctx = await loadProjectCtx(req.params.key, viewer(req))
  if (!ctx.canContribute) throw new HttpError(403, 'Viewers cannot create tasks')
  if (ctx.project.status !== 'ACTIVE') throw new HttpError(422, 'This project is archived')
  const body = parse(createSchema, req.body)
  assertDateRange(toDate(body.startAt) ?? null, toDate(body.dueAt) ?? null)
  const assigneeIds = [...new Set(body.assigneeIds ?? [])]
  await assertMembers(ctx, assigneeIds)

  const column = body.columnId
    ? await prisma.pmColumn.findFirst({ where: { id: body.columnId, projectId: ctx.project.id } })
    : (await prisma.pmColumn.findFirst({ where: { projectId: ctx.project.id, isDefault: true } })) ??
      (await prisma.pmColumn.findFirst({ where: { projectId: ctx.project.id, category: 'TODO' }, orderBy: { position: 'asc' } }))
  if (!column) throw new HttpError(422, 'Column not found on this board')
  const labelIds = body.labelIds?.length
    ? (await prisma.pmLabel.findMany({ where: { id: { in: body.labelIds }, projectId: ctx.project.id }, select: { id: true } })).map((l) => l.id)
    : []

  const task = await prisma.$transaction(async (tx) => {
    // Atomic counter → unique, gap-free-enough codes even under concurrent creates.
    const p = await tx.pmProject.update({ where: { id: ctx.project.id }, data: { taskCounter: { increment: 1 } }, select: { taskCounter: true, key: true } })
    const max = await tx.pmTask.aggregate({ where: { columnId: column.id, deletedAt: null }, _max: { position: true } })
    const t = await tx.pmTask.create({
      data: {
        projectId: ctx.project.id,
        code: `${p.key}-${p.taskCounter}`,
        title: body.title,
        description: body.description ?? null,
        columnId: column.id,
        position: (max._max.position ?? 0) + RANK_STEP,
        priority: body.priority ?? 'MEDIUM',
        createdById: ctx.me.id,
        startAt: toDate(body.startAt) ?? null,
        dueAt: toDate(body.dueAt) ?? null,
        estimateHours: body.estimateHours ?? null,
        completedAt: column.category === 'DONE' ? new Date() : null,
        assignees: { create: assigneeIds.map((userId) => ({ userId, assignedById: ctx.me.id })) },
        watchers: { create: [...new Set([ctx.me.id, ...assigneeIds])].map((userId) => ({ userId })) },
        labels: { create: labelIds.map((labelId) => ({ labelId })) },
        checklist: { create: (body.checklist ?? []).map((text, i) => ({ text, position: i })) },
      },
    })
    await logActivity(t.id, ctx.me.id, 'created', { column: column.name }, tx)
    if (assigneeIds.length) await logActivity(t.id, ctx.me.id, 'assigned', { userIds: assigneeIds }, tx)
    return t
  })

  const actorName = await userName(ctx.me.id)
  await notifyAssigned(ctx, task.id, task.code, task.title, task.dueAt, assigneeIds, actorName)
  res.status(201).json({ task: await cardById(task.id) })
}

// ---------- Read ----------

/** GET /api/projects/tasks/:code — full detail for the drawer. */
export async function getTask(req: AuthedRequest, res: Response): Promise<void> {
  const { task, ctx } = await loadTaskCtx(req)
  const full = await prisma.pmTask.findUniqueOrThrow({
    where: { id: task.id },
    include: {
      ...CARD_INCLUDE,
      watchers: { include: { user: { select: { id: true, name: true } } } },
      checklist: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
      comments: { where: { deletedAt: null }, include: { author: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } },
      reviews: { where: { deletedAt: null }, include: { reviewer: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' } },
      attachments: { include: { uploadedBy: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } },
      extensionRequests: { include: { requestedBy: { select: { id: true, name: true } }, decidedBy: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' } },
    },
  })
  const card = serializeCard(full as unknown as Parameters<typeof serializeCard>[0])
  const isAssignee = task.assignees.some((a) => a.userId === ctx.me.id)
  res.json({
    task: {
      ...card,
      projectKey: ctx.project.key,
      projectName: ctx.project.name,
      description: full.description,
      estimateHours: full.estimateHours,
      overdueSince: iso(full.overdueSince),
      watchers: full.watchers.map((w) => w.user),
      checklist: full.checklist.map((c) => ({ id: c.id, text: c.text, isDone: c.isDone, position: c.position })),
      comments: full.comments.map((c) => ({ id: c.id, body: c.body, mentions: c.mentions, author: c.author, createdAt: c.createdAt.toISOString(), editedAt: iso(c.editedAt) })),
      reviews: full.reviews.map(serializeReview),
      attachments: full.attachments.map((a) => ({ id: a.id, originalName: a.originalName, mimeType: a.mimeType, size: a.size, uploadedBy: a.uploadedBy, createdAt: a.createdAt.toISOString(), downloadUrl: `/api/projects/attachments/${a.id}/download` })),
      extensionRequests: full.extensionRequests.map((e) => ({
        id: e.id,
        status: e.status,
        reason: e.reason,
        currentDueAt: iso(e.currentDueAt),
        requestedDueAt: e.requestedDueAt.toISOString(),
        requestedBy: e.requestedBy,
        decidedBy: e.decidedBy,
        decidedAt: iso(e.decidedAt),
        decisionNote: e.decisionNote,
        createdAt: e.createdAt.toISOString(),
      })),
    },
    perms: {
      canEdit: canEditTask(ctx, task),
      canChangeDue: canChangeDue(ctx, task),
      canDelete: canDeleteTask(ctx, task),
      canMove: ctx.canContribute,
      canComment: true,
      canDecideExtension: canDecideExtension(ctx, task),
      canRequestExtension: isAssignee && !!task.dueAt && task.column.category !== 'DONE',
      isAssignee,
    },
  })
}

/** GET /api/projects/tasks/:code/activity */
export async function getActivity(req: AuthedRequest, res: Response): Promise<void> {
  const { task } = await loadTaskCtx(req)
  const rows = await prisma.pmActivity.findMany({ where: { taskId: task.id }, include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' }, take: 200 })
  res.json({ activity: rows.map((r) => ({ id: r.id, action: r.action, meta: r.meta, user: r.user, createdAt: r.createdAt.toISOString() })) })
}

// ---------- Update ----------

const updateSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  description: z.string().max(20000).nullable().optional(),
  priority: priorityEnum.optional(),
  startAt: optDate,
  dueAt: optDate,
  estimateHours: z.number().min(0).max(10000).nullable().optional(),
  labelIds: z.array(z.string()).max(20).optional(),
  assigneeIds: z.array(z.string()).max(20).optional(),
  columnId: z.string().optional(),
})

/** PATCH /api/projects/tasks/:code */
export async function updateTask(req: AuthedRequest, res: Response): Promise<void> {
  const { task, ctx } = await loadTaskCtx(req)
  const body = parse(updateSchema, req.body)
  const editsFields = ['title', 'description', 'priority', 'startAt', 'estimateHours', 'labelIds', 'assigneeIds'].some((k) => k in body)
  if (editsFields && !canEditTask(ctx, task)) throw new HttpError(403, 'You can only edit tasks you created or are assigned to')
  if ('dueAt' in body && !canChangeDue(ctx, task)) throw new HttpError(403, 'Only the person who assigned this task or a project admin can change the due date')
  if (body.columnId && !ctx.canContribute) throw new HttpError(403, 'Viewers cannot move tasks')

  assertDateRange(
    body.startAt !== undefined ? toDate(body.startAt) ?? null : task.startAt,
    body.dueAt !== undefined ? toDate(body.dueAt) ?? null : task.dueAt,
  )
  const data: Prisma.PmTaskUpdateInput = {}
  const acts: { action: string; meta: Prisma.InputJsonValue }[] = []
  if (body.title !== undefined && body.title !== task.title) { data.title = body.title; acts.push({ action: 'title_changed', meta: { from: task.title, to: body.title } }) }
  if (body.description !== undefined && body.description !== task.description) { data.description = body.description; acts.push({ action: 'description_changed', meta: {} }) }
  if (body.priority && body.priority !== task.priority) { data.priority = body.priority; acts.push({ action: 'priority_changed', meta: { from: task.priority, to: body.priority } }) }
  if (body.startAt !== undefined) data.startAt = toDate(body.startAt) ?? null
  if (body.estimateHours !== undefined) data.estimateHours = body.estimateHours
  let dueChanged = false
  if (body.dueAt !== undefined) {
    const next = toDate(body.dueAt) ?? null
    if ((next?.getTime() ?? null) !== (task.dueAt?.getTime() ?? null)) {
      data.dueAt = next
      dueChanged = true
      acts.push({ action: 'due_changed', meta: { from: iso(task.dueAt), to: iso(next) } })
    }
  }

  // Assignee diff
  let added: string[] = []
  let removed: string[] = []
  if (body.assigneeIds) {
    const want = [...new Set(body.assigneeIds)]
    await assertMembers(ctx, want)
    const have = task.assignees.map((a) => a.userId)
    added = want.filter((id) => !have.includes(id))
    removed = have.filter((id) => !want.includes(id))
    if (added.length) acts.push({ action: 'assigned', meta: { userIds: added } })
    if (removed.length) acts.push({ action: 'unassigned', meta: { userIds: removed } })
  }

  // Labels
  let labelIds: string[] | null = null
  if (body.labelIds) {
    labelIds = (await prisma.pmLabel.findMany({ where: { id: { in: body.labelIds }, projectId: ctx.project.id }, select: { id: true } })).map((l) => l.id)
  }

  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length) await tx.pmTask.update({ where: { id: task.id }, data })
    if (added.length) {
      await tx.pmTaskAssignee.createMany({ data: added.map((userId) => ({ taskId: task.id, userId, assignedById: ctx.me.id })), skipDuplicates: true })
      await tx.pmTaskWatcher.createMany({ data: added.map((userId) => ({ taskId: task.id, userId })), skipDuplicates: true })
    }
    if (removed.length) await tx.pmTaskAssignee.deleteMany({ where: { taskId: task.id, userId: { in: removed } } })
    if (labelIds) {
      const before = (await tx.pmTaskLabel.findMany({ where: { taskId: task.id } })).map((l) => l.labelId)
      await tx.pmTaskLabel.deleteMany({ where: { taskId: task.id } })
      if (labelIds.length) await tx.pmTaskLabel.createMany({ data: labelIds.map((labelId) => ({ taskId: task.id, labelId })) })
      const plus = labelIds.filter((x) => !before.includes(x))
      const minus = before.filter((x) => !labelIds!.includes(x))
      if (plus.length) acts.push({ action: 'label_added', meta: { labelIds: plus } })
      if (minus.length) acts.push({ action: 'label_removed', meta: { labelIds: minus } })
    }
    for (const a of acts) await logActivity(task.id, ctx.me.id, a.action, a.meta, tx)
    if (dueChanged) await clearOverdueIfResolved(task.id, tx)
  })

  if (body.columnId && body.columnId !== task.columnId) {
    await moveTaskTo(ctx, task.id, body.columnId, null, null)
  }

  const actorName = await userName(ctx.me.id)
  const fresh = await prisma.pmTask.findUniqueOrThrow({ where: { id: task.id }, include: { assignees: true } })
  if (added.length) await notifyAssigned(ctx, task.id, task.code, fresh.title, fresh.dueAt, added, actorName)
  if (removed.length) {
    await pmNotify({ userIds: removed, actorId: ctx.me.id, type: 'TASK_UNASSIGNED', title: `${actorName} unassigned you from ${task.code}`, body: trunc(fresh.title), link: taskLink(ctx.project.key, task.code), taskId: task.id })
  }
  if (dueChanged) {
    const others = fresh.assignees.map((a) => a.userId).filter((id) => !added.includes(id))
    await pmNotify({
      userIds: others,
      actorId: ctx.me.id,
      type: 'TASK_DUE_CHANGED',
      title: `Due date changed on ${task.code}`,
      body: fresh.dueAt ? `${trunc(fresh.title)} is now due ${fmtDue(fresh.dueAt)}` : `${trunc(fresh.title)} no longer has a due date`,
      link: taskLink(ctx.project.key, task.code),
      taskId: task.id,
    })
  }
  res.json({ task: await cardById(task.id) })
}

// ---------- Move (drag and drop) ----------

const moveSchema = z.object({
  columnId: z.string(),
  /** Card directly ABOVE the drop spot (null = dropped at the top). */
  beforeTaskId: z.string().nullable().optional(),
  /** Card directly BELOW the drop spot (null = dropped at the bottom). */
  afterTaskId: z.string().nullable().optional(),
})

/** PATCH /api/projects/tasks/:code/move */
export async function moveTask(req: AuthedRequest, res: Response): Promise<void> {
  const { task, ctx } = await loadTaskCtx(req)
  if (!ctx.canContribute) throw new HttpError(403, 'Viewers cannot move tasks')
  const body = parse(moveSchema, req.body)
  await moveTaskTo(ctx, task.id, body.columnId, body.beforeTaskId ?? null, body.afterTaskId ?? null)
  res.json({ task: await cardById(task.id) })
}

async function moveTaskTo(ctx: ProjectCtx, taskId: string, columnId: string, beforeId: string | null, afterId: string | null): Promise<void> {
  const target = await prisma.pmColumn.findFirst({ where: { id: columnId, projectId: ctx.project.id } })
  if (!target) throw new HttpError(422, 'Column not found on this board')
  const neighbours = await prisma.pmTask.findMany({
    where: { id: { in: [beforeId, afterId].filter((x): x is string => !!x) }, columnId: target.id, deletedAt: null },
    select: { id: true, position: true },
  })
  const before = neighbours.find((n) => n.id === beforeId)?.position
  const after = neighbours.find((n) => n.id === afterId)?.position
  let position: number
  if (before === undefined && after === undefined) {
    // No neighbours given (status dropdown) → bottom of the column.
    const max = await prisma.pmTask.aggregate({ where: { columnId: target.id, deletedAt: null, id: { not: taskId } }, _max: { position: true } })
    position = (max._max.position ?? 0) + RANK_STEP
  } else {
    position = rankBetween(before ?? null, after ?? null)
  }

  const prev = await prisma.pmTask.findUniqueOrThrow({ where: { id: taskId }, include: { column: true, assignees: true } })
  const fromCat = prev.column.category
  const toCat = target.category
  const columnChanged = prev.columnId !== target.id

  await prisma.$transaction(async (tx) => {
    const data: Prisma.PmTaskUncheckedUpdateInput = { columnId: target.id, position }
    if (toCat === 'DONE' && fromCat !== 'DONE') Object.assign(data, { completedAt: new Date(), isOverdue: false, overdueSince: null, lastOverdueNotifiedAt: null })
    if (toCat !== 'DONE' && fromCat === 'DONE') data.completedAt = null
    await tx.pmTask.update({ where: { id: taskId }, data })
    if (columnChanged) {
      await logActivity(taskId, ctx.me.id, 'status_changed', { from: prev.column.name, to: target.name }, tx)
      if (toCat === 'DONE' && fromCat !== 'DONE') await logActivity(taskId, ctx.me.id, 'completed', {}, tx)
      if (toCat !== 'DONE' && fromCat === 'DONE') await logActivity(taskId, ctx.me.id, 'reopened', {}, tx)
    }
  })
  if (needsRebalance(before, after)) await rebalanceColumn(target.id)
  if (!columnChanged) return

  const actorName = await userName(ctx.me.id)
  const link = taskLink(ctx.project.key, prev.code)
  const watchers = (await prisma.pmTaskWatcher.findMany({ where: { taskId }, select: { userId: true } })).map((w) => w.userId)
  if (toCat === 'DONE' && fromCat !== 'DONE') {
    const admins = await projectAdminIds(ctx.project.id)
    const completedFor = [prev.createdById, ...admins]
    await pmNotify({ userIds: completedFor, actorId: ctx.me.id, type: 'TASK_COMPLETED', title: `${prev.code} completed`, body: `${actorName} moved "${trunc(prev.title, 60)}" to ${target.name}`, link, taskId })
    await pmNotify({ userIds: watchers.filter((w) => !completedFor.includes(w)), actorId: ctx.me.id, type: 'TASK_STATUS_CHANGED', title: `${prev.code} moved to ${target.name}`, body: trunc(prev.title), link, taskId })
  } else {
    await pmNotify({ userIds: watchers, actorId: ctx.me.id, type: 'TASK_STATUS_CHANGED', title: `${prev.code} moved to ${target.name}`, body: `${actorName}: ${trunc(prev.title, 60)}`, link, taskId })
  }
}

// ---------- Delete ----------

export async function deleteTask(req: AuthedRequest, res: Response): Promise<void> {
  const { task, ctx } = await loadTaskCtx(req)
  if (!canDeleteTask(ctx, task)) throw new HttpError(403, 'You cannot delete this task')
  await prisma.pmTask.update({ where: { id: task.id }, data: { deletedAt: new Date(), isOverdue: false } })
  await logActivity(task.id, ctx.me.id, 'deleted')
  res.status(204).end()
}

// ---------- Watchers ----------

export async function watchTask(req: AuthedRequest, res: Response): Promise<void> {
  const { task, ctx } = await loadTaskCtx(req)
  await prisma.pmTaskWatcher.upsert({ where: { taskId_userId: { taskId: task.id, userId: ctx.me.id } }, create: { taskId: task.id, userId: ctx.me.id }, update: {} })
  res.json({ watching: true })
}

export async function unwatchTask(req: AuthedRequest, res: Response): Promise<void> {
  const { task, ctx } = await loadTaskCtx(req)
  await prisma.pmTaskWatcher.deleteMany({ where: { taskId: task.id, userId: ctx.me.id } })
  res.json({ watching: false })
}

// ---------- Comments ----------

const commentSchema = z.object({ body: z.string().trim().min(1).max(5000), mentions: z.array(z.string()).max(30).optional() })

/** POST /api/projects/tasks/:code/comments — any project member (viewers too). */
export async function addComment(req: AuthedRequest, res: Response): Promise<void> {
  const { task, ctx } = await loadTaskCtx(req)
  const body = parse(commentSchema, req.body)
  const members = await projectMemberIds(ctx.project.id)
  // "@all" (or "@everyone") mentions every member of the project except the author.
  const mentions = /(^|\s)@(all|everyone)\b/i.test(body.body)
    ? [...members].filter((id) => id !== ctx.me.id)
    : [...new Set(body.mentions ?? [])].filter((id) => members.has(id))
  const c = await prisma.$transaction(async (tx) => {
    const row = await tx.pmComment.create({ data: { taskId: task.id, authorId: ctx.me.id, body: body.body, mentions }, include: { author: { select: { id: true, name: true } } } })
    await tx.pmTaskWatcher.createMany({ data: [{ taskId: task.id, userId: ctx.me.id }], skipDuplicates: true })
    await logActivity(task.id, ctx.me.id, 'comment_added', { commentId: row.id }, tx)
    await tx.pmTask.update({ where: { id: task.id }, data: { updatedAt: new Date() } })
    return row
  })
  const actorName = c.author.name
  const link = taskLink(ctx.project.key, task.code)
  await pmNotify({
    userIds: mentions,
    actorId: ctx.me.id,
    type: 'MENTION',
    title: `${actorName} mentioned you on ${task.code}`,
    body: trunc(body.body, 100),
    link,
    taskId: task.id,
    email: { pref: 'emailMention', subject: `${actorName} mentioned you on ${task.code}`, heading: `You were mentioned on ${task.code}`, lines: [`${actorName} wrote on "${task.title}":`, `"${trunc(body.body, 400)}"`], cta: 'Reply on the task' },
  })
  const watchers = (await prisma.pmTaskWatcher.findMany({ where: { taskId: task.id }, select: { userId: true } })).map((w) => w.userId).filter((id) => !mentions.includes(id))
  await pmNotify({
    userIds: watchers,
    actorId: ctx.me.id,
    type: 'TASK_COMMENT',
    title: `${actorName} commented on ${task.code}`,
    body: trunc(body.body, 100),
    link,
    taskId: task.id,
    email: { pref: 'emailComment', subject: `New comment on ${task.code}`, heading: `New comment on ${task.code}`, lines: [`${actorName} commented on "${task.title}":`, `"${trunc(body.body, 400)}"`], cta: 'Open the task' },
  })
  res.status(201).json({ comment: { id: c.id, body: c.body, mentions: c.mentions, author: c.author, createdAt: c.createdAt.toISOString(), editedAt: null } })
}

async function loadComment(req: AuthedRequest) {
  const c = await prisma.pmComment.findUnique({ where: { id: req.params.id }, include: { task: true } })
  if (!c || c.deletedAt || c.task.deletedAt) throw new HttpError(404, 'Comment not found')
  const ctx = await loadProjectCtx(c.task.projectId, viewer(req))
  return { c, ctx }
}

export async function editComment(req: AuthedRequest, res: Response): Promise<void> {
  const { c, ctx } = await loadComment(req)
  if (c.authorId !== ctx.me.id) throw new HttpError(403, 'You can only edit your own comments')
  const body = parse(commentSchema, req.body)
  const row = await prisma.pmComment.update({ where: { id: c.id }, data: { body: body.body, editedAt: new Date() }, include: { author: { select: { id: true, name: true } } } })
  res.json({ comment: { id: row.id, body: row.body, mentions: row.mentions, author: row.author, createdAt: row.createdAt.toISOString(), editedAt: iso(row.editedAt) } })
}

export async function deleteComment(req: AuthedRequest, res: Response): Promise<void> {
  const { c, ctx } = await loadComment(req)
  if (c.authorId !== ctx.me.id && !ctx.canManage) throw new HttpError(403, 'You can only delete your own comments')
  await prisma.pmComment.update({ where: { id: c.id }, data: { deletedAt: new Date() } })
  res.status(204).end()
}

// ---------- Checklist ----------

export async function addChecklistItem(req: AuthedRequest, res: Response): Promise<void> {
  const { task, ctx } = await loadTaskCtx(req)
  if (!canEditTask(ctx, task)) throw new HttpError(403, 'You cannot edit this task')
  const { text } = parse(z.object({ text: z.string().trim().min(1).max(300) }), req.body)
  const max = await prisma.pmChecklistItem.aggregate({ where: { taskId: task.id }, _max: { position: true } })
  const item = await prisma.pmChecklistItem.create({ data: { taskId: task.id, text, position: (max._max.position ?? -1) + 1 } })
  await logActivity(task.id, ctx.me.id, 'checklist_updated', { added: text })
  res.status(201).json({ item: { id: item.id, text: item.text, isDone: item.isDone, position: item.position } })
}

async function loadChecklistItem(req: AuthedRequest) {
  const item = await prisma.pmChecklistItem.findUnique({ where: { id: req.params.id }, include: { task: { include: { assignees: { select: { userId: true } }, column: { select: { category: true } } } } } })
  if (!item || item.task.deletedAt) throw new HttpError(404, 'Checklist item not found')
  const ctx = await loadProjectCtx(item.task.projectId, viewer(req))
  if (!canEditTask(ctx, item.task)) throw new HttpError(403, 'You cannot edit this task')
  return { item, ctx }
}

export async function updateChecklistItem(req: AuthedRequest, res: Response): Promise<void> {
  const { item, ctx } = await loadChecklistItem(req)
  const body = parse(z.object({ text: z.string().trim().min(1).max(300).optional(), isDone: z.boolean().optional() }), req.body)
  const row = await prisma.pmChecklistItem.update({
    where: { id: item.id },
    data: { ...body, ...(body.isDone !== undefined ? { doneById: body.isDone ? ctx.me.id : null, doneAt: body.isDone ? new Date() : null } : {}) },
  })
  if (body.isDone !== undefined) await logActivity(item.taskId, ctx.me.id, 'checklist_updated', { item: row.text, done: body.isDone })
  res.json({ item: { id: row.id, text: row.text, isDone: row.isDone, position: row.position } })
}

export async function deleteChecklistItem(req: AuthedRequest, res: Response): Promise<void> {
  const { item, ctx } = await loadChecklistItem(req)
  await prisma.pmChecklistItem.delete({ where: { id: item.id } })
  await logActivity(item.taskId, ctx.me.id, 'checklist_updated', { removed: item.text })
  res.status(204).end()
}

// ---------- Attachments ----------

/** POST /api/projects/tasks/:code/attachments?name= — raw binary body. */
export async function uploadAttachment(req: AuthedRequest, res: Response): Promise<void> {
  const { task, ctx } = await loadTaskCtx(req)
  if (!ctx.canContribute) throw new HttpError(403, 'Viewers cannot attach files')
  const buf = req.body as Buffer
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw new HttpError(400, 'No file received')
  if (buf.length > MAX_BYTES) throw new HttpError(413, 'File is larger than 25 MB')
  const originalName = String(req.query.name || 'file').slice(0, 200).replace(/[\r\n"]/g, '').trim() || 'file'
  const ext = path.extname(originalName).replace('.', '').toLowerCase()
  if (BLOCKED_EXT.has(ext)) throw new HttpError(415, 'That file type is not allowed')
  await fs.mkdir(UPLOAD_DIR, { recursive: true })
  const storedName = `${randomUUID()}${ext ? `.${ext}` : ''}`
  await fs.writeFile(path.join(UPLOAD_DIR, storedName), buf)
  const a = await prisma.pmAttachment.create({
    data: { taskId: task.id, uploadedById: ctx.me.id, storedName, originalName, mimeType: String(req.headers['content-type'] || 'application/octet-stream').slice(0, 120), size: buf.length },
    include: { uploadedBy: { select: { id: true, name: true } } },
  })
  await logActivity(task.id, ctx.me.id, 'attachment_added', { name: originalName })
  res.status(201).json({ attachment: { id: a.id, originalName: a.originalName, mimeType: a.mimeType, size: a.size, uploadedBy: a.uploadedBy, createdAt: a.createdAt.toISOString(), downloadUrl: `/api/projects/attachments/${a.id}/download` } })
}

async function loadAttachment(req: AuthedRequest) {
  const a = await prisma.pmAttachment.findUnique({ where: { id: req.params.id }, include: { task: true } })
  if (!a || a.task.deletedAt) throw new HttpError(404, 'Attachment not found')
  const ctx = await loadProjectCtx(a.task.projectId, viewer(req))
  return { a, ctx }
}

export async function downloadAttachment(req: AuthedRequest, res: Response): Promise<void> {
  const { a } = await loadAttachment(req)
  const filePath = path.join(UPLOAD_DIR, a.storedName)
  try { await fs.access(filePath) } catch { throw new HttpError(404, 'File missing on server') }
  // Always download (never render inline) so an uploaded file can't run as a page on our origin.
  res.setHeader('Content-Type', 'application/octet-stream')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(a.originalName)}"`)
  res.sendFile(filePath)
}

export async function deleteAttachment(req: AuthedRequest, res: Response): Promise<void> {
  const { a, ctx } = await loadAttachment(req)
  if (a.uploadedById !== ctx.me.id && !ctx.canManage) throw new HttpError(403, 'You can only remove files you uploaded')
  await prisma.pmAttachment.delete({ where: { id: a.id } })
  await fs.rm(path.join(UPLOAD_DIR, a.storedName), { force: true }).catch(() => undefined)
  await logActivity(a.taskId, ctx.me.id, 'attachment_removed', { name: a.originalName })
  res.status(204).end()
}

// ---------- Due date extensions ----------

const extSchema = z.object({ requestedDueAt: isoDate, reason: z.string().trim().min(3, 'Please give a reason').max(1000) })

/** POST /api/projects/tasks/:code/extension-requests — assignee asks for more time. */
export async function requestExtension(req: AuthedRequest, res: Response): Promise<void> {
  const { task, ctx } = await loadTaskCtx(req)
  if (!task.assignees.some((a) => a.userId === ctx.me.id)) throw new HttpError(403, 'Only an assignee can request an extension')
  if (task.column.category === 'DONE') throw new HttpError(422, 'This task is already done')
  const body = parse(extSchema, req.body)
  const requested = new Date(body.requestedDueAt)
  if (requested.getTime() <= Date.now()) throw new HttpError(422, 'Pick a new due date in the future')
  const pending = await prisma.pmExtensionRequest.findFirst({ where: { taskId: task.id, status: 'PENDING' } })
  if (pending) throw new HttpError(409, 'There is already a pending extension request for this task')
  const ext = await prisma.pmExtensionRequest.create({ data: { taskId: task.id, requestedById: ctx.me.id, currentDueAt: task.dueAt, requestedDueAt: requested, reason: body.reason } })
  await logActivity(task.id, ctx.me.id, 'extension_requested', { to: requested.toISOString(), reason: body.reason })
  const actorName = await userName(ctx.me.id)
  const admins = await projectAdminIds(ctx.project.id)
  await pmNotify({
    userIds: [task.createdById, ...admins],
    actorId: ctx.me.id,
    type: 'EXTENSION_REQUESTED',
    title: `${actorName} asked for more time on ${task.code}`,
    body: `New date ${fmtDue(requested)}: ${trunc(body.reason, 80)}`,
    link: taskLink(ctx.project.key, task.code),
    taskId: task.id,
    email: {
      pref: 'always',
      subject: `Extension requested: ${task.code} ${trunc(task.title, 60)}`,
      heading: `Extension requested on ${task.code}`,
      lines: [`${actorName} asked to move the due date of "${task.title}" from ${fmtDue(task.dueAt) || 'no date'} to ${fmtDue(requested)}.`, `Reason: ${body.reason}`],
      cta: 'Approve or reject',
    },
  })
  res.status(201).json({ request: { id: ext.id, status: ext.status } })
}

/** POST /api/projects/extension-requests/:id/decide { decision: approve|reject, note } */
export async function decideExtension(req: AuthedRequest, res: Response): Promise<void> {
  const ext = await prisma.pmExtensionRequest.findUnique({ where: { id: req.params.id }, include: { task: { include: { assignees: { select: { userId: true } }, column: { select: { category: true } } } } } })
  if (!ext || ext.task.deletedAt) throw new HttpError(404, 'Request not found')
  const ctx = await loadProjectCtx(ext.task.projectId, viewer(req))
  if (!canDecideExtension(ctx, ext.task)) throw new HttpError(403, 'Only the person who assigned this task or a project admin can decide')
  if (ext.status !== 'PENDING') throw new HttpError(409, 'This request was already decided')
  const body = parse(z.object({ decision: z.enum(['approve', 'reject']), note: z.string().trim().max(1000).optional() }), req.body)
  const approved = body.decision === 'approve'
  await prisma.$transaction(async (tx) => {
    await tx.pmExtensionRequest.update({ where: { id: ext.id }, data: { status: approved ? 'APPROVED' : 'REJECTED', decidedById: ctx.me.id, decidedAt: new Date(), decisionNote: body.note ?? null } })
    if (approved) {
      await tx.pmTask.update({ where: { id: ext.taskId }, data: { dueAt: ext.requestedDueAt } })
      await logActivity(ext.taskId, ctx.me.id, 'due_changed', { from: iso(ext.task.dueAt), to: ext.requestedDueAt.toISOString() }, tx)
      await clearOverdueIfResolved(ext.taskId, tx)
    }
    await logActivity(ext.taskId, ctx.me.id, approved ? 'extension_approved' : 'extension_rejected', { note: body.note ?? null }, tx)
  })
  const actorName = await userName(ctx.me.id)
  await pmNotify({
    userIds: [ext.requestedById],
    actorId: ctx.me.id,
    type: 'EXTENSION_DECIDED',
    title: approved ? `Extension approved on ${ext.task.code}` : `Extension rejected on ${ext.task.code}`,
    body: approved ? `New due date ${fmtDue(ext.requestedDueAt)}` : `${actorName}: ${body.note ? trunc(body.note, 80) : 'the original due date stays'}`,
    link: taskLink(ctx.project.key, ext.task.code),
    taskId: ext.taskId,
    email: {
      pref: 'always',
      subject: `${approved ? 'Extension approved' : 'Extension rejected'}: ${ext.task.code}`,
      heading: approved ? 'Your extension was approved' : 'Your extension was rejected',
      lines: approved
        ? [`${actorName} approved your request. "${ext.task.title}" is now due ${fmtDue(ext.requestedDueAt)}.`]
        : [`${actorName} rejected your request for "${ext.task.title}".`, body.note ? `Note: ${body.note}` : 'The original due date stays.'],
      cta: 'Open the task',
    },
  })
  res.json({ ok: true })
}

// ---------- My tasks ----------

/**
 * GET /api/projects/me/tasks?scope=assigned|created — tasks assigned to me (default)
 * or tasks I created for other people ("Assigned by me"), across every project
 * I can still see. Open tasks plus anything finished in the last 7 days.
 */
export async function myTasks(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const scope = req.query.scope === 'created' ? 'created' : 'assigned'
  const ids = await visibleProjectIds(me)
  const recent = new Date(Date.now() - 7 * 86400000)
  const where: Prisma.PmTaskWhereInput = {
    projectId: { in: ids },
    deletedAt: null,
    OR: [{ column: { category: { not: 'DONE' as PmColumnCategory } } }, { completedAt: { gte: recent } }],
    ...(scope === 'assigned'
      ? { assignees: { some: { userId: me.id } } }
      : { createdById: me.id, assignees: { some: { userId: { not: me.id } } } }),
  }
  const tasks = await prisma.pmTask.findMany({
    where,
    include: { ...CARD_INCLUDE, project: { select: { key: true, name: true, color: true } } },
    orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
    take: 500,
  })
  res.json({
    scope,
    tasks: tasks.map((t) => ({ ...serializeCard(t), project: t.project })),
  })
}

// ---------- Bulk (list view, admins) ----------

const bulkSchema = z.object({
  taskIds: z.array(z.string()).min(1).max(200),
  columnId: z.string().optional(),
  priority: priorityEnum.optional(),
  assigneeId: z.string().nullable().optional(),
  delete: z.boolean().optional(),
})

export async function bulkUpdate(req: AuthedRequest, res: Response): Promise<void> {
  const ctx = await loadProjectCtx(req.params.key, viewer(req))
  if (!ctx.canManage) throw new HttpError(403, 'Only project admins can use bulk actions')
  const body = parse(bulkSchema, req.body)
  const tasks = await prisma.pmTask.findMany({ where: { id: { in: body.taskIds }, projectId: ctx.project.id, deletedAt: null }, select: { id: true, assignees: { select: { userId: true } }, priority: true, columnId: true } })
  if (body.assigneeId) await assertMembers(ctx, [body.assigneeId])
  for (const t of tasks) {
    if (body.delete) {
      await prisma.pmTask.update({ where: { id: t.id }, data: { deletedAt: new Date(), isOverdue: false } })
      await logActivity(t.id, ctx.me.id, 'deleted', { bulk: true })
      continue
    }
    if (body.priority && body.priority !== t.priority) {
      await prisma.pmTask.update({ where: { id: t.id }, data: { priority: body.priority } })
      await logActivity(t.id, ctx.me.id, 'priority_changed', { from: t.priority, to: body.priority, bulk: true })
    }
    if (body.assigneeId !== undefined) {
      const had = t.assignees.map((a) => a.userId)
      await prisma.pmTaskAssignee.deleteMany({ where: { taskId: t.id } })
      if (body.assigneeId) {
        await prisma.pmTaskAssignee.create({ data: { taskId: t.id, userId: body.assigneeId, assignedById: ctx.me.id } })
        await prisma.pmTaskWatcher.createMany({ data: [{ taskId: t.id, userId: body.assigneeId }], skipDuplicates: true })
      }
      await logActivity(t.id, ctx.me.id, 'assigned', { userIds: body.assigneeId ? [body.assigneeId] : [], replaced: had, bulk: true })
    }
    if (body.columnId && body.columnId !== t.columnId) await moveTaskTo(ctx, t.id, body.columnId, null, null)
  }
  res.json({ updated: tasks.length })
}

export { isTaskOverdue }

// ---------- Reviews ----------

/** The end (due) date can't be before the start date. */
function assertDateRange(start: Date | null, end: Date | null): void {
  if (start && end && end.getTime() < start.getTime()) throw new HttpError(422, 'The end date must be after the start date')
}

const VERDICT_LABEL = { APPROVED: 'Approved', CHANGES_REQUESTED: 'Changes requested', COMMENT: 'Reviewed' } as const

function serializeReview(r: { id: string; verdict: keyof typeof VERDICT_LABEL; rating: number | null; body: string; createdAt: Date; reviewer: { id: string; name: string } }) {
  return { id: r.id, verdict: r.verdict, rating: r.rating, body: r.body, reviewer: r.reviewer, createdAt: r.createdAt.toISOString() }
}

const reviewSchema = z.object({
  verdict: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'COMMENT']).default('COMMENT'),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  body: z.string().trim().min(1, 'Write your review').max(5000),
})

/** POST /api/projects/tasks/:code/reviews — any project member can review a task. */
export async function addReview(req: AuthedRequest, res: Response): Promise<void> {
  const { task, ctx } = await loadTaskCtx(req)
  const body = parse(reviewSchema, req.body)
  const r = await prisma.$transaction(async (tx) => {
    const row = await tx.pmReview.create({
      data: { taskId: task.id, reviewerId: ctx.me.id, verdict: body.verdict, rating: body.rating ?? null, body: body.body },
      include: { reviewer: { select: { id: true, name: true } } },
    })
    await tx.pmTaskWatcher.createMany({ data: [{ taskId: task.id, userId: ctx.me.id }], skipDuplicates: true })
    await logActivity(task.id, ctx.me.id, 'review_added', { reviewId: row.id, verdict: body.verdict }, tx)
    await tx.pmTask.update({ where: { id: task.id }, data: { updatedAt: new Date() } })
    return row
  })
  const name = r.reviewer.name
  const label = VERDICT_LABEL[body.verdict]
  const watchers = (await prisma.pmTaskWatcher.findMany({ where: { taskId: task.id }, select: { userId: true } })).map((w) => w.userId)
  await pmNotify({
    userIds: [...task.assignees.map((a) => a.userId), task.createdById, ...watchers],
    actorId: ctx.me.id,
    type: 'TASK_REVIEW',
    title: `${name} reviewed ${task.code}: ${label}`,
    body: `"${trunc(task.title, 60)}": ${trunc(body.body, 100)}`,
    link: taskLink(ctx.project.key, task.code),
    taskId: task.id,
    email: {
      pref: 'emailComment',
      subject: `${name} reviewed ${task.code}: ${label}`,
      heading: `New review on ${task.code}`,
      lines: [`${name} reviewed "${task.title}" (${label}${body.rating ? `, ${body.rating}/5` : ''}):`, `"${trunc(body.body, 400)}"`],
      cta: 'Open the task',
    },
  })
  res.status(201).json({ review: serializeReview(r) })
}

/** DELETE /api/projects/reviews/:id — the reviewer or a project admin. */
export async function deleteReview(req: AuthedRequest, res: Response): Promise<void> {
  const r = await prisma.pmReview.findUnique({ where: { id: req.params.id }, include: { task: true } })
  if (!r || r.deletedAt || r.task.deletedAt) throw new HttpError(404, 'Review not found')
  const ctx = await loadProjectCtx(r.task.projectId, viewer(req))
  if (r.reviewerId !== ctx.me.id && !ctx.canManage) throw new HttpError(403, 'You can only delete your own reviews')
  await prisma.pmReview.update({ where: { id: r.id }, data: { deletedAt: new Date() } })
  await logActivity(r.taskId, ctx.me.id, 'review_deleted', { reviewId: r.id })
  res.status(204).end()
}

/** GET /api/projects/:key/reviews — every review in the project, newest first (who reviewed which task). */
export async function listProjectReviews(req: AuthedRequest, res: Response): Promise<void> {
  const ctx = await loadProjectCtx(req.params.key, viewer(req))
  const rows = await prisma.pmReview.findMany({
    where: { deletedAt: null, task: { projectId: ctx.project.id, deletedAt: null } },
    include: {
      reviewer: { select: { id: true, name: true } },
      task: { select: { code: true, title: true, column: { select: { name: true, category: true } }, assignees: { include: { user: { select: { id: true, name: true } } } } } },
    },
    orderBy: { createdAt: 'desc' },
    take: 300,
  })
  res.json({
    reviews: rows.map((r) => ({
      ...serializeReview(r),
      task: { code: r.task.code, title: r.task.title, status: r.task.column.name, category: r.task.column.category, assignees: r.task.assignees.map((a) => a.user) },
    })),
  })
}
