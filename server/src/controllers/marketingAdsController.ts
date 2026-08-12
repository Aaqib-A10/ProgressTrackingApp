import type { Response } from 'express'
import { z } from 'zod'
import { AdPlatform, AdCampaignType, AdCampaignStatus, type Prisma, type AdCampaign } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { resolveMarketingActor, type MarketingActor } from '../lib/marketingAuth'
import { companyToday } from '../lib/time'

const MONTH_RE = /^\d{4}-\d{2}$/
const currentMonth = () => companyToday().slice(0, 7)

function serialize(c: AdCampaign & { brand?: { name: string } | null }) {
  return {
    id: c.id,
    brandId: c.brandId,
    brand: c.brand ? { id: c.brandId, name: c.brand.name } : undefined,
    platform: c.platform,
    month: c.month,
    title: c.title,
    campaignType: c.campaignType,
    status: c.status,
    leads: c.leads,
    businessLeads: c.businessLeads,
    conversions: c.conversions,
    spend: c.spend,
    impressions: c.impressions,
    clicks: c.clicks,
  }
}

async function brandInDept(actor: MarketingActor, brandId: string) {
  const brand = await prisma.brand.findUnique({ where: { id: brandId } })
  return brand && brand.departmentId === actor.deptId ? brand : null
}

/** GET /api/marketing/ads?brandId=&platform=&month= */
export async function listAds(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  const where: Prisma.AdCampaignWhereInput = { brand: { departmentId: actor.deptId ?? undefined } }
  if (req.query.brandId) where.brandId = String(req.query.brandId)
  const platformQ = String(req.query.platform ?? '')
  if (platformQ in AdPlatform) where.platform = platformQ as AdPlatform
  if (req.query.month) where.month = String(req.query.month)
  const campaigns = await prisma.adCampaign.findMany({
    where,
    include: { brand: { select: { name: true } } },
    orderBy: [{ conversions: 'desc' }, { leads: 'desc' }, { title: 'asc' }],
  })
  res.json({ campaigns: campaigns.map(serialize) })
}

/** GET /api/marketing/ads/summary?brandId=&platform=&month= — totals + best campaigns computed from the rows. */
export async function adsSummary(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  const month = String(req.query.month || currentMonth())
  if (!MONTH_RE.test(month)) {
    res.status(400).json({ error: 'month must be YYYY-MM' })
    return
  }
  const where: Prisma.AdCampaignWhereInput = { brand: { departmentId: actor.deptId ?? undefined }, month }
  if (req.query.brandId) where.brandId = String(req.query.brandId)
  const platformQ = String(req.query.platform ?? '')
  if (platformQ in AdPlatform) where.platform = platformQ as AdPlatform
  const rows = await prisma.adCampaign.findMany({ where })

  const best = (pick: (c: AdCampaign) => number) =>
    rows.reduce<AdCampaign | null>((top, c) => (top && pick(top) >= pick(c) ? top : pick(c) > 0 ? c : top), null)
  const bestPerforming = best((c) => c.leads)
  const bestConversion = best((c) => c.conversions)

  res.json({
    month,
    activeCampaigns: rows.filter((c) => c.status === 'ACTIVE').length,
    totalCampaigns: rows.length,
    bestPerforming: bestPerforming ? { title: bestPerforming.title, leads: bestPerforming.leads } : null,
    bestConversion: bestConversion ? { title: bestConversion.title, conversions: bestConversion.conversions } : null,
    totalLeads: rows.reduce((a, c) => a + c.leads, 0),
    totalBusinessLeads: rows.reduce((a, c) => a + c.businessLeads, 0),
    totalConversions: rows.reduce((a, c) => a + c.conversions, 0),
    totalSpend: rows.reduce((a, c) => a + c.spend, 0),
  })
}

const createSchema = z.object({
  brandId: z.string().min(1),
  platform: z.nativeEnum(AdPlatform),
  month: z.string().regex(MONTH_RE).optional(),
  title: z.string().min(1).max(300),
  campaignType: z.nativeEnum(AdCampaignType).optional(),
  status: z.nativeEnum(AdCampaignStatus).optional(),
  leads: z.number().int().min(0).optional(),
  businessLeads: z.number().int().min(0).optional(),
  conversions: z.number().int().min(0).optional(),
  spend: z.number().int().min(0).optional(),
  impressions: z.number().int().min(0).optional(),
  clicks: z.number().int().min(0).optional(),
})

