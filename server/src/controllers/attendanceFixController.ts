import type { Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { dbDateFromString, dateStringFromDb } from '../lib/time'
import { shiftDayString } from '../lib/shiftDay'
import { resolveShift, isWorkingDate, instantFrom, applyDayCorrection } from './attendanceController'
import { approversFor, canDecide } from './wfhRequestController'

/**
 * Attendance fix requests (Nov 2026): someone forgot to check in (or out) on a working day. The day shows as
 * Absent (or without a check-out) on their history; they ask for the right times with a reason, their Team
 * Lead (or a Super Admin, for a lead or a department with no lead) gets a notice and approves or rejects.
 * Approved: the times go on the day exactly like a correction by the lead (audited). Same people decide as
 * for work from home (wfhRequestController: approversFor, canDecide). Nobody decides their own request.
 *
 * Rules: the day is today or in the last 31 days; one waiting request per day; a day marked leave, off or a
 * holiday is not asked for (the lead removes the mark first).
 */

const MAX_BACK_DAYS = 31
const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

const include = { user: { select: { id: true, name: true, departmentId: true, role: true } }, decidedBy: { select: { name: true } } } as const
const loadRequest = (id: string) => prisma.attendanceFixRequest.findUnique({ where: { id }, include })
type Loaded = NonNullable<Awaited<ReturnType<typeof loadRequest>>>

function view(r: Loaded) {
  return {
    id: r.id,
    userId: r.userId,
    name: r.user.name,
    date: dateStringFromDb(r.date),
    checkIn: r.checkIn,
    checkOut: r.checkOut,
    reason: r.reason,
    status: r.status,
    decidedBy: r.decidedBy?.name ?? null,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionNote: r.decisionNote,
    createdAt: r.createdAt.toISOString(),
  }
}

const day = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
const times = (r: { checkIn: string; checkOut: string | null }) => (r.checkOut ? `${r.checkIn} to ${r.checkOut}` : `checked in ${r.checkIn}`)

const createSchema = z.object({
  date: z.string().regex(DATE, 'Pick the day.'),
  checkIn: z.string().regex(TIME, 'Check-in time as HH:mm.'),
  checkOut: z.union([z.string().regex(TIME, 'Check-out time as HH:mm.'), z.literal(''), z.null()]).optional(),
  reason: z.string().trim().min(3, 'Give a short reason.').max(500),
})

/** POST /api/attendance/fix-requests { date, checkIn, checkOut?, reason } — ask for a day's times to be put in. */
export async function createFixRequest(req: AuthedRequest, res: Response): Promise<void> {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' })
    return
  }
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { id: true, name: true, role: true, departmentId: true } })
  const { date, checkIn, reason } = parsed.data
  const checkOut = parsed.data.checkOut || null
  const shift = await resolveShift(me.id, me.departmentId)
  const today = shiftDayString(shift)
  if (date > today) {
    res.status(400).json({ error: 'You cannot ask for a day that has not come yet.' })
    return
  }
  const oldest = new Date(Date.parse(today + 'T00:00:00Z') - MAX_BACK_DAYS * 86_400_000).toISOString().slice(0, 10)
  if (date < oldest) {
    res.status(400).json({ error: `Only the last ${MAX_BACK_DAYS} days can be asked for. Ask your Team Lead about older days.` })
    return
  }
  const dateValue = dbDateFromString(date)
  const [leave, holiday, existing] = await Promise.all([
    prisma.leaveDay.findUnique({ where: { userId_date: { userId: me.id, date: dateValue } }, select: { type: true } }),
    prisma.holiday.findFirst({ where: { date: dateValue }, select: { name: true } }),
    prisma.attendanceDay.findUnique({ where: { userId_date: { userId: me.id, date: dateValue } }, select: { checkInAt: true } }),
  ])
  if ((leave && leave.type !== 'WFH') || holiday) {
    res.status(400).json({ error: `That day is marked ${holiday ? `a holiday (${holiday.name})` : leave!.type === 'OFF' ? 'off' : 'leave'}. Ask your Team Lead to change the mark first.` })
    return
  }
  if (!isWorkingDate(date, shift) && !existing?.checkInAt) {
    res.status(400).json({ error: 'That is not one of your working days.' })
    return
  }
  if (checkOut && instantFrom(date, checkOut, shift) <= instantFrom(date, checkIn, shift)) {
    res.status(400).json({ error: 'Check-out must be after check-in.' })
    return
  }
  const waiting = await prisma.attendanceFixRequest.findFirst({ where: { userId: me.id, date: dateValue, status: 'PENDING' }, select: { id: true } })
  if (waiting) {
    res.status(409).json({ error: 'You already asked for this day. Take that request back to change it.' })
    return
  }
  const created = await prisma.attendanceFixRequest.create({ data: { userId: me.id, date: dateValue, checkIn, checkOut, reason } })
  const approvers = await approversFor(me)
  if (approvers.length) {
    await prisma.notification.createMany({
      data: approvers.map((userId) => ({
        userId,
        actorId: me.id,
        type: 'ATTENDANCE_FIX_REQUESTED' as const,
        title: `${me.name} forgot to check in on ${day(date)}`,
        body: `Asks for ${times({ checkIn, checkOut })}: ${reason.slice(0, 140)}`,
        link: '/app/attendance/team?fixes=1',
        entityType: 'AttendanceFixRequest',
        entityId: created.id,
      })),
    })
  }
  res.status(201).json({ request: view((await loadRequest(created.id))!) })
}

