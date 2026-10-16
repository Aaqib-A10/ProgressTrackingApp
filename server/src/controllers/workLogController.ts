import type { Response } from 'express'
import { z } from 'zod'
import { DateTime } from 'luxon'
import type { WorkLogPeriod } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { dbDateFromString, dateStringFromDb } from '../lib/time'

/**
 * My To-Do: Day / Week / Month / Year. Each entry belongs to a period (a day, a week, a month or
 * a year) and is either planned or done. Any date works, past or future, so people can log what
 * they already did (a "done list") as well as plan. The owner edits their own entries; their
 * Team Lead (same department) and Super Admins can read entries that are not private, see the
 * whole team for a period (who logged, who did not, who needs help) and review it with a rating
 * and a comment, like the work report confirmation in Bitrix24.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/
const PERIODS = ['DAY', 'WEEK', 'MONTH', 'YEAR'] as const

/** First day of the period that contains `date` (weeks start on Monday). */
export function periodStartOf(period: WorkLogPeriod, date: string): string {
  const d = DateTime.fromISO(date, { zone: 'utc' })
  switch (period) {
    case 'DAY': return d.toISODate()!
    case 'WEEK': return d.startOf('week').toISODate()!
    case 'MONTH': return d.startOf('month').toISODate()!
    case 'YEAR': return d.startOf('year').toISODate()!
  }
}
/** First day of the next period. */
export function nextPeriodStart(period: WorkLogPeriod, start: string): string {
  const d = DateTime.fromISO(start, { zone: 'utc' })
  const n = period === 'DAY' ? d.plus({ days: 1 }) : period === 'WEEK' ? d.plus({ weeks: 1 }) : period === 'MONTH' ? d.plus({ months: 1 }) : d.plus({ years: 1 })
  return n.toISODate()!
}

type Entry = Awaited<ReturnType<typeof prisma.workLogEntry.findFirstOrThrow>>
function view(e: Entry) {
  return {
    id: e.id, userId: e.userId, period: e.period, periodStart: dateStringFromDb(e.periodStart), title: e.title, details: e.details,
    status: e.status, doneAt: e.doneAt?.toISOString() ?? null, hours: e.hours, quantity: e.quantity, tag: e.tag, private: e.private, blocked: e.blocked,
    order: e.order, createdAt: e.createdAt.toISOString(), updatedAt: e.updatedAt.toISOString(),
  }
}

async function me(req: AuthedRequest) {
  return prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { id: true, role: true, departmentId: true } })
}

/** Can `viewer` read `ownerId`'s work log? Self, their department's Team Lead, or a Super Admin. */
async function canRead(viewer: Awaited<ReturnType<typeof me>>, ownerId: string): Promise<boolean> {
  if (viewer.id === ownerId || viewer.role === 'SUPER_ADMIN') return true
  if (viewer.role !== 'TEAM_LEAD' || !viewer.departmentId) return false
  const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { departmentId: true } })
  return owner?.departmentId === viewer.departmentId
}

/** GET /api/worklog?from=&to=&userId= — entries whose period starts in [from, to]. */
export async function listWorkLog(req: AuthedRequest, res: Response): Promise<void> {
  const from = String(req.query.from ?? '')
  const to = String(req.query.to ?? '')
  if (!DATE.test(from) || !DATE.test(to) || to < from) { res.status(400).json({ error: 'Pick a date range.' }); return }
  if (DateTime.fromISO(to).diff(DateTime.fromISO(from), 'days').days > 800) { res.status(400).json({ error: 'Pick a shorter range (about two years at most).' }); return }
  const viewer = await me(req)
  const ownerId = (req.query.userId as string) || viewer.id
  if (!(await canRead(viewer, ownerId))) { res.status(403).json({ error: 'You can only see your own work log.' }); return }
  const rows = await prisma.workLogEntry.findMany({
    where: { userId: ownerId, periodStart: { gte: dbDateFromString(from), lte: dbDateFromString(to) }, ...(ownerId !== viewer.id ? { private: false } : {}) },
    orderBy: [{ periodStart: 'asc' }, { status: 'asc' }, { order: 'asc' }, { createdAt: 'asc' }],
  })
  const reviews = await prisma.workLogReview.findMany({
    where: { userId: ownerId, periodStart: { gte: dbDateFromString(from), lte: dbDateFromString(to) } },
    include: { reviewer: { select: { name: true } } },
  })
  res.json({ entries: rows.map(view), reviews: reviews.map(reviewView), readOnly: ownerId !== viewer.id, canReview: ownerId !== viewer.id })
}

