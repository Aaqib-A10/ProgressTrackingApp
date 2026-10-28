import type { Response } from 'express'
import { z } from 'zod'
import { DateTime } from 'luxon'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { COMPANY_TZ, companyToday, dbDateFromString, dateStringFromDb, periodRange, type RangeKey } from '../lib/time'
import { isOvernight, shiftMinutes, shiftDayString, belongsToPreviousShift, timesForWeekday, type DayTimes } from '../lib/shiftDay'
import { getClientIp, ipAllowed, isLoopback, networkOf } from '../lib/ip'
import { parseUserAgent } from '../lib/userAgent'
import { sendCsv } from '../lib/csv'
import { shiftSpanMin, autoCheckoutAt, overtimeMinutes, OVERTIME_MAX_MIN } from '../lib/overtime'
import type { Role, DepartmentType } from '@prisma/client'

type DayWithBreaks = Prisma.AttendanceDayGetPayload<{ include: { breaks: true } }>
type Shift = {
  startTime: string
  endTime: string
  dayTimes: DayTimes // per-weekday start/end overrides (null = same hours every day)
  graceMin: number
  requiredMinutes: number
  brbAllowanceMin: number
  breakAllowanceMin: number
  /** A single break still running after this many minutes is ended (0 = never). */
  breakCutoffMin: number
  brbCutoffMin: number
  workingDays: number[] // 0=Sun … 6=Sat
  timeZone: string | null // IANA zone; null = company timezone
}
type ShiftRow = {
  userId: string | null
  departmentId: string | null
  startTime: string
  endTime: string
  dayTimes: unknown
  graceMin: number
  requiredMinutes: number
  brbAllowanceMin: number
  breakAllowanceMin: number
  breakCutoffMin: number
  brbCutoffMin: number
  workingDays: number[]
  timeZone: string | null
}

const DEFAULT_SHIFT: Shift = { startTime: '09:00', endTime: '18:00', dayTimes: null, graceMin: 10, requiredMinutes: 480, brbAllowanceMin: 20, breakAllowanceMin: 65, breakCutoffMin: 90, brbCutoffMin: 30, workingDays: [1, 2, 3, 4, 5], timeZone: null }

/** Coerce a Prisma Json value into the DayTimes map (or null). */
function asDayTimes(v: unknown): DayTimes {
  return v && typeof v === 'object' ? (v as Record<string, { startTime: string; endTime: string }>) : null
}

/** The base shift with startTime/endTime swapped to the given date's per-day override. */
function shiftForDate(shift: Shift, dateStr: string): Shift {
  const t = timesForWeekday(shift, shift.dayTimes, weekdayOfDate(dateStr))
  return t.startTime === shift.startTime && t.endTime === shift.endTime ? shift : { ...shift, startTime: t.startTime, endTime: t.endTime }
}
/** Resolve the shift for the attendance day an instant belongs to (per-day aware). */
function shiftForInstant(shift: Shift, instant: Date): Shift {
  return shift.dayTimes ? shiftForDate(shift, shiftDayString(shift, instant)) : shift
}

function loadUser(id: string) {
  return prisma.user.findUniqueOrThrow({ where: { id }, include: { department: true } })
}

const toShift = (s: ShiftRow | undefined): Shift =>
  s
    ? { startTime: s.startTime, endTime: s.endTime, dayTimes: asDayTimes(s.dayTimes), graceMin: s.graceMin, requiredMinutes: s.requiredMinutes, brbAllowanceMin: s.brbAllowanceMin, breakAllowanceMin: s.breakAllowanceMin, breakCutoffMin: s.breakCutoffMin, brbCutoffMin: s.brbCutoffMin, workingDays: s.workingDays, timeZone: s.timeZone }
    : DEFAULT_SHIFT

/** Pick the effective shift for an employee: user override → department → company. */
function pickShiftFor(rows: ShiftRow[], userId: string, departmentId: string | null): Shift {
  const user = rows.find((r) => r.userId === userId)
  const dept = departmentId ? rows.find((r) => r.departmentId === departmentId) : undefined
  const company = rows.find((r) => r.userId === null && r.departmentId === null)
  return toShift(user ?? dept ?? company)
}

