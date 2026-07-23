// Monthly team report builders (pure data aggregation — used by the preview
// endpoint and the scheduled email). One builder per department in scope.
import { DateTime } from 'luxon'
import { prisma } from './prisma'
import { dbDateFromString } from './time'
import { rate, periodDelta } from './kpi'

function monthBounds(month: string) {
  const start = DateTime.fromISO(month + '-01', { zone: 'utc' }).startOf('month')
  const end = start.endOf('month')
  return { start, end, monthLabel: start.toFormat('LLLL yyyy'), weeks: Math.ceil(end.day / 7) }
}
/** The 'YYYY-MM' one calendar month before `month`. */
function prevMonthStr(month: string): string {
  return DateTime.fromISO(month + '-01', { zone: 'utc' }).minus({ months: 1 }).toFormat('yyyy-MM')
}
const round1 = (n: number) => Math.round(n * 10) / 10
const avg = (xs: number[]) => (xs.length ? round1(xs.reduce((s, x) => s + x, 0) / xs.length) : null)

// ============================ ITAD ============================

export interface ItadAgentRow {
  id: string
  name: string
  email: string
  weeklyQa: { week: number; label: string; avg: number | null; count: number }[]
  monthQaAvg: number | null
  qaCount: number
  daysLogged: number
  callsDialed: number
  connected: number
  voicemail: number
  emailsSent: number
  interested: number
  closed: number
  rfqs: number
}
export interface ItadTeamTotals {
  agents: number
  qaAvg: number | null
  qaCount: number
  callsDialed: number
  connected: number
  closed: number
  rfqs: number
  connectRate: number // connected ÷ dialed, 0..1
}
/** Signed fractional MoM change per KPI (e.g. +0.06 = +6% vs last month). */
export interface ItadDeltas {
  qaAvg: number
  callsDialed: number
  connected: number
  closed: number
  rfqs: number
  connectRate: number
}
export interface ItadReport {
  department: 'ITAD'
  month: string
  monthLabel: string
  weeks: number
  team: ItadTeamTotals
  prev: Omit<ItadTeamTotals, 'agents'> | null // previous month totals; null if no prior data
  deltas: ItadDeltas
  topAgent: { name: string; avg: number } | null
  agents: ItadAgentRow[]
}

/** Month team totals for an ITAD roster — used for the prior-month MoM comparison. */
async function itadMonthTotals(ids: string[], month: string): Promise<Omit<ItadTeamTotals, 'agents'>> {
  const { start, end } = monthBounds(month)
  const [entries, evals] = await Promise.all([
    prisma.itadDailyEntry.findMany({
      where: { userId: { in: ids }, status: 'SUBMITTED', date: { gte: dbDateFromString(start.toISODate()!), lte: dbDateFromString(end.toISODate()!) } },
      select: { callsDialed: true, connected: true, closed: true, rfqs: true },
    }),
    prisma.qaEvaluation.findMany({ where: { agentId: { in: ids }, status: 'SUBMITTED', createdAt: { gte: start.toJSDate(), lte: end.toJSDate() } }, select: { totalScore: true } }),
  ])
  const callsDialed = entries.reduce((s, e) => s + e.callsDialed, 0)
  const connected = entries.reduce((s, e) => s + e.connected, 0)
  return {
    qaAvg: avg(evals.map((e) => e.totalScore)),
    qaCount: evals.length,
    callsDialed,
    connected,
    closed: entries.reduce((s, e) => s + e.closed, 0),
    rfqs: entries.reduce((s, e) => s + e.rfqs, 0),
    connectRate: rate(connected, callsDialed),
  }
}

