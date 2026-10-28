import { DateTime } from 'luxon'
import type { Department, User } from '@prisma/client'
import { prisma } from './prisma'
import { COMPANY_TZ, dbDateFromString, dateStringFromDb, type DateRange, type RangeKey } from './time'
import { buildSeries, pctDelta, improvementLine } from './trends'

/**
 * Team lead dashboards for the departments that are not ITAD or Lead Generation:
 * Ecommerce, Marketing, CSR and Inventory. Same shape as the ITAD one, so the
 * same screen shows them. Each department sees only its own numbers.
 */

type SubmissionStatus = 'SUBMITTED' | 'PENDING' | 'ON_LEAVE'

export interface DashKpi {
  label: string
  value: number
  format: 'number' | 'percent'
  delta: number
  caption?: string
  /** A count of how things stand right now: no "vs previous period" arrow. */
  now?: boolean
}

export interface TeamDashboardPayload {
  department: string
  range: DateRange & { key: RangeKey }
  kpis: DashKpi[]
  trend: { metricLabel: string; points: { label: string; value: number; target?: number }[] }
  breakdown: { name: string; value: number }[]
  /** Title of the breakdown card (default "Activity Breakdown"). */
  breakdownTitle?: string
  improvement: string
  todaySubmissions: { id: string; name: string; status: SubmissionStatus; metricLabel: string; metricValue: number }[]
  counts: { submitted: number; total: number }
  /** Departments without a daily form: the people table shows a number, not a submitted badge. */
  people?: { title: string; subtitle: string; showStatus: boolean }
}

export interface DashCtx {
  dept: Department
  members: User[]
  /** Sub-department slug per member (Marketing: seo / social / content / ads / email). */
  subSlugs: Map<string, string>
  rangeKey: RangeKey
  range: DateRange
  prev: DateRange
  todayStr: string
}

const dateIn = (r: DateRange) => ({ gte: dbDateFromString(r.startDate), lte: dbDateFromString(r.endDate) })
/** Timestamps (completedAt, resolvedAt, createdAt) inside the range, by the company's clock. */
export function timeIn(r: DateRange) {
  return {
    gte: DateTime.fromISO(r.startDate, { zone: COMPANY_TZ }).startOf('day').toJSDate(),
    lte: DateTime.fromISO(r.endDate, { zone: COMPANY_TZ }).endOf('day').toJSDate(),
  }
}
/** Company calendar day of a timestamp. */
const dayOf = (d: Date) => DateTime.fromJSDate(d).setZone(COMPANY_TZ).toISODate()!
const submitted = <T extends { status: string }>(rows: T[]) => rows.filter((e) => e.status === 'SUBMITTED')
const sum = <T>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0)
const statusFor = (e: { status: string } | undefined): SubmissionStatus => (!e ? 'PENDING' : e.status === 'SUBMITTED' ? 'SUBMITTED' : 'ON_LEAVE')
const ratio = (a: number, b: number) => (b ? a / b : 0)

async function deptTarget(departmentId: string, metricKey: string, period: 'DAILY' | 'WEEKLY'): Promise<number> {
  const t = await prisma.target.findFirst({ where: { scope: 'DEPARTMENT', departmentId, metricKey, period } })
  return t?.value ?? 0
}

function base(c: DashCtx) {
  return { department: c.dept.type, range: { ...c.range, key: c.rangeKey } }
}

// ------------------------------------------------------------------ Ecommerce

