import type { Response } from 'express'
import { z } from 'zod'
import type { PmColumnCategory } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { HttpError, loadProjectCtx, PROJECT_CREATOR_ROLES, PROJECT_KEY_RE, visibleProjectIds } from '../lib/pm/access'
import { parse, viewer } from '../lib/pm/http'
import { CARD_INCLUDE, createProjectWithDefaults, serializeCard, syncProjectChannel } from '../lib/pm/tasks'
import { DEFAULT_PREFS, pmNotify } from '../lib/pm/pmNotify'

/**
 * Projects: list/create/settings, members, board columns, labels and the board
 * payload. Every read is scoped to projects the caller can see (membership or
 * Super Admin) and every write re-checks the caller's role inside the project.
 */

const HEX = /^#[0-9A-Fa-f]{6}$/
const DONE_HIDE_DAYS = 14

const roleEnum = z.enum(['ADMIN', 'MEMBER', 'VIEWER'])

function serializeProject(p: { id: string; name: string; key: string; description: string | null; color: string; status: string; ownerId: string; taskCounter: number; overdueNotifyAdmins: boolean; overdueRepeatHours: number; reminderOffsetsMinutes: number[]; createdAt: Date }) {
  return {
    id: p.id,
    name: p.name,
    key: p.key,
    description: p.description,
    color: p.color,
    status: p.status,
    ownerId: p.ownerId,
    taskCounter: p.taskCounter,
    overdueNotifyAdmins: p.overdueNotifyAdmins,
    overdueRepeatHours: p.overdueRepeatHours,
    reminderOffsetsMinutes: p.reminderOffsetsMinutes,
    createdAt: p.createdAt.toISOString(),
  }
}

// ---------- Projects ----------

/** GET /api/projects?archived=1 — projects I can see, with counts for the cards. */
export async function listProjects(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const archived = req.query.archived === '1'
  const ids = await visibleProjectIds(me, true)
  const projects = await prisma.pmProject.findMany({
    where: { id: { in: ids }, status: archived ? 'ARCHIVED' : 'ACTIVE' },
    orderBy: { name: 'asc' },
    include: {
      members: { include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } },
    },
  })
  const pids = projects.map((p) => p.id)
  const now = new Date()
  const openWhere = { projectId: { in: pids }, deletedAt: null, column: { category: { not: 'DONE' as PmColumnCategory } } }
  const [open, overdue, mine] = await Promise.all([
    prisma.pmTask.groupBy({ by: ['projectId'], where: openWhere, _count: { _all: true } }),
    prisma.pmTask.groupBy({ by: ['projectId'], where: { ...openWhere, dueAt: { lt: now } }, _count: { _all: true } }),
    prisma.pmTask.groupBy({ by: ['projectId'], where: { ...openWhere, assignees: { some: { userId: me.id } } }, _count: { _all: true } }),
  ])
  const count = (rows: { projectId: string; _count: { _all: number } }[], id: string) => rows.find((r) => r.projectId === id)?._count._all ?? 0
  res.json({
    canCreate: PROJECT_CREATOR_ROLES.includes(me.role),
    projects: projects.map((p) => ({
      ...serializeProject(p),
      myRole: p.members.find((m) => m.userId === me.id)?.role ?? null,
      memberCount: p.members.length,
      members: p.members.slice(0, 6).map((m) => m.user),
      openCount: count(open, p.id),
      overdueCount: count(overdue, p.id),
      myOpenCount: count(mine, p.id),
    })),
  })
}

const createSchema = z.object({
  name: z.string().trim().min(2, 'Name is too short').max(60),
  key: z.string().trim().toUpperCase().regex(PROJECT_KEY_RE, 'Key must be 2 to 6 letters or digits, starting with a letter'),
  description: z.string().trim().max(2000).optional().nullable(),
  color: z.string().regex(HEX).optional(),
  members: z.array(z.object({ userId: z.string(), role: roleEnum })).max(200).optional(),
})

