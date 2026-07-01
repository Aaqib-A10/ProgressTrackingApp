import type { Response } from 'express'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { companyToday, dbDateFromString, dateStringFromDb, periodRange, type RangeKey } from '../lib/time'

function loadUser(id: string) {
  return prisma.user.findUniqueOrThrow({ where: { id }, include: { department: true } })
}

/** Caller is an Ecommerce member (or Super Admin). */
function isEcommerce(me: Awaited<ReturnType<typeof loadUser>>): boolean {
  return me.department?.type === 'ECOMMERCE' || me.role === 'SUPER_ADMIN'
}

/** Resolve the Ecommerce department for the caller, or null if not allowed. */
async function ecommerceDept(me: Awaited<ReturnType<typeof loadUser>>) {
  if (me.department?.type === 'ECOMMERCE') return me.department
  if (me.role === 'SUPER_ADMIN') return prisma.department.findUnique({ where: { type: 'ECOMMERCE' } })
  return null
}

function deptTags(departmentId: string, type: 'TASK_TYPE' | 'MARKETPLACE') {
  return prisma.tag.findMany({ where: { departmentId, type, isActive: true }, orderBy: { createdAt: 'asc' } })
}

/** Group the Ecommerce field (TASK_TYPE) tags by their Type, in seed order. */
function buildTypes(fieldTags: { id: string; name: string; group: string | null }[]) {
  const byType = new Map<string, { name: string; fields: { id: string; name: string }[] }>()
  for (const t of fieldTags) {
    const g = t.group ?? 'Other'
    if (!byType.has(g)) byType.set(g, { name: g, fields: [] })
    byType.get(g)!.fields.push({ id: t.id, name: t.name })
  }
  return [...byType.values()]
}

type EntryWithLines = Prisma.EcommerceDailyEntryGetPayload<{
  include: { lines: { include: { taskType: true; marketplace: true } } }
}>

function serializeEntry(e: EntryWithLines) {
  return {
    id: e.id,
    date: dateStringFromDb(e.date),
    status: e.status,
    notes: e.notes ?? '',
    lines: e.lines.map((l) => ({ taskTypeId: l.taskTypeId, marketplaceId: l.marketplaceId, listings: l.listings })),
    totalListings: e.lines.reduce((s, l) => s + l.listings, 0),
  }
}

// ============================ Daily listings log ============================

/** GET /api/ecommerce/entries?date= — my entry for the day + the tag option lists. */
export async function getMyEntry(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (!isEcommerce(me)) {
    res.status(403).json({ error: 'Not an Ecommerce member' })
    return
  }
  const dept = await ecommerceDept(me)
  if (!dept) {
    res.status(500).json({ error: 'Ecommerce department missing' })
    return
  }
  const dateStr = (req.query.date as string) || companyToday()

  const [entry, taskTypes, marketplaces, recent] = await Promise.all([
    prisma.ecommerceDailyEntry.findUnique({
      where: { userId_date: { userId: me.id, date: dbDateFromString(dateStr) } },
      include: { lines: { include: { taskType: true, marketplace: true } } },
    }),
    deptTags(dept.id, 'TASK_TYPE'),
    deptTags(dept.id, 'MARKETPLACE'),
    prisma.ecommerceDailyEntry.findMany({
      where: { userId: me.id, status: 'SUBMITTED' },
      orderBy: { date: 'desc' },
      take: 14,
      include: { lines: true },
    }),
  ])

  const recentDays = recent.length
  const recentListings = recent.reduce((s, e) => s + e.lines.reduce((t, l) => t + l.listings, 0), 0)

  res.json({
    date: dateStr,
    entry: entry ? serializeEntry(entry) : null,
    types: buildTypes(taskTypes),
    marketplaces: marketplaces.map((m) => ({ id: m.id, name: m.name })),
    stats: { avgListings: recentDays ? Math.round(recentListings / recentDays) : 0, daysLogged: recentDays },
  })
}

const lineRow = z.object({
  taskTypeId: z.string(),
  marketplaceId: z.string(),
  listings: z.number().int().min(0).max(100000),
})
const upsertSchema = z.object({
  date: z.string().optional(),
  status: z.enum(['SUBMITTED', 'ON_LEAVE', 'HOLIDAY', 'OFF']).default('SUBMITTED'),
  notes: z.string().max(2000).optional(),
  lines: z.array(lineRow).max(200).optional(),
})

