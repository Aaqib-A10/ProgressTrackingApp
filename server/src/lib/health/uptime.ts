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

/**
 * The checker reports an outage once the site is back. Sent twice (a reply lost on the way),
 * the same outage is kept once and alerts once.
 * `appUp: true`: Metriq answered on its own server the whole time; only the way in from the
 * internet, as seen from the server, was cut. That is listed on System Health without any alert.
 * Anything else (the app stopped, an error page, an older checker that does not say) alerts.
 */
export async function recordOutage(o: { downAt: Date; upAt: Date; detail?: string | null; appUp?: boolean }): Promise<{ id: string; minutes: number; alerted: boolean }> {
  const minutes = Math.max(1, Math.round((o.upAt.getTime() - o.downAt.getTime()) / 60000))
  recordPing(o.upAt)
  const same = await prisma.uptimeEvent.findFirst({ where: { downAt: o.downAt }, select: { id: true, minutes: true } })
  if (same) return { id: same.id, minutes: same.minutes, alerted: false }
  const detail = o.appUp === true ? `Only the way in from the internet: Metriq kept answering on the server. ${o.detail ?? ''}`.trim() : o.detail
  let row: { id: string }
  try {
    row = await prisma.uptimeEvent.create({ data: { downAt: o.downAt, upAt: o.upAt, minutes, detail: detail?.slice(0, 300) ?? null } })
  } catch (e) {
    // Two copies of one report at the same moment: the database keeps one (downAt is unique).
    if ((e as { code?: string }).code !== 'P2002') throw e
    const kept = await prisma.uptimeEvent.findUniqueOrThrow({ where: { downAt: o.downAt }, select: { id: true, minutes: true } })
    return { id: kept.id, minutes: kept.minutes, alerted: false }
  }
  if (o.appUp === true) return { id: row.id, minutes, alerted: false }

  const zone = process.env.APP_TIMEZONE || 'Asia/Karachi'
  const fmt = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: zone })
  const alerted = await alertDevelopers({
    title: o.appUp === false ? `Metriq stopped answering for ${minutes} min` : `The site was down for ${minutes} min`,
    body: `Down from ${fmt(o.downAt)} to ${fmt(o.upAt)} PKT${o.detail ? `. ${o.detail}` : ''}`.slice(0, 180),
    link: '/app/admin/health?tab=server',
    key: `outage:${row.id}`,
  })
  return { id: row.id, minutes, alerted }
}
