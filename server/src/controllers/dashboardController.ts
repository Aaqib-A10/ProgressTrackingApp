import type { Response } from 'express'
import type { Department, User } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { companyToday, dbDateFromString, dateStringFromDb, periodRange, previousRange, type RangeKey } from '../lib/time'
import { sumItad, itadKpis } from '../lib/itad'
import { sumLeadGen, leadGenKpis } from '../lib/leadgen'
import { buildSeries, pctDelta, improvementLine } from '../lib/trends'
import { talkloopDashboard, ecommerceDashboard, marketingDashboard, csrDashboard, inventoryDashboard, type DashCtx, type TeamDashboardPayload } from '../lib/deptDashboards'
import { topAchievers } from '../lib/topAchiever'

type SubmissionStatus = 'SUBMITTED' | 'PENDING' | 'ON_LEAVE'

interface Kpi {
  label: string
  value: number
  format: 'number' | 'percent'
  delta: number
  caption?: string
}

function loadUser(id: string) {
  return prisma.user.findUniqueOrThrow({ where: { id }, include: { department: true } })
}

function statusFor(entry: { status: string } | undefined): SubmissionStatus {
  if (!entry) return 'PENDING'
  return entry.status === 'SUBMITTED' ? 'SUBMITTED' : 'ON_LEAVE'
}

async function deptMembers(departmentId: string): Promise<User[]> {
  return prisma.user.findMany({ where: { departmentId, role: { in: ['MEMBER', 'SUB_DEPT_LEAD'] }, isActive: true, status: 'ACTIVE' }, orderBy: { name: 'asc' } })
}

async function dailyTarget(departmentId: string, metricKey: string, period: 'DAILY' | 'WEEKLY'): Promise<number> {
  const t = await prisma.target.findFirst({ where: { scope: 'DEPARTMENT', departmentId, metricKey, period } })
  return t?.value ?? 0
}

/** GET /api/dashboard/team?range= — department-aware TL dashboard. */
export async function teamDashboard(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.role !== 'TEAM_LEAD' && me.role !== 'SUB_DEPT_LEAD' && me.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  if (!me.department) {
    res.status(400).json({ error: 'No department for this user' })
    return
  }
  const rangeKey = ((req.query.range as RangeKey) || 'month') as RangeKey
  const range = periodRange(rangeKey, { start: req.query.start as string, end: req.query.end as string })
  const prev = previousRange(range)
  const members = await deptMembers(me.department.id)
  const todayStr = companyToday()

  if (me.department.type === 'ITAD') {
    await itadDashboard(res, me.department, members, rangeKey, range, prev, todayStr)
  } else if (me.department.type === 'LEAD_GEN') {
    await leadgenDashboard(res, me.department, members, rangeKey, range, prev, todayStr)
  } else {
    const subs = await prisma.subDepartment.findMany({ where: { departmentId: me.department.id }, select: { id: true, slug: true } })
    const subSlugs = new Map(members.map((m) => [m.id, subs.find((s) => s.id === m.subDepartmentId)?.slug ?? '']))
    const ctx: DashCtx = { dept: me.department, members, subSlugs, rangeKey, range, prev, todayStr }
    const build: Record<string, (c: DashCtx) => Promise<TeamDashboardPayload>> = {
      TALKLOOP: talkloopDashboard,
      ECOMMERCE: ecommerceDashboard,
      MARKETING: marketingDashboard,
      CSR: csrDashboard,
      INVENTORY: inventoryDashboard,
    }
    res.json(await build[me.department.type](ctx))
  }
}

/** GET /api/dashboard/top-achiever?month=YYYY-MM — the best person of the month in YOUR department
 *  (the Super Admin sees every department; QA sees the departments it scores). */
export async function topAchiever(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(req.query.month)) ? String(req.query.month) : companyToday().slice(0, 7)
  const depts =
    me.role === 'SUPER_ADMIN' ? (['ITAD', 'LEAD_GEN', 'TALKLOOP', 'ECOMMERCE', 'MARKETING', 'CSR', 'INVENTORY'] as const)
      : me.role === 'QA' || me.role === 'QA_LEAD' ? (['ITAD', 'CSR'] as const)
        : me.department ? [me.department.type] : []
  res.json({ month, winners: await topAchievers(month, [...depts]) })
}

