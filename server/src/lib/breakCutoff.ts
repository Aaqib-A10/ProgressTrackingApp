import cron from 'node-cron'
import { prisma } from './prisma'
import { notifyAttendance } from './notify'
import { runTracked } from './health/jobs'
import { COMPANY_TZ } from './time'
import { clockAt } from './overtime'
import { isOn } from './flags'
import { HOME_COMPANY_ID } from './company'

/**
 * Break cut-off (E-commerce, Oct 2026: "break cut off time if he forgets"). A break still running
 * after the cut-off (Break 90 min, BRB 30 min by default; set per company, department or person in
 * working hours; 0 = never) is ended at that point, so a forgotten break does not eat the rest of
 * the shift. The person and their team leads get a bell alert; a team lead can fix the time.
 */

type CutoffRow = { userId: string | null; departmentId: string | null; breakCutoffMin: number; brbCutoffMin: number; timeZone: string | null }
export const DEFAULT_CUTOFF = { breakCutoffMin: 90, brbCutoffMin: 30 }

function cutoffFor(rows: CutoffRow[], userId: string, departmentId: string | null) {
  return rows.find((r) => r.userId === userId) ?? (departmentId ? rows.find((r) => r.departmentId === departmentId) : undefined) ?? rows.find((r) => !r.userId && !r.departmentId) ?? { ...DEFAULT_CUTOFF, timeZone: null }
}

export async function runBreakCutoffTick(now: Date = new Date()): Promise<{ ended: number }> {
  const open = await prisma.breakEntry.findMany({
    where: { endAt: null, day: { checkOutAt: null } },
    select: { id: true, type: true, startAt: true, day: { select: { userId: true, user: { select: { name: true, departmentId: true, companyId: true } } } } },
  })
  if (!open.length) return { ended: 0 }
  const [rows, tls] = await Promise.all([
    prisma.attendanceShift.findMany({ select: { userId: true, departmentId: true, breakCutoffMin: true, brbCutoffMin: true, timeZone: true } }),
    prisma.user.findMany({ where: { role: 'TEAM_LEAD', isActive: true, status: 'ACTIVE' }, select: { id: true, departmentId: true } }),
  ])
  let ended = 0
  const switchedOn = new Map<string, boolean>()
  for (const b of open) {
    // The owner can switch the cut-off off for all companies or for one company.
    const company = b.day.user.companyId ?? HOME_COMPANY_ID
    if (!switchedOn.has(company)) switchedOn.set(company, await isOn('break-cutoff', company))
    if (!switchedOn.get(company)) continue
    const c = cutoffFor(rows, b.day.userId, b.day.user.departmentId)
    const limit = b.type === 'BRB' ? c.brbCutoffMin : c.breakCutoffMin
    if (!limit || limit <= 0) continue
    const at = new Date(b.startAt.getTime() + limit * 60_000)
    if (at > now) continue
    // Only one tick ends it (endAt still null).
    const r = await prisma.breakEntry.updateMany({ where: { id: b.id, endAt: null }, data: { endAt: at, autoEnded: true } })
    if (!r.count) continue
    ended++
    const zone = c.timeZone || COMPANY_TZ
    const kind = b.type === 'BRB' ? 'BRB' : 'break'
    const leads = tls.filter((t) => t.departmentId && t.departmentId === b.day.user.departmentId).map((t) => t.id)
    await notifyAttendance({
      recipientIds: [b.day.userId],
      type: 'BREAK_CUTOFF',
      title: `Your ${kind} was ended at ${limit} minutes`,
      body: `It started at ${clockAt(b.startAt, zone)} and was still running, so it was ended at ${clockAt(at, zone)}. If you came back earlier or later, ask your team lead to fix the time.`,
    }).catch(() => undefined)
    if (leads.length) {
      await notifyAttendance({
        recipientIds: leads.filter((id) => id !== b.day.userId),
        type: 'BREAK_CUTOFF',
        title: `${b.day.user.name}'s ${kind} was cut off`,
        body: `Started ${clockAt(b.startAt, zone)}, still running after ${limit} minutes, so it was ended at ${clockAt(at, zone)}. Fix the time in Team Attendance if it is wrong.`,
        link: '/app/attendance/team',
      }).catch(() => undefined)
    }
  }
  return { ended }
}

/** Every minute, so a break is ended right at its cut-off. */
export function startBreakCutoff(): void {
  cron.schedule('* * * * *', () => {
    runTracked('break-cutoff', runBreakCutoffTick).catch((e) => console.error('[break-cutoff] tick failed:', e)) // eslint-disable-line no-console
  })
}
