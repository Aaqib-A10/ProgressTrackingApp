import type { Prisma } from '@prisma/client'
import { prisma } from './prisma'

/**
 * One line in the company's Activity Log (Admin → Activity Log): who did what to which record.
 *
 * Best-effort on purpose: writing the log must never break or undo the action it describes. Keep `before` and
 * `after` small and free of secrets (never a password, a code, a token or a key): they are shown to admins.
 */
export async function recordActivity(
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  detail: { before?: Prisma.InputJsonValue; after?: Prisma.InputJsonValue } = {},
): Promise<void> {
  try {
    await prisma.auditLog.create({ data: { userId: actorId, action, entityType, entityId, ...(detail.before !== undefined ? { before: detail.before } : {}), ...(detail.after !== undefined ? { after: detail.after } : {}) } })
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[activity-log] could not record', action, entityType, e instanceof Error ? e.message : e)
  }
}