/** Resolve one employee's effective shift (user → department → company). */
export async function resolveShift(userId: string, departmentId: string | null): Promise<Shift> {
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
 * instant in the early-morning part (before the middle of the off-duty gap) belongs to the post-midnight portion,
 * so it is shifted by +1440. Lets late/early-leave math work across midnight.
 */
function shiftAxisMinutes(d: Date, shift: Shift): number {
  const m = localMinutes(d, shift)
  return belongsToPreviousShift(shift, m) ? m + 1440 : m
}

function isLate(checkInAt: Date, shift: Shift): boolean {
  const eff = shiftForInstant(shift, checkInAt) // per-day start/end for the day this check-in belongs to
  return shiftAxisMinutes(checkInAt, eff) > shiftMinutes(eff.startTime) + eff.graceMin
}

function isEarlyLeave(checkOutAt: Date, shift: Shift): boolean {
  const eff = shiftForInstant(shift, checkOutAt)
  return shiftAxisMinutes(checkOutAt, eff) < shiftEndMinutes(eff)
}

/**
 * Left early = checked out before the shift's end time AND did not work the full required
 * hours. Someone who came in early and completed their hours (in 08:40, out 17:40 on a 09:00 to
 * 18:00 shift) has not left early. One rule for the clock, My Attendance and the team views.
 */
export function leftEarly(checkOutAt: Date | null | undefined, workedMin: number | null, shift: Shift): boolean {
  if (!checkOutAt) return false
  if (workedMin != null && workedMin >= shift.requiredMinutes) return false
  return isEarlyLeave(checkOutAt, shift)
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

/** Break minutes for a single break type (BREAK or BRB); open break counted to `now`. */
function breakMinutesOfType(day: DayWithBreaks, type: 'BREAK' | 'BRB', now: Date): number {
  let ms = 0
  for (const b of day.breaks) {
    if (b.type !== type) continue
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
    openBreakType: openBreak?.type ?? null,
    workedMin: worked,
    breakMin: day ? breakMinutes(day, now) : 0,
    brbMin: day ? breakMinutesOfType(day, 'BRB', now) : 0,
    regularBreakMin: day ? breakMinutesOfType(day, 'BREAK', now) : 0,
    brbAllowanceMin: shift.brbAllowanceMin,
    breakAllowanceMin: shift.breakAllowanceMin,
    late: day?.checkInAt ? isLate(day.checkInAt, shift) : false,
    earlyLeave: leftEarly(day?.checkOutAt, worked, shift),
    requiredMin: shift.requiredMinutes,
    completed: worked != null && worked >= shift.requiredMinutes,
    ...overtimeInfo(day, shift, now),
  }
}

/** Overtime and the automatic check-out time, for the clock and history. */
function overtimeInfo(day: DayWithBreaks | null, shift: Shift, now: Date) {
  if (!day?.checkInAt) return { overtime: false, overtimeMin: 0, autoCheckoutAt: null, autoCheckoutLabel: null, shiftHoursMin: null }
  const span = shiftSpanMin(shift, dateStringFromDb(day.date))
  const auto = day.checkOutAt ? null : autoCheckoutAt(day.checkInAt, span, day.overtimeAt)
  return {
    overtime: !!day.overtimeAt,
    overtimeMin: overtimeMinutes(day, span, now),
    autoCheckoutAt: auto?.toISOString() ?? null,
    autoCheckoutLabel: auto ? clockLabel(auto, shift) : null,
    shiftHoursMin: span,
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
  const [dayRaw, leave, holiday] = await Promise.all([
    prisma.attendanceDay.findUnique({ where: { userId_date: { userId: me.id, date: dateValue } }, include: { breaks: { orderBy: { startAt: 'asc' } } } }),
    prisma.leaveDay.findUnique({ where: { userId_date: { userId: me.id, date: dateValue } } }),
    prisma.holiday.findUnique({ where: { date: dateValue } }),
  ])
  // A row can be left on today's date under an OLD timezone (its own check-in
  // actually belongs to a different shift-day). Don't surface it as "today" — a
  // stale checked-out row would show "Done" and hide the check-in button, locking
  // the person out (the reconcile only runs on check-in, which they can't reach).
  // The record itself is moved on the next check-in (reconcileStaleCheckIn).
  const todays = dayRaw?.checkInAt && shiftDayString(shift, dayRaw.checkInAt) !== dateStr ? null : dayRaw
  // Still working on a session that began the day before (past the split point): show it, so
  // the person sees "Working" and can check out.
  const open = todays?.checkInAt ? null : await findCurrent(me.id, shift, now)
  const day = open && open.id !== dayRaw?.id && open.checkInAt && !open.checkOutAt ? open : todays
  const isWfh = leave?.type === 'WFH'
  const offLabel = leave && !isWfh ? leave.type : holiday ? 'HOLIDAY' : null
  return {
    date: dateStr,
    today: serializeToday(day, shift, now),
    shift,
    offLabel, // 'ON_LEAVE' | 'OFF' | 'HOLIDAY' | null — clocking blocked when set
    offName: holiday?.name ?? null,
    // WFH is a worked day: clocking stays enabled from any network. REMOTE = always works from home.
    workMode: isWfh ? 'WFH' : me.attendanceRemote ? 'REMOTE' : null,
    overtimeMaxMin: OVERTIME_MAX_MIN,
    // The server's clock: the widget counts from this, so a computer whose clock is wrong still shows the right time worked.
    serverNow: now.toISOString(),
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
 * The session to act on for check-out, breaks and overtime: today's if it has a check-in,
 * otherwise a session still OPEN from the day before (someone worked past the split point,
 * e.g. in at 00:19 and out at 04:05 on an 11:00 to 20:00 shift). Without this the check-out
 * said "You are not checked in" and the session stayed open until the automatic check-out.
 */
async function findCurrent(userId: string, shift: Shift, now: Date = new Date()): Promise<DayWithBreaks | null> {
  const today = await findToday(userId, shift)
  if (today?.checkInAt) return today
  const prevStr = DateTime.fromISO(shiftDayString(shift, now)).minus({ days: 1 }).toISODate()!
  const prev = await prisma.attendanceDay.findUnique({
    where: { userId_date: { userId, date: dbDateFromString(prevStr) } },
    include: { breaks: { orderBy: { startAt: 'asc' } } },
  })
  if (prev?.checkInAt && !prev.checkOutAt && (now.getTime() - prev.checkInAt.getTime()) / 3600000 <= MAX_LIVE_HOURS) return prev
  return today
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
    // Closed sessions that do not overlap: the gap between the first's check-out and the
    // second's check-in.
    const [first, second] = clash.checkInAt && existing.checkInAt && clash.checkInAt <= existing.checkInAt ? [clash, existing] : [existing, clash]
    const gap = first.checkOutAt && second.checkInAt && second.checkInAt > first.checkOutAt ? { from: first.checkOutAt, to: second.checkInAt } : null
    // Atomic: merge times, reparent breaks, and vacate today's slot together so a
    // mid-sequence failure can't leave reparented breaks or a half-merged day.
    await prisma.$transaction([
      prisma.attendanceDay.update({
        where: { id: clash.id },
        data: {
          checkInAt: ins.reduce((a, b) => (a < b ? a : b)),
          checkOutAt: outs.length ? outs.reduce((a, b) => (a > b ? a : b)) : null,
        },
      }),
      prisma.breakEntry.updateMany({ where: { dayId: existing.id }, data: { dayId: clash.id } }),
      // Two separate sessions (out at 20:00, back in at 00:19): the time between them is not
      // work. Record it as time away so worked hours stay right.
      ...(gap ? [prisma.breakEntry.create({ data: { dayId: clash.id, type: 'BREAK', startAt: gap.from, endAt: gap.to } })] : []),
      prisma.attendanceDay.update({ where: { id: existing.id }, data: { checkInAt: null, checkOutAt: null, checkInIp: null, checkOutIp: null } }),
    ])
  }
  return true
}

/** POST /api/attendance/check-in */
/**
 * Office-network gate. Accepts the client IP unless a non-empty active allowlist
 * exists and the IP is outside it. Super Admins and loopback always pass.
 * Returns null when allowed, or an error message when blocked.
 */
async function officeNetworkBlock(ip: string, role: Role, isRemote: boolean): Promise<string | null> {
  // Super Admins, loopback, and permanently-remote users always pass.
  if (role === 'SUPER_ADMIN' || isLoopback(ip) || isRemote) return null
  const nets = await prisma.officeNetwork.findMany({ where: { isActive: true }, select: { cidr: true } })
  if (nets.length === 0) return null // allowlist not configured — allow everyone
  if (ipAllowed(ip, nets.map((n) => n.cidr))) return null
  return `You must be on the office network to check in. This network (${ip || 'unknown'}) is not on the office list yet. Your admin has been told and can allow it in one click; try again after that. Working from home? Ask your Team Lead with "Request work from home" on My Attendance.`
}

/**
 * Laptop-only gate. Blocks phones + tablets; Super Admins and unparseable UAs pass.
 * Returns null when allowed, or an error message when blocked.
 */
/** Raw UA + the spoof-resistant client-mobile flag (X-Client-Mobile, set by the web client). */
function deviceMeta(req: AuthedRequest): { ua: string | null; mobile: boolean } {
  return {
    ua: (req.headers['user-agent'] as string | undefined) ?? null,
    mobile: req.headers['x-client-mobile'] === '1',
  }
}

function attendanceDeviceBlock(req: AuthedRequest, role: Role): string | null {
  if (role === 'SUPER_ADMIN') return null
  const { device } = parseUserAgent(req.headers['user-agent'] as string | undefined)
  // Two signals: the UA (Mobile/Tablet), and the client's physical-input hint
  // (X-Client-Mobile) which survives Chrome's "Request Desktop Site" UA spoof.
  // Unknown UA device (null) is allowed on purpose so a desktop browser we fail
  // to parse is never wrongly blocked; only explicit Mobile/Tablet or the client
  // hint refuse.
  if (device === 'Mobile' || device === 'Tablet' || req.headers['x-client-mobile'] === '1') {
    return 'Attendance can only be recorded from a laptop or desktop — not a phone or tablet. Requesting the desktop site does not bypass this.'
  }
  return null
}

/**
 * Combined attendance gate: laptop-only device check (always) + office-network IP
 * check (skipped on WFH days and for Super Admin / permanently-remote users).
 * Returns null when allowed, or an error message when blocked.
 */
async function attendanceGuard(req: AuthedRequest, me: Awaited<ReturnType<typeof loadUser>>, isWfh: boolean): Promise<string | null> {
  const dev = attendanceDeviceBlock(req, me.role)
  if (dev) return dev
  if (!isWfh) return officeNetworkBlock(getClientIp(req), me.role, me.attendanceRemote)
  return null
}

/**
 * Gate for actions inside a running session (break start/end, overtime, check-out).
 * The office network was already checked at check-in, so only the device rule applies
 * here: a phone or office Wi-Fi switching address (IPv4 to IPv6, a second line) must
 * never trap someone on a break or stop them checking out. The IP is still saved and
 * logged when it is outside the office list, so admins can see it.
 */
async function sessionGuard(req: AuthedRequest, me: Awaited<ReturnType<typeof loadUser>>, action: string): Promise<string | null> {
  const dev = attendanceDeviceBlock(req, me.role)
  if (dev) return dev
  const ip = getClientIp(req)
  const off = await officeNetworkBlock(ip, me.role, me.attendanceRemote)
  if (off) console.log(`[attendance-gate] off-network ${action} allowed (session already open) — userId=${me.id} ip=${ip}`)
  return null
}

/**
 * A check-in refused by the office network: keep it for the Office Networks page and tell
 * the Super Admins (once per address per 30 minutes) so they can allow it in one click.
 * Best effort: a failure here never changes the answer the person gets.
 */
async function recordBlockedCheckIn(me: Awaited<ReturnType<typeof loadUser>>, ip: string): Promise<void> {
  try {
    await prisma.blockedCheckIn.create({ data: { userId: me.id, ip } })
    // One alert per network (an IPv6 office line gives every laptop its own address).
    const net = networkOf(ip)
    const recent = await prisma.notification.findFirst({
      where: { type: 'NETWORK_BLOCKED', entityId: net, createdAt: { gte: new Date(Date.now() - 30 * 60_000) } },
      select: { id: true },
    })
    if (recent) return
    const admins = await prisma.user.findMany({ where: { role: 'SUPER_ADMIN', isActive: true }, select: { id: true } })
    if (!admins.length) return
    await prisma.notification.createMany({
      data: admins.map((a) => ({
        userId: a.id,
        actorId: me.id,
        type: 'NETWORK_BLOCKED' as const,
        title: `${me.name} could not check in`,
        body: `Network ${net} is not on the office list. If it is the office, allow it on Office Networks.`,
        link: '/app/admin/networks',
        entityType: 'OfficeNetworkIp',
        entityId: net,
      })),
    })
  } catch (e) {
    console.error('[attendance-gate] could not record blocked check-in', e)
  }
}

/** Is the given user on a work-from-home day for the given (shift) date? */
async function isWfhToday(userId: string, dateValue: Date): Promise<boolean> {
  const leave = await prisma.leaveDay.findUnique({ where: { userId_date: { userId, date: dateValue } } })
  return leave?.type === 'WFH'
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
  const { device } = parseUserAgent(req.headers['user-agent'] as string | undefined)
  res.json({
    resolvedIp: ip,
    cfConnectingIp: (req.headers['cf-connecting-ip'] as string) ?? null,
    xForwardedFor: (req.headers['x-forwarded-for'] as string) ?? null,
    remoteAddr: req.socket.remoteAddress ?? null,
    enforcementActive,
    wouldBeAllowed,
    // Laptop-only device gate — phones + tablets are refused.
    device,
    deviceAllowed: device !== 'Mobile' && device !== 'Tablet',
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

  // Device (laptop-only) + office-network gate. IP part skipped on WFH days,
  // where the person works off-site by design.
  const blocked = await attendanceGuard(req, me, isWfh)
  if (blocked) {
    console.log(`[attendance-gate] BLOCKED check-in — userId=${me.id} ip=${ip}`)
    if (!attendanceDeviceBlock(req, me.role)) await recordBlockedCheckIn(me, ip)
    res.status(403).json({ error: blocked })
    return
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
  const dev = deviceMeta(req)
  await prisma.attendanceDay.upsert({
    where: { userId_date: { userId: me.id, date: dateValue } },
    update: { checkInAt: now, checkInIp: ip, checkInUa: dev.ua, checkInMobile: dev.mobile },
    create: { userId: me.id, date: dateValue, checkInAt: now, checkInIp: ip, checkInUa: dev.ua, checkInMobile: dev.mobile },
  })
  res.json(await buildMePayload(me))
}

/** POST /api/attendance/check-out — closes any open break. */
export async function checkOut(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  const now = new Date()
  const shift = await resolveShift(me.id, me.departmentId)

  const blocked = await sessionGuard(req, me, 'check-out')
  if (blocked) {
    console.log(`[attendance-gate] BLOCKED check-out — userId=${me.id}`)
    res.status(403).json({ error: blocked })
    return
  }
  const ip = getClientIp(req)

  const existing = await findCurrent(me.id, shift, now)
  if (!existing?.checkInAt) {
    res.status(409).json({ error: 'You are not checked in.' })
    return
  }
  if (existing.checkOutAt) {
    res.status(409).json({ error: 'Already checked out today.' })
    return
  }
  const dev = deviceMeta(req)
  await prisma.breakEntry.updateMany({ where: { dayId: existing.id, endAt: null }, data: { endAt: now, endUa: dev.ua, endMobile: dev.mobile } })
  await prisma.attendanceDay.update({ where: { id: existing.id }, data: { checkOutAt: now, checkOutIp: ip, checkOutUa: dev.ua, checkOutMobile: dev.mobile } })
  res.json(await buildMePayload(me))
}

/** POST /api/attendance/overtime — keep working after the shift's hours (no automatic check-out at the end of the shift). */
export async function startOvertime(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  const now = new Date()
  const shift = await resolveShift(me.id, me.departmentId)
  const blocked = await sessionGuard(req, me, 'overtime')
  if (blocked) {
    res.status(403).json({ error: blocked })
    return
  }
  const existing = await findCurrent(me.id, shift, now)
  if (!existing?.checkInAt) {
    res.status(409).json({ error: 'Check in first.' })
    return
  }
  if (existing.checkOutAt) {
    res.status(409).json({ error: 'You have already checked out for today.' })
    return
  }
  if (!existing.overtimeAt) await prisma.attendanceDay.update({ where: { id: existing.id }, data: { overtimeAt: now } })
  res.json(await buildMePayload(me))
}

/** POST /api/attendance/break/start */
export async function startBreak(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  const now = new Date()
  const shift = await resolveShift(me.id, me.departmentId)

  const blocked = await sessionGuard(req, me, 'break-start')
  if (blocked) {
    console.log(`[attendance-gate] BLOCKED break-start — userId=${me.id}`)
    res.status(403).json({ error: blocked })
    return
  }

  const existing = await findCurrent(me.id, shift, now)
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
  const type = req.body?.type === 'BRB' ? 'BRB' : 'BREAK'
  const dev = deviceMeta(req)
  await prisma.breakEntry.create({ data: { dayId: existing.id, startAt: now, type, startUa: dev.ua, startMobile: dev.mobile } })
  res.json(await buildMePayload(me))
}

/** POST /api/attendance/break/end */
export async function endBreak(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  const now = new Date()
  const shift = await resolveShift(me.id, me.departmentId)

  const blocked = await sessionGuard(req, me, 'break-end')
  if (blocked) {
    console.log(`[attendance-gate] BLOCKED break-end — userId=${me.id}`)
    res.status(403).json({ error: blocked })
    return
  }

  const existing = await findCurrent(me.id, shift, now)
  const open = existing?.breaks.find((b) => !b.endAt)
  if (!open) {
    res.status(409).json({ error: 'No break is running.' })
    return
  }
  const dev = deviceMeta(req)
  await prisma.breakEntry.update({ where: { id: open.id }, data: { endAt: now, endUa: dev.ua, endMobile: dev.mobile } })
  res.json(await buildMePayload(me))
}

/** 0=Sun … 6=Sat for a bare YYYY-MM-DD (weekday is timezone-independent for a plain date). */
function weekdayOfDate(dateStr: string): number {
  return DateTime.fromISO(dateStr).weekday % 7 // luxon Mon=1…Sun=7 → Sun=0…Sat=6
}

/** Is this calendar date a scheduled working day for the shift (vs a weekly off day)? */
export function isWorkingDate(dateStr: string, shift: Shift): boolean {
  return shift.workingDays.includes(weekdayOfDate(dateStr))
}

/** Inclusive list of YYYY-MM-DD strings from start to end. */
export function eachDateStr(startStr: string, endStr: string): string[] {
  const out: string[] = []
  let d = DateTime.fromISO(startStr)
  const end = DateTime.fromISO(endStr)
  while (d <= end) {
    out.push(d.toFormat('yyyy-MM-dd'))
    d = d.plus({ days: 1 })
  }
  return out
}

/** A merged per-day history row (attendance + leave/holiday + weekly off). */
function historyRow(dateStr: string, day: DayWithBreaks | undefined, offLabel: string | null, offName: string | null, shift: Shift, now: Date, todayStr?: string, remote = false) {
  // No check-in and no explicit off/holiday: a scheduled working day is ABSENT,
  // a non-working weekday is the person's recurring WEEKLY_OFF. Today's working
  // day without a check-in is NOT_YET: the day is still open, so not absent.
  const label = day?.checkInAt
    ? 'PRESENT'
    : offLabel ?? (isWorkingDate(dateStr, shift) ? (dateStr === todayStr ? 'NOT_YET' : 'ABSENT') : 'WEEKLY_OFF')
  const worked = day ? workedMinutes(day, now) : null
  return {
    date: dateStr,
    label, // PRESENT | ON_LEAVE | OFF | HOLIDAY | WEEKLY_OFF | ABSENT
    offName,
    checkIn: day?.checkInAt ? hhmm(day.checkInAt, shift) : null,
    checkOut: day?.checkOutAt ? hhmm(day.checkOutAt, shift) : null,
    workedMin: worked,
    breakMin: day ? breakMinutes(day, day.checkOutAt ?? now) : 0,
    late: day?.checkInAt ? isLate(day.checkInAt, shift) : false,
    earlyLeave: leftEarly(day?.checkOutAt, worked, shift),
    requiredMin: shift.requiredMinutes,
    completed: worked != null && worked >= shift.requiredMinutes,
    shortMin: worked == null || !day?.checkOutAt ? null : Math.max(0, shift.requiredMinutes - worked),
    note: day?.note ?? null, // TL/Admin per-day comment (feedback)
    overtimeMin: day ? overtimeInfo(day, shift, now).overtimeMin : 0,
    // Worked from home that day: marked Work From Home, or the person always works from home.
    wfh: offLabel === 'WFH' || (remote && !!day?.checkInAt),
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
    if (me.role === 'TEAM_LEAD' && (!me.departmentId || target.departmentId !== me.departmentId)) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }
  }

  const rangeKey = ((req.query.range as RangeKey) || 'month') as RangeKey
  const now = new Date()

  const target = await prisma.user.findUniqueOrThrow({ where: { id: targetId }, select: { departmentId: true, attendanceRemote: true, createdAt: true } })
  const shift = await resolveShift(targetId, target.departmentId)
  // Resolve the period in the member's own shift timezone — attendance is bucketed
  // per shift-day, so a company-tz window drifts once the two diverge (a US shift
  // vs Karachi). Keeps history in step with the team view and the live clock.
  // "Today" is the shift's own day: for a night shift at 02:00 that is still the
  // date the shift started, so the open shift shows instead of an empty page.
  const todayStr = shiftDayString(shift, now)
  const calendar = periodRange(rangeKey, { now, zone: shift.timeZone || COMPANY_TZ, start: req.query.start as string, end: req.query.end as string })
  const range = rangeKey === 'today' ? { startDate: todayStr, endDate: todayStr } : calendar
  const startValue = dbDateFromString(range.startDate)
  const endValue = dbDateFromString(range.endDate)

  const [days, leaves, holidays] = await Promise.all([
    prisma.attendanceDay.findMany({
      where: { userId: targetId, date: { gte: startValue, lte: endValue } },
      include: { breaks: { orderBy: { startAt: 'asc' } } },
    }),
    prisma.leaveDay.findMany({ where: { userId: targetId, date: { gte: startValue, lte: endValue } } }),
    prisma.holiday.findMany({ where: { date: { gte: startValue, lte: endValue } } }),
  ])

  const dayByDate = new Map(days.map((d) => [dateStringFromDb(d.date), d]))
  const leaveByDate = new Map(leaves.map((l) => [dateStringFromDb(l.date), l.type as string]))
  const holidayByDate = new Map(holidays.map((h) => [dateStringFromDb(h.date), h.name]))

  // Union of dates that have any record, plus the member's weekly off days across
  // the range — so a full week shows (we still don't fabricate absent working days).
  const dates = new Set<string>([...dayByDate.keys(), ...leaveByDate.keys(), ...holidayByDate.keys()])
  for (const ds of eachDateStr(range.startDate, range.endDate)) if (!isWorkingDate(ds, shift)) dates.add(ds)
  // Today always shows, even before check-in ("Not checked in yet"), so the page is never blank.
  if (todayStr >= range.startDate && todayStr <= range.endDate) dates.add(todayStr)
  // all=1 (My Attendance history, calendar): every day of the period up to today, so a missed
  // working day shows as Absent. Not before the person joined or before attendance started.
  if (req.query.all === '1') {
    const from = await attendanceFloor(target.createdAt, shift)
    for (const ds of eachDateStr(range.startDate, range.endDate)) if (ds >= from && ds <= todayStr) dates.add(ds)
  }
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
        todayStr,
        target.attendanceRemote,
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
      weeklyOffDays: rows.filter((r) => r.label === 'WEEKLY_OFF').length,
      holidayDays: rows.filter((r) => r.label === 'HOLIDAY').length,
      lateDays: worked.filter((r) => r.late).length,
      completedShifts: worked.filter((r) => r.completed).length,
      totalWorkedMin,
      avgCheckIn: avgCheckInMin == null ? null : minToHHmm(avgCheckInMin),
    },
  })
}

/** First day a person can be counted absent: the later of the day they joined and the first
 *  attendance record anyone has (the day attendance went live). */
let goLiveCache: { at: number; date: string | null } | null = null
async function attendanceFloor(createdAt: Date, shift: Shift): Promise<string> {
  if (!goLiveCache || Date.now() - goLiveCache.at > 3600_000) {
    const first = await prisma.attendanceDay.findFirst({ orderBy: { date: 'asc' }, select: { date: true } })
    goLiveCache = { at: Date.now(), date: first ? dateStringFromDb(first.date) : null }
  }
  const joined = shiftDayString(shift, createdAt)
  return goLiveCache.date && goLiveCache.date > joined ? goLiveCache.date : joined
}

/**
 * GET /api/attendance/register?start=&end=&department= — Team Lead (their department) or Super
 * Admin: every member x every day of the period with check in, check out, hours, status and
 * flags. Days in the future or before someone joined are null.
 */
export async function register(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.role !== 'TEAM_LEAD' && me.role !== 'SUPER_ADMIN') { res.status(403).json({ error: 'Forbidden' }); return }
  const start = String(req.query.start ?? '')
  const end = String(req.query.end ?? '')
  const re = /^\d{4}-\d{2}-\d{2}$/
  if (!re.test(start) || !re.test(end) || end < start) { res.status(400).json({ error: 'Pick a date range.' }); return }
  if (DateTime.fromISO(end).diff(DateTime.fromISO(start), 'days').days > 62) { res.status(400).json({ error: 'Pick two months or less.' }); return }
  let departmentId: string | undefined
  if (me.role === 'SUPER_ADMIN' && req.query.department) {
    const d = await prisma.department.findUnique({ where: { type: String(req.query.department) as DepartmentType } })
    departmentId = d?.id ?? '__none__'
  }
  const members = await scopedMembers(me, departmentId)
  const ids = members.map((m) => m.id)
  const now = new Date()
  const startValue = dbDateFromString(start)
  const endValue = dbDateFromString(end)
  const [shifts, days, leaves, holidays] = await Promise.all([
    prisma.attendanceShift.findMany(),
    prisma.attendanceDay.findMany({ where: { userId: { in: ids }, date: { gte: startValue, lte: endValue } }, include: { breaks: { orderBy: { startAt: 'asc' } } } }),
    prisma.leaveDay.findMany({ where: { userId: { in: ids }, date: { gte: startValue, lte: endValue } } }),
    prisma.holiday.findMany({ where: { date: { gte: startValue, lte: endValue } } }),
  ])
  const dates = eachDateStr(start, end)
  const holidayByDate = new Map(holidays.map((h) => [dateStringFromDb(h.date), h.name]))
  const out = []
  for (const m of members) {
    const shift = pickShiftFor(shifts, m.id, m.departmentId)
    const todayStr = shiftDayString(shift, now)
    const floor = await attendanceFloor(m.createdAt, shift)
    const dayBy = new Map(days.filter((d) => d.userId === m.id).map((d) => [dateStringFromDb(d.date), d]))
    const leaveBy = new Map(leaves.filter((l) => l.userId === m.id).map((l) => [dateStringFromDb(l.date), l.type as string]))
    const cells = dates.map((ds) => {
      const day = dayBy.get(ds)
      if (!day?.checkInAt && (ds > todayStr || ds < floor)) return null
      return historyRow(ds, day, leaveBy.get(ds) ?? (holidayByDate.has(ds) ? 'HOLIDAY' : null), holidayByDate.get(ds) ?? null, shift, now, todayStr, m.attendanceRemote)
    })
    const present = cells.filter((c) => c?.label === 'PRESENT')
    const ins = present.map((c) => (c!.checkIn ? shiftMinutes(c!.checkIn) : null)).filter((v): v is number => v != null)
    out.push({
      userId: m.id, name: m.name, department: m.department?.name ?? '—', departmentType: m.department?.type ?? null,
      shift: { startTime: shift.startTime, endTime: shift.endTime, requiredMinutes: shift.requiredMinutes },
      hasOverride: shifts.some((x) => x.userId === m.id),
      cells,
      totals: {
        present: present.length,
        absent: cells.filter((c) => c?.label === 'ABSENT').length,
        leave: cells.filter((c) => c?.label === 'ON_LEAVE' || c?.label === 'OFF').length,
        late: present.filter((c) => c!.late).length,
        leftEarly: present.filter((c) => c!.earlyLeave).length,
        fullShifts: present.filter((c) => c!.completed).length,
        workedMin: present.reduce((t, c) => t + (c!.workedMin ?? 0), 0),
        overtimeMin: present.reduce((t, c) => t + (c!.overtimeMin ?? 0), 0),
        avgCheckIn: ins.length ? minToHHmm(Math.round(ins.reduce((a, b) => a + b, 0) / ins.length)) : null,
      },
    })
  }
  res.json({ start, end, dates, scope: me.role === 'SUPER_ADMIN' ? 'COMPANY' : 'DEPARTMENT', members: out })
}

function minToHHmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}


/** Duration in minutes → "7h 42m" (or "" when null, e.g. a non-present day). */
function hm(min: number | null): string {
  if (min == null) return ''
  return `${Math.floor(min / 60)}h ${min % 60}m`
}

const STATUS_LABEL: Record<string, string> = {
  PRESENT: 'Present',
  ON_LEAVE: 'On Leave',
  OFF: 'Off',
  WFH: 'Work From Home',
  HOLIDAY: 'Holiday',
  WEEKLY_OFF: 'Weekly Off',
  ABSENT: 'Absent',
}

/**
 * GET /api/attendance/team.csv?range=&start=&end=&department=
 * Per-day attendance timesheet (one row per member per recorded day) for the
 * selected range. TL is scoped to their department; Super Admin sees all or one
 * department. Mirrors teamView's per-member shift-timezone windowing so
 * cross-timezone (e.g. US-shift) members aren't dropped after Karachi midnight.
 */
export async function exportTeamAttendanceCsv(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.role !== 'TEAM_LEAD' && me.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const rangeKey = ((req.query.range as RangeKey) || 'month') as RangeKey
  const start = req.query.start as string
  const end = req.query.end as string
  const now = new Date()

  // Super Admin may narrow to one department; TL stays scoped to their own.
  const deptType = req.query.department as string | undefined
  let departmentId: string | undefined
  let scopeLabel = me.role === 'SUPER_ADMIN' ? 'company' : (me.department?.type ?? 'team')
  if (me.role === 'SUPER_ADMIN' && deptType) {
    const d = await prisma.department.findUnique({ where: { type: deptType as DepartmentType } })
    departmentId = d?.id
    scopeLabel = deptType
  }

  const members = await scopedMembers(me, departmentId)
  const memberIds = members.map((m) => m.id)
  const shifts = await prisma.attendanceShift.findMany()

  // Resolve the period per member in their own shift timezone, then query the
  // widest union window and filter each record back into its member's window.
  const shiftByUser = new Map(members.map((m) => [m.id, pickShiftFor(shifts, m.id, m.departmentId)]))
  const rangeByUser = new Map(members.map((m) => [m.id, periodRange(rangeKey, { now, zone: shiftByUser.get(m.id)!.timeZone || COMPANY_TZ, start, end })]))
  const allStarts = [...rangeByUser.values()].map((r) => r.startDate).sort()
  const allEnds = [...rangeByUser.values()].map((r) => r.endDate).sort()
  const companyRange = periodRange(rangeKey, { now, start, end }) // for the filename label
  const startValue = dbDateFromString(allStarts[0] ?? companyRange.startDate)
  const endValue = dbDateFromString(allEnds[allEnds.length - 1] ?? companyRange.endDate)

  const [days, leaves, holidays] = await Promise.all([
    prisma.attendanceDay.findMany({ where: { userId: { in: memberIds }, date: { gte: startValue, lte: endValue } }, include: { breaks: { orderBy: { startAt: 'asc' } } } }),
    prisma.leaveDay.findMany({ where: { userId: { in: memberIds }, date: { gte: startValue, lte: endValue } } }),
    prisma.holiday.findMany({ where: { date: { gte: startValue, lte: endValue } } }),
  ])

  const daysByUser = new Map<string, DayWithBreaks[]>()
  for (const d of days) daysByUser.set(d.userId, [...(daysByUser.get(d.userId) ?? []), d])
  const leavesByUser = new Map<string, Map<string, string>>()
  for (const l of leaves) {
    const m = leavesByUser.get(l.userId) ?? new Map<string, string>()
    m.set(dateStringFromDb(l.date), l.type as string)
    leavesByUser.set(l.userId, m)
  }
  const holidayByDate = new Map(holidays.map((h) => [dateStringFromDb(h.date), h.name]))

  const rows: (string | number)[][] = [['Date', 'Member', 'Department', 'Status', 'Check-in', 'Check-out', 'Worked', 'Break', 'Late', 'Overtime']]

  for (const member of members) {
    const shift = shiftByUser.get(member.id)!
    const r = rangeByUser.get(member.id)!
    const inWindow = (ds: string) => ds >= r.startDate && ds <= r.endDate
    const dayByDate = new Map((daysByUser.get(member.id) ?? []).map((d) => [dateStringFromDb(d.date), d]))
    const leaveByDate = leavesByUser.get(member.id) ?? new Map<string, string>()

    // Recorded dates within the member's own window, plus their weekly off days —
    // no fabricated absents for missed working days.
    const dates = new Set<string>()
    for (const ds of dayByDate.keys()) if (inWindow(ds)) dates.add(ds)
    for (const ds of leaveByDate.keys()) if (inWindow(ds)) dates.add(ds)
    for (const ds of holidayByDate.keys()) if (inWindow(ds)) dates.add(ds)
    for (const ds of eachDateStr(r.startDate, r.endDate)) if (!isWorkingDate(ds, shift)) dates.add(ds)

    for (const ds of [...dates].sort()) {
      const day = dayByDate.get(ds)
      const offLabel = leaveByDate.get(ds) ?? (holidayByDate.has(ds) ? 'HOLIDAY' : null)
      const row = historyRow(ds, day, offLabel, holidayByDate.get(ds) ?? null, shift, now)
      rows.push([
        ds,
        member.name,
        member.department?.name ?? '—',
        STATUS_LABEL[row.label] ?? row.label,
        day?.checkInAt ? clockLabel(day.checkInAt, shift) : '',
        day?.checkOutAt ? clockLabel(day.checkOutAt, shift) : '',
        hm(row.workedMin),
        row.label === 'PRESENT' ? hm(row.breakMin) : '',
        row.label === 'PRESENT' ? (row.late ? 'Yes' : 'No') : '',
        row.overtimeMin ? hm(row.overtimeMin) : '',
      ])
    }
  }

  const filename = `attendance-${scopeLabel}-${companyRange.startDate}_to_${companyRange.endDate}.csv`
  sendCsv(res, filename, rows)
}

/**
 * Active roster in the caller's scope. A Team Lead is always confined to their
 * own department. A Super Admin sees every department by default, or a single
 * department when `departmentId` is supplied (the /team department filter).
 */
async function scopedMembers(me: Awaited<ReturnType<typeof loadUser>>, departmentId?: string) {
  if (me.role === 'SUPER_ADMIN') {
    return prisma.user.findMany({
      where: { isActive: true, status: 'ACTIVE', ...(departmentId ? { departmentId } : {}) },
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
  const start = req.query.start as string
  const end = req.query.end as string
  const now = new Date()
  const range = periodRange(rangeKey, { now, start, end }) // company-tz window, for the header label

  // Super Admin may narrow the whole view to one department; TL ignores this and
  // stays scoped to their own department inside scopedMembers.
  const deptType = req.query.department as string | undefined
  let departmentId: string | undefined
  if (me.role === 'SUPER_ADMIN' && deptType) {
    const d = await prisma.department.findUnique({ where: { type: deptType as DepartmentType } })
    departmentId = d?.id
  }

  const members = await scopedMembers(me, departmentId)
  const memberIds = members.map((m) => m.id)
  const shifts = await prisma.attendanceShift.findMany()

  // Resolve the period in each member's OWN shift timezone. Attendance is bucketed
  // per shift-day (shiftDayString), so a single company-tz window would miss a
  // member's records once the two diverge — e.g. a US-shift team after Karachi
  // midnight, where company "today" is already tomorrow. That mismatch is why the
  // live board can show someone working while the period columns read zero.
  const shiftByUser = new Map(members.map((m) => [m.id, pickShiftFor(shifts, m.id, m.departmentId)]))
  const rangeByUser = new Map(members.map((m) => [m.id, periodRange(rangeKey, { now, zone: shiftByUser.get(m.id)!.timeZone || COMPANY_TZ, start, end })]))
  const starts = [...rangeByUser.values()].map((r) => r.startDate).sort()
  const ends = [...rangeByUser.values()].map((r) => r.endDate).sort()
  const startValue = dbDateFromString(starts[0])
  const endValue = dbDateFromString(ends[ends.length - 1])

  const [days, leaves] = await Promise.all([
    prisma.attendanceDay.findMany({ where: { userId: { in: memberIds }, date: { gte: startValue, lte: endValue } }, include: { breaks: true } }),
    prisma.leaveDay.findMany({ where: { userId: { in: memberIds }, date: { gte: startValue, lte: endValue } } }),
  ])

  // Live "today" per member (their shift-day), same anchoring as the board.
  const todayDateByUser = new Map([...shiftByUser].map(([id, sh]) => [id, shiftDayString(sh, now)]))
  const todayValues = [...new Set(todayDateByUser.values())].map(dbDateFromString)
  const [todayDays, todayLeaves] = await Promise.all([
    prisma.attendanceDay.findMany({
      where: { userId: { in: memberIds }, date: { in: todayValues } },
      include: { breaks: true },
    }),
    prisma.leaveDay.findMany({ where: { userId: { in: memberIds }, date: { in: todayValues }, type: 'WFH' }, select: { userId: true, date: true } }),
  ])
  const wfhToday = new Set(todayLeaves.filter((l) => dateStringFromDb(l.date) === todayDateByUser.get(l.userId)).map((l) => l.userId))

  // Keep only records inside each member's own shift-tz window.
  const inRange = (userId: string, date: Date): boolean => {
    const ds = dateStringFromDb(date)
    const r = rangeByUser.get(userId)!
    return ds >= r.startDate && ds <= r.endDate
  }
  const daysByUser = new Map<string, DayWithBreaks[]>()
  for (const d of days) {
    if (!inRange(d.userId, d.date)) continue
    const list = daysByUser.get(d.userId) ?? []
    list.push(d)
    daysByUser.set(d.userId, list)
  }
  const leaveCount = new Map<string, number>()
  for (const l of leaves) if (inRange(l.userId, l.date) && l.type !== 'WFH') leaveCount.set(l.userId, (leaveCount.get(l.userId) ?? 0) + 1)
  const todayByUser = new Map<string, DayWithBreaks>()
  for (const d of todayDays) {
    if (dateStringFromDb(d.date) === todayDateByUser.get(d.userId)) todayByUser.set(d.userId, d)
  }

  // Late sign-ins this calendar month (company tz) for the 3-per-month limit flag.
  const monthStartStr = DateTime.fromJSDate(now).setZone(COMPANY_TZ).startOf('month').toISODate()!
  const lateRows = await prisma.attendanceViolation.findMany({
    where: { userId: { in: memberIds }, kind: 'LATE_SIGNIN', date: { gte: dbDateFromString(monthStartStr) } },
    select: { userId: true },
  })
  const lateCountByUser = new Map<string, number>()
  for (const v of lateRows) lateCountByUser.set(v.userId, (lateCountByUser.get(v.userId) ?? 0) + 1)

  const rows = members.map((m) => {
    const shift = shiftByUser.get(m.id)!
    const md = daysByUser.get(m.id) ?? []
    const present = md.filter((d) => d.checkInAt)
    const totalWorkedMin = present.reduce((s, d) => s + (workedMinutes(d, now) ?? 0), 0)
    const totalBreakMin = present.reduce((s, d) => s + breakMinutes(d, d.checkOutAt ?? now), 0)
    const totalOvertimeMin = present.reduce((s, d) => s + overtimeInfo(d, shift, now).overtimeMin, 0)
    const lateDays = present.filter((d) => d.checkInAt && isLate(d.checkInAt, shift)).length
    const completedShifts = present.filter((d) => { const w = workedMinutes(d, now); return w != null && w >= shift.requiredMinutes }).length
    const inMins = present.filter((d) => d.checkInAt).map((d) => localMinutes(d.checkInAt!, shift))
    const avgCheckIn = inMins.length ? minToHHmm(Math.round(inMins.reduce((s, v) => s + v, 0) / inMins.length)) : null
    const today = todayByUser.get(m.id) ?? null
    const brbMinToday = today ? breakMinutesOfType(today, 'BRB', now) : 0
    const regBreakToday = today ? breakMinutesOfType(today, 'BREAK', now) : 0
    const lateThisMonth = lateCountByUser.get(m.id) ?? 0
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
      totalOvertimeMin,
      todayOvertime: !!today?.overtimeAt && !today.checkOutAt,
      avgCheckIn,
      shiftRequiredMin: shift.requiredMinutes,
      hasOverride: shifts.some((s) => s.userId === m.id),
      todayState: liveState(today),
      todayCheckIn: today?.checkInAt ? clockLabel(today.checkInAt, shift) : null,
      // The break running now (for the team lead's "End break").
      openBreak: (() => { const b = today?.breaks.find((x) => !x.endAt); return b ? { id: b.id, type: b.type, since: clockLabel(b.startAt, shift), minutes: Math.max(0, Math.round((Date.now() - b.startAt.getTime()) / 60000)) } : null })(),
      brbMinToday,
      regBreakToday,
      brbAllowanceMin: shift.brbAllowanceMin,
      breakAllowanceMin: shift.breakAllowanceMin,
      brbOverToday: brbMinToday > shift.brbAllowanceMin,
      breakOverToday: regBreakToday > shift.breakAllowanceMin,
      lateThisMonth,
      graceLimitExceeded: lateThisMonth > 3,
      // Work from home: today marked WFH, or always works from home (check-in from any network).
      remote: m.attendanceRemote,
      workModeToday: (wfhToday.has(m.id) ? 'WFH' : m.attendanceRemote ? 'REMOTE' : null) as 'WFH' | 'REMOTE' | null,
      wfhDays: leaves.filter((l) => l.userId === m.id && l.type === 'WFH' && inRange(l.userId, l.date)).length,
    }
  })

  const board = rows.map((r) => ({ userId: r.userId, name: r.name, department: r.department, state: r.todayState, checkIn: r.todayCheckIn, workMode: r.workModeToday, openBreak: r.openBreak }))
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
  if (me.role === 'TEAM_LEAD' && !me.departmentId) {
    res.status(403).json({ error: 'Your account has no department yet' })
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

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm')
const shiftSchema = z.object({
  startTime: HHMM,
  endTime: HHMM,
  dayTimes: z.record(z.string().regex(/^[0-6]$/), z.object({ startTime: HHMM, endTime: HHMM })).nullable().optional(),
  graceMin: z.number().int().min(0).max(120),
  requiredMinutes: z.number().int().min(0).max(1440),
  brbAllowanceMin: z.number().int().min(0).max(120),
  breakAllowanceMin: z.number().int().min(0).max(600),
  // Break cut-off in minutes (0 = never). Optional: older screens do not send them.
  breakCutoffMin: z.number().int().min(0).max(600).optional(),
  brbCutoffMin: z.number().int().min(0).max(240).optional(),
  workingDays: z.array(z.number().int().min(0).max(6)).min(1, 'Pick at least one working day').max(7),
  timeZone: z
    .string()
    .refine((tz) => DateTime.local().setZone(tz).isValid, 'Unknown time zone')
    .nullable()
    .optional(),
})

/** Prisma write data from validated shift input — an empty/absent dayTimes stores SQL NULL. */
function shiftWriteData(d: z.infer<typeof shiftSchema>) {
  const hasDays = d.dayTimes && Object.keys(d.dayTimes).length > 0
  return { ...d, dayTimes: hasDays ? (d.dayTimes as Prisma.InputJsonValue) : Prisma.DbNull }
}

const outShift = (s: ShiftRow): Shift => ({
  startTime: s.startTime,
  endTime: s.endTime,
  dayTimes: asDayTimes(s.dayTimes),
  graceMin: s.graceMin,
  requiredMinutes: s.requiredMinutes,
  brbAllowanceMin: s.brbAllowanceMin,
  breakAllowanceMin: s.breakAllowanceMin,
  breakCutoffMin: s.breakCutoffMin,
  brbCutoffMin: s.brbCutoffMin,
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
  // A team lead with no department would otherwise overwrite the company-wide default.
  if (me.role === 'TEAM_LEAD' && !me.departmentId) {
    res.status(403).json({ error: 'Your account has no department yet' })
    return
  }
  const { departmentId } = await editableShiftScope(me)
  // Null-department can't use upsert on a unique-nullable key — find-then-write.
  const existing = await prisma.attendanceShift.findFirst({ where: { departmentId, userId: null } })
  const data = shiftWriteData(parsed.data)
  const shift = existing
    ? await prisma.attendanceShift.update({ where: { id: existing.id }, data })
    : await prisma.attendanceShift.create({ data: { departmentId, ...data } })
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
  if (me.role === 'TEAM_LEAD' && (!me.departmentId || target.departmentId !== me.departmentId)) {
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
  if (me.role === 'TEAM_LEAD' && (!me.departmentId || target.departmentId !== me.departmentId)) {
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
    ? await prisma.attendanceShift.update({ where: { id: existing.id }, data: shiftWriteData(parsed.data) })
    : await prisma.attendanceShift.create({ data: { userId, ...shiftWriteData(parsed.data) } })
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
  if (me.role === 'TEAM_LEAD' && (!me.departmentId || target.departmentId !== me.departmentId)) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  await prisma.attendanceShift.deleteMany({ where: { userId } })
  res.status(204).end()
}

const timeOrNull = z.union([z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), z.literal(''), z.null()]).optional()
const correctionSchema = z.object({ checkIn: timeOrNull, checkOut: timeOrNull, overtime: timeOrNull, note: z.string().max(1000).nullable().optional() })

/**
 * Combine a "YYYY-MM-DD" (the attendance day) + "HH:mm" into a UTC instant,
 * anchored in the shift's timezone. For an overnight shift a time in the
 * post-midnight portion (before the middle of the off-duty gap) belongs to the NEXT calendar
 * day, so it is rolled forward — e.g. a 04:00 check-out on a 19:00–04:00 shift.
 */
function instantFrom(dateStr: string, hhmmStr: string, baseShift: Shift): Date {
  const shift = baseShift.dayTimes ? shiftForDate(baseShift, dateStr) : baseShift
  const zone = shift.timeZone || COMPANY_TZ
  let dt = DateTime.fromISO(`${dateStr}T${hhmmStr}`, { zone })
  if (belongsToPreviousShift(shift, shiftMinutes(hhmmStr))) {
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
  if (me.role === 'TEAM_LEAD' && (!me.departmentId || target.departmentId !== me.departmentId)) {
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

  const data: { checkInAt?: Date | null; checkOutAt?: Date | null; overtimeAt?: Date | null; note?: string | null } = {}
  if (parsed.data.checkIn !== undefined) data.checkInAt = parsed.data.checkIn ? instantFrom(date, parsed.data.checkIn, shift) : null
  if (parsed.data.checkOut !== undefined) data.checkOutAt = parsed.data.checkOut ? instantFrom(date, parsed.data.checkOut, shift) : null
  // When overtime started ("" clears it: no overtime that day).
  if (parsed.data.overtime !== undefined) data.overtimeAt = parsed.data.overtime ? instantFrom(date, parsed.data.overtime, shift) : null
  if (parsed.data.note !== undefined) data.note = parsed.data.note?.trim() || null

  const finalIn = data.checkInAt !== undefined ? data.checkInAt : existing?.checkInAt ?? null
  const finalOut = data.checkOutAt !== undefined ? data.checkOutAt : existing?.checkOutAt ?? null
  if (finalIn && finalOut && finalOut <= finalIn) {
    res.status(400).json({ error: 'Check-out must be after check-in.' })
    return
  }
  const finalOt = data.overtimeAt !== undefined ? data.overtimeAt : existing?.overtimeAt ?? null
  if (finalOt && ((finalIn && finalOt <= finalIn) || (finalOut && finalOt >= finalOut))) {
    res.status(400).json({ error: 'Overtime must start after check-in and before check-out.' })
    return
  }

  const day = await prisma.attendanceDay.upsert({
    where: { userId_date: { userId, date: dateValue } },
    update: data,
    create: { userId, date: dateValue, checkInAt: data.checkInAt ?? null, checkOutAt: data.checkOutAt ?? null, overtimeAt: data.overtimeAt ?? null, note: data.note ?? null },
  })
  // A break still running when the day is closed ends at the check-out (like the automatic check-out).
  if (finalOut && existing) {
    await prisma.breakEntry.updateMany({ where: { dayId: day.id, endAt: null, startAt: { lt: finalOut } }, data: { endAt: finalOut, editedById: me.id, editedAt: new Date() } })
  }

  await prisma.auditLog.create({
    data: {
      userId: me.id,
      entityType: 'AttendanceDay',
      entityId: day.id,
      action: existing ? 'UPDATE' : 'CREATE',
      before: existing ? { checkInAt: existing.checkInAt?.toISOString() ?? null, checkOutAt: existing.checkOutAt?.toISOString() ?? null, overtimeAt: existing.overtimeAt?.toISOString() ?? null } : undefined,
      after: { checkInAt: day.checkInAt?.toISOString() ?? null, checkOutAt: day.checkOutAt?.toISOString() ?? null, overtimeAt: day.overtimeAt?.toISOString() ?? null },
    },
  })

  res.json({
    day: {
      date,
      checkIn: day.checkInAt ? hhmm(day.checkInAt, shift) : null,
      checkOut: day.checkOutAt ? hhmm(day.checkOutAt, shift) : null,
      overtime: day.overtimeAt ? hhmm(day.overtimeAt, shift) : null,
      note: day.note ?? null,
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
  if (me.role === 'TEAM_LEAD' && (!me.departmentId || target.departmentId !== me.departmentId)) {
    res.status(403).json({ error: 'Forbidden' })
    return null
  }
  return target
}

const leaveSchema = z.object({
  type: z.enum(['ON_LEAVE', 'OFF', 'WFH']),
  note: z.string().max(300).optional(),
  /** Last date of a run (inclusive), e.g. work from home Monday to Friday. Only the person's working days are marked. */
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})
const MAX_LEAVE_RUN_DAYS = 62

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
  const { type, note, until } = parsed.data
  if (type === 'WFH' && me.role === 'TEAM_LEAD' && userId === me.id) {
    res.status(403).json({ error: 'A Team Lead cannot mark their own work from home. Ask a Super Admin.' })
    return
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: 'Pick a valid date.' })
    return
  }
  // One date, or a run of dates (only the person's working days in it).
  let dates = [date]
  if (until && until !== date) {
    if (until < date) {
      res.status(400).json({ error: 'The "until" date must be on or after the first date.' })
      return
    }
    const all = eachDateStr(date, until)
    if (all.length > MAX_LEAVE_RUN_DAYS) {
      res.status(400).json({ error: `Mark at most ${MAX_LEAVE_RUN_DAYS} days at a time.` })
      return
    }
    const shift = await resolveShift(userId, target.departmentId)
    dates = all.filter((d) => isWorkingDate(d, shift))
    if (dates.length === 0) {
      res.status(400).json({ error: 'There are no working days in those dates.' })
      return
    }
  }
  const saved = await prisma.$transaction(
    dates.map((d) => {
      const dateValue = dbDateFromString(d)
      return prisma.leaveDay.upsert({
        where: { userId_date: { userId, date: dateValue } },
        update: { type, note: note ?? null },
        create: { userId, date: dateValue, type, note: note ?? null },
      })
    }),
  )
  await prisma.auditLog.create({
    data: { userId: me.id, entityType: 'LeaveDay', entityId: saved[0].id, action: 'UPDATE', after: { userId, date, until: until ?? date, days: dates.length, type } },
  })
  res.json({ leave: { date, type, note: note ?? '' }, dates })
}

/**
 * PUT /api/attendance/:userId/remote { remote } — TL (own department) or Super Admin sets
 * "always works from home": the person can check in and out from any network, every day.
 * For some days only, mark those days Work From Home instead.
 */
export async function setRemote(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  const { userId } = req.params
  const target = await requireManageableTarget(me, userId, res)
  if (!target) return
  if (me.role === 'TEAM_LEAD' && userId === me.id) {
    res.status(403).json({ error: 'A Team Lead cannot change their own work from home setting. Ask a Super Admin.' })
    return
  }
  const remote = req.body?.remote
  if (typeof remote !== 'boolean') {
    res.status(400).json({ error: 'remote (true or false) is required' })
    return
  }
  await prisma.user.update({ where: { id: userId }, data: { attendanceRemote: remote } })
  await prisma.auditLog.create({
    data: { userId: me.id, entityType: 'User', entityId: userId, action: 'UPDATE', after: { attendanceRemote: remote } },
  })
  res.json({ userId, remote })
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

// ------------------------------------------------------------------ breaks, edited by team leads
// E-commerce, Oct 2026: "access of breaks of our employees, and any other issue like overtime or a
// break someone forgot to end". A team lead (own department) or a Super Admin can see a day's
// breaks, end one still running, change its times or kind, add a missed one, or delete a wrong
// one. Every change is in the activity log and the person is told.

const breakView = (b: { id: string; type: string; startAt: Date; endAt: Date | null; autoEnded: boolean; editedAt: Date | null }, shift: Shift, now: Date) => ({
  id: b.id,
  type: b.type,
  start: hhmm(b.startAt, shift),
  end: b.endAt ? hhmm(b.endAt, shift) : null,
  minutes: Math.max(0, Math.round(((b.endAt ?? now).getTime() - b.startAt.getTime()) / 60000)),
  running: !b.endAt,
  autoEnded: b.autoEnded,
  edited: !!b.editedAt,
})

async function dayForEdit(req: AuthedRequest, res: Response, userId: string, date: string) {
  const me = await loadUser(req.user!.id)
  const target = await requireManageableTarget(me, userId, res)
  if (!target) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { res.status(400).json({ error: 'Bad date' }); return null }
  const shift = await resolveShift(userId, target.departmentId)
  const day = await prisma.attendanceDay.findUnique({ where: { userId_date: { userId, date: dbDateFromString(date) } }, include: { breaks: { orderBy: { startAt: 'asc' } } } })
  return { me, shift, day }
}

/** GET /api/attendance/:userId/:date/breaks — the day's breaks and times, for a team lead to fix. */
export async function getDayBreaks(req: AuthedRequest, res: Response): Promise<void> {
  const { userId, date } = req.params
  const got = await dayForEdit(req, res, userId, date)
  if (!got) return
  const { shift, day } = got
  const now = new Date()
  res.json({
    date,
    checkIn: day?.checkInAt ? hhmm(day.checkInAt, shift) : null,
    checkOut: day?.checkOutAt ? hhmm(day.checkOutAt, shift) : null,
    overtime: day?.overtimeAt ? hhmm(day.overtimeAt, shift) : null,
    breaks: (day?.breaks ?? []).map((b) => breakView(b, shift, now)),
    allowance: { breakMin: shift.breakAllowanceMin, brbMin: shift.brbAllowanceMin, breakCutoffMin: shift.breakCutoffMin, brbCutoffMin: shift.brbCutoffMin },
  })
}

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const breakInput = z.object({
  type: z.enum(['BREAK', 'BRB']).optional(),
  start: z.string().regex(HHMM_RE, 'Use HH:mm').optional(),
  /** "HH:mm", or "now" to end a break that is still running. */
  end: z.union([z.string().regex(HHMM_RE, 'Use HH:mm'), z.literal('now')]).optional(),
})

/** The break's new times must sit inside the working day and not run into another break. */
function checkBreakTimes(start: Date, end: Date | null, day: { checkInAt: Date | null; checkOutAt: Date | null; breaks: { id: string; startAt: Date; endAt: Date | null }[] }, selfId: string | null, now: Date): string | null {
  if (end && end <= start) return 'The break must end after it starts.'
  if (day.checkInAt && start < day.checkInAt) return 'The break cannot start before check-in.'
  if (day.checkOutAt && (end ?? start) > day.checkOutAt) return 'The break cannot end after check-out.'
  if ((end ?? start) > new Date(now.getTime() + 60_000)) return 'The break cannot end in the future.'
  const until = end ?? now
  const clash = day.breaks.find((b) => b.id !== selfId && b.startAt < until && (b.endAt ?? now) > start)
  return clash ? 'This overlaps another break on that day.' : null
}

async function tellPerson(userId: string, editorName: string, date: string, what: string) {
  await prisma.notification.create({
    data: { userId, type: 'ATTENDANCE_EDITED', title: `${editorName} changed your attendance for ${date}`, body: what, link: '/app/attendance/me' },
  }).catch(() => undefined)
}

/** POST /api/attendance/:userId/:date/breaks { type, start, end } — add a break the person did not log. */
export async function addDayBreak(req: AuthedRequest, res: Response): Promise<void> {
  const { userId, date } = req.params
  const got = await dayForEdit(req, res, userId, date)
  if (!got) return
  const { me, shift, day } = got
  if (!day?.checkInAt) { res.status(400).json({ error: 'There is no check-in on that day.' }); return }
  const p = breakInput.safeParse(req.body)
  if (!p.success || !p.data.start || !p.data.end || p.data.end === 'now') { res.status(400).json({ error: 'Give the start and end times (HH:mm).' }); return }
  const now = new Date()
  const start = instantFrom(date, p.data.start, shift)
  const end = instantFrom(date, p.data.end, shift)
  const bad = checkBreakTimes(start, end, day, null, now)
  if (bad) { res.status(400).json({ error: bad }); return }
  const type = p.data.type ?? 'BREAK'
  const b = await prisma.breakEntry.create({ data: { dayId: day.id, type, startAt: start, endAt: end, editedById: me.id, editedAt: now } })
  await prisma.auditLog.create({ data: { userId: me.id, entityType: 'BreakEntry', entityId: b.id, action: 'CREATE', after: { userId, date, type, start: p.data.start, end: p.data.end } } })
  await tellPerson(userId, me.name, date, `A ${type === 'BRB' ? 'BRB' : 'break'} was added: ${p.data.start} to ${p.data.end}.`)
  res.status(201).json({ break: breakView(b, shift, now) })
}

async function breakForEdit(req: AuthedRequest, res: Response) {
  const b = await prisma.breakEntry.findUnique({ where: { id: req.params.id }, include: { day: { include: { breaks: true } } } })
  if (!b) { res.status(404).json({ error: 'Break not found' }); return null }
  const me = await loadUser(req.user!.id)
  const target = await requireManageableTarget(me, b.day.userId, res)
  if (!target) return null
  const shift = await resolveShift(b.day.userId, target.departmentId)
  return { me, b, shift, date: dateStringFromDb(b.day.date) }
}

/** PATCH /api/attendance/breaks/:id { type?, start?, end? ("now" ends a running break) } */
export async function updateBreak(req: AuthedRequest, res: Response): Promise<void> {
  const got = await breakForEdit(req, res)
  if (!got) return
  const { me, b, shift, date } = got
  const p = breakInput.safeParse(req.body)
  if (!p.success || (!p.data.type && !p.data.start && !p.data.end)) { res.status(400).json({ error: 'Nothing to change.' }); return }
  const now = new Date()
  const start = p.data.start ? instantFrom(date, p.data.start, shift) : b.startAt
  const end = p.data.end === 'now' ? now : p.data.end ? instantFrom(date, p.data.end, shift) : b.endAt
  const bad = checkBreakTimes(start, end, b.day, b.id, now)
  if (bad) { res.status(400).json({ error: bad }); return }
  const type = p.data.type ?? b.type
  const next = await prisma.breakEntry.update({ where: { id: b.id }, data: { type, startAt: start, endAt: end, editedById: me.id, editedAt: now } })
  const was = `${hhmm(b.startAt, shift)} to ${b.endAt ? hhmm(b.endAt, shift) : 'still running'}`
  const is = `${hhmm(start, shift)} to ${end ? hhmm(end, shift) : 'still running'}`
  await prisma.auditLog.create({
    data: { userId: me.id, entityType: 'BreakEntry', entityId: b.id, action: 'UPDATE', before: { type: b.type, startAt: b.startAt.toISOString(), endAt: b.endAt?.toISOString() ?? null }, after: { type, startAt: start.toISOString(), endAt: end?.toISOString() ?? null } },
  })
  await tellPerson(b.day.userId, me.name, date, `${type === 'BRB' ? 'BRB' : 'Break'} ${was} is now ${is}${type !== b.type ? ` (now a ${type === 'BRB' ? 'BRB' : 'break'})` : ''}.`)
  res.json({ break: breakView(next, shift, now) })
}

/** DELETE /api/attendance/breaks/:id — remove a break logged by mistake. */
export async function deleteBreak(req: AuthedRequest, res: Response): Promise<void> {
  const got = await breakForEdit(req, res)
  if (!got) return
  const { me, b, shift, date } = got
  await prisma.breakEntry.delete({ where: { id: b.id } })
  await prisma.auditLog.create({ data: { userId: me.id, entityType: 'BreakEntry', entityId: b.id, action: 'DELETE', before: { userId: b.day.userId, date, type: b.type, startAt: b.startAt.toISOString(), endAt: b.endAt?.toISOString() ?? null } } })
  await tellPerson(b.day.userId, me.name, date, `A ${b.type === 'BRB' ? 'BRB' : 'break'} (${hhmm(b.startAt, shift)} to ${b.endAt ? hhmm(b.endAt, shift) : 'still running'}) was removed.`)
  res.status(204).end()
}
