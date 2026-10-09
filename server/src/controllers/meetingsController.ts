import type { Response } from 'express'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { HttpError } from '../lib/pm/access'
import { parse, viewer } from '../lib/pm/http'
import { pmNotify, trunc } from '../lib/pm/pmNotify'
import { presenceOf } from '../lib/pm/presence'
import * as Calls from '../lib/pm/calls'
import { buildIcs, fmtRange, meetingLink, occurrences } from '../lib/pm/meetings'

/**
 * /api/meetings — schedule meetings, invite people, RSVP, calendar.
 *
 * Anyone in the company can open a meeting link and join it (like a Teams link);
 * only the organizer can change or cancel it. Each meeting (or repeating series)
 * gets its own group chat, which is also where its calls, recordings and AI notes live.
 */

const APP_URL = process.env.APP_URL || 'http://localhost:5173'
const RESPONSES = ['ACCEPTED', 'TENTATIVE', 'DECLINED'] as const

const MEETING_INCLUDE = {
  organizer: { select: { id: true, name: true, email: true } },
  attendees: { include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: 'asc' as const } },
  project: { select: { key: true, name: true, color: true } },
}

type MeetingRow = NonNullable<Awaited<ReturnType<typeof loadMeeting>>>

async function loadMeeting(id: string) {
  return prisma.meeting.findUnique({ where: { id }, include: MEETING_INCLUDE })
}

function serialize(m: MeetingRow, meId: string) {
  const mine = m.attendees.find((a) => a.userId === meId)
  const live = Calls.liveForConversation(m.conversationId)
  return {
    id: m.id,
    title: m.title,
    agenda: m.agenda,
    startsAt: m.startsAt.toISOString(),
    endsAt: m.endsAt.toISOString(),
    organizer: { id: m.organizer.id, name: m.organizer.name, presence: presenceOf(m.organizer.id) },
    isOrganizer: m.organizerId === meId,
    myResponse: m.organizerId === meId ? 'ORGANIZER' : mine?.response ?? null,
    attendees: m.attendees.map((a) => ({ id: a.user.id, name: a.user.name, response: a.response, presence: Calls.isInCall(a.userId) ? 'busy' : presenceOf(a.userId) })),
    conversationId: m.conversationId,
    project: m.project,
    seriesId: m.seriesId,
    repeat: m.repeat,
    cancelled: !!m.cancelledAt,
    link: `${APP_URL}${meetingLink(m.id)}`,
    live: live ? { callId: live.callId, video: live.video, participants: Calls.participantList(live).map((p) => ({ userId: p.userId, name: p.name })) } : null,
  }
}

async function addChatMember(conversationId: string, userId: string): Promise<void> {
  await prisma.chatMember.upsert({ where: { conversationId_userId: { conversationId, userId } }, create: { conversationId, userId }, update: {} })
}

async function activeUsers(ids: string[]) {
  const unique = [...new Set(ids)]
  if (!unique.length) return []
  const users = await prisma.user.findMany({ where: { id: { in: unique }, isActive: true, status: 'ACTIVE' }, select: { id: true, name: true } })
  if (users.length !== unique.length) throw new HttpError(422, 'Some people you picked are not active PulseTrack users')
  return users
}

async function postToChat(conversationId: string, userId: string, body: string): Promise<void> {
  await prisma.chatMessage.create({ data: { conversationId, userId, body, mentions: [] } })
  await prisma.chatConversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } })
}

const REPEAT_LABEL: Record<string, string> = { daily: 'every day', weekdays: 'every weekday', weekly: 'every week' }

// ---------- list (calendar) ----------

