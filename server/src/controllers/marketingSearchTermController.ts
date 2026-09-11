import type { Response } from 'express'
import { z } from 'zod'
import type { SearchTermPage } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { resolveMarketingActor } from '../lib/marketingAuth'

function serialize(t: SearchTermPage) {
  return {
    id: t.id,
    brandId: t.brandId,
    term: t.term,
    url: t.url,
    status: t.status,
    note: t.note,
    updatedAt: t.updatedAt.toISOString(),
  }
}

const STATUS = z.enum(['PLANNED', 'IN_PROGRESS', 'LIVE'])

/** Confirm the brand belongs to the actor's Marketing dept. */
async function brandInDept(brandId: string, deptId: string): Promise<boolean> {
  const b = await prisma.brand.findUnique({ where: { id: brandId } })
  return !!b && b.departmentId === deptId
}

/** GET /api/marketing/search-terms?brandId= — search-term pages for a brand. */
export async function listSearchTerms(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  if (!actor.deptId) {
    res.json({ pages: [] })
    return
  }
  const brandId = typeof req.query.brandId === 'string' ? req.query.brandId : undefined
  if (!brandId || !(await brandInDept(brandId, actor.deptId))) {
    res.status(404).json({ error: 'Brand not found' })
    return
  }
  const pages = await prisma.searchTermPage.findMany({
    where: { brandId },
    orderBy: [{ status: 'asc' }, { term: 'asc' }],
  })
  res.json({ pages: pages.map(serialize) })
}

const createSchema = z.object({
  brandId: z.string().min(1),
  term: z.string().min(1).max(300),
  url: z.string().max(500).nullable().optional(),
  status: STATUS.optional(),
  note: z.string().max(1000).nullable().optional(),
})

/** POST /api/marketing/search-terms — lead/admin only. */
export async function createSearchTerm(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  if (!actor.isLead) {
    res.status(403).json({ error: 'Only a Team Lead or Admin can manage search-term pages' })
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
  if (!(await brandInDept(d.brandId, actor.deptId))) {
    res.status(404).json({ error: 'Brand not found' })
    return
  }
  const page = await prisma.searchTermPage.create({
    data: {
      brandId: d.brandId,
      term: d.term.trim(),
      url: d.url || null,
      status: d.status ?? 'PLANNED',
      note: d.note || null,
    },
  })
  res.status(201).json({ page: serialize(page) })
}

const updateSchema = z.object({
  term: z.string().min(1).max(300).optional(),
  url: z.string().max(500).nullable().optional(),
  status: STATUS.optional(),
  note: z.string().max(1000).nullable().optional(),
})

/** PATCH /api/marketing/search-terms/:id — lead/admin only. */
export async function updateSearchTerm(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  if (!actor.isLead) {
    res.status(403).json({ error: 'Only a Team Lead or Admin can manage search-term pages' })
    return
  }
  const existing = await prisma.searchTermPage.findUnique({ where: { id: req.params.id }, include: { brand: true } })
  if (!existing || existing.brand.departmentId !== actor.deptId) {
    res.status(404).json({ error: 'Search-term page not found' })
    return
  }
  const parsed = updateSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const d = parsed.data
  const updated = await prisma.searchTermPage.update({
    where: { id: existing.id },
    data: {
      ...(d.term ? { term: d.term.trim() } : {}),
      ...(d.url !== undefined ? { url: d.url || null } : {}),
      ...(d.status ? { status: d.status } : {}),
      ...(d.note !== undefined ? { note: d.note || null } : {}),
    },
  })
  res.json({ page: serialize(updated) })
}

/** DELETE /api/marketing/search-terms/:id — lead/admin only. */
export async function deleteSearchTerm(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  if (!actor.isLead) {
    res.status(403).json({ error: 'Only a Team Lead or Admin can manage search-term pages' })
    return
  }
  const existing = await prisma.searchTermPage.findUnique({ where: { id: req.params.id }, include: { brand: true } })
  if (!existing || existing.brand.departmentId !== actor.deptId) {
    res.status(404).json({ error: 'Search-term page not found' })
    return
  }
  await prisma.searchTermPage.delete({ where: { id: existing.id } })
  res.status(204).end()
}
