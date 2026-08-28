import type { NotificationType } from '@prisma/client'
import { prisma } from './prisma'

const trunc = (s: string, n = 80) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

/**
 * Create attendance notifications (break overrun / grace exceeded / limit) for a
 * set of recipients. De-duplicated, best-effort. Recipients are typically the
 * agent + their department Team Leads.
 */
export async function notifyAttendance(opts: {
  recipientIds: string[]
  type: NotificationType
  title: string
  body: string
  link?: string
}): Promise<void> {
  const recipients = [...new Set(opts.recipientIds)].filter(Boolean)
  if (!recipients.length) return
  await prisma.notification.createMany({
    data: recipients.map((userId) => ({
      userId,
      type: opts.type,
      title: opts.title,
      body: opts.body,
      link: opts.link ?? '/app/attendance/me',
    })),
  })
}

/**
 * Create "you were mentioned" notifications for the given users on a board card.
 * Self-mentions are skipped and the recipient list is de-duplicated. Best-effort:
 * a delivery failure never blocks the comment being posted.
 */
export async function notifyMentions(opts: {
  mentionIds: string[]
  actorId: string
  actorName: string
  taskTitle: string
  link: string
  entityType: string
  entityId: string
}): Promise<void> {
  const recipients = [...new Set(opts.mentionIds)].filter((id) => id && id !== opts.actorId)
  if (!recipients.length) return
  await prisma.notification.createMany({
    data: recipients.map((userId) => ({
      userId,
      type: 'MENTION' as const,
      actorId: opts.actorId,
      title: `${opts.actorName} mentioned you`,
      body: `on “${trunc(opts.taskTitle)}”`,
      link: opts.link,
      entityType: opts.entityType,
      entityId: opts.entityId,
    })),
  })
}
