import type { Response } from 'express'
import { z } from 'zod'
import type { Prisma, PlanItemStatus } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { resolveMarketingActor, type MarketingActor } from '../lib/marketingAuth'
import { companyToday, dbDateFromString, dateStringFromDb } from '../lib/time'

const MONTH_RE = /^\d{4}-\d{2}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const currentMonth = () => companyToday().slice(0, 7)
const STATUSES: PlanItemStatus[] = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'PENDING']

type ItemWithRefs = Prisma.MarketingPlanItemGetPayload<{ include: { brand: true; owner: { select: { id: true; name: true } } } }>
function serializeItem(i: ItemWithRefs) {
  return {
    id: i.id,
    title: i.title,
    taskType: i.taskType,
    brand: i.brand ? { id: i.brand.id, name: i.brand.name } : null,
    owner: i.owner,
    stakeholder: i.stakeholder,
    status: i.status,
    plannedDate: i.plannedDate ? dateStringFromDb(i.plannedDate) : null,
    completionDate: i.completionDate ? dateStringFromDb(i.completionDate) : null,
    documentLink: i.documentLink,
    order: i.order,
  }
}

function progress(items: { status: PlanItemStatus }[]) {
  const total = items.length
  const done = items.filter((i) => i.status === 'COMPLETED').length
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 }
}

/** Resolve the "content" sub-department id for the Marketing dept (used to scope the plan). */
async function contentSubDeptId(deptId: string | null): Promise<string | null> {
  if (!deptId) return null
  const sd = await prisma.subDepartment.findFirst({ where: { departmentId: deptId, slug: 'content' } })
  return sd?.id ?? null
}

/** GET /api/marketing/plan?month= — the plan + items + progress for the month (content sub-dept). */
export async function getPlan(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  const month = String(req.query.month || currentMonth())
  if (!MONTH_RE.test(month)) {
    res.status(400).json({ error: 'month must be YYYY-MM' })
    return
  }
  const subDepartmentId = await contentSubDeptId(actor.deptId)
  const plan = await prisma.marketingPlan.findFirst({
    where: { departmentId: actor.deptId ?? undefined, subDepartmentId, month },
    include: { items: { include: { brand: true, owner: { select: { id: true, name: true } } }, orderBy: { order: 'asc' } } },
  })
  res.json({
    month,
    plan: plan ? { id: plan.id, month: plan.month, title: plan.title } : null,
    items: plan ? plan.items.map(serializeItem) : [],
    progress: progress(plan?.items ?? []),
    canEdit: actor.canWriteContent,
  })
}

/** Get or create the content-sub-dept plan for a month. */
async function ensurePlan(actor: MarketingActor, month: string) {
  const subDepartmentId = await contentSubDeptId(actor.deptId)
  const existing = await prisma.marketingPlan.findFirst({ where: { departmentId: actor.deptId!, subDepartmentId, month } })
  if (existing) return existing
  return prisma.marketingPlan.create({
    data: { departmentId: actor.deptId!, subDepartmentId, month, createdById: actor.me.id },
  })
}

const itemSchema = z.object({
  month: z.string().regex(MONTH_RE),
  title: z.string().min(1).max(400),
  taskType: z.string().max(120).optional(),
  brandId: z.string().nullable().optional(),
  ownerId: z.string().nullable().optional(),
  stakeholder: z.string().max(200).nullable().optional(),
  status: z.enum(STATUSES as [PlanItemStatus, ...PlanItemStatus[]]).optional(),
  plannedDate: z.string().regex(DATE_RE).nullable().optional(),
  completionDate: z.string().regex(DATE_RE).nullable().optional(),
  documentLink: z.string().max(600).nullable().optional(),
})

/** POST /api/marketing/plan/items — add an item (creates the plan if missing). */
export async function addPlanItem(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  if (!actor.canWriteContent) {
    res.status(403).json({ error: 'Content team, Team Lead or Admin only' })
    return
  }
  if (!actor.deptId) {
    res.status(400).json({ error: 'Marketing department not found' })
    return
  }
  const parsed = itemSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const d = parsed.data
  const plan = await ensurePlan(actor, d.month)
  const max = await prisma.marketingPlanItem.aggregate({ where: { planId: plan.id }, _max: { order: true } })
  const item = await prisma.marketingPlanItem.create({
    data: {
      planId: plan.id,
      title: d.title,
      taskType: d.taskType || null,
      brandId: d.brandId || null,
      ownerId: d.ownerId || null,
      stakeholder: d.stakeholder || null,
      status: d.status ?? 'PLANNED',
      plannedDate: d.plannedDate ? dbDateFromString(d.plannedDate) : null,
      completionDate: d.completionDate ? dbDateFromString(d.completionDate) : null,
      documentLink: d.documentLink || null,
      order: (max._max.order ?? -1) + 1,
    },
    include: { brand: true, owner: { select: { id: true, name: true } } },
  })
  res.status(201).json({ item: serializeItem(item) })
}

const patchSchema = itemSchema.partial().omit({ month: true })

/** PATCH /api/marketing/plan/items/:id */
export async function updatePlanItem(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  if (!actor.canWriteContent) {
    res.status(403).json({ error: 'Content team, Team Lead or Admin only' })
    return
  }
  const existing = await prisma.marketingPlanItem.findUnique({ where: { id: req.params.id }, include: { plan: true } })
  if (!existing || existing.plan.departmentId !== actor.deptId) {
    res.status(404).json({ error: 'Item not found' })
    return
  }
  const parsed = patchSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const d = parsed.data
  const item = await prisma.marketingPlanItem.update({
    where: { id: existing.id },
    data: {
      ...(d.title != null ? { title: d.title } : {}),
      ...(d.taskType !== undefined ? { taskType: d.taskType || null } : {}),
      ...(d.brandId !== undefined ? { brandId: d.brandId || null } : {}),
      ...(d.ownerId !== undefined ? { ownerId: d.ownerId || null } : {}),
      ...(d.stakeholder !== undefined ? { stakeholder: d.stakeholder || null } : {}),
      ...(d.status != null ? { status: d.status } : {}),
      ...(d.plannedDate !== undefined ? { plannedDate: d.plannedDate ? dbDateFromString(d.plannedDate) : null } : {}),
      ...(d.completionDate !== undefined ? { completionDate: d.completionDate ? dbDateFromString(d.completionDate) : null } : {}),
      ...(d.documentLink !== undefined ? { documentLink: d.documentLink || null } : {}),
    },
    include: { brand: true, owner: { select: { id: true, name: true } } },
  })
  res.json({ item: serializeItem(item) })
}

/** DELETE /api/marketing/plan/items/:id */
export async function deletePlanItem(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  if (!actor.canWriteContent) {
    res.status(403).json({ error: 'Content team, Team Lead or Admin only' })
    return
  }
  const existing = await prisma.marketingPlanItem.findUnique({ where: { id: req.params.id }, include: { plan: true } })
  if (!existing || existing.plan.departmentId !== actor.deptId) {
    res.status(404).json({ error: 'Item not found' })
    return
  }
  await prisma.marketingPlanItem.delete({ where: { id: existing.id } })
  res.status(204).end()
}