/** GET /api/meetings?from=&to= — my meetings in a date range (calendar). */
export async function listMeetings(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 7 * 86400_000)
  const to = req.query.to ? new Date(String(req.query.to)) : new Date(Date.now() + 60 * 86400_000)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) throw new HttpError(422, 'Pick a valid date range')
  if (to.getTime() - from.getTime() > 400 * 86400_000) throw new HttpError(422, 'Date range is too long')
  const rows = await prisma.meeting.findMany({
    where: {
      cancelledAt: req.query.cancelled === '1' ? undefined : null,
      startsAt: { lt: to },
      endsAt: { gt: from },
      OR: [{ organizerId: me.id }, { attendees: { some: { userId: me.id } } }],
    },
    include: MEETING_INCLUDE,
    orderBy: { startsAt: 'asc' },
    take: 500,
  })
  res.json({ meetings: rows.map((m) => serialize(m, me.id)) })
}

// ---------- create ----------

const timesSchema = {
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
}

const createSchema = z.object({
  title: z.string().trim().min(1, 'Give the meeting a title').max(120),
  agenda: z.string().max(5000).default(''),
  ...timesSchema,
  attendeeIds: z.array(z.string()).max(100).default([]),
  projectKey: z.string().max(20).nullable().optional(),
  repeat: z.enum(['none', 'daily', 'weekdays', 'weekly']).default('none'),
  repeatCount: z.number().int().min(1).max(52).default(1),
})

function checkTimes(startsAt: Date, endsAt: Date): void {
  if (endsAt <= startsAt) throw new HttpError(422, 'The meeting must end after it starts')
  if (endsAt.getTime() - startsAt.getTime() > 12 * 3600_000) throw new HttpError(422, 'Meetings can be at most 12 hours long')
  if (startsAt.getTime() < Date.now() - 24 * 3600_000) throw new HttpError(422, 'That start time is in the past')
}

/** POST /api/meetings — schedule (or "Meet now"). Invites everyone and creates the meeting chat. */
export async function createMeeting(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const body = parse(createSchema, req.body)
  checkTimes(body.startsAt, body.endsAt)
  const attendees = await activeUsers(body.attendeeIds.filter((id) => id !== me.id))
  let projectId: string | null = null
  if (body.projectKey) {
    const p = await prisma.pmProject.findUnique({ where: { key: body.projectKey }, select: { id: true } })
    if (!p) throw new HttpError(422, 'Project not found')
    projectId = p.id
  }
  const organizer = await prisma.user.findUniqueOrThrow({ where: { id: me.id }, select: { name: true } })
  const durationMs = body.endsAt.getTime() - body.startsAt.getTime()
  const starts = occurrences(body.startsAt, body.repeat, body.repeatCount)
  const seriesId = starts.length > 1 ? randomUUID() : null

  const conv = await prisma.chatConversation.create({
    data: {
      type: 'GROUP',
      name: body.title,
      createdById: me.id,
      members: { create: [{ userId: me.id, isAdmin: true }, ...attendees.map((a) => ({ userId: a.id }))] },
    },
  })
  const ids: string[] = []
  for (const s of starts) {
    const m = await prisma.meeting.create({
      data: {
        title: body.title,
        agenda: body.agenda,
        startsAt: s,
        endsAt: new Date(s.getTime() + durationMs),
        organizerId: me.id,
        conversationId: conv.id,
        projectId,
        seriesId,
        repeat: body.repeat === 'none' ? null : body.repeat,
        attendees: { create: attendees.map((a) => ({ userId: a.id })) },
      },
    })
    ids.push(m.id)
  }
  const first = (await loadMeeting(ids[0]))!
  const when = fmtRange(first.startsAt, first.endsAt)
  const repeatText = seriesId ? `, repeats ${REPEAT_LABEL[body.repeat]} (${starts.length} times)` : ''
  await postToChat(conv.id, me.id, `Scheduled "${body.title}" for ${when}${repeatText}.`)
  await pmNotify({
    userIds: attendees.map((a) => a.id),
    actorId: me.id,
    type: 'MEETING',
    title: `${organizer.name} added you to a meeting`,
    body: `${trunc(body.title, 80)} · ${when}${repeatText}`,
    link: meetingLink(first.id),
    email: {
      pref: 'emailAssigned',
      subject: `Meeting invite: ${body.title}`,
      heading: `${organizer.name} invited you to a meeting`,
      lines: [body.title, `When: ${when}${repeatText}`, ...(body.agenda ? [`Agenda: ${trunc(body.agenda, 400)}`] : [])],
      cta: 'Open the meeting',
    },
  })
  res.status(201).json({ meeting: serialize(first, me.id), count: ids.length })
}

