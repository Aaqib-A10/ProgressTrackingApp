import type { Response } from 'express'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { MarketingDiscipline, TaskStatus, ContentType, SocialPlatform, Priority, type MarketingTask, type Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { companyToday, dbDateFromString, dateStringFromDb } from '../lib/time'
import { notifyMentions, notifyTaskAssigned } from '../lib/notify'
import { sendTaskAssignedEmail } from '../lib/mail'
import { resolveMarketingActor, type MarketingActor } from '../lib/marketingAuth'

const UPLOAD_DIR = path.resolve('uploads')
const MAX_ATT_BYTES = 25 * 1024 * 1024
const BLOCKED_EXT = new Set(['exe', 'bat', 'cmd', 'com', 'msi', 'scr', 'sh', 'ps1', 'vbs', 'js', 'mjs', 'cjs', 'jar', 'apk', 'app'])

/** Fire assignment side-effects (in-app notification + email). Best-effort. */
async function fireAssignment(taskId: string, taskTitle: string, assigneeId: string | null, actor: MarketingActor): Promise<void> {
  if (!assigneeId || assigneeId === actor.me.id) return
  const assignee = await prisma.user.findUnique({ where: { id: assigneeId }, select: { email: true, name: true } })
  if (!assignee) return
  await notifyTaskAssigned({ assigneeId, actorId: actor.me.id, actorName: actor.me.name, taskTitle, taskId }).catch(() => undefined)
  await sendTaskAssignedEmail({ to: assignee.email, name: assignee.name, taskTitle, taskId, assignerName: actor.me.name }).catch(() => undefined)
}

const STATUS_ORDER: TaskStatus[] = ['BACKLOG', 'IN_PROGRESS', 'IN_REVIEW', 'SCHEDULED', 'PUBLISHED']

const STATUS_LABEL: Record<TaskStatus, string> = {
  BACKLOG: 'Backlog',
  IN_PROGRESS: 'In Progress',
  IN_REVIEW: 'In Review',
  SCHEDULED: 'Scheduled',
  PUBLISHED: 'Published',
}

type TaskWithAssignee = MarketingTask & {
  assignee: { id: string; name: string } | null
  brand?: { id: string; name: string } | null
  _count?: { comments: number; attachments?: number }
}

/** Sub-department slug → the board discipline it owns (ads/email have no board lane). */
const SLUG_TO_DISCIPLINE: Record<string, MarketingDiscipline> = { seo: 'SEO', social: 'SOCIAL', content: 'CONTENT' }

/**
 * The task-visibility filter for an actor:
 *  - Lead / Super Admin: everything.
 *  - Sub-Dept Lead: all tasks in their sub-department's discipline.
 *  - Member: only tasks assigned to them.
 * This is the single source of truth for who-sees-what, applied to every read/write.
 */
function scopeWhere(actor: MarketingActor): Prisma.MarketingTaskWhereInput {
  if (actor.isLead) return {}
  if (actor.me.role === 'SUB_DEPT_LEAD') {
    const disc = actor.subDeptSlug ? SLUG_TO_DISCIPLINE[actor.subDeptSlug] : undefined
    return disc ? { discipline: disc } : { assigneeId: actor.me.id }
  }
  return { assigneeId: actor.me.id }
}

/** Active Marketing team members — for assignee pickers and @mentions. */
async function marketingMembers() {
  const dept = await prisma.department.findUnique({ where: { type: 'MARKETING' } })
  if (!dept) return { deptId: null as string | null, members: [] as { id: string; name: string }[] }
  const members = await prisma.user.findMany({
    where: { departmentId: dept.id, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
  return { deptId: dept.id, members }
}

const dateStr = (d: Date | null) => (d ? dateStringFromDb(d) : null)

function serialize(t: TaskWithAssignee) {
  return {
    id: t.id,
    title: t.title,
    description: t.description ?? '',
    discipline: t.discipline,
    status: t.status,
    priority: t.priority,
    order: t.order,
    assignee: t.assignee,
    brand: t.brand ?? null,
    contentType: t.contentType,
    platform: t.platform,
    wordCount: t.wordCount,
    wordTarget: t.wordTarget,
    dueDate: dateStr(t.dueDate),
    dueAt: t.dueAt ? t.dueAt.toISOString() : null,
    scheduledDate: dateStr(t.scheduledDate),
    publishedDate: dateStr(t.publishedDate),
    commentCount: t._count?.comments ?? 0,
    attachmentCount: t._count?.attachments ?? 0,
  }
}

function serializeComment(c: Prisma.MarketingTaskCommentGetPayload<{ include: { author: { select: { id: true; name: true } } } }>) {
  return { id: c.id, body: c.body, mentions: c.mentions, createdAt: c.createdAt.toISOString(), author: { id: c.author.id, name: c.author.name } }
}

/** GET /api/marketing/board?discipline= — tasks grouped into columns, scoped to the actor. */
export async function getBoard(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  const discipline = req.query.discipline as MarketingDiscipline | undefined

  const [tasks, { members }] = await Promise.all([
    prisma.marketingTask.findMany({
      where: { AND: [scopeWhere(actor), discipline ? { discipline } : {}] },
      include: {
        assignee: { select: { id: true, name: true } },
        brand: { select: { id: true, name: true } },
        _count: { select: { comments: true, attachments: true } },
      },
      orderBy: [{ order: 'asc' }, { updatedAt: 'asc' }],
    }),
    marketingMembers(),
  ])

  const columns = STATUS_ORDER.map((status) => ({
    status,
    label: STATUS_LABEL[status],
    tasks: tasks.filter((t) => t.status === status).map(serialize),
  }))
  // The client uses these to gate lead-only affordances + the "group by discipline" view.
  res.json({ columns, members, viewer: { id: actor.me.id, isLead: actor.isLead, role: actor.me.role, subDeptSlug: actor.subDeptSlug } })
}

/** GET /api/marketing/tasks/:id — task detail + comment thread (scoped to the actor). */
export async function getTask(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  const task = await prisma.marketingTask.findFirst({
    where: { AND: [{ id: req.params.id }, scopeWhere(actor)] },
    include: {
      assignee: { select: { id: true, name: true } },
      brand: { select: { id: true, name: true } },
      _count: { select: { comments: true, attachments: true } },
      comments: { include: { author: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } },
      attachments: { orderBy: { createdAt: 'asc' } },
    },
  })
  if (!task) {
    res.status(404).json({ error: 'Task not found' })
    return
  }
  res.json({ task: serialize(task), comments: task.comments.map(serializeComment), attachments: task.attachments.map(serializeAttachment) })
}

function serializeAttachment(a: { id: string; originalName: string; mimeType: string; size: number; createdAt: Date }) {
  return {
    id: a.id,
    originalName: a.originalName,
    mimeType: a.mimeType,
    size: a.size,
    createdAt: a.createdAt.toISOString(),
    downloadUrl: `/api/marketing/attachments/${a.id}/download`,
  }
}

const commentSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  mentions: z.array(z.string()).max(50).optional(),
})

/** POST /api/marketing/tasks/:id/comments — any Marketing member comments (with @mentions). */
export async function addComment(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  const task = await prisma.marketingTask.findFirst({ where: { AND: [{ id: req.params.id }, scopeWhere(actor)] }, select: { id: true, title: true } })
  if (!task) {
    res.status(404).json({ error: 'Task not found' })
    return
  }
  const parsed = commentSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  // Keep only mentions that are real active Marketing members.
  const { members } = await marketingMembers()
  const memberIds = new Set(members.map((m) => m.id))
  const validMentions = (parsed.data.mentions ?? []).filter((id) => memberIds.has(id))
  const comment = await prisma.marketingTaskComment.create({
    data: { taskId: task.id, authorId: req.user!.id, body: parsed.data.body, mentions: validMentions },
    include: { author: { select: { id: true, name: true } } },
  })
  // Notify mentioned teammates (self-mentions skipped inside the helper).
  await notifyMentions({
    mentionIds: validMentions,
    actorId: comment.author.id,
    actorName: comment.author.name,
    taskTitle: task.title,
    link: `/app/marketing/board?task=${task.id}`,
    entityType: 'MarketingTask',
    entityId: task.id,
  })
  res.status(201).json({ comment: serializeComment(comment) })
}

const createSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(2000).optional(),
  discipline: z.nativeEnum(MarketingDiscipline),
  status: z.nativeEnum(TaskStatus).optional(),
  priority: z.nativeEnum(Priority).optional(),
  assigneeId: z.string().nullable().optional(),
  contentType: z.nativeEnum(ContentType).nullable().optional(),
  platform: z.nativeEnum(SocialPlatform).nullable().optional(),
  brandId: z.string().nullable().optional(),
  wordTarget: z.number().int().min(0).nullable().optional(),
  dueDate: z.string().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  scheduledDate: z.string().nullable().optional(),
})

