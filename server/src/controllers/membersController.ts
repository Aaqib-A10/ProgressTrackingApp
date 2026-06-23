import type { Response } from 'express'
import type { ItadDailyEntry, LeadGenDailyEntry } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { companyToday, dbDateFromString, dateStringFromDb, periodRange, previousRange, type RangeKey } from '../lib/time'
import { aggregateAgent as itadAggregate, itadKpis, sumItad, ITAD_METRIC_KEYS } from '../lib/itad'
import { aggregateAgent as leadgenAggregate, leadGenKpis, sumLeadGen, funnelStages, LEADGEN_METRIC_KEYS } from '../lib/leadgen'
import { periodDelta } from '../lib/kpi'

type SubmissionStatus = 'SUBMITTED' | 'PENDING' | 'ON_LEAVE'

function statusFromToday(entry: { status: string } | undefined): SubmissionStatus {
  if (!entry) return 'PENDING'
  return entry.status === 'SUBMITTED' ? 'SUBMITTED' : 'ON_LEAVE'
}

async function deptDailyTarget(departmentId: string, metricKey: string, period: 'DAILY' | 'WEEKLY'): Promise<number> {
  const t = await prisma.target.findFirst({ where: { scope: 'DEPARTMENT', departmentId, metricKey, period } })
  return t?.value ?? 0
}

/**
 * GET /api/members/:id?range= — a single member's profile + performance.
 * Access: the member themselves, their department's Team Lead, or a Super Admin.
 */
export async function getMemberProfile(req: AuthedRequest, res: Response): Promise<void> {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, include: { department: true } })
  const target = await prisma.user.findUnique({
    where: { id: req.params.id },
    include: { department: true, subDepartment: true },
  })
  if (!target) {
    res.status(404).json({ error: 'Member not found' })
    return
  }

  const allowed =
    me.role === 'SUPER_ADMIN' ||
    me.id === target.id ||
    (me.role === 'TEAM_LEAD' && me.departmentId != null && me.departmentId === target.departmentId)
  if (!allowed) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  const rangeKey = ((req.query.range as RangeKey) || 'month') as RangeKey
  const range = periodRange(rangeKey, { start: req.query.start as string, end: req.query.end as string })
  const prev = previousRange(range)
  const todayStr = companyToday()

  const user = {
    id: target.id,
    name: target.name,
    email: target.email,
    role: target.role,
    department: target.department?.type ?? null,
    subDepartment: target.subDepartment?.name ?? null,
    avatarUrl: null as string | null,
  }

  const deptType = target.department?.type ?? null

  // --- ITAD ---
  if (deptType === 'ITAD') {
    const dailyDialTarget = await deptDailyTarget(target.departmentId!, 'callsDialed', 'DAILY')
    const [cur, prevEntries, todayEntry] = await Promise.all([
      prisma.itadDailyEntry.findMany({
        where: { userId: target.id, date: { gte: dbDateFromString(range.startDate), lte: dbDateFromString(range.endDate) } },
        orderBy: { date: 'desc' },
      }),
      prisma.itadDailyEntry.findMany({
        where: { userId: target.id, date: { gte: dbDateFromString(prev.startDate), lte: dbDateFromString(prev.endDate) } },
      }),
      prisma.itadDailyEntry.findUnique({ where: { userId_date: { userId: target.id, date: dbDateFromString(todayStr) } } }),
    ])
    const agg = itadAggregate(cur, dailyDialTarget)
    const prevTotals = sumItad(prevEntries)
    const prevKpis = itadKpis(prevTotals)
    res.json({
      user,
      kind: 'ITAD',
      range: { ...range, key: rangeKey },
      today: { status: statusFromToday(todayEntry ?? undefined) },
      summary: { totals: agg.totals, kpis: agg.kpis, workingDays: agg.workingDays, flag: agg.flag, target: { dailyDials: dailyDialTarget } },
      deltas: {
        callsDialed: periodDelta(agg.totals.callsDialed, prevTotals.callsDialed),
        connectRate: periodDelta(agg.kpis.connectRate, prevKpis.connectRate),
        interested: periodDelta(agg.totals.interested, prevTotals.interested),
        closed: periodDelta(agg.totals.closed, prevTotals.closed),
      },
      entries: cur.map((e: ItadDailyEntry) => ({
        date: dateStringFromDb(e.date),
        status: e.status,
        ...Object.fromEntries(ITAD_METRIC_KEYS.map((k) => [k, e[k]])),
        notes: e.notes ?? '',
      })),
    })
    return
  }

  // --- Lead Generation ---
  if (deptType === 'LEAD_GEN') {
    const weeklyTarget = await deptDailyTarget(target.departmentId!, 'leadsGenerated', 'WEEKLY')
    const [cur, prevEntries, todayEntry] = await Promise.all([
      prisma.leadGenDailyEntry.findMany({
        where: { userId: target.id, date: { gte: dbDateFromString(range.startDate), lte: dbDateFromString(range.endDate) } },
        orderBy: { date: 'desc' },
      }),
      prisma.leadGenDailyEntry.findMany({
        where: { userId: target.id, date: { gte: dbDateFromString(prev.startDate), lte: dbDateFromString(prev.endDate) } },
      }),
      prisma.leadGenDailyEntry.findUnique({ where: { userId_date: { userId: target.id, date: dbDateFromString(todayStr) } } }),
    ])
    const agg = leadgenAggregate(cur, weeklyTarget / 5)
    const prevTotals = sumLeadGen(prevEntries)
    const prevKpis = leadGenKpis(prevTotals)
    res.json({
      user,
      kind: 'LEAD_GEN',
      range: { ...range, key: rangeKey },
      today: { status: statusFromToday(todayEntry ?? undefined) },
      summary: { totals: agg.totals, kpis: agg.kpis, workingDays: agg.workingDays, flag: agg.flag, funnel: funnelStages(agg.totals), target: { weeklyLeads: weeklyTarget } },
      deltas: {
        leadsGenerated: periodDelta(agg.totals.leadsGenerated, prevTotals.leadsGenerated),
        qualifiedMql: periodDelta(agg.totals.qualifiedMql, prevTotals.qualifiedMql),
        mqlToSql: periodDelta(agg.kpis.mqlToSql, prevKpis.mqlToSql),
        contactsFound: periodDelta(agg.totals.contactsFound, prevTotals.contactsFound),
      },
      entries: cur.map((e: LeadGenDailyEntry) => ({
        date: dateStringFromDb(e.date),
        status: e.status,
        ...Object.fromEntries(LEADGEN_METRIC_KEYS.map((k) => [k, e[k]])),
        notes: e.notes ?? '',
      })),
    })
    return
  }

  // --- Marketing / no daily form ---
  res.json({
    user,
    kind: 'NONE',
    range: { ...range, key: rangeKey },
    today: { status: 'PENDING' as SubmissionStatus },
    summary: null,
    deltas: {},
    entries: [],
  })
}
