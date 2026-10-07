import type { Response } from 'express'
import { DateTime } from 'luxon'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { COMPANY_TZ, companyToday, dateStringFromDb } from '../lib/time'
import { visibleProjectIds } from '../lib/pm/access'

/**
 * GET /api/tasks/mine — every task assigned to the caller, unified across the
 * Ecommerce and Marketing boards. Private: only tasks where the caller is the
 * assignee. Returns the open list plus completed-by-day/week/month counts.
 */

type Source = 'ecommerce' | 'marketing' | 'project'

interface PendingTask {
  id: string
  source: Source
  title: string
  /** Project tasks only: code + project chip. */
  code?: string
  projectName?: string
  status: string
  dueDate: string | null
  overdue: boolean
  link: string
}

const ECOM_STATUS_LABEL: Record<string, string> = { TODO: 'To Do', IN_PROGRESS: 'In Progress', DONE: 'Done' }
const MKT_STATUS_LABEL: Record<string, string> = {
  BACKLOG: 'Backlog',
  IN_PROGRESS: 'In Progress',
  IN_REVIEW: 'In Review',
  SCHEDULED: 'Scheduled',
  PUBLISHED: 'Published',
}

export async function getMyTasks(req: AuthedRequest, res: Response): Promise<void> {
  const userId = req.user!.id
  const today = companyToday()
  const now = DateTime.now().setZone(COMPANY_TZ)
  const startOfWeek = now.startOf('week') // Luxon weeks start Monday
  const startOfMonth = now.startOf('month')
  const monthStartJs = startOfMonth.toJSDate()

  const projectIds = await visibleProjectIds({ id: userId, role: req.user!.role })
  const [ecomOpen, mktOpen, ecomDone, mktDone, pmOpen, pmDone] = await Promise.all([
    prisma.ecommerceTask.findMany({
      where: { assignedToId: userId, status: { not: 'DONE' } },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
    }),
    prisma.marketingTask.findMany({
      where: { assigneeId: userId, status: { not: 'PUBLISHED' } },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
    }),
    // Completed this month (widest window we need) — bucketed in JS below.
    prisma.ecommerceTask.findMany({
      where: { assignedToId: userId, status: 'DONE', completedAt: { gte: monthStartJs } },
      select: { completedAt: true },
    }),
    prisma.marketingTask.findMany({
      where: { assigneeId: userId, status: 'PUBLISHED', completedAt: { gte: monthStartJs } },
      select: { completedAt: true },
    }),
    // Project management tasks (any project I can still see).
    prisma.pmTask.findMany({
      where: { projectId: { in: projectIds }, deletedAt: null, assignees: { some: { userId } }, column: { category: { not: 'DONE' } } },
      include: { project: { select: { key: true, name: true } }, column: { select: { name: true } } },
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
    }),
    prisma.pmTask.findMany({
      where: { deletedAt: null, assignees: { some: { userId } }, completedAt: { gte: monthStartJs }, column: { category: 'DONE' } },
      select: { completedAt: true },
    }),
  ])

  const isOverdue = (due: Date | null): boolean => !!due && dateStringFromDb(due) < today

  const pending: PendingTask[] = [
    ...ecomOpen.map((t) => ({
      id: t.id,
      source: 'ecommerce' as const,
      title: t.title,
      status: ECOM_STATUS_LABEL[t.status] ?? t.status,
      dueDate: t.dueDate ? dateStringFromDb(t.dueDate) : null,
      overdue: isOverdue(t.dueDate),
      link: '/app/ecommerce/board',
    })),
    ...mktOpen.map((t) => ({
      id: t.id,
      source: 'marketing' as const,
      title: t.title,
      status: MKT_STATUS_LABEL[t.status] ?? t.status,
      dueDate: t.dueDate ? dateStringFromDb(t.dueDate) : null,
      overdue: isOverdue(t.dueDate),
      link: '/app/marketing/board',
    })),
    ...pmOpen.map((t) => ({
      id: t.id,
      source: 'project' as const,
      title: t.title,
      code: t.code,
      projectName: t.project.name,
      status: t.column.name,
      dueDate: t.dueAt ? DateTime.fromJSDate(t.dueAt).setZone(COMPANY_TZ).toISODate() : null,
      overdue: !!t.dueAt && t.dueAt.getTime() < Date.now(),
      link: `/app/projects/${t.project.key}?task=${t.code}`,
    })),
  ]

  // Sort: overdue first, then by due date (undated last), then title.
  pending.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1
    if (a.dueDate && b.dueDate) return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0
    if (a.dueDate) return -1
    if (b.dueDate) return 1
    return a.title.localeCompare(b.title)
  })

  const completedDates = [...ecomDone, ...mktDone, ...pmDone]
    .map((t) => t.completedAt)
    .filter((d): d is Date => d != null)
  const inWindow = (d: Date, start: DateTime) => DateTime.fromJSDate(d).setZone(COMPANY_TZ) >= start
  const completedToday = completedDates.filter((d) => inWindow(d, now.startOf('day'))).length
  const completedThisWeek = completedDates.filter((d) => inWindow(d, startOfWeek)).length
  const completedThisMonth = completedDates.length

  res.json({
    pending,
    stats: {
      openCount: pending.length,
      dueTodayCount: pending.filter((t) => t.dueDate === today).length,
      overdueCount: pending.filter((t) => t.overdue).length,
      completedToday,
      completedThisWeek,
      completedThisMonth,
    },
  })
}