const optNum = (max: number) => z.number().min(0).max(max).nullable().optional()
const baseSchema = {
  title: z.string().trim().min(1, 'Write what it is.').max(3000, 'Keep it under 3000 characters, or split it into separate items.'),
  details: z.string().trim().max(4000).nullable().optional(),
  status: z.enum(['PLANNED', 'IN_PROGRESS', 'DONE']).optional(),
  hours: optNum(1000),
  quantity: z.number().int().min(0).max(1_000_000).nullable().optional(),
  tag: z.string().trim().max(40).nullable().optional(),
  private: z.boolean().optional(),
  blocked: z.boolean().optional(),
}
const createSchema = z.object({ period: z.enum(PERIODS), date: z.string().regex(DATE, 'Pick a date.'), ...baseSchema })

function dateOk(date: string): boolean {
  const d = DateTime.fromISO(date, { zone: 'utc' })
  const now = DateTime.utc()
  return d.isValid && d > now.minus({ years: 5 }) && d < now.plus({ years: 5 })
}

/** POST /api/worklog — add an entry for a day, week, month or year (past or future). */
export async function createWorkLog(req: AuthedRequest, res: Response): Promise<void> {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid entry' }); return }
  const d = parsed.data
  if (!dateOk(d.date)) { res.status(400).json({ error: 'Pick a date within five years of today.' }); return }
  const start = dbDateFromString(periodStartOf(d.period, d.date))
  const min = await prisma.workLogEntry.aggregate({ where: { userId: req.user!.id, period: d.period, periodStart: start }, _max: { order: true } })
  const status = d.status ?? 'PLANNED'
  const e = await prisma.workLogEntry.create({
    data: {
      userId: req.user!.id, period: d.period, periodStart: start, title: d.title, details: d.details || null, status,
      doneAt: status === 'DONE' ? new Date() : null, hours: d.hours ?? null, quantity: d.quantity ?? null, tag: d.tag || null,
      private: d.private ?? false, blocked: d.status === 'DONE' ? false : (d.blocked ?? false), order: (min._max.order ?? 0) + 1,
    },
  })
  res.status(201).json({ entry: view(e) })
}

const updateSchema = z.object({ ...baseSchema, title: baseSchema.title.optional(), period: z.enum(PERIODS).optional(), date: z.string().regex(DATE).optional() })

/** PATCH /api/worklog/:id — edit, tick done, or move to another day / week / month / year. Owner only. */
export async function updateWorkLog(req: AuthedRequest, res: Response): Promise<void> {
  const parsed = updateSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid entry' }); return }
  const e = await prisma.workLogEntry.findFirst({ where: { id: req.params.id, userId: req.user!.id } })
  if (!e) { res.status(404).json({ error: 'Entry not found' }); return }
  const d = parsed.data
  const period = d.period ?? e.period
  if (d.date && !dateOk(d.date)) { res.status(400).json({ error: 'Pick a date within five years of today.' }); return }
  const start = d.date || d.period ? dbDateFromString(periodStartOf(period, d.date ?? dateStringFromDb(e.periodStart))) : undefined
  const updated = await prisma.workLogEntry.update({
    where: { id: e.id },
    data: {
      ...(d.title !== undefined ? { title: d.title } : {}),
      ...(d.details !== undefined ? { details: d.details || null } : {}),
      ...(d.status !== undefined ? { status: d.status, doneAt: d.status === 'DONE' ? (e.doneAt ?? new Date()) : null } : {}),
      ...(d.hours !== undefined ? { hours: d.hours } : {}),
      ...(d.quantity !== undefined ? { quantity: d.quantity } : {}),
      ...(d.tag !== undefined ? { tag: d.tag || null } : {}),
      ...(d.private !== undefined ? { private: d.private } : {}),
      ...(d.blocked !== undefined ? { blocked: d.blocked } : {}),
      // Finishing something clears its "needs help" flag.
      ...(d.status === 'DONE' ? { blocked: false } : {}),
      ...(start ? { period, periodStart: start } : {}),
    },
  })
  res.json({ entry: view(updated) })
}

