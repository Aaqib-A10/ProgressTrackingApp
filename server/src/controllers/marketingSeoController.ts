import type { Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { resolveMarketingActor } from '../lib/marketingAuth'
import { isGoogleConfigured } from '../lib/google'
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
