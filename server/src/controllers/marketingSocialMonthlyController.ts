import type { Response } from 'express'
import { z } from 'zod'
import type { BrandSocialMonthly, SocialPlatform } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { resolveMarketingActor, type MarketingActor } from '../lib/marketingAuth'
import { pctDelta } from '../lib/trends'
import { prevMonth, monthsBack, monthSeries } from '../lib/monthTrends'
import { companyToday } from '../lib/time'

export const SOCIAL_PLATFORMS: SocialPlatform[] = [
  'INSTAGRAM',
  'FACEBOOK',
  'LINKEDIN',
  'X',
  'TIKTOK',
  'YOUTUBE',
  'GOOGLE_BUSINESS',
  'OTHER',
]
const METRIC_KEYS = ['followers', 'impressions', 'engagement', 'reach', 'posts'] as const
type MetricKey = (typeof METRIC_KEYS)[number]

const MONTH_RE = /^\d{4}-\d{2}$/
const currentMonth = () => companyToday().slice(0, 7)

function statRow(platform: SocialPlatform, r?: BrandSocialMonthly) {
  return {
    platform,
    followers: r?.followers ?? 0,
    impressions: r?.impressions ?? 0,
    engagement: r?.engagement ?? 0,
    reach: r?.reach ?? 0,
    posts: r?.posts ?? 0,
    source: r?.source ?? 'MANUAL',
    hasData: !!r,
  }
}

/** Load the brand and confirm it belongs to the actor's Marketing dept. */
async function loadBrand(actor: MarketingActor, brandId: string) {
  const brand = await prisma.brand.findUnique({ where: { id: brandId } })
  if (!brand || brand.departmentId !== actor.deptId) return null
  return brand
}

/** GET /api/marketing/social/monthly?brandId=&month= — the platform grid for one brand+month. */
export async function getMonthly(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  if (!actor.canWriteSocial) {
    res.status(403).json({ error: 'Social team, Team Lead or Admin only' })
    return
  }
  const brandId = String(req.query.brandId || '')
  const month = String(req.query.month || currentMonth())
  if (!MONTH_RE.test(month)) {
    res.status(400).json({ error: 'month must be YYYY-MM' })
    return
  }
  const brand = await loadBrand(actor, brandId)
  if (!brand) {
    res.status(404).json({ error: 'Brand not found' })
    return
  }
  const rows = await prisma.brandSocialMonthly.findMany({ where: { brandId, month } })
  const byPlatform = new Map(rows.map((r) => [r.platform, r]))
  res.json({
    brand: { id: brand.id, name: brand.name },
    month,
    platforms: SOCIAL_PLATFORMS.map((p) => statRow(p, byPlatform.get(p))),
  })
}

const upsertSchema = z.object({
  brandId: z.string().min(1),
  month: z.string().regex(MONTH_RE, 'month must be YYYY-MM'),
  rows: z.array(
    z.object({
      platform: z.enum(SOCIAL_PLATFORMS as [SocialPlatform, ...SocialPlatform[]]),
      followers: z.number().int().min(0).max(1_000_000_000).default(0),
      impressions: z.number().int().min(0).max(1_000_000_000).default(0),
      engagement: z.number().int().min(0).max(1_000_000_000).default(0),
      reach: z.number().int().min(0).max(1_000_000_000).default(0),
      posts: z.number().int().min(0).max(1_000_000).default(0),
    }),
  ),
})

/** PUT /api/marketing/social/monthly — upsert the whole brand+month grid in one transaction. */
export async function upsertMonthly(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  if (!actor.canWriteSocial) {
    res.status(403).json({ error: 'Social team, Team Lead or Admin only' })
    return
  }
  const parsed = upsertSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const { brandId, month, rows } = parsed.data
  const brand = await loadBrand(actor, brandId)
  if (!brand) {
    res.status(404).json({ error: 'Brand not found' })
    return
  }
  await prisma.$transaction(
    rows.map((r) =>
      prisma.brandSocialMonthly.upsert({
        where: { brandId_platform_month: { brandId, platform: r.platform, month } },
        update: {
          followers: r.followers,
          impressions: r.impressions,
          engagement: r.engagement,
          reach: r.reach,
          posts: r.posts,
          source: 'MANUAL',
          enteredById: actor.me.id,
        },
        create: {
          brandId,
          platform: r.platform,
          month,
          followers: r.followers,
          impressions: r.impressions,
          engagement: r.engagement,
          reach: r.reach,
          posts: r.posts,
          source: 'MANUAL',
          enteredById: actor.me.id,
        },
      }),
    ),
  )
  const saved = await prisma.brandSocialMonthly.findMany({ where: { brandId, month } })
  const byPlatform = new Map(saved.map((r) => [r.platform, r]))
  res.json({ brand: { id: brand.id, name: brand.name }, month, platforms: SOCIAL_PLATFORMS.map((p) => statRow(p, byPlatform.get(p))) })
}

