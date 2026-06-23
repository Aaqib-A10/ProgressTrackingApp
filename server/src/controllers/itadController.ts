import type { Response } from 'express'
import { z } from 'zod'
import type { ItadDailyEntry } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { companyToday, dbDateFromString, dateStringFromDb, periodRange, previousRange, type RangeKey } from '../lib/time'
import { ITAD_METRIC_KEYS, sumItad, itadKpis, aggregateAgent, emptyTotals } from '../lib/itad'
import { periodDelta } from '../lib/kpi'

function loadUser(id: string) {
  return prisma.user.findUniqueOrThrow({ where: { id }, include: { department: true } })
}

function serializeEntry(e: ItadDailyEntry) {
  return {
    id: e.id,
    date: dateStringFromDb(e.date),
    status: e.status,
    callsDialed: e.callsDialed,
    connected: e.connected,
    voicemail: e.voicemail,
    emailsSent: e.emailsSent,
    interested: e.interested,
    workingOn: e.workingOn,
    closed: e.closed,
    rfqs: e.rfqs,
    notes: e.notes ?? '',
  }
}

async function itadDailyTarget(departmentId: string): Promise<number> {
  const target = await prisma.target.findFirst({
    where: { scope: 'DEPARTMENT', departmentId, metricKey: 'callsDialed', period: 'DAILY' },
  })
  return target?.value ?? 0
}

/** GET /api/itad/entries?date= — the caller's entry for a day + personal stats. */
export async function getMyEntry(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.department?.type !== 'ITAD' && me.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Not an ITAD member' })
    return
  }
  const dept = me.department ?? (await prisma.department.findUnique({ where: { type: 'ITAD' } }))
  const dateStr = (req.query.date as string) || companyToday()

  const entry = await prisma.itadDailyEntry.findUnique({
    where: { userId_date: { userId: me.id, date: dbDateFromString(dateStr) } },
  })

  const dailyDialTarget = dept ? await itadDailyTarget(dept.id) : 0
  const recent = await prisma.itadDailyEntry.findMany({
    where: { userId: me.id, status: 'SUBMITTED' },
    orderBy: { date: 'desc' },
    take: 14,
  })
  const agg = aggregateAgent(recent, dailyDialTarget)

  res.json({
    date: dateStr,
    entry: entry ? serializeEntry(entry) : null,
    stats: {
      dailyDialTarget,
      avgConnectRate: agg.kpis.connectRate,
      avgDials: Math.round(agg.avgDials),
      avgConnected: recent.length ? Math.round(agg.totals.connected / recent.length) : 0,
    },
  })
}

const metricFields = Object.fromEntries(
  ITAD_METRIC_KEYS.map((k) => [k, z.number().int().min(0).max(100000).optional()]),
) as Record<(typeof ITAD_METRIC_KEYS)[number], z.ZodOptional<z.ZodNumber>>

const upsertSchema = z.object({
  date: z.string().optional(),
  status: z.enum(['SUBMITTED', 'ON_LEAVE', 'HOLIDAY', 'OFF']).default('SUBMITTED'),
  notes: z.string().max(2000).optional(),
  ...metricFields,
})

/** PUT /api/itad/entries — upsert the caller's entry (one per user per day). */
export async function upsertMyEntry(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.department?.type !== 'ITAD' && me.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Not an ITAD member' })
    return
  }
  const parsed = upsertSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const { date, status, notes } = parsed.data
  const dateStr = date || companyToday()
  if (dateStr > companyToday()) {
    res.status(400).json({ error: 'Cannot log a future date' })
    return
  }

  // Leave/off/holiday days carry no metrics (leave-aware rule).
  const metrics = emptyTotals()
  if (status === 'SUBMITTED') {
    for (const k of ITAD_METRIC_KEYS) metrics[k] = parsed.data[k] ?? 0
  }

  const dateValue = dbDateFromString(dateStr)
  const existing = await prisma.itadDailyEntry.findUnique({
    where: { userId_date: { userId: me.id, date: dateValue } },
  })

  const entry = await prisma.itadDailyEntry.upsert({
    where: { userId_date: { userId: me.id, date: dateValue } },
    update: { status, notes: notes ?? null, ...metrics },
    create: { userId: me.id, date: dateValue, status, notes: notes ?? null, ...metrics },
  })

  // Audit trail — edits to submitted numbers are logged (plan §9).
  await prisma.auditLog.create({
    data: {
      userId: me.id,
      entityType: 'ItadDailyEntry',
      entityId: entry.id,
      action: existing ? 'UPDATE' : 'CREATE',
      before: existing ? serializeEntry(existing) : undefined,
      after: serializeEntry(entry),
    },
  })

  res.status(existing ? 200 : 201).json({ entry: serializeEntry(entry) })
}