async function itadDashboard(
  res: Response,
  dept: Department,
  members: User[],
  rangeKey: RangeKey,
  range: { startDate: string; endDate: string },
  prev: { startDate: string; endDate: string },
  todayStr: string,
) {
  const ids = members.map((m) => m.id)
  const [cur, prv, today] = await Promise.all([
    prisma.itadDailyEntry.findMany({ where: { userId: { in: ids }, date: { gte: dbDateFromString(range.startDate), lte: dbDateFromString(range.endDate) } } }),
    prisma.itadDailyEntry.findMany({ where: { userId: { in: ids }, date: { gte: dbDateFromString(prev.startDate), lte: dbDateFromString(prev.endDate) } } }),
    prisma.itadDailyEntry.findMany({ where: { userId: { in: ids }, date: dbDateFromString(todayStr) } }),
  ])
  const ct = sumItad(cur)
  const pt = sumItad(prv)
  const kc = itadKpis(ct)
  const kp = itadKpis(pt)
  const target = await dailyTarget(dept.id, 'callsDialed', 'DAILY')
  const todayMap = new Map(today.map((e) => [e.userId, e]))

  const kpis: Kpi[] = [
    { label: 'Total Dials', value: ct.callsDialed, format: 'number', delta: pctDelta(ct.callsDialed, pt.callsDialed), caption: 'vs prev period' },
    { label: 'Connect Rate', value: kc.connectRate, format: 'percent', delta: pctDelta(kc.connectRate, kp.connectRate), caption: target ? `Target ${target}/day` : 'vs prev period' },
    { label: 'Interested', value: ct.interested, format: 'number', delta: pctDelta(ct.interested, pt.interested), caption: 'vs prev period' },
    { label: 'Closed Deals', value: ct.closed, format: 'number', delta: pctDelta(ct.closed, pt.closed), caption: 'vs prev period' },
  ]

  res.json({
    department: 'ITAD',
    range: { ...range, key: rangeKey },
    kpis,
    trend: {
      metricLabel: 'Dials',
      points: buildSeries(range, cur.map((e) => ({ date: dateStringFromDb(e.date), value: e.callsDialed, status: e.status })), target),
    },
    breakdown: [
      { name: 'Connected', value: ct.connected },
      { name: 'Voicemail', value: ct.voicemail },
      { name: 'Emails', value: ct.emailsSent },
    ],
    improvement: improvementLine([
      { label: 'Connect rate', delta: pctDelta(kc.connectRate, kp.connectRate) },
      { label: 'Closed deals', delta: pctDelta(ct.closed, pt.closed) },
    ]),
    todaySubmissions: members.map((m) => {
      const e = todayMap.get(m.id)
      return { id: m.id, name: m.name, status: statusFor(e), metricLabel: 'Dials', metricValue: e?.callsDialed ?? 0 }
    }),
    counts: { submitted: today.filter((e) => e.status === 'SUBMITTED').length, total: members.length },
  })
}

async function leadgenDashboard(
  res: Response,
  dept: Department,
  members: User[],
  rangeKey: RangeKey,
  range: { startDate: string; endDate: string },
  prev: { startDate: string; endDate: string },
  todayStr: string,
) {
  const ids = members.map((m) => m.id)
  const [cur, prv, today] = await Promise.all([
    prisma.leadGenDailyEntry.findMany({
      where: { userId: { in: ids }, date: { gte: dbDateFromString(range.startDate), lte: dbDateFromString(range.endDate) } },
      include: { verticalCounts: { include: { tag: true } } },
    }),
    prisma.leadGenDailyEntry.findMany({ where: { userId: { in: ids }, date: { gte: dbDateFromString(prev.startDate), lte: dbDateFromString(prev.endDate) } } }),
    prisma.leadGenDailyEntry.findMany({ where: { userId: { in: ids }, date: dbDateFromString(todayStr) } }),
  ])
  const ct = sumLeadGen(cur)
  const pt = sumLeadGen(prv)
  const kc = leadGenKpis(ct)
  const kp = leadGenKpis(pt)
  const weekly = await dailyTarget(dept.id, 'leadsGenerated', 'WEEKLY')
  const todayMap = new Map(today.map((e) => [e.userId, e]))

  // breakdown by vertical
  const byVertical = new Map<string, number>()
  for (const e of cur) {
    if (e.status !== 'SUBMITTED') continue
    for (const vc of e.verticalCounts) byVertical.set(vc.tag.name, (byVertical.get(vc.tag.name) ?? 0) + vc.count)
  }

  const kpis: Kpi[] = [
    { label: 'Total Leads', value: ct.leadsGenerated, format: 'number', delta: pctDelta(ct.leadsGenerated, pt.leadsGenerated), caption: weekly ? `Target ${weekly}/wk` : 'vs prev period' },
    { label: 'Qualified (MQL)', value: ct.qualifiedMql, format: 'number', delta: pctDelta(ct.qualifiedMql, pt.qualifiedMql), caption: 'vs prev period' },
    { label: 'MQL → SQL', value: kc.mqlToSql, format: 'percent', delta: pctDelta(kc.mqlToSql, kp.mqlToSql), caption: 'vs prev period' },
    { label: 'Contacts Found', value: ct.contactsFound, format: 'number', delta: pctDelta(ct.contactsFound, pt.contactsFound), caption: 'vs prev period' },
  ]

  res.json({
    department: 'LEAD_GEN',
    range: { ...range, key: rangeKey },
    kpis,
    trend: {
      metricLabel: 'Leads',
      points: buildSeries(range, cur.map((e) => ({ date: dateStringFromDb(e.date), value: e.leadsGenerated, status: e.status })), weekly / 5),
    },
    breakdown: [...byVertical.entries()].map(([name, value]) => ({ name, value })),
    improvement: improvementLine([
      { label: 'Leads', delta: pctDelta(ct.leadsGenerated, pt.leadsGenerated) },
      { label: 'Qualified', delta: pctDelta(ct.qualifiedMql, pt.qualifiedMql) },
    ]),
    todaySubmissions: members.map((m) => {
      const e = todayMap.get(m.id)
      return { id: m.id, name: m.name, status: statusFor(e), metricLabel: 'Leads', metricValue: e?.leadsGenerated ?? 0 }
    }),
    counts: { submitted: today.filter((e) => e.status === 'SUBMITTED').length, total: members.length },
  })
}