export async function ecommerceDashboard(c: DashCtx): Promise<TeamDashboardPayload> {
  const ids = c.members.map((m) => m.id)
  const [cur, prv, today, doneCur, donePrev, openTasks, stockCur, stockPrev] = await Promise.all([
    prisma.ecommerceDailyEntry.findMany({ where: { userId: { in: ids }, date: dateIn(c.range) }, include: { lines: { include: { marketplace: true } } } }),
    prisma.ecommerceDailyEntry.findMany({ where: { userId: { in: ids }, date: dateIn(c.prev) }, include: { lines: true } }),
    prisma.ecommerceDailyEntry.findMany({ where: { userId: { in: ids }, date: dbDateFromString(c.todayStr) }, include: { lines: true } }),
    prisma.ecommerceTask.count({ where: { status: 'DONE', completedAt: timeIn(c.range) } }),
    prisma.ecommerceTask.count({ where: { status: 'DONE', completedAt: timeIn(c.prev) } }),
    prisma.ecommerceTask.count({ where: { status: { not: 'DONE' } } }),
    prisma.stockRequest.count({ where: { departmentId: c.dept.id, status: 'RESOLVED', resolvedAt: timeIn(c.range) } }),
    prisma.stockRequest.count({ where: { departmentId: c.dept.id, status: 'RESOLVED', resolvedAt: timeIn(c.prev) } }),
  ])
  const listingsOf = (e: { lines: { listings: number }[] }) => sum(e.lines, (l) => l.listings)
  const lc = sum(submitted(cur), listingsOf), lp = sum(submitted(prv), listingsOf)
  const byMarket = new Map<string, number>()
  for (const e of submitted(cur)) for (const l of e.lines) byMarket.set(l.marketplace.name, (byMarket.get(l.marketplace.name) ?? 0) + l.listings)
  const todayMap = new Map(today.map((e) => [e.userId, e]))
  return {
    ...base(c),
    kpis: [
      { label: 'Listings', value: lc, format: 'number', delta: pctDelta(lc, lp), caption: 'vs prev period' },
      { label: 'Tasks Completed', value: doneCur, format: 'number', delta: pctDelta(doneCur, donePrev), caption: 'vs prev period' },
      { label: 'Open Tasks', value: openTasks, format: 'number', delta: 0, now: true, caption: 'Right now' },
      { label: 'Stock Requests Done', value: stockCur, format: 'number', delta: pctDelta(stockCur, stockPrev), caption: 'vs prev period' },
    ],
    trend: { metricLabel: 'Listings', points: buildSeries(c.range, cur.map((e) => ({ date: dateStringFromDb(e.date), value: listingsOf(e), status: e.status }))) },
    breakdown: [...byMarket.entries()].sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value })),
    breakdownTitle: 'Listings by Marketplace',
    improvement: improvementLine([
      { label: 'Listings', delta: pctDelta(lc, lp) },
      { label: 'Tasks completed', delta: pctDelta(doneCur, donePrev) },
    ]),
    todaySubmissions: c.members.map((m) => {
      const e = todayMap.get(m.id)
      return { id: m.id, name: m.name, status: statusFor(e), metricLabel: 'Listings', metricValue: e ? listingsOf(e) : 0 }
    }),
    counts: { submitted: submitted(today).length, total: c.members.length },
  }
}

// ------------------------------------------------------------------ Marketing

/** Marketing sub-departments with a daily log. */
const logSubs = new Set(['seo', 'content'])
const DISCIPLINE_LABEL: Record<string, string> = { SEO: 'SEO', SOCIAL: 'Social Media', CONTENT: 'Content' }