/** GET /api/marketing/social/monthly/compare?brandId=&month=&months=6 — MoM deltas + trends for a brand. */
export async function compareMonthly(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  if (!actor.canWriteSocial) {
    res.status(403).json({ error: 'Social team, Team Lead or Admin only' })
    return
  }
  const brandId = String(req.query.brandId || '')
  const month = String(req.query.month || currentMonth())
  const nMonths = Math.min(24, Math.max(2, Number(req.query.months) || 6))
  if (!MONTH_RE.test(month)) {
    res.status(400).json({ error: 'month must be YYYY-MM' })
    return
  }
  const brand = await loadBrand(actor, brandId)
  if (!brand) {
    res.status(404).json({ error: 'Brand not found' })
    return
  }
  const prev = prevMonth(month)
  const months = monthsBack(month, nMonths)
  const window = await prisma.brandSocialMonthly.findMany({ where: { brandId, month: { in: [...months, prev] } } })
  const cur = window.filter((r) => r.month === month)
  const pre = window.filter((r) => r.month === prev)

  const platforms = SOCIAL_PLATFORMS.map((p) => {
    const c = cur.find((r) => r.platform === p)
    const q = pre.find((r) => r.platform === p)
    if (!c && !q) return null
    return {
      platform: p,
      followers: c?.followers ?? 0,
      followersDelta: pctDelta(c?.followers ?? 0, q?.followers ?? 0),
      followersGrowth: (c?.followers ?? 0) - (q?.followers ?? 0),
      impressions: c?.impressions ?? 0,
      impressionsDelta: pctDelta(c?.impressions ?? 0, q?.impressions ?? 0),
      engagement: c?.engagement ?? 0,
      engagementDelta: pctDelta(c?.engagement ?? 0, q?.engagement ?? 0),
      hadPrev: !!q,
    }
  }).filter(Boolean)

  const sum = (rows: BrandSocialMonthly[], k: MetricKey) => rows.reduce((a, r) => a + r[k], 0)
  const totals = {
    followers: sum(cur, 'followers'),
    followersDelta: pctDelta(sum(cur, 'followers'), sum(pre, 'followers')),
    impressions: sum(cur, 'impressions'),
    impressionsDelta: pctDelta(sum(cur, 'impressions'), sum(pre, 'impressions')),
    engagement: sum(cur, 'engagement'),
    engagementDelta: pctDelta(sum(cur, 'engagement'), sum(pre, 'engagement')),
    hadPrev: pre.length > 0,
  }

  // Brand monthly targets → target line + green/amber/red band per metric.
  const targetRows = await prisma.target.findMany({
    where: { scope: 'BRAND', brandId, period: 'MONTHLY', metricKey: { in: ['social.followers', 'social.impressions', 'social.engagement'] } },
  })
  const bandFor = (metricKey: string, value: number) => {
    const t = targetRows.find((r) => r.metricKey === metricKey)
    if (!t) return null
    const max = t.maxValue ?? t.value
    const min = t.minValue ?? max
    const band = value >= max ? 'green' : value >= min ? 'amber' : 'red'
    return { min, max, band }
  }
  const targets = {
    followers: bandFor('social.followers', totals.followers),
    impressions: bandFor('social.impressions', totals.impressions),
    engagement: bandFor('social.engagement', totals.engagement),
  }

  const inWindow = window.filter((r) => months.includes(r.month))
  const line = (k: 'followers' | 'impressions' | 'engagement') => targets[k]?.max
  const trends = {
    followers: monthSeries(inWindow, months, (r) => r.month, (r) => r.followers, line('followers')),
    engagement: monthSeries(inWindow, months, (r) => r.month, (r) => r.engagement, line('engagement')),
    impressions: monthSeries(inWindow, months, (r) => r.month, (r) => r.impressions, line('impressions')),
  }
  res.json({ brand: { id: brand.id, name: brand.name }, month, prevMonth: prev, platforms, totals, trends, targets })
}

/** GET /api/marketing/social/monthly/cross?month=&metric=followers — cross-brand comparison (lead/admin). */
export async function crossBrand(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  if (!actor.isLead) {
    res.status(403).json({ error: 'Team Lead or Admin only' })
    return
  }
  if (!actor.deptId) {
    res.json({ month: currentMonth(), metric: 'followers', brands: [] })
    return
  }
  const month = String(req.query.month || currentMonth())
  const metric = (String(req.query.metric || 'followers') as MetricKey)
  if (!MONTH_RE.test(month) || !METRIC_KEYS.includes(metric)) {
    res.status(400).json({ error: 'Invalid month or metric' })
    return
  }
  const prev = prevMonth(month)
  const brands = await prisma.brand.findMany({ where: { departmentId: actor.deptId, isActive: true }, orderBy: { name: 'asc' } })
  const stats = await prisma.brandSocialMonthly.findMany({
    where: { brandId: { in: brands.map((b) => b.id) }, month: { in: [month, prev] } },
  })
  const agg = (brandId: string, m: string) =>
    stats.filter((s) => s.brandId === brandId && s.month === m).reduce((a, s) => a + s[metric], 0)
  res.json({
    month,
    metric,
    brands: brands.map((b) => ({
      brandId: b.id,
      name: b.name,
      value: agg(b.id, month),
      delta: pctDelta(agg(b.id, month), agg(b.id, prev)),
    })),
  })
}
