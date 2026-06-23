import type { Response } from 'express'
import { z } from 'zod'
import { DateTime } from 'luxon'
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { companyToday, dbDateFromString, dateStringFromDb, periodRange, previousRange, type RangeKey } from '../lib/time'
import {
  LEADGEN_METRIC_KEYS,
  sumLeadGen,
  leadGenKpis,
  aggregateAgent,
  funnelStages,
  emptyTotals,
} from '../lib/leadgen'
import { periodDelta } from '../lib/kpi'

type EntryWithVerticals = Prisma.LeadGenDailyEntryGetPayload<{
  include: { verticalCounts: { include: { tag: true } } }
}>

function loadUser(id: string) {
  return prisma.user.findUniqueOrThrow({ where: { id }, include: { department: true } })
}

function serializeEntry(e: EntryWithVerticals) {
  return {
    id: e.id,
    date: dateStringFromDb(e.date),
    status: e.status,
    leadsGenerated: e.leadsGenerated,
    accountsResearched: e.accountsResearched,
    contactsFound: e.contactsFound,
    qualifiedMql: e.qualifiedMql,
    handedToSql: e.handedToSql,
    dataSource: e.dataSource ?? '',
    notes: e.notes ?? '',
    verticalCounts: e.verticalCounts.map((vc) => ({ tagId: vc.tagId, count: vc.count })),
  }
}

async function weeklyLeadTarget(departmentId: string): Promise<number> {
  const t = await prisma.target.findFirst({
    where: { scope: 'DEPARTMENT', departmentId, metricKey: 'leadsGenerated', period: 'WEEKLY' },
  })
  return t?.value ?? 0
}

async function deptVerticals(departmentId: string) {
  return prisma.tag.findMany({
    where: { departmentId, type: 'VERTICAL', isActive: true },
    orderBy: { name: 'asc' },
  })
}

async function deptLeadTypes(departmentId: string) {
  return prisma.tag.findMany({
    where: { departmentId, type: 'LEAD_TYPE', isActive: true },
    orderBy: { createdAt: 'asc' },
  })
}

/** Resolve the caller's Lead Gen department, or 403/500 via the returned null. */
async function resolveLeadGenDept(me: Awaited<ReturnType<typeof loadUser>>) {
  if (me.department?.type === 'LEAD_GEN') return me.department
  if (me.role === 'SUPER_ADMIN') return prisma.department.findUnique({ where: { type: 'LEAD_GEN' } })
  return null
}

/** GET /api/leadgen/entries?date= */
export async function getMyEntry(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.department?.type !== 'LEAD_GEN' && me.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Not a Lead Gen member' })
    return
  }
  const dept = me.department ?? (await prisma.department.findUnique({ where: { type: 'LEAD_GEN' } }))
  if (!dept) {
    res.status(500).json({ error: 'Lead Gen department missing' })
    return
  }
  const dateStr = (req.query.date as string) || companyToday()

  const entry = await prisma.leadGenDailyEntry.findUnique({
    where: { userId_date: { userId: me.id, date: dbDateFromString(dateStr) } },
    include: { verticalCounts: { include: { tag: true } } },
  })
  const [verticals, leadTypes] = await Promise.all([deptVerticals(dept.id), deptLeadTypes(dept.id)])
  const weeklyTarget = await weeklyLeadTarget(dept.id)

  const recent = await prisma.leadGenDailyEntry.findMany({
    where: { userId: me.id, status: 'SUBMITTED' },
    orderBy: { date: 'desc' },
    take: 14,
  })
  const agg = aggregateAgent(recent, weeklyTarget / 5)

  res.json({
    date: dateStr,
    entry: entry ? serializeEntry(entry) : null,
    verticals: verticals.map((v) => ({ id: v.id, name: v.name })),
    leadTypes: leadTypes.map((v) => ({ id: v.id, name: v.name })),
    stats: {
      weeklyLeadTarget: weeklyTarget,
      avgLeads: Math.round(agg.avgLeads),
      leadToQualified: agg.kpis.leadToQualified,
    },
  })
}

const metricFields = Object.fromEntries(
  LEADGEN_METRIC_KEYS.map((k) => [k, z.number().int().min(0).max(100000).optional()]),
) as Record<(typeof LEADGEN_METRIC_KEYS)[number], z.ZodOptional<z.ZodNumber>>

const countRow = z.object({ tagId: z.string(), count: z.number().int().min(0).max(100000) })

const upsertSchema = z.object({
  date: z.string().optional(),
  status: z.enum(['SUBMITTED', 'ON_LEAVE', 'HOLIDAY', 'OFF']).default('SUBMITTED'),
  notes: z.string().max(2000).optional(),
  dataSource: z.string().max(200).optional(),
  verticalCounts: z.array(countRow).optional(),
  leadTypeCounts: z.array(countRow).optional(),
  ...metricFields,
})

