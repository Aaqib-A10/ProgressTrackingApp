/**
 * Financial report builder: per-team cost (salaries) vs revenue (closed deals)
 * and ROI. Cost over a date range = Σ(monthlyCost × active months). Revenue for
 * ITAD = Σ awardedPrice of WON deals decided within the range. Lead Gen &
 * Marketing have no deal source yet, so their revenue/ROI are null (cost-only).
 *
 * `activeMonths` is pure (no DB) so it is unit-testable; `buildFinancialReport`
 * pulls from Prisma and reuses the WON-sum logic from the Deal Tracker.
 */
import { DepartmentType } from '@prisma/client'
import { prisma } from './prisma'
import { roi as roiKpi } from './kpi'

/** Teams that appear in the financial report (in display order). */
export const FINANCIAL_TEAMS: { key: DepartmentType; name: string }[] = [
  { key: 'ITAD', name: 'ITAD' },
  { key: 'LEAD_GEN', name: 'Lead Generation' },
  { key: 'MARKETING', name: 'Marketing' },
]
/** Teams whose revenue we can currently measure (from the Deal Tracker). */
const REVENUE_TEAMS: DepartmentType[] = ['ITAD']

export interface PersonCost {
  id: string
  name: string
  team: DepartmentType
  monthlyCost: number
  startDate: string // YYYY-MM-DD
  endDate: string | null
  activeMonths: number
  costInRange: number
}
export interface TeamFinancials {
  team: DepartmentType
  teamName: string
  staff: number
  cost: number
  revenue: number | null
  netReturn: number | null
  roi: number | null
  people: PersonCost[]
}
export interface FinancialReport {
  from: string // YYYY-MM
  to: string // YYYY-MM
  teams: TeamFinancials[]
  totals: { staff: number; cost: number; revenue: number; netReturn: number; roi: number | null }
}

/** Parse a 'YYYY-MM' month into its [firstDay, lastDay] UTC bounds. */
function monthBounds(month: string): { start: Date; end: Date } {
  const [y, m] = month.split('-').map(Number)
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 0, 23, 59, 59, 999)) }
}

/**
 * How many whole months in [fromMonth, toMonth] the person was active, i.e. the
 * employment window [startDate, endDate ?? ∞) overlaps that month. Dates are the
 * @db.Date values (UTC midnight). Returns 0 if the range is inverted.
 */
export function activeMonths(
  startDate: Date,
  endDate: Date | null,
  fromMonth: string,
  toMonth: string,
): number {
  const [fy, fm] = fromMonth.split('-').map(Number)
  const [ty, tm] = toMonth.split('-').map(Number)
  let count = 0
  let y = fy
  let m = fm // 1-based
  while (y < ty || (y === ty && m <= tm)) {
    const mStart = new Date(Date.UTC(y, m - 1, 1))
    const mEnd = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999))
    if (startDate <= mEnd && (!endDate || endDate >= mStart)) count++
    m++
    if (m > 12) { m = 1; y++ }
  }
  return count
}

const iso = (d: Date) => d.toISOString().slice(0, 10)

/** Build the cost-vs-revenue-vs-ROI report for the month range [from, to]. */
export async function buildFinancialReport({ from, to }: { from: string; to: string }): Promise<FinancialReport> {
  const { start: rangeStart } = monthBounds(from)
  const { end: rangeEnd } = monthBounds(to)

  const [salaries, wonDeals] = await Promise.all([
    prisma.salaryRecord.findMany({ include: { department: true }, orderBy: { name: 'asc' } }),
    prisma.bid.findMany({
      where: { status: 'WON', closedDate: { gte: rangeStart, lte: rangeEnd } },
      select: { awardedPrice: true },
    }),
  ])

  const itadRevenue = wonDeals.reduce((s, b) => s + (b.awardedPrice ?? 0), 0)

  const teams: TeamFinancials[] = FINANCIAL_TEAMS.map(({ key, name }) => {
    const people: PersonCost[] = salaries
      .filter((s) => s.department.type === key)
      .map((s) => {
        const monthlyCost = Number(s.monthlyCost)
        const months = activeMonths(s.startDate, s.endDate, from, to)
        return {
          id: s.id,
          name: s.name,
          team: key,
          monthlyCost,
          startDate: iso(s.startDate),
          endDate: s.endDate ? iso(s.endDate) : null,
          activeMonths: months,
          costInRange: Math.round(monthlyCost * months * 100) / 100,
        }
      })
    const cost = Math.round(people.reduce((sum, p) => sum + p.costInRange, 0) * 100) / 100
    const revenue = REVENUE_TEAMS.includes(key) ? (key === 'ITAD' ? Math.round(itadRevenue * 100) / 100 : 0) : null
    const netReturn = revenue == null ? null : Math.round((revenue - cost) * 100) / 100
    const roi = revenue == null ? null : roiKpi(revenue, cost)
    return { team: key, teamName: name, staff: people.length, cost, revenue, netReturn, roi, people }
  })

  const totalCost = Math.round(teams.reduce((s, t) => s + t.cost, 0) * 100) / 100
  const totalRevenue = Math.round(teams.reduce((s, t) => s + (t.revenue ?? 0), 0) * 100) / 100
  const totals = {
    staff: teams.reduce((s, t) => s + t.staff, 0),
    cost: totalCost,
    revenue: totalRevenue,
    netReturn: Math.round((totalRevenue - totalCost) * 100) / 100,
    roi: roiKpi(totalRevenue, totalCost),
  }

  return { from, to, teams, totals }
}
