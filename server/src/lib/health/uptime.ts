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

export async function recordOutage(o: { downAt: Date; upAt: Date; detail?: string | null }): Promise<{ id: string; minutes: number }> {
  const minutes = Math.max(1, Math.round((o.upAt.getTime() - o.downAt.getTime()) / 60000))
  const row = await prisma.uptimeEvent.create({ data: { downAt: o.downAt, upAt: o.upAt, minutes, detail: o.detail?.slice(0, 300) ?? null } })
  recordPing(o.upAt)
  const fmt = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: process.env.APP_TIMEZONE || 'Asia/Karachi' })
  await alertDevelopers({
    title: `The site was down for ${minutes} min`,
    body: `Down from ${fmt(o.downAt)} to ${fmt(o.upAt)} PKT${o.detail ? `. ${o.detail}` : ''}`.slice(0, 180),
    link: '/app/admin/health?tab=server',
    key: `outage:${row.id}`,
  })
  return { id: row.id, minutes }
}
