import type { Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { dbDateFromString, dateStringFromDb } from '../lib/time'
import { shiftDayString } from '../lib/shiftDay'
import { resolveShift, isWorkingDate, eachDateStr } from './attendanceController'

/**
 * Work from home requests (Oct 2026), the way Zoho People, Keka and greytHR do it: the employee
 * picks dates and gives a reason, their Team Lead gets a notice and approves or rejects. Approved
 * working days are marked Work From Home, so check-in and check-out work from any network on
 * those days and the lead sees the hours as usual.
 *
 * Rules: no past dates, at most 31 days in one request, only the person's working days count,
 * no overlap with another pending or approved request. A request goes to the Team Leads of the
 * person's department; a Team Lead's own request (or a department with no lead) goes to the
 * Super Admins. Nobody decides their own request.
 */

const MAX_DAYS = 31
const DATE = /^\d{4}-\d{2}-\d{2}$/

type Row = Awaited<ReturnType<typeof loadRequest>>
function loadRequest(id: string) {
  return prisma.wfhRequest.findUnique({
    where: { id },
    include: { user: { select: { id: true, name: true, departmentId: true, role: true } }, decidedBy: { select: { name: true } } },
  })
}

function view(r: NonNullable<Row>) {
  return {
    id: r.id,
    userId: r.userId,
    name: r.user.name,
    startDate: dateStringFromDb(r.startDate),
    endDate: dateStringFromDb(r.endDate),
    days: r.days,
    reason: r.reason,
    status: r.status,
    decidedBy: r.decidedBy?.name ?? null,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionNote: r.decisionNote,
    createdAt: r.createdAt.toISOString(),
  }
}

/** Who approves this person's requests: their department's Team Leads, else the Super Admins. */
async function approversFor(user: { id: string; role: string; departmentId: string | null }): Promise<string[]> {
  if (user.role !== 'TEAM_LEAD' && user.role !== 'SUPER_ADMIN' && user.departmentId) {
    const leads = await prisma.user.findMany({ where: { role: 'TEAM_LEAD', departmentId: user.departmentId, isActive: true, status: 'ACTIVE', id: { not: user.id } }, select: { id: true } })
    if (leads.length) return leads.map((l) => l.id)
  }
  const admins = await prisma.user.findMany({ where: { role: 'SUPER_ADMIN', isActive: true, id: { not: user.id } }, select: { id: true } })
  return admins.map((a) => a.id)
}

/** May `me` decide a request from `owner`? */
function canDecide(me: { id: string; role: string; departmentId: string | null }, owner: { id: string; role: string; departmentId: string | null }): boolean {
  if (me.id === owner.id) return false
  if (me.role === 'SUPER_ADMIN') return true
  return me.role === 'TEAM_LEAD' && !!me.departmentId && me.departmentId === owner.departmentId && owner.role !== 'TEAM_LEAD' && owner.role !== 'SUPER_ADMIN'
}

const fmt = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const span = (days: string[]) => (days.length === 1 ? fmt(days[0]) : `${fmt(days[0])} to ${fmt(days[days.length - 1])} (${days.length} days)`)

const createSchema = z.object({
  startDate: z.string().regex(DATE, 'Pick a start date.'),
  endDate: z.string().regex(DATE, 'Pick an end date.').optional(),
  reason: z.string().trim().min(3, 'Give a short reason.').max(500),
})

/** POST /api/attendance/wfh-requests — ask to work from home. */
export async function createWfhRequest(req: AuthedRequest, res: Response): Promise<void> {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' })
    return
  }
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { id: true, name: true, role: true, departmentId: true, attendanceRemote: true } })
  if (me.attendanceRemote) {
    res.status(400).json({ error: 'You already work from home every day, so there is nothing to request.' })
    return
  }
  const { startDate, reason } = parsed.data
  const endDate = parsed.data.endDate || startDate
  if (endDate < startDate) {
    res.status(400).json({ error: 'The end date must be on or after the start date.' })
    return
  }
  const shift = await resolveShift(me.id, me.departmentId)
  if (startDate < shiftDayString(shift)) {
    res.status(400).json({ error: 'You cannot ask for a day that has already passed.' })
    return
  }
  const all = eachDateStr(startDate, endDate)
  if (all.length > MAX_DAYS) {
    res.status(400).json({ error: `Ask for at most ${MAX_DAYS} days at a time.` })
    return
  }
  const days = all.filter((d) => isWorkingDate(d, shift))
  if (days.length === 0) {
    res.status(400).json({ error: 'There are no working days in those dates.' })
    return
  }
  const clash = await prisma.wfhRequest.findFirst({
    where: { userId: me.id, status: { in: ['PENDING', 'APPROVED'] }, days: { hasSome: days } },
    select: { status: true },
  })
  if (clash) {
    res.status(409).json({ error: `You already have ${clash.status === 'PENDING' ? 'a waiting' : 'an approved'} request for some of these days.` })
    return
  }
  const created = await prisma.wfhRequest.create({
    data: { userId: me.id, startDate: dbDateFromString(startDate), endDate: dbDateFromString(endDate), days, reason },
  })
  const approvers = await approversFor(me)
  if (approvers.length) {
    await prisma.notification.createMany({
      data: approvers.map((userId) => ({
        userId,
        actorId: me.id,
        type: 'WFH_REQUESTED' as const,
        title: `${me.name} asks to work from home`,
        body: `${span(days)}: ${reason.slice(0, 140)}`,
        link: '/app/attendance/team?wfh=1',
        entityType: 'WfhRequest',
        entityId: created.id,
      })),
    })
  }
  res.status(201).json({ request: view((await loadRequest(created.id))!) })
}

