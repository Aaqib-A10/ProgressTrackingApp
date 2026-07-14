import type { Response } from 'express'
import { z } from 'zod'
import type { Brand } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { resolveMarketingActor } from '../lib/marketingAuth'

function serialize(b: Brand) {
  return {
    id: b.id, name: b.name, slug: b.slug, website: b.website, isActive: b.isActive,
    gscSiteUrl: b.gscSiteUrl, ga4PropertyId: b.ga4PropertyId,
    seoConnected: !!(b.gscSiteUrl || b.ga4PropertyId),
    seoSyncedAt: b.seoSyncedAt?.toISOString() ?? null,
  }
}

function kebab(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'brand'
}

/** Unique slug within the department (append -2, -3, … on collision). */
async function uniqueSlug(departmentId: string, name: string, exceptId?: string): Promise<string> {
  const base = kebab(name)
  let slug = base
  let n = 2
  while (true) {
    const clash = await prisma.brand.findFirst({ where: { departmentId, slug, ...(exceptId ? { id: { not: exceptId } } : {}) } })
    if (!clash) return slug
    slug = `${base}-${n++}`
  }
}

/** GET /api/marketing/brands?all=1 — brands for the Marketing dept. */
export async function listBrands(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  if (!actor.deptId) {
    res.json({ brands: [] })
    return
  }
  const includeInactive = req.query.all === '1'
  const brands = await prisma.brand.findMany({
    where: { departmentId: actor.deptId, ...(includeInactive ? {} : { isActive: true }) },
    orderBy: { name: 'asc' },
  })
  res.json({ brands: brands.map(serialize) })
}

const createSchema = z.object({ name: z.string().min(1).max(120), website: z.string().max(300).optional() })

/** POST /api/marketing/brands — lead/admin only. */
export async function createBrand(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  if (!actor.isLead) {
    res.status(403).json({ error: 'Only a Team Lead or Admin can manage brands' })
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
  const slug = await uniqueSlug(actor.deptId, parsed.data.name)
  const brand = await prisma.brand.create({
    data: { departmentId: actor.deptId, name: parsed.data.name, slug, website: parsed.data.website || null },
  })
  res.status(201).json({ brand: serialize(brand) })
}

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  website: z.string().max(300).nullable().optional(),
  isActive: z.boolean().optional(),
  gscSiteUrl: z.string().max(300).nullable().optional(), // Search Console property
  ga4PropertyId: z.string().max(100).nullable().optional(), // GA4 property id
})

/** PATCH /api/marketing/brands/:id — lead/admin only. */
export async function updateBrand(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  if (!actor.isLead) {
    res.status(403).json({ error: 'Only a Team Lead or Admin can manage brands' })
    return
  }
  const brand = await prisma.brand.findUnique({ where: { id: req.params.id } })
  if (!brand || brand.departmentId !== actor.deptId) {
    res.status(404).json({ error: 'Brand not found' })
    return
  }
  const parsed = updateSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const data = parsed.data
  const slug = data.name && data.name !== brand.name ? await uniqueSlug(brand.departmentId, data.name, brand.id) : undefined
  const updated = await prisma.brand.update({
    where: { id: brand.id },
    data: {
      ...(data.name != null ? { name: data.name } : {}),
      ...(slug ? { slug } : {}),
      ...(data.website !== undefined ? { website: data.website || null } : {}),
      ...(data.isActive != null ? { isActive: data.isActive } : {}),
      ...(data.gscSiteUrl !== undefined ? { gscSiteUrl: data.gscSiteUrl || null } : {}),
      ...(data.ga4PropertyId !== undefined ? { ga4PropertyId: data.ga4PropertyId || null } : {}),
    },
  })
  res.json({ brand: serialize(updated) })
}

/** DELETE /api/marketing/brands/:id — soft-delete (isActive=false), never hard-delete. */
export async function deleteBrand(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  if (!actor.isLead) {
    res.status(403).json({ error: 'Only a Team Lead or Admin can manage brands' })
    return
  }
  const brand = await prisma.brand.findUnique({ where: { id: req.params.id } })
  if (!brand || brand.departmentId !== actor.deptId) {
    res.status(404).json({ error: 'Brand not found' })
    return
  }
  await prisma.brand.update({ where: { id: brand.id }, data: { isActive: false } })
  res.status(204).end()
}
