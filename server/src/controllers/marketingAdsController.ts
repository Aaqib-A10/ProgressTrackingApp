import type { Response } from 'express'
import { z } from 'zod'
import { AdPlatform, AdCampaignType, AdCampaignStatus, type Prisma, type AdCampaign } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { resolveMarketingActor, type MarketingActor } from '../lib/marketingAuth'
import { companyToday, dbDateFromString, dateStringFromDb } from '../lib/time'

const MONTH_RE = /^\d{4}-\d{2}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const currentMonth = () => companyToday().slice(0, 7)

/** Avg. cost per lead = spend ÷ leads (null when there are no leads). */
const cpl = (spend: number, leads: number): number | null => (leads > 0 ? spend / leads : null)

function serialize(c: AdCampaign & { brand?: { name: string } | null }) {
  const spend = Number(c.spend)
  return {
    id: c.id,
    brandId: c.brandId,
    brand: c.brand ? { id: c.brandId, name: c.brand.name } : undefined,
    platform: c.platform,
    month: c.month,
    date: c.date ? dateStringFromDb(c.date) : `${c.month}-01`,
    title: c.title,
    campaignType: c.campaignType,
    status: c.status,
    leads: c.leads,
    businessLeads: c.businessLeads,
    spend,
    avgCostPerLead: cpl(spend, c.leads),
    impressions: c.impressions,
    clicks: c.clicks,
  }
}

/** Shared brand/platform/month|date-range filter for the list + summary endpoints. */
function scopeWhere(req: AuthedRequest, actor: MarketingActor): Prisma.AdCampaignWhereInput {
  const where: Prisma.AdCampaignWhereInput = { brand: { departmentId: actor.deptId ?? undefined } }
  if (req.query.brandId) where.brandId = String(req.query.brandId)
  const platformQ = String(req.query.platform ?? '')
  if (platformQ in AdPlatform) where.platform = platformQ as AdPlatform
  const from = String(req.query.from ?? '')
  const to = String(req.query.to ?? '')
  if (DATE_RE.test(from) || DATE_RE.test(to)) {
    // Date-range filter takes precedence over the month bucket.
    where.date = {
      ...(DATE_RE.test(from) ? { gte: dbDateFromString(from) } : {}),
      ...(DATE_RE.test(to) ? { lte: dbDateFromString(to) } : {}),
    }
  } else if (req.query.month) {
    where.month = String(req.query.month)
  }
  return where
}

async function brandInDept(actor: MarketingActor, brandId: string) {
  const brand = await prisma.brand.findUnique({ where: { id: brandId } })
  return brand && brand.departmentId === actor.deptId ? brand : null
}

/** GET /api/marketing/ads?brandId=&platform=&month=&from=&to= */
export async function listAds(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  const campaigns = await prisma.adCampaign.findMany({
    where: scopeWhere(req, actor),
    include: { brand: { select: { name: true } } },
    orderBy: [{ date: 'desc' }, { leads: 'desc' }, { title: 'asc' }],
  })
  res.json({ campaigns: campaigns.map(serialize) })
}

