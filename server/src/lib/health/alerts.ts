import { prisma } from '../prisma'
import { sendPush } from '../push'

/**
 * Bell + phone push for System Health. It goes to developers (User.isDeveloper); while nobody
 * is marked as a developer, to the Super Admins. Quiet by design: the same alert is not sent
 * again for 6 hours, and never more than 10 alerts an hour in total.
 */

const SAME_ALERT_MS = 6 * 60 * 60 * 1000
const MAX_PER_HOUR = 10
const lastSent = new Map<string, number>()
let hourStart = 0
let sentThisHour = 0

export async function healthRecipients(): Promise<string[]> {
  const devs = await prisma.user.findMany({ where: { isDeveloper: true, isActive: true, status: 'ACTIVE' }, select: { id: true } })
  if (devs.length) return devs.map((u) => u.id)
  const admins = await prisma.user.findMany({ where: { role: 'SUPER_ADMIN', isActive: true, status: 'ACTIVE' }, select: { id: true } })
  return admins.map((u) => u.id)
}

export async function alertDevelopers(a: { title: string; body: string; link: string; key: string; force?: boolean }): Promise<boolean> {
  const now = Date.now()
  if (!a.force && now - (lastSent.get(a.key) ?? 0) < SAME_ALERT_MS) return false
  if (now - hourStart > 3600_000) { hourStart = now; sentThisHour = 0 }
  if (sentThisHour >= MAX_PER_HOUR) return false
  const to = await healthRecipients()
  if (!to.length) return false
  lastSent.set(a.key, now)
  sentThisHour++
  await prisma.notification.createMany({
    data: to.map((userId) => ({ userId, type: 'SYSTEM_HEALTH' as const, title: a.title, body: a.body, link: a.link, entityType: 'SystemHealth' })),
  })
  void sendPush(to, { kind: 'alert', title: a.title, body: a.body, tag: `health-${a.key}`.slice(0, 60), url: a.link }, { evenIfActive: true })
  return true
}

/** For tests: forget what was sent. */
export function resetAlertLimits(): void {
  lastSent.clear()
  hourStart = 0
  sentThisHour = 0
}
