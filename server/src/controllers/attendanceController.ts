import type { Response } from 'express'
import { z } from 'zod'
import { DateTime } from 'luxon'
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { COMPANY_TZ, companyToday, dbDateFromString, dateStringFromDb, periodRange, type RangeKey } from '../lib/time'

type DayWithBreaks = Prisma.AttendanceDayGetPayload<{ include: { breaks: true } }>
type Shift = { startTime: string; endTime: string; graceMin: number }

const DEFAULT_SHIFT: Shift = { startTime: '09:00', endTime: '18:00', graceMin: 10 }

function loadUser(id: string) {
  return prisma.user.findUniqueOrThrow({ where: { id }, include: { department: true } })
}

/** Resolve the expected shift for a department (falls back to the company default). */
async function resolveShift(departmentId: string | null): Promise<Shift> {
  const rows = await prisma.attendanceShift.findMany({
    where: departmentId ? { OR: [{ departmentId }, { departmentId: null }] } : { departmentId: null },
  })
  const dept = departmentId ? rows.find((r) => r.departmentId === departmentId) : undefined
  const company = rows.find((r) => r.departmentId === null)
  const s = dept ?? company
  return s ? { startTime: s.startTime, endTime: s.endTime, graceMin: s.graceMin } : DEFAULT_SHIFT
}

function hhmm(d: Date): string {
  return DateTime.fromJSDate(d).setZone(COMPANY_TZ).toFormat('HH:mm')
}

/** 12-hour company-timezone label, e.g. "9:03 AM". */
function clockLabel(d: Date): string {
  return DateTime.fromJSDate(d).setZone(COMPANY_TZ).toFormat('h:mm a')
}

/** Minutes-after-local-midnight for a shift "HH:mm" anchored to a given local day. */
function shiftMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

function localMinutes(d: Date): number {
  const l = DateTime.fromJSDate(d).setZone(COMPANY_TZ)
  return l.hour * 60 + l.minute
}

function isLate(checkInAt: Date, shift: Shift): boolean {
  return localMinutes(checkInAt) > shiftMinutes(shift.startTime) + shift.graceMin
}