/** PUT /api/ecommerce/entries — upsert the day's report + replace its lines. */
export async function upsertMyEntry(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (!isEcommerce(me)) {
    res.status(403).json({ error: 'Not an Ecommerce member' })
    return
  }
  const dept = await ecommerceDept(me)
  if (!dept) {
    res.status(500).json({ error: 'Ecommerce department missing' })
    return
  }
  const parsed = upsertSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const { date, status, notes, lines } = parsed.data
  const dateStr = date || companyToday()
  if (dateStr > companyToday()) {
    res.status(400).json({ error: 'Cannot log a future date' })
    return
  }

  const dateValue = dbDateFromString(dateStr)
  const existing = await prisma.ecommerceDailyEntry.findUnique({ where: { userId_date: { userId: me.id, date: dateValue } } })

  const entry = await prisma.ecommerceDailyEntry.upsert({
    where: { userId_date: { userId: me.id, date: dateValue } },
    update: { status, notes: notes ?? null },
    create: { userId: me.id, date: dateValue, status, notes: notes ?? null },
  })

  // Replace the lines — only valid dept tags, only on submitted days.
  await prisma.ecommerceListingLine.deleteMany({ where: { entryId: entry.id } })
  if (status === 'SUBMITTED' && lines?.length) {
    const [taskTypes, marketplaces] = await Promise.all([deptTags(dept.id, 'TASK_TYPE'), deptTags(dept.id, 'MARKETPLACE')])
    const taskIds = new Set(taskTypes.map((t) => t.id))
    const mpIds = new Set(marketplaces.map((m) => m.id))
    const rows = lines.filter((l) => l.listings > 0 && taskIds.has(l.taskTypeId) && mpIds.has(l.marketplaceId))
    if (rows.length) {
      await prisma.ecommerceListingLine.createMany({
        data: rows.map((l) => ({ entryId: entry.id, taskTypeId: l.taskTypeId, marketplaceId: l.marketplaceId, listings: l.listings })),
      })
    }
  }

  await prisma.auditLog.create({
    data: { userId: me.id, entityType: 'EcommerceDailyEntry', entityId: entry.id, action: existing ? 'UPDATE' : 'CREATE', after: { status, lines: lines ?? [] } },
  })

  const full = await prisma.ecommerceDailyEntry.findUniqueOrThrow({
    where: { id: entry.id },
    include: { lines: { include: { taskType: true, marketplace: true } } },
  })
  res.status(existing ? 200 : 201).json({ entry: serializeEntry(full) })
}

// ============================ Team view (whole team) ============================

/** GET /api/ecommerce/team?range= — team tasks + per-agent listing totals + marketplace
 *  breakdown. Visible to the whole Ecommerce team (the team works together). */
