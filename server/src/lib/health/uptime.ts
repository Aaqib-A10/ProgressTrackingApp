import { timingSafeEqual } from 'node:crypto'
import { prisma } from '../prisma'
import { alertDevelopers } from './alerts'

/**
 * The outside checker (a small script on the office server) looks at the site every minute.
 * It says "still here" each minute, and once the site is back after being down, it reports
 * the outage. The token it sends is set in .env (UPTIME_TOKEN) and in the script's own file.
 */

let lastPingAt: Date | null = null

export const uptimeConfigured = (): boolean => !!process.env.UPTIME_TOKEN && process.env.UPTIME_TOKEN.length >= 16
export const lastUptimePing = (): Date | null => lastPingAt

export function uptimeTokenOk(given: unknown): boolean {
  const want = process.env.UPTIME_TOKEN
  if (!want || want.length < 16 || typeof given !== 'string') return false
  const a = Buffer.from(given)
  const b = Buffer.from(want)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function recordPing(at = new Date()): void {
  lastPingAt = at
}

/** Short drops where the app kept running are listed quietly; this many in a day earns one alert. */
const QUIET_MINUTES = 10
const DROPS_FOR_ALERT = 3
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The checker reports an outage once the site is back.
 * `appUp`: the app answered on its own server the whole time (only the way in from the internet
 * was cut). Such a drop under 10 minutes goes on the System Health page without a pop-up; when
 * there are 3 or more in a day, the developers get ONE alert for that day. Anything else (the app
 * stopped, a long outage, an older checker that does not say) alerts as before.
 */
export async function recordOutage(o: { downAt: Date; upAt: Date; detail?: string | null; appUp?: boolean }): Promise<{ id: string; minutes: number; alerted: boolean }> {
  const minutes = Math.max(1, Math.round((o.upAt.getTime() - o.downAt.getTime()) / 60000))
  const row = await prisma.uptimeEvent.create({ data: { downAt: o.downAt, upAt: o.upAt, minutes, detail: o.detail?.slice(0, 300) ?? null } })
  recordPing(o.upAt)
  const zone = process.env.APP_TIMEZONE || 'Asia/Karachi'
  const fmt = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: zone })
  const link = '/app/admin/health?tab=server'

  if (o.appUp === true && minutes < QUIET_MINUTES) {
    const since = new Date(Date.now() - DAY_MS)
    const drops = await prisma.uptimeEvent.findMany({ where: { downAt: { gte: since }, minutes: { lt: QUIET_MINUTES } }, select: { minutes: true } })
    if (drops.length < DROPS_FOR_ALERT) return { id: row.id, minutes, alerted: false }
    // One alert a day for the drops, also across restarts (the day's alert is looked up in the bell).
    const title = 'The way in to Metriq keeps dropping'
    const already = await prisma.notification.findFirst({ where: { type: 'SYSTEM_HEALTH', title, createdAt: { gte: since } }, select: { id: true } })
    if (already) return { id: row.id, minutes, alerted: false }
    const alerted = await alertDevelopers({
      title,
      body: `${drops.length} short drops in the last 24 hours (latest ${fmt(o.downAt)}, ${minutes} min). Metriq kept running; the check from the internet could not reach it.`.slice(0, 180),
      link,
      key: 'route-drops',
    })
    return { id: row.id, minutes, alerted }
  }

  const alerted = await alertDevelopers({
    title: o.appUp === false ? `Metriq stopped answering for ${minutes} min` : `The site was down for ${minutes} min`,
    body: `Down from ${fmt(o.downAt)} to ${fmt(o.upAt)} PKT${o.detail ? `. ${o.detail}` : ''}`.slice(0, 180),
    link,
    key: `outage:${row.id}`,
  })
  return { id: row.id, minutes, alerted }
}
