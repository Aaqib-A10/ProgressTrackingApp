/**
 * One-off repair for night-shift check-ins filed on the wrong day.
 *
 * Until the fix in shiftDay.ts, a night-shift check-in made BEFORE the shift
 * start (18:45 for a 19:00–04:00 shift) was filed under the PREVIOUS day: it
 * landed on last night's record (or created a record one day too early). This
 * finds exactly those check-ins (and breaks started in the same window) since
 * --since and moves them to the day they belong to. Older day-shift history is
 * not touched: only times between the middle of the off-duty gap and the shift
 * start, filed one day early, are moved.
 *
 * Nothing is saved unless you pass --apply; without it, it prints what it would do.
 * A check-in whose right day already has its own check-in is left alone and listed.
 *



 */
import { DateTime } from 'luxon'
import { prisma } from './prisma'
import { COMPANY_TZ, dbDateFromString, dateStringFromDb } from './time'
import { isOvernight, overnightCutoffMinutes, shiftMinutes, type ShiftWindow } from './shiftDay'
import { pickShift } from './attendanceReminders'

class DryRun extends Error {}


/** The day an instant should be filed under, if it is one the old rule filed a day early; else null. */
function misfiledTo(shift: ShiftWindow, at: Date, filed: string): string | null {
  const local = DateTime.fromJSDate(at).setZone(shift.timeZone || COMPANY_TZ)
  const min = local.hour * 60 + local.minute
  if (min < overnightCutoffMinutes(shift) || min >= shiftMinutes(shift.startTime)) return null
  const right = local.toISODate()!
  return local.minus({ days: 1 }).toISODate() === filed ? right : null
}

export async function repairNightShiftDays(opts: { apply: boolean; since: string }): Promise<{ moved: number; lines: string[]; manual: string[] }> {
  const APPLY = opts.apply
  const SINCE = opts.since
  const lines: string[] = []
  const manual: string[] = []
  let moved = 0
  try {
    await prisma.$transaction(
      async (tx) => {
        const [users, shifts] = await Promise.all([
          tx.user.findMany({ select: { id: true, name: true, departmentId: true } }),
          tx.attendanceShift.findMany({ select: { userId: true, departmentId: true, startTime: true, endTime: true, dayTimes: true, graceMin: true, workingDays: true, timeZone: true } }),
        ])
        for (const u of users) {
          const shift = pickShift(shifts, u.id, u.departmentId)
          if (!isOvernight(shift)) continue
          // Newest first, so a chain of early check-ins (each one sitting on the day before) unwinds cleanly.
          const ids = await tx.attendanceDay.findMany({ where: { userId: u.id, date: { gte: dbDateFromString(SINCE) } }, select: { id: true }, orderBy: { date: 'desc' } })
          const dayAt = (d: string) => tx.attendanceDay.findUnique({ where: { userId_date: { userId: u.id, date: dbDateFromString(d) } } })
          const ensure = async (d: string) => (await dayAt(d))?.id ?? (await tx.attendanceDay.create({ data: { userId: u.id, date: dbDateFromString(d) } })).id

          for (const { id } of ids) {
            const r = await tx.attendanceDay.findUnique({ where: { id }, include: { breaks: true } })
            if (!r) continue
            const filed = dateStringFromDb(r.date)
            const label = (d: Date) => DateTime.fromJSDate(d).setZone(shift.timeZone || COMPANY_TZ).toFormat('ccc d LLL, h:mm a')

            if (r.checkInAt) {
              const to = misfiledTo(shift, r.checkInAt, filed)
              if (to) {
                const target = await dayAt(to)
                if (target?.checkInAt) {
                  manual.push(`${u.name}: check-in ${label(r.checkInAt)} is filed under ${filed}, but ${to} already has a check-in`)
                } else {
                  const tid = await ensure(to)
                  await tx.attendanceDay.update({ where: { id: tid }, data: { checkInAt: r.checkInAt, checkInIp: r.checkInIp, checkInUa: r.checkInUa, checkInMobile: r.checkInMobile } })
                  await tx.attendanceDay.update({ where: { id: r.id }, data: { checkInAt: null, checkInIp: null, checkInUa: null, checkInMobile: null } })
                  // A check-out on the same record AFTER this check-in belongs with it.
                  if (r.checkOutAt && r.checkOutAt > r.checkInAt && !target?.checkOutAt) {
                    await tx.attendanceDay.update({ where: { id: tid }, data: { checkOutAt: r.checkOutAt, checkOutIp: r.checkOutIp, checkOutUa: r.checkOutUa, checkOutMobile: r.checkOutMobile } })
                    await tx.attendanceDay.update({ where: { id: r.id }, data: { checkOutAt: null, checkOutIp: null, checkOutUa: null, checkOutMobile: null } })
                  }
                  for (const b of r.breaks) if (b.startAt >= r.checkInAt) await tx.breakEntry.update({ where: { id: b.id }, data: { dayId: tid } })
                  lines.push(`${u.name}: check-in ${label(r.checkInAt)}  ${filed} -> ${to}`)
                  moved++
                }
              }
            }
            // Drop a record the move left completely empty.
            const left = await tx.attendanceDay.findUnique({ where: { id: r.id }, include: { breaks: true } })
            if (left && !left.checkInAt && !left.checkOutAt && left.breaks.length === 0 && !left.note) await tx.attendanceDay.delete({ where: { id: r.id } })
          }
        }
        if (!APPLY) throw new DryRun()
      },
      { timeout: 120_000, maxWait: 10_000 },
    )
  } catch (e) {
    if (!(e instanceof DryRun)) throw e
  }

  return { moved, lines, manual }
}