// ---------- read ----------

/** GET /api/meetings/:id — anyone signed in can open a meeting link. */
export async function getMeeting(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const m = await loadMeeting(req.params.id)
  if (!m) throw new HttpError(404, 'Meeting not found')
  const isIn = m.organizerId === me.id || m.attendees.some((a) => a.userId === me.id)
  // Calls of this meeting, with notes and recordings.
  const calls = isIn
    ? await prisma.chatCall.findMany({
        where: { meetingId: m.id },
        orderBy: { startedAt: 'desc' },
        select: { id: true, startedAt: true, endedAt: true, video: true, joinedIds: true, noteTaker: true, notesStatus: true, recordings: { where: { status: 'ready' }, select: { id: true, messageId: true, durationSec: true, size: true } } },
      })
    : []
  const series = m.seriesId
    ? await prisma.meeting.findMany({ where: { seriesId: m.seriesId, cancelledAt: null }, orderBy: { startsAt: 'asc' }, select: { id: true, startsAt: true } })
    : []
  res.json({
    meeting: serialize(m, me.id),
    isAttendee: isIn,
    calls: calls.map((c) => ({
      id: c.id,
      startedAt: c.startedAt.toISOString(),
      endedAt: c.endedAt?.toISOString() ?? null,
      durationSec: c.endedAt ? Math.round((c.endedAt.getTime() - c.startedAt.getTime()) / 1000) : null,
      joinedCount: c.joinedIds.length,
      notes: c.noteTaker ? c.notesStatus ?? 'pending' : null,
      recordings: c.recordings.map((r) => ({ id: r.id, url: r.messageId ? `/api/chat/files/${r.messageId}` : null, durationSec: r.durationSec, size: r.size })),
    })),
    series: series.map((s) => ({ id: s.id, startsAt: s.startsAt.toISOString() })),
  })
}

/** POST /api/meetings/:id/join — opening a shared link adds you to the meeting and its chat. */
export async function joinMeeting(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const m = await loadMeeting(req.params.id)
  if (!m) throw new HttpError(404, 'Meeting not found')
  if (m.cancelledAt) throw new HttpError(409, 'This meeting was cancelled')
  if (m.organizerId !== me.id && !m.attendees.some((a) => a.userId === me.id)) {
    await prisma.meetingAttendee.create({ data: { meetingId: m.id, userId: me.id, response: 'ACCEPTED' } }).catch(() => undefined)
  }
  await addChatMember(m.conversationId, me.id)
  res.json({ meeting: serialize((await loadMeeting(m.id))!, me.id) })
}

// ---------- RSVP ----------

/** POST /api/meetings/:id/respond { response, series } */
export async function respondMeeting(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const { response, series } = parse(z.object({ response: z.enum(RESPONSES), series: z.boolean().default(false) }), req.body)
  const m = await loadMeeting(req.params.id)
  if (!m) throw new HttpError(404, 'Meeting not found')
  if (!m.attendees.some((a) => a.userId === me.id)) throw new HttpError(403, 'You are not invited to this meeting')
  const ids = series && m.seriesId
    ? (await prisma.meeting.findMany({ where: { seriesId: m.seriesId, startsAt: { gte: m.startsAt } }, select: { id: true } })).map((x) => x.id)
    : [m.id]
  await prisma.meetingAttendee.updateMany({ where: { meetingId: { in: ids }, userId: me.id }, data: { response } })
  const name = (await prisma.user.findUniqueOrThrow({ where: { id: me.id }, select: { name: true } })).name
  const verb = response === 'ACCEPTED' ? 'accepted' : response === 'DECLINED' ? 'declined' : 'tentatively accepted'
  await pmNotify({ userIds: [m.organizerId], actorId: me.id, type: 'MEETING', title: `${name} ${verb}: ${trunc(m.title, 60)}`, body: fmtRange(m.startsAt, m.endsAt), link: meetingLink(m.id) })
  res.json({ meeting: serialize((await loadMeeting(m.id))!, me.id) })
}

