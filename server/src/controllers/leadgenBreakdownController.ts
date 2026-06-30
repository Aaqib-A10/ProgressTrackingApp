// Month-level Lead Gen breakdown by campaign (BBR, RTLG, …) and industry.
// Maintained by TL/Admin; powers the Team View summary cards.
import type { Response } from 'express'
import { z } from 'zod'
import { DateTime } from 'luxon'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { companyToday, dbDateFromString } from '../lib/time'

const MONTH_RE = /^\d{4}-\d{2}$/

function currentMonth(): string {
  return DateTime.fromISO(companyToday()).toFormat('yyyy-MM')
}

interface Row {
  category: string
  kind: 'CAMPAIGN' | 'INDUSTRY'
  count: number
}

const sumOf = (xs: Row[]) => xs.reduce((s, r) => s + r.count, 0)

/** Derive the dashboard cards from the raw breakdown rows. BBR / RTLG are the
 *  campaign rows whose names contain "bbr" / "rtlg" (so granular rows like
 *  "Waqas RTLG" + "JD RTLG" roll up into one RTLG figure). */
function summarize(rows: Row[]) {
  const campaigns = rows.filter((r) => r.kind === 'CAMPAIGN').sort((a, b) => b.count - a.count)
  const industries = rows.filter((r) => r.kind === 'INDUSTRY').sort((a, b) => b.count - a.count)
  return {
    rows,
    campaigns,
    industries,
    bbr: sumOf(campaigns.filter((c) => /bbr/i.test(c.category))),
    rtlg: sumOf(campaigns.filter((c) => /rtlg/i.test(c.category))),
    topIndustry: industries[0] ?? null,
    industriesTotal: sumOf(industries),
    campaignsTotal: sumOf(campaigns),
  }
}

/** Total leads actually logged by the whole Lead Gen dept (incl. the lead) in the month. */
async function monthLeads(month: string): Promise<number> {
  const start = DateTime.fromISO(month + '-01', { zone: 'utc' }).startOf('month')
  const end = start.endOf('month')
  const dept = await prisma.department.findUnique({ where: { type: 'LEAD_GEN' } })
  if (!dept) return 0
  const users = await prisma.user.findMany({ where: { departmentId: dept.id, isActive: true }, select: { id: true } })
  const agg = await prisma.leadGenDailyEntry.aggregate({
    where: {
      userId: { in: users.map((u) => u.id) },
      status: 'SUBMITTED',
      date: { gte: dbDateFromString(start.toISODate()!), lte: dbDateFromString(end.toISODate()!) },
    },
    _sum: { leadsGenerated: true },
  })
  return agg._sum.leadsGenerated ?? 0
}

function canManage(role: string): boolean {
  return role === 'TEAM_LEAD' || role === 'SUPER_ADMIN'
}

/** GET /api/leadgen/breakdown?month=YYYY-MM */
export async function getBreakdown(req: AuthedRequest, res: Response): Promise<void> {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, include: { department: true } })
  if (!canManage(me.role)) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  if (me.role === 'TEAM_LEAD' && me.department?.type !== 'LEAD_GEN') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const month = MONTH_RE.test(String(req.query.month)) ? String(req.query.month) : currentMonth()
  const rows = await prisma.leadGenBreakdown.findMany({ where: { month }, orderBy: [{ kind: 'asc' }, { count: 'desc' }] })
  const leadsGenerated = await monthLeads(month)
  res.json({ month, leadsGenerated, ...summarize(rows.map((r) => ({ category: r.category, kind: r.kind, count: r.count }))) })
}

const itemSchema = z.object({
  category: z.string().trim().min(1).max(80),
  kind: z.enum(['CAMPAIGN', 'INDUSTRY']),
  count: z.number().int().min(0).max(1000000),
})
const putSchema = z.object({
  month: z.string().regex(MONTH_RE),
  items: z.array(itemSchema).max(200),
})

/** PUT /api/leadgen/breakdown — replace all rows for a month. */
export async function putBreakdown(req: AuthedRequest, res: Response): Promise<void> {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, include: { department: true } })
  if (!canManage(me.role) || (me.role === 'TEAM_LEAD' && me.department?.type !== 'LEAD_GEN')) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const parsed = putSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const { month, items } = parsed.data
  // De-dupe by category (last wins), drop blanks.
  const byCategory = new Map<string, Row>()
  for (const it of items) byCategory.set(it.category, { category: it.category, kind: it.kind, count: it.count })
  const rows = [...byCategory.values()]

  await prisma.$transaction([
    prisma.leadGenBreakdown.deleteMany({ where: { month } }),
    ...(rows.length
      ? [prisma.leadGenBreakdown.createMany({ data: rows.map((r) => ({ month, ...r })) })]
      : []),
  ])

  const leadsGenerated = await monthLeads(month)
  res.json({ month, leadsGenerated, ...summarize(rows) })
}