/** POST /api/projects — a Super Admin or Team Lead creates a project (default columns + # channel); the creator becomes its project admin. */
export async function createProject(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  if (!PROJECT_CREATOR_ROLES.includes(me.role)) throw new HttpError(403, 'Only Super Admins and Team Leads can create projects')
  const body = parse(createSchema, req.body)
  const clash = await prisma.pmProject.findFirst({ where: { OR: [{ key: body.key }, { name: { equals: body.name, mode: 'insensitive' } }] } })
  if (clash) throw new HttpError(409, clash.key === body.key ? `Key ${body.key} is already used` : 'A project with that name already exists')
  const memberIds = (body.members ?? []).map((m) => m.userId)
  if (memberIds.length) {
    const ok = await prisma.user.count({ where: { id: { in: memberIds }, isActive: true } })
    if (ok !== new Set(memberIds).size) throw new HttpError(422, 'Some selected users are not active')
  }
  const project = await createProjectWithDefaults({ ...body, ownerId: me.id })
  await pmNotify({
    userIds: memberIds,
    actorId: me.id,
    type: 'PROJECT_MEMBER_ADDED',
    title: `You were added to ${project.name}`,
    body: `Project ${project.key}`,
    link: `/app/projects/${project.key}`,
  })
  res.status(201).json({ project: serializeProject(project) })
}

/** GET /api/projects/:key — project details + my permissions. */
export async function getProject(req: AuthedRequest, res: Response): Promise<void> {
  const ctx = await loadProjectCtx(req.params.key, viewer(req))
  res.json({ project: serializeProject(ctx.project), perms: perms(ctx) })
}

function perms(ctx: Awaited<ReturnType<typeof loadProjectCtx>>) {
  return {
    projectRole: ctx.pmRole,
    isSuperAdmin: ctx.isSuperAdmin,
    canManage: ctx.canManage,
    canContribute: ctx.canContribute,
    canArchive: ctx.isSuperAdmin,
  }
}

const updateSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  key: z.string().trim().toUpperCase().regex(PROJECT_KEY_RE, 'Key must be 2 to 6 letters or digits, starting with a letter').optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  color: z.string().regex(HEX).optional(),
  overdueNotifyAdmins: z.boolean().optional(),
  overdueRepeatHours: z.number().int().min(1).max(168).optional(),
  reminderOffsetsMinutes: z.array(z.number().int().min(5).max(10080)).max(4).optional(),
})

/** PATCH /api/projects/:key — settings (project admins). Key is locked once tasks exist. */
export async function updateProject(req: AuthedRequest, res: Response): Promise<void> {
  const ctx = await loadProjectCtx(req.params.key, viewer(req))
  if (!ctx.canManage) throw new HttpError(403, 'Only project admins can change settings')
  const body = parse(updateSchema, req.body)
  if (body.key && body.key !== ctx.project.key) {
    if (ctx.project.taskCounter > 0) throw new HttpError(422, 'The key cannot change after tasks have been created')
    if (await prisma.pmProject.findUnique({ where: { key: body.key } })) throw new HttpError(409, `Key ${body.key} is already used`)
  }
  if (body.name && body.name !== ctx.project.name) {
    const clash = await prisma.pmProject.findFirst({ where: { name: { equals: body.name, mode: 'insensitive' }, id: { not: ctx.project.id } } })
    if (clash) throw new HttpError(409, 'A project with that name already exists')
  }
  const data = { ...body, ...(body.reminderOffsetsMinutes ? { reminderOffsetsMinutes: [...new Set(body.reminderOffsetsMinutes)].sort((a, b) => b - a) } : {}) }
  const project = await prisma.pmProject.update({ where: { id: ctx.project.id }, data })
  if (body.name) await syncProjectChannel(project.id)
  res.json({ project: serializeProject(project) })
}

/** POST /api/projects/:key/archive  { archived: boolean } — Super Admin only. */
export async function archiveProject(req: AuthedRequest, res: Response): Promise<void> {
  const ctx = await loadProjectCtx(req.params.key, viewer(req))
  if (!ctx.isSuperAdmin) throw new HttpError(403, 'Only a Super Admin can archive projects')
  const archived = req.body?.archived !== false
  const project = await prisma.pmProject.update({ where: { id: ctx.project.id }, data: { status: archived ? 'ARCHIVED' : 'ACTIVE' } })
  res.json({ project: serializeProject(project) })
}

