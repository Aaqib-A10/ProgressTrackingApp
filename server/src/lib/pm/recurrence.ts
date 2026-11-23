import cron from 'node-cron'
import { DateTime } from 'luxon'
import { prisma } from '../prisma'
import { forEachCompany } from '../company'
import { runTracked } from '../health/jobs'
import { companyToday, companyTz, dbDateFromString, dateStringFromDb } from '../time'
import { logActivity } from './tasks'
import { RANK_STEP } from './rank'
import { isOn } from '../flags'
import { maybeCompanyId } from '../tenancy'

/**
 * Tasks that make themselves again (plan 2026-11, 2.8). A recurrence says "every day / week / month, put this task
 * on the board": the job below makes the task on its day and works out the next day. A missed day (the server was
 * off) is made once when the job next runs, never many times over.
 */

export const EVERY = ['DAILY', 'WEEKLY', 'MONTHLY'] as const
export type Every = (typeof EVERY)[number]

/** The first day on or after `from` that fits the rule (YYYY-MM-DD, company clock). */
export function firstOn(every: Every, onDay: number | null, from: string): string {
  let d = DateTime.fromISO(from, { zone: 'utc' })
  if (every === 'WEEKLY') { const want = Math.min(7, Math.max(1, onDay ?? 1)); while (d.weekday !== want) d = d.plus({ days: 1 }) }
  if (every === 'MONTHLY') { const want = Math.min(28, Math.max(1, onDay ?? 1)); if (d.day > want) d = d.plus({ months: 1 }); d = d.set({ day: want }) }
  return d.toISODate()!
}

/** The day after `made` that the next task is due to appear. */
export function nextAfter(every: Every, onDay: number | null, made: string): string {
  const d = DateTime.fromISO(made, { zone: 'utc' })
  if (every === 'DAILY') return d.plus({ days: 1 }).toISODate()!
  return firstOn(every, onDay, d.plus({ days: 1 }).toISODate()!)
}

/** Make the tasks that are due today (or were missed) for the company this runs in. Returns how many were made. */
export async function runRecurrences(now = new Date()): Promise<number> {
  const companyId = maybeCompanyId()
  if (companyId && !(await isOn('project-extras', companyId))) return 0
  const today = companyToday(now)
  const due = await prisma.pmRecurrence.findMany({ where: { active: true, nextOn: { lte: dbDateFromString(today) }, project: { status: 'ACTIVE' } }, include: { project: { select: { id: true, key: true } } } })
  let made = 0
  for (const r of due) {
    // Claim it first: two runs at once make one task.
    const next = nextAfter(r.every as Every, r.onDay, today)
    const claimed = await prisma.pmRecurrence.updateMany({ where: { id: r.id, nextOn: r.nextOn }, data: { nextOn: dbDateFromString(next), lastMadeAt: now } })
    if (!claimed.count) continue
    const column = (await prisma.pmColumn.findFirst({ where: { projectId: r.projectId, isDefault: true } })) ?? (await prisma.pmColumn.findFirst({ where: { projectId: r.projectId, category: 'TODO' }, orderBy: { position: 'asc' } }))
    if (!column) continue
    // Only people who are still members of the project are given the task.
    const members = await prisma.pmProjectMember.findMany({ where: { projectId: r.projectId, userId: { in: r.assigneeIds }, user: { isActive: true } }, select: { userId: true } })
    const assigneeIds = members.map((m) => m.userId)
    const dueAt = DateTime.fromISO(today, { zone: companyTz() }).plus({ days: Math.max(0, r.dueInDays) }).endOf('day').toJSDate()
    const task = await prisma.$transaction(async (tx) => {
      const p = await tx.pmProject.update({ where: { id: r.projectId }, data: { taskCounter: { increment: 1 } }, select: { taskCounter: true, key: true } })
      const max = await tx.pmTask.aggregate({ where: { columnId: column.id, deletedAt: null }, _max: { position: true } })
      const t = await tx.pmTask.create({
        data: {
          projectId: r.projectId, code: `${p.key}-${p.taskCounter}`, title: r.title, description: r.description, columnId: column.id,
          position: (max._max.position ?? 0) + RANK_STEP, priority: r.priority, createdById: r.createdById, dueAt,
          assignees: { create: assigneeIds.map((userId) => ({ userId, assignedById: r.createdById })) },
          watchers: { create: [...new Set([r.createdById, ...assigneeIds])].map((userId) => ({ userId })) },
        },
      })
      await logActivity(t.id, r.createdById, 'created', { column: column.name, repeats: r.every.toLowerCase() }, tx)
      return t
    })
    if (assigneeIds.length) {
      await prisma.notification.createMany({ data: assigneeIds.map((userId) => ({ userId, type: 'TASK_ASSIGNED' as const, title: 'A repeating task is ready', body: `${task.code}: ${task.title}`.slice(0, 200), link: `/app/projects/${r.project.key}?task=${task.code}`, entityType: 'PmTask', entityId: task.id })) })
    }
    made++
  }
  return made
}

export const recurrenceView = (r: { id: string; title: string; description: string | null; priority: string; assigneeIds: string[]; every: string; onDay: number | null; dueInDays: number; nextOn: Date; active: boolean; lastMadeAt: Date | null }) => ({
  id: r.id, title: r.title, description: r.description ?? '', priority: r.priority, assigneeIds: r.assigneeIds, every: r.every, onDay: r.onDay, dueInDays: r.dueInDays,
  nextOn: dateStringFromDb(r.nextOn), active: r.active, lastMadeAt: r.lastMadeAt?.toISOString() ?? null,
})

/** Every 15 minutes: a company's day starts at its own midnight, so the tasks appear early in its morning. */
export function startPmRecurrences(): void {
  cron.schedule('*/15 * * * *', () => {
    runTracked('pm-recurrences', () => forEachCompany(() => runRecurrences())).catch(() => undefined)
  })
}
