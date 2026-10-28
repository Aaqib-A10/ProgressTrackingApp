import { DateTime } from 'luxon'
import type { DepartmentType } from '@prisma/client'
import { prisma } from './prisma'
import { dbDateFromString } from './time'
import { timeIn } from './deptDashboards'

/**
 * Top Achiever of the month, one per department, each judged on what that department does:
 * QA score for ITAD and CSR (the departments QA scores), and the department's main daily
 * number for the rest. Nobody is shown for a department with no real activity.
 */

export const QA_MIN_EVALS = 3
export const QA_MIN_SCORE = 80

export interface TopAchiever {
  department: DepartmentType
  label: string
  /** What the winner is judged on, e.g. "by QA score · 80%+ benchmark". */
  basis: string
  winner: { name: string; value: number; display: string } | null
  /** Why there is no winner (shown instead). */
  note?: string
}

const LABEL: Record<DepartmentType, string> = {
  ITAD: 'ITAD', LEAD_GEN: 'Lead Generation', MARKETING: 'Marketing', CSR: 'CSR', ECOMMERCE: 'Ecommerce', TALKLOOP: 'Talkloop', INVENTORY: 'Inventory', GENERAL: 'General',
}

function monthRange(month: string) {
  const start = DateTime.fromISO(`${month}-01`, { zone: 'utc' }).startOf('month')
  const startDate = start.toISODate()!
  const endDate = start.endOf('month').toISODate()!
  return { startDate, endDate, dates: { gte: dbDateFromString(startDate), lte: dbDateFromString(endDate) } }
}

/** Highest total, ignoring zeros. */
function best(totals: Map<string, number>): { id: string; value: number } | null {
  let top: { id: string; value: number } | null = null
  for (const [id, value] of totals) if (value > 0 && (!top || value > top.value)) top = { id, value }
  return top
}

function add(m: Map<string, number>, id: string | null | undefined, v: number) {
  if (id) m.set(id, (m.get(id) ?? 0) + v)
}

async function qaWinner(deptId: string, month: string): Promise<Pick<TopAchiever, 'winner' | 'note'>> {
  const r = monthRange(month)
  const evals = await prisma.qaEvaluation.findMany({
    where: { departmentId: deptId, status: 'SUBMITTED', createdAt: timeIn(r) },
    select: { agentId: true, totalScore: true, agent: { select: { name: true } } },
  })
  const per = new Map<string, { name: string; scores: number[] }>()
  for (const e of evals) {
    const a = per.get(e.agentId) ?? { name: e.agent.name, scores: [] }
    a.scores.push(e.totalScore)
    per.set(e.agentId, a)
  }
  let top: { name: string; avg: number } | null = null
  for (const a of per.values()) {
    if (a.scores.length < QA_MIN_EVALS) continue
    const avg = Math.round((a.scores.reduce((s, x) => s + x, 0) / a.scores.length) * 10) / 10
    if (!top || avg > top.avg) top = { name: a.name, avg }
  }
  if (!top) return { winner: null, note: 'Not enough evaluations yet' }
  if (top.avg < QA_MIN_SCORE) return { winner: null, note: `No top achiever: best was ${top.avg}%, below the ${QA_MIN_SCORE}% benchmark` }
  return { winner: { name: top.name, value: top.avg, display: `${top.avg}%` } }
}

/** Totals per person for one department's main number this month. */
async function activityTotals(type: DepartmentType, deptId: string, memberIds: string[], month: string): Promise<{ totals: Map<string, number>; unit: string; one: string } | null> {
  const r = monthRange(month)
  const totals = new Map<string, number>()
  const mine = { userId: { in: memberIds }, date: r.dates, status: 'SUBMITTED' as const }
  switch (type) {
    case 'LEAD_GEN': {
      for (const e of await prisma.leadGenDailyEntry.findMany({ where: mine, select: { userId: true, leadsGenerated: true } })) add(totals, e.userId, e.leadsGenerated)
      return { totals, unit: 'leads', one: 'lead' }
    }
    case 'ECOMMERCE': {
      for (const e of await prisma.ecommerceDailyEntry.findMany({ where: mine, select: { userId: true, lines: { select: { listings: true } } } })) add(totals, e.userId, e.lines.reduce((s, l) => s + l.listings, 0))
      return { totals, unit: 'listings', one: 'listing' }
    }
    case 'MARKETING': {
      for (const t of await prisma.marketingTask.findMany({ where: { status: 'PUBLISHED', completedAt: timeIn(r), assigneeId: { in: memberIds } }, select: { assigneeId: true } })) add(totals, t.assigneeId, 1)
      return { totals, unit: 'tasks published', one: 'task published' }
    }
    case 'INVENTORY': {
      for (const m of await prisma.inventoryMovement.findMany({ where: { item: { departmentId: deptId }, status: 'COMPLETED', resolvedAt: timeIn(r), assignedToId: { in: memberIds } }, select: { assignedToId: true } })) add(totals, m.assignedToId, 1)
      return { totals, unit: 'requests completed', one: 'request completed' }
    }
    default:
      return null
  }
}

const BASIS: Partial<Record<DepartmentType, string>> = {
  LEAD_GEN: 'by leads generated',
  ECOMMERCE: 'by listings',
  MARKETING: 'by tasks published',
  INVENTORY: 'by requests completed',
}

export async function topAchievers(month: string, all: DepartmentType[]): Promise<TopAchiever[]> {
  const types = all.filter((t) => t !== 'TALKLOOP') // removed Oct 2026
  if (!types.length) return []
  const depts = await prisma.department.findMany({ where: { type: { in: types } } })
  const one = async (type: DepartmentType): Promise<TopAchiever | null> => {
    const dept = depts.find((d) => d.type === type)
    const label = LABEL[type]
    if (!dept) return null
    if (type === 'ITAD' || type === 'CSR') {
      return { department: type, label, basis: `by QA score · ${QA_MIN_SCORE}%+ benchmark`, ...(await qaWinner(dept.id, month)) }
    }
    // The team, not its lead, competes.
    const members = await prisma.user.findMany({ where: { departmentId: dept.id, isActive: true, role: { in: ['MEMBER', 'SUB_DEPT_LEAD'] } }, select: { id: true, name: true } })
    const t = await activityTotals(type, dept.id, members.map((m) => m.id), month)
    const top = t ? best(t.totals) : null
    const name = top ? members.find((m) => m.id === top.id)?.name : undefined
    return {
      department: type,
      label,
      basis: BASIS[type] ?? '',
      winner: top && name && t ? { name, value: top.value, display: `${top.value.toLocaleString('en-US')} ${top.value === 1 ? t.one : t.unit}` } : null,
      ...(top ? {} : { note: 'No activity logged this month yet' }),
    }
  }
  return (await Promise.all(types.map(one))).filter((x): x is TopAchiever => !!x)
}
