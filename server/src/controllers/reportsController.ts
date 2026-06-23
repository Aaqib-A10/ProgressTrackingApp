import type { Response } from 'express'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { dbDateFromString, periodRange, type RangeKey, type DateRange } from '../lib/time'
import { aggregateAgent as aggregateItad, itadKpis, sumItad } from '../lib/itad'
import { aggregateAgent as aggregateLeadGen, leadGenKpis, sumLeadGen } from '../lib/leadgen'

const inRange = (r: DateRange) => ({ gte: dbDateFromString(r.startDate), lte: dbDateFromString(r.endDate) })
const pct = (n: number) => `${(n * 100).toFixed(1)}%`

/** RFC-4180-ish CSV: quote fields containing comma/quote/newline. */
function csv(rows: (string | number)[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const s = String(cell)
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
        })
        .join(','),
    )
    .join('\r\n')
}

/** GET /api/reports/team.csv?range=&department= — on-demand team report export. */
export async function exportTeamCsv(req: AuthedRequest, res: Response): Promise<void> {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, include: { department: true } })
  if (me.role !== 'TEAM_LEAD' && me.role !== 'SUB_DEPT_LEAD' && me.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const deptType = me.department?.type ?? (req.query.department as string)
  if (deptType !== 'ITAD' && deptType !== 'LEAD_GEN') {
    res.status(400).json({ error: 'Specify a valid department (ITAD or LEAD_GEN)' })
    return
  }
  const dept = await prisma.department.findUnique({ where: { type: deptType } })
  if (!dept) {
    res.status(404).json({ error: 'Department not found' })
    return
  }
  if (me.role === 'TEAM_LEAD' && me.departmentId !== dept.id) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  const rangeKey = ((req.query.range as RangeKey) || 'month') as RangeKey
  let range
  try {
    range = periodRange(rangeKey, { start: req.query.start as string, end: req.query.end as string })
  } catch {
    range = periodRange('month')
  }
  const members = await prisma.user.findMany({ where: { departmentId: dept.id, role: 'MEMBER' }, orderBy: { name: 'asc' } })
  const ids = members.map((m) => m.id)

  let rows: (string | number)[][]
  let filename: string

  if (deptType === 'ITAD') {
    const target = await prisma.target.findFirst({ where: { scope: 'DEPARTMENT', departmentId: dept.id, metricKey: 'callsDialed', period: 'DAILY' } })
    const entries = await prisma.itadDailyEntry.findMany({ where: { userId: { in: ids }, date: inRange(range) } })
    const byUser = new Map<string, typeof entries>()
    for (const e of entries) byUser.set(e.userId, [...(byUser.get(e.userId) ?? []), e])

    rows = [['Agent', 'Working Days', 'Dials', 'Connected', 'Connect Rate', 'Voicemail', 'Emails', 'Interested', 'Working On', 'Closed', 'RFQs']]
    for (const m of members) {
      const a = aggregateItad(byUser.get(m.id) ?? [], target?.value ?? 0)
      rows.push([m.name, a.workingDays, a.totals.callsDialed, a.totals.connected, pct(a.kpis.connectRate), a.totals.voicemail, a.totals.emailsSent, a.totals.interested, a.totals.workingOn, a.totals.closed, a.totals.rfqs])
    }
    const tt = sumItad(entries)
    const tk = itadKpis(tt)
    rows.push(['TEAM TOTALS', '', tt.callsDialed, tt.connected, pct(tk.connectRate), tt.voicemail, tt.emailsSent, tt.interested, tt.workingOn, tt.closed, tt.rfqs])
    filename = `itad-team-${range.startDate}_to_${range.endDate}.csv`
  } else {
    const target = await prisma.target.findFirst({ where: { scope: 'DEPARTMENT', departmentId: dept.id, metricKey: 'leadsGenerated', period: 'WEEKLY' } })
    const entries = await prisma.leadGenDailyEntry.findMany({ where: { userId: { in: ids }, date: inRange(range) } })
    const byUser = new Map<string, typeof entries>()
    for (const e of entries) byUser.set(e.userId, [...(byUser.get(e.userId) ?? []), e])

    rows = [['Member', 'Working Days', 'Leads', 'Researched', 'Contacts', 'Qualified (MQL)', 'Handed (SQL)', 'Lead→Qualified', 'MQL→SQL']]
    for (const m of members) {
      const a = aggregateLeadGen(byUser.get(m.id) ?? [], (target?.value ?? 0) / 5)
      rows.push([m.name, a.workingDays, a.totals.leadsGenerated, a.totals.accountsResearched, a.totals.contactsFound, a.totals.qualifiedMql, a.totals.handedToSql, pct(a.kpis.leadToQualified), pct(a.kpis.mqlToSql)])
    }
    const tt = sumLeadGen(entries)
    const tk = leadGenKpis(tt)
    rows.push(['TEAM TOTALS', '', tt.leadsGenerated, tt.accountsResearched, tt.contactsFound, tt.qualifiedMql, tt.handedToSql, pct(tk.leadToQualified), pct(tk.mqlToSql)])
    filename = `leadgen-team-${range.startDate}_to_${range.endDate}.csv`
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.send(csv(rows))
}