/** GET /api/itad/team?range= — TL/Admin team performance matrix. */
export async function teamView(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.role !== 'TEAM_LEAD' && me.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const dept = await prisma.department.findUnique({ where: { type: 'ITAD' } })
  if (!dept) {
    res.status(500).json({ error: 'ITAD department missing' })
    return
  }
  if (me.role === 'TEAM_LEAD' && me.departmentId !== dept.id) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  const rangeKey = ((req.query.range as RangeKey) || 'today') as RangeKey
  const range = periodRange(rangeKey, { start: req.query.start as string, end: req.query.end as string })
  const prev = previousRange(range)
  const dailyDialTarget = await itadDailyTarget(dept.id)

  const members = await prisma.user.findMany({
    where: { departmentId: dept.id, role: 'MEMBER' },
    orderBy: { name: 'asc' },
  })
  const memberIds = members.map((m) => m.id)
  const todayStr = companyToday()

  const [curEntries, prevEntries, todayEntries] = await Promise.all([
    prisma.itadDailyEntry.findMany({
      where: { userId: { in: memberIds }, date: { gte: dbDateFromString(range.startDate), lte: dbDateFromString(range.endDate) } },
    }),
    prisma.itadDailyEntry.findMany({
      where: { userId: { in: memberIds }, date: { gte: dbDateFromString(prev.startDate), lte: dbDateFromString(prev.endDate) } },
    }),
    prisma.itadDailyEntry.findMany({ where: { userId: { in: memberIds }, date: dbDateFromString(todayStr) } }),
  ])

  const byUser = new Map<string, typeof curEntries>()
  for (const e of curEntries) {
    const list = byUser.get(e.userId) ?? []
    list.push(e)
    byUser.set(e.userId, list)
  }
  const todayByUser = new Map(todayEntries.map((e) => [e.userId, e]))

  const agents = members.map((m) => {
    const agg = aggregateAgent(byUser.get(m.id) ?? [], dailyDialTarget)
    const todayEntry = todayByUser.get(m.id)
    const onLeaveToday = !!todayEntry && todayEntry.status !== 'SUBMITTED'
    let status: 'SUBMITTED' | 'PENDING' | 'ON_LEAVE'
    if (onLeaveToday) status = 'ON_LEAVE'
    else if (rangeKey === 'today') status = todayEntry ? 'SUBMITTED' : 'PENDING'
    else status = agg.workingDays > 0 ? 'SUBMITTED' : 'PENDING'
    return { id: m.id, name: m.name, status, onLeaveToday, flag: agg.flag, totals: agg.totals, kpis: agg.kpis }
  })

  const teamTotals = sumItad(curEntries)
  const teamKpis = itadKpis(teamTotals)
  const prevTotals = sumItad(prevEntries)
  const prevKpis = itadKpis(prevTotals)

  const topAgents = [...agents]
    .sort((a, b) => b.totals.callsDialed - a.totals.callsDialed)
    .slice(0, 3)
    .map((a) => ({ id: a.id, name: a.name, dials: a.totals.callsDialed }))

  res.json({
    range: { ...range, key: rangeKey },
    target: { dailyDials: dailyDialTarget },
    team: { totals: teamTotals, kpis: teamKpis },
    deltas: {
      callsDialed: periodDelta(teamTotals.callsDialed, prevTotals.callsDialed),
      connectRate: periodDelta(teamKpis.connectRate, prevKpis.connectRate),
      interested: periodDelta(teamTotals.interested, prevTotals.interested),
      closed: periodDelta(teamTotals.closed, prevTotals.closed),
    },
    agents,
    topAgents,
  })
}
