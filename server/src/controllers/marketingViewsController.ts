import type { Response } from 'express'
import { DateTime } from 'luxon'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { companyToday, dbDateFromString, dateStringFromDb, periodRange, previousRange, type RangeKey, type DateRange } from '../lib/time'
import { buildSeries, pctDelta } from '../lib/trends'

function loadUser(id: string) {
  return prisma.user.findUniqueOrThrow({ where: { id }, include: { department: true } })
}
async function marketingUser(req: AuthedRequest, res: Response) {
  const me = await loadUser(req.user!.id)
  if (me.department?.type === 'MARKETING' || me.role === 'SUPER_ADMIN') return me
  res.status(403).json({ error: 'Marketing access only' })
  return null
}
const inRange = (r: DateRange) => ({ gte: dbDateFromString(r.startDate), lte: dbDateFromString(r.endDate) })

/** GET /api/marketing/calendar?month=YYYY-MM — scheduled vs published vs due events. */
export async function calendar(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await marketingUser(req, res))) return
  const monthParam = (req.query.month as string) || companyToday().slice(0, 7)
  const start = DateTime.fromISO(`${monthParam}-01`, { zone: 'utc' }).startOf('month')
  const end = start.endOf('month')
  const range: DateRange = { startDate: start.toISODate()!, endDate: end.toISODate()! }

  const tasks = await prisma.marketingTask.findMany({
    where: {
      OR: [{ scheduledDate: inRange(range) }, { publishedDate: inRange(range) }, { dueDate: inRange(range) }],
    },
    orderBy: { title: 'asc' },
  })

  const events: { id: string; title: string; discipline: string; date: string; type: 'scheduled' | 'published' | 'due' }[] = []
  for (const t of tasks) {
    if (t.publishedDate && t.publishedDate >= start.toJSDate() && t.publishedDate <= end.toJSDate())
      events.push({ id: `${t.id}-p`, title: t.title, discipline: t.discipline, date: dateStringFromDb(t.publishedDate), type: 'published' })
    else if (t.scheduledDate && t.scheduledDate >= start.toJSDate() && t.scheduledDate <= end.toJSDate())
      events.push({ id: `${t.id}-s`, title: t.title, discipline: t.discipline, date: dateStringFromDb(t.scheduledDate), type: 'scheduled' })
    else if (t.dueDate && t.dueDate >= start.toJSDate() && t.dueDate <= end.toJSDate())
      events.push({ id: `${t.id}-d`, title: t.title, discipline: t.discipline, date: dateStringFromDb(t.dueDate), type: 'due' })
  }

  res.json({ month: monthParam, startDate: range.startDate, endDate: range.endDate, events })
}

const sum = <T>(rows: T[], pick: (r: T) => number, ok: (r: T) => boolean) =>
  rows.reduce((a, r) => (ok(r) ? a + pick(r) : a), 0)

/** GET /api/marketing/analytics?range= — SEO + Social + Content + velocity. */
export async function marketingAnalytics(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await marketingUser(req, res))) return
  const rangeKey = ((req.query.range as RangeKey) || 'month') as RangeKey
  const range = periodRange(rangeKey, { start: req.query.start as string, end: req.query.end as string })
  const prev = previousRange(range)
  const submitted = (r: { status: string }) => r.status === 'SUBMITTED'

  const [seoCur, seoPrev, socCur, socPrev, contentTasks, publishedTasks] = await Promise.all([
    prisma.seoDailyEntry.findMany({ where: { date: inRange(range) } }),
    prisma.seoDailyEntry.findMany({ where: { date: inRange(prev) } }),
    prisma.socialDailyEntry.findMany({ where: { date: inRange(range) } }),
    prisma.socialDailyEntry.findMany({ where: { date: inRange(prev) } }),
    prisma.marketingTask.findMany({ where: { discipline: 'CONTENT' } }),
    prisma.marketingTask.findMany({ where: { publishedDate: inRange(range) } }),
  ])

  const seo = {
    kpis: [
      { label: 'Pages Optimized', value: sum(seoCur, (e) => e.pagesOptimized, submitted), format: 'number', delta: pctDelta(sum(seoCur, (e) => e.pagesOptimized, submitted), sum(seoPrev, (e) => e.pagesOptimized, submitted)) },
      { label: 'Backlinks Built', value: sum(seoCur, (e) => e.backlinksBuilt, submitted), format: 'number', delta: pctDelta(sum(seoCur, (e) => e.backlinksBuilt, submitted), sum(seoPrev, (e) => e.backlinksBuilt, submitted)) },
      { label: 'Technical Fixes', value: sum(seoCur, (e) => e.technicalFixes, submitted), format: 'number', delta: pctDelta(sum(seoCur, (e) => e.technicalFixes, submitted), sum(seoPrev, (e) => e.technicalFixes, submitted)) },
    ],
    trafficTrend: buildSeries(range, seoCur.map((e) => ({ date: dateStringFromDb(e.date), value: e.organicTraffic, status: e.status }))),
  }

  const social = {
    kpis: [
      { label: 'Posts Published', value: sum(socCur, (e) => e.postsPublished, submitted), format: 'number', delta: pctDelta(sum(socCur, (e) => e.postsPublished, submitted), sum(socPrev, (e) => e.postsPublished, submitted)) },
      { label: 'Reach', value: sum(socCur, (e) => e.reach, submitted), format: 'number', delta: pctDelta(sum(socCur, (e) => e.reach, submitted), sum(socPrev, (e) => e.reach, submitted)) },
      { label: 'Followers Gained', value: sum(socCur, (e) => e.followersGained, submitted), format: 'number', delta: pctDelta(sum(socCur, (e) => e.followersGained, submitted), sum(socPrev, (e) => e.followersGained, submitted)) },
    ],
    engagementTrend: buildSeries(range, socCur.map((e) => ({ date: dateStringFromDb(e.date), value: e.engagement, status: e.status }))),
  }

  const STATUSES = ['BACKLOG', 'IN_PROGRESS', 'IN_REVIEW', 'SCHEDULED', 'PUBLISHED']
  const content = {
    pipeline: STATUSES.map((s) => ({ status: s, count: contentTasks.filter((t) => t.status === s).length })),
    publishedThisPeriod: publishedTasks.filter((t) => t.discipline === 'CONTENT').length,
  }

  // Velocity: tasks reaching Published per bucket (all disciplines).
  const velocity = buildSeries(range, publishedTasks.map((t) => ({ date: dateStringFromDb(t.publishedDate!), value: 1 })))

  res.json({ range: { ...range, key: rangeKey }, seo, social, content, velocity: { metricLabel: 'Published', points: velocity } })
}