export async function teamView(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.department?.type !== 'ECOMMERCE' && me.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const dept = await prisma.department.findUnique({ where: { type: 'ECOMMERCE' } })
  if (!dept) {
    res.status(500).json({ error: 'Ecommerce department missing' })
    return
  }

  const rangeKey = ((req.query.range as RangeKey) || 'month') as RangeKey
  const range = periodRange(rangeKey, { start: req.query.start as string, end: req.query.end as string })
  const todayStr = companyToday()

  const members = await prisma.user.findMany({
    where: { departmentId: dept.id, role: { in: ['MEMBER', 'SUB_DEPT_LEAD', 'TEAM_LEAD'] }, isActive: true },
    orderBy: { name: 'asc' },
  })
  const memberIds = members.map((m) => m.id)

  const [entries, openStock, taskRows] = await Promise.all([
    prisma.ecommerceDailyEntry.findMany({
      where: { userId: { in: memberIds }, date: { gte: dbDateFromString(range.startDate), lte: dbDateFromString(range.endDate) } },
      include: { lines: { include: { marketplace: true, taskType: true } } },
    }),
    prisma.stockRequest.count({ where: { departmentId: dept.id, status: { not: 'RESOLVED' } } }),
    prisma.ecommerceTask.findMany({ include: { assignedTo: { select: { id: true, name: true } } }, orderBy: [{ status: 'asc' }, { order: 'asc' }] }),
  ])

  const byUser = new Map<string, typeof entries>()
  for (const e of entries) (byUser.get(e.userId) ?? byUser.set(e.userId, []).get(e.userId)!).push(e)

  const marketplaceTotals = new Map<string, number>()
  const typeTotals = new Map<string, { total: number; byMarketplace: Map<string, number> }>()
  const agents = members.map((m) => {
    const es = byUser.get(m.id) ?? []
    const submitted = es.filter((e) => e.status === 'SUBMITTED')
    const perMp = new Map<string, number>()
    let total = 0
    for (const e of submitted) for (const l of e.lines) {
      total += l.listings
      perMp.set(l.marketplace.name, (perMp.get(l.marketplace.name) ?? 0) + l.listings)
      marketplaceTotals.set(l.marketplace.name, (marketplaceTotals.get(l.marketplace.name) ?? 0) + l.listings)
      const g = l.taskType.group ?? 'Other'
      const tt = typeTotals.get(g) ?? { total: 0, byMarketplace: new Map<string, number>() }
      tt.total += l.listings
      tt.byMarketplace.set(l.marketplace.name, (tt.byMarketplace.get(l.marketplace.name) ?? 0) + l.listings)
      typeTotals.set(g, tt)
    }
    const todayEntry = es.find((e) => dateStringFromDb(e.date) === todayStr)
    const onLeaveToday = !!todayEntry && todayEntry.status !== 'SUBMITTED'
    let status: 'SUBMITTED' | 'PENDING' | 'ON_LEAVE'
    if (onLeaveToday) status = 'ON_LEAVE'
    else if (rangeKey === 'today') status = todayEntry ? 'SUBMITTED' : 'PENDING'
    else status = submitted.length ? 'SUBMITTED' : 'PENDING'
    return { id: m.id, name: m.name, status, onLeaveToday, daysLogged: submitted.length, totalListings: total, byMarketplace: Object.fromEntries(perMp) }
  })

  const teamTotal = agents.reduce((s, a) => s + a.totalListings, 0)
  const byMarketplace = [...marketplaceTotals.entries()].map(([name, listings]) => ({ name, listings })).sort((a, b) => b.listings - a.listings)
  const byType = [...typeTotals.entries()]
    .map(([type, v]) => ({ type, total: v.total, byMarketplace: [...v.byMarketplace.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value) }))
    .sort((a, b) => b.total - a.total)
  const topAgents = [...agents].sort((a, b) => b.totalListings - a.totalListings).slice(0, 3).map((a) => ({ id: a.id, name: a.name, listings: a.totalListings }))

  const tasks = taskRows.map(serializeTask)
  res.json({
    range: { ...range, key: rangeKey },
    team: {
      totalActions: teamTotal, totalListings: teamTotal, agents: agents.length, openStockRequests: openStock, topMarketplace: byMarketplace[0]?.name ?? null,
      tasksTodo: tasks.filter((t) => t.status === 'TODO').length,
      tasksInProgress: tasks.filter((t) => t.status === 'IN_PROGRESS').length,
      tasksDone: tasks.filter((t) => t.status === 'DONE').length,
    },
    byMarketplace,
    byType,
    agents,
    topAgents,
    tasks,
  })
}

// ============================ Task board (Kanban) ============================

const ECOM_STATUSES = ['TODO', 'IN_PROGRESS', 'DONE'] as const
type EcomStatus = (typeof ECOM_STATUSES)[number]
const STATUS_LABEL: Record<EcomStatus, string> = { TODO: 'To Do', IN_PROGRESS: 'In Progress', DONE: 'Done' }

/** Caller is the Ecommerce HOD (Team Lead of the dept) or Super Admin. */
function isHod(me: Awaited<ReturnType<typeof loadUser>>): boolean {
  return me.role === 'SUPER_ADMIN' || (me.role === 'TEAM_LEAD' && me.department?.type === 'ECOMMERCE')
}

function serializeTask(t: Prisma.EcommerceTaskGetPayload<{ include: { assignedTo: { select: { id: true; name: true } } } }>) {
  return {
    id: t.id, title: t.title, description: t.description ?? '', source: t.source ?? '',
    status: t.status, order: t.order,
    assignee: t.assignedTo ? { id: t.assignedTo.id, name: t.assignedTo.name } : null,
    dueDate: t.dueDate ? dateStringFromDb(t.dueDate) : null,
  }
}

async function ecommerceMembers(departmentId: string) {
  return prisma.user.findMany({
    where: { departmentId, role: { in: ['MEMBER', 'SUB_DEPT_LEAD', 'TEAM_LEAD'] }, isActive: true },
    select: { id: true, name: true }, orderBy: { name: 'asc' },
  })
}

