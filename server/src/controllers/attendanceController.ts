import type { Response } from 'express'
import { z } from 'zod'
import { DateTime } from 'luxon'
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { COMPANY_TZ, companyToday, dbDateFromString, dateStringFromDb, periodRange, type RangeKey } from '../lib/time'
import { isOvernight, shiftMinutes, shiftDayString } from '../lib/shiftDay'
import { getClientIp, ipAllowed, isLoopback } from '../lib/ip'
import type { Role } from '@prisma/client'

type DayWithBreaks = Prisma.AttendanceDayGetPayload<{ include: { breaks: true } }>
type Shift = {
  startTime: string
  endTime: string
  graceMin: number
  requiredMinutes: number
  workingDays: number[] // 0=Sun … 6=Sat
  timeZone: string | null // IANA zone; null = company timezone
}
type ShiftRow = {
  userId: string | null
  departmentId: string | null
  startTime: string
  endTime: string
  graceMin: number
  requiredMinutes: number
  workingDays: number[]
  timeZone: string | null
}

const DEFAULT_SHIFT: Shift = { startTime: '09:00', endTime: '18:00', graceMin: 10, requiredMinutes: 480, workingDays: [1, 2, 3, 4, 5], timeZone: null }

function loadUser(id: string) {
  return prisma.user.findUniqueOrThrow({ where: { id }, include: { department: true } })
}

const toShift = (s: ShiftRow | undefined): Shift =>
  s
    ? { startTime: s.startTime, endTime: s.endTime, graceMin: s.graceMin, requiredMinutes: s.requiredMinutes, workingDays: s.workingDays, timeZone: s.timeZone }
    : DEFAULT_SHIFT

/** Pick the effective shift for an employee: user override → department → company. */
function pickShiftFor(rows: ShiftRow[], userId: string, departmentId: string | null): Shift {
  const user = rows.find((r) => r.userId === userId)
  const dept = departmentId ? rows.find((r) => r.departmentId === departmentId) : undefined
  const company = rows.find((r) => r.userId === null && r.departmentId === null)
  return toShift(user ?? dept ?? company)
}

/** Resolve one employee's effective shift (user → department → company). */
async function resolveShift(userId: string, departmentId: string | null): Promise<Shift> {
  const rows = await prisma.attendanceShift.findMany({
    where: { OR: [{ userId }, { departmentId }, { userId: null, departmentId: null }] },
  })
  return pickShiftFor(rows, userId, departmentId)
}

function hhmm(d: Date, shift?: Shift): string {
  return DateTime.fromJSDate(d).setZone(shift?.timeZone || COMPANY_TZ).toFormat('HH:mm')
}

/** 12-hour label in the shift's timezone (company tz fallback), e.g. "9:03 AM". */
function clockLabel(d: Date, shift?: Shift): string {
  return DateTime.fromJSDate(d).setZone(shift?.timeZone || COMPANY_TZ).toFormat('h:mm a')
}

/** Shift end on a continuous axis where an overnight end rolls into the next day (+1440). */
function shiftEndMinutes(shift: Shift): number {
  const end = shiftMinutes(shift.endTime)
  return isOvernight(shift) ? end + 1440 : end
}

/** Raw minutes-after-midnight of an instant in the shift's timezone (company tz fallback). */
function localMinutes(d: Date, shift?: Shift): number {
  const l = DateTime.fromJSDate(d).setZone(shift?.timeZone || COMPANY_TZ)
  return l.hour * 60 + l.minute
}

/**
 * Minutes of an instant mapped onto the shift's axis: for an overnight shift, an
 * instant that falls before the start time belongs to the post-midnight portion,
 * so it is shifted by +1440. Lets late/early-leave math work across midnight.
 */
function shiftAxisMinutes(d: Date, shift: Shift): number {
  const m = localMinutes(d, shift)
  return isOvernight(shift) && m < shiftMinutes(shift.startTime) ? m + 1440 : m
}

function isLate(checkInAt: Date, shift: Shift): boolean {
  return shiftAxisMinutes(checkInAt, shift) > shiftMinutes(shift.startTime) + shift.graceMin
}

function isEarlyLeave(checkOutAt: Date, shift: Shift): boolean {
  return shiftAxisMinutes(checkOutAt, shift) < shiftEndMinutes(shift)
}

/** Total break minutes; an open break is counted up to `now`. */
function breakMinutes(day: DayWithBreaks, now: Date): number {
  let ms = 0
  for (const b of day.breaks) {
    const end = b.endAt ?? now
    ms += end.getTime() - b.startAt.getTime()
  }
  return Math.max(0, Math.round(ms / 60000))
}