/** POST /api/marketing/tasks */
export async function createTask(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const v = parsed.data
  const task = await prisma.marketingTask.create({
    data: {
      title: v.title,
      description: v.description ?? null,
      discipline: v.discipline,
      status: v.status ?? 'BACKLOG',
      priority: v.priority ?? 'MEDIUM',
      assigneeId: v.assigneeId ?? null,
      contentType: v.contentType ?? null,
      platform: v.platform ?? null,
      brandId: v.brandId ?? null,
      wordTarget: v.wordTarget ?? null,
      dueDate: v.dueDate ? dbDateFromString(v.dueDate) : null,
      dueAt: v.dueAt ? new Date(v.dueAt) : null,
      scheduledDate: v.scheduledDate ? dbDateFromString(v.scheduledDate) : null,
    },
    include: { assignee: { select: { id: true, name: true } }, brand: { select: { id: true, name: true } } },
  })
  if (task.assigneeId) await fireAssignment(task.id, task.title, task.assigneeId, actor)
  res.status(201).json({ task: serialize(task) })
}

const updateSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(2000).nullable().optional(),
  discipline: z.nativeEnum(MarketingDiscipline).optional(),
  status: z.nativeEnum(TaskStatus).optional(),
  priority: z.nativeEnum(Priority).optional(),
  order: z.number().int().optional(),
  assigneeId: z.string().nullable().optional(),
  contentType: z.nativeEnum(ContentType).nullable().optional(),
  platform: z.nativeEnum(SocialPlatform).nullable().optional(),
  brandId: z.string().nullable().optional(),
  wordCount: z.number().int().min(0).nullable().optional(),
  wordTarget: z.number().int().min(0).nullable().optional(),
  dueDate: z.string().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  scheduledDate: z.string().nullable().optional(),
  publishedDate: z.string().nullable().optional(),
})

