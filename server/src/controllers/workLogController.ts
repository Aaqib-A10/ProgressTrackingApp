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
type Note = Awaited<ReturnType<typeof prisma.workLogNote.findFirstOrThrow>>
function noteView(n: Note) {
  return { id: n.id, entryId: n.entryId, source: n.source, sender: n.sender, body: n.body, createdAt: n.createdAt.toISOString(), updatedAt: n.updatedAt.toISOString() }
}
/** Notes are loaded with the entries, oldest first. */
const WITH_NOTES = { notes: { orderBy: { createdAt: 'asc' as const } } }
function view(e: Entry & { notes?: Note[] }) {
  return {
    id: e.id, userId: e.userId, period: e.period, periodStart: dateStringFromDb(e.periodStart), title: e.title, details: e.details,
    status: e.status, doneAt: e.doneAt?.toISOString() ?? null, hours: e.hours, quantity: e.quantity, tag: e.tag, private: e.private, blocked: e.blocked,
    order: e.order, createdAt: e.createdAt.toISOString(), updatedAt: e.updatedAt.toISOString(),
    notes: (e.notes ?? []).map(noteView),
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
    include: WITH_NOTES,
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
    include: WITH_NOTES,
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
  const updated = await prisma.workLogEntry.update({ where: { id: e.id }, data: { periodStart: dbDateFromString(next) }, include: WITH_NOTES })
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
      include: WITH_NOTES,
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

// ------------------------------------------------------------------ notes on an item

/** Sources everyone starts with; people add their own by typing a new one. */
export const NOTE_SOURCES = ['WhatsApp', 'Email', 'Call', 'Teams', 'Meeting', 'In person']

const noteSchema = z.object({
  body: z.string().trim().min(1, 'Write the note.').max(5000, 'Keep a note under 5000 characters.'),
  source: z.string().trim().max(40).nullable().optional(),
  sender: z.string().trim().max(80).nullable().optional(),
})

/** GET /api/worklog/note-sources — the starting sources plus every source this person has used. */
export async function workLogNoteSources(req: AuthedRequest, res: Response): Promise<void> {
  const used = await prisma.workLogNote.findMany({ where: { userId: req.user!.id, source: { not: null } }, distinct: ['source'], select: { source: true }, take: 200 })
  const mine = used.map((u) => u.source!).filter((x) => !NOTE_SOURCES.some((d) => d.toLowerCase() === x.toLowerCase()))
  res.json({ sources: [...NOTE_SOURCES, ...mine.sort((a, b) => a.localeCompare(b))] })
}

/** Same spelling as a source used before ("whatsapp" becomes "WhatsApp"), so one source is not split in two. */
async function canonicalSource(userId: string, source: string | null | undefined): Promise<string | null> {
  const s = source?.trim()
  if (!s) return null
  const known = NOTE_SOURCES.find((d) => d.toLowerCase() === s.toLowerCase())
  if (known) return known
  const prev = await prisma.workLogNote.findFirst({ where: { userId, source: { equals: s, mode: 'insensitive' } }, select: { source: true } })
  return prev?.source ?? s
}

/** POST /api/worklog/:id/notes — add a note to one of your own items. */
export async function addWorkLogNote(req: AuthedRequest, res: Response): Promise<void> {
  const parsed = noteSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid note' }); return }
  const e = await prisma.workLogEntry.findFirst({ where: { id: req.params.id, userId: req.user!.id }, select: { id: true } })
  if (!e) { res.status(404).json({ error: 'Entry not found' }); return }
  const d = parsed.data
  const n = await prisma.workLogNote.create({
    data: { entryId: e.id, userId: req.user!.id, body: d.body, source: await canonicalSource(req.user!.id, d.source), sender: d.sender?.trim() || null },
  })
  res.status(201).json({ note: noteView(n) })
}

/** PATCH /api/worklog/notes/:noteId — edit your own note. */
export async function updateWorkLogNote(req: AuthedRequest, res: Response): Promise<void> {
  const parsed = noteSchema.partial().safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid note' }); return }
  const n = await prisma.workLogNote.findFirst({ where: { id: req.params.noteId, userId: req.user!.id } })
  if (!n) { res.status(404).json({ error: 'Note not found' }); return }
  const d = parsed.data
  const updated = await prisma.workLogNote.update({
    where: { id: n.id },
    data: {
      ...(d.body !== undefined ? { body: d.body } : {}),
      ...(d.source !== undefined ? { source: await canonicalSource(req.user!.id, d.source) } : {}),
      ...(d.sender !== undefined ? { sender: d.sender?.trim() || null } : {}),
    },
  })
  res.json({ note: noteView(updated) })
}

/** DELETE /api/worklog/notes/:noteId — your own note. */
export async function deleteWorkLogNote(req: AuthedRequest, res: Response): Promise<void> {
  const r = await prisma.workLogNote.deleteMany({ where: { id: req.params.noteId, userId: req.user!.id } })
  if (r.count === 0) { res.status(404).json({ error: 'Note not found' }); return }
  res.status(204).end()
}

// ------------------------------------------------------------------ search

/** Words to look for: each word on its own, or "an exact phrase" in quotes. At most 6. */
export function searchTerms(q: string): string[] {
  const out: string[] = []
  for (const m of q.matchAll(/"([^"]+)"|(\S+)/g)) {
    const t = (m[1] ?? m[2] ?? '').trim()
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t)
  }
  return out.slice(0, 6)
}