/** POST /api/marketing/ads — ads team, lead or admin. */
export async function createAd(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  if (!actor.canWriteAds) {
    res.status(403).json({ error: 'Ads team, Team Lead or Admin only' })
    return
  }
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const brand = await brandInDept(actor, parsed.data.brandId)
  if (!brand) {
    res.status(404).json({ error: 'Brand not found' })
    return
  }
  const d = parsed.data
  const campaign = await prisma.adCampaign.create({
    data: {
      brandId: brand.id,
      platform: d.platform,
      month: d.month || currentMonth(),
      title: d.title,
      campaignType: d.campaignType ?? 'OTHER',
      status: d.status ?? 'ACTIVE',
      leads: d.leads ?? 0,
      businessLeads: d.businessLeads ?? 0,
      conversions: d.conversions ?? 0,
      spend: d.spend ?? 0,
      impressions: d.impressions ?? 0,
      clicks: d.clicks ?? 0,
      createdById: actor.me.id,
    },
    include: { brand: { select: { name: true } } },
  })
  res.status(201).json({ campaign: serialize(campaign) })
}

const updateSchema = z.object({
  brandId: z.string().optional(),
  platform: z.nativeEnum(AdPlatform).optional(),
  month: z.string().regex(MONTH_RE).optional(),
  title: z.string().min(1).max(300).optional(),
  campaignType: z.nativeEnum(AdCampaignType).optional(),
  status: z.nativeEnum(AdCampaignStatus).optional(),
  leads: z.number().int().min(0).optional(),
  businessLeads: z.number().int().min(0).optional(),
  conversions: z.number().int().min(0).optional(),
  spend: z.number().int().min(0).optional(),
  impressions: z.number().int().min(0).optional(),
  clicks: z.number().int().min(0).optional(),
})

/** PATCH /api/marketing/ads/:id */
export async function updateAd(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  if (!actor.canWriteAds) {
    res.status(403).json({ error: 'Ads team, Team Lead or Admin only' })
    return
  }
  const existing = await prisma.adCampaign.findUnique({ where: { id: req.params.id }, include: { brand: true } })
  if (!existing || existing.brand.departmentId !== actor.deptId) {
    res.status(404).json({ error: 'Campaign not found' })
    return
  }
  const parsed = updateSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const d = parsed.data
  if (d.brandId && !(await brandInDept(actor, d.brandId))) {
    res.status(404).json({ error: 'Brand not found' })
    return
  }
  const campaign = await prisma.adCampaign.update({
    where: { id: existing.id },
    data: {
      ...(d.brandId ? { brandId: d.brandId } : {}),
      ...(d.platform ? { platform: d.platform } : {}),
      ...(d.month ? { month: d.month } : {}),
      ...(d.title != null ? { title: d.title } : {}),
      ...(d.campaignType ? { campaignType: d.campaignType } : {}),
      ...(d.status ? { status: d.status } : {}),
      ...(d.leads !== undefined ? { leads: d.leads } : {}),
      ...(d.businessLeads !== undefined ? { businessLeads: d.businessLeads } : {}),
      ...(d.conversions !== undefined ? { conversions: d.conversions } : {}),
      ...(d.spend !== undefined ? { spend: d.spend } : {}),
      ...(d.impressions !== undefined ? { impressions: d.impressions } : {}),
      ...(d.clicks !== undefined ? { clicks: d.clicks } : {}),
    },
    include: { brand: { select: { name: true } } },
  })
  res.json({ campaign: serialize(campaign) })
}

/** DELETE /api/marketing/ads/:id */
export async function deleteAd(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  if (!actor.canWriteAds) {
    res.status(403).json({ error: 'Ads team, Team Lead or Admin only' })
    return
  }
  const existing = await prisma.adCampaign.findUnique({ where: { id: req.params.id }, include: { brand: true } })
  if (!existing || existing.brand.departmentId !== actor.deptId) {
    res.status(404).json({ error: 'Campaign not found' })
    return
  }
  await prisma.adCampaign.delete({ where: { id: existing.id } })
  res.status(204).end()
}