/** PATCH /api/marketing/tasks/:id — edit fields or move (status/order) on the board. */
export async function updateTask(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  const parsed = updateSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  // Scope: a member can only touch their own task; a sub-dept lead only their discipline.
  const existing = await prisma.marketingTask.findFirst({ where: { AND: [{ id: req.params.id }, scopeWhere(actor)] } })
  if (!existing) {
    res.status(404).json({ error: 'Task not found' })
    return
  }
  const v = parsed.data
  const data: Prisma.MarketingTaskUpdateInput = {}
  if (v.title !== undefined) data.title = v.title
  if (v.description !== undefined) data.description = v.description
  if (v.discipline !== undefined) data.discipline = v.discipline
  if (v.status !== undefined) data.status = v.status
  if (v.priority !== undefined) data.priority = v.priority
  if (v.order !== undefined) data.order = v.order
  if (v.assigneeId !== undefined) data.assignee = v.assigneeId ? { connect: { id: v.assigneeId } } : { disconnect: true }
  if (v.contentType !== undefined) data.contentType = v.contentType
  if (v.platform !== undefined) data.platform = v.platform
  if (v.brandId !== undefined) data.brand = v.brandId ? { connect: { id: v.brandId } } : { disconnect: true }
  if (v.wordCount !== undefined) data.wordCount = v.wordCount
  if (v.wordTarget !== undefined) data.wordTarget = v.wordTarget
  if (v.dueDate !== undefined) data.dueDate = v.dueDate ? dbDateFromString(v.dueDate) : null
  if (v.dueAt !== undefined) {
    data.dueAt = v.dueAt ? new Date(v.dueAt) : null
    data.dueReminderSentAt = null // rescheduling re-arms the reminder
  }
  if (v.scheduledDate !== undefined) data.scheduledDate = v.scheduledDate ? dbDateFromString(v.scheduledDate) : null
  if (v.publishedDate !== undefined) data.publishedDate = v.publishedDate ? dbDateFromString(v.publishedDate) : null

  // Convenience: stamp the calendar date when a card lands in a dated column.
  if (v.status === 'PUBLISHED' && !existing.publishedDate && v.publishedDate === undefined) {
    data.publishedDate = dbDateFromString(companyToday())
  }
  if (v.status === 'SCHEDULED' && !existing.scheduledDate && v.scheduledDate === undefined) {
    data.scheduledDate = dbDateFromString(companyToday())
  }

  // Stamp completion the first time a card reaches PUBLISHED; clear it if reopened.
  if (v.status !== undefined && v.status !== existing.status) {
    if (v.status === 'PUBLISHED') data.completedAt = new Date()
    else if (existing.status === 'PUBLISHED') data.completedAt = null
  }

  const task = await prisma.marketingTask.update({
    where: { id: req.params.id },
    data,
    include: {
      assignee: { select: { id: true, name: true } },
      brand: { select: { id: true, name: true } },
      _count: { select: { comments: true, attachments: true } },
    },
  })
  // Notify + email when the task was (re)assigned to a different, non-null person.
  if (v.assigneeId !== undefined && v.assigneeId && v.assigneeId !== existing.assigneeId) {
    await fireAssignment(task.id, task.title, v.assigneeId, actor)
  }
  res.json({ task: serialize(task) })
}