// ---------- Members ----------

export async function listMembers(req: AuthedRequest, res: Response): Promise<void> {
  const ctx = await loadProjectCtx(req.params.key, viewer(req))
  const members = await prisma.pmProjectMember.findMany({
    where: { projectId: ctx.project.id },
    include: { user: { select: { id: true, name: true, email: true, isActive: true } } },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
  })
  res.json({ members: members.map((m) => ({ userId: m.userId, name: m.user.name, email: m.user.email, isActive: m.user.isActive, role: m.role })) })
}

const addMembersSchema = z.object({ userIds: z.array(z.string()).min(1).max(200), role: roleEnum.default('MEMBER') })

/** POST /api/projects/:key/members { userIds, role } */
export async function addMembers(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const ctx = await loadProjectCtx(req.params.key, me)
  if (!ctx.canManage) throw new HttpError(403, 'Only project admins can add members')
  const body = parse(addMembersSchema, req.body)
  const users = await prisma.user.findMany({ where: { id: { in: body.userIds }, isActive: true, status: 'ACTIVE' }, select: { id: true } })
  if (users.length !== new Set(body.userIds).size) throw new HttpError(422, 'Some selected users are not active')
  const existing = await prisma.pmProjectMember.findMany({ where: { projectId: ctx.project.id, userId: { in: body.userIds } }, select: { userId: true } })
  const already = new Set(existing.map((e) => e.userId))
  const fresh = body.userIds.filter((id) => !already.has(id))
  await prisma.pmProjectMember.createMany({ data: fresh.map((userId) => ({ projectId: ctx.project.id, userId, role: body.role, addedById: me.id })), skipDuplicates: true })
  await syncProjectChannel(ctx.project.id)
  await pmNotify({
    userIds: fresh,
    actorId: me.id,
    type: 'PROJECT_MEMBER_ADDED',
    title: `You were added to ${ctx.project.name}`,
    body: `Project ${ctx.project.key}, role ${body.role.toLowerCase()}`,
    link: `/app/projects/${ctx.project.key}`,
  })
  res.status(201).json({ added: fresh.length })
}

/** PATCH /api/projects/:key/members/:userId { role } */
export async function updateMember(req: AuthedRequest, res: Response): Promise<void> {
  const ctx = await loadProjectCtx(req.params.key, viewer(req))
  if (!ctx.canManage) throw new HttpError(403, 'Only project admins can change roles')
  const { role } = parse(z.object({ role: roleEnum }), req.body)
  const m = await prisma.pmProjectMember.findUnique({ where: { projectId_userId: { projectId: ctx.project.id, userId: req.params.userId } } })
  if (!m) throw new HttpError(404, 'Member not found')
  if (m.role === 'ADMIN' && role !== 'ADMIN') await assertAnotherAdmin(ctx.project.id, m.userId)
  await prisma.pmProjectMember.update({ where: { id: m.id }, data: { role } })
  await syncProjectChannel(ctx.project.id)
  res.json({ ok: true })
}

async function assertAnotherAdmin(projectId: string, leavingUserId: string): Promise<void> {
  const others = await prisma.pmProjectMember.count({ where: { projectId, role: 'ADMIN', userId: { not: leavingUserId } } })
  if (others === 0) throw new HttpError(422, 'A project needs at least one admin')
}