export async function buildItadReport(month: string): Promise<ItadReport | null> {
  const dept = await prisma.department.findUnique({ where: { type: 'ITAD' } })
  if (!dept) return null
  const { start, end, monthLabel, weeks } = monthBounds(month)
  // Team Leads are excluded from ITAD stats (matches the ITAD team view) — the
  // report is about the agents' calling + QA performance.
  const members = await prisma.user.findMany({ where: { departmentId: dept.id, role: { in: ['MEMBER', 'SUB_DEPT_LEAD'] }, isActive: true }, orderBy: { name: 'asc' } })
  const ids = members.map((m) => m.id)
  const [entries, evals] = await Promise.all([
    prisma.itadDailyEntry.findMany({ where: { userId: { in: ids }, status: 'SUBMITTED', date: { gte: dbDateFromString(start.toISODate()!), lte: dbDateFromString(end.toISODate()!) } } }),
    prisma.qaEvaluation.findMany({ where: { agentId: { in: ids }, status: 'SUBMITTED', createdAt: { gte: start.toJSDate(), lte: end.toJSDate() } }, select: { agentId: true, totalScore: true, createdAt: true } }),
  ])
  const entriesByUser = new Map<string, typeof entries>()
  for (const e of entries) (entriesByUser.get(e.userId) ?? entriesByUser.set(e.userId, []).get(e.userId)!).push(e)
  const evalsByUser = new Map<string, { week: number; score: number }[]>()
  for (const e of evals) {
    const day = DateTime.fromJSDate(e.createdAt, { zone: 'utc' }).day
    const week = Math.min(weeks, Math.ceil(day / 7))
    ;(evalsByUser.get(e.agentId) ?? evalsByUser.set(e.agentId, []).get(e.agentId)!).push({ week, score: e.totalScore })
  }

  const agents: ItadAgentRow[] = members.map((m) => {
    const es = entriesByUser.get(m.id) ?? []
    const sum = (f: 'callsDialed' | 'connected' | 'voicemail' | 'emailsSent' | 'interested' | 'closed' | 'rfqs') => es.reduce((s, e) => s + (e[f] as number), 0)
    const qa = evalsByUser.get(m.id) ?? []
    const weeklyQa = Array.from({ length: weeks }, (_, i) => {
      const w = i + 1
      const wk = qa.filter((x) => x.week === w)
      return { week: w, label: `Wk ${w}`, avg: avg(wk.map((x) => x.score)), count: wk.length }
    })
    return {
      id: m.id,
      name: m.name,
      email: m.email,
      weeklyQa,
      monthQaAvg: avg(qa.map((x) => x.score)),
      qaCount: qa.length,
      daysLogged: es.length,
      callsDialed: sum('callsDialed'),
      connected: sum('connected'),
      voicemail: sum('voicemail'),
      emailsSent: sum('emailsSent'),
      interested: sum('interested'),
      closed: sum('closed'),
      rfqs: sum('rfqs'),
    }
  })

  const scored = agents.filter((a) => a.monthQaAvg !== null)
  const topAgent = scored.length ? scored.reduce((b, a) => (a.monthQaAvg! > b.monthQaAvg! ? a : b)) : null

  const callsDialed = agents.reduce((s, a) => s + a.callsDialed, 0)
  const connected = agents.reduce((s, a) => s + a.connected, 0)
  const team: ItadTeamTotals = {
    agents: agents.length,
    qaAvg: avg(evals.map((e) => e.totalScore)),
    qaCount: evals.length,
    callsDialed,
    connected,
    closed: agents.reduce((s, a) => s + a.closed, 0),
    rfqs: agents.reduce((s, a) => s + a.rfqs, 0),
    connectRate: rate(connected, callsDialed),
  }

  // Month-over-month: same roster, prior calendar month.
  const p = await itadMonthTotals(ids, prevMonthStr(month))
  const hasPrev = p.callsDialed > 0 || p.qaCount > 0
  const deltas: ItadDeltas = {
    qaAvg: periodDelta(team.qaAvg ?? 0, p.qaAvg ?? 0),
    callsDialed: periodDelta(team.callsDialed, p.callsDialed),
    connected: periodDelta(team.connected, p.connected),
    closed: periodDelta(team.closed, p.closed),
    rfqs: periodDelta(team.rfqs, p.rfqs),
    connectRate: periodDelta(team.connectRate, p.connectRate),
  }

  return {
    department: 'ITAD',
    month,
    monthLabel,
    weeks,
    team,
    prev: hasPrev ? p : null,
    deltas,
    topAgent: topAgent ? { name: topAgent.name, avg: topAgent.monthQaAvg! } : null,
    agents,
  }
}

// ============================ Lead Gen ============================

