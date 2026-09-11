import type { Response } from 'express'
import { z } from 'zod'
import type { Brand } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { resolveMarketingActor } from '../lib/marketingAuth'

/** Brand + optional owner name and a profile-count breakdown for the registry view. */
type BrandWithExtras = Brand & {
  owner?: { name: string } | null
  _count?: { profiles: number }
  profiles?: { status: string }[]
  searchTerms?: { status: string }[]
}

function serialize(b: BrandWithExtras) {
  const activeProfiles = b.profiles?.filter((p) => p.status === 'ACTIVE').length
  return {
    id: b.id, name: b.name, slug: b.slug, website: b.website, isActive: b.isActive,
    tier: b.tier,
    ownerId: b.ownerId, ownerName: b.owner?.name ?? null,
    crmProvider: b.crmProvider, crmStatus: b.crmStatus,
    crmAccount: b.crmAccount, crmNote: b.crmNote,
    crmConnected: b.crmStatus === 'CONNECTED',
    crmCheckedAt: b.crmCheckedAt?.toISOString() ?? null,
    profileCount: b._count?.profiles ?? 0,
    activeProfiles: activeProfiles ?? 0,
    // SEO search-term pages: goal + live count (live = status LIVE) for the ratio.
    searchTermTarget: b.searchTermTarget,
    searchTermsTotal: b.searchTerms?.length ?? 0,
    searchTermsLive: b.searchTerms?.filter((t) => t.status === 'LIVE').length ?? 0,
    gscSiteUrl: b.gscSiteUrl, ga4PropertyId: b.ga4PropertyId,
    seoConnected: !!(b.gscSiteUrl || b.ga4PropertyId),
    seoSyncedAt: b.seoSyncedAt?.toISOString() ?? null,
  }
}

/** Shared include so create/update/list all serialize with owner name + profile counts. */
const BRAND_INCLUDE = {
  owner: { select: { name: true } },
  _count: { select: { profiles: true } },
  profiles: { select: { status: true } },
  searchTerms: { select: { status: true } },
} as const

/** True if the user is currently in the Marketing department (guards owner assignment). */
async function ownerInMarketing(userId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({ where: { id: userId }, include: { department: true } })
  return u?.department?.type === 'MARKETING'
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
    include: BRAND_INCLUDE,
  })
  res.json({ brands: brands.map(serialize) })
}

const TIER = z.enum(['TIER_1', 'TIER_2', 'MAINTENANCE'])
const CRM_PROVIDER = z.enum(['HUBSPOT', 'SALESFORCE', 'ZOHO', 'PIPEDRIVE', 'MONDAY', 'OTHER'])
const CRM_STATUS = z.enum(['NONE', 'PLANNED', 'IN_PROGRESS', 'CONNECTED'])

const createSchema = z.object({
  name: z.string().min(1).max(120),
  website: z.string().max(300).optional(),
  tier: TIER.optional(),
  ownerId: z.string().nullable().optional(),
  crmProvider: CRM_PROVIDER.nullable().optional(),
  crmStatus: CRM_STATUS.optional(),
  crmAccount: z.string().max(300).nullable().optional(),
  crmNote: z.string().max(1000).nullable().optional(),
  searchTermTarget: z.number().int().min(0).max(100000).nullable().optional(),
})

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
  const d = parsed.data
  if (d.ownerId && !(await ownerInMarketing(d.ownerId))) {
    res.status(400).json({ error: 'Owner must be a Marketing team member' })
    return
  }
  const slug = await uniqueSlug(actor.deptId, d.name)
  const brand = await prisma.brand.create({
    data: {
      departmentId: actor.deptId,
      name: d.name,
      slug,
      website: d.website || null,
      ...(d.tier ? { tier: d.tier } : {}),
      ...(d.ownerId !== undefined ? { ownerId: d.ownerId || null } : {}),
      ...(d.crmProvider !== undefined ? { crmProvider: d.crmProvider } : {}),
      ...(d.crmStatus ? { crmStatus: d.crmStatus, crmCheckedAt: new Date() } : {}),
      ...(d.crmAccount !== undefined ? { crmAccount: d.crmAccount || null } : {}),
      ...(d.crmNote !== undefined ? { crmNote: d.crmNote || null } : {}),
      ...(d.searchTermTarget !== undefined ? { searchTermTarget: d.searchTermTarget } : {}),
    },
    include: BRAND_INCLUDE,
  })
  res.status(201).json({ brand: serialize(brand) })
}

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  website: z.string().max(300).nullable().optional(),
  isActive: z.boolean().optional(),
  tier: TIER.optional(),
  ownerId: z.string().nullable().optional(),
  crmProvider: CRM_PROVIDER.nullable().optional(),
  crmStatus: CRM_STATUS.optional(),
  crmAccount: z.string().max(300).nullable().optional(),
  crmNote: z.string().max(1000).nullable().optional(),
  searchTermTarget: z.number().int().min(0).max(100000).nullable().optional(),
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
  if (data.ownerId && !(await ownerInMarketing(data.ownerId))) {
    res.status(400).json({ error: 'Owner must be a Marketing team member' })
    return
  }
  const slug = data.name && data.name !== brand.name ? await uniqueSlug(brand.departmentId, data.name, brand.id) : undefined
  // Stamp crmCheckedAt whenever the CRM status is (re)set.
  const crmTouched = data.crmStatus !== undefined
  const updated = await prisma.brand.update({
    where: { id: brand.id },
    data: {
      ...(data.name != null ? { name: data.name } : {}),
      ...(slug ? { slug } : {}),
      ...(data.website !== undefined ? { website: data.website || null } : {}),
      ...(data.isActive != null ? { isActive: data.isActive } : {}),
      ...(data.tier ? { tier: data.tier } : {}),
      ...(data.ownerId !== undefined ? { ownerId: data.ownerId || null } : {}),
      ...(data.crmProvider !== undefined ? { crmProvider: data.crmProvider } : {}),
      ...(data.crmStatus !== undefined ? { crmStatus: data.crmStatus } : {}),
      ...(crmTouched ? { crmCheckedAt: new Date() } : {}),
      ...(data.crmAccount !== undefined ? { crmAccount: data.crmAccount || null } : {}),
      ...(data.crmNote !== undefined ? { crmNote: data.crmNote || null } : {}),
      ...(data.searchTermTarget !== undefined ? { searchTermTarget: data.searchTermTarget } : {}),
      ...(data.gscSiteUrl !== undefined ? { gscSiteUrl: data.gscSiteUrl || null } : {}),
      ...(data.ga4PropertyId !== undefined ? { ga4PropertyId: data.ga4PropertyId || null } : {}),
    },
    include: BRAND_INCLUDE,
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