/** DELETE /api/marketing/tasks/:id — scoped: only within the actor's visibility. */
export async function deleteTask(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  // deleteMany with the scope filter is a no-op (not an error) if out of scope.
  await prisma.marketingTask.deleteMany({ where: { AND: [{ id: req.params.id }, scopeWhere(actor)] } })
  res.status(204).end()
}

/**
 * GET /api/marketing/team — the marketing team tree: members grouped by sub-department,
 * each with their open + total assigned-task counts. Read-only org view for the team.
 */
const SUBDEPT_ORDER = ['social', 'content', 'seo', 'ads', 'email']
export async function getTeam(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  const deptId = actor.deptId
  if (!deptId) { res.json({ groups: [] }); return }

  const [subDepts, members] = await Promise.all([
    prisma.subDepartment.findMany({ where: { departmentId: deptId }, select: { id: true, name: true, slug: true } }),
    prisma.user.findMany({
      where: { departmentId: deptId, isActive: true },
      select: { id: true, name: true, role: true, subDepartment: { select: { slug: true, name: true } } },
      orderBy: { name: 'asc' },
    }),
  ])

  // Open (non-PUBLISHED) + total assigned-task tallies per member.
  const memberIds = members.map((m) => m.id)
  const grouped = memberIds.length
    ? await prisma.marketingTask.groupBy({ by: ['assigneeId', 'status'], where: { assigneeId: { in: memberIds } }, _count: { _all: true } })
    : []
  const openBy = new Map<string, number>()
  const totalBy = new Map<string, number>()
  for (const g of grouped) {
    if (!g.assigneeId) continue
    totalBy.set(g.assigneeId, (totalBy.get(g.assigneeId) ?? 0) + g._count._all)
    if (g.status !== 'PUBLISHED') openBy.set(g.assigneeId, (openBy.get(g.assigneeId) ?? 0) + g._count._all)
  }

  type M = (typeof members)[number]
  const mem = (m: M) => ({ id: m.id, name: m.name, role: m.role, subDeptSlug: m.subDepartment?.slug ?? null, openTasks: openBy.get(m.id) ?? 0, totalTasks: totalBy.get(m.id) ?? 0 })

  const bySlug = new Map<string, M[]>()
  const noSub: M[] = []
  for (const m of members) {
    const s = m.subDepartment?.slug
    if (!s) { noSub.push(m); continue }
    const arr = bySlug.get(s) ?? []
    arr.push(m)
    bySlug.set(s, arr)
  }
  const rank = (slug: string) => { const i = SUBDEPT_ORDER.indexOf(slug); return i === -1 ? 99 : i }
  const groups = [...subDepts]
    .sort((a, b) => rank(a.slug) - rank(b.slug) || a.name.localeCompare(b.name))
    .map((sd) => {
      const ms = bySlug.get(sd.slug) ?? []
      const lead = ms.find((m) => m.role === 'SUB_DEPT_LEAD') ?? null
      return { slug: sd.slug, name: sd.name, lead: lead ? { id: lead.id, name: lead.name } : null, members: ms.map(mem) }
    })
  // Leads / members with no sub-department shown first as "Team Leads".
  if (noSub.length) groups.unshift({ slug: 'leadership', name: 'Team Leads', lead: null, members: noSub.map(mem) })

  res.json({ groups })
}