/** Longest an open (not-checked-out) day can still count live, in hours. Beyond
 *  this we treat it as a forgotten check-out. Wide enough to cover an overnight
 *  shift plus breaks, but well short of a full extra day. */
const MAX_LIVE_HOURS = 18

/**
 * Worked minutes = (checkOut|now − checkIn) − breaks. Null until checked in.
 * A stale open day (forgot to check out) returns null rather than inflating to
 * "now"; an open day still within a plausible shift window counts live. Using an
 * elapsed-time window (not the calendar date) keeps overnight shifts correct
 * after midnight.
 */
function workedMinutes(day: DayWithBreaks, now: Date): number | null {
  if (!day.checkInAt) return null
  let end: Date
  if (day.checkOutAt) end = day.checkOutAt
  else {
    const hoursOpen = (now.getTime() - day.checkInAt.getTime()) / 3600000
    if (hoursOpen >= 0 && hoursOpen <= MAX_LIVE_HOURS) end = now
    else return null
  }
  const gross = Math.round((end.getTime() - day.checkInAt.getTime()) / 60000)
  return Math.max(0, gross - breakMinutes(day, end))
}

type LiveState = 'NOT_IN' | 'IN' | 'ON_BREAK' | 'OUT'

function liveState(day: DayWithBreaks | null): LiveState {
  if (!day || !day.checkInAt) return 'NOT_IN'
  if (day.checkOutAt) return 'OUT'
  return day.breaks.some((b) => !b.endAt) ? 'ON_BREAK' : 'IN'
}

function serializeToday(day: DayWithBreaks | null, shift: Shift, now: Date) {
  const openBreak = day?.breaks.find((b) => !b.endAt) ?? null
  const worked = day ? workedMinutes(day, now) : null
  return {
    state: liveState(day),
    checkInAt: day?.checkInAt?.toISOString() ?? null,
    checkInLabel: day?.checkInAt ? clockLabel(day.checkInAt, shift) : null,
    checkOutAt: day?.checkOutAt?.toISOString() ?? null,
    checkOutLabel: day?.checkOutAt ? clockLabel(day.checkOutAt, shift) : null,
    openBreakStartAt: openBreak?.startAt.toISOString() ?? null,
    workedMin: worked,
    breakMin: day ? breakMinutes(day, now) : 0,
    late: day?.checkInAt ? isLate(day.checkInAt, shift) : false,
    earlyLeave: day?.checkOutAt ? isEarlyLeave(day.checkOutAt, shift) : false,
    requiredMin: shift.requiredMinutes,
    completed: worked != null && worked >= shift.requiredMinutes,
  }
}

/** Load today's day + any leave/holiday marker, and build the widget payload. */
async function buildMePayload(me: Awaited<ReturnType<typeof loadUser>>) {
  const now = new Date()
  // The attendance day is resolved in the employee's shift timezone so night
  // shifts that cross midnight stay on one date (see shiftDayString).
  const shift = await resolveShift(me.id, me.departmentId)
  const dateStr = shiftDayString(shift, now)
  const dateValue = dbDateFromString(dateStr)
  const [day, leave, holiday] = await Promise.all([
    prisma.attendanceDay.findUnique({ where: { userId_date: { userId: me.id, date: dateValue } }, include: { breaks: { orderBy: { startAt: 'asc' } } } }),
    prisma.leaveDay.findUnique({ where: { userId_date: { userId: me.id, date: dateValue } } }),
    prisma.holiday.findUnique({ where: { date: dateValue } }),
  ])
  const isWfh = leave?.type === 'WFH'
  const offLabel = leave && !isWfh ? leave.type : holiday ? 'HOLIDAY' : null
  return {
    date: dateStr,
    today: serializeToday(day, shift, now),
    shift,
    offLabel, // 'ON_LEAVE' | 'OFF' | 'HOLIDAY' | null — clocking blocked when set
    offName: holiday?.name ?? null,
    workMode: isWfh ? 'WFH' : null, // WFH is a worked day: clocking stays enabled
  }
}

/** GET /api/attendance/me — today's clock state + shift for the widget. */
export async function getMe(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  res.json(await buildMePayload(me))
}

/** The employee's current attendance day, resolved in their shift timezone so an
 *  overnight shift is found after midnight (see shiftDayString). */
async function findToday(userId: string, shift: Shift): Promise<DayWithBreaks | null> {
  const dateValue = dbDateFromString(shiftDayString(shift))
  return prisma.attendanceDay.findUnique({
    where: { userId_date: { userId, date: dateValue } },
    include: { breaks: { orderBy: { startAt: 'asc' } } },
  })
}

