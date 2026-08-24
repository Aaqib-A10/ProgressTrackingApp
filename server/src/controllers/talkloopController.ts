import type { Response } from 'express'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { dbDateFromString, dateStringFromDb, periodRange, previousRange, type RangeKey } from '../lib/time'
import { userToday, todayByMember } from '../lib/userDay'
import { TALKLOOP_METRIC_KEYS, sumTalkloop, talkloopKpis, aggregateAgent, emptyTotals } from '../lib/talkloop'
import { periodDelta } from '../lib/kpi'

type EntryWithCountries = Prisma.TalkloopDailyEntryGetPayload<{
  include: { countryCounts: { include: { tag: true } } }
}>

function loadUser(id: string) {
  return prisma.user.findUniqueOrThrow({ where: { id }, include: { department: true } })
}

function serializeEntry(e: EntryWithCountries) {
  return {
    id: e.id,
    date: dateStringFromDb(e.date),
    status: e.status,
    callsMade: e.callsMade,
    connects: e.connects,
    demosScheduled: e.demosScheduled,
    demosConducted: e.demosConducted,
    notes: e.notes ?? '',
    countryCounts: e.countryCounts.map((c) => ({ tagId: c.tagId, calls: c.calls, demos: c.demos })),
  }
}

async function dailyCallTarget(departmentId: string): Promise<number> {
  const t = await prisma.target.findFirst({
    where: { scope: 'DEPARTMENT', departmentId, metricKey: 'callsMade', period: 'DAILY' },
  })
  return t?.value ?? 0
}

async function deptCountries(departmentId: string) {
  return prisma.tag.findMany({ where: { departmentId, type: 'COUNTRY', isActive: true }, orderBy: { name: 'asc' } })
}

async function resolveTalkloopDept(me: Awaited<ReturnType<typeof loadUser>>) {
  if (me.department?.type === 'TALKLOOP') return me.department
  if (me.role === 'SUPER_ADMIN') return prisma.department.findUnique({ where: { type: 'TALKLOOP' } })
  return null
}

/** GET /api/talkloop/entries?date= */
export async function getMyEntry(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.department?.type !== 'TALKLOOP' && me.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Not a Talkloop member' })
    return
  }
  const dept = me.department ?? (await prisma.department.findUnique({ where: { type: 'TALKLOOP' } }))
  if (!dept) {
    res.status(500).json({ error: 'Talkloop department missing' })
    return
  }
  const dateStr = (req.query.date as string) || (await userToday(me.id, me.departmentId))

  const entry = await prisma.talkloopDailyEntry.findUnique({
    where: { userId_date: { userId: me.id, date: dbDateFromString(dateStr) } },
    include: { countryCounts: { include: { tag: true } } },
  })
  const [countries, callTarget] = await Promise.all([deptCountries(dept.id), dailyCallTarget(dept.id)])

  const recent = await prisma.talkloopDailyEntry.findMany({
    where: { userId: me.id, status: 'SUBMITTED' },
    orderBy: { date: 'desc' },
    take: 14,
  })
  const agg = aggregateAgent(recent, callTarget)

  res.json({
    date: dateStr,
    entry: entry ? serializeEntry(entry) : null,
    countries: countries.map((c) => ({ id: c.id, name: c.name })),
    stats: {
      dailyCallTarget: callTarget,
      avgCalls: Math.round(agg.avgCalls),
      connectRate: agg.kpis.connectRate,
      showRate: agg.kpis.showRate,
    },
  })
}

const metricFields = Object.fromEntries(
  TALKLOOP_METRIC_KEYS.map((k) => [k, z.number().int().min(0).max(100000).optional()]),
) as Record<(typeof TALKLOOP_METRIC_KEYS)[number], z.ZodOptional<z.ZodNumber>>

const countRow = z.object({
  tagId: z.string(),
  calls: z.number().int().min(0).max(100000).default(0),
  demos: z.number().int().min(0).max(100000).default(0),
})

const upsertSchema = z.object({
  date: z.string().optional(),
  status: z.enum(['SUBMITTED', 'ON_LEAVE', 'HOLIDAY', 'OFF']).default('SUBMITTED'),
  notes: z.string().max(2000).optional(),
  countryCounts: z.array(countRow).optional(),
  ...metricFields,
})