const SEARCH_LIMIT = 500

/**
 * GET /api/worklog/search?q=&userId=&scope=team — find something in My To-Do on any date:
 * every day, week, month and year entry whose text, details, tag or notes (body, where it came
 * from, who sent it) have all the words. Newest first, up to 500. Your own entries (private ones
 * too); with `userId`, that person's (not private), for their Team Lead or a Super Admin; with
 * `scope=team`, everyone the caller can read (Team Lead: their department; Super Admin: the whole
 * company). Also the matching items of your own quick checklist.
 */
export async function searchWorkLog(req: AuthedRequest, res: Response): Promise<void> {
  const q = String(req.query.q ?? '').trim().slice(0, 100)
  const terms = searchTerms(q)
  if (q.length < 2 || !terms.length) { res.status(400).json({ error: 'Type at least 2 letters to search.' }); return }
  const viewer = await me(req)
  const team = req.query.scope === 'team'
  const ownerId = (req.query.userId as string) || viewer.id

  let who: object
  if (team) {
    if (viewer.role !== 'SUPER_ADMIN' && viewer.role !== 'TEAM_LEAD') { res.status(403).json({ error: 'Only Team Leads can search the whole team.' }); return }
    const others = await prisma.user.findMany({
      where: { id: { not: viewer.id }, ...(viewer.role === 'TEAM_LEAD' ? { departmentId: viewer.departmentId ?? '__none__' } : {}) },
      select: { id: true },
    })
    who = { OR: [{ userId: viewer.id }, { userId: { in: others.map((o) => o.id) }, private: false }] }
  } else {
    if (!(await canRead(viewer, ownerId))) { res.status(403).json({ error: 'You can only search your own to-dos.' }); return }
    who = ownerId === viewer.id ? { userId: ownerId } : { userId: ownerId, private: false }
  }

  const like = (t: string) => ({ contains: t, mode: 'insensitive' as const })
  const match = terms.map((t) => ({
    OR: [
      { title: like(t) }, { details: like(t) }, { tag: like(t) },
      { notes: { some: { OR: [{ body: like(t) }, { source: like(t) }, { sender: like(t) }] } } },
    ],
  }))
  const rows = await prisma.workLogEntry.findMany({
    where: { AND: [who, ...match] },
    orderBy: [{ periodStart: 'desc' }, { order: 'asc' }, { createdAt: 'desc' }],
    include: { ...WITH_NOTES, user: { select: { name: true } } },
    take: SEARCH_LIMIT + 1,
  })
  const more = rows.length > SEARCH_LIMIT
  const entries = rows.slice(0, SEARCH_LIMIT)

  const checklist = !team && ownerId === viewer.id
    ? await prisma.todoItem.findMany({
      where: { userId: viewer.id, AND: terms.map((t) => ({ title: like(t) })) },
      orderBy: [{ done: 'asc' }, { createdAt: 'desc' }],
      select: { id: true, title: true, done: true, dueDate: true, createdAt: true },
      take: 50,
    })
    : []

  res.json({
    q, terms, more, scope: team ? 'team' : 'person',
    results: entries.map((e) => ({ ...view(e), userName: e.user.name })),
    checklist: checklist.map((c) => ({ id: c.id, title: c.title, done: c.done, dueDate: c.dueDate ? dateStringFromDb(c.dueDate) : null, createdAt: c.createdAt.toISOString() })),
  })
}
