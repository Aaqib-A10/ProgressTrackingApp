import type { Response } from 'express'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { companyToday, dbDateFromString } from '../lib/time'
import { countUnreadFeedback } from './feedbackController'

type Notif = { id: string; type: 'reminder' | 'alert' | 'info'; title: string; body: string; date: string }

/** Has the user submitted today for their department/sub-department? */
async function submittedToday(userId: string, dept?: string | null, sub?: string | null): Promise<boolean> {
  const date = dbDateFromString(companyToday())
  const key = { userId_date: { userId, date } }
  if (dept === 'ITAD') return !!(await prisma.itadDailyEntry.findUnique({ where: key }))
  if (dept === 'LEAD_GEN') return !!(await prisma.leadGenDailyEntry.findUnique({ where: key }))
  if (dept === 'MARKETING' && sub === 'seo') return !!(await prisma.seoDailyEntry.findUnique({ where: key }))
  if (dept === 'MARKETING' && sub === 'social') return !!(await prisma.socialDailyEntry.findUnique({ where: key }))
  if (dept === 'ECOMMERCE') return !!(await prisma.ecommerceDailyEntry.findUnique({ where: key }))
  return true // no daily form for this user → nothing to remind
}

/** GET /api/notifications — contextual notifications derived from live state. */
export async function getNotifications(req: AuthedRequest, res: Response): Promise<void> {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, include: { department: true, subDepartment: true } })
  const today = companyToday()
  const dept = me.department?.type ?? null
  const sub = me.subDepartment?.slug ?? null
  const notifications: Notif[] = []

  // Member reminder: haven't logged today.
  if (me.role === 'MEMBER' && dept) {
    if (!(await submittedToday(me.id, dept, sub))) {
      notifications.push({ id: 'reminder-today', type: 'reminder', title: "Don't forget today's log", body: 'You haven’t submitted your progress for today yet.', date: today })
    }
  }

  // TL/Admin: members who haven't submitted today.
  if ((me.role === 'TEAM_LEAD' || me.role === 'SUPER_ADMIN') && (dept === 'ITAD' || dept === 'LEAD_GEN' || dept === 'ECOMMERCE' || me.role === 'SUPER_ADMIN')) {
    const deptFilter = me.role === 'SUPER_ADMIN' ? {} : { departmentId: me.departmentId }
    const members = await prisma.user.findMany({ where: { role: 'MEMBER', isActive: true, ...deptFilter }, include: { department: true, subDepartment: true } })
    let missing = 0
    for (const m of members) if (!(await submittedToday(m.id, m.department?.type, m.subDepartment?.slug))) missing++
    if (missing > 0) {
      notifications.push({ id: 'team-missing', type: 'alert', title: `${missing} not submitted`, body: `${missing} team member${missing > 1 ? 's haven’t' : ' hasn’t'} submitted today.`, date: today })
    }
  }

  // Unread feedback (works for both members receiving and leads getting replies).
  const unreadFeedback = await countUnreadFeedback(me.id)
  if (unreadFeedback > 0) {
    notifications.push({
      id: 'feedback-unread',
      type: 'info',
      title: 'New feedback',
      body: `You have ${unreadFeedback} unread feedback message${unreadFeedback > 1 ? 's' : ''}.`,
      date: today,
    })
  }

  // QA: agent has new evaluations to read.
  const unreadQa = await prisma.qaEvaluation.count({ where: { agentId: me.id, status: 'SUBMITTED', agentReadAt: null } })
  if (unreadQa > 0) {
    notifications.push({ id: 'qa-unread', type: 'info', title: 'QA review completed', body: `You have ${unreadQa} new QA evaluation${unreadQa > 1 ? 's' : ''}.`, date: today })
  }

  // Manager (ITAD/CSR Team Lead): team members below target need coaching.
  if (me.role === 'TEAM_LEAD' && me.departmentId && (me.department?.type === 'ITAD' || me.department?.type === 'CSR')) {
    const coaching = await prisma.qaEvaluation.count({ where: { departmentId: me.departmentId, status: 'SUBMITTED', coachingNeeded: true, agentAcknowledgedAt: null } })
    if (coaching > 0) {
      notifications.push({ id: 'qa-coaching', type: 'alert', title: 'Coaching needed', body: `${coaching} QA evaluation${coaching > 1 ? 's' : ''} below target in your team.`, date: today })
    }
  }

  // Ecommerce HOD: out-of-stock requests awaiting assignment.
  if (me.role === 'TEAM_LEAD' && me.departmentId && me.department?.type === 'ECOMMERCE') {
    const pending = await prisma.stockRequest.count({ where: { departmentId: me.departmentId, status: 'REQUESTED' } })
    if (pending > 0) {
      notifications.push({ id: 'stock-requests', type: 'alert', title: `${pending} stock request${pending > 1 ? 's' : ''}`, body: `${pending} out-of-stock item${pending > 1 ? 's need' : ' needs'} assignment.`, date: today })
    }
  }

  // Ecommerce agent: stock tasks assigned to me.
  if (me.department?.type === 'ECOMMERCE') {
    const mine = await prisma.stockRequest.count({ where: { assignedToId: me.id, status: 'ASSIGNED' } })
    if (mine > 0) {
      notifications.push({ id: 'stock-assigned', type: 'info', title: 'Stock task assigned', body: `You have ${mine} stock task${mine > 1 ? 's' : ''} to action.`, date: today })
    }
  }

  // Informational.
  notifications.push({ id: 'welcome', type: 'info', title: 'Reports update live', body: 'Team totals and dashboards refresh as people submit.', date: today })

  res.json({ notifications, unread: notifications.length })
}

const DEPT_LABEL: Record<string, string> = { ITAD: 'ITAD', LEAD_GEN: 'Lead Generation', MARKETING: 'Marketing' }

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

  const deptFilter = me.role === 'SUPER_ADMIN' ? {} : { departmentId: me.departmentId }
  const members = await prisma.user.findMany({
    where: { role: 'MEMBER', isActive: true, ...deptFilter },
    include: { department: true, subDepartment: true },
    orderBy: { name: 'asc' },
  })

  // Bucket missing members by department.
  const byDept = new Map<string, { department: string; label: string; members: { id: string; name: string; email: string; subDepartment: string | null }[] }>()
  for (const m of members) {
    if (await submittedToday(m.id, m.department?.type, m.subDepartment?.slug)) continue
    const type = m.department?.type ?? 'UNASSIGNED'
    if (!byDept.has(type)) byDept.set(type, { department: type, label: DEPT_LABEL[type] ?? 'Unassigned', members: [] })
    byDept.get(type)!.members.push({ id: m.id, name: m.name, email: m.email, subDepartment: m.subDepartment?.name ?? null })
  }

  const groups = [...byDept.values()].sort((a, b) => a.label.localeCompare(b.label))
  const total = groups.reduce((n, g) => n + g.members.length, 0)
  res.json({ date: today, total, groups })
}
