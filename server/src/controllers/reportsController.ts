import type { Response } from 'express'
import { DateTime } from 'luxon'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { companyToday, dbDateFromString, periodRange, type RangeKey, type DateRange } from '../lib/time'
import { aggregateAgent as aggregateItad, itadKpis, sumItad } from '../lib/itad'
import { aggregateAgent as aggregateLeadGen, leadGenKpis, sumLeadGen } from '../lib/leadgen'
import { buildMonthlyReport, buildManagementReport } from '../lib/reports'
import { renderMonthlyReportEmail, renderManagementReportEmail } from '../lib/reportEmail'
import { sendMail } from '../lib/mail'

/** Configured management recipients for the scheduled reports (comma-separated env). */
export function reportRecipients(): string[] {
  return (process.env.REPORT_RECIPIENTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

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
  const members = await prisma.user.findMany({ where: { departmentId: dept.id, role: { in: ['MEMBER', 'SUB_DEPT_LEAD', 'TEAM_LEAD'] }, isActive: true }, orderBy: { name: 'asc' } })
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

const REPORT_DEPTS = ['ITAD', 'LEAD_GEN'] as const
type ReportDept = (typeof REPORT_DEPTS)[number]

/** Default to the previous calendar month (the month a monthly report is "about"). */
export function previousMonth(): string {
  return DateTime.fromISO(companyToday()).minus({ months: 1 }).toFormat('yyyy-MM')
}

/** GET /api/reports/monthly?department=ITAD|LEAD_GEN&month=YYYY-MM — structured monthly team report. */
export async function monthlyReport(req: AuthedRequest, res: Response): Promise<void> {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, include: { department: true } })
  const deptParam = String(req.query.department || '').toUpperCase()
  if (!REPORT_DEPTS.includes(deptParam as ReportDept)) {
    res.status(400).json({ error: 'department must be ITAD or LEAD_GEN' })
    return
  }
  const departmentType = deptParam as ReportDept

  // RBAC: Super Admin sees any department; a Team Lead only their own.
  if (me.role !== 'SUPER_ADMIN') {
    if (me.role !== 'TEAM_LEAD' || me.department?.type !== departmentType) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }
  }

  const month = /^\d{4}-\d{2}$/.test(String(req.query.month)) ? String(req.query.month) : previousMonth()
  const report = await buildMonthlyReport(departmentType, month)
  if (!report) {
    res.status(404).json({ error: 'Department not found' })
    return
  }
  res.json({ report })
}

/** GET /api/reports/monthly/preview?department=&month= — render the EXACT email HTML (no send).
 *  Auth is cookie-based, so opening this URL in a logged-in browser tab Just Works. */
export async function previewMonthlyReport(req: AuthedRequest, res: Response): Promise<void> {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, include: { department: true } })
  const deptParam = String(req.query.department || '').toUpperCase()
  if (!REPORT_DEPTS.includes(deptParam as ReportDept)) {
    res.status(400).send('department must be ITAD or LEAD_GEN')
    return
  }
  const departmentType = deptParam as ReportDept
  if (me.role !== 'SUPER_ADMIN') {
    if (me.role !== 'TEAM_LEAD' || me.department?.type !== departmentType) {
      res.status(403).send('Forbidden')
      return
    }
  }
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month)) ? String(req.query.month) : previousMonth()
  const report = await buildMonthlyReport(departmentType, month)
  if (!report) {
    res.status(404).send('Department not found')
    return
  }
  const { html } = renderMonthlyReportEmail(report)
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.send(html)
}

/** POST /api/reports/monthly/send — email the report now. Body: { department, month?, to? }. */
export async function sendMonthlyReport(req: AuthedRequest, res: Response): Promise<void> {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, include: { department: true } })
  const body = (req.body ?? {}) as { department?: string; month?: string; to?: string | string[] }
  const deptParam = String(body.department || '').toUpperCase()
  if (!REPORT_DEPTS.includes(deptParam as ReportDept)) {
    res.status(400).json({ error: 'department must be ITAD or LEAD_GEN' })
    return
  }
  const departmentType = deptParam as ReportDept
  if (me.role !== 'SUPER_ADMIN') {
    if (me.role !== 'TEAM_LEAD' || me.department?.type !== departmentType) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }
  }

  // Recipients: explicit `to` override (for testing) else the configured management list.
  const override = body.to ? (Array.isArray(body.to) ? body.to : [body.to]) : []
  const recipients = (override.length ? override : reportRecipients()).map((s) => s.trim()).filter(Boolean)
  if (recipients.length === 0) {
    res.status(400).json({ error: 'No recipients — set REPORT_RECIPIENTS or pass "to".' })
    return
  }

  const month = /^\d{4}-\d{2}$/.test(String(body.month)) ? String(body.month) : previousMonth()
  const report = await buildMonthlyReport(departmentType, month)
  if (!report) {
    res.status(404).json({ error: 'Department not found' })
    return
  }
  const { subject, html, text } = renderMonthlyReportEmail(report)
  await sendMail({ to: recipients, subject, html, text })
  res.json({ sent: true, department: departmentType, month, recipients })
}

// ==================== Consolidated management report (ITAD + Bids + Marketing) ====================

/** Any Team Lead or Super Admin may view/send the consolidated management report. */
async function assertManager(req: AuthedRequest): Promise<boolean> {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { role: true } })
  return me.role === 'SUPER_ADMIN' || me.role === 'TEAM_LEAD'
}

/** GET /api/reports/management/preview?month= — standalone printable combined report HTML. */
export async function managementPreview(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await assertManager(req))) {
    res.status(403).send('Forbidden')
    return
  }
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month)) ? String(req.query.month) : previousMonth()
  const report = await buildManagementReport(month)
  const { html } = renderManagementReportEmail(report)
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.send(html)
}

/** POST /api/reports/management/send — email the combined report now. Body: { month?, to? }. */
export async function sendManagementReport(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await assertManager(req))) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const body = (req.body ?? {}) as { month?: string; to?: string | string[] }
  const override = body.to ? (Array.isArray(body.to) ? body.to : [body.to]) : []
  const recipients = (override.length ? override : reportRecipients()).map((s) => s.trim()).filter(Boolean)
  if (recipients.length === 0) {
    res.status(400).json({ error: 'No recipients — set REPORT_RECIPIENTS or pass "to".' })
    return
  }
  const month = /^\d{4}-\d{2}$/.test(String(body.month)) ? String(body.month) : previousMonth()
  const report = await buildManagementReport(month)
  const { subject, html, text } = renderManagementReportEmail(report)
  await sendMail({ to: recipients, subject, html, text })
  res.json({ sent: true, month, recipients })
}
