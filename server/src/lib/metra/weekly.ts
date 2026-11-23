import { DateTime } from 'luxon'
import type { Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { maybeCompanyId } from '../tenancy'
import { isOn } from '../flags'
import { companyTz } from '../time'
import { sendWeeklySummaryEmail } from '../mail'
import { alertWeek } from './alerts'

/**
 * The weekly summary for the people who run a team (plan 2026-11, 3.4): every Monday morning, each team lead gets
 * their department's week and each admin gets the company's, in "What Metra noticed", in the bell and by email.
 * Worked out from Metriq's own records (no model), with last week beside each number.
 */

export interface WeekFacts {
  /** The seven days the summary covers (company clock), first and last day. */
  from: string
  to: string
  people: number
  checkIns: number
  checkInsBefore: number
  /** Active people with no check-in in the whole week (at most five names). */
  noCheckIn: string[]
  tasksDone: number
  tasksDoneBefore: number
  tasksOverdue: number
  newLeads: number
  newLeadsBefore: number
  dealsWon: number
  dealsLost: number
  wonMoney: number
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The week that just ended, for these people (a department's members, or everyone). */
export async function weekFacts(userIds: string[], wholeCompany: boolean, now = new Date()): Promise<WeekFacts> {
  const zone = companyTz()
  const end = DateTime.fromJSDate(now).setZone(zone).startOf('day')
  const start = end.minus({ days: 7 })
  const before = start.minus({ days: 7 })
  const [a, b, c] = [before.toJSDate(), start.toJSDate(), end.toJSDate()]
  // Attendance days are plain dates.
  const day = (d: DateTime) => new Date(`${d.toISODate()}T00:00:00.000Z`)
  const mine = { in: userIds }
  const [people, days, daysBefore, done, doneBefore, overdue, leads, leadsBefore, decided] = await Promise.all([
    prisma.user.findMany({ where: { id: mine, isActive: true }, select: { id: true, name: true } }),
    prisma.attendanceDay.findMany({ where: { userId: mine, date: { gte: day(start), lt: day(end) }, checkInAt: { not: null } }, select: { userId: true } }),
    prisma.attendanceDay.count({ where: { userId: mine, date: { gte: day(before), lt: day(start) }, checkInAt: { not: null } } }),
    prisma.pmTask.count({ where: { completedAt: { gte: b, lt: c }, deletedAt: null, assignees: { some: { userId: mine } } } }),
    prisma.pmTask.count({ where: { completedAt: { gte: a, lt: b }, deletedAt: null, assignees: { some: { userId: mine } } } }),
    prisma.pmTask.count({ where: { isOverdue: true, completedAt: null, deletedAt: null, column: { category: { not: 'DONE' } }, project: { status: 'ACTIVE' }, assignees: { some: { userId: mine } } } }),
    prisma.lead.count({ where: { createdAt: { gte: b, lt: c }, ...(wholeCompany ? {} : { assigneeId: mine }) } }),
    prisma.lead.count({ where: { createdAt: { gte: a, lt: b }, ...(wholeCompany ? {} : { assigneeId: mine }) } }),
    prisma.bid.findMany({ where: { agentId: mine, status: { in: ['WON', 'LOST', 'CONTRACT'] }, closedDate: { gte: b, lt: c } }, select: { status: true, totalAmount: true } }),
  ])
  const came = new Set(days.map((d) => d.userId))
  const won = decided.filter((d) => d.status !== 'LOST')
  return {
    from: start.toISODate()!,
    to: end.minus({ days: 1 }).toISODate()!,
    people: people.length,
    checkIns: days.length,
    checkInsBefore: daysBefore,
    // Only said when attendance is used at all: a company that never checks in is not told everyone was away.
    noCheckIn: days.length ? people.filter((p) => !came.has(p.id)).map((p) => p.name).slice(0, 5) : [],
    tasksDone: done,
    tasksDoneBefore: doneBefore,
    tasksOverdue: overdue,
    newLeads: leads,
    newLeadsBefore: leadsBefore,
    dealsWon: won.length,
    dealsLost: decided.length - won.length,
    wonMoney: won.reduce((s, d) => s + Number(d.totalAmount ?? 0), 0),
  }
}

/** The summary as plain lines; nothing to say gives no lines (and no summary is sent). */
export function weekLines(f: WeekFacts): string[] {
  const out: string[] = []
  if (f.checkIns || f.checkInsBefore) out.push(`Attendance: ${plural(f.checkIns, 'check-in')} by ${plural(f.people, 'person', 'people')} (${f.checkInsBefore} the week before).${f.noCheckIn.length ? ` No check-in all week: ${f.noCheckIn.join(', ')}.` : ''}`)
  if (f.tasksDone || f.tasksDoneBefore || f.tasksOverdue) out.push(`Tasks: ${f.tasksDone} finished (${f.tasksDoneBefore} the week before)${f.tasksOverdue ? `, ${f.tasksOverdue} overdue now` : ''}.`)
  if (f.newLeads || f.newLeadsBefore) out.push(`Leads: ${f.newLeads} new (${f.newLeadsBefore} the week before).`)
  if (f.dealsWon || f.dealsLost) out.push(`Deals: ${f.dealsWon} won${f.wonMoney ? ` worth ${money(f.wonMoney)}` : ''}, ${f.dealsLost} lost.`)
  return out
}

const nice = (iso: string) => DateTime.fromISO(iso).toFormat('LLL d')

/** Make this week's summary for every team lead and admin of the company. Safe to run again in the same week. */
export async function runWeekly(now = new Date()): Promise<number> {
  const companyId = maybeCompanyId()
  if (!companyId || !(await isOn('metra', companyId)) || !(await isOn('metra-proactive', companyId))) return 0
  const week = alertWeek(now)
  const leads = await prisma.user.findMany({ where: { role: { in: ['TEAM_LEAD', 'SUPER_ADMIN'] }, isActive: true, status: 'ACTIVE' }, select: { id: true, name: true, email: true, role: true, departmentId: true, notifyMuted: true } })
  let sent = 0
  for (const lead of leads) {
    const key = { userId_kind_day_subjectId: { userId: lead.id, kind: 'WEEKLY', day: week, subjectId: '' } }
    if (await prisma.aiInsight.findUnique({ where: key, select: { id: true } })) continue
    const whole = lead.role === 'SUPER_ADMIN'
    if (!whole && !lead.departmentId) continue
    const team = await prisma.user.findMany({ where: { isActive: true, ...(whole ? {} : { departmentId: lead.departmentId }) }, select: { id: true } })
    const facts = await weekFacts(team.map((t) => t.id), whole, now)
    const lines = weekLines(facts)
    if (!lines.length) continue
    const title = `${whole ? 'The company' : 'Your team'}: week of ${nice(facts.from)} to ${nice(facts.to)}`
    const text = lines.map((l) => `- ${l}`).join('\n')
    const row = await prisma.aiInsight.create({ data: { userId: lead.id, kind: 'WEEKLY', day: week, title, payload: { text, facts } as unknown as Prisma.InputJsonValue } }).catch(() => null) // two runs at once: one wins
    if (!row) continue
    await prisma.notification.create({ data: { userId: lead.id, type: 'AI_INSIGHT', title: 'Your weekly summary from Metra', body: lines.join(' ').slice(0, 300), link: `/app/metra?insight=${row.id}`, entityType: 'AiInsight', entityId: row.id } })
    // People who muted AI insights still find it in Metra; they are not emailed.
    if (!lead.notifyMuted.includes('ai')) void sendWeeklySummaryEmail({ to: lead.email, name: lead.name, title, lines }).catch(() => undefined)
    sent++
  }
  return sent
}

/** Monday, at the hour the alerts run. */
export const isWeeklyTime = (now = new Date(), hour = Number(process.env.METRA_ALERT_HOUR ?? 9)) => {
  const t = DateTime.fromJSDate(now).setZone(companyTz())
  return t.weekday === 1 && t.hour === hour
}
