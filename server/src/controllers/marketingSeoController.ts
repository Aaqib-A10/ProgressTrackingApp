import type { Response } from 'express'
import { z } from 'zod'
import Papa from 'papaparse'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { resolveMarketingActor } from '../lib/marketingAuth'
import { isGoogleConfigured } from '../lib/google'
import { dbDateFromString } from '../lib/time'
import { syncBrandSeo, syncAllBrandsSeo, trailingWindow, type SeoSyncResult } from '../lib/seoSync'

/**
 * SEO analytics from Google Search Console + GA4. Phase 1: manual sync of a
 * connected brand (or all). Reads/dashboards come in Phase 2.
 */

const syncSchema = z.object({
  brandId: z.string().optional(),
  days: z.number().int().min(1).max(400).optional(), // trailing window; default 35
})

/** POST /api/marketing/seo/sync — pull GSC/GA for a brand (or all connected). Lead/admin only. */
export async function syncSeo(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  if (!actor.isLead) {
    res.status(403).json({ error: 'Only a Team Lead or Admin can sync SEO data' })
    return
  }
  if (!isGoogleConfigured()) {
    res.status(400).json({ error: 'Google is not connected yet. Add the service-account key (GOOGLE_SERVICE_ACCOUNT_JSON) on the server, then grant it access to each brand’s Search Console + GA4 property.' })
    return
  }
  const parsed = syncSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const { from, to } = trailingWindow(parsed.data.days ?? 35)

  let results: SeoSyncResult[]
  if (parsed.data.brandId) {
    const brand = await prisma.brand.findUnique({ where: { id: parsed.data.brandId } })
    if (!brand || brand.departmentId !== actor.deptId) {
      res.status(404).json({ error: 'Brand not found' })
      return
    }
    if (!brand.gscSiteUrl && !brand.ga4PropertyId) {
      res.status(400).json({ error: 'This brand has no Search Console or GA4 property configured yet.' })
      return
    }
    results = [await syncBrandSeo(brand, from, to)]
  } else {
    results = await syncAllBrandsSeo(from, to)
  }
  res.json({ from, to, results })
}

// ---------- Manual CSV upload (fallback when Google auto-sync isn't connected) ----------

/** Normalise a header cell: lowercase, strip surrounding quotes/spaces. */
const norm = (s: string) => s.trim().toLowerCase().replace(/^"|"$/g, '')

/** Parse a numeric cell that may carry a % sign, thousands commas, or quotes. */
function num(v: unknown): number {
  if (v == null) return 0
  const n = parseFloat(String(v).replace(/[%,"\s]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** GSC/GA4 exports date as YYYY-MM-DD or YYYYMMDD — normalise to YYYY-MM-DD, else null. */
function parseDate(v: unknown): string | null {
  const s = String(v ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  return null
}

/** Pick the first present column from a set of candidate header names. */
function pick(row: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (k in row) return row[k]
  return undefined
}

/**
 * POST /api/marketing/seo/upload?brandId= — raw CSV body (express.raw). Accepts a
 * Google Search Console (Date/Clicks/Impressions/CTR/Position) or GA4
 * (Date/Sessions/Users/…) daily export and upserts BrandSeoDaily rows
 * (source=MANUAL), idempotent on (brandId, date). SEO team, lead or admin.
 */
export async function uploadSeoCsv(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  if (!actor.canWriteSeo) {
    res.status(403).json({ error: 'SEO team, Team Lead or Admin only' })
    return
  }
  const brandId = String(req.query.brandId || '')
  const brand = brandId ? await prisma.brand.findUnique({ where: { id: brandId } }) : null
  if (!brand || brand.departmentId !== actor.deptId) {
    res.status(404).json({ error: 'Brand not found' })
    return
  }
  const text = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : typeof req.body === 'string' ? req.body : ''
  if (!text.trim()) {
    res.status(400).json({ error: 'Empty file. Upload a Search Console or GA4 CSV export.' })
    return
  }

  const parsed = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: norm,
  })
  const rows = parsed.data.filter((r) => r && Object.keys(r).length)
  if (!rows.length) {
    res.status(400).json({ error: 'No data rows found. Make sure the CSV has a header row with a Date column.' })
    return
  }

  // Merge metrics by date so a GSC and a GA4 file for the same brand+date combine.
  type Fields = Partial<{
    clicks: number; impressions: number; ctr: number; position: number
    sessions: number; users: number; newUsers: number; engagedSessions: number; conversions: number; bounceRate: number
  }>
  const byDate = new Map<string, Fields>()

  for (const row of rows) {
    const date = parseDate(pick(row, ['date', 'day']))
    if (!date) continue
    const f: Fields = byDate.get(date) ?? {}

    const clicks = pick(row, ['clicks'])
    const impressions = pick(row, ['impressions'])
    const ctr = pick(row, ['ctr', 'click through rate'])
    const position = pick(row, ['position', 'average position', 'avg. pos', 'avg position'])
    if (clicks !== undefined) f.clicks = Math.round(num(clicks))
    if (impressions !== undefined) f.impressions = Math.round(num(impressions))
    // GSC exports CTR as a percentage (e.g. "3.45%"); store 0..1 to match auto-sync.
    if (ctr !== undefined) f.ctr = num(ctr) / 100
    if (position !== undefined) f.position = num(position)

    const sessions = pick(row, ['sessions'])
    const users = pick(row, ['users', 'total users', 'active users'])
    const newUsers = pick(row, ['new users', 'newusers'])
    const engaged = pick(row, ['engaged sessions', 'engagedsessions'])
    const conversions = pick(row, ['conversions', 'key events', 'conversion'])
    const bounce = pick(row, ['bounce rate', 'bouncerate'])
    if (sessions !== undefined) f.sessions = Math.round(num(sessions))
    if (users !== undefined) f.users = Math.round(num(users))
    if (newUsers !== undefined) f.newUsers = Math.round(num(newUsers))
    if (engaged !== undefined) f.engagedSessions = Math.round(num(engaged))
    if (conversions !== undefined) f.conversions = Math.round(num(conversions))
    if (bounce !== undefined) f.bounceRate = num(bounce) > 1 ? num(bounce) / 100 : num(bounce)

    byDate.set(date, f)
  }

  if (!byDate.size) {
    res.status(400).json({ error: 'No rows with a recognisable Date column were found.' })
    return
  }

  const dates = [...byDate.keys()].sort()
  await prisma.$transaction(
    dates.map((date) => {
      const dv = dbDateFromString(date)
      const f = byDate.get(date)!
      return prisma.brandSeoDaily.upsert({
        where: { brandId_date: { brandId: brand.id, date: dv } },
        update: { ...f, source: 'MANUAL' },
        create: { brandId: brand.id, date: dv, ...f, source: 'MANUAL' },
      })
    }),
  )
  await prisma.brand.update({ where: { id: brand.id }, data: { seoSyncedAt: new Date() } })

  res.json({ brandId: brand.id, rowsImported: byDate.size, from: dates[0], to: dates[dates.length - 1] })
}
