import type { Response } from 'express'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { dbDateFromString, dateStringFromDb, periodRange, previousRange, type RangeKey, type DateRange } from '../lib/time'
import { sumItad, itadKpis } from '../lib/itad'
import { sumLeadGen, leadGenKpis, funnelStages } from '../lib/leadgen'
import { buildSeries, pctDelta, type TrendPoint } from '../lib/trends'

const inRange = (r: DateRange) => ({ gte: dbDateFromString(r.startDate), lte: dbDateFromString(r.endDate) })

const PERIOD_LABELS: Record<string, [string, string, string]> = {
  today: ['2 Days Ago', 'Yesterday', 'Today'],
  week: ['2 Weeks Ago', 'Last Week', 'This Week'],
  month: ['2 Months Ago', 'Last Month', 'This Month'],
  rolling3m: ['Earlier', 'Prev 3 Months', 'This Period'],
  custom: ['Earlier', 'Previous', 'Current'],
}

/** GET /api/itad/analytics?range= — period comparison, lifecycle funnel, KPI trends. */
export async function itadAnalytics(req: AuthedRequest, res: Response): Promise<void> {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, include: { department: true } })
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

  const rangeKey = ((req.query.range as RangeKey) || 'month') as RangeKey
  const range = periodRange(rangeKey, { start: req.query.start as string, end: req.query.end as string })
  const prev = previousRange(range)
  const prev2 = previousRange(prev)

  const members = await prisma.user.findMany({ where: { departmentId: dept.id, role: 'MEMBER', isActive: true }, select: { id: true } })
  const ids = members.map((m) => m.id)
  const target = await prisma.target.findFirst({ where: { scope: 'DEPARTMENT', departmentId: dept.id, metricKey: 'callsDialed', period: 'DAILY' } })
  const dailyDialTarget = target?.value ?? 0

  const [cur, prv, prv2] = await Promise.all([
    prisma.itadDailyEntry.findMany({ where: { userId: { in: ids }, date: inRange(range) } }),
    prisma.itadDailyEntry.findMany({ where: { userId: { in: ids }, date: inRange(prev) } }),
    prisma.itadDailyEntry.findMany({ where: { userId: { in: ids }, date: inRange(prev2) } }),
  ])

  const tc = sumItad(cur)
  const tp = sumItad(prv)
  const t2 = sumItad(prv2)
  const kc = itadKpis(tc)
  const kp = itadKpis(tp)
  const k2 = itadKpis(t2)

  const labels = PERIOD_LABELS[rangeKey] ?? PERIOD_LABELS.custom
  const periodComparison = [
    { label: labels[0], dials: t2.callsDialed, connectRate: k2.connectRate, interested: t2.interested, closed: t2.closed },
    { label: labels[1], dials: tp.callsDialed, connectRate: kp.connectRate, interested: tp.interested, closed: tp.closed },
    { label: labels[2], dials: tc.callsDialed, connectRate: kc.connectRate, interested: tc.interested, closed: tc.closed },
  ]

  const lifecycle = [
    { stage: 'Dialed', value: tc.callsDialed },
    { stage: 'Connected', value: tc.connected },
    { stage: 'Interested', value: tc.interested },
    { stage: 'Working On', value: tc.workingOn },
    { stage: 'Closed', value: tc.closed },
    { stage: 'RFQs', value: tc.rfqs },
  ]

  // Trends: dials (with target) + connect rate (derived per bucket).
  const dials = buildSeries(range, cur.map((e) => ({ date: dateStringFromDb(e.date), value: e.callsDialed, status: e.status })), dailyDialTarget)
  const connected = buildSeries(range, cur.map((e) => ({ date: dateStringFromDb(e.date), value: e.connected, status: e.status })))
  const connectRate: TrendPoint[] = dials.map((p, i) => ({
    label: p.label,
    value: p.value ? connected[i].value / p.value : 0,
  }))

  res.json({
    range: { ...range, key: rangeKey },
    target: { dailyDials: dailyDialTarget },
    kpis: [
      { label: 'Connect Rate', value: kc.connectRate, format: 'percent', delta: pctDelta(kc.connectRate, kp.connectRate) },
      { label: 'Interest Rate', value: kc.interestRate, format: 'percent', delta: pctDelta(kc.interestRate, kp.interestRate) },
      { label: 'Close Rate', value: kc.closeRate, format: 'percent', delta: pctDelta(kc.closeRate, kp.closeRate) },
      { label: 'RFQ Conversion', value: kc.rfqConversion, format: 'percent', delta: pctDelta(kc.rfqConversion, kp.rfqConversion) },
    ],
    periodComparison,
    lifecycle,
    trends: {
      dials: { metricLabel: 'Dials', points: dials },
      connectRate: { metricLabel: 'Connect Rate', points: connectRate },
    },
  })
}

