import { prisma } from './prisma'
import { shiftDayString, type ShiftWindow } from './shiftDay'
import type { DateString } from './time'

/**
 * Which calendar date a daily log belongs to depends on the submitter's OWN
 * timezone, not the company's. A US-Central agent finishing their day at 8pm
 * on the 15th is still on the 16th in Asia/Karachi (companyToday), so without
 * this their entry lands on the wrong date. We resolve each user's effective
 * attendance shift (per-user override → department → company default) and take
 * the shift-day in that timezone — the exact same day the attendance view uses,
 * so a member's progress log and their attendance stay on the same date.
 */

const DEFAULT_SHIFT: ShiftWindow = { startTime: '09:00', endTime: '18:00', timeZone: null }

type ShiftTzRow = { userId: string | null; departmentId: string | null; startTime: string; endTime: string; timeZone: string | null }

function pickShift(rows: ShiftTzRow[], userId: string, departmentId: string | null): ShiftWindow {
  const user = rows.find((r) => r.userId === userId)
  const dept = departmentId ? rows.find((r) => r.userId === null && r.departmentId === departmentId) : undefined
  const company = rows.find((r) => r.userId === null && r.departmentId === null)
  const s = user ?? dept ?? company
  return s ? { startTime: s.startTime, endTime: s.endTime, timeZone: s.timeZone } : DEFAULT_SHIFT
}

const allShiftRows = () =>
  prisma.attendanceShift.findMany({ select: { userId: true, departmentId: true, startTime: true, endTime: true, timeZone: true } })

/** "Today" as the shift-day in one user's own timezone. */
export async function userToday(userId: string, departmentId: string | null, now: Date = new Date()): Promise<DateString> {
  return shiftDayString(pickShift(await allShiftRows(), userId, departmentId), now)
}

/**
 * Map of userId → that member's own "today" (shift-day in their timezone), for a
 * roster. One shift query for the whole set — used by team views to decide who
 * has submitted "today" without assuming everyone shares the company timezone.
 */
export async function todayByMember(
  members: { id: string; departmentId: string | null }[],
  now: Date = new Date(),
): Promise<Map<string, DateString>> {
  const rows = await allShiftRows()
  return new Map(members.map((m) => [m.id, shiftDayString(pickShift(rows, m.id, m.departmentId), now)]))
}