// ---------- edit / cancel (organizer) ----------

const updateSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  agenda: z.string().max(5000).optional(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
  attendeeIds: z.array(z.string()).max(100).optional(),
  series: z.boolean().default(false),
})

async function organizerMeeting(req: AuthedRequest) {
  const me = viewer(req)
  const m = await loadMeeting(req.params.id)
  if (!m) throw new HttpError(404, 'Meeting not found')
  if (m.organizerId !== me.id) throw new HttpError(403, 'Only the organizer can change this meeting')
  return { me, m }
}

/** PATCH /api/meetings/:id — change title, agenda, time or people (this one, or all upcoming in the series). */
export async function updateMeeting(req: AuthedRequest, res: Response): Promise<void> {
  const { me, m } = await organizerMeeting(req)
  if (m.cancelledAt) throw new HttpError(409, 'This meeting was cancelled')
  const body = parse(updateSchema, req.body)
  const startsAt = body.startsAt ?? m.startsAt
  const endsAt = body.endsAt ?? m.endsAt
  if (body.startsAt || body.endsAt) checkTimes(startsAt, endsAt)
  const targets = body.series && m.seriesId
    ? await prisma.meeting.findMany({ where: { seriesId: m.seriesId, cancelledAt: null, startsAt: { gte: m.startsAt } }, include: { attendees: true } })
    : [{ ...m, attendees: m.attendees }]
  const shift = startsAt.getTime() - m.startsAt.getTime()
  const duration = endsAt.getTime() - startsAt.getTime()
  const timeChanged = shift !== 0 || duration !== m.endsAt.getTime() - m.startsAt.getTime()

  const before = new Set(m.attendees.map((a) => a.userId))
  const wanted = body.attendeeIds ? new Set(body.attendeeIds.filter((id) => id !== me.id)) : before
  if (body.attendeeIds) await activeUsers([...wanted])
  const added = [...wanted].filter((id) => !before.has(id))
  const removed = [...before].filter((id) => !wanted.has(id))

  for (const t of targets) {
    const s = new Date(t.startsAt.getTime() + shift)
    await prisma.meeting.update({
      where: { id: t.id },
      data: {
        title: body.title,
        agenda: body.agenda,
        ...(timeChanged ? { startsAt: s, endsAt: new Date(s.getTime() + duration), reminderSentAt: null } : {}),
      },
    })
    if (added.length) await prisma.meetingAttendee.createMany({ data: added.map((userId) => ({ meetingId: t.id, userId })), skipDuplicates: true })
    if (removed.length) await prisma.meetingAttendee.deleteMany({ where: { meetingId: t.id, userId: { in: removed } } })
  }
  for (const id of added) await addChatMember(m.conversationId, id)
  if (removed.length) {
    // Leave the chat only if they are not in any other occurrence that shares it.
    for (const id of removed) {
      const still = await prisma.meetingAttendee.count({ where: { userId: id, meeting: { conversationId: m.conversationId, cancelledAt: null } } })
      if (!still) await prisma.chatMember.deleteMany({ where: { conversationId: m.conversationId, userId: id } })
    }
  }
  if (body.title && (body.series || !m.seriesId)) await prisma.chatConversation.update({ where: { id: m.conversationId }, data: { name: body.title } })

  const fresh = (await loadMeeting(m.id))!
  const when = fmtRange(fresh.startsAt, fresh.endsAt)
  const orgName = fresh.organizer.name
  if (added.length) {
    await pmNotify({
      userIds: added, actorId: me.id, type: 'MEETING', title: `${orgName} added you to a meeting`, body: `${trunc(fresh.title, 80)} · ${when}`, link: meetingLink(fresh.id),
      email: { pref: 'emailAssigned', subject: `Meeting invite: ${fresh.title}`, heading: `${orgName} invited you to a meeting`, lines: [fresh.title, `When: ${when}`], cta: 'Open the meeting' },
    })
  }
  if (removed.length) await pmNotify({ userIds: removed, actorId: me.id, type: 'MEETING', title: `You were removed from: ${trunc(fresh.title, 60)}`, body: when, link: '/app/calendar' })
  if (timeChanged) {
    const stay = fresh.attendees.map((a) => a.userId).filter((id) => !added.includes(id))
    await pmNotify({
      userIds: stay, actorId: me.id, type: 'MEETING', title: `Meeting moved: ${trunc(fresh.title, 60)}`, body: `New time: ${when}${body.series && targets.length > 1 ? ' (and the rest of the series)' : ''}`, link: meetingLink(fresh.id),
      email: { pref: 'emailAssigned', subject: `Meeting moved: ${fresh.title}`, heading: 'A meeting you are in has a new time', lines: [fresh.title, `New time: ${when}`], cta: 'Open the meeting' },
    })
    await postToChat(m.conversationId, me.id, `Moved "${fresh.title}" to ${when}.`)
  }
  res.json({ meeting: serialize(fresh, me.id) })
}