/** DELETE /api/projects/:key/members/:userId — also drops them from tasks + the # channel. */
export async function removeMember(req: AuthedRequest, res: Response): Promise<void> {
  const ctx = await loadProjectCtx(req.params.key, viewer(req))
  if (!ctx.canManage) throw new HttpError(403, 'Only project admins can remove members')
  const userId = req.params.userId
  const m = await prisma.pmProjectMember.findUnique({ where: { projectId_userId: { projectId: ctx.project.id, userId } } })
  if (!m) throw new HttpError(404, 'Member not found')
  if (m.role === 'ADMIN') await assertAnotherAdmin(ctx.project.id, userId)
  await prisma.$transaction([
    prisma.pmProjectMember.delete({ where: { id: m.id } }),
    prisma.pmTaskAssignee.deleteMany({ where: { userId, task: { projectId: ctx.project.id } } }),
    prisma.pmTaskWatcher.deleteMany({ where: { userId, task: { projectId: ctx.project.id } } }),
  ])
  await syncProjectChannel(ctx.project.id)
  res.status(204).end()
}

/** GET /api/projects/users — active users to pick from when adding members (managers only). */
export async function listPickableUsers(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const managesAny = me.role === 'SUPER_ADMIN' || (await prisma.pmProjectMember.count({ where: { userId: me.id, role: 'ADMIN' } })) > 0
  if (!managesAny) throw new HttpError(403, 'Forbidden')
  const users = await prisma.user.findMany({
    where: { isActive: true, status: 'ACTIVE' },
    select: { id: true, name: true, email: true, role: true, department: { select: { name: true } } },
    orderBy: { name: 'asc' },
  })
  res.json({ users: users.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, department: u.department?.name ?? null })) })
}

// ---------- Columns ----------

const columnSchema = z.object({
  name: z.string().trim().min(1).max(40),
  category: z.enum(['TODO', 'IN_PROGRESS', 'DONE']),
  color: z.string().regex(HEX).nullable().optional(),
  wipLimit: z.number().int().min(1).max(999).nullable().optional(),
  isDefault: z.boolean().optional(),
})

export async function createColumn(req: AuthedRequest, res: Response): Promise<void> {
  const ctx = await loadProjectCtx(req.params.key, viewer(req))
  if (!ctx.canManage) throw new HttpError(403, 'Only project admins can manage columns')
  const body = parse(columnSchema, req.body)
  const max = await prisma.pmColumn.aggregate({ where: { projectId: ctx.project.id }, _max: { position: true } })
  const col = await prisma.$transaction(async (tx) => {
    if (body.isDefault) await tx.pmColumn.updateMany({ where: { projectId: ctx.project.id }, data: { isDefault: false } })
    return tx.pmColumn.create({ data: { projectId: ctx.project.id, name: body.name, category: body.category, color: body.color ?? null, wipLimit: body.wipLimit ?? null, isDefault: !!body.isDefault, position: (max._max.position ?? -1) + 1 } })
  })
  res.status(201).json({ column: col })
}

async function loadColumnCtx(req: AuthedRequest) {
  const col = await prisma.pmColumn.findUnique({ where: { id: req.params.id } })
  if (!col) throw new HttpError(404, 'Column not found')
  const ctx = await loadProjectCtx(col.projectId, viewer(req))
  if (!ctx.canManage) throw new HttpError(403, 'Only project admins can manage columns')
  return { col, ctx }
}

/** Every project keeps at least one TODO and one DONE column. */
async function assertCategoryCoverage(projectId: string, without: string, newCategory?: PmColumnCategory): Promise<void> {
  const cols = await prisma.pmColumn.findMany({ where: { projectId }, select: { id: true, category: true } })
  const cats = cols.map((c) => (c.id === without ? newCategory : c.category)).filter(Boolean)
  if (!cats.includes('TODO')) throw new HttpError(422, 'A board needs at least one To Do type column')
  if (!cats.includes('DONE')) throw new HttpError(422, 'A board needs at least one Done type column')
}