/** GET /api/ecommerce/board — all team tasks grouped by status + member list for assignment. */
export async function getBoard(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (!isEcommerce(me)) { res.status(403).json({ error: 'Not an Ecommerce member' }); return }
  const dept = await ecommerceDept(me)
  if (!dept) { res.status(500).json({ error: 'Ecommerce department missing' }); return }

  const [tasks, members] = await Promise.all([
    prisma.ecommerceTask.findMany({ include: { assignedTo: { select: { id: true, name: true } } }, orderBy: [{ order: 'asc' }, { updatedAt: 'asc' }] }),
    ecommerceMembers(dept.id),
  ])
  const columns = ECOM_STATUSES.map((status) => ({
    status, label: STATUS_LABEL[status],
    tasks: tasks.filter((t) => t.status === status).map(serializeTask),
  }))
  res.json({ columns, members })
}

const taskCreateSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(2000).optional(),
  source: z.string().max(200).optional(),
  assignedToId: z.string().nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
})

/** POST /api/ecommerce/tasks — HOD creates & assigns a task. */
export async function createTask(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (!isHod(me)) { res.status(403).json({ error: 'Only the HOD can create tasks' }); return }
  const parsed = taskCreateSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }); return }
  const v = parsed.data
  const max = await prisma.ecommerceTask.aggregate({ where: { status: 'TODO' }, _max: { order: true } })
  const task = await prisma.ecommerceTask.create({
    data: {
      title: v.title, description: v.description ?? null, source: v.source ?? null,
      assignedToId: v.assignedToId || null, dueDate: v.dueDate ? dbDateFromString(v.dueDate) : null,
      createdById: me.id, status: 'TODO', order: (max._max.order ?? 0) + 1,
    },
    include: { assignedTo: { select: { id: true, name: true } } },
  })
  res.status(201).json({ task: serializeTask(task) })
}

const taskUpdateSchema = z.object({
  status: z.enum(ECOM_STATUSES).optional(),
  order: z.number().int().optional(),
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().max(2000).nullable().optional(),
  source: z.string().max(200).nullable().optional(),
  assignedToId: z.string().nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
})

/** PATCH /api/ecommerce/tasks/:id — move (assignee or HOD) or edit (HOD only). */
export async function updateTask(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (!isEcommerce(me)) { res.status(403).json({ error: 'Not an Ecommerce member' }); return }
  const parsed = taskUpdateSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }); return }
  const v = parsed.data
  const task = await prisma.ecommerceTask.findUnique({ where: { id: req.params.id } })
  if (!task) { res.status(404).json({ error: 'Task not found' }); return }

  // A board move only touches status/order — allowed for the assignee or the HOD.
  const moveOnly = Object.keys(v).every((k) => k === 'status' || k === 'order')
  const allowed = isHod(me) || (moveOnly && task.assignedToId === me.id)
  if (!allowed) { res.status(403).json({ error: 'Only the HOD can edit task details' }); return }

  const data: Prisma.EcommerceTaskUpdateInput = {}
  if (v.status !== undefined) data.status = v.status
  if (v.order !== undefined) data.order = v.order
  if (isHod(me)) {
    if (v.title !== undefined) data.title = v.title
    if (v.description !== undefined) data.description = v.description
    if (v.source !== undefined) data.source = v.source
    if (v.assignedToId !== undefined) data.assignedTo = v.assignedToId ? { connect: { id: v.assignedToId } } : { disconnect: true }
    if (v.dueDate !== undefined) data.dueDate = v.dueDate ? dbDateFromString(v.dueDate) : null
  }
  const updated = await prisma.ecommerceTask.update({ where: { id: task.id }, data, include: { assignedTo: { select: { id: true, name: true } } } })
  res.json({ task: serializeTask(updated) })
}

/** DELETE /api/ecommerce/tasks/:id — HOD only. */
export async function deleteTask(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (!isHod(me)) { res.status(403).json({ error: 'Only the HOD can delete tasks' }); return }
  await prisma.ecommerceTask.delete({ where: { id: req.params.id } })
  res.status(204).end()
}

// ============================ Stock tracking ============================

