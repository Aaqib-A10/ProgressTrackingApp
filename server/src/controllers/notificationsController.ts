import type { Response } from 'express'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { companyToday, dbDateFromString } from '../lib/time'
import { countUnreadFeedback } from './feedbackController'
import { z } from 'zod'
import type { NotificationType } from '@prisma/client'
import { NOTIFY_CATEGORIES, NOTIFY_CATEGORY_KEYS, categoryOf, categoryOfDerived, isNotifyCategory, leadStatusRank, typesOf, type NotifyCategory } from '../lib/notifyCategories'

type Notif = {
  id: string
  type: 'reminder' | 'alert' | 'info'
  title: string
  body: string
  date: string
  link?: string
  persistent?: boolean
  /** The tab it belongs to (lib/notifyCategories). */
  category: NotifyCategory
  /** A Lead Dialer follow-up: the lead's status (Pipeline, Interested, Connected, …). */
  leadStatus?: string | null
}

/** A person's muted categories, only the ones that still exist. */
function cleanMuted(muted: string[] | null | undefined): NotifyCategory[] {
  return (muted ?? []).filter(isNotifyCategory)
}

/**
 * Lead Dialer follow-up notifications point at the follow-up (entityType 'DialerTask', entityId =
 * the To-Do entry); the lead's status ranks them (Pipeline first). One query for the whole list.
 */
async function dialerLeadStatuses(rows: { entityType: string | null; entityId: string | null }[]): Promise<Map<string, string | null>> {
  const ids = [...new Set(rows.filter((r) => r.entityType === 'DialerTask' && r.entityId).map((r) => r.entityId!))]
  if (!ids.length) return new Map()
  const tasks = await prisma.workLogEntry.findMany({ where: { id: { in: ids } }, select: { id: true, dialerLead: { select: { status: true, statusHere: true } } } })
  return new Map(tasks.map((t) => [t.id, t.dialerLead ? t.dialerLead.statusHere ?? t.dialerLead.status : null]))
}

/** Has the user submitted today for their department/sub-department? */
async function submittedToday(userId: string, dept?: string | null, sub?: string | null): Promise<boolean> {
  const date = dbDateFromString(companyToday())
  const key = { userId_date: { userId, date } }
  if (dept === 'ITAD') return !!(await prisma.itadDailyEntry.findUnique({ where: key }))
  if (dept === 'LEAD_GEN') return !!(await prisma.leadGenDailyEntry.findUnique({ where: key }))
  if (dept === 'MARKETING' && sub === 'seo') return !!(await prisma.seoDailyEntry.findUnique({ where: key }))
  if (dept === 'MARKETING' && sub === 'content') return !!(await prisma.contentDailyEntry.findUnique({ where: key }))
  if (dept === 'ECOMMERCE') return !!(await prisma.ecommerceDailyEntry.findUnique({ where: key }))
  return true // no daily form for this user → nothing to remind
}

/** Does this member's dept/sub have a daily form to submit? Mirrors submittedToday's coverage. */
function hasDailyForm(dept?: string | null, sub?: string | null): boolean {
  return dept === 'ITAD' || dept === 'LEAD_GEN' || dept === 'ECOMMERCE' || (dept === 'MARKETING' && (sub === 'seo' || sub === 'content'))
}

/**
 * Batched version of submittedToday for many members — the set of userIds (among
 * `ids`) that submitted today, in a fixed number of queries instead of one per
 * member (avoids an N+1 on every TL/Super-Admin dashboard + bell poll).
 */
async function submittedTodayIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const where = { userId: { in: ids }, date: dbDateFromString(companyToday()) }
  const select = { userId: true }
  const [itad, leadgen, seo, ecom] = await Promise.all([
    prisma.itadDailyEntry.findMany({ where, select }),
    prisma.leadGenDailyEntry.findMany({ where, select }),
    prisma.seoDailyEntry.findMany({ where, select }),
    prisma.ecommerceDailyEntry.findMany({ where, select }),
  ])
  const content = await prisma.contentDailyEntry.findMany({ where, select })
  return new Set([...itad, ...leadgen, ...seo, ...ecom, ...content].map((e) => e.userId))
}