/**
 * Self-healing guard for a shift timezone/hours change. A session recorded under
 * an old timezone can end up bucketed onto today's date and then wrongly block a
 * new check-in ("already checked in today"). When the stored check-in actually
 * belongs to a different shift-day, move that record to the day it belongs to —
 * merging if that day already exists (a split session) — so today's slot is free.
 * Returns true when it reconciled a stale record (caller may proceed with the
 * check-in), false when the record genuinely is today's (block the duplicate).
 */
async function reconcileStaleCheckIn(userId: string, existing: DayWithBreaks, shift: Shift, todayStr: string): Promise<boolean> {
  const properDate = shiftDayString(shift, existing.checkInAt!)
  if (properDate === todayStr) return false // genuinely checked in today
  const properValue = dbDateFromString(properDate)
  const clash = await prisma.attendanceDay.findUnique({ where: { userId_date: { userId, date: properValue } } })
  if (!clash) {
    // Clean move — the whole session goes to the day it belongs to; today is freed.
    await prisma.attendanceDay.update({ where: { id: existing.id }, data: { date: properValue } })
  } else {
    // The proper day already has a record (split session): fold this fragment in
    // (earliest check-in, latest check-out), move its breaks, then vacate today.
    const ins = [clash.checkInAt, existing.checkInAt].filter((d): d is Date => !!d)
    const outs = [clash.checkOutAt, existing.checkOutAt].filter((d): d is Date => !!d)
    await prisma.attendanceDay.update({
      where: { id: clash.id },
      data: {
        checkInAt: ins.reduce((a, b) => (a < b ? a : b)),
        checkOutAt: outs.length ? outs.reduce((a, b) => (a > b ? a : b)) : null,
      },
    })
    await prisma.breakEntry.updateMany({ where: { dayId: existing.id }, data: { dayId: clash.id } })
    await prisma.attendanceDay.update({ where: { id: existing.id }, data: { checkInAt: null, checkOutAt: null, checkInIp: null, checkOutIp: null } })
  }
  return true
}

/** POST /api/attendance/check-in */
/**
 * Office-network gate. Accepts the client IP unless a non-empty active allowlist
 * exists and the IP is outside it. Super Admins and loopback always pass.
 * Returns null when allowed, or an error message when blocked.
 */
async function officeNetworkBlock(ip: string, role: Role): Promise<string | null> {
  if (role === 'SUPER_ADMIN' || isLoopback(ip)) return null
  const nets = await prisma.officeNetwork.findMany({ where: { isActive: true }, select: { cidr: true } })
  if (nets.length === 0) return null // allowlist not configured — allow everyone
  if (ipAllowed(ip, nets.map((n) => n.cidr))) return null
  return 'You must be on the office network to record attendance.'
}

/**
 * GET /api/attendance/ip-check — self-diagnostic for the office-network feature.
 * Any signed-in user can open this to see the IP the server resolves for them and
 * whether it would pass the current allowlist. Used to confirm the real office IP
 * (as seen through Cloudflare) before enforcement is switched on.
 */
export async function ipCheck(req: AuthedRequest, res: Response): Promise<void> {
  const ip = getClientIp(req)
  const nets = await prisma.officeNetwork.findMany({ where: { isActive: true }, select: { cidr: true } })
  const enforcementActive = nets.length > 0
  const wouldBeAllowed = !enforcementActive || isLoopback(ip) || ipAllowed(ip, nets.map((n) => n.cidr))
  res.json({
    resolvedIp: ip,
    cfConnectingIp: (req.headers['cf-connecting-ip'] as string) ?? null,
    xForwardedFor: (req.headers['x-forwarded-for'] as string) ?? null,
    remoteAddr: req.socket.remoteAddress ?? null,
    enforcementActive,
    wouldBeAllowed,
  })
}

export async function checkIn(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  const now = new Date()
  const shift = await resolveShift(me.id, me.departmentId)
  const dateStr = shiftDayString(shift, now)
  const dateValue = dbDateFromString(dateStr)

  const ip = getClientIp(req)

  const [leave, holiday] = await Promise.all([
    prisma.leaveDay.findUnique({ where: { userId_date: { userId: me.id, date: dateValue } } }),
    prisma.holiday.findUnique({ where: { date: dateValue } }),
  ])
  const isWfh = leave?.type === 'WFH'
  if ((leave && !isWfh) || holiday) {
    res.status(409).json({ error: leave ? 'You are marked off today.' : `Today is a holiday (${holiday!.name}).` })
    return
  }

  // Office-network gate — skipped on WFH days, where the person works off-site by design.
  if (!isWfh) {
    const blocked = await officeNetworkBlock(ip, me.role)
    if (blocked) {
      res.status(403).json({ error: blocked })
      return
    }
  }
  const existing = await findToday(me.id, shift)
  if (existing?.checkInAt) {
    // A timezone/hours change can leave a past session on today's date; if so,
    // reconcile it away instead of blocking a legitimate check-in.
    const reconciled = await reconcileStaleCheckIn(me.id, existing, shift, dateStr)
    if (!reconciled) {
      res.status(409).json({ error: 'Already checked in today.' })
      return
    }
  }
  await prisma.attendanceDay.upsert({
    where: { userId_date: { userId: me.id, date: dateValue } },
    update: { checkInAt: now, checkInIp: ip },
    create: { userId: me.id, date: dateValue, checkInAt: now, checkInIp: ip },
  })
  res.json(await buildMePayload(me))
}