/** PUT /api/leadgen/entries — upsert entry + per-vertical breakdown. */
export async function upsertMyEntry(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.department?.type !== 'LEAD_GEN' && me.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Not a Lead Gen member' })
    return
  }
  const dept = me.department ?? (await prisma.department.findUnique({ where: { type: 'LEAD_GEN' } }))
  if (!dept) {
    res.status(500).json({ error: 'Lead Gen department missing' })
    return
  }
  const parsed = upsertSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const { date, status, notes, dataSource, verticalCounts, leadTypeCounts } = parsed.data
  const dateStr = date || companyToday()
  if (dateStr > companyToday()) {
    res.status(400).json({ error: 'Cannot log a future date' })
    return
  }

  const metrics = emptyTotals()
  if (status === 'SUBMITTED') for (const k of LEADGEN_METRIC_KEYS) metrics[k] = parsed.data[k] ?? 0

  const dateValue = dbDateFromString(dateStr)
  const existing = await prisma.leadGenDailyEntry.findUnique({
    where: { userId_date: { userId: me.id, date: dateValue } },
  })

  const entry = await prisma.leadGenDailyEntry.upsert({
    where: { userId_date: { userId: me.id, date: dateValue } },
    update: { status, notes: notes ?? null, dataSource: dataSource ?? null, ...metrics },
    create: { userId: me.id, date: dateValue, status, notes: notes ?? null, dataSource: dataSource ?? null, ...metrics },
  })

  // Replace the breakdown — industries (VERTICAL) and lead types (LEAD_TYPE) share
  // the same count table. Only valid dept tags, only on submitted days.
  await prisma.leadGenVerticalCount.deleteMany({ where: { entryId: entry.id } })
  if (status === 'SUBMITTED') {
    const [verticals, leadTypes] = await Promise.all([deptVerticals(dept.id), deptLeadTypes(dept.id)])
    const validIds = new Set([...verticals, ...leadTypes].map((t) => t.id))
    const rows = [...(verticalCounts ?? []), ...(leadTypeCounts ?? [])].filter(
      (c) => c.count > 0 && validIds.has(c.tagId),
    )
    if (rows.length) {
      await prisma.leadGenVerticalCount.createMany({
        data: rows.map((c) => ({ entryId: entry.id, tagId: c.tagId, count: c.count })),
      })
    }
  }

  await prisma.auditLog.create({
    data: {
      userId: me.id,
      entityType: 'LeadGenDailyEntry',
      entityId: entry.id,
      action: existing ? 'UPDATE' : 'CREATE',
      after: { ...metrics, status },
    },
  })

  const full = await prisma.leadGenDailyEntry.findUniqueOrThrow({
    where: { id: entry.id },
    include: { verticalCounts: { include: { tag: true } } },
  })
  res.status(existing ? 200 : 201).json({ entry: serializeEntry(full) })
}

const createVerticalSchema = z.object({ name: z.string().trim().min(1).max(60) })

/** POST /api/leadgen/verticals — add an industry inline (any Lead Gen member). */
export async function createVertical(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  const dept = await resolveLeadGenDept(me)
  if (!dept) {
    res.status(403).json({ error: 'Not a Lead Gen member' })
    return
  }
  const parsed = createVerticalSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Industry name is required' })
    return
  }
  const tag = await prisma.tag.upsert({
    where: { departmentId_type_name: { departmentId: dept.id, type: 'VERTICAL', name: parsed.data.name } },
    update: { isActive: true },
    create: { departmentId: dept.id, type: 'VERTICAL', name: parsed.data.name },
  })
  res.status(201).json({ vertical: { id: tag.id, name: tag.name } })
}

function bucketOf(dateStr: string, mode: 'day' | 'week'): { key: string; label: string } {
  const d = DateTime.fromISO(dateStr, { zone: 'utc' })
  if (mode === 'week') {
    const start = d.startOf('week')
    return { key: start.toISODate()!, label: start.toFormat('LLL d') }
  }
  return { key: dateStr, label: d.toFormat('LLL d') }
}

