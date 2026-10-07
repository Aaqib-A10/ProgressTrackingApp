import cron from 'node-cron'
import { DateTime } from 'luxon'
import type { Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { COMPANY_TZ } from '../time'
import { logActivity } from './tasks'
import { fmtDue, fmtDuration, pmNotify, taskLink, trunc } from './pmNotify'

/**
 * Deadline watcher for project tasks (runs every 5 minutes).
 *
 *  1. Due soon: reminds assignees at each of the project's reminder offsets
 *     (default 24h and 1h before). Only the closest offset fires, so a task created
 *     45 minutes before its deadline gets one "due in 1 hour" alert, not two.
 *  2. Newly overdue: flips isOverdue, logs it, and alerts the assignees, the
 *     person who assigned the task, the project admins and (configurable) every
 *     Super Admin. In-app alerts go out immediately.
 *  3. Overdue emails: each recipient gets one email per overdue episode, held
 *     back during quiet hours (22:00 to 08:00 company time) and sent after.
 *  4. Still overdue: repeats the alert every `overdueRepeatHours` (default 24h),
 *     never during quiet hours.
 *  5. Resolved: clears the flag when the due date moved or the task is done.
 *
 * Idempotent: PmDispatchLog has a unique (task, user, kind, due snapshot) row
 * per alert, and the overdue flip is a conditional update (claim), so running the
 * tick twice (or on two instances) never double notifies. Changing the due date
 * changes the snapshot, which re-arms every reminder for the new date.
 */

const QUIET_START = 22
const QUIET_END = 8
const BATCH = 500

export function isQuietHours(now: Date, zone = COMPANY_TZ): boolean {
  const h = DateTime.fromJSDate(now).setZone(zone).hour
  return h >= QUIET_START || h < QUIET_END
}

/**
 * Which Super Admins get overdue alerts for every project, from
 * PM_SUPER_ADMIN_OVERDUE_ALERTS: "true" (default) = all active Super Admins,
 * "false" = none, or a comma separated list of emails = only those people.
 */
export async function overdueSuperAdminIds(): Promise<string[]> {
  const raw = (process.env.PM_SUPER_ADMIN_OVERDUE_ALERTS ?? 'true').trim()
  if (raw.toLowerCase() === 'false' || raw === '') return []
  const all = await prisma.user.findMany({ where: { role: 'SUPER_ADMIN', isActive: true, status: 'ACTIVE' }, select: { id: true, email: true } })
  if (raw.toLowerCase() === 'true') return all.map((u) => u.id)
  const wanted = new Set(raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean))
  return all.filter((u) => wanted.has(u.email.toLowerCase())).map((u) => u.id)
}

const OPEN_TASK: Prisma.PmTaskWhereInput = {
  deletedAt: null,
  completedAt: null,
  column: { category: { not: 'DONE' } },
  project: { status: 'ACTIVE' },
}

const TASK_INCLUDE = {
  project: { select: { id: true, key: true, name: true, overdueNotifyAdmins: true, overdueRepeatHours: true, reminderOffsetsMinutes: true, members: { where: { role: 'ADMIN' as const, user: { isActive: true } }, select: { userId: true } } } },
  assignees: { select: { userId: true, user: { select: { name: true, isActive: true } } } },
  column: { select: { name: true } },
} satisfies Prisma.PmTaskInclude

type DeadlineTask = Prisma.PmTaskGetPayload<{ include: typeof TASK_INCLUDE }>

/** Claim a dispatch slot. Returns true only for the first caller. */
async function claim(taskId: string, userId: string, kind: string, dueAt: Date): Promise<boolean> {
  try {
    await prisma.pmDispatchLog.create({ data: { taskId, userId, kind, dueAtSnapshot: dueAt } })
    return true
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') return false
    throw e
  }
}

function activeAssignees(t: DeadlineTask): string[] {
  return t.assignees.filter((a) => a.user.isActive).map((a) => a.userId)
}

async function overdueRecipients(t: DeadlineTask, supers: string[]): Promise<{ assignees: string[]; managers: string[] }> {
  const assignees = activeAssignees(t)
  const managers = new Set<string>()
  managers.add(t.createdById)
  if (t.project.overdueNotifyAdmins) for (const m of t.project.members) managers.add(m.userId)
  for (const s of supers) managers.add(s)
  for (const a of assignees) managers.delete(a) // one alert per person, assignee wording wins
  const creatorActive = await prisma.user.count({ where: { id: t.createdById, isActive: true } })
  if (!creatorActive) managers.delete(t.createdById)
  return { assignees, managers: [...managers] }
}