/** POST /api/attendance/check-out — closes any open break. */
export async function checkOut(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  const now = new Date()

  const ip = getClientIp(req)
  const blocked = await officeNetworkBlock(ip, me.role)
  if (blocked) {
    res.status(403).json({ error: blocked })
    return
  }

  const shift = await resolveShift(me.id, me.departmentId)
  const existing = await findToday(me.id, shift)
  if (!existing?.checkInAt) {
    res.status(409).json({ error: 'You are not checked in.' })
    return
  }
  if (existing.checkOutAt) {
    res.status(409).json({ error: 'Already checked out today.' })
    return
  }
  await prisma.breakEntry.updateMany({ where: { dayId: existing.id, endAt: null }, data: { endAt: now } })
  await prisma.attendanceDay.update({ where: { id: existing.id }, data: { checkOutAt: now, checkOutIp: ip } })
  res.json(await buildMePayload(me))
}

/** POST /api/attendance/break/start */
export async function startBreak(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  const now = new Date()
  const shift = await resolveShift(me.id, me.departmentId)
  const existing = await findToday(me.id, shift)
  if (!existing?.checkInAt) {
    res.status(409).json({ error: 'Check in before taking a break.' })
    return
  }
  if (existing.checkOutAt) {
    res.status(409).json({ error: 'You have already checked out.' })
    return
  }
  if (existing.breaks.some((b) => !b.endAt)) {
    res.status(409).json({ error: 'A break is already running.' })
    return
  }
  await prisma.breakEntry.create({ data: { dayId: existing.id, startAt: now } })
  res.json(await buildMePayload(me))
}

/** POST /api/attendance/break/end */
export async function endBreak(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  const now = new Date()
  const shift = await resolveShift(me.id, me.departmentId)
  const existing = await findToday(me.id, shift)
  const open = existing?.breaks.find((b) => !b.endAt)
  if (!open) {
    res.status(409).json({ error: 'No break is running.' })
    return
  }
  await prisma.breakEntry.update({ where: { id: open.id }, data: { endAt: now } })
  res.json(await buildMePayload(me))
}

/** A merged per-day history row (attendance + leave/holiday). */
function historyRow(dateStr: string, day: DayWithBreaks | undefined, offLabel: string | null, offName: string | null, shift: Shift, now: Date) {
  const label = day?.checkInAt ? 'PRESENT' : offLabel ?? 'ABSENT'
  const worked = day ? workedMinutes(day, now) : null
  return {
    date: dateStr,
    label, // PRESENT | ON_LEAVE | OFF | HOLIDAY | ABSENT
    offName,
    checkIn: day?.checkInAt ? hhmm(day.checkInAt, shift) : null,
    checkOut: day?.checkOutAt ? hhmm(day.checkOutAt, shift) : null,
    workedMin: worked,
    breakMin: day ? breakMinutes(day, day.checkOutAt ?? now) : 0,
    late: day?.checkInAt ? isLate(day.checkInAt, shift) : false,
    earlyLeave: day?.checkOutAt ? isEarlyLeave(day.checkOutAt, shift) : false,
    requiredMin: shift.requiredMinutes,
    completed: worked != null && worked >= shift.requiredMinutes,
    shortMin: worked == null ? null : Math.max(0, shift.requiredMinutes - worked),
  }
}

/**
 * GET /api/attendance/history?userId=&range=&start=&end=
 * Own history by default; TL/Admin may pass a userId within their scope.
 */