/** GET /api/attendance/fix-requests/mine — my requests, newest first. */
export async function myFixRequests(req: AuthedRequest, res: Response): Promise<void> {
  const rows = await prisma.attendanceFixRequest.findMany({ where: { userId: req.user!.id }, include, orderBy: { createdAt: 'desc' }, take: 40 })
  res.json({ requests: rows.map(view) })
}

/** DELETE /api/attendance/fix-requests/:id — take back my request while it is still waiting. */
export async function cancelFixRequest(req: AuthedRequest, res: Response): Promise<void> {
  const r = await loadRequest(req.params.id)
  if (!r || r.userId !== req.user!.id) {
    res.status(404).json({ error: 'Request not found' })
    return
  }
  if (r.status !== 'PENDING') {
    res.status(400).json({ error: 'Only a waiting request can be taken back.' })
    return
  }
  await prisma.$transaction([
    prisma.attendanceFixRequest.update({ where: { id: r.id }, data: { status: 'CANCELLED' } }),
    prisma.notification.updateMany({ where: { type: 'ATTENDANCE_FIX_REQUESTED', entityType: 'AttendanceFixRequest', entityId: r.id, readAt: null }, data: { readAt: new Date() } }),
  ])
  res.status(204).end()
}

/** GET /api/attendance/fix-requests/team?status=PENDING|ALL — requests this lead (or admin) decides. */
export async function teamFixRequests(req: AuthedRequest, res: Response): Promise<void> {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { id: true, role: true, departmentId: true } })
  const pendingOnly = String(req.query.status ?? 'PENDING') === 'PENDING'
  const where =
    me.role === 'SUPER_ADMIN'
      ? {}
      : { user: { departmentId: me.departmentId ?? '__none__', role: { notIn: ['TEAM_LEAD', 'SUPER_ADMIN'] as ('TEAM_LEAD' | 'SUPER_ADMIN')[] } } }
  const rows = await prisma.attendanceFixRequest.findMany({
    where: { ...where, userId: { not: me.id }, ...(pendingOnly ? { status: 'PENDING' as const } : {}) },
    include,
    orderBy: pendingOnly ? { createdAt: 'asc' } : { createdAt: 'desc' },
    take: 60,
  })
  res.json({ requests: rows.map(view) })
}

const decisionSchema = z.object({ approve: z.boolean(), note: z.string().trim().max(300).optional() })

/** POST /api/attendance/fix-requests/:id/decision { approve, note? } — approve (the times go on the day) or reject. */
export async function decideFixRequest(req: AuthedRequest, res: Response): Promise<void> {
  const parsed = decisionSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Choose approve or reject.' })
    return
  }
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { id: true, name: true, role: true, departmentId: true } })
  const r = await loadRequest(req.params.id)
  if (!r) {
    res.status(404).json({ error: 'Request not found' })
    return
  }
  if (!canDecide(me, r.user)) {
    res.status(403).json({ error: 'You cannot decide this request.' })
    return
  }
  if (r.status !== 'PENDING') {
    res.status(409).json({ error: `This request was already ${r.status === 'CANCELLED' ? 'taken back' : r.status.toLowerCase()}.` })
    return
  }
  const { approve, note } = parsed.data
  const date = dateStringFromDb(r.date)
  if (approve) {
    // The same correction a lead makes by hand (checked, audited). Check-out only when one was asked for.
    const applied = await applyDayCorrection(me.id, r.userId, r.user.departmentId, date, { checkIn: r.checkIn, ...(r.checkOut ? { checkOut: r.checkOut } : {}) })
    if ('error' in applied) {
      res.status(400).json({ error: `Could not put these times in: ${applied.error}` })
      return
    }
  }
  await prisma.$transaction([
    prisma.attendanceFixRequest.update({ where: { id: r.id }, data: { status: approve ? 'APPROVED' : 'REJECTED', decidedById: me.id, decidedAt: new Date(), decisionNote: note || null } }),
    prisma.notification.create({
      data: {
        userId: r.userId,
        actorId: me.id,
        type: 'ATTENDANCE_FIX_DECIDED',
        title: approve ? `Attendance fixed for ${day(date)}` : `Attendance fix not approved for ${day(date)}`,
        body: approve
          ? `${me.name} put in ${times(r)}.${note ? ` Note: ${note}` : ''}`
          : `${me.name} did not approve ${times(r)}.${note ? ` Note: ${note}` : ''}`,
        link: '/app/attendance/me',
        entityType: 'AttendanceFixRequest',
        entityId: r.id,
      },
    }),
    prisma.auditLog.create({ data: { userId: me.id, entityType: 'AttendanceFixRequest', entityId: r.id, action: 'UPDATE', after: { status: approve ? 'APPROVED' : 'REJECTED', date, checkIn: r.checkIn, checkOut: r.checkOut } } }),
    // The other approvers no longer need the notice.
    prisma.notification.updateMany({ where: { type: 'ATTENDANCE_FIX_REQUESTED', entityType: 'AttendanceFixRequest', entityId: r.id, readAt: null }, data: { readAt: new Date() } }),
  ])
  res.json({ request: view((await loadRequest(r.id))!) })
}
