import type { Response } from 'express'
import { z } from 'zod'
import { DepartmentType } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { buildFinancialReport } from '../lib/financials'
import { sendCsv } from '../lib/csv'

/**
 * Financial reports (cost vs revenue vs ROI) + per-person salary CRUD.
 * Salaries are sensitive → every handler here is Super-Admin-only, enforced at
 * the route layer (requireRole('SUPER_ADMIN')). The report reuses the Deal
 * Tracker's WON revenue and the newly-entered salary records.
 */

const monthRe = /^\d{4}-(0[1-9]|1[0-2])$/
function thisMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
/** N months before `month` ('YYYY-MM'), inclusive count from the same month. */
function monthsBefore(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 - n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
/** Resolve & sanitise the from/to month window (defaults: last 6 months). */
function resolveRange(q: AuthedRequest['query']): { from: string; to: string } {
  const to = typeof q.to === 'string' && monthRe.test(q.to) ? q.to : thisMonth()
  let from = typeof q.from === 'string' && monthRe.test(q.from) ? q.from : monthsBefore(to, 5)
  if (from > to) from = to
  return { from, to }
}

const money = (n: number | null) => (n == null ? '' : n.toFixed(2))
const pct = (f: number | null) => (f == null ? '' : `${(f * 100).toFixed(1)}%`)

/** GET /api/financials?from=YYYY-MM&to=YYYY-MM */
export async function getFinancialReport(req: AuthedRequest, res: Response): Promise<void> {
  const { from, to } = resolveRange(req.query)
  res.json(await buildFinancialReport({ from, to }))
}

/** GET /api/financials/report.csv?from=&to= */
export async function exportFinancialCsv(req: AuthedRequest, res: Response): Promise<void> {
  const { from, to } = resolveRange(req.query)
  const report = await buildFinancialReport({ from, to })
  const rows: (string | number)[][] = [
    [`Financial report ${from} to ${to}`],
    [],
    ['Team', 'Staff', 'Cost', 'Revenue', 'Net return', 'ROI'],
    ...report.teams.map((t) => [t.teamName, t.staff, money(t.cost), money(t.revenue), money(t.netReturn), pct(t.roi)]),
    ['TOTAL', report.totals.staff, money(report.totals.cost), money(report.totals.revenue), money(report.totals.netReturn), pct(report.totals.roi)],
    [],
    ['Active employees', 'Team', 'Monthly cost', 'Start', 'End', 'Active months', 'Cost in range'],
    ...report.teams.flatMap((t) =>
      t.people.map((p) => [p.name, t.teamName, money(p.monthlyCost), p.startDate, p.endDate ?? '', p.activeMonths, money(p.costInRange)]),
    ),
    ...(report.former.length
      ? [
          [],
          ['Former employees (no profile)', 'Team', 'Monthly cost', 'Start', 'End', 'Active months', 'Cost in range'],
          ...report.former.map((p) => [p.name, p.teamName, money(p.monthlyCost), p.startDate, p.endDate ?? '', p.activeMonths, money(p.costInRange)]),
        ]
      : []),
  ]
  sendCsv(res, `financial-report-${from}_to_${to}.csv`, rows)
}

// ---------- Salary CRUD ----------

const salarySchema = z.object({
  name: z.string().min(1),
  userId: z.string().optional().nullable(),
  department: z.nativeEnum(DepartmentType),
  monthlyCost: z.number().min(0),
  startDate: z.string().min(1), // YYYY-MM-DD or YYYY-MM
  endDate: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
})

/** Coerce 'YYYY-MM' or 'YYYY-MM-DD' to a UTC Date (first of month if no day). */
function toDate(s: string): Date {
  const iso = /^\d{4}-\d{2}$/.test(s) ? `${s}-01` : s
  return new Date(`${iso}T00:00:00.000Z`)
}

function serialize(s: {
  id: string; name: string; userId: string | null; monthlyCost: unknown
  startDate: Date; endDate: Date | null; note: string | null
  department: { type: DepartmentType }
  user?: { isActive: boolean; status: string } | null
}) {
  return {
    id: s.id,
    name: s.name,
    userId: s.userId,
    department: s.department.type,
    monthlyCost: Number(s.monthlyCost),
    startDate: s.startDate.toISOString().slice(0, 10),
    endDate: s.endDate ? s.endDate.toISOString().slice(0, 10) : null,
    note: s.note,
    // Active = linked to a live PulseTrack profile.
    active: !!(s.user && s.user.isActive && s.user.status === 'ACTIVE'),
  }
}

/** GET /api/financials/salaries */
export async function listSalaries(_req: AuthedRequest, res: Response): Promise<void> {
  const rows = await prisma.salaryRecord.findMany({
    include: { department: { select: { type: true } }, user: { select: { isActive: true, status: true } } },
    orderBy: [{ departmentId: 'asc' }, { name: 'asc' }],
  })
  res.json({ salaries: rows.map(serialize) })
}

/** POST /api/financials/salaries */
export async function createSalary(req: AuthedRequest, res: Response): Promise<void> {
  const parsed = salarySchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const dept = await prisma.department.findUnique({ where: { type: parsed.data.department } })
  if (!dept) {
    res.status(400).json({ error: 'Unknown department' })
    return
  }
  const created = await prisma.salaryRecord.create({
    data: {
      name: parsed.data.name.trim(),
      userId: parsed.data.userId || null,
      departmentId: dept.id,
      monthlyCost: parsed.data.monthlyCost,
      startDate: toDate(parsed.data.startDate),
      endDate: parsed.data.endDate ? toDate(parsed.data.endDate) : null,
      note: parsed.data.note || null,
      setById: req.user!.id,
    },
    include: { department: { select: { type: true } }, user: { select: { isActive: true, status: true } } },
  })
  res.status(201).json({ salary: serialize(created) })
}

const salaryUpdateSchema = salarySchema.partial()

/** PATCH /api/financials/salaries/:id */
export async function updateSalary(req: AuthedRequest, res: Response): Promise<void> {
  const parsed = salaryUpdateSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const existing = await prisma.salaryRecord.findUnique({ where: { id: req.params.id } })
  if (!existing) {
    res.status(404).json({ error: 'Salary record not found' })
    return
  }
  let departmentId = existing.departmentId
  if (parsed.data.department) {
    const dept = await prisma.department.findUnique({ where: { type: parsed.data.department } })
    if (!dept) {
      res.status(400).json({ error: 'Unknown department' })
      return
    }
    departmentId = dept.id
  }
  const updated = await prisma.salaryRecord.update({
    where: { id: existing.id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
      ...(parsed.data.userId !== undefined ? { userId: parsed.data.userId || null } : {}),
      departmentId,
      ...(parsed.data.monthlyCost !== undefined ? { monthlyCost: parsed.data.monthlyCost } : {}),
      ...(parsed.data.startDate !== undefined ? { startDate: toDate(parsed.data.startDate) } : {}),
      ...(parsed.data.endDate !== undefined ? { endDate: parsed.data.endDate ? toDate(parsed.data.endDate) : null } : {}),
      ...(parsed.data.note !== undefined ? { note: parsed.data.note || null } : {}),
    },
    include: { department: { select: { type: true } }, user: { select: { isActive: true, status: true } } },
  })
  res.json({ salary: serialize(updated) })
}

/** DELETE /api/financials/salaries/:id */
export async function deleteSalary(req: AuthedRequest, res: Response): Promise<void> {
  const existing = await prisma.salaryRecord.findUnique({ where: { id: req.params.id } })
  if (!existing) {
    res.status(404).json({ error: 'Salary record not found' })
    return
  }
  await prisma.salaryRecord.delete({ where: { id: existing.id } })
  res.status(204).end()
}