export async function history(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  const targetId = (req.query.userId as string) || me.id

  if (targetId !== me.id) {
    if (me.role !== 'TEAM_LEAD' && me.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Forbidden' })
      return
    }
    const target = await prisma.user.findUnique({ where: { id: targetId }, select: { departmentId: true } })
    if (!target) {
      res.status(404).json({ error: 'User not found' })
      return
    }
    if (me.role === 'TEAM_LEAD' && target.departmentId !== me.departmentId) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }
  }

  const rangeKey = ((req.query.range as RangeKey) || 'month') as RangeKey
  const range = periodRange(rangeKey, { start: req.query.start as string, end: req.query.end as string })
  const startValue = dbDateFromString(range.startDate)
  const endValue = dbDateFromString(range.endDate)
  const now = new Date()

  const target = await prisma.user.findUniqueOrThrow({ where: { id: targetId }, select: { departmentId: true } })
  const [days, leaves, holidays, shift] = await Promise.all([
    prisma.attendanceDay.findMany({
      where: { userId: targetId, date: { gte: startValue, lte: endValue } },
      include: { breaks: { orderBy: { startAt: 'asc' } } },
    }),
    prisma.leaveDay.findMany({ where: { userId: targetId, date: { gte: startValue, lte: endValue } } }),
    prisma.holiday.findMany({ where: { date: { gte: startValue, lte: endValue } } }),
    resolveShift(targetId, target.departmentId),
  ])

  const dayByDate = new Map(days.map((d) => [dateStringFromDb(d.date), d]))
  const leaveByDate = new Map(leaves.map((l) => [dateStringFromDb(l.date), l.type as string]))
  const holidayByDate = new Map(holidays.map((h) => [dateStringFromDb(h.date), h.name]))

  // Union of dates that have any record — we don't fabricate absent weekdays.
  const dates = new Set<string>([...dayByDate.keys(), ...leaveByDate.keys(), ...holidayByDate.keys()])
  const rows = [...dates]
    .sort((a, b) => (a < b ? 1 : -1))
    .map((d) =>
      historyRow(
        d,
        dayByDate.get(d),
        leaveByDate.get(d) ?? (holidayByDate.has(d) ? 'HOLIDAY' : null),
        holidayByDate.get(d) ?? null,
        shift,
        now,
      ),
    )

  const worked = rows.filter((r) => r.label === 'PRESENT')
  const totalWorkedMin = worked.reduce((s, r) => s + (r.workedMin ?? 0), 0)
  const checkInMins = worked
    .map((r) => (r.checkIn ? shiftMinutes(r.checkIn) : null))
    .filter((v): v is number => v != null)
  const avgCheckInMin = checkInMins.length ? Math.round(checkInMins.reduce((s, v) => s + v, 0) / checkInMins.length) : null

  res.json({
    range: { ...range, key: rangeKey },
    shift,
    rows,
    summary: {
      presentDays: worked.length,
      leaveDays: rows.filter((r) => r.label === 'ON_LEAVE' || r.label === 'OFF').length,
      holidayDays: rows.filter((r) => r.label === 'HOLIDAY').length,
      lateDays: worked.filter((r) => r.late).length,
      completedShifts: worked.filter((r) => r.completed).length,
      totalWorkedMin,
      avgCheckIn: avgCheckInMin == null ? null : minToHHmm(avgCheckInMin),
    },
  })
}

function minToHHmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

/** Active roster in the caller's scope (own department for TL, all for Admin). */
async function scopedMembers(me: Awaited<ReturnType<typeof loadUser>>) {
  if (me.role === 'SUPER_ADMIN') {
    return prisma.user.findMany({
      where: { isActive: true, status: 'ACTIVE' },
      include: { department: true },
      orderBy: [{ name: 'asc' }],
    })
  }
  if (!me.departmentId) return []
  return prisma.user.findMany({
    where: { isActive: true, status: 'ACTIVE', departmentId: me.departmentId },
    include: { department: true },
    orderBy: { name: 'asc' },
  })
}

/** Department-or-company shift (ignores per-user overrides) — for shift-settings display. */
function pickDeptShift(rows: ShiftRow[], departmentId: string | null): Shift {
  const dept = departmentId ? rows.find((s) => s.userId === null && s.departmentId === departmentId) : undefined
  const company = rows.find((s) => s.userId === null && s.departmentId === null)
  return toShift(dept ?? company)
}

/**
 * GET /api/attendance/team?range= — per-member attendance for TL/Admin, plus a
 * live "who's in now" snapshot. TL is scoped to their department.
 */
