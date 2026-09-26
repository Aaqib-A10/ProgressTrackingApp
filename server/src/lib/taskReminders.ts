import cron from 'node-cron'
import { DateTime } from 'luxon'
import { prisma } from './prisma'
import { COMPANY_TZ } from './time'
import { notifyTaskDueSoon } from './notify'
import { sendTaskDueSoonEmail } from './mail'

/**
 * Remind assignees of URGENT marketing tasks ~1 hour before they're due.
 * Runs every 5 minutes; each task is claimed via `dueReminderSentAt` so the reminder
 * fires at most once (rescheduling clears the stamp — see updateTask). Best-effort:
 * a delivery failure never blocks the tick.
 */
export async function runTaskReminderTick(now: Date = new Date()): Promise<number> {
  const soon = new Date(now.getTime() + 60 * 60 * 1000)
  const due = await prisma.marketingTask.findMany({
    where: {
      priority: 'URGENT',
      status: { not: 'PUBLISHED' },
      assigneeId: { not: null },
      dueReminderSentAt: null,
      dueAt: { not: null, gte: now, lte: soon },
    },
    include: { assignee: { select: { id: true, name: true, email: true } } },
  })

  let sent = 0
  for (const t of due) {
    // Claim so two ticks (or two instances) never double-send.
    const claim = await prisma.marketingTask.updateMany({ where: { id: t.id, dueReminderSentAt: null }, data: { dueReminderSentAt: new Date() } })
    if (claim.count !== 1 || !t.assignee) continue
    const dueLabel = t.dueAt ? DateTime.fromJSDate(t.dueAt).setZone(COMPANY_TZ).toFormat('MMM d, h:mm a') : ''
    await notifyTaskDueSoon({ assigneeId: t.assignee.id, taskTitle: t.title, taskId: t.id }).catch(() => undefined)
    await sendTaskDueSoonEmail({ to: t.assignee.email, name: t.assignee.name, taskTitle: t.title, taskId: t.id, dueLabel }).catch(() => undefined)
    sent++
  }
  return sent
}

/** Start the urgent-task due-reminder cron (every 5 min). Call once on boot. */
export function startTaskReminders(): void {
  cron.schedule('*/5 * * * *', () => {
    runTaskReminderTick().catch((e) => {
      // eslint-disable-next-line no-console
      console.error('[task-reminders] tick failed:', e)
    })
  })
  // eslint-disable-next-line no-console
  console.log('[task-reminders] urgent-task due reminders started (every 5 min)')
}