/** POST /api/meetings/:id/cancel { series } */
export async function cancelMeeting(req: AuthedRequest, res: Response): Promise<void> {
  const { me, m } = await organizerMeeting(req)
  const { series } = parse(z.object({ series: z.boolean().default(false) }), req.body ?? {})
  const where = series && m.seriesId ? { seriesId: m.seriesId, cancelledAt: null, startsAt: { gte: m.startsAt } } : { id: m.id }
  const n = await prisma.meeting.updateMany({ where, data: { cancelledAt: new Date() } })
  const when = fmtRange(m.startsAt, m.endsAt)
  const label = series && n.count > 1 ? `${n.count} meetings of "${m.title}" from ${when}` : `"${m.title}" on ${when}`
  await pmNotify({
    userIds: m.attendees.map((a) => a.userId), actorId: me.id, type: 'MEETING', title: `Cancelled: ${trunc(m.title, 60)}`, body: series && n.count > 1 ? `All upcoming meetings in this series (${n.count})` : when, link: meetingLink(m.id),
    email: { pref: 'emailAssigned', subject: `Cancelled: ${m.title}`, heading: `${m.organizer.name} cancelled a meeting`, lines: [label], cta: 'Open PulseTrack' },
  })
  await postToChat(m.conversationId, me.id, `Cancelled ${label}.`)
  res.json({ cancelled: n.count })
}

/** GET /api/meetings/:id/ics — add to Outlook / Google Calendar. */
export async function meetingIcs(req: AuthedRequest, res: Response): Promise<void> {
  const m = await loadMeeting(req.params.id)
  if (!m) throw new HttpError(404, 'Meeting not found')
  const ics = buildIcs({
    id: m.id,
    title: m.title,
    agenda: m.agenda,
    startsAt: m.startsAt,
    endsAt: m.endsAt,
    organizer: { name: m.organizer.name, email: m.organizer.email },
    attendees: m.attendees.map((a) => ({ name: a.user.name, email: a.user.email })),
    cancelled: !!m.cancelledAt,
    url: `${APP_URL}${meetingLink(m.id)}`,
  })
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(m.title.slice(0, 60) || 'meeting')}.ics"`)
  res.send(ics)
}