export async function teamView(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.role !== 'TEAM_LEAD' && me.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const rangeKey = ((req.query.range as RangeKey) || 'month') as RangeKey
  const range = periodRange(rangeKey, { start: req.query.start as string, end: req.query.end as string })
  const startValue = dbDateFromString(range.startDate)
  const endValue = dbDateFromString(range.endDate)
  const now = new Date()

  const members = await scopedMembers(me)
  const memberIds = members.map((m) => m.id)

  const [days, leaves, shifts] = await Promise.all([
    prisma.attendanceDay.findMany({ where: { userId: { in: memberIds }, date: { gte: startValue, lte: endValue } }, include: { breaks: true } }),
    prisma.leaveDay.findMany({ where: { userId: { in: memberIds }, date: { gte: startValue, lte: endValue } } }),
    prisma.attendanceShift.findMany(),
  ])

  // "Today" is per-member: a night-shift employee's live day is anchored in their
  // own shift timezone, so it can differ from the company calendar date.
  const shiftByUser = new Map(members.map((m) => [m.id, pickShiftFor(shifts, m.id, m.departmentId)]))
  const todayDateByUser = new Map([...shiftByUser].map(([id, sh]) => [id, shiftDayString(sh, now)]))
  const todayValues = [...new Set(todayDateByUser.values())].map(dbDateFromString)
  const todayDays = await prisma.attendanceDay.findMany({
    where: { userId: { in: memberIds }, date: { in: todayValues } },
    include: { breaks: true },
  })

  const daysByUser = new Map<string, DayWithBreaks[]>()
  for (const d of days) {
    const list = daysByUser.get(d.userId) ?? []
    list.push(d)
    daysByUser.set(d.userId, list)
  }
  const leaveCount = new Map<string, number>()
  for (const l of leaves) leaveCount.set(l.userId, (leaveCount.get(l.userId) ?? 0) + 1)
  const todayByUser = new Map<string, DayWithBreaks>()
  for (const d of todayDays) {
    if (dateStringFromDb(d.date) === todayDateByUser.get(d.userId)) todayByUser.set(d.userId, d)
  }

  const rows = members.map((m) => {
    const shift = shiftByUser.get(m.id)!
    const md = daysByUser.get(m.id) ?? []
    const present = md.filter((d) => d.checkInAt)
    const totalWorkedMin = present.reduce((s, d) => s + (workedMinutes(d, now) ?? 0), 0)
    const totalBreakMin = present.reduce((s, d) => s + breakMinutes(d, d.checkOutAt ?? now), 0)
    const lateDays = present.filter((d) => d.checkInAt && isLate(d.checkInAt, shift)).length
    const completedShifts = present.filter((d) => { const w = workedMinutes(d, now); return w != null && w >= shift.requiredMinutes }).length
    const inMins = present.filter((d) => d.checkInAt).map((d) => localMinutes(d.checkInAt!, shift))
    const avgCheckIn = inMins.length ? minToHHmm(Math.round(inMins.reduce((s, v) => s + v, 0) / inMins.length)) : null
    const today = todayByUser.get(m.id) ?? null
    return {
      userId: m.id,
      name: m.name,
      department: m.department?.name ?? '—',
      presentDays: present.length,
      lateDays,
      completedShifts,
      leaveDays: leaveCount.get(m.id) ?? 0,
      totalWorkedMin,
      totalBreakMin,
      avgCheckIn,
      shiftRequiredMin: shift.requiredMinutes,
      hasOverride: shifts.some((s) => s.userId === m.id),
      todayState: liveState(today),
      todayCheckIn: today?.checkInAt ? clockLabel(today.checkInAt, shift) : null,
    }
  })

  const board = rows.map((r) => ({ userId: r.userId, name: r.name, department: r.department, state: r.todayState, checkIn: r.todayCheckIn }))
  const count = (s: LiveState) => board.filter((b) => b.state === s).length

  res.json({
    range: { ...range, key: rangeKey },
    canEditShift: true,
    scope: me.role === 'SUPER_ADMIN' ? 'COMPANY' : 'DEPARTMENT',
    shift: pickDeptShift(shifts, me.role === 'SUPER_ADMIN' ? null : me.departmentId),
    board,
    rows,
    summary: {
      members: members.length,
      inNow: count('IN'),
      onBreakNow: count('ON_BREAK'),
      outNow: count('OUT'),
      notInNow: count('NOT_IN'),
    },
  })
}

/** Resolve the shift row the caller edits: their department, or company default for Admin. */
async function editableShiftScope(me: Awaited<ReturnType<typeof loadUser>>): Promise<{ departmentId: string | null }> {
  if (me.role === 'SUPER_ADMIN') return { departmentId: null }
  return { departmentId: me.departmentId }
}

/** GET /api/attendance/shift — the shift the caller manages (TL: dept, Admin: company). */
export async function getShift(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.role !== 'TEAM_LEAD' && me.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const { departmentId } = await editableShiftScope(me)
  const shifts = await prisma.attendanceShift.findMany()
  res.json({
    scope: me.role === 'SUPER_ADMIN' ? 'COMPANY' : 'DEPARTMENT',
    departmentId,
    shift: pickDeptShift(shifts, departmentId),
  })
}