function serializeStock(s: Prisma.StockRequestGetPayload<{ include: { assignedTo: { select: { id: true; name: true } } } }>) {
  return {
    id: s.id, itemName: s.itemName, requestedByName: s.requestedByName, note: s.note ?? '',
    requestedAt: s.requestedAt.toISOString(), status: s.status, action: s.action,
    assignee: s.assignedTo ? { id: s.assignedTo.id, name: s.assignedTo.name } : null,
    assignedAt: s.assignedAt ? s.assignedAt.toISOString() : null,
    resolvedAt: s.resolvedAt ? s.resolvedAt.toISOString() : null,
  }
}

/** GET /api/ecommerce/stock — dept stock requests + members (for assignment). */
export async function listStock(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (!isEcommerce(me)) { res.status(403).json({ error: 'Not an Ecommerce member' }); return }
  const dept = await ecommerceDept(me)
  if (!dept) { res.status(500).json({ error: 'Ecommerce department missing' }); return }
  const [requests, members] = await Promise.all([
    prisma.stockRequest.findMany({ where: { departmentId: dept.id }, include: { assignedTo: { select: { id: true, name: true } } }, orderBy: [{ status: 'asc' }, { requestedAt: 'desc' }] }),
    ecommerceMembers(dept.id),
  ])
  res.json({ requests: requests.map(serializeStock), members, canAssign: isHod(me) })
}

const stockCreateSchema = z.object({
  itemName: z.string().trim().min(1).max(200),
  requestedByName: z.string().trim().min(1).max(120),
  note: z.string().max(1000).optional(),
})

/** POST /api/ecommerce/stock — any Ecommerce member logs an out-of-stock item. */
export async function createStock(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (!isEcommerce(me)) { res.status(403).json({ error: 'Not an Ecommerce member' }); return }
  const dept = await ecommerceDept(me)
  if (!dept) { res.status(500).json({ error: 'Ecommerce department missing' }); return }
  const parsed = stockCreateSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }); return }
  const s = await prisma.stockRequest.create({
    data: { departmentId: dept.id, itemName: parsed.data.itemName, requestedByName: parsed.data.requestedByName, note: parsed.data.note ?? null },
    include: { assignedTo: { select: { id: true, name: true } } },
  })
  await prisma.auditLog.create({ data: { userId: me.id, entityType: 'StockRequest', entityId: s.id, action: 'CREATE', after: { itemName: s.itemName, requestedByName: s.requestedByName } } })
  res.status(201).json({ request: serializeStock(s) })
}

const stockAssignSchema = z.object({ action: z.enum(['STOCK_IN', 'STOCK_OUT']), assignedToId: z.string() })

/** PATCH /api/ecommerce/stock/:id/assign — HOD assigns a stock-in/out action to an agent. */
export async function assignStock(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (!isHod(me)) { res.status(403).json({ error: 'Only the HOD can assign stock tasks' }); return }
  const parsed = stockAssignSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }); return }
  const existing = await prisma.stockRequest.findUnique({ where: { id: req.params.id } })
  if (!existing) { res.status(404).json({ error: 'Request not found' }); return }
  const s = await prisma.stockRequest.update({
    where: { id: existing.id },
    data: { action: parsed.data.action, assignedToId: parsed.data.assignedToId, assignedById: me.id, assignedAt: new Date(), status: 'ASSIGNED' },
    include: { assignedTo: { select: { id: true, name: true } } },
  })
  await prisma.auditLog.create({ data: { userId: me.id, entityType: 'StockRequest', entityId: s.id, action: 'UPDATE', after: { status: 'ASSIGNED', action: s.action, assignedToId: s.assignedToId } } })
  res.json({ request: serializeStock(s) })
}

/** PATCH /api/ecommerce/stock/:id/resolve — assignee or HOD marks it resolved. */
export async function resolveStock(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (!isEcommerce(me)) { res.status(403).json({ error: 'Not an Ecommerce member' }); return }
  const existing = await prisma.stockRequest.findUnique({ where: { id: req.params.id } })
  if (!existing) { res.status(404).json({ error: 'Request not found' }); return }
  if (!isHod(me) && existing.assignedToId !== me.id) { res.status(403).json({ error: 'Only the assignee or HOD can resolve this' }); return }
  const s = await prisma.stockRequest.update({
    where: { id: existing.id },
    data: { status: 'RESOLVED', resolvedAt: new Date() },
    include: { assignedTo: { select: { id: true, name: true } } },
  })
  await prisma.auditLog.create({ data: { userId: me.id, entityType: 'StockRequest', entityId: s.id, action: 'UPDATE', after: { status: 'RESOLVED' } } })
  res.json({ request: serializeStock(s) })
}