export async function marketingDashboard(c: DashCtx): Promise<TeamDashboardPayload> {
  const ids = c.members.map((m) => m.id)
  const todayDate = dbDateFromString(c.todayStr)
  const [doneCur, donePrev, posts, postsPrev, blogsCur, blogsPrev, overdue, seoToday, contentToday] = await Promise.all([
    prisma.marketingTask.findMany({ where: { status: 'PUBLISHED', completedAt: timeIn(c.range) }, select: { completedAt: true, discipline: true, assigneeId: true } }),
    prisma.marketingTask.count({ where: { status: 'PUBLISHED', completedAt: timeIn(c.prev) } }),
    prisma.marketingTask.count({ where: { discipline: 'SOCIAL', status: 'PUBLISHED', completedAt: timeIn(c.range) } }),
    prisma.marketingTask.count({ where: { discipline: 'SOCIAL', status: 'PUBLISHED', completedAt: timeIn(c.prev) } }),
    prisma.blogPost.count({ where: { status: 'PUBLISHED', publishedAt: dateIn(c.range) } }),
    prisma.blogPost.count({ where: { status: 'PUBLISHED', publishedAt: dateIn(c.prev) } }),
    prisma.marketingTask.count({ where: { status: { not: 'PUBLISHED' }, dueDate: { lt: todayDate } } }),
    prisma.seoDailyEntry.findMany({ where: { userId: { in: ids }, date: todayDate }, select: { userId: true, status: true } }),
    prisma.contentDailyEntry.findMany({ where: { userId: { in: ids }, date: todayDate }, select: { userId: true, status: true } }),
  ])
  const byDiscipline = new Map<string, number>()
  for (const t of doneCur) byDiscipline.set(DISCIPLINE_LABEL[t.discipline] ?? t.discipline, (byDiscipline.get(DISCIPLINE_LABEL[t.discipline] ?? t.discipline) ?? 0) + 1)
  // One daily log a day per person, whichever their discipline uses.
  const todayLog = new Map<string, { status: string }>()
  for (const e of [...seoToday, ...contentToday]) if (!todayLog.has(e.userId) || e.status === 'SUBMITTED') todayLog.set(e.userId, e)
  const doneToday = new Map<string, number>()
  for (const t of doneCur) if (t.assigneeId && t.completedAt && dayOf(t.completedAt) === c.todayStr) doneToday.set(t.assigneeId, (doneToday.get(t.assigneeId) ?? 0) + 1)
  return {
    ...base(c),
    kpis: [
      { label: 'Tasks Published', value: doneCur.length, format: 'number', delta: pctDelta(doneCur.length, donePrev), caption: 'vs prev period' },
      { label: 'Social Posts Published', value: posts, format: 'number', delta: pctDelta(posts, postsPrev), caption: 'vs prev period' },
      { label: 'Blogs Published', value: blogsCur, format: 'number', delta: pctDelta(blogsCur, blogsPrev), caption: 'vs prev period' },
      { label: 'Overdue Tasks', value: overdue, format: 'number', delta: 0, now: true, caption: 'Right now' },
    ],
    trend: { metricLabel: 'Tasks Published', points: buildSeries(c.range, doneCur.map((t) => ({ date: dayOf(t.completedAt!), value: 1 }))) },
    breakdown: [...byDiscipline.entries()].map(([name, value]) => ({ name, value })),
    breakdownTitle: 'Published by Discipline',
    improvement: improvementLine([
      { label: 'Tasks published', delta: pctDelta(doneCur.length, donePrev) },
      { label: 'Social posts', delta: pctDelta(posts, postsPrev) },
    ]),
    // Everyone, with the tasks they finished today; who logged is in the subtitle (only SEO and Content keep a daily log).
    todaySubmissions: c.members.map((m) => ({ id: m.id, name: m.name, status: statusFor(todayLog.get(m.id)), metricLabel: 'Tasks done today', metricValue: doneToday.get(m.id) ?? 0 })),
    // Ads and Email have no daily log, so they are not counted as "not submitted".
    counts: { submitted: [...todayLog.values()].filter((e) => e.status === 'SUBMITTED').length, total: c.members.filter((m) => logSubs.has(c.subSlugs.get(m.id) ?? '')).length },
    people: (() => {
      const withLog = c.members.filter((m) => logSubs.has(c.subSlugs.get(m.id) ?? '')).length
      const logged = [...todayLog.values()].filter((e) => e.status === 'SUBMITTED').length
      return { title: 'Team Today', subtitle: `Tasks finished today · ${logged} of ${withLog} SEO and Content daily logs submitted`, showStatus: false }
    })(),
  }
}

// ------------------------------------------------------------------ CSR (QA scores)

export async function csrDashboard(c: DashCtx): Promise<TeamDashboardPayload> {
  const where = (r: DateRange) => ({ departmentId: c.dept.id, status: 'SUBMITTED' as const, createdAt: timeIn(r) })
  const [cur, prv] = await Promise.all([
    prisma.qaEvaluation.findMany({ where: where(c.range), select: { agentId: true, totalScore: true, passed: true, coachingNeeded: true, createdAt: true } }),
    prisma.qaEvaluation.findMany({ where: where(c.prev), select: { totalScore: true, passed: true, coachingNeeded: true } }),
  ])
  const avgOf = (rows: { totalScore: number }[]) => (rows.length ? sum(rows, (e) => e.totalScore) / rows.length / 100 : 0)
  const passOf = (rows: { passed: boolean }[]) => ratio(rows.filter((e) => e.passed).length, rows.length)
  const coach = cur.filter((e) => e.coachingNeeded).length, coachPrev = prv.filter((e) => e.coachingNeeded).length
  const perAgent = new Map<string, number[]>()
  for (const e of cur) perAgent.set(e.agentId, [...(perAgent.get(e.agentId) ?? []), e.totalScore])
  return {
    ...base(c),
    kpis: [
      { label: 'Evaluations', value: cur.length, format: 'number', delta: pctDelta(cur.length, prv.length), caption: 'vs prev period' },
      { label: 'Average QA Score', value: avgOf(cur), format: 'percent', delta: pctDelta(avgOf(cur), avgOf(prv)), caption: 'vs prev period' },
      { label: 'Pass Rate', value: passOf(cur), format: 'percent', delta: pctDelta(passOf(cur), passOf(prv)), caption: 'vs prev period' },
      { label: 'Coaching Needed', value: coach, format: 'number', delta: pctDelta(coach, coachPrev), caption: 'vs prev period' },
    ],
    trend: { metricLabel: 'Evaluations', points: buildSeries(c.range, cur.map((e) => ({ date: dayOf(e.createdAt), value: 1 }))) },
    breakdown: [
      { name: 'Passed', value: cur.filter((e) => e.passed).length },
      { name: 'Failed', value: cur.filter((e) => !e.passed).length },
    ],
    breakdownTitle: 'Pass / Fail',
    improvement: cur.length
      ? improvementLine([
        { label: 'Average QA score', delta: pctDelta(avgOf(cur), avgOf(prv)) },
        { label: 'Pass rate', delta: pctDelta(passOf(cur), passOf(prv)) },
      ])
      : 'No QA evaluations for your team in this period yet.',
    todaySubmissions: c.members.map((m) => {
      const s = perAgent.get(m.id) ?? []
      return { id: m.id, name: m.name, status: 'SUBMITTED', metricLabel: 'Avg QA score (%)', metricValue: s.length ? Math.round(sum(s, (x) => x) / s.length) : 0 }
    }),
    counts: { submitted: perAgent.size, total: c.members.length },
    people: { title: 'Team QA Scores', subtitle: `${perAgent.size} of ${c.members.length} agents evaluated in this period`, showStatus: false },
  }
}