export async function updateColumn(req: AuthedRequest, res: Response): Promise<void> {
  const { col, ctx } = await loadColumnCtx(req)
  const body = parse(columnSchema.partial(), req.body)
  if (body.category && body.category !== col.category) {
    await assertCategoryCoverage(ctx.project.id, col.id, body.category)
  }
  const updated = await prisma.$transaction(async (tx) => {
    if (body.isDefault) await tx.pmColumn.updateMany({ where: { projectId: ctx.project.id }, data: { isDefault: false } })
    const c = await tx.pmColumn.update({ where: { id: col.id }, data: body })
    if (body.category && body.category !== col.category) {
      // Category drives completion: keep completedAt consistent for tasks already in the column.
      if (body.category === 'DONE') await tx.pmTask.updateMany({ where: { columnId: col.id, completedAt: null }, data: { completedAt: new Date(), isOverdue: false, overdueSince: null } })
      else await tx.pmTask.updateMany({ where: { columnId: col.id }, data: { completedAt: null } })
    }
    return c
  })
  res.json({ column: updated })
}

/** DELETE /api/projects/columns/:id?moveTo=<columnId> — tasks must be moved somewhere first. */
export async function deleteColumn(req: AuthedRequest, res: Response): Promise<void> {
  const { col, ctx } = await loadColumnCtx(req)
  await assertCategoryCoverage(ctx.project.id, col.id, undefined)
  const taskCount = await prisma.pmTask.count({ where: { columnId: col.id } })
  const moveTo = (req.query.moveTo as string) || (req.body?.moveTo as string) || ''
  if (taskCount > 0) {
    const target = moveTo ? await prisma.pmColumn.findFirst({ where: { id: moveTo, projectId: ctx.project.id } }) : null
    if (!target || target.id === col.id) throw new HttpError(422, 'Pick another column to move this column\'s tasks into')
    await prisma.pmTask.updateMany({
      where: { columnId: col.id },
      data: { columnId: target.id, ...(target.category === 'DONE' ? { completedAt: new Date(), isOverdue: false, overdueSince: null } : { completedAt: null }) },
    })
  }
  await prisma.$transaction(async (tx) => {
    await tx.pmColumn.delete({ where: { id: col.id } })
    if (col.isDefault) {
      const first = await tx.pmColumn.findFirst({ where: { projectId: ctx.project.id, category: 'TODO' }, orderBy: { position: 'asc' } })
      if (first) await tx.pmColumn.update({ where: { id: first.id }, data: { isDefault: true } })
    }
  })
  res.status(204).end()
}

/** PATCH /api/projects/:key/columns/reorder { orderedIds } */
export async function reorderColumns(req: AuthedRequest, res: Response): Promise<void> {
  const ctx = await loadProjectCtx(req.params.key, viewer(req))
  if (!ctx.canManage) throw new HttpError(403, 'Only project admins can reorder columns')
  const { orderedIds } = parse(z.object({ orderedIds: z.array(z.string()).min(1) }), req.body)
  const cols = await prisma.pmColumn.findMany({ where: { projectId: ctx.project.id }, select: { id: true } })
  const valid = new Set(cols.map((c) => c.id))
  if (orderedIds.length !== cols.length || !orderedIds.every((id) => valid.has(id))) throw new HttpError(422, 'Column list does not match the board')
  await prisma.$transaction(orderedIds.map((id, i) => prisma.pmColumn.update({ where: { id }, data: { position: i } })))
  res.json({ ok: true })
}

// ---------- Labels ----------

const labelSchema = z.object({ name: z.string().trim().min(1).max(30), color: z.string().regex(HEX).optional() })

export async function createLabel(req: AuthedRequest, res: Response): Promise<void> {
  const ctx = await loadProjectCtx(req.params.key, viewer(req))
  if (!ctx.canContribute) throw new HttpError(403, 'Viewers cannot add labels')
  const body = parse(labelSchema, req.body)
  const dup = await prisma.pmLabel.findUnique({ where: { projectId_name: { projectId: ctx.project.id, name: body.name } } })
  if (dup) throw new HttpError(409, 'That label already exists')
  const label = await prisma.pmLabel.create({ data: { projectId: ctx.project.id, name: body.name, color: body.color ?? '#64748B' } })
  res.status(201).json({ label })
}