/** PUT /api/talkloop/entries — upsert entry + per-country calls/demos breakdown. */
export async function upsertMyEntry(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.department?.type !== 'TALKLOOP' && me.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Not a Talkloop member' })
    return
  }
  const dept = me.department ?? (await prisma.department.findUnique({ where: { type: 'TALKLOOP' } }))
  if (!dept) {
    res.status(500).json({ error: 'Talkloop department missing' })
    return
  }
  const parsed = upsertSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const { date, status, notes, countryCounts } = parsed.data
  const today = await userToday(me.id, me.departmentId)
  const dateStr = date || today
  if (dateStr > today) {
    res.status(400).json({ error: 'Cannot log a future date' })
    return
  }

  const metrics = emptyTotals()
  if (status === 'SUBMITTED') for (const k of TALKLOOP_METRIC_KEYS) metrics[k] = parsed.data[k] ?? 0

  const dateValue = dbDateFromString(dateStr)
  const existing = await prisma.talkloopDailyEntry.findUnique({
    where: { userId_date: { userId: me.id, date: dateValue } },
  })

  const entry = await prisma.talkloopDailyEntry.upsert({
    where: { userId_date: { userId: me.id, date: dateValue } },
    update: { status, notes: notes ?? null, ...metrics },
    create: { userId: me.id, date: dateValue, status, notes: notes ?? null, ...metrics },
  })

  // Replace the per-country breakdown — only valid dept countries, only on submitted days.
  await prisma.talkloopCountryCount.deleteMany({ where: { entryId: entry.id } })
  if (status === 'SUBMITTED') {
    const countries = await deptCountries(dept.id)
    const validIds = new Set(countries.map((t) => t.id))
    const rows = (countryCounts ?? []).filter((c) => (c.calls > 0 || c.demos > 0) && validIds.has(c.tagId))
    if (rows.length) {
      await prisma.talkloopCountryCount.createMany({
        data: rows.map((c) => ({ entryId: entry.id, tagId: c.tagId, calls: c.calls, demos: c.demos })),
      })
    }
  }

  await prisma.auditLog.create({
    data: {
      userId: me.id,
      entityType: 'TalkloopDailyEntry',
      entityId: entry.id,
      action: existing ? 'UPDATE' : 'CREATE',
      after: { ...metrics, status },
    },
  })

  const full = await prisma.talkloopDailyEntry.findUniqueOrThrow({
    where: { id: entry.id },
    include: { countryCounts: { include: { tag: true } } },
  })
  res.status(existing ? 200 : 201).json({ entry: serializeEntry(full) })
}

const createCountrySchema = z.object({ name: z.string().trim().min(1).max(60) })

/** POST /api/talkloop/countries — add a target country inline (any Talkloop member). */
export async function createCountry(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  const dept = await resolveTalkloopDept(me)
  if (!dept) {
    res.status(403).json({ error: 'Not a Talkloop member' })
    return
  }
  const parsed = createCountrySchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Country name is required' })
    return
  }
  const tag = await prisma.tag.upsert({
    where: { departmentId_type_name: { departmentId: dept.id, type: 'COUNTRY', name: parsed.data.name } },
    update: { isActive: true },
    create: { departmentId: dept.id, type: 'COUNTRY', name: parsed.data.name },
  })
  res.status(201).json({ country: { id: tag.id, name: tag.name } })
}

