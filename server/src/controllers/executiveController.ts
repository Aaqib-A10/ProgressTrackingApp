import type { Response } from 'express'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { companyToday, dbDateFromString, dateStringFromDb, periodRange, previousRange, type RangeKey, type DateRange } from '../lib/time'
import { sumItad, itadKpis } from '../lib/itad'
import { sumLeadGen, leadGenKpis } from '../lib/leadgen'
import { buildSeries, pctDelta, improvementLine } from '../lib/trends'

const inRange = (r: DateRange) => ({ gte: dbDateFromString(r.startDate), lte: dbDateFromString(r.endDate) })
const submitted = <T extends { status: string }>(rows: T[]): T[] => rows.filter((e) => e.status === 'SUBMITTED')
const round1 = (n: number) => Math.round(n * 10) / 10
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0)
type Kpi = { label: string; value: number; format: 'number' | 'percent'; delta: number }

/** GET /api/dashboard/executive — company-wide view across ALL departments (Super Admin). */
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

  const depts = await prisma.department.findMany({ where: { type: { in: ['ITAD', 'LEAD_GEN', 'MARKETING', 'CSR', 'ECOMMERCE'] } } })
  const id = (t: string) => depts.find((d) => d.type === t)?.id
  const headcount = (t: string) => {
    const did = id(t)
    return did ? prisma.user.count({ where: { departmentId: did, role: { in: ['MEMBER', 'SUB_DEPT_LEAD', 'TEAM_LEAD'] }, isActive: true } }) : Promise.resolve(0)
  }
  const csrId = id('CSR')
  const ecomId = id('ECOMMERCE')

  const [
    itadCur, itadPrev, itadToday,
    leadCur, leadPrev, leadToday,
    socCur, socPrev, socToday, seoToday, mktPubCur, mktPubPrev,
    ecomCur, ecomPrev, ecomToday, stockOpen,
    csrCur, csrPrev,
    hcItad, hcLead, hcMkt, hcCsr, hcEcom,
    employees, pendingApprovals, coachingNeeded, stockRequested,
  ] = await Promise.all([
    prisma.itadDailyEntry.findMany({ where: { date: inRange(range) } }),
    prisma.itadDailyEntry.findMany({ where: { date: inRange(prev) } }),
    prisma.itadDailyEntry.findMany({ where: { date: todayValue } }),
    prisma.leadGenDailyEntry.findMany({ where: { date: inRange(range) } }),
    prisma.leadGenDailyEntry.findMany({ where: { date: inRange(prev) } }),
    prisma.leadGenDailyEntry.findMany({ where: { date: todayValue } }),
    prisma.socialDailyEntry.findMany({ where: { date: inRange(range) } }),
    prisma.socialDailyEntry.findMany({ where: { date: inRange(prev) } }),
    prisma.socialDailyEntry.findMany({ where: { date: todayValue } }),
    prisma.seoDailyEntry.findMany({ where: { date: todayValue } }),
    prisma.marketingTask.count({ where: { status: 'PUBLISHED', publishedDate: inRange(range) } }),
    prisma.marketingTask.count({ where: { status: 'PUBLISHED', publishedDate: inRange(prev) } }),
    prisma.ecommerceDailyEntry.findMany({ where: { date: inRange(range) }, include: { lines: true } }),
    prisma.ecommerceDailyEntry.findMany({ where: { date: inRange(prev) }, include: { lines: true } }),
    prisma.ecommerceDailyEntry.findMany({ where: { date: todayValue } }),
    ecomId ? prisma.stockRequest.count({ where: { departmentId: ecomId, status: { not: 'RESOLVED' } } }) : Promise.resolve(0),
    csrId ? prisma.qaEvaluation.findMany({ where: { departmentId: csrId, status: 'SUBMITTED', createdAt: { gte: new Date(range.startDate + 'T00:00:00Z'), lte: new Date(range.endDate + 'T23:59:59Z') } }, select: { totalScore: true, passed: true } }) : Promise.resolve([]),
    csrId ? prisma.qaEvaluation.findMany({ where: { departmentId: csrId, status: 'SUBMITTED', createdAt: { gte: new Date(prev.startDate + 'T00:00:00Z'), lte: new Date(prev.endDate + 'T23:59:59Z') } }, select: { totalScore: true } }) : Promise.resolve([]),
    headcount('ITAD'), headcount('LEAD_GEN'), headcount('MARKETING'), headcount('CSR'), headcount('ECOMMERCE'),
    prisma.user.count({ where: { isActive: true, role: { not: 'SUPER_ADMIN' } } }),
    prisma.user.count({ where: { status: 'PENDING' } }),
    prisma.qaEvaluation.count({ where: { status: 'SUBMITTED', coachingNeeded: true, agentAcknowledgedAt: null } }),
    prisma.stockRequest.count({ where: { status: 'REQUESTED' } }),
  ])

  // --- ITAD ---
  const it = sumItad(itadCur), ip = sumItad(itadPrev), ik = itadKpis(it), ikp = itadKpis(ip)
  // --- Lead Gen ---
  const lt = sumLeadGen(leadCur), lp = sumLeadGen(leadPrev), lk = leadGenKpis(lt), lkp = leadGenKpis(lp)
  // --- Marketing ---
  const posts = submitted(socCur).reduce((s, e) => s + e.postsPublished, 0)
  const postsPrev = submitted(socPrev).reduce((s, e) => s + e.postsPublished, 0)
  const mktToday = new Set([...submitted(socToday).map((e) => e.userId), ...submitted(seoToday).map((e) => e.userId)]).size
  // --- Ecommerce ---
  const ecomListings = submitted(ecomCur).reduce((s, e) => s + e.lines.reduce((t, l) => t + l.listings, 0), 0)
  const ecomListingsPrev = submitted(ecomPrev).reduce((s, e) => s + e.lines.reduce((t, l) => t + l.listings, 0), 0)
  // --- CSR (QA) ---
  const csrAvg = round1(avg(csrCur.map((e) => e.totalScore)))
  const csrAvgPrev = round1(avg(csrPrev.map((e) => e.totalScore)))
  const csrPass = csrCur.length ? Math.round((csrCur.filter((e) => e.passed).length / csrCur.length) * 1000) / 10 : 0

  const departments = [
    {
      type: 'ITAD', name: 'ITAD', members: hcItad, route: '/app/itad/team',
      subtitle: `${submitted(itadToday).length}/${hcItad} submitted today`,
      headline: [
        { label: 'Dials', value: it.callsDialed, format: 'number', delta: pctDelta(it.callsDialed, ip.callsDialed) },
        { label: 'Connect Rate', value: ik.connectRate, format: 'percent', delta: pctDelta(ik.connectRate, ikp.connectRate) },
      ] as Kpi[],
      improvement: improvementLine([{ label: 'Connect rate', delta: pctDelta(ik.connectRate, ikp.connectRate) }, { label: 'Closed', delta: pctDelta(it.closed, ip.closed) }]),
    },
    {
      type: 'LEAD_GEN', name: 'Lead Generation', members: hcLead, route: '/app/leadgen/team',
      subtitle: `${submitted(leadToday).length}/${hcLead} submitted today`,
      headline: [
        { label: 'Leads', value: lt.leadsGenerated, format: 'number', delta: pctDelta(lt.leadsGenerated, lp.leadsGenerated) },
        { label: 'MQL → SQL', value: lk.mqlToSql, format: 'percent', delta: pctDelta(lk.mqlToSql, lkp.mqlToSql) },
      ] as Kpi[],
      improvement: improvementLine([{ label: 'Leads', delta: pctDelta(lt.leadsGenerated, lp.leadsGenerated) }, { label: 'Qualified', delta: pctDelta(lt.qualifiedMql, lp.qualifiedMql) }]),
    },
    {
      type: 'MARKETING', name: 'Marketing', members: hcMkt, route: '/app/marketing/analytics',
      subtitle: `${mktToday}/${hcMkt} submitted today`,
      headline: [
        { label: 'Posts published', value: posts, format: 'number', delta: pctDelta(posts, postsPrev) },
        { label: 'Content published', value: mktPubCur, format: 'number', delta: pctDelta(mktPubCur, mktPubPrev) },
      ] as Kpi[],
      improvement: improvementLine([{ label: 'Posts', delta: pctDelta(posts, postsPrev) }, { label: 'Content', delta: pctDelta(mktPubCur, mktPubPrev) }]),
    },
    {
      type: 'CSR', name: 'CSR', members: hcCsr, route: '/app/qa/analytics',
      subtitle: `${hcCsr} agents · ${csrCur.length} evaluation${csrCur.length === 1 ? '' : 's'}`,
      headline: [
        { label: 'QA avg', value: csrAvg, format: 'percent', delta: pctDelta(csrAvg, csrAvgPrev) },
        { label: 'Pass rate', value: csrPass, format: 'percent', delta: 0 },
      ] as Kpi[],
      improvement: csrCur.length ? improvementLine([{ label: 'QA avg', delta: pctDelta(csrAvg, csrAvgPrev) }]) : 'No QA evaluations logged yet.',
    },
    {
      type: 'ECOMMERCE', name: 'Ecommerce', members: hcEcom, route: '/app/ecommerce/team',
      subtitle: `${submitted(ecomToday).length}/${hcEcom} submitted today`,
      headline: [
        { label: 'Listings', value: ecomListings, format: 'number', delta: pctDelta(ecomListings, ecomListingsPrev) },
        { label: 'Open stock', value: stockOpen, format: 'number', delta: 0 },
      ] as Kpi[],
      improvement: improvementLine([{ label: 'Listings', delta: pctDelta(ecomListings, ecomListingsPrev) }]),
    },
  ]

  // Company activity trend = submitted entries per bucket across departments with daily forms.
  const activityRows = [
    ...itadCur.map((e) => ({ date: dateStringFromDb(e.date), value: 1, status: e.status })),
    ...leadCur.map((e) => ({ date: dateStringFromDb(e.date), value: 1, status: e.status })),
    ...socCur.map((e) => ({ date: dateStringFromDb(e.date), value: 1, status: e.status })),
    ...ecomCur.map((e) => ({ date: dateStringFromDb(e.date), value: 1, status: e.status })),
  ]
  const combinedTrend = { metricLabel: 'Submissions', points: buildSeries(range, activityRows) }

  const benchmark = [
    { department: 'ITAD', members: hcItad, submitted: `${submitted(itadToday).length}/${hcItad}`, primaryLabel: 'Dials', primaryValue: it.callsDialed, secondary: `${round1(ik.connectRate * 100)}% connect`, delta: pctDelta(it.callsDialed, ip.callsDialed) },
    { department: 'Lead Generation', members: hcLead, submitted: `${submitted(leadToday).length}/${hcLead}`, primaryLabel: 'Leads', primaryValue: lt.leadsGenerated, secondary: `${round1(lk.mqlToSql * 100)}% MQL→SQL`, delta: pctDelta(lt.leadsGenerated, lp.leadsGenerated) },
    { department: 'Marketing', members: hcMkt, submitted: `${mktToday}/${hcMkt}`, primaryLabel: 'Posts', primaryValue: posts, secondary: `${mktPubCur} content published`, delta: pctDelta(posts, postsPrev) },
    { department: 'CSR', members: hcCsr, submitted: '—', primaryLabel: 'Evaluations', primaryValue: csrCur.length, secondary: `${csrAvg}% avg QA`, delta: pctDelta(csrAvg, csrAvgPrev) },
    { department: 'Ecommerce', members: hcEcom, submitted: `${submitted(ecomToday).length}/${hcEcom}`, primaryLabel: 'Listings', primaryValue: ecomListings, secondary: `${stockOpen} open stock`, delta: pctDelta(ecomListings, ecomListingsPrev) },
  ]

  // Company summary (KPI header + alert totals).
  const st = (rows: { status: string }[]) => submitted(rows).length
  const submittedTodayTotal = st(itadToday) + st(leadToday) + mktToday + st(ecomToday)
  const formMembers = hcItad + hcLead + hcMkt + hcEcom
  const notSubmitted =
    Math.max(0, hcItad - st(itadToday)) + Math.max(0, hcLead - st(leadToday)) +
    Math.max(0, hcMkt - mktToday) + Math.max(0, hcEcom - st(ecomToday))
  const summary = {
    employees,
    departments: depts.length,
    submittedToday: submittedTodayTotal,
    formMembers,
    onTimeRate: formMembers ? Math.round((submittedTodayTotal / formMembers) * 1000) / 10 : 0,
    pendingApprovals,
    notSubmitted,
    stockRequested,
    coachingNeeded,
    alerts: pendingApprovals + notSubmitted + stockRequested + coachingNeeded,
  }

  res.json({
    range: { ...range, key: rangeKey },
    summary,
    departments,
    combinedTrend,
    benchmark,
    insights: departments.map((d) => `${d.name} — ${d.improvement}`),
  })
}
