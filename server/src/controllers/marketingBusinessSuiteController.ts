import type { Response } from 'express'
import { z } from 'zod'
import type { BusinessSuite } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { resolveMarketingActor } from '../lib/marketingAuth'

type SuiteWithCount = BusinessSuite & { _count?: { profiles: number } }

const SUITE_INCLUDE = { _count: { select: { profiles: true } } } as const

function serialize(s: SuiteWithCount) {
  return {
    id: s.id,
    name: s.name,
    businessManagerId: s.businessManagerId,
    url: s.url,
    profileCount: s._count?.profiles ?? 0,
  }
}

/** GET /api/marketing/business-suites — Meta Business Suites for the dept. */
export async function listBusinessSuites(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  if (!actor.deptId) {
    res.json({ suites: [] })
    return
  }
  const suites = await prisma.businessSuite.findMany({
    where: { departmentId: actor.deptId },
    orderBy: { name: 'asc' },
    include: SUITE_INCLUDE,
  })
  res.json({ suites: suites.map(serialize) })
}

const createSchema = z.object({
  name: z.string().min(1).max(120),
  businessManagerId: z.string().max(100).nullable().optional(),
  url: z.string().max(500).nullable().optional(),
})

/** POST /api/marketing/business-suites — lead/admin only. */
export async function createBusinessSuite(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  if (!actor.isLead) {
    res.status(403).json({ error: 'Only a Team Lead or Admin can manage Business Suites' })
    return
  }
  if (!actor.deptId) {
    res.status(400).json({ error: 'Marketing department not found' })
    return
  }
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const d = parsed.data
  // Names are unique within the department.
  const clash = await prisma.businessSuite.findFirst({ where: { departmentId: actor.deptId, name: d.name } })
  if (clash) {
    res.status(400).json({ error: 'A Business Suite with that name already exists' })
    return
  }
  const suite = await prisma.businessSuite.create({
    data: { departmentId: actor.deptId, name: d.name, businessManagerId: d.businessManagerId || null, url: d.url || null },
    include: SUITE_INCLUDE,
  })
  res.status(201).json({ suite: serialize(suite) })
}

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  businessManagerId: z.string().max(100).nullable().optional(),
  url: z.string().max(500).nullable().optional(),
})

/** PATCH /api/marketing/business-suites/:id — lead/admin only. */
export async function updateBusinessSuite(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  if (!actor.isLead) {
    res.status(403).json({ error: 'Only a Team Lead or Admin can manage Business Suites' })
    return
  }
  const existing = await prisma.businessSuite.findUnique({ where: { id: req.params.id } })
  if (!existing || existing.departmentId !== actor.deptId) {
    res.status(404).json({ error: 'Business Suite not found' })
    return
  }
  const parsed = updateSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const d = parsed.data
  if (d.name && d.name !== existing.name) {
    const clash = await prisma.businessSuite.findFirst({ where: { departmentId: existing.departmentId, name: d.name, id: { not: existing.id } } })
    if (clash) {
      res.status(400).json({ error: 'A Business Suite with that name already exists' })
      return
    }
  }
  const updated = await prisma.businessSuite.update({
    where: { id: existing.id },
    data: {
      ...(d.name ? { name: d.name } : {}),
      ...(d.businessManagerId !== undefined ? { businessManagerId: d.businessManagerId || null } : {}),
      ...(d.url !== undefined ? { url: d.url || null } : {}),
    },
    include: SUITE_INCLUDE,
  })
  res.json({ suite: serialize(updated) })
}

/** DELETE /api/marketing/business-suites/:id — lead/admin only. Unlinks profiles (SetNull). */
export async function deleteBusinessSuite(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  if (!actor.isLead) {
    res.status(403).json({ error: 'Only a Team Lead or Admin can manage Business Suites' })
    return
  }
  const existing = await prisma.businessSuite.findUnique({ where: { id: req.params.id } })
  if (!existing || existing.departmentId !== actor.deptId) {
    res.status(404).json({ error: 'Business Suite not found' })
    return
  }
  await prisma.businessSuite.delete({ where: { id: existing.id } })
  res.status(204).end()
}