export async function updateLabel(req: AuthedRequest, res: Response): Promise<void> {
  const label = await prisma.pmLabel.findUnique({ where: { id: req.params.id } })
  if (!label) throw new HttpError(404, 'Label not found')
  const ctx = await loadProjectCtx(label.projectId, viewer(req))
  if (!ctx.canManage) throw new HttpError(403, 'Only project admins can edit labels')
  const body = parse(labelSchema.partial(), req.body)
  res.json({ label: await prisma.pmLabel.update({ where: { id: label.id }, data: body }) })
}

export async function deleteLabel(req: AuthedRequest, res: Response): Promise<void> {
  const label = await prisma.pmLabel.findUnique({ where: { id: req.params.id } })
  if (!label) throw new HttpError(404, 'Label not found')
  const ctx = await loadProjectCtx(label.projectId, viewer(req))
  if (!ctx.canManage) throw new HttpError(403, 'Only project admins can delete labels')
  await prisma.pmLabel.delete({ where: { id: label.id } })
  res.status(204).end()
}

// ---------- Board ----------

/**
 * GET /api/projects/:key/board?showOldDone=1 — columns, every live task as a card,
 * members and labels. Done tasks completed more than 14 days ago are left out by
 * default to keep big boards fast. Filtering happens client side (instant).
 */
export async function getBoard(req: AuthedRequest, res: Response): Promise<void> {
  const ctx = await loadProjectCtx(req.params.key, viewer(req))
  const showOld = req.query.showOldDone === '1'
  const cutoff = new Date(Date.now() - DONE_HIDE_DAYS * 86400000)
  const hideOld = { NOT: { column: { category: 'DONE' as PmColumnCategory }, completedAt: { lt: cutoff } } }
  const [columns, tasks, members, labels, hiddenDone] = await Promise.all([
    prisma.pmColumn.findMany({ where: { projectId: ctx.project.id }, orderBy: { position: 'asc' } }),
    prisma.pmTask.findMany({
      where: { projectId: ctx.project.id, deletedAt: null, ...(showOld ? {} : hideOld) },
      include: CARD_INCLUDE,
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.pmProjectMember.findMany({
      where: { projectId: ctx.project.id },
      include: { user: { select: { id: true, name: true, email: true, isActive: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.pmLabel.findMany({ where: { projectId: ctx.project.id }, orderBy: { name: 'asc' } }),
    showOld ? Promise.resolve(0) : prisma.pmTask.count({ where: { projectId: ctx.project.id, deletedAt: null, column: { category: 'DONE' }, completedAt: { lt: cutoff } } }),
  ])
  res.json({
    project: serializeProject(ctx.project),
    perms: perms(ctx),
    me: { id: ctx.me.id },
    columns: columns.map((c) => ({ id: c.id, name: c.name, category: c.category, position: c.position, color: c.color, wipLimit: c.wipLimit, isDefault: c.isDefault })),
    tasks: tasks.map(serializeCard),
    members: members.map((m) => ({ id: m.user.id, name: m.user.name, email: m.user.email, isActive: m.user.isActive, role: m.role })),
    labels: labels.map((l) => ({ id: l.id, name: l.name, color: l.color })),
    hiddenDoneCount: hiddenDone,
    serverTime: new Date().toISOString(),
  })
}

// ---------- Notification preferences ----------

const prefsSchema = z.object({
  emailAssigned: z.boolean(),
  emailMention: z.boolean(),
  emailComment: z.boolean(),
  emailDueSoon: z.boolean(),
}).partial()

export async function getPrefs(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const row = await prisma.pmNotifyPref.findUnique({ where: { userId: me.id } })
  res.json({ prefs: row ? { emailAssigned: row.emailAssigned, emailMention: row.emailMention, emailComment: row.emailComment, emailDueSoon: row.emailDueSoon } : DEFAULT_PREFS })
}

export async function putPrefs(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const body = parse(prefsSchema, req.body)
  const row = await prisma.pmNotifyPref.upsert({ where: { userId: me.id }, create: { userId: me.id, ...DEFAULT_PREFS, ...body }, update: body })
  res.json({ prefs: { emailAssigned: row.emailAssigned, emailMention: row.emailMention, emailComment: row.emailComment, emailDueSoon: row.emailDueSoon } })
}