/** GET /api/talkloop/team?range= */
export async function teamView(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.role !== 'TEAM_LEAD' && me.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const dept = await prisma.department.findUnique({ where: { type: 'TALKLOOP' } })
  if (!dept) {
    res.status(500).json({ error: 'Talkloop department missing' })
    return
  }
  if (me.role === 'TEAM_LEAD' && me.departmentId !== dept.id) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  const rangeKey = ((req.query.range as RangeKey) || 'today') as RangeKey
  const range = periodRange(rangeKey, { start: req.query.start as string, end: req.query.end as string })
  const prev = previousRange(range)
  const callTarget = await dailyCallTarget(dept.id)

  const members = await prisma.user.findMany({
    where: { departmentId: dept.id, role: { in: ['MEMBER', 'SUB_DEPT_LEAD', 'TEAM_LEAD'] }, isActive: true },
    orderBy: { name: 'asc' },
  })
  const memberIds = members.map((m) => m.id)
  const todayMap = await todayByMember(members.map((m) => ({ id: m.id, departmentId: dept.id })))
  const todayValues = [...new Set(todayMap.values())].map(dbDateFromString)

  const [curEntries, prevEntries, todayEntries] = await Promise.all([
    prisma.talkloopDailyEntry.findMany({
      where: { userId: { in: memberIds }, date: { gte: dbDateFromString(range.startDate), lte: dbDateFromString(range.endDate) } },
      include: { countryCounts: { include: { tag: true } } },
    }),
    prisma.talkloopDailyEntry.findMany({
      where: { userId: { in: memberIds }, date: { gte: dbDateFromString(prev.startDate), lte: dbDateFromString(prev.endDate) } },
    }),
    prisma.talkloopDailyEntry.findMany({ where: { userId: { in: memberIds }, date: { in: todayValues } } }),
  ])

  const byUser = new Map<string, typeof curEntries>()
  for (const e of curEntries) {
    const list = byUser.get(e.userId) ?? []
    list.push(e)
    byUser.set(e.userId, list)
  }
  const todayByUser = new Map(todayEntries.filter((e) => dateStringFromDb(e.date) === todayMap.get(e.userId)).map((e) => [e.userId, e]))

  const leaveRows = await prisma.leaveDay.findMany({
    where: {
      userId: { in: memberIds },
      type: { not: 'WFH' },
      date: { gte: dbDateFromString(range.startDate), lte: dbDateFromString(range.endDate) },
    },
  })
  const leaveDatesByUser = new Map<string, Map<string, string>>()
  const addLeave = (userId: string, dateStr: string, type: string) => {
    const mp = leaveDatesByUser.get(userId) ?? new Map<string, string>()
    mp.set(dateStr, type)
    leaveDatesByUser.set(userId, mp)
  }
  for (const l of leaveRows) addLeave(l.userId, dateStringFromDb(l.date), l.type)
  for (const e of curEntries) if (e.status !== 'SUBMITTED') addLeave(e.userId, dateStringFromDb(e.date), e.status)

  const agents = members.map((m) => {
    const agg = aggregateAgent(byUser.get(m.id) ?? [], callTarget)
    const todayEntry = todayByUser.get(m.id)
    const onLeaveToday = !!todayEntry && todayEntry.status !== 'SUBMITTED'
    const leaveMap = leaveDatesByUser.get(m.id)
    const leaveDays = leaveMap?.size ?? 0
    const leaveTypes = leaveMap ? [...new Set(leaveMap.values())] : []
    const leaveStatus = leaveTypes.length === 1 ? leaveTypes[0] : leaveDays > 0 ? 'ON_LEAVE' : null
    let status: 'SUBMITTED' | 'PENDING' | 'ON_LEAVE'
    if (rangeKey === 'today') status = onLeaveToday || leaveDays > 0 ? 'ON_LEAVE' : todayEntry ? 'SUBMITTED' : 'PENDING'
    else status = agg.workingDays > 0 ? 'SUBMITTED' : leaveDays > 0 ? 'ON_LEAVE' : 'PENDING'
    return { id: m.id, name: m.name, status, onLeaveToday, leaveDays, leaveStatus, flag: agg.flag, totals: agg.totals, kpis: agg.kpis }
  })

  const teamTotals = sumTalkloop(curEntries)
  const teamKpis = talkloopKpis(teamTotals)
  const prevTotals = sumTalkloop(prevEntries)
  const prevKpis = talkloopKpis(prevTotals)

  // Per-country calls + demos across the range (submitted days only).
  const countryMap = new Map<string, { country: string; calls: number; demos: number }>()
  for (const e of curEntries) {
    if (e.status !== 'SUBMITTED') continue
    for (const c of e.countryCounts) {
      const row = countryMap.get(c.tag.name) ?? { country: c.tag.name, calls: 0, demos: 0 }
      row.calls += c.calls
      row.demos += c.demos
      countryMap.set(c.tag.name, row)
    }
  }
  const byCountry = [...countryMap.values()].sort((a, b) => b.calls + b.demos - (a.calls + a.demos))

  const topAgents = [...agents]
    .sort((a, b) => b.totals.callsMade - a.totals.callsMade)
    .slice(0, 3)
    .map((a) => ({ id: a.id, name: a.name, calls: a.totals.callsMade }))

  res.json({
    range: { ...range, key: rangeKey },
    target: { dailyCalls: callTarget },
    team: { totals: teamTotals, kpis: teamKpis },
    deltas: {
      callsMade: periodDelta(teamTotals.callsMade, prevTotals.callsMade),
      connects: periodDelta(teamTotals.connects, prevTotals.connects),
      demosConducted: periodDelta(teamTotals.demosConducted, prevTotals.demosConducted),
      showRate: periodDelta(teamKpis.showRate, prevKpis.showRate),
    },
    byCountry,
    agents,
    topAgents,
  })
}