/** GET /api/leadgen/team?range= */
export async function teamView(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.role !== 'TEAM_LEAD' && me.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const dept = await prisma.department.findUnique({ where: { type: 'LEAD_GEN' } })
  if (!dept) {
    res.status(500).json({ error: 'Lead Gen department missing' })
    return
  }
  if (me.role === 'TEAM_LEAD' && me.departmentId !== dept.id) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  const rangeKey = ((req.query.range as RangeKey) || 'today') as RangeKey
  const range = periodRange(rangeKey, { start: req.query.start as string, end: req.query.end as string })
  const prev = previousRange(range)
  const weeklyTarget = await weeklyLeadTarget(dept.id)
  const dailyLeadTarget = weeklyTarget / 5

  const members = await prisma.user.findMany({
    where: { departmentId: dept.id, role: 'MEMBER' },
    orderBy: { name: 'asc' },
  })
  const memberIds = members.map((m) => m.id)
  const todayStr = companyToday()
  const verticals = await deptVerticals(dept.id)

  const [curEntries, prevEntries, todayEntries] = await Promise.all([
    prisma.leadGenDailyEntry.findMany({
      where: { userId: { in: memberIds }, date: { gte: dbDateFromString(range.startDate), lte: dbDateFromString(range.endDate) } },
      include: { verticalCounts: { include: { tag: true } } },
    }),
    prisma.leadGenDailyEntry.findMany({
      where: { userId: { in: memberIds }, date: { gte: dbDateFromString(prev.startDate), lte: dbDateFromString(prev.endDate) } },
    }),
    prisma.leadGenDailyEntry.findMany({ where: { userId: { in: memberIds }, date: dbDateFromString(todayStr) } }),
  ])

  const byUser = new Map<string, typeof curEntries>()
  for (const e of curEntries) {
    const list = byUser.get(e.userId) ?? []
    list.push(e)
    byUser.set(e.userId, list)
  }
  const todayByUser = new Map(todayEntries.map((e) => [e.userId, e]))

  const agents = members.map((m) => {
    const agg = aggregateAgent(byUser.get(m.id) ?? [], dailyLeadTarget)
    const todayEntry = todayByUser.get(m.id)
    const onLeaveToday = !!todayEntry && todayEntry.status !== 'SUBMITTED'
    let status: 'SUBMITTED' | 'PENDING' | 'ON_LEAVE'
    if (onLeaveToday) status = 'ON_LEAVE'
    else if (rangeKey === 'today') status = todayEntry ? 'SUBMITTED' : 'PENDING'
    else status = agg.workingDays > 0 ? 'SUBMITTED' : 'PENDING'
    return { id: m.id, name: m.name, status, onLeaveToday, flag: agg.flag, totals: agg.totals, kpis: agg.kpis }
  })

  const teamTotals = sumLeadGen(curEntries)
  const teamKpis = leadGenKpis(teamTotals)
  const prevTotals = sumLeadGen(prevEntries)
  const prevKpis = leadGenKpis(prevTotals)

  // Leads-by-vertical buckets (per-day for short ranges, per-week for long ones).
  const span = Math.round(DateTime.fromISO(range.endDate).diff(DateTime.fromISO(range.startDate), 'days').days) + 1
  const mode: 'day' | 'week' = span <= 21 ? 'day' : 'week'
  const verticalNames = verticals.map((v) => v.name)
  const bucketMap = new Map<string, { label: string; counts: Record<string, number> }>()
  for (const e of curEntries) {
    if (e.status !== 'SUBMITTED') continue
    const { key, label } = bucketOf(dateStringFromDb(e.date), mode)
    let b = bucketMap.get(key)
    if (!b) {
      b = { label, counts: Object.fromEntries(verticalNames.map((n) => [n, 0])) }
      bucketMap.set(key, b)
    }
    for (const vc of e.verticalCounts) b.counts[vc.tag.name] = (b.counts[vc.tag.name] ?? 0) + vc.count
  }
  const byVertical = {
    series: verticals.map((v) => ({ key: v.name, label: v.name })),
    data: [...bucketMap.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([, v]) => ({ label: v.label, ...v.counts })),
  }

  const topAgents = [...agents]
    .sort((a, b) => b.totals.leadsGenerated - a.totals.leadsGenerated)
    .slice(0, 3)
    .map((a) => ({ id: a.id, name: a.name, leads: a.totals.leadsGenerated }))

  res.json({
    range: { ...range, key: rangeKey },
    target: { weeklyLeads: weeklyTarget },
    team: { totals: teamTotals, kpis: teamKpis },
    deltas: {
      leadsGenerated: periodDelta(teamTotals.leadsGenerated, prevTotals.leadsGenerated),
      qualifiedMql: periodDelta(teamTotals.qualifiedMql, prevTotals.qualifiedMql),
      mqlToSql: periodDelta(teamKpis.mqlToSql, prevKpis.mqlToSql),
      contactsFound: periodDelta(teamTotals.contactsFound, prevTotals.contactsFound),
    },
    funnel: funnelStages(teamTotals),
    byVertical,
    agents,
    topAgents,
  })
}
