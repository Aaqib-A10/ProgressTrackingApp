import { randomUUID } from 'node:crypto'
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
export type NotificationRow = { id?: string; userId: string; type: string; title: string; body: string; link?: string | null; entityType?: string | null; entityId?: string | null }
let afterNotification: ((rows: NotificationRow[]) => void) | null = null
export function onNotificationSaved(fn: (rows: NotificationRow[]) => void): void { afterNotification = fn }
function notificationRows(args: unknown): NotificationRow[] {
  const d = (args as { data?: NotificationRow | NotificationRow[] } | undefined)?.data
  return !d ? [] : Array.isArray(d) ? d : [d]
}
/**
 * Each notification gets its id here, before it is saved, so the pop-up sent to the phone or
 * browser carries the same id the bell shows. The browser uses it to show one notification
 * once, however many tabs are open and whichever of them (or the push) hears of it first.
 */
function withNotificationIds<T>(args: T): T {
  const a = args as { data?: NotificationRow | NotificationRow[] } | undefined
  if (!a?.data) return args
  const withId = (r: NotificationRow): NotificationRow => (r.id ? r : { ...r, id: `n${randomUUID().replace(/-/g, '')}` })
  return { ...a, data: Array.isArray(a.data) ? a.data.map(withId) : withId(a.data) } as T
}

const client = base.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        guardWrite(operation, model)
        const saving = model === 'Notification' && (operation === 'create' || operation === 'createMany')
        if (saving) args = withNotificationIds(args)
        const result = await query(applyWalls(base, model, operation, args as Record<string, unknown>) as typeof args)
        if (saving && afterNotification) {
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