/** GET /api/notifications — contextual notifications derived from live state. */
export async function getNotifications(req: AuthedRequest, res: Response): Promise<void> {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, include: { department: true, subDepartment: true } })
  const today = companyToday()
  const dept = me.department?.type ?? null
  const sub = me.subDepartment?.slug ?? null
  const notifications: Notif[] = []

  const isLead = me.role === 'TEAM_LEAD'
  const deptType = me.department?.type
  const none = Promise.resolve(0)
  // Every check below is independent: run them together (this endpoint is polled by every open tab).
  const [mentions, needsLog, missing, unreadFeedback, unreadQa, coaching, pending, mine] = await Promise.all([
    // Delivered @mention / task notifications (unread), most recent first.
    prisma.notification.findMany({ where: { userId: me.id, readAt: null }, orderBy: { createdAt: 'desc' }, take: 20 }),
    // Member reminder: haven't logged today.
    me.role === 'MEMBER' && dept ? submittedToday(me.id, dept, sub).then((done) => !done) : Promise.resolve(false),
    // TL/Admin: members who haven't submitted today.
    (isLead || me.role === 'SUPER_ADMIN') && (dept === 'ITAD' || dept === 'LEAD_GEN' || dept === 'ECOMMERCE' || me.role === 'SUPER_ADMIN')
      ? (async () => {
        const deptFilter = me.role === 'SUPER_ADMIN' ? {} : { departmentId: me.departmentId ?? '__none__' }
        const members = await prisma.user.findMany({ where: { role: 'MEMBER', isActive: true, ...deptFilter }, select: { id: true, department: { select: { type: true } }, subDepartment: { select: { slug: true } } } })
        const submitted = await submittedTodayIds(members.map((m) => m.id))
        return members.filter((m) => hasDailyForm(m.department?.type, m.subDepartment?.slug) && !submitted.has(m.id)).length
      })()
      : none,
    // Unread feedback (members receiving and leads getting replies).
    countUnreadFeedback(me.id),
    // QA: agent has new evaluations to read.
    prisma.qaEvaluation.count({ where: { agentId: me.id, status: 'SUBMITTED', agentReadAt: null } }),
    // ITAD/CSR Team Lead: team members below target need coaching.
    isLead && me.departmentId && (deptType === 'ITAD' || deptType === 'CSR')
      ? prisma.qaEvaluation.count({ where: { departmentId: me.departmentId, status: 'SUBMITTED', coachingNeeded: true, agentAcknowledgedAt: null } })
      : none,
    // Ecommerce HOD: out-of-stock requests awaiting assignment.
    isLead && me.departmentId && deptType === 'ECOMMERCE' ? prisma.stockRequest.count({ where: { departmentId: me.departmentId, status: 'REQUESTED' } }) : none,
    // Ecommerce agent: stock tasks assigned to me.
    deptType === 'ECOMMERCE' ? prisma.stockRequest.count({ where: { assignedToId: me.id, status: 'ASSIGNED' } }) : none,
  ])

  // Lead Dialer follow-ups first, by lead value (Pipeline, Interested, Connected); then newest first.
  const statuses = await dialerLeadStatuses(mentions)
  const stored = mentions.map((m, i) => ({ m, i, leadStatus: m.entityType === 'DialerTask' && m.entityId ? statuses.get(m.entityId) ?? null : undefined }))
  stored.sort((a, b) => (a.leadStatus === undefined ? 99 : leadStatusRank(a.leadStatus)) - (b.leadStatus === undefined ? 99 : leadStatusRank(b.leadStatus)) || a.i - b.i)
  for (const { m, leadStatus } of stored) {
    notifications.push({
      id: m.id,
      type: m.type === 'TASK_OVERDUE' ? 'alert' : m.type === 'TASK_DUE_SOON' || m.type === 'EXTENSION_REQUESTED' ? 'reminder' : 'info',
      title: m.title,
      body: m.body,
      date: m.createdAt.toISOString().slice(0, 10),
      link: m.link ?? undefined,
      persistent: true,
      category: categoryOf(m.type),
      ...(leadStatus !== undefined ? { leadStatus } : {}),
    })
  }
  const derived = (n: Omit<Notif, 'category'>) => notifications.push({ ...n, category: categoryOfDerived(n.id) })
  if (needsLog) derived({ id: 'reminder-today', type: 'reminder', title: "Don't forget today's log", body: 'You haven’t submitted your progress for today yet.', date: today })
  if (missing > 0) derived({ id: 'team-missing', type: 'alert', title: `${missing} not submitted`, body: `${missing} team member${missing > 1 ? 's haven’t' : ' hasn’t'} submitted today.`, date: today })
  if (unreadFeedback > 0) derived({ id: 'feedback-unread', type: 'info', title: 'New feedback', body: `You have ${unreadFeedback} unread feedback message${unreadFeedback > 1 ? 's' : ''}.`, date: today })
  if (unreadQa > 0) derived({ id: 'qa-unread', type: 'info', title: 'QA review completed', body: `You have ${unreadQa} new QA evaluation${unreadQa > 1 ? 's' : ''}.`, date: today })
  if (coaching > 0) derived({ id: 'qa-coaching', type: 'alert', title: 'Coaching needed', body: `${coaching} QA evaluation${coaching > 1 ? 's' : ''} below target in your team.`, date: today })
  if (pending > 0) derived({ id: 'stock-requests', type: 'alert', title: `${pending} stock request${pending > 1 ? 's' : ''}`, body: `${pending} out-of-stock item${pending > 1 ? 's need' : ' needs'} assignment.`, date: today })
  if (mine > 0) derived({ id: 'stock-assigned', type: 'info', title: 'Stock task assigned', body: `You have ${mine} stock task${mine > 1 ? 's' : ''} to action.`, date: today })

  // Informational.
  derived({ id: 'welcome', type: 'info', title: 'Reports update live', body: 'Team totals and dashboards refresh as people submit.', date: today })

  // Muted categories are still listed, but not counted in the badge.
  const muted = cleanMuted(me.notifyMuted)
  res.json({ notifications, unread: notifications.filter((n) => !muted.includes(n.category)).length, muted })
}

