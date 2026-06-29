// Monthly team report builders (pure data aggregation — used by the preview
// endpoint and the scheduled email). One builder per department in scope.
import { DateTime } from 'luxon'
import { prisma } from './prisma'
import { dbDateFromString } from './time'

function monthBounds(month: string) {
  const start = DateTime.fromISO(month + '-01', { zone: 'utc' }).startOf('month')
  const end = start.endOf('month')
  return { start, end, monthLabel: start.toFormat('LLLL yyyy'), weeks: Math.ceil(end.day / 7) }
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
export interface ItadReport {
  department: 'ITAD'
  month: string
  monthLabel: string
  weeks: number
  team: { agents: number; qaAvg: number | null; qaCount: number; callsDialed: number; connected: number; closed: number; rfqs: number }
  topAgent: { name: string; avg: number } | null
  agents: ItadAgentRow[]
}

export async function buildItadReport(month: string): Promise<ItadReport | null> {
  const dept = await prisma.department.findUnique({ where: { type: 'ITAD' } })
  if (!dept) return null
  const { start, end, monthLabel, weeks } = monthBounds(month)
  const members = await prisma.user.findMany({ where: { departmentId: dept.id, role: 'MEMBER', isActive: true }, orderBy: { name: 'asc' } })
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
  return {
    department: 'ITAD',
    month,
    monthLabel,
    weeks,
    team: {
      agents: agents.length,
      qaAvg: avg(evals.map((e) => e.totalScore)),
      qaCount: evals.length,
      callsDialed: agents.reduce((s, a) => s + a.callsDialed, 0),
      connected: agents.reduce((s, a) => s + a.connected, 0),
      closed: agents.reduce((s, a) => s + a.closed, 0),
      rfqs: agents.reduce((s, a) => s + a.rfqs, 0),
    },
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
  const members = await prisma.user.findMany({ where: { departmentId: dept.id, role: 'MEMBER', isActive: true }, orderBy: { name: 'asc' } })
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