/** GET /api/marketing/ads/summary?brandId=&platform=&month=&from=&to= — totals computed from the rows. */
export async function adsSummary(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  const hasRange = DATE_RE.test(String(req.query.from ?? '')) || DATE_RE.test(String(req.query.to ?? ''))
  const month = String(req.query.month || currentMonth())
  if (!hasRange && !MONTH_RE.test(month)) {
    res.status(400).json({ error: 'month must be YYYY-MM' })
    return
  }
  const rows = await prisma.adCampaign.findMany({ where: scopeWhere(req, actor) })

  const totalLeads = rows.reduce((a, c) => a + c.leads, 0)
  const totalSpend = rows.reduce((a, c) => a + Number(c.spend), 0)

  // Best performing = most leads. Best CPL = lowest cost per lead among campaigns with leads.
  const bestPerforming = rows.reduce<AdCampaign | null>((top, c) => (top && top.leads >= c.leads ? top : c.leads > 0 ? c : top), null)
  const withCpl = rows.filter((c) => c.leads > 0).map((c) => ({ c, v: Number(c.spend) / c.leads }))
  const bestCpl = withCpl.reduce<{ c: AdCampaign; v: number } | null>((best, x) => (best && best.v <= x.v ? best : x), null)

  res.json({
    month: hasRange ? null : month,
    activeCampaigns: rows.filter((c) => c.status === 'ACTIVE').length,
    totalCampaigns: rows.length,
    bestPerforming: bestPerforming ? { title: bestPerforming.title, leads: bestPerforming.leads } : null,
    bestCpl: bestCpl ? { title: bestCpl.c.title, cpl: bestCpl.v } : null,
    totalLeads,
    totalBusinessLeads: rows.reduce((a, c) => a + c.businessLeads, 0),
    totalSpend,
    avgCostPerLead: cpl(totalSpend, totalLeads),
  })
}

const createSchema = z.object({
  brandId: z.string().min(1),
  platform: z.nativeEnum(AdPlatform),
  month: z.string().regex(MONTH_RE).optional(),
  date: z.string().regex(DATE_RE).optional(),
  title: z.string().min(1).max(300),
  campaignType: z.nativeEnum(AdCampaignType).optional(),
  status: z.nativeEnum(AdCampaignStatus).optional(),
  leads: z.number().int().min(0).optional(),
  businessLeads: z.number().int().min(0).optional(),
  spend: z.number().min(0).optional(), // decimals allowed (currency, 2dp)
  impressions: z.number().int().min(0).optional(),
  clicks: z.number().int().min(0).optional(),
})

/** Resolve the campaign's date + month bucket from whatever the client sent. */
function resolveDateMonth(date?: string, month?: string): { dateStr: string; month: string } {
  const dateStr = date || (month ? `${month}-01` : companyToday())
  return { dateStr, month: dateStr.slice(0, 7) }
}

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
  const { dateStr, month } = resolveDateMonth(d.date, d.month)
  const campaign = await prisma.adCampaign.create({
    data: {
      brandId: brand.id,
      platform: d.platform,
      month,
      date: dbDateFromString(dateStr),
      title: d.title,
      campaignType: d.campaignType ?? 'OTHER',
      status: d.status ?? 'ACTIVE',
      leads: d.leads ?? 0,
      businessLeads: d.businessLeads ?? 0,
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
  date: z.string().regex(DATE_RE).optional(),
  title: z.string().min(1).max(300).optional(),
  campaignType: z.nativeEnum(AdCampaignType).optional(),
  status: z.nativeEnum(AdCampaignStatus).optional(),
  leads: z.number().int().min(0).optional(),
  businessLeads: z.number().int().min(0).optional(),
  spend: z.number().min(0).optional(), // decimals allowed
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
  // A new date (or a month change) re-buckets month + date together.
  let dateMonth: { date: Date; month: string } | null = null
  if (d.date) {
    const r = resolveDateMonth(d.date, undefined)
    dateMonth = { date: dbDateFromString(r.dateStr), month: r.month }
  } else if (d.month) {
    const r = resolveDateMonth(undefined, d.month)
    dateMonth = { date: dbDateFromString(r.dateStr), month: r.month }
  }
  const campaign = await prisma.adCampaign.update({
    where: { id: existing.id },
    data: {
      ...(d.brandId ? { brandId: d.brandId } : {}),
      ...(d.platform ? { platform: d.platform } : {}),
      ...(dateMonth ? { date: dateMonth.date, month: dateMonth.month } : {}),
      ...(d.title != null ? { title: d.title } : {}),
      ...(d.campaignType ? { campaignType: d.campaignType } : {}),
      ...(d.status ? { status: d.status } : {}),
      ...(d.leads !== undefined ? { leads: d.leads } : {}),
      ...(d.businessLeads !== undefined ? { businessLeads: d.businessLeads } : {}),
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
