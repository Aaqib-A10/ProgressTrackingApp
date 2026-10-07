import type { PmColumnCategory } from '@prisma/client'
import { prisma } from '../prisma'

/**
 * Task KPIs for the Projects dashboard and for PulseTrack's performance views.
 * Pure aggregation over PmTask; nothing here changes the existing KPI math.
 *
 *   on time rate   = completed on or before due  ÷  completed that had a due date
 *   avg days late  = mean (completedAt − dueAt) in days over late completions
 */

export interface MemberTaskMetrics {
  userId: string
  name: string
  open: number
  overdue: number
  completed: number
  completedWithDue: number
  completedOnTime: number
  onTimeRate: number | null
  avgDaysLate: number | null
}

export interface ProjectTaskMetrics {
  projectId: string
  key: string
  name: string
  color: string
  open: number
  inProgress: number
  overdue: number
  done: number
}

const DAY = 86400000
const round1 = (n: number) => Math.round(n * 10) / 10

type Row = {
  projectId: string
  dueAt: Date | null
  completedAt: Date | null
  category: PmColumnCategory
  assigneeIds: string[]
}

async function loadRows(projectIds: string[]): Promise<Row[]> {
  const tasks = await prisma.pmTask.findMany({
    where: { projectId: { in: projectIds }, deletedAt: null },
    select: { projectId: true, dueAt: true, completedAt: true, column: { select: { category: true } }, assignees: { select: { userId: true } } },
  })
  return tasks.map((t) => ({ projectId: t.projectId, dueAt: t.dueAt, completedAt: t.completedAt, category: t.column.category, assigneeIds: t.assignees.map((a) => a.userId) }))
}

export function computeMetrics(rows: Row[], from: Date, to: Date, now = new Date()) {
  const isOpen = (r: Row) => r.category !== 'DONE'
  const isOverdue = (r: Row) => isOpen(r) && !!r.dueAt && r.dueAt < now
  const doneInRange = (r: Row) => r.category === 'DONE' && !!r.completedAt && r.completedAt >= from && r.completedAt <= to

  const summarize = (subset: Row[]) => {
    const completed = subset.filter(doneInRange)
    const withDue = completed.filter((r) => r.dueAt)
    const onTime = withDue.filter((r) => r.completedAt! <= r.dueAt!)
    const late = withDue.filter((r) => r.completedAt! > r.dueAt!)
    return {
      open: subset.filter(isOpen).length,
      overdue: subset.filter(isOverdue).length,
      completed: completed.length,
      completedWithDue: withDue.length,
      completedOnTime: onTime.length,
      onTimeRate: withDue.length ? round1((onTime.length / withDue.length) * 100) : null,
      avgDaysLate: late.length ? round1(late.reduce((s, r) => s + (r.completedAt!.getTime() - r.dueAt!.getTime()) / DAY, 0) / late.length) : null,
    }
  }
  return { summarize, isOpen, isOverdue, doneInRange }
}

export async function taskMetrics(projectIds: string[], from: Date, to: Date, now = new Date()) {
  const rows = await loadRows(projectIds)
  const { summarize, isOpen, isOverdue, doneInRange } = computeMetrics(rows, from, to, now)
  const projects = await prisma.pmProject.findMany({ where: { id: { in: projectIds } }, select: { id: true, key: true, name: true, color: true }, orderBy: { name: 'asc' } })
  const inProgressCols = await prisma.pmTask.groupBy({ by: ['projectId'], where: { projectId: { in: projectIds }, deletedAt: null, column: { category: 'IN_PROGRESS' } }, _count: { _all: true } })

  const byProject: ProjectTaskMetrics[] = projects.map((p) => {
    const sub = rows.filter((r) => r.projectId === p.id)
    return {
      projectId: p.id,
      key: p.key,
      name: p.name,
      color: p.color,
      open: sub.filter(isOpen).length,
      inProgress: inProgressCols.find((x) => x.projectId === p.id)?._count._all ?? 0,
      overdue: sub.filter(isOverdue).length,
      done: sub.filter(doneInRange).length,
    }
  })

  const userIds = [...new Set(rows.flatMap((r) => r.assigneeIds))]
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
  const byMember: MemberTaskMetrics[] = users
    .map((u) => ({ userId: u.id, name: u.name, ...summarize(rows.filter((r) => r.assigneeIds.includes(u.id))) }))
    .sort((a, b) => b.overdue - a.overdue || b.open - a.open || a.name.localeCompare(b.name))

  return { overall: summarize(rows), byProject, byMember }
}

/** Per-person task KPIs across every project (for PulseTrack performance pages). */
export async function memberTaskMetrics(userId: string, from: Date, to: Date): Promise<Omit<MemberTaskMetrics, 'userId' | 'name'>> {
  const tasks = await prisma.pmTask.findMany({
    where: { deletedAt: null, assignees: { some: { userId } } },
    select: { projectId: true, dueAt: true, completedAt: true, column: { select: { category: true } } },
  })
  const rows: Row[] = tasks.map((t) => ({ projectId: t.projectId, dueAt: t.dueAt, completedAt: t.completedAt, category: t.column.category, assigneeIds: [userId] }))
  return computeMetrics(rows, from, to).summarize(rows)
}
