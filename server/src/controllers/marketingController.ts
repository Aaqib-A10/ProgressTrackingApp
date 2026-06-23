import type { Response } from 'express'
import { z } from 'zod'
import { MarketingDiscipline, TaskStatus, ContentType, type MarketingTask, type Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { companyToday, dbDateFromString, dateStringFromDb } from '../lib/time'

const STATUS_ORDER: TaskStatus[] = ['BACKLOG', 'IN_PROGRESS', 'IN_REVIEW', 'SCHEDULED', 'PUBLISHED']

const STATUS_LABEL: Record<TaskStatus, string> = {
  BACKLOG: 'Backlog',
  IN_PROGRESS: 'In Progress',
  IN_REVIEW: 'In Review',
  SCHEDULED: 'Scheduled',
  PUBLISHED: 'Published',
}

type TaskWithAssignee = MarketingTask & { assignee: { id: string; name: string } | null }

function loadUser(id: string) {
  return prisma.user.findUniqueOrThrow({ where: { id }, include: { department: true } })
}

/** Marketing dept members (any role) and Super Admin may use the board. */
async function assertMarketing(req: AuthedRequest, res: Response): Promise<boolean> {
  const me = await loadUser(req.user!.id)
  if (me.department?.type === 'MARKETING' || me.role === 'SUPER_ADMIN') return true
  res.status(403).json({ error: 'Marketing access only' })
  return false
}

const dateStr = (d: Date | null) => (d ? dateStringFromDb(d) : null)

function serialize(t: TaskWithAssignee) {
  return {
    id: t.id,
    title: t.title,
    description: t.description ?? '',
    discipline: t.discipline,
    status: t.status,
    order: t.order,
    assignee: t.assignee,
    contentType: t.contentType,
    wordCount: t.wordCount,
    wordTarget: t.wordTarget,
    dueDate: dateStr(t.dueDate),
    scheduledDate: dateStr(t.scheduledDate),
    publishedDate: dateStr(t.publishedDate),
  }
}

/** GET /api/marketing/board?discipline= — tasks grouped into columns. */
export async function getBoard(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await assertMarketing(req, res))) return
  const discipline = req.query.discipline as MarketingDiscipline | undefined

  const tasks = await prisma.marketingTask.findMany({
    where: discipline ? { discipline } : {},
    include: { assignee: { select: { id: true, name: true } } },
    orderBy: [{ order: 'asc' }, { updatedAt: 'asc' }],
  })

  const columns = STATUS_ORDER.map((status) => ({
    status,
    label: STATUS_LABEL[status],
    tasks: tasks.filter((t) => t.status === status).map(serialize),
  }))
  res.json({ columns })
}

const createSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(2000).optional(),
  discipline: z.nativeEnum(MarketingDiscipline),
  status: z.nativeEnum(TaskStatus).optional(),
  assigneeId: z.string().nullable().optional(),
  contentType: z.nativeEnum(ContentType).nullable().optional(),
  wordTarget: z.number().int().min(0).nullable().optional(),
  dueDate: z.string().nullable().optional(),
  scheduledDate: z.string().nullable().optional(),
})

/** POST /api/marketing/tasks */
export async function createTask(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await assertMarketing(req, res))) return
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
      assigneeId: v.assigneeId ?? null,
      contentType: v.contentType ?? null,
      wordTarget: v.wordTarget ?? null,
      dueDate: v.dueDate ? dbDateFromString(v.dueDate) : null,
      scheduledDate: v.scheduledDate ? dbDateFromString(v.scheduledDate) : null,
    },
    include: { assignee: { select: { id: true, name: true } } },
  })
  res.status(201).json({ task: serialize(task) })
}

const updateSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(2000).nullable().optional(),
  status: z.nativeEnum(TaskStatus).optional(),
  order: z.number().int().optional(),
  assigneeId: z.string().nullable().optional(),
  contentType: z.nativeEnum(ContentType).nullable().optional(),
  wordCount: z.number().int().min(0).nullable().optional(),
  wordTarget: z.number().int().min(0).nullable().optional(),
  dueDate: z.string().nullable().optional(),
  scheduledDate: z.string().nullable().optional(),
  publishedDate: z.string().nullable().optional(),
})

/** PATCH /api/marketing/tasks/:id — edit fields or move (status/order) on the board. */
export async function updateTask(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await assertMarketing(req, res))) return
  const parsed = updateSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const existing = await prisma.marketingTask.findUnique({ where: { id: req.params.id } })
  if (!existing) {
    res.status(404).json({ error: 'Task not found' })
    return
  }
  const v = parsed.data
  const data: Prisma.MarketingTaskUpdateInput = {}
  if (v.title !== undefined) data.title = v.title
  if (v.description !== undefined) data.description = v.description
  if (v.status !== undefined) data.status = v.status
  if (v.order !== undefined) data.order = v.order
  if (v.assigneeId !== undefined) data.assignee = v.assigneeId ? { connect: { id: v.assigneeId } } : { disconnect: true }
  if (v.contentType !== undefined) data.contentType = v.contentType
  if (v.wordCount !== undefined) data.wordCount = v.wordCount
  if (v.wordTarget !== undefined) data.wordTarget = v.wordTarget
  if (v.dueDate !== undefined) data.dueDate = v.dueDate ? dbDateFromString(v.dueDate) : null
  if (v.scheduledDate !== undefined) data.scheduledDate = v.scheduledDate ? dbDateFromString(v.scheduledDate) : null
  if (v.publishedDate !== undefined) data.publishedDate = v.publishedDate ? dbDateFromString(v.publishedDate) : null

  // Convenience: stamp the calendar date when a card lands in a dated column.
  if (v.status === 'PUBLISHED' && !existing.publishedDate && v.publishedDate === undefined) {
    data.publishedDate = dbDateFromString(companyToday())
  }
  if (v.status === 'SCHEDULED' && !existing.scheduledDate && v.scheduledDate === undefined) {
    data.scheduledDate = dbDateFromString(companyToday())
  }

  const task = await prisma.marketingTask.update({
    where: { id: req.params.id },
    data,
    include: { assignee: { select: { id: true, name: true } } },
  })
  res.json({ task: serialize(task) })
}

/** DELETE /api/marketing/tasks/:id */
export async function deleteTask(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await assertMarketing(req, res))) return
  await prisma.marketingTask.delete({ where: { id: req.params.id } }).catch(() => undefined)
  res.status(204).end()
}