function isEarlyLeave(checkOutAt: Date, shift: Shift): boolean {
  return localMinutes(checkOutAt) < shiftMinutes(shift.endTime)
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

/**
 * Worked minutes = (checkOut|now − checkIn) − breaks. Null until checked in.
 * A past day left open (forgot to check out) returns null rather than inflating
 * to "now"; only today's open day counts live up to the current moment.
 */
function workedMinutes(day: DayWithBreaks, now: Date): number | null {
  if (!day.checkInAt) return null
  let end: Date
  if (day.checkOutAt) end = day.checkOutAt
  else if (dateStringFromDb(day.date) === companyToday(now)) end = now
  else return null
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
  return {
    state: liveState(day),
    checkInAt: day?.checkInAt?.toISOString() ?? null,
    checkInLabel: day?.checkInAt ? clockLabel(day.checkInAt) : null,
    checkOutAt: day?.checkOutAt?.toISOString() ?? null,
    checkOutLabel: day?.checkOutAt ? clockLabel(day.checkOutAt) : null,
    openBreakStartAt: openBreak?.startAt.toISOString() ?? null,
    workedMin: day ? workedMinutes(day, now) : null,
    breakMin: day ? breakMinutes(day, now) : 0,
    late: day?.checkInAt ? isLate(day.checkInAt, shift) : false,
    earlyLeave: day?.checkOutAt ? isEarlyLeave(day.checkOutAt, shift) : false,
  }
}

/** Load today's day + any leave/holiday marker, and build the widget payload. */
async function buildMePayload(me: Awaited<ReturnType<typeof loadUser>>) {
  const now = new Date()
  const dateStr = companyToday(now)
  const dateValue = dbDateFromString(dateStr)
  const [day, shift, leave, holiday] = await Promise.all([
    prisma.attendanceDay.findUnique({ where: { userId_date: { userId: me.id, date: dateValue } }, include: { breaks: { orderBy: { startAt: 'asc' } } } }),
    resolveShift(me.departmentId),
    prisma.leaveDay.findUnique({ where: { userId_date: { userId: me.id, date: dateValue } } }),
    prisma.holiday.findUnique({ where: { date: dateValue } }),
  ])
  const offLabel = leave ? leave.type : holiday ? 'HOLIDAY' : null
  return {
    date: dateStr,
    today: serializeToday(day, shift, now),
    shift,
    offLabel, // 'ON_LEAVE' | 'OFF' | 'HOLIDAY' | null — clocking blocked when set
    offName: holiday?.name ?? null,
  }
}

/** GET /api/attendance/me — today's clock state + shift for the widget. */
export async function getMe(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  res.json(await buildMePayload(me))
}

async function findToday(userId: string): Promise<DayWithBreaks | null> {
  const dateValue = dbDateFromString(companyToday())
  return prisma.attendanceDay.findUnique({
    where: { userId_date: { userId, date: dateValue } },
    include: { breaks: { orderBy: { startAt: 'asc' } } },
  })
}

/** POST /api/attendance/check-in */
export async function checkIn(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  const now = new Date()
  const dateStr = companyToday(now)
  const dateValue = dbDateFromString(dateStr)

  const [leave, holiday] = await Promise.all([
    prisma.leaveDay.findUnique({ where: { userId_date: { userId: me.id, date: dateValue } } }),
    prisma.holiday.findUnique({ where: { date: dateValue } }),
  ])
  if (leave || holiday) {
    res.status(409).json({ error: leave ? 'You are marked off today.' : `Today is a holiday (${holiday!.name}).` })
    return
  }
  const existing = await findToday(me.id)
  if (existing?.checkInAt) {
    res.status(409).json({ error: 'Already checked in today.' })
    return
  }
  await prisma.attendanceDay.upsert({
    where: { userId_date: { userId: me.id, date: dateValue } },
    update: { checkInAt: now },
    create: { userId: me.id, date: dateValue, checkInAt: now },
  })
  res.json(await buildMePayload(me))
}

/** POST /api/attendance/check-out — closes any open break. */
export async function checkOut(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  const now = new Date()
  const existing = await findToday(me.id)
  if (!existing?.checkInAt) {
    res.status(409).json({ error: 'You are not checked in.' })
    return
  }
  if (existing.checkOutAt) {
    res.status(409).json({ error: 'Already checked out today.' })
    return
  }
  await prisma.breakEntry.updateMany({ where: { dayId: existing.id, endAt: null }, data: { endAt: now } })
  await prisma.attendanceDay.update({ where: { id: existing.id }, data: { checkOutAt: now } })
  res.json(await buildMePayload(me))
}

/** POST /api/attendance/break/start */
export async function startBreak(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  const now = new Date()
  const existing = await findToday(me.id)
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
  const existing = await findToday(me.id)
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
  return {
    date: dateStr,
    label, // PRESENT | ON_LEAVE | OFF | HOLIDAY | ABSENT
    offName,
    checkIn: day?.checkInAt ? hhmm(day.checkInAt) : null,
    checkOut: day?.checkOutAt ? hhmm(day.checkOutAt) : null,
    workedMin: day ? workedMinutes(day, now) : null,
    breakMin: day ? breakMinutes(day, day.checkOutAt ?? now) : 0,
    late: day?.checkInAt ? isLate(day.checkInAt, shift) : false,
    earlyLeave: day?.checkOutAt ? isEarlyLeave(day.checkOutAt, shift) : false,
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
    resolveShift(target.departmentId),
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

function pickShift(shifts: { departmentId: string | null; startTime: string; endTime: string; graceMin: number }[], departmentId: string | null): Shift {
  const dept = departmentId ? shifts.find((s) => s.departmentId === departmentId) : undefined
  const company = shifts.find((s) => s.departmentId === null)
  const s = dept ?? company
  return s ? { startTime: s.startTime, endTime: s.endTime, graceMin: s.graceMin } : DEFAULT_SHIFT
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
  const todayValue = dbDateFromString(companyToday(now))

  const members = await scopedMembers(me)
  const memberIds = members.map((m) => m.id)

  const [days, leaves, todayDays, shifts] = await Promise.all([
    prisma.attendanceDay.findMany({ where: { userId: { in: memberIds }, date: { gte: startValue, lte: endValue } }, include: { breaks: true } }),
    prisma.leaveDay.findMany({ where: { userId: { in: memberIds }, date: { gte: startValue, lte: endValue } } }),
    prisma.attendanceDay.findMany({ where: { userId: { in: memberIds }, date: todayValue }, include: { breaks: true } }),
    prisma.attendanceShift.findMany(),
  ])

  const daysByUser = new Map<string, DayWithBreaks[]>()
  for (const d of days) {
    const list = daysByUser.get(d.userId) ?? []
    list.push(d)
    daysByUser.set(d.userId, list)
  }
  const leaveCount = new Map<string, number>()
  for (const l of leaves) leaveCount.set(l.userId, (leaveCount.get(l.userId) ?? 0) + 1)
  const todayByUser = new Map(todayDays.map((d) => [d.userId, d]))

  const rows = members.map((m) => {
    const shift = pickShift(shifts, m.departmentId)
    const md = daysByUser.get(m.id) ?? []
    const present = md.filter((d) => d.checkInAt)
    const totalWorkedMin = present.reduce((s, d) => s + (workedMinutes(d, now) ?? 0), 0)
    const totalBreakMin = present.reduce((s, d) => s + breakMinutes(d, d.checkOutAt ?? now), 0)
    const lateDays = present.filter((d) => d.checkInAt && isLate(d.checkInAt, shift)).length
    const inMins = present.filter((d) => d.checkInAt).map((d) => localMinutes(d.checkInAt!))
    const avgCheckIn = inMins.length ? minToHHmm(Math.round(inMins.reduce((s, v) => s + v, 0) / inMins.length)) : null
    const today = todayByUser.get(m.id) ?? null
    return {
      userId: m.id,
      name: m.name,
      department: m.department?.name ?? '—',
      presentDays: present.length,
      lateDays,
      leaveDays: leaveCount.get(m.id) ?? 0,
      totalWorkedMin,
      totalBreakMin,
      avgCheckIn,
      todayState: liveState(today),
      todayCheckIn: today?.checkInAt ? clockLabel(today.checkInAt) : null,
    }
  })

  const board = rows.map((r) => ({ userId: r.userId, name: r.name, department: r.department, state: r.todayState, checkIn: r.todayCheckIn }))
  const count = (s: LiveState) => board.filter((b) => b.state === s).length

  res.json({
    range: { ...range, key: rangeKey },
    canEditShift: true,
    scope: me.role === 'SUPER_ADMIN' ? 'COMPANY' : 'DEPARTMENT',
    shift: pickShift(shifts, me.role === 'SUPER_ADMIN' ? null : me.departmentId),
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
    shift: pickShift(shifts, departmentId),
  })
}

const shiftSchema = z.object({
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm'),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm'),
  graceMin: z.number().int().min(0).max(120),
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
  if (parsed.data.endTime <= parsed.data.startTime) {
    res.status(400).json({ error: 'End time must be after start time.' })
    return
  }
  const { departmentId } = await editableShiftScope(me)
  // Null-department can't use upsert on a unique-nullable key — find-then-write.
  const existing = await prisma.attendanceShift.findFirst({ where: { departmentId } })
  const shift = existing
    ? await prisma.attendanceShift.update({ where: { id: existing.id }, data: parsed.data })
    : await prisma.attendanceShift.create({ data: { departmentId, ...parsed.data } })
  res.json({ shift: { startTime: shift.startTime, endTime: shift.endTime, graceMin: shift.graceMin } })
}

const timeOrNull = z.union([z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), z.literal(''), z.null()]).optional()
const correctionSchema = z.object({ checkIn: timeOrNull, checkOut: timeOrNull })

/** Combine a "YYYY-MM-DD" + "HH:mm" into a UTC instant anchored in company tz. */
function instantFrom(dateStr: string, hhmmStr: string): Date {
  return DateTime.fromISO(`${dateStr}T${hhmmStr}`, { zone: COMPANY_TZ }).toJSDate()
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
  const existing = await prisma.attendanceDay.findUnique({
    where: { userId_date: { userId, date: dateValue } },
    include: { breaks: true },
  })

  const data: { checkInAt?: Date | null; checkOutAt?: Date | null } = {}
  if (parsed.data.checkIn !== undefined) data.checkInAt = parsed.data.checkIn ? instantFrom(date, parsed.data.checkIn) : null
  if (parsed.data.checkOut !== undefined) data.checkOutAt = parsed.data.checkOut ? instantFrom(date, parsed.data.checkOut) : null

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
      checkIn: day.checkInAt ? hhmm(day.checkInAt) : null,
      checkOut: day.checkOutAt ? hhmm(day.checkOutAt) : null,
    },
  })
}