function assigneeNames(t: DeadlineTask): string {
  const names = t.assignees.map((a) => a.user.name)
  if (!names.length) return 'nobody'
  return names.length > 2 ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more` : names.join(' and ')
}

export interface TickResult {
  dueSoon: number
  newlyOverdue: number
  overdueEmails: number
  repeats: number
  cleared: number
}

export async function runDeadlineTick(now: Date = new Date()): Promise<TickResult> {
  const result: TickResult = { dueSoon: 0, newlyOverdue: 0, overdueEmails: 0, repeats: 0, cleared: 0 }
  const quiet = isQuietHours(now)

  // 5. Resolved first, so a task fixed since the last tick never gets a stale alert.
  const cleared = await prisma.pmTask.updateMany({
    where: {
      isOverdue: true,
      OR: [{ deletedAt: { not: null } }, { completedAt: { not: null } }, { column: { category: 'DONE' } }, { dueAt: null }, { dueAt: { gte: now } }, { project: { status: 'ARCHIVED' } }],
    },
    data: { isOverdue: false, overdueSince: null, lastOverdueNotifiedAt: null },
  })
  result.cleared = cleared.count

  // 1. Due soon (largest offset is at most a week).
  const horizon = new Date(now.getTime() + 7 * 24 * 60 * 60000)
  const soon = await prisma.pmTask.findMany({
    where: { ...OPEN_TASK, dueAt: { gt: now, lte: horizon }, assignees: { some: {} } },
    include: TASK_INCLUDE,
    take: BATCH * 4,
  })
  for (const t of soon) {
    const remainingMin = (t.dueAt!.getTime() - now.getTime()) / 60000
    const offsets = [...(t.project.reminderOffsetsMinutes.length ? t.project.reminderOffsetsMinutes : [1440, 60])].sort((a, b) => a - b)
    const hit = offsets.find((o) => remainingMin <= o)
    if (hit === undefined) continue
    const kind = `due_soon_${hit}`
    const recipients: string[] = []
    for (const uid of activeAssignees(t)) if (await claim(t.id, uid, kind, t.dueAt!)) recipients.push(uid)
    if (!recipients.length) continue
    const inLabel = fmtDuration(t.dueAt!.getTime() - now.getTime())
    await pmNotify({
      userIds: recipients,
      type: 'TASK_DUE_SOON',
      title: `${t.code} is due in ${inLabel}`,
      body: `"${trunc(t.title, 70)}" is due ${fmtDue(t.dueAt)}`,
      link: taskLink(t.project.key, t.code),
      taskId: t.id,
      email: {
        pref: 'emailDueSoon',
        subject: `Task due in ${inLabel}: ${t.code} ${trunc(t.title, 60)}`,
        heading: `${t.code} is due soon`,
        lines: [`${t.code} "${t.title}" is due in ${inLabel} (${fmtDue(t.dueAt)}).`, `Current status: ${t.column.name}.`],
        cta: 'Open the task',
      },
    })
    result.dueSoon += recipients.length
  }

  const supers = await overdueSuperAdminIds()

  // 2. Newly overdue.
  const fresh = await prisma.pmTask.findMany({
    where: { ...OPEN_TASK, isOverdue: false, dueAt: { lt: now } },
    include: TASK_INCLUDE,
    take: BATCH,
  })
  for (const t of fresh) {
    const won = await prisma.pmTask.updateMany({ where: { id: t.id, isOverdue: false }, data: { isOverdue: true, overdueSince: now, lastOverdueNotifiedAt: now } })
    if (won.count !== 1) continue
    await logActivity(t.id, null, 'became_overdue', { dueAt: t.dueAt!.toISOString() })
    const { assignees, managers } = await overdueRecipients(t, supers)
    const link = taskLink(t.project.key, t.code)
    const late = fmtDuration(now.getTime() - t.dueAt!.getTime())
    await pmNotify({
      userIds: assignees,
      type: 'TASK_OVERDUE',
      title: `${t.code} is overdue`,
      body: `"${trunc(t.title, 70)}" was due ${fmtDue(t.dueAt)}. Update the status or request an extension.`,
      link,
      taskId: t.id,
    })
    await pmNotify({
      userIds: managers,
      type: 'TASK_OVERDUE',
      title: `${t.code} is overdue by ${late}`,
      body: `"${trunc(t.title, 60)}" assigned to ${assigneeNames(t)}. Due ${fmtDue(t.dueAt)}. Status: ${t.column.name}.`,
      link,
      taskId: t.id,
    })
    result.newlyOverdue++
  }

  // 3. Overdue emails (one per recipient per overdue episode, after quiet hours).
  if (!quiet) {
    const overdue = await prisma.pmTask.findMany({ where: { ...OPEN_TASK, isOverdue: true, dueAt: { lt: now } }, include: TASK_INCLUDE, take: BATCH })
    for (const t of overdue) {
      const { assignees, managers } = await overdueRecipients(t, supers)
      const late = fmtDuration(now.getTime() - t.dueAt!.getTime())
      for (const uid of assignees) {
        if (!(await claim(t.id, uid, 'overdue_email', t.dueAt!))) continue
        await emailOnly(uid, t, {
          subject: `Overdue task: ${t.code} ${trunc(t.title, 60)}`,
          heading: `${t.code} is overdue`,
          lines: [`${t.code} "${t.title}" is overdue. It was due on ${fmtDue(t.dueAt)}.`, 'Please update the status or request an extension.'],
        })
        result.overdueEmails++
      }
      for (const uid of managers) {
        if (!(await claim(t.id, uid, 'overdue_email', t.dueAt!))) continue
        await emailOnly(uid, t, {
          subject: `Overdue task: ${t.code} ${trunc(t.title, 60)}`,
          heading: `${t.code} is overdue`,
          lines: [`${t.code} "${t.title}" assigned to ${assigneeNames(t)} is overdue by ${late}.`, `Due ${fmtDue(t.dueAt)}. Status: ${t.column.name}.`],
        })
        result.overdueEmails++
      }
    }
  }

  // 4. Still overdue: repeat every overdueRepeatHours, outside quiet hours.
  if (!quiet) {
    const stale = await prisma.pmTask.findMany({ where: { ...OPEN_TASK, isOverdue: true, dueAt: { lt: now }, lastOverdueNotifiedAt: { not: null } }, include: TASK_INCLUDE, take: BATCH })
    for (const t of stale) {
      const every = Math.max(1, t.project.overdueRepeatHours) * 3600000
      if (now.getTime() - t.lastOverdueNotifiedAt!.getTime() < every) continue
      const won = await prisma.pmTask.updateMany({ where: { id: t.id, lastOverdueNotifiedAt: t.lastOverdueNotifiedAt }, data: { lastOverdueNotifiedAt: now } })
      if (won.count !== 1) continue
      const { assignees, managers } = await overdueRecipients(t, supers)
      const late = fmtDuration(now.getTime() - t.dueAt!.getTime())
      const link = taskLink(t.project.key, t.code)
      const all = [...assignees, ...managers]
      await pmNotify({
        userIds: all,
        type: 'TASK_OVERDUE',
        title: `Reminder: ${t.code} is still overdue (${late})`,
        body: `"${trunc(t.title, 60)}" assigned to ${assigneeNames(t)}. Status: ${t.column.name}.`,
        link,
        taskId: t.id,
        email: {
          pref: 'always',
          subject: `Reminder: ${t.code} is still overdue`,
          heading: `${t.code} is still overdue`,
          lines: [`Reminder: ${t.code} "${t.title}" is still overdue (${late}).`, `Assigned to ${assigneeNames(t)}. Due ${fmtDue(t.dueAt)}. Status: ${t.column.name}.`],
          cta: 'Open the task',
        },
      })
      result.repeats++
    }
  }
  return result
}

async function emailOnly(userId: string, t: DeadlineTask, mail: { subject: string; heading: string; lines: string[] }): Promise<void> {
  const { sendMail } = await import('../mail')
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true, isActive: true } })
  if (!u || !u.isActive) return
  const appUrl = process.env.APP_URL || 'http://localhost:5173'
  const href = `${appUrl}${taskLink(t.project.key, t.code)}`
  const lines = [`Hi ${u.name},`, ...mail.lines]
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
  const html = `<div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;color:#0F172A">
    <div style="padding:16px 0"><strong style="font-size:18px">PulseTrack Projects</strong></div>
    <h1 style="font-size:19px;margin:8px 0;color:#B91C1C">${esc(mail.heading)}</h1>
    ${lines.map((l) => `<p style="font-size:14px;line-height:1.5;margin:6px 0">${esc(l)}</p>`).join('')}
    <a href="${href}" style="display:inline-block;background:#4F46E5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;margin:14px 0">Open the task</a>
  </div>`
  await sendMail({ to: u.email, subject: mail.subject, html, text: [...lines, '', href].join('\n') })
}

/** Start the deadline cron (every 5 minutes). Call once on boot. */
export function startPmDeadlines(): void {
  cron.schedule('*/5 * * * *', () => {
    runDeadlineTick().catch((e) => {
      // eslint-disable-next-line no-console
      console.error('[pm-deadlines] tick failed:', e)
    })
  })
  // eslint-disable-next-line no-console
  console.log('[pm-deadlines] project due/overdue alerts started (every 5 min)')
}