/** POST /api/worklog/:id/carry — move an unfinished entry to the next day / week / month / year. */
export async function carryWorkLog(req: AuthedRequest, res: Response): Promise<void> {
  const e = await prisma.workLogEntry.findFirst({ where: { id: req.params.id, userId: req.user!.id } })
  if (!e) { res.status(404).json({ error: 'Entry not found' }); return }
  if (e.status === 'DONE') { res.status(400).json({ error: 'It is already done.' }); return }
  const next = nextPeriodStart(e.period, dateStringFromDb(e.periodStart))
  const updated = await prisma.workLogEntry.update({ where: { id: e.id }, data: { periodStart: dbDateFromString(next) } })
  res.json({ entry: view(updated) })
}

/** DELETE /api/worklog/:id — owner only. */
export async function deleteWorkLog(req: AuthedRequest, res: Response): Promise<void> {
  const r = await prisma.workLogEntry.deleteMany({ where: { id: req.params.id, userId: req.user!.id } })
  if (r.count === 0) { res.status(404).json({ error: 'Entry not found' }); return }
  res.status(204).end()
}

/** GET /api/worklog/people — whose work log the caller can read (Team Lead: their department; Super Admin: everyone). */
export async function workLogPeople(req: AuthedRequest, res: Response): Promise<void> {
  const viewer = await me(req)
  if (viewer.role !== 'SUPER_ADMIN' && viewer.role !== 'TEAM_LEAD') { res.json({ people: [] }); return }
  const people = await prisma.user.findMany({
    where: { isActive: true, status: 'ACTIVE', id: { not: viewer.id }, ...(viewer.role === 'TEAM_LEAD' ? { departmentId: viewer.departmentId ?? '__none__' } : {}) },
    select: { id: true, name: true, department: { select: { name: true } } },
    orderBy: { name: 'asc' },
  })
  res.json({ people: people.map((p) => ({ id: p.id, name: p.name, department: p.department?.name ?? null })) })
}

// ------------------------------------------------------------------ team view and reviews

type Review = Awaited<ReturnType<typeof prisma.workLogReview.findFirstOrThrow>> & { reviewer: { name: string } }
function reviewView(r: Review) {
  return {
    id: r.id, userId: r.userId, period: r.period, periodStart: dateStringFromDb(r.periodStart), reviewerId: r.reviewerId,
    reviewerName: r.reviewer.name, rating: r.rating, comment: r.comment, updatedAt: r.updatedAt.toISOString(),
  }
}

const RANK: Record<WorkLogPeriod, number> = { DAY: 0, WEEK: 1, MONTH: 2, YEAR: 3 }
/** Last day of the period that starts on `start`. */
function periodEnd(period: WorkLogPeriod, start: string): string {
  return DateTime.fromISO(nextPeriodStart(period, start), { zone: 'utc' }).minus({ days: 1 }).toISODate()!
}

/**
 * GET /api/worklog/team?period=&date=&department= — Team Lead: their department; Super Admin:
 * everyone (or one department). For each person: what they logged in the period (their day
 * entries inside a week or month count too), totals, leave days, and the review.
 */