/** GET /api/attendance/wfh-requests/mine — my requests, newest first. */
export async function myWfhRequests(req: AuthedRequest, res: Response): Promise<void> {
  const rows = await prisma.wfhRequest.findMany({
    where: { userId: req.user!.id },
    include: { user: { select: { id: true, name: true, departmentId: true, role: true } }, decidedBy: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 30,
  })
  res.json({ requests: rows.map(view) })
}

/** DELETE /api/attendance/wfh-requests/:id — take back my request while it is still waiting. */
export async function cancelWfhRequest(req: AuthedRequest, res: Response): Promise<void> {
  const r = await loadRequest(req.params.id)
  if (!r || r.userId !== req.user!.id) {
    res.status(404).json({ error: 'Request not found' })
    return
  }
  if (r.status !== 'PENDING') {
    res.status(400).json({ error: 'Only a waiting request can be taken back. Ask your Team Lead to change an approved one.' })
    return
  }
  await prisma.wfhRequest.update({ where: { id: r.id }, data: { status: 'CANCELLED' } })
  res.status(204).end()
}

/** GET /api/attendance/wfh-requests/team?status=PENDING|ALL — requests this lead (or admin) decides. */
export async function teamWfhRequests(req: AuthedRequest, res: Response): Promise<void> {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { id: true, role: true, departmentId: true } })
  const pendingOnly = String(req.query.status ?? 'PENDING') === 'PENDING'
  const where =
    me.role === 'SUPER_ADMIN'
      ? {}
      : { user: { departmentId: me.departmentId ?? '__none__', role: { notIn: ['TEAM_LEAD', 'SUPER_ADMIN'] as ('TEAM_LEAD' | 'SUPER_ADMIN')[] } } }
  const rows = await prisma.wfhRequest.findMany({
    where: { ...where, userId: { not: me.id }, ...(pendingOnly ? { status: 'PENDING' as const } : {}) },
    include: { user: { select: { id: true, name: true, departmentId: true, role: true } }, decidedBy: { select: { name: true } } },
    orderBy: pendingOnly ? { createdAt: 'asc' } : { createdAt: 'desc' },
    take: 50,
  })
  res.json({ requests: rows.map(view) })
}

const decisionSchema = z.object({ approve: z.boolean(), note: z.string().trim().max(300).optional() })

/** POST /api/attendance/wfh-requests/:id/decision { approve, note? } — approve or reject. */
export async function decideWfhRequest(req: AuthedRequest, res: Response): Promise<void> {
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
    res.status(409).json({ error: `This request was already ${r.status.toLowerCase()}.` })
    return
  }
  const { approve, note } = parsed.data
  // Approved: mark the days Work From Home. A day already marked leave or off keeps that mark.
  let marked: string[] = []
  const ops = []
  if (approve) {
    const existing = await prisma.leaveDay.findMany({ where: { userId: r.userId, date: { in: r.days.map(dbDateFromString) } }, select: { date: true, type: true } })
    const taken = new Set(existing.filter((e) => e.type !== 'WFH').map((e) => dateStringFromDb(e.date)))
    marked = r.days.filter((d) => !taken.has(d))
    for (const d of marked) {
      const date = dbDateFromString(d)
      ops.push(prisma.leaveDay.upsert({
        where: { userId_date: { userId: r.userId, date } },
        update: { type: 'WFH', note: `Request approved by ${me.name}` },
        create: { userId: r.userId, date, type: 'WFH', note: `Request approved by ${me.name}` },
      }))
    }
  }
  await prisma.$transaction([
    prisma.wfhRequest.update({ where: { id: r.id }, data: { status: approve ? 'APPROVED' : 'REJECTED', decidedById: me.id, decidedAt: new Date(), decisionNote: note || null } }),
    ...ops,
    prisma.notification.create({
      data: {
        userId: r.userId,
        actorId: me.id,
        type: 'WFH_DECIDED',
        title: approve ? 'Work from home approved' : 'Work from home not approved',
        body: approve
          ? `${me.name} approved ${span(r.days)}. You can check in from home on those days.${note ? ` Note: ${note}` : ''}`
          : `${me.name} did not approve ${span(r.days)}.${note ? ` Note: ${note}` : ''}`,
        link: '/app/attendance/me',
        entityType: 'WfhRequest',
        entityId: r.id,
      },
    }),
    prisma.auditLog.create({ data: { userId: me.id, entityType: 'WfhRequest', entityId: r.id, action: 'UPDATE', after: { status: approve ? 'APPROVED' : 'REJECTED', days: marked } } }),
    // The other approvers no longer need the "asks to work from home" notice.
    prisma.notification.updateMany({ where: { type: 'WFH_REQUESTED', entityType: 'WfhRequest', entityId: r.id, readAt: null }, data: { readAt: new Date() } }),
  ])
  res.json({ request: view((await loadRequest(r.id))!), marked })
}
