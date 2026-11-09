import type { NotificationType } from '@prisma/client'
import { prisma } from '../prisma'

/** The managers of a business; when it has none, the company's Super Admins (someone must hear of a lead). */
export async function leadManagers(businessId: string): Promise<string[]> {
  const m = await prisma.leadBusinessMember.findMany({ where: { businessId, role: 'MANAGER', user: { isActive: true } }, select: { userId: true } })
  if (m.length) return m.map((x) => x.userId)
  const admins = await prisma.user.findMany({ where: { role: 'SUPER_ADMIN', isActive: true }, select: { id: true } })
  return admins.map((a) => a.id)
}

export const leadLink = (leadId: string) => `/app/leads/${encodeURIComponent(leadId)}`

/** Bell notification (and, through it, the phone pop-up). Never throws (a lead is never lost over an alert). */
export async function tellAboutLead(userIds: (string | null | undefined)[], n: { type: NotificationType; title: string; body: string; leadId: string; link?: string; actorId?: string | null }): Promise<void> {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))].filter((id) => id !== n.actorId)
  if (!ids.length) return
  try {
    const link = n.link ?? leadLink(n.leadId)
    await prisma.notification.createMany({
      data: ids.map((userId) => ({ userId, type: n.type, actorId: n.actorId ?? null, title: n.title.slice(0, 200), body: n.body.slice(0, 500), link, entityType: 'Lead', entityId: n.leadId })),
    })
    // The phone pop-up follows the saved row by itself (lib/push onNotificationSaved).
  } catch (e) {
    console.warn('[leads] notify failed', (e as Error).message)
  }
}

/** The managers of a business plus its head (CMR: Jesse); with none of those, the Super Admins. */
export async function leadManagersAndHead(businessId: string): Promise<{ managers: string[]; headId: string | null }> {
  const b = await prisma.leadBusiness.findUnique({ where: { id: businessId }, select: { headId: true } })
  return { managers: await leadManagers(businessId), headId: b?.headId ?? null }
}
