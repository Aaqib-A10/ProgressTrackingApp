import type { Brand } from '@prisma/client'
import { DateTime } from 'luxon'
import { prisma } from './prisma'
import { dbDateFromString, COMPANY_TZ } from './time'
import { gscDaily, ga4Daily } from './google'

export interface SeoSyncResult {
  brandId: string
  name: string
  from: string
  to: string
  days: number // distinct dates written
  errors: string[] // non-fatal per-source errors (GSC/GA independent)
}

type DayAcc = {
  clicks: number; impressions: number; ctr: number; position: number
  sessions: number; users: number; newUsers: number; engagedSessions: number; bounceRate: number
}
const emptyDay = (): DayAcc => ({ clicks: 0, impressions: 0, ctr: 0, position: 0, sessions: 0, users: 0, newUsers: 0, engagedSessions: 0, bounceRate: 0 })
const errText = (e: unknown) => (e as { message?: string })?.message ?? String(e)

/** A sensible default window: the trailing `days` up to today, in company time.
 *  GSC finalizes 2-3 days late, so a trailing re-pull backfills late data. */
export function trailingWindow(days: number, now: Date = new Date()): { from: string; to: string } {
  const to = DateTime.fromJSDate(now).setZone(COMPANY_TZ)
  return { from: to.minus({ days: days - 1 }).toISODate()!, to: to.toISODate()! }
}

/**
 * Pull GSC + GA4 daily metrics for one brand over [from, to] and upsert
 * BrandSeoDaily (idempotent on brandId+date). GSC and GA4 are fetched
 * independently — if one source errors, the other still lands, and the error is
 * reported rather than thrown.
 */
export async function syncBrandSeo(brand: Brand, from: string, to: string): Promise<SeoSyncResult> {
  const errors: string[] = []
  const byDate = new Map<string, DayAcc>()

  if (brand.gscSiteUrl) {
    try {
      for (const r of await gscDaily(brand.gscSiteUrl, from, to)) {
        if (!r.date) continue
        const e = byDate.get(r.date) ?? emptyDay()
        e.clicks = r.clicks; e.impressions = r.impressions; e.ctr = r.ctr; e.position = r.position
        byDate.set(r.date, e)
      }
    } catch (e) {
      errors.push(`Search Console: ${errText(e)}`)
    }
  }

  if (brand.ga4PropertyId) {
    try {
      for (const r of await ga4Daily(brand.ga4PropertyId, from, to)) {
        if (!r.date) continue
        const e = byDate.get(r.date) ?? emptyDay()
        e.sessions = r.sessions; e.users = r.users; e.newUsers = r.newUsers
        e.engagedSessions = r.engagedSessions; e.bounceRate = r.bounceRate
        byDate.set(r.date, e)
      }
    } catch (e) {
      errors.push(`Google Analytics: ${errText(e)}`)
    }
  }

  for (const [date, v] of byDate) {
    const dv = dbDateFromString(date)
    await prisma.brandSeoDaily.upsert({
      where: { brandId_date: { brandId: brand.id, date: dv } },
      update: { ...v, source: 'API' },
      create: { brandId: brand.id, date: dv, ...v, source: 'API' },
    })
  }

  // Stamp the sync time if anything landed or both sources were error-free.
  if (byDate.size > 0 || errors.length === 0) {
    await prisma.brand.update({ where: { id: brand.id }, data: { seoSyncedAt: new Date() } })
  }
  return { brandId: brand.id, name: brand.name, from, to, days: byDate.size, errors }
}

/** Sync every connected brand (has a GSC site or GA4 property). Used by the cron + "sync all". */
export async function syncAllBrandsSeo(from: string, to: string): Promise<SeoSyncResult[]> {
  const brands = await prisma.brand.findMany({
    where: { isActive: true, OR: [{ gscSiteUrl: { not: null } }, { ga4PropertyId: { not: null } }] },
  })
  const out: SeoSyncResult[] = []
  for (const b of brands) out.push(await syncBrandSeo(b, from, to))
  return out
}