const DEPT_LABEL: Record<string, string> = { ITAD: 'ITAD', LEAD_GEN: 'Lead Generation', MARKETING: 'Marketing', ECOMMERCE: 'Ecommerce', TALKLOOP: 'Talkloop', CSR: 'CSR', INVENTORY: 'Inventory', CMR: 'CMR' }

/**
 * GET /api/notifications/not-submitted — members who haven't logged today,
 * grouped by department. TLs see only their own department; Super Admin sees all.
 */
export async function getNotSubmitted(req: AuthedRequest, res: Response): Promise<void> {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, include: { department: true } })
  const today = companyToday()

  if (me.role !== 'TEAM_LEAD' && me.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  const deptFilter = me.role === 'SUPER_ADMIN' ? {} : { departmentId: me.departmentId ?? '__none__' }
  const members = await prisma.user.findMany({
    where: { role: 'MEMBER', isActive: true, ...deptFilter },
    include: { department: true, subDepartment: true },
    orderBy: { name: 'asc' },
  })

  // Bucket missing members by department.
  const submitted = await submittedTodayIds(members.map((m) => m.id))
  const byDept = new Map<string, { department: string; label: string; members: { id: string; name: string; email: string; subDepartment: string | null }[] }>()
  for (const m of members) {
    if (!hasDailyForm(m.department?.type, m.subDepartment?.slug) || submitted.has(m.id)) continue
    const type = m.department?.type ?? 'UNASSIGNED'
    if (!byDept.has(type)) byDept.set(type, { department: type, label: DEPT_LABEL[type] ?? 'Unassigned', members: [] })
    byDept.get(type)!.members.push({ id: m.id, name: m.name, email: m.email, subDepartment: m.subDepartment?.name ?? null })
  }

  const groups = [...byDept.values()].sort((a, b) => a.label.localeCompare(b.label))
  const total = groups.reduce((n, g) => n + g.members.length, 0)
  res.json({ date: today, total, groups })
}