const shiftSchema = z.object({
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm'),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm'),
  graceMin: z.number().int().min(0).max(120),
  requiredMinutes: z.number().int().min(0).max(1440),
  workingDays: z.array(z.number().int().min(0).max(6)).min(1, 'Pick at least one working day').max(7),
  timeZone: z
    .string()
    .refine((tz) => DateTime.local().setZone(tz).isValid, 'Unknown time zone')
    .nullable()
    .optional(),
})

const outShift = (s: ShiftRow): Shift => ({
  startTime: s.startTime,
  endTime: s.endTime,
  graceMin: s.graceMin,
  requiredMinutes: s.requiredMinutes,
  workingDays: s.workingDays,
  timeZone: s.timeZone,
})

/** PUT /api/attendance/shift — upsert the caller's shift (TL: dept, Admin: company). */
export async function putShift(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.role !== 'TEAM_LEAD' && me.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const parsed = shiftSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const { departmentId } = await editableShiftScope(me)
  // Null-department can't use upsert on a unique-nullable key — find-then-write.
  const existing = await prisma.attendanceShift.findFirst({ where: { departmentId, userId: null } })
  const shift = existing
    ? await prisma.attendanceShift.update({ where: { id: existing.id }, data: parsed.data })
    : await prisma.attendanceShift.create({ data: { departmentId, ...parsed.data } })
  res.json({ shift: outShift(shift) })
}

/** GET /api/attendance/shift/user/:userId — a person's override (or null) + effective shift. */
export async function getUserShift(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.role !== 'TEAM_LEAD' && me.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const { userId } = req.params
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { departmentId: true } })
  if (!target) {
    res.status(404).json({ error: 'User not found' })
    return
  }
  if (me.role === 'TEAM_LEAD' && target.departmentId !== me.departmentId) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const shifts = await prisma.attendanceShift.findMany()
  const own = shifts.find((s) => s.userId === userId)
  res.json({
    override: own ? outShift(own) : null,
    effective: pickShiftFor(shifts, userId, target.departmentId),
    fallback: pickDeptShift(shifts, target.departmentId), // dept/company hours used when no override
  })
}

/** PUT /api/attendance/shift/user/:userId — set a per-account shift override. */
export async function putUserShift(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.role !== 'TEAM_LEAD' && me.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const { userId } = req.params
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { departmentId: true } })
  if (!target) {
    res.status(404).json({ error: 'User not found' })
    return
  }
  if (me.role === 'TEAM_LEAD' && target.departmentId !== me.departmentId) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const parsed = shiftSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const existing = await prisma.attendanceShift.findFirst({ where: { userId } })
  const shift = existing
    ? await prisma.attendanceShift.update({ where: { id: existing.id }, data: parsed.data })
    : await prisma.attendanceShift.create({ data: { userId, ...parsed.data } })
  res.json({ override: outShift(shift) })
}

/** DELETE /api/attendance/shift/user/:userId — clear the override (revert to dept/company). */
export async function deleteUserShift(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.role !== 'TEAM_LEAD' && me.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const { userId } = req.params
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { departmentId: true } })
  if (!target) {
    res.status(404).json({ error: 'User not found' })
    return
  }
  if (me.role === 'TEAM_LEAD' && target.departmentId !== me.departmentId) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  await prisma.attendanceShift.deleteMany({ where: { userId } })
  res.status(204).end()
}

const timeOrNull = z.union([z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), z.literal(''), z.null()]).optional()
const correctionSchema = z.object({ checkIn: timeOrNull, checkOut: timeOrNull })

/**
 * Combine a "YYYY-MM-DD" (the attendance day) + "HH:mm" into a UTC instant,
 * anchored in the shift's timezone. For an overnight shift a time in the
 * post-midnight portion (before the shift start) belongs to the NEXT calendar
 * day, so it is rolled forward — e.g. a 04:00 check-out on a 19:00–04:00 shift.
 */
function instantFrom(dateStr: string, hhmmStr: string, shift: Shift): Date {
  const zone = shift.timeZone || COMPANY_TZ
  let dt = DateTime.fromISO(`${dateStr}T${hhmmStr}`, { zone })
  if (isOvernight(shift) && shiftMinutes(hhmmStr) < shiftMinutes(shift.startTime)) {
    dt = dt.plus({ days: 1 })
  }
  return dt.toJSDate()
}

/**
 * PATCH /api/attendance/:userId/:date — TL/Admin correction of check-in/out.
 * Times are "HH:mm" (company tz); "" or null clears. Audited.
 */