/** GET /api/leadgen/analytics?range= — period comparison, pipeline funnel, KPI trends. */
export async function leadgenAnalytics(req: AuthedRequest, res: Response): Promise<void> {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, include: { department: true } })
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

  const rangeKey = ((req.query.range as RangeKey) || 'month') as RangeKey
  const range = periodRange(rangeKey, { start: req.query.start as string, end: req.query.end as string })
  const prev = previousRange(range)
  const prev2 = previousRange(prev)

  const members = await prisma.user.findMany({ where: { departmentId: dept.id, role: 'MEMBER', isActive: true }, select: { id: true } })
  const ids = members.map((m) => m.id)
  const target = await prisma.target.findFirst({ where: { scope: 'DEPARTMENT', departmentId: dept.id, metricKey: 'leadsGenerated', period: 'WEEKLY' } })
  const weeklyLeadTarget = target?.value ?? 0
  const dailyLeadTarget = weeklyLeadTarget / 5

  const [cur, prv, prv2] = await Promise.all([
    prisma.leadGenDailyEntry.findMany({ where: { userId: { in: ids }, date: inRange(range) } }),
    prisma.leadGenDailyEntry.findMany({ where: { userId: { in: ids }, date: inRange(prev) } }),
    prisma.leadGenDailyEntry.findMany({ where: { userId: { in: ids }, date: inRange(prev2) } }),
  ])

  const tc = sumLeadGen(cur)
  const tp = sumLeadGen(prv)
  const t2 = sumLeadGen(prv2)
  const kc = leadGenKpis(tc)
  const kp = leadGenKpis(tp)
  const k2 = leadGenKpis(t2)

  const labels = PERIOD_LABELS[rangeKey] ?? PERIOD_LABELS.custom
  const periodComparison = [
    { label: labels[0], leads: t2.leadsGenerated, qualified: t2.qualifiedMql, mqlToSql: k2.mqlToSql, contacts: t2.contactsFound },
    { label: labels[1], leads: tp.leadsGenerated, qualified: tp.qualifiedMql, mqlToSql: kp.mqlToSql, contacts: tp.contactsFound },
    { label: labels[2], leads: tc.leadsGenerated, qualified: tc.qualifiedMql, mqlToSql: kc.mqlToSql, contacts: tc.contactsFound },
  ]

  // Trends: lead volume (with target) + lead-to-qualified rate (derived per bucket).
  const leads = buildSeries(range, cur.map((e) => ({ date: dateStringFromDb(e.date), value: e.leadsGenerated, status: e.status })), dailyLeadTarget)
  const qualified = buildSeries(range, cur.map((e) => ({ date: dateStringFromDb(e.date), value: e.qualifiedMql, status: e.status })))
  const leadToQualified: TrendPoint[] = leads.map((p, i) => ({
    label: p.label,
    value: p.value ? qualified[i].value / p.value : 0,
  }))

  res.json({
    range: { ...range, key: rangeKey },
    target: { weeklyLeads: weeklyLeadTarget },
    kpis: [
      { label: 'Lead → Qualified', value: kc.leadToQualified, format: 'percent', delta: pctDelta(kc.leadToQualified, kp.leadToQualified) },
      { label: 'MQL → SQL', value: kc.mqlToSql, format: 'percent', delta: pctDelta(kc.mqlToSql, kp.mqlToSql) },
      { label: 'Contact Discovery', value: kc.contactDiscovery, format: 'percent', delta: pctDelta(kc.contactDiscovery, kp.contactDiscovery) },
    ],
    periodComparison,
    funnel: funnelStages(tc),
    trends: {
      leads: { metricLabel: 'Leads', points: leads },
      leadToQualified: { metricLabel: 'Lead → Qualified', points: leadToQualified },
    },
  })
}