/** POST /api/notifications/:id/read — mark one of my delivered notifications read. */
export async function markNotificationRead(req: AuthedRequest, res: Response): Promise<void> {
  // Scope to the caller so nobody can read/clear another user's notifications.
  await prisma.notification.updateMany({
    where: { id: req.params.id, userId: req.user!.id, readAt: null },
    data: { readAt: new Date() },
  })
  res.status(204).end()
}

/** A `category` from the body or the query: undefined = none given, null = not a category. */
function categoryParam(req: AuthedRequest): NotifyCategory | null | undefined {
  const raw = (req.body as { category?: unknown } | undefined)?.category ?? req.query.category
  if (raw === undefined || raw === null || raw === '' || raw === 'all') return undefined
  return isNotifyCategory(raw) ? raw : null
}

/** POST /api/notifications/read-all { category? } — clear my stored notifications (of one tab, if given). */
export async function markAllNotificationsRead(req: AuthedRequest, res: Response): Promise<void> {
  const category = categoryParam(req)
  if (category === null) {
    res.status(400).json({ error: 'Unknown category' })
    return
  }
  const typeFilter = category ? { type: { in: typesOf(category) as NotificationType[] } } : {}
  const r = await prisma.notification.updateMany({ where: { userId: req.user!.id, readAt: null, ...typeFilter }, data: { readAt: new Date() } })
  res.json({ cleared: r.count })
}

/** GET /api/notifications/muted — my muted categories, and every category (in tab order). */
export async function getMutedCategories(req: AuthedRequest, res: Response): Promise<void> {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { notifyMuted: true } })
  res.json({ muted: cleanMuted(me.notifyMuted), categories: NOTIFY_CATEGORIES })
}

const mutedSchema = z.object({ muted: z.array(z.enum(NOTIFY_CATEGORY_KEYS as [NotifyCategory, ...NotifyCategory[]])).max(NOTIFY_CATEGORY_KEYS.length) })

/** PUT /api/notifications/muted { muted: ['system', …] } — no pop-up or phone push for these; not in the badge. */
export async function saveMutedCategories(req: AuthedRequest, res: Response): Promise<void> {
  const parsed = mutedSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const muted = NOTIFY_CATEGORY_KEYS.filter((k) => parsed.data.muted.includes(k))
  await prisma.user.update({ where: { id: req.user!.id }, data: { notifyMuted: muted } })
  res.json({ muted, categories: NOTIFY_CATEGORIES })
}

/** GET /api/notifications/history?cursor=&category= — my stored notifications, newest first (read + unread). */
export async function getNotificationHistory(req: AuthedRequest, res: Response): Promise<void> {
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null
  const category = categoryParam(req)
  if (category === null) {
    res.status(400).json({ error: 'Unknown category' })
    return
  }
  const rows = await prisma.notification.findMany({
    where: { userId: req.user!.id, ...(category ? { type: { in: typesOf(category) as NotificationType[] } } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 51,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { actor: { select: { name: true } } },
  })
  const hasMore = rows.length > 50
  const page = rows.slice(0, 50)
  const statuses = await dialerLeadStatuses(page)
  res.json({
    notifications: page.map((n) => ({
      id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, actorName: n.actor?.name ?? null, readAt: n.readAt?.toISOString() ?? null, createdAt: n.createdAt.toISOString(),
      category: categoryOf(n.type),
      ...(n.entityType === 'DialerTask' && n.entityId ? { leadStatus: statuses.get(n.entityId) ?? null } : {}),
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  })
}