// ---------- Board-card attachments (media/files on a MarketingTask) ----------

/** GET /api/marketing/tasks/:id/attachments — files on a task the actor can see. */
export async function listTaskAttachments(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  const task = await prisma.marketingTask.findFirst({ where: { AND: [{ id: req.params.id }, scopeWhere(actor)] }, select: { id: true } })
  if (!task) { res.status(404).json({ error: 'Task not found' }); return }
  const rows = await prisma.entryAttachment.findMany({ where: { taskId: task.id }, orderBy: { createdAt: 'asc' } })
  res.json({ attachments: rows.map(serializeAttachment) })
}

/** POST /api/marketing/tasks/:id/attachments — raw binary body (express.raw), ?name= for the filename. */
export async function uploadTaskAttachment(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  const task = await prisma.marketingTask.findFirst({ where: { AND: [{ id: req.params.id }, scopeWhere(actor)] }, select: { id: true } })
  if (!task) { res.status(404).json({ error: 'Task not found' }); return }

  const buf = req.body as Buffer
  if (!Buffer.isBuffer(buf) || buf.length === 0) { res.status(400).json({ error: 'No file received' }); return }
  if (buf.length > MAX_ATT_BYTES) { res.status(413).json({ error: 'File is larger than 25 MB' }); return }
  const originalName = String(req.query.name || 'file').slice(0, 200).replace(/[\r\n]/g, '').trim() || 'file'
  const ext = path.extname(originalName).replace('.', '').toLowerCase()
  if (BLOCKED_EXT.has(ext)) { res.status(415).json({ error: 'That file type is not allowed' }); return }

  await fs.mkdir(UPLOAD_DIR, { recursive: true })
  const storedName = `${randomUUID()}${ext ? `.${ext}` : ''}`
  await fs.writeFile(path.join(UPLOAD_DIR, storedName), buf)

  const row = await prisma.entryAttachment.create({
    data: {
      userId: actor.me.id, kind: 'MARKETING_TASK', taskId: task.id, date: null,
      storedName, originalName, mimeType: req.headers['content-type'] || 'application/octet-stream', size: buf.length,
    },
  })
  res.status(201).json({ attachment: serializeAttachment(row) })
}

/** GET /api/marketing/attachments/:id/download — streamed if the actor can see its task. */
export async function downloadTaskAttachment(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  const att = await prisma.entryAttachment.findFirst({
    where: { id: req.params.id, kind: 'MARKETING_TASK', task: { is: scopeWhere(actor) } },
  })
  if (!att) { res.status(404).json({ error: 'Attachment not found' }); return }
  const filePath = path.join(UPLOAD_DIR, att.storedName)
  try { await fs.access(filePath) } catch { res.status(404).json({ error: 'File missing on server' }); return }
  res.setHeader('Content-Type', att.mimeType)
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(att.originalName)}"`)
  res.sendFile(filePath)
}

/** DELETE /api/marketing/attachments/:id — uploader, or a lead within scope. */
export async function deleteTaskAttachment(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  const att = await prisma.entryAttachment.findFirst({
    where: { id: req.params.id, kind: 'MARKETING_TASK', task: { is: scopeWhere(actor) } },
  })
  if (!att) { res.status(404).json({ error: 'Attachment not found' }); return }
  if (att.userId !== actor.me.id && !actor.isLead) { res.status(403).json({ error: 'Forbidden' }); return }
  await prisma.entryAttachment.delete({ where: { id: att.id } })
  await fs.rm(path.join(UPLOAD_DIR, att.storedName), { force: true }).catch(() => undefined)
  res.status(204).end()
}