export interface LeadGenAgentRow {
  id: string
  name: string
  email: string
  daysLogged: number
  leads: number
  accountsResearched: number
  contactsFound: number
  mql: number
  sql: number
  verticals: { name: string; count: number }[]
}
export interface LeadGenReport {
  department: 'LEAD_GEN'
  month: string
  monthLabel: string
  team: { agents: number; leads: number; mql: number; sql: number; mqlToSqlRate: number | null }
  topVerticals: { name: string; count: number }[]
  topAgent: { name: string; leads: number } | null
  agents: LeadGenAgentRow[]
}

export async function buildLeadGenReport(month: string): Promise<LeadGenReport | null> {
  const dept = await prisma.department.findUnique({ where: { type: 'LEAD_GEN' } })
  if (!dept) return null
  const { start, end, monthLabel } = monthBounds(month)
  const members = await prisma.user.findMany({ where: { departmentId: dept.id, role: { in: ['MEMBER', 'SUB_DEPT_LEAD', 'TEAM_LEAD'] }, isActive: true }, orderBy: { name: 'asc' } })
  const ids = members.map((m) => m.id)
  const dateWhere = { gte: dbDateFromString(start.toISODate()!), lte: dbDateFromString(end.toISODate()!) }
  const [entries, verticalRows] = await Promise.all([
    prisma.leadGenDailyEntry.findMany({ where: { userId: { in: ids }, status: 'SUBMITTED', date: dateWhere } }),
    prisma.leadGenVerticalCount.findMany({ where: { entry: { userId: { in: ids }, status: 'SUBMITTED', date: dateWhere } }, include: { tag: true, entry: { select: { userId: true } } } }),
  ])
  const entriesByUser = new Map<string, typeof entries>()
  for (const e of entries) (entriesByUser.get(e.userId) ?? entriesByUser.set(e.userId, []).get(e.userId)!).push(e)
  const vertByUser = new Map<string, Map<string, number>>()
  const vertTotals = new Map<string, number>()
  for (const v of verticalRows) {
    const uid = v.entry.userId
    if (!vertByUser.has(uid)) vertByUser.set(uid, new Map())
    const m = vertByUser.get(uid)!
    m.set(v.tag.name, (m.get(v.tag.name) ?? 0) + v.count)
    vertTotals.set(v.tag.name, (vertTotals.get(v.tag.name) ?? 0) + v.count)
  }

  const agents: LeadGenAgentRow[] = members.map((m) => {
    const es = entriesByUser.get(m.id) ?? []
    const sum = (f: 'leadsGenerated' | 'accountsResearched' | 'contactsFound' | 'qualifiedMql' | 'handedToSql') => es.reduce((s, e) => s + (e[f] as number), 0)
    const verticals = [...(vertByUser.get(m.id) ?? new Map()).entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
    return {
      id: m.id,
      name: m.name,
      email: m.email,
      daysLogged: es.length,
      leads: sum('leadsGenerated'),
      accountsResearched: sum('accountsResearched'),
      contactsFound: sum('contactsFound'),
      mql: sum('qualifiedMql'),
      sql: sum('handedToSql'),
      verticals,
    }
  })

  const teamMql = agents.reduce((s, a) => s + a.mql, 0)
  const teamSql = agents.reduce((s, a) => s + a.sql, 0)
  const scored = agents.filter((a) => a.leads > 0)
  const topAgent = scored.length ? scored.reduce((b, a) => (a.leads > b.leads ? a : b)) : null
  return {
    department: 'LEAD_GEN',
    month,
    monthLabel,
    team: {
      agents: agents.length,
      leads: agents.reduce((s, a) => s + a.leads, 0),
      mql: teamMql,
      sql: teamSql,
      mqlToSqlRate: teamMql ? round1((teamSql / teamMql) * 100) : null,
    },
    topVerticals: [...vertTotals.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 8),
    topAgent: topAgent ? { name: topAgent.name, leads: topAgent.leads } : null,
    agents,
  }
}

// ============================ dispatcher ============================

export type MonthlyReport = ItadReport | LeadGenReport
export async function buildMonthlyReport(departmentType: 'ITAD' | 'LEAD_GEN', month: string): Promise<MonthlyReport | null> {
  return departmentType === 'ITAD' ? buildItadReport(month) : buildLeadGenReport(month)
}

// ============================ Bid Tracker (ITAD) ============================

export interface BidTotals {
  total: number
  active: number
  submitted: number
  won: number
  lost: number
  wonValue: number
  quotedValue: number
  winRate: number // won ÷ (won + lost), 0..1
}
export interface BidReport {
  month: string
  monthLabel: string
  team: BidTotals
  prev: BidTotals | null
  deltas: { total: number; won: number; wonValue: number; winRate: number }
  topAgent: { name: string; won: number; wonValue: number } | null
}

/** Bids bucketed by dueDate (the bid's key date) within the month, ITAD department. */
async function bidTotals(deptId: string, month: string) {
  const { start, end } = monthBounds(month)
  const bids = await prisma.bid.findMany({
    where: { departmentId: deptId, dueDate: { gte: start.toJSDate(), lte: end.toJSDate() } },
    select: { status: true, awardedPrice: true, priceQuoted: true, agent: { select: { id: true, name: true } } },
  })
  const count = (s: string) => bids.filter((b) => b.status === s).length
  const won = count('WON')
  const lost = count('LOST')
  const byAgent = new Map<string, { name: string; won: number; wonValue: number }>()
  for (const b of bids) {
    if (b.status !== 'WON') continue
    const cur = byAgent.get(b.agent.id) ?? { name: b.agent.name, won: 0, wonValue: 0 }
    cur.won++
    cur.wonValue += b.awardedPrice ?? 0
    byAgent.set(b.agent.id, cur)
  }
  const totals: BidTotals = {
    total: bids.length,
    active: count('ACTIVE'),
    submitted: count('SUBMITTED'),
    won,
    lost,
    wonValue: bids.filter((b) => b.status === 'WON').reduce((s, b) => s + (b.awardedPrice ?? 0), 0),
    quotedValue: bids.reduce((s, b) => s + (b.priceQuoted ?? 0), 0),
    winRate: rate(won, won + lost),
  }
  return { totals, byAgent }
}

export async function buildBidReport(month: string): Promise<BidReport | null> {
  const dept = await prisma.department.findUnique({ where: { type: 'ITAD' } })
  if (!dept) return null
  const { monthLabel } = monthBounds(month)
  const cur = await bidTotals(dept.id, month)
  const p = await bidTotals(dept.id, prevMonthStr(month))
  const top = [...cur.byAgent.values()].sort((a, b) => b.wonValue - a.wonValue)[0] ?? null
  return {
    month,
    monthLabel,
    team: cur.totals,
    prev: p.totals.total > 0 ? p.totals : null,
    deltas: {
      total: periodDelta(cur.totals.total, p.totals.total),
      won: periodDelta(cur.totals.won, p.totals.won),
      wonValue: periodDelta(cur.totals.wonValue, p.totals.wonValue),
      winRate: periodDelta(cur.totals.winRate, p.totals.winRate),
    },
    topAgent: top,
  }
}

// ============================ Marketing ============================

export interface MarketingTotals {
  followers: number
  newFollowers: number
  impressions: number
  engagementRate: number // impressions-weighted %, e.g. 21.4
  blogs: number
  contentPublished: number // kanban tasks that reached PUBLISHED this month
  planDone: number
  planTotal: number
}
export interface MarketingReport {
  month: string
  monthLabel: string
  brands: number
  team: MarketingTotals
  prev: Pick<MarketingTotals, 'followers' | 'newFollowers' | 'impressions' | 'engagementRate' | 'blogs' | 'contentPublished'> | null
  deltas: { followers: number; newFollowers: number; impressions: number; engagementRate: number; blogs: number; contentPublished: number }
  topBrandByFollowers: { name: string; followers: number } | null
}

/** Impressions-weighted engagement rate (falls back to a simple mean of non-zero rows). */
function weightedER(rows: { impressions: number; engagementRate: number }[]): number {
  const impr = rows.reduce((a, r) => a + r.impressions, 0)
  if (impr > 0) return round1(rows.reduce((a, r) => a + r.impressions * r.engagementRate, 0) / impr)
  const nz = rows.filter((r) => r.engagementRate > 0)
  return nz.length ? round1(nz.reduce((a, r) => a + r.engagementRate, 0) / nz.length) : 0
}

async function marketingSocialTotals(brandIds: string[], month: string) {
  if (!brandIds.length) return { followers: 0, newFollowers: 0, impressions: 0, engagementRate: 0 }
  const rows = await prisma.brandSocialMonthly.findMany({
    where: { brandId: { in: brandIds }, month },
    select: { impressions: true, engagementRate: true, followers: true, newFollowers: true },
  })
  return {
    followers: rows.reduce((a, r) => a + r.followers, 0),
    newFollowers: rows.reduce((a, r) => a + r.newFollowers, 0),
    impressions: rows.reduce((a, r) => a + r.impressions, 0),
    engagementRate: weightedER(rows),
  }
}

export async function buildMarketingReport(month: string): Promise<MarketingReport | null> {
  const dept = await prisma.department.findUnique({ where: { type: 'MARKETING' } })
  if (!dept) return null
  const { start, end, monthLabel } = monthBounds(month)
  const prevM = prevMonthStr(month)
  const prevB = monthBounds(prevM)
  const brands = await prisma.brand.findMany({ where: { departmentId: dept.id, isActive: true }, select: { id: true, name: true } })
  const brandIds = brands.map((b) => b.id)

  const [social, socialPrev, blogs, blogsPrev, kanban, kanbanPrev, plans, byBrand] = await Promise.all([
    marketingSocialTotals(brandIds, month),
    marketingSocialTotals(brandIds, prevM),
    prisma.blogPost.count({ where: { brandId: { in: brandIds }, month } }),
    prisma.blogPost.count({ where: { brandId: { in: brandIds }, month: prevM } }),
    prisma.marketingTask.count({ where: { completedAt: { gte: start.toJSDate(), lte: end.toJSDate() } } }),
    prisma.marketingTask.count({ where: { completedAt: { gte: prevB.start.toJSDate(), lte: prevB.end.toJSDate() } } }),
    prisma.marketingPlan.findMany({ where: { month }, select: { items: { select: { status: true } } } }),
    brandIds.length
      ? prisma.brandSocialMonthly.groupBy({ by: ['brandId'], where: { brandId: { in: brandIds }, month }, _sum: { followers: true } })
      : Promise.resolve([] as { brandId: string; _sum: { followers: number | null } }[]),
  ])
  const planItems = plans.flatMap((p) => p.items)
  const team: MarketingTotals = {
    ...social,
    blogs,
    contentPublished: kanban,
    planDone: planItems.filter((i) => i.status === 'COMPLETED').length,
    planTotal: planItems.length,
  }
  const topB = byBrand.map((g) => ({ id: g.brandId, followers: g._sum.followers ?? 0 })).sort((a, b) => b.followers - a.followers)[0]
  const hasPrev = socialPrev.impressions > 0 || socialPrev.followers > 0 || blogsPrev > 0 || kanbanPrev > 0
  return {
    month,
    monthLabel,
    brands: brands.length,
    team,
    prev: hasPrev
      ? { followers: socialPrev.followers, newFollowers: socialPrev.newFollowers, impressions: socialPrev.impressions, engagementRate: socialPrev.engagementRate, blogs: blogsPrev, contentPublished: kanbanPrev }
      : null,
    deltas: {
      followers: periodDelta(team.followers, socialPrev.followers),
      newFollowers: periodDelta(team.newFollowers, socialPrev.newFollowers),
      impressions: periodDelta(team.impressions, socialPrev.impressions),
      engagementRate: periodDelta(team.engagementRate, socialPrev.engagementRate),
      blogs: periodDelta(team.blogs, blogsPrev),
      contentPublished: periodDelta(team.contentPublished, kanbanPrev),
    },
    topBrandByFollowers: topB ? { name: brands.find((b) => b.id === topB.id)?.name ?? '—', followers: topB.followers } : null,
  }
}

// ============================ Consolidated management report ============================

export interface ManagementReport {
  month: string
  monthLabel: string
  itad: ItadReport | null
  bids: BidReport | null
  marketing: MarketingReport | null
}

export async function buildManagementReport(month: string): Promise<ManagementReport> {
  const [itad, bids, marketing] = await Promise.all([buildItadReport(month), buildBidReport(month), buildMarketingReport(month)])
  return { month, monthLabel: monthBounds(month).monthLabel, itad, bids, marketing }
}
