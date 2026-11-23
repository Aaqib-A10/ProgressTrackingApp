import { DateTime } from 'luxon'
import type { Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { maybeCompanyId } from '../tenancy'
import { isOn } from '../flags'
import { companyTz } from '../time'
import { openStatusesOf } from '../leads/pipeline'

/**
 * Alerts nobody asked for (plan 2026-11, 3.3). Metra looks at the company's own records once a day and tells the
 * right person when something needs them: a deal nobody touched, a deal due in two days and not sent, a lead gone
 * quiet, a person with too much overdue work, a weekly number that fell. Every alert is worked out from facts in
 * Metriq (no model), and is told once a week at most for the same thing.
 */

export type AlertType = 'STALE_DEAL' | 'DEAL_DUE' | 'STALE_LEAD' | 'OVERLOADED' | 'NUMBER_MOVED'

export interface MetraAlert {
  userId: string
  type: AlertType
  /** What it is about (a deal, a lead, a person, a number): with the week, it makes the alert happen once. */
  subjectId: string
  title: string
  body: string
  link: string
}

export const ALERT_RULES = {
  /** A deal still open with no change for this many days. */
  staleDealDays: 14,
  /** A deal due within this many hours that is still not submitted. */
  dealDueHours: 48,
  /** An open lead with no activity for this many days. */
  staleLeadDays: 7,
  /** A person with at least this many overdue tasks. */
  overdueTasks: 5,
  /** A weekly number that fell by at least this share, when last week had at least `minBase`. */
  drop: 0.4,
  minBase: 10,
}

const days = (n: number) => n * 86400_000
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const ago = (d: Date, now: Date) => plural(Math.max(1, Math.floor((now.getTime() - d.getTime()) / days(1))), 'day')

/** The people who look after `user`: the leads of their department, or the company's admins. */
async function leadsOf(user: { id: string; role: string; departmentId: string | null }): Promise<string[]> {
  if (user.role !== 'TEAM_LEAD' && user.role !== 'SUPER_ADMIN' && user.departmentId) {
    const leads = await prisma.user.findMany({ where: { role: 'TEAM_LEAD', departmentId: user.departmentId, isActive: true, status: 'ACTIVE', id: { not: user.id } }, select: { id: true } })
    if (leads.length) return leads.map((l) => l.id)
  }
  const admins = await prisma.user.findMany({ where: { role: 'SUPER_ADMIN', isActive: true, id: { not: user.id } }, select: { id: true } })
  return admins.map((a) => a.id)
}

/** Everything worth telling someone today, for the company this runs in. Nothing is saved here. */
export async function findAlerts(now = new Date()): Promise<MetraAlert[]> {
  const out: MetraAlert[] = []
  const R = ALERT_RULES

  // ---- deals: nobody touched it, or it is due and not sent
  const openDeals = await prisma.bid.findMany({
    where: { status: { in: ['ACTIVE', 'SUBMITTED'] }, agent: { isActive: true } },
    select: { id: true, number: true, title: true, company: true, status: true, dueDate: true, updatedAt: true, agentId: true },
  })
  for (const d of openDeals) {
    const name = `${d.title} (${d.company})`
    const hoursLeft = (d.dueDate.getTime() - now.getTime()) / 3600_000
    if (d.status === 'ACTIVE' && hoursLeft > 0 && hoursLeft <= R.dealDueHours) {
      out.push({ userId: d.agentId, type: 'DEAL_DUE', subjectId: d.id, title: `Deal due ${hoursLeft <= 24 ? 'within a day' : 'in two days'} and not submitted`, body: `${name} is still marked active. Submit it or change its date.`, link: DEALS_LINK })
    } else if (now.getTime() - d.updatedAt.getTime() >= days(R.staleDealDays)) {
      out.push({ userId: d.agentId, type: 'STALE_DEAL', subjectId: d.id, title: `No change on a deal for ${ago(d.updatedAt, now)}`, body: `${name} is ${d.status === 'ACTIVE' ? 'still active' : 'submitted, with no result recorded'}. Update it, or mark it won or lost.`, link: DEALS_LINK })
    }
  }

  // ---- leads: open, given to someone, and quiet
  const businesses = await prisma.leadBusiness.findMany({ select: { id: true, name: true, kind: true, pipeline: true } })
  for (const b of businesses) {
    const quiet = await prisma.lead.findMany({
      where: { businessId: b.id, status: { in: openStatusesOf(b) }, assigneeId: { not: null }, assignee: { isActive: true }, lastActivityAt: { lt: new Date(now.getTime() - days(R.staleLeadDays)) } },
      select: { id: true, name: true, organization: true, assigneeId: true, lastActivityAt: true },
      orderBy: { lastActivityAt: 'asc' },
      take: 200,
    })
    const byPerson = new Map<string, typeof quiet>()
    for (const l of quiet) byPerson.set(l.assigneeId!, [...(byPerson.get(l.assigneeId!) ?? []), l])
    for (const [userId, list] of byPerson) {
      const names = list.slice(0, 3).map((l) => l.organization || l.name || 'a lead').join(', ')
      out.push({ userId, type: 'STALE_LEAD', subjectId: b.id, title: `${plural(list.length, 'open lead')} with nothing logged for a week`, body: `${b.name}: ${names}${list.length > 3 ? ` and ${list.length - 3} more` : ''}. The quietest has waited ${ago(list[0].lastActivityAt, now)}.`, link: LEADS_LINK })
    }
  }

  // ---- people: too much overdue work (told to whoever looks after them)
  const overdue = await prisma.pmTaskAssignee.findMany({
    where: { task: { isOverdue: true, deletedAt: null, completedAt: null, column: { category: { not: 'DONE' } }, project: { status: 'ACTIVE' } }, user: { isActive: true } },
    select: { userId: true, user: { select: { id: true, name: true, role: true, departmentId: true } } },
  })
  const perPerson = new Map<string, { n: number; user: (typeof overdue)[number]['user'] }>()
  for (const a of overdue) perPerson.set(a.userId, { n: (perPerson.get(a.userId)?.n ?? 0) + 1, user: a.user })
  for (const { n, user } of perPerson.values()) {
    if (n < R.overdueTasks) continue
    for (const leadId of await leadsOf(user)) {
      out.push({ userId: leadId, type: 'OVERLOADED', subjectId: user.id, title: `${user.name} has ${n} overdue tasks`, body: 'That is more than one person usually clears in a week. Move some to someone else, or change the dates.', link: TASKS_LINK })
    }
  }

  // ---- numbers that fell this week against the week before (told to the admins)
  const a = new Date(now.getTime() - days(7))
  const b = new Date(now.getTime() - days(14))
  const [doneNow, doneBefore, leadsNow, leadsBefore] = await Promise.all([
    prisma.pmTask.count({ where: { completedAt: { gte: a, lt: now }, deletedAt: null } }),
    prisma.pmTask.count({ where: { completedAt: { gte: b, lt: a }, deletedAt: null } }),
    prisma.lead.count({ where: { createdAt: { gte: a, lt: now } } }),
    prisma.lead.count({ where: { createdAt: { gte: b, lt: a } } }),
  ])
  const moved: { key: string; what: string; now: number; before: number; link: string }[] = [
    { key: 'tasksDone', what: 'Tasks finished', now: doneNow, before: doneBefore, link: TASKS_LINK },
    { key: 'newLeads', what: 'New leads', now: leadsNow, before: leadsBefore, link: LEADS_LINK },
  ]
  const fell = moved.filter((m) => m.before >= R.minBase && (m.before - m.now) / m.before >= R.drop)
  if (fell.length) {
    const admins = await prisma.user.findMany({ where: { role: 'SUPER_ADMIN', isActive: true }, select: { id: true } })
    for (const m of fell) {
      const pct = Math.round(((m.before - m.now) / m.before) * 100)
      for (const ad of admins) out.push({ userId: ad.id, type: 'NUMBER_MOVED', subjectId: m.key, title: `${m.what} fell ${pct}% this week`, body: `${m.now} in the last 7 days, ${m.before} in the 7 days before.`, link: m.link })
    }
  }
  return out
}

/** Where each alert opens. */
const DEALS_LINK = '/app/itad/bids'
const LEADS_LINK = '/app/leads'
const TASKS_LINK = '/app/projects'

/** The Monday of the week, on the company's clock: an alert about the same thing is told once a week. */
export const alertWeek = (now = new Date()) => DateTime.fromJSDate(now).setZone(companyTz()).startOf('week').toISODate()!

/**
 * Work out today's alerts and tell each person: one row in "What Metra noticed" and one notification. Returns how
 * many were new. Safe to run again: the same alert in the same week is not told twice.
 */
export async function runAlerts(now = new Date()): Promise<number> {
  const companyId = maybeCompanyId()
  if (!companyId || !(await isOn('metra', companyId)) || !(await isOn('metra-proactive', companyId))) return 0
  const week = alertWeek(now)
  let fresh = 0
  for (const al of await findAlerts(now)) {
    const subjectId = `${al.type}:${al.subjectId}`
    const key = { userId_kind_day_subjectId: { userId: al.userId, kind: 'ALERT', day: week, subjectId } }
    if (await prisma.aiInsight.findUnique({ where: key, select: { id: true } })) continue
    const payload = { type: al.type, text: al.body, link: al.link } as unknown as Prisma.InputJsonValue
    const row = await prisma.aiInsight.create({ data: { userId: al.userId, kind: 'ALERT', day: week, subjectId, title: al.title, payload } }).catch(() => null) // two runs at once: one wins
    if (!row) continue
    await prisma.notification.create({ data: { userId: al.userId, type: 'AI_INSIGHT', title: al.title, body: al.body.slice(0, 300), link: al.link, entityType: 'AiInsight', entityId: row.id } })
    fresh++
  }
  return fresh
}

/** The hour of the day (company clock) the alerts are worked out. */
export const alertHour = () => Number(process.env.METRA_ALERT_HOUR ?? 9)
export const isAlertHour = (now = new Date()) => DateTime.fromJSDate(now).setZone(companyTz()).hour === alertHour()