// ------------------------------------------------------------------ Inventory

export async function inventoryDashboard(c: DashCtx): Promise<TeamDashboardPayload> {
  const item = { departmentId: c.dept.id }
  const [doneCur, donePrev, open, items] = await Promise.all([
    prisma.inventoryMovement.findMany({ where: { item, status: 'COMPLETED', resolvedAt: timeIn(c.range) }, select: { type: true, quantity: true, resolvedAt: true, assignedToId: true } }),
    prisma.inventoryMovement.findMany({ where: { item, status: 'COMPLETED', resolvedAt: timeIn(c.prev) }, select: { quantity: true } }),
    prisma.inventoryMovement.count({ where: { item, status: { in: ['REQUESTED', 'ASSIGNED'] } } }),
    prisma.inventoryItem.findMany({ where: { ...item, active: true }, select: { quantity: true, lowStockAt: true } }),
  ])
  const low = items.filter((i) => i.quantity <= i.lowStockAt).length
  const units = sum(doneCur, (m) => m.quantity), unitsPrev = sum(donePrev, (m) => m.quantity)
  const perPerson = new Map<string, number>()
  for (const m of doneCur) if (m.assignedToId) perPerson.set(m.assignedToId, (perPerson.get(m.assignedToId) ?? 0) + 1)
  return {
    ...base(c),
    kpis: [
      { label: 'Requests Completed', value: doneCur.length, format: 'number', delta: pctDelta(doneCur.length, donePrev.length), caption: 'vs prev period' },
      { label: 'Units Moved', value: units, format: 'number', delta: pctDelta(units, unitsPrev), caption: 'vs prev period' },
      { label: 'Open Requests', value: open, format: 'number', delta: 0, now: true, caption: 'Right now' },
      { label: 'Low Stock Items', value: low, format: 'number', delta: 0, now: true, caption: `of ${items.length} items` },
    ],
    trend: { metricLabel: 'Requests Completed', points: buildSeries(c.range, doneCur.map((m) => ({ date: dayOf(m.resolvedAt!), value: 1 }))) },
    breakdown: [
      { name: 'Stock in', value: sum(doneCur.filter((m) => m.type === 'STOCK_IN'), (m) => m.quantity) },
      { name: 'Stock out', value: sum(doneCur.filter((m) => m.type === 'STOCK_OUT'), (m) => m.quantity) },
    ],
    breakdownTitle: 'Units In / Out',
    improvement: improvementLine([
      { label: 'Requests completed', delta: pctDelta(doneCur.length, donePrev.length) },
      { label: 'Units moved', delta: pctDelta(units, unitsPrev) },
    ]),
    todaySubmissions: c.members.map((m) => ({ id: m.id, name: m.name, status: 'SUBMITTED', metricLabel: 'Requests completed', metricValue: perPerson.get(m.id) ?? 0 })),
    counts: { submitted: perPerson.size, total: c.members.length },
    people: { title: 'Team Work', subtitle: 'Requests each person completed in this period', showStatus: false },
  }
}
