import type { Response } from 'express'
import { DateTime } from 'luxon'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { companyToday, dbDateFromString, dateStringFromDb, periodRange, previousRange, type RangeKey, type DateRange } from '../lib/time'
import { buildSeries, pctDelta } from '../lib/trends'
import { actsAs } from '../lib/acting'

function loadUser(id: string) {
  return prisma.user.findUniqueOrThrow({ where: { id }, include: { department: true } })
}
async function marketingUser(req: AuthedRequest, res: Response) {
  const me = await loadUser(req.user!.id)
  if (actsAs(me, 'MARKETING') || me.role === 'SUPER_ADMIN') return me
  res.status(403).json({ error: 'Marketing access only' })
  return null
}
const inRange = (r: DateRange) => ({ gte: dbDateFromString(r.startDate), lte: dbDateFromString(r.endDate) })

/**
 * GET /api/marketing/social/planner?month=YYYY-MM&brandId=
 * Scheduled SOCIAL cards for the month, grouped by brand → platform. Powers the
 * Social Planner (replaces the editorial calendar for social content).
 */
export async function socialPlanner(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await marketingUser(req, res))) return
  const monthParam = (req.query.month as string) || companyToday().slice(0, 7)
  const start = DateTime.fromISO(`${monthParam}-01`, { zone: 'utc' }).startOf('month')
  const end = start.endOf('month')
  const range: DateRange = { startDate: start.toISODate()!, endDate: end.toISODate()! }

  const tasks = await prisma.marketingTask.findMany({
    where: {
      discipline: 'SOCIAL',
      scheduledDate: inRange(range),
      ...(req.query.brandId ? { brandId: String(req.query.brandId) } : {}),
    },
    include: { brand: { select: { id: true, name: true } }, assignee: { select: { id: true, name: true } } },
    orderBy: { scheduledDate: 'asc' },
  })

  const posts = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    platform: t.platform,
    scheduledDate: t.scheduledDate ? dateStringFromDb(t.scheduledDate) : null,
    brand: t.brand,
    assignee: t.assignee,
  }))

  res.json({ month: monthParam, startDate: range.startDate, endDate: range.endDate, posts })
}

/** GET /api/marketing/analytics?range= — work published, content pipeline and velocity. */
export async function marketingAnalytics(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await marketingUser(req, res))) return
  const rangeKey = ((req.query.range as RangeKey) || 'month') as RangeKey
  const range = periodRange(rangeKey, { start: req.query.start as string, end: req.query.end as string })
  const prev = previousRange(range)

  const [contentTasks, publishedTasks, publishedPrev, blogs, blogsPrev] = await Promise.all([
    prisma.marketingTask.findMany({ where: { discipline: 'CONTENT' }, select: { status: true } }),
    prisma.marketingTask.findMany({ where: { publishedDate: inRange(range) }, select: { discipline: true, publishedDate: true } }),
    prisma.marketingTask.findMany({ where: { publishedDate: inRange(prev) }, select: { discipline: true } }),
    prisma.blogPost.count({ where: { status: 'PUBLISHED', publishedAt: inRange(range) } }),
    prisma.blogPost.count({ where: { status: 'PUBLISHED', publishedAt: inRange(prev) } }),
  ])
  const count = (rows: { discipline: string }[], d?: string) => rows.filter((t) => !d || t.discipline === d).length
  const kpi = (label: string, cur: number, before: number) => ({ label, value: cur, format: 'number' as const, delta: pctDelta(cur, before) })
  const kpis = [
    kpi('Published (all work)', count(publishedTasks), count(publishedPrev)),
    kpi('Social posts published', count(publishedTasks, 'SOCIAL'), count(publishedPrev, 'SOCIAL')),
    kpi('Content published', count(publishedTasks, 'CONTENT'), count(publishedPrev, 'CONTENT')),
    kpi('Blogs published', blogs, blogsPrev),
  ]

  const STATUSES = ['BACKLOG', 'IN_PROGRESS', 'IN_REVIEW', 'SCHEDULED', 'PUBLISHED']
  const content = {
    pipeline: STATUSES.map((s) => ({ status: s, count: contentTasks.filter((t) => t.status === s).length })),
    publishedThisPeriod: publishedTasks.filter((t) => t.discipline === 'CONTENT').length,
  }

  // Velocity: tasks reaching Published per bucket (all disciplines).
  const velocity = buildSeries(range, publishedTasks.map((t) => ({ date: dateStringFromDb(t.publishedDate!), value: 1 })))

  res.json({ range: { ...range, key: rangeKey }, kpis, content, velocity: { metricLabel: 'Published', points: velocity } })
}
