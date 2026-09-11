import type { Response } from 'express'
import { z } from 'zod'
import type { BrandProfile } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { resolveMarketingActor } from '../lib/marketingAuth'

/** Profile + optional owner name and Business Suite name for the registry view. */
type ProfileWithOwner = BrandProfile & { owner?: { name: string } | null; businessSuite?: { name: string } | null }

const PROFILE_INCLUDE = { owner: { select: { name: true } }, businessSuite: { select: { name: true } } } as const

function serialize(p: ProfileWithOwner) {
  return {
    id: p.id,
    brandId: p.brandId,
    platform: p.platform,
    handle: p.handle,
    url: p.url,
    status: p.status,
    managedVia: p.managedVia,
    businessSuiteId: p.businessSuiteId,
    businessSuiteName: p.businessSuite?.name ?? null,
    ownerId: p.ownerId,
    ownerName: p.owner?.name ?? null,
    note: p.note,
    updatedAt: p.updatedAt.toISOString(),
  }
}

/** True if the Business Suite exists in the actor's Marketing dept. */
async function suiteInDept(suiteId: string, deptId: string): Promise<boolean> {
  const s = await prisma.businessSuite.findUnique({ where: { id: suiteId } })
  return !!s && s.departmentId === deptId
}

const PLATFORM = z.enum([
  'FACEBOOK', 'INSTAGRAM', 'LINKEDIN', 'X', 'REDDIT', 'YOUTUBE', 'TIKTOK', 'WEBSITE', 'GOOGLE_BUSINESS', 'OTHER',
])
const STATUS = z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED'])
const MANAGED_VIA = z.enum(['MIXPOST', 'MANUAL'])

/** True if the user is currently in the Marketing department (guards owner assignment). */
async function ownerInMarketing(userId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({ where: { id: userId }, include: { department: true } })
  return u?.department?.type === 'MARKETING'
}

/** Load a brand and confirm it belongs to the actor's Marketing dept, else 404. */
async function brandInDept(brandId: string, deptId: string): Promise<boolean> {
  const b = await prisma.brand.findUnique({ where: { id: brandId } })
  return !!b && b.departmentId === deptId
}

/** GET /api/marketing/profiles?brandId=&all=1 — platform profiles for a brand (or the whole dept). */
export async function listProfiles(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  if (!actor.deptId) {
    res.json({ profiles: [] })
    return
  }
  const brandId = typeof req.query.brandId === 'string' ? req.query.brandId : undefined
  const includeArchived = req.query.all === '1'
  if (brandId && !(await brandInDept(brandId, actor.deptId))) {
    res.status(404).json({ error: 'Brand not found' })
    return
  }
  const profiles = await prisma.brandProfile.findMany({
    where: {
      // Scope to the dept via the brand relation; narrow to one brand when asked.
      brand: { departmentId: actor.deptId },
      ...(brandId ? { brandId } : {}),
      ...(includeArchived ? {} : { status: { not: 'ARCHIVED' } }),
    },
    orderBy: [{ brandId: 'asc' }, { platform: 'asc' }],
    include: PROFILE_INCLUDE,
  })
  res.json({ profiles: profiles.map(serialize) })
}

const createSchema = z.object({
  brandId: z.string().min(1),
  platform: PLATFORM,
  handle: z.string().max(200).nullable().optional(),
  url: z.string().max(500).nullable().optional(),
  status: STATUS.optional(),
  managedVia: MANAGED_VIA.optional(),
  businessSuiteId: z.string().nullable().optional(),
  ownerId: z.string().nullable().optional(),
  note: z.string().max(1000).nullable().optional(),
})

/** POST /api/marketing/profiles — lead/admin only. */
export async function createProfile(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  if (!actor.isLead) {
    res.status(403).json({ error: 'Only a Team Lead or Admin can manage profiles' })
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
  if (d.ownerId && !(await ownerInMarketing(d.ownerId))) {
    res.status(400).json({ error: 'Owner must be a Marketing team member' })
    return
  }
  if (d.businessSuiteId && !(await suiteInDept(d.businessSuiteId, actor.deptId))) {
    res.status(400).json({ error: 'Business Suite not found' })
    return
  }
  const profile = await prisma.brandProfile.create({
    data: {
      brandId: d.brandId,
      platform: d.platform,
      handle: d.handle || null,
      url: d.url || null,
      status: d.status ?? 'ACTIVE',
      managedVia: d.managedVia ?? 'MANUAL',
      businessSuiteId: d.businessSuiteId || null,
      ownerId: d.ownerId || null,
      note: d.note || null,
    },
    include: PROFILE_INCLUDE,
  })
  res.status(201).json({ profile: serialize(profile) })
}

const updateSchema = z.object({
  platform: PLATFORM.optional(),
  handle: z.string().max(200).nullable().optional(),
  url: z.string().max(500).nullable().optional(),
  status: STATUS.optional(),
  managedVia: MANAGED_VIA.optional(),
  businessSuiteId: z.string().nullable().optional(),
  ownerId: z.string().nullable().optional(),
  note: z.string().max(1000).nullable().optional(),
})

/** PATCH /api/marketing/profiles/:id — lead/admin only. */
export async function updateProfile(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  if (!actor.isLead) {
    res.status(403).json({ error: 'Only a Team Lead or Admin can manage profiles' })
    return
  }
  const existing = await prisma.brandProfile.findUnique({ where: { id: req.params.id }, include: { brand: true } })
  if (!existing || existing.brand.departmentId !== actor.deptId) {
    res.status(404).json({ error: 'Profile not found' })
    return
  }
  const parsed = updateSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const d = parsed.data
  if (d.ownerId && !(await ownerInMarketing(d.ownerId))) {
    res.status(400).json({ error: 'Owner must be a Marketing team member' })
    return
  }
  if (d.businessSuiteId && !(await suiteInDept(d.businessSuiteId, actor.deptId))) {
    res.status(400).json({ error: 'Business Suite not found' })
    return
  }
  const updated = await prisma.brandProfile.update({
    where: { id: existing.id },
    data: {
      ...(d.platform ? { platform: d.platform } : {}),
      ...(d.handle !== undefined ? { handle: d.handle || null } : {}),
      ...(d.url !== undefined ? { url: d.url || null } : {}),
      ...(d.status ? { status: d.status } : {}),
      ...(d.managedVia ? { managedVia: d.managedVia } : {}),
      ...(d.businessSuiteId !== undefined ? { businessSuiteId: d.businessSuiteId || null } : {}),
      ...(d.ownerId !== undefined ? { ownerId: d.ownerId || null } : {}),
      ...(d.note !== undefined ? { note: d.note || null } : {}),
    },
    include: PROFILE_INCLUDE,
  })
  res.json({ profile: serialize(updated) })
}

/** DELETE /api/marketing/profiles/:id — hard delete (ARCHIVED status covers keep-but-inactive). */
export async function deleteProfile(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  if (!actor.isLead) {
    res.status(403).json({ error: 'Only a Team Lead or Admin can manage profiles' })
    return
  }
  const existing = await prisma.brandProfile.findUnique({ where: { id: req.params.id }, include: { brand: true } })
  if (!existing || existing.brand.departmentId !== actor.deptId) {
    res.status(404).json({ error: 'Profile not found' })
    return
  }
  await prisma.brandProfile.delete({ where: { id: existing.id } })
  res.status(204).end()
}