export async function correctDay(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.role !== 'TEAM_LEAD' && me.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const { userId, date } = req.params
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { departmentId: true } })
  if (!target) {
    res.status(404).json({ error: 'User not found' })
    return
  }
  if (me.role === 'TEAM_LEAD' && target.departmentId !== me.departmentId) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const parsed = correctionSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid time — use HH:mm' })
    return
  }
  const dateValue = dbDateFromString(date)
  const shift = await resolveShift(userId, target.departmentId)
  const existing = await prisma.attendanceDay.findUnique({
    where: { userId_date: { userId, date: dateValue } },
    include: { breaks: true },
  })

  const data: { checkInAt?: Date | null; checkOutAt?: Date | null } = {}
  if (parsed.data.checkIn !== undefined) data.checkInAt = parsed.data.checkIn ? instantFrom(date, parsed.data.checkIn, shift) : null
  if (parsed.data.checkOut !== undefined) data.checkOutAt = parsed.data.checkOut ? instantFrom(date, parsed.data.checkOut, shift) : null

  const finalIn = data.checkInAt !== undefined ? data.checkInAt : existing?.checkInAt ?? null
  const finalOut = data.checkOutAt !== undefined ? data.checkOutAt : existing?.checkOutAt ?? null
  if (finalIn && finalOut && finalOut <= finalIn) {
    res.status(400).json({ error: 'Check-out must be after check-in.' })
    return
  }

  const day = await prisma.attendanceDay.upsert({
    where: { userId_date: { userId, date: dateValue } },
    update: data,
    create: { userId, date: dateValue, checkInAt: data.checkInAt ?? null, checkOutAt: data.checkOutAt ?? null },
  })

  await prisma.auditLog.create({
    data: {
      userId: me.id,
      entityType: 'AttendanceDay',
      entityId: day.id,
      action: existing ? 'UPDATE' : 'CREATE',
      before: existing ? { checkInAt: existing.checkInAt?.toISOString() ?? null, checkOutAt: existing.checkOutAt?.toISOString() ?? null } : undefined,
      after: { checkInAt: day.checkInAt?.toISOString() ?? null, checkOutAt: day.checkOutAt?.toISOString() ?? null },
    },
  })

  res.json({
    day: {
      date,
      checkIn: day.checkInAt ? hhmm(day.checkInAt, shift) : null,
      checkOut: day.checkOutAt ? hhmm(day.checkOutAt, shift) : null,
    },
  })
}

/** Guard: caller is TL/Admin and the target is in their scope. Returns the target or null (after responding). */
async function requireManageableTarget(me: Awaited<ReturnType<typeof loadUser>>, userId: string, res: Response) {
  if (me.role !== 'TEAM_LEAD' && me.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Forbidden' })
    return null
  }
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { departmentId: true } })
  if (!target) {
    res.status(404).json({ error: 'User not found' })
    return null
  }
  if (me.role === 'TEAM_LEAD' && target.departmentId !== me.departmentId) {
    res.status(403).json({ error: 'Forbidden' })
    return null
  }
  return target
}

const leaveSchema = z.object({ type: z.enum(['ON_LEAVE', 'OFF', 'WFH']), note: z.string().max(300).optional() })

/** PUT /api/attendance/:userId/leave/:date — TL/Admin marks a member On Leave / Off. */
export async function markLeave(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  const { userId, date } = req.params
  const target = await requireManageableTarget(me, userId, res)
  if (!target) return
  const parsed = leaveSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Pick a leave type (On Leave / Off / WFH).' })
    return
  }
  if (date > companyToday()) {
    // future leave is fine; nothing to guard
  }
  const dateValue = dbDateFromString(date)
  const leave = await prisma.leaveDay.upsert({
    where: { userId_date: { userId, date: dateValue } },
    update: { type: parsed.data.type, note: parsed.data.note ?? null },
    create: { userId, date: dateValue, type: parsed.data.type, note: parsed.data.note ?? null },
  })
  await prisma.auditLog.create({
    data: { userId: me.id, entityType: 'LeaveDay', entityId: leave.id, action: 'UPDATE', after: { userId, date, type: parsed.data.type } },
  })
  res.json({ leave: { date, type: leave.type, note: leave.note ?? '' } })
}

/** DELETE /api/attendance/:userId/leave/:date — remove a leave/off mark. */
export async function removeLeave(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  const { userId, date } = req.params
  const target = await requireManageableTarget(me, userId, res)
  if (!target) return
  await prisma.leaveDay.deleteMany({ where: { userId, date: dbDateFromString(date) } })
  res.status(204).end()
}
