import { PrismaClient } from '@prisma/client'
import { guardWrite } from './health/auditContext'
import { applyWalls, setTimeZoneLoader } from './tenancy'

// Single shared Prisma client for the process. The query hook does two things:
//  - company walls (lib/tenancy): inside a signed-in request every read and write is limited
//    to that person's company, and new rows get the company;
//  - during the hourly self check (System Health) any save is stopped before it reaches the
//    database.
const base = new PrismaClient()

/** A bell notification was saved: lib/push sends it to the person's phone too (registered late, to avoid an import cycle). */
export type NotificationRow = { userId: string; type: string; title: string; body: string; link?: string | null; entityType?: string | null; entityId?: string | null }
let afterNotification: ((rows: NotificationRow[]) => void) | null = null
export function onNotificationSaved(fn: (rows: NotificationRow[]) => void): void { afterNotification = fn }
function notificationRows(args: unknown): NotificationRow[] {
  const d = (args as { data?: NotificationRow | NotificationRow[] } | undefined)?.data
  return !d ? [] : Array.isArray(d) ? d : [d]
}

const client = base.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        guardWrite(operation, model)
        const result = await query(applyWalls(base, model, operation, args as Record<string, unknown>) as typeof args)
        if (model === 'Notification' && (operation === 'create' || operation === 'createMany') && afterNotification) {
          try { afterNotification(notificationRows(args)) } catch { /* a pop-up never breaks the save */ }
        }
        return result
      },
    },
    async $allOperations({ operation, args, query }) {
      guardWrite(operation, undefined)
      return query(args)
    },
  },
})

setTimeZoneLoader(async (id) => (await base.company.findUnique({ where: { id }, select: { timeZone: true } }))?.timeZone)

// The hook adds behaviour only, not new methods, so the plain client type still describes it
// (and keeps every existing helper that takes a transaction client happy).
export const prisma = client as unknown as PrismaClient
