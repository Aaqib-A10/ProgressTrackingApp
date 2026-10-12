import { prisma } from './prisma'

/**
 * Nightly tidy-up so the tables that grow every day stay small and fast:
 * - attendance reminder records are only needed to avoid sending the same reminder twice
 *   on the same day, so anything older than 30 days is deleted;
 * - bell notifications nobody opened for 60 days are marked read, so the bell only
 *   shows recent things (they stay in the notification history).
 * Audit, login and activity history is kept.
 */

const DAY = 24 * 60 * 60 * 1000

export async function runCleanup(now = new Date()): Promise<{ reminders: number; notifications: number }> {
  const [reminders, notifications] = await Promise.all([
    prisma.attendanceReminder.deleteMany({ where: { sentAt: { lt: new Date(now.getTime() - 30 * DAY) } } }),
    prisma.notification.updateMany({ where: { readAt: null, createdAt: { lt: new Date(now.getTime() - 60 * DAY) } }, data: { readAt: now } }),
  ])
  return { reminders: reminders.count, notifications: notifications.count }
}

export function startCleanup(): void {
  const run = () => {
    runCleanup()
      .then((r) => { if (r.reminders || r.notifications) console.log(`[cleanup] removed ${r.reminders} old reminder records, closed ${r.notifications} old notifications`) }) // eslint-disable-line no-console
      .catch((e) => console.error('[cleanup] failed', e)) // eslint-disable-line no-console
  }
  setTimeout(run, 10 * 60 * 1000).unref()
  setInterval(run, DAY).unref()
}
