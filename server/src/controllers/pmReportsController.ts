import type { Response } from 'express'
import { DateTime } from 'luxon'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { HttpError } from '../lib/pm/access'
import { viewer } from '../lib/pm/http'
import { memberTaskMetrics, taskMetrics } from '../lib/pm/metrics'
import { COMPANY_TZ } from '../lib/time'
import { sendCsv } from '../lib/csv'

/**
 * Projects dashboard (admins). Super Admins see every project; project admins see
 * the projects they administer. Members get their own numbers via /me/metrics.
 */

async function scopeProjects(me: { id: string; role: string }, only?: string): Promise<string[]> {
  let ids: string[]
  if (me.role === 'SUPER_ADMIN') ids = (await prisma.pmProject.findMany({ where: { status: 'ACTIVE' }, select: { id: true } })).map((p) => p.id)
  else ids = (await prisma.pmProjectMember.findMany({ where: { userId: me.id, role: 'ADMIN', project: { status: 'ACTIVE' } }, select: { projectId: true } })).map((p) => p.projectId)
  if (only) {
    const p = await prisma.pmProject.findFirst({ where: { OR: [{ key: only.toUpperCase() }, { id: only }] }, select: { id: true } })
    ids = p && ids.includes(p.id) ? [p.id] : []
  }
  return ids
}

function range(req: AuthedRequest): { from: Date; to: Date; fromStr: string; toStr: string } {
  const today = DateTime.now().setZone(COMPANY_TZ)
  const fromStr = typeof req.query.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : today.minus({ days: 29 }).toISODate()!
  const toStr = typeof req.query.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : today.toISODate()!
  const from = DateTime.fromISO(fromStr, { zone: COMPANY_TZ }).startOf('day').toJSDate()
  const to = DateTime.fromISO(toStr, { zone: COMPANY_TZ }).endOf('day').toJSDate()
  if (from > to) throw new HttpError(422, 'Start date is after end date')
  return { from, to, fromStr, toStr }
}

async function overdueList(projectIds: string[]) {
  const now = new Date()
  const rows = await prisma.pmTask.findMany({
    where: { projectId: { in: projectIds }, deletedAt: null, dueAt: { lt: now }, column: { category: { not: 'DONE' } } },
    include: { project: { select: { key: true, name: true, color: true } }, column: { select: { name: true } }, assignees: { include: { user: { select: { id: true, name: true } } } } },
    orderBy: { dueAt: 'asc' },
    take: 300,
  })
  return rows.map((t) => ({
    code: t.code,
    title: t.title,
    project: t.project,
    status: t.column.name,
    priority: t.priority,
    assignees: t.assignees.map((a) => a.user),
    dueAt: t.dueAt!.toISOString(),
    daysOverdue: Math.floor((now.getTime() - t.dueAt!.getTime()) / 86400000),
  }))
}

/** GET /api/projects/reports/overview?from=&to=&project= */
export async function reportOverview(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const ids = await scopeProjects(me, typeof req.query.project === 'string' && req.query.project ? req.query.project : undefined)
  const anyAdmin = me.role === 'SUPER_ADMIN' || (await prisma.pmProjectMember.count({ where: { userId: me.id, role: 'ADMIN' } })) > 0
  if (!anyAdmin) throw new HttpError(403, 'The projects dashboard is for project admins')
  const { from, to, fromStr, toStr } = range(req)
  const [metrics, overdue, projects] = await Promise.all([
    taskMetrics(ids, from, to),
    overdueList(ids),
    prisma.pmProject.findMany({ where: { id: { in: await scopeProjects(me) } }, select: { key: true, name: true }, orderBy: { name: 'asc' } }),
  ])
  res.json({ from: fromStr, to: toStr, projects, ...metrics, overdue })
}

/** GET /api/projects/reports/export.csv?type=members|overdue|projects */
export async function reportCsv(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const anyAdmin = me.role === 'SUPER_ADMIN' || (await prisma.pmProjectMember.count({ where: { userId: me.id, role: 'ADMIN' } })) > 0
  if (!anyAdmin) throw new HttpError(403, 'Forbidden')
  const ids = await scopeProjects(me, typeof req.query.project === 'string' && req.query.project ? req.query.project : undefined)
  const { from, to, fromStr, toStr } = range(req)
  const type = String(req.query.type || 'members')
  let rows: (string | number)[][]
  if (type === 'overdue') {
    const list = await overdueList(ids)
    rows = [['Task', 'Title', 'Project', 'Status', 'Priority', 'Assignees', 'Due', 'Days overdue'], ...list.map((r) => [r.code, r.title, r.project.name, r.status, r.priority, r.assignees.map((a) => a.name).join('; '), r.dueAt, r.daysOverdue])]
  } else if (type === 'projects') {
    const m = await taskMetrics(ids, from, to)
    rows = [['Project', 'Key', 'Open', 'In progress', 'Overdue', 'Done in range'], ...m.byProject.map((p) => [p.name, p.key, p.open, p.inProgress, p.overdue, p.done])]
  } else {
    const m = await taskMetrics(ids, from, to)
    rows = [['Member', 'Open', 'Overdue', 'Completed', 'On time %', 'Avg days late'], ...m.byMember.map((u) => [u.name, u.open, u.overdue, u.completed, u.onTimeRate ?? '', u.avgDaysLate ?? ''])]
  }
  sendCsv(res, `projects-${type}-${fromStr}-to-${toStr}.csv`, rows)
}

/** GET /api/projects/me/metrics?from=&to= — my own task KPIs (any user). */
export async function myMetrics(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const { from, to, fromStr, toStr } = range(req)
  res.json({ from: fromStr, to: toStr, metrics: await memberTaskMetrics(me.id, from, to) })
}