export async function teamWorkLog(req: AuthedRequest, res: Response): Promise<void> {
  const period = String(req.query.period ?? 'DAY') as WorkLogPeriod
  const date = String(req.query.date ?? '')
  if (!PERIODS.includes(period as (typeof PERIODS)[number]) || !DATE.test(date)) { res.status(400).json({ error: 'Pick a period and a date.' }); return }
  const viewer = await me(req)
  if (viewer.role !== 'SUPER_ADMIN' && viewer.role !== 'TEAM_LEAD') { res.status(403).json({ error: 'Only Team Leads can see the team view.' }); return }
  const deptFilter = viewer.role === 'TEAM_LEAD'
    ? { departmentId: viewer.departmentId ?? '__none__' }
    : req.query.department ? { department: { type: String(req.query.department) as never } } : {}
  const start = periodStartOf(period, date)
  const end = periodEnd(period, start)
  const people = await prisma.user.findMany({
    where: { isActive: true, status: 'ACTIVE', id: { not: viewer.id }, ...deptFilter },
    select: { id: true, name: true, department: { select: { type: true, name: true } } },
    orderBy: { name: 'asc' },
  })
  const ids = people.map((p) => p.id)
  const range = { gte: dbDateFromString(start), lte: dbDateFromString(end) }
  const [entries, reviews, leave, holidays] = await Promise.all([
    prisma.workLogEntry.findMany({
      where: { userId: { in: ids }, private: false, periodStart: range, period: { in: (Object.keys(RANK) as WorkLogPeriod[]).filter((p) => RANK[p] <= RANK[period]) } },
      orderBy: [{ periodStart: 'asc' }, { order: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.workLogReview.findMany({ where: { userId: { in: ids }, period, periodStart: dbDateFromString(start) }, include: { reviewer: { select: { name: true } } } }),
    prisma.leaveDay.findMany({ where: { userId: { in: ids }, date: range }, select: { userId: true, date: true } }),
    prisma.holiday.findMany({ where: { date: range }, select: { date: true, name: true } }),
  ])
  const members = people.map((p) => {
    const mine = entries.filter((e) => e.userId === p.id)
    const done = mine.filter((e) => e.status === 'DONE')
    const review = reviews.find((r) => r.userId === p.id)
    return {
      id: p.id, name: p.name, department: p.department?.name ?? null, departmentType: p.department?.type ?? null,
      entries: mine.map(view),
      done: done.length, inProgress: mine.filter((e) => e.status === 'IN_PROGRESS').length, planned: mine.length - done.length, blocked: mine.filter((e) => e.blocked && e.status !== 'DONE').length,
      hours: +mine.reduce((t, e) => t + (e.hours ?? 0), 0).toFixed(2), quantity: mine.reduce((t, e) => t + (e.quantity ?? 0), 0),
      leaveDays: leave.filter((l) => l.userId === p.id).map((l) => dateStringFromDb(l.date)),
      review: review ? reviewView(review) : null,
    }
  })
  res.json({ period, start, end, holidays: holidays.map((h) => ({ date: dateStringFromDb(h.date), name: h.name })), members })
}

const reviewSchema = z.object({
  userId: z.string().min(1),
  period: z.enum(PERIODS),
  date: z.string().regex(DATE),
  rating: z.enum(['GOOD', 'NEEDS_WORK']).nullable().optional(),
  comment: z.string().trim().max(2000).nullable().optional(),
  clear: z.boolean().optional(),
})

/**
 * PUT /api/worklog/review — a Team Lead (same department) or Super Admin marks a person's day,
 * week, month or year as reviewed, with an optional rating and comment. The person is notified.
 * `clear: true` removes the review.
 */
export async function reviewWorkLog(req: AuthedRequest, res: Response): Promise<void> {
  const parsed = reviewSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid review' }); return }
  const d = parsed.data
  const viewer = await me(req)
  if (d.userId === viewer.id || viewer.role === 'MEMBER' || !(await canRead(viewer, d.userId))) { res.status(403).json({ error: 'You can only review your own team.' }); return }
  const start = dbDateFromString(periodStartOf(d.period, d.date))
  const key = { userId_period_periodStart: { userId: d.userId, period: d.period, periodStart: start } }
  if (d.clear) {
    await prisma.workLogReview.deleteMany({ where: { userId: d.userId, period: d.period, periodStart: start } })
    res.json({ review: null })
    return
  }
  const before = await prisma.workLogReview.findUnique({ where: key })
  const r = await prisma.workLogReview.upsert({
    where: key,
    update: { reviewerId: viewer.id, rating: d.rating ?? null, comment: d.comment || null },
    create: { userId: d.userId, period: d.period, periodStart: start, reviewerId: viewer.id, rating: d.rating ?? null, comment: d.comment || null },
    include: { reviewer: { select: { name: true } } },
  })
  // Tell the person, unless nothing they would see changed.
  if (!before || before.rating !== r.rating || (before.comment ?? '') !== (r.comment ?? '')) {
    const startStr = dateStringFromDb(r.periodStart)
    const label = d.period === 'DAY' ? DateTime.fromISO(startStr).toFormat('ccc d LLL')
      : d.period === 'WEEK' ? `the week of ${DateTime.fromISO(startStr).toFormat('d LLL')}`
      : d.period === 'MONTH' ? DateTime.fromISO(startStr).toFormat('LLLL yyyy') : DateTime.fromISO(startStr).toFormat('yyyy')
    const verdict = r.rating === 'GOOD' ? 'Good work' : r.rating === 'NEEDS_WORK' ? 'Needs work' : 'Seen'
    await prisma.notification.create({
      data: {
        userId: d.userId, actorId: viewer.id, type: 'WORKLOG_REVIEW',
        title: `${r.reviewer.name} reviewed your to-dos`,
        body: `${verdict} for ${label}.${r.comment ? ` ${r.comment.length > 160 ? r.comment.slice(0, 159) + '…' : r.comment}` : ''}`,
        link: `/app/todo?period=${d.period}&date=${startStr}`, entityType: 'WorkLogReview', entityId: r.id,
      },
    }).catch(() => undefined)
  }
  res.json({ review: reviewView(r) })
}
