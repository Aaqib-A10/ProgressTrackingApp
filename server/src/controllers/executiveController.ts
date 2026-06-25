import type { Response } from 'express'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { companyToday, dbDateFromString, dateStringFromDb, periodRange, previousRange, type RangeKey, type DateRange } from '../lib/time'
import { sumItad, itadKpis } from '../lib/itad'
import { sumLeadGen, leadGenKpis } from '../lib/leadgen'
import { buildSeries, pctDelta, improvementLine } from '../lib/trends'

const inRange = (r: DateRange) => ({ gte: dbDateFromString(r.startDate), lte: dbDateFromString(r.endDate) })
const countSubmitted = (rows: { status: string }[]) => rows.filter((e) => e.status === 'SUBMITTED').length

/** GET /api/dashboard/executive — company-wide view across all departments (Super Admin). */
export async function executiveDashboard(req: AuthedRequest, res: Response): Promise<void> {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } })
  if (me.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const rangeKey = ((req.query.range as RangeKey) || 'month') as RangeKey
  const range = periodRange(rangeKey, { start: req.query.start as string, end: req.query.end as string })
  const prev = previousRange(range)
  const todayValue = dbDateFromString(companyToday())

  const [itadDept, leadDept, mktDept] = await Promise.all([
    prisma.department.findUnique({ where: { type: 'ITAD' } }),
    prisma.department.findUnique({ where: { type: 'LEAD_GEN' } }),
    prisma.department.findUnique({ where: { type: 'MARKETING' } }),
  ])

  const [itadCur, itadPrev, itadToday, leadCur, leadPrev, leadToday, itadMembers, leadMembers, mktMembers] =
    await Promise.all([
      prisma.itadDailyEntry.findMany({ where: { date: inRange(range) } }),
      prisma.itadDailyEntry.findMany({ where: { date: inRange(prev) } }),
      prisma.itadDailyEntry.findMany({ where: { date: todayValue } }),
      prisma.leadGenDailyEntry.findMany({ where: { date: inRange(range) } }),
      prisma.leadGenDailyEntry.findMany({ where: { date: inRange(prev) } }),
      prisma.leadGenDailyEntry.findMany({ where: { date: todayValue } }),
      itadDept ? prisma.user.count({ where: { departmentId: itadDept.id, role: 'MEMBER', isActive: true } }) : 0,
      leadDept ? prisma.user.count({ where: { departmentId: leadDept.id, role: 'MEMBER', isActive: true } }) : 0,
      mktDept ? prisma.user.count({ where: { departmentId: mktDept.id, role: 'MEMBER', isActive: true } }) : 0,
    ])

  const it = sumItad(itadCur)
  const ip = sumItad(itadPrev)
  const ik = itadKpis(it)
  const ikp = itadKpis(ip)
  const lt = sumLeadGen(leadCur)
  const lp = sumLeadGen(leadPrev)
  const lk = leadGenKpis(lt)
  const lkp = leadGenKpis(lp)

  const departments = [
    {
      type: 'ITAD',
      name: 'ITAD',
      members: itadMembers,
      submittedToday: countSubmitted(itadToday),
      headline: [
        { label: 'Dials', value: it.callsDialed, format: 'number', delta: pctDelta(it.callsDialed, ip.callsDialed) },
        { label: 'Connect Rate', value: ik.connectRate, format: 'percent', delta: pctDelta(ik.connectRate, ikp.connectRate) },
      ],
      improvement: improvementLine([
        { label: 'Connect rate', delta: pctDelta(ik.connectRate, ikp.connectRate) },
        { label: 'Closed', delta: pctDelta(it.closed, ip.closed) },
      ]),
    },
    {
      type: 'LEAD_GEN',
      name: 'Lead Generation',
      members: leadMembers,
      submittedToday: countSubmitted(leadToday),
      headline: [
        { label: 'Leads', value: lt.leadsGenerated, format: 'number', delta: pctDelta(lt.leadsGenerated, lp.leadsGenerated) },
        { label: 'MQL → SQL', value: lk.mqlToSql, format: 'percent', delta: pctDelta(lk.mqlToSql, lkp.mqlToSql) },
      ],
      improvement: improvementLine([
        { label: 'Leads', delta: pctDelta(lt.leadsGenerated, lp.leadsGenerated) },
        { label: 'Qualified', delta: pctDelta(lt.qualifiedMql, lp.qualifiedMql) },
      ]),
    },
    {
      type: 'MARKETING',
      name: 'Marketing',
      members: mktMembers,
      submittedToday: 0,
      headline: [],
      improvement: 'Marketing analytics arrive in Phase 3.',
    },
  ]

  // Company activity trend = total submitted entries per bucket across departments.
  const activityRows = [
    ...itadCur.map((e) => ({ date: dateStringFromDb(e.date), value: 1, status: e.status })),
    ...leadCur.map((e) => ({ date: dateStringFromDb(e.date), value: 1, status: e.status })),
  ]
  const combinedTrend = { metricLabel: 'Submissions', points: buildSeries(range, activityRows) }

  const benchmark = [
    {
      department: 'ITAD',
      members: itadMembers,
      submittedToday: countSubmitted(itadToday),
      primaryLabel: 'Dials',
      primaryValue: it.callsDialed,
      rateLabel: 'Connect Rate',
      rateValue: ik.connectRate,
      delta: pctDelta(it.callsDialed, ip.callsDialed),
    },
    {
      department: 'Lead Generation',
      members: leadMembers,
      submittedToday: countSubmitted(leadToday),
      primaryLabel: 'Leads',
      primaryValue: lt.leadsGenerated,
      rateLabel: 'MQL → SQL',
      rateValue: lk.mqlToSql,
      delta: pctDelta(lt.leadsGenerated, lp.leadsGenerated),
    },
  ]

  res.json({
    range: { ...range, key: rangeKey },
    departments,
    combinedTrend,
    benchmark,
    insights: [`ITAD — ${departments[0].improvement}`, `Lead Gen — ${departments[1].improvement}`],
  })
}
