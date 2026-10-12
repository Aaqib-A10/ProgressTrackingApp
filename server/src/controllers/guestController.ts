import type { Request, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { HttpError } from '../lib/pm/access'
import { parse, viewer } from '../lib/pm/http'
import * as Calls from '../lib/pm/calls'
import { newGuestId, newGuestToken, readGuestPass, setGuestPass } from '../lib/pm/guests'

const APP_URL = () => process.env.APP_URL || 'http://localhost:5173'
const linkFor = (token: string) => `${APP_URL()}/join/${token}`

async function memberOf(conversationId: string, userId: string) {
  const m = await prisma.chatMember.findUnique({ where: { conversationId_userId: { conversationId, userId } }, include: { conversation: true } })
  if (!m) throw new HttpError(404, 'Conversation not found')
  return m
}

// ---------- for team members ----------

/** GET /api/chat/conversations/:id/guest-link — the current link (or null when off). */
export async function getGuestLink(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const m = await memberOf(req.params.id, me.id)
  const t = m.conversation.guestToken
  res.json({ token: t, url: t ? linkFor(t) : null })
}

/** POST /api/chat/conversations/:id/guest-link { reset? } — turn the link on (or make a new one; the old one stops working). */
export async function makeGuestLink(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const m = await memberOf(req.params.id, me.id)
  const { reset } = parse(z.object({ reset: z.boolean().optional() }), req.body ?? {})
  let t = m.conversation.guestToken
  if (!t || reset) {
    t = newGuestToken()
    await prisma.chatConversation.update({ where: { id: m.conversationId }, data: { guestToken: t } })
  }
  res.json({ token: t, url: linkFor(t) })
}

/** DELETE /api/chat/conversations/:id/guest-link — turn the link off. */
export async function deleteGuestLink(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const m = await memberOf(req.params.id, me.id)
  await prisma.chatConversation.update({ where: { id: m.conversationId }, data: { guestToken: null } })
  res.status(204).end()
}

/** POST /api/chat/calls/:callId/lobby { guestId, admit } — let a waiting guest in (or not). */
export async function answerGuest(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const call = Calls.getLive(req.params.callId)
  if (!call) throw new HttpError(410, 'This call has ended')
  if (!call.participants.has(me.id) || Calls.isOutsideGuest(me.id)) throw new HttpError(403, 'Only people in the call can let guests in')
  const { guestId, admit } = parse(z.object({ guestId: z.string().max(60), admit: z.boolean() }), req.body)
  const g = call.lobby.get(guestId)
  if (!g) throw new HttpError(404, 'That request has gone')
  if (g.status === 'waiting') {
    g.status = admit ? 'admitted' : 'denied'
    if (admit) {
      if (call.participants.size >= Calls.MAX_PARTICIPANTS) { g.status = 'waiting'; throw new HttpError(409, `Calls are limited to ${Calls.MAX_PARTICIPANTS} people`) }
      call.guests.add(guestId)
      call.guestNames.set(guestId, `${g.name} (Guest)`)
    }
  }
  res.json({ ok: true, status: g.status })
}

// ---------- for people outside Metriq (no login) ----------

async function byToken(token: string) {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(token)) throw new HttpError(404, 'This link does not work')
  const conv = await prisma.chatConversation.findUnique({
    where: { guestToken: token },
    select: { id: true, type: true, name: true, meetings: { orderBy: { startsAt: 'desc' }, take: 1, select: { title: true } }, members: { take: 3, select: { user: { select: { name: true } } } } },
  })
  if (!conv) throw new HttpError(404, 'This link does not work any more. Ask for a new one.')
  const title = conv.meetings[0]?.title ?? conv.name ?? `Call with ${conv.members.map((m) => m.user.name.split(' ')[0]).join(', ')}`
  return { conv, title }
}

/** GET /api/guest/:token — what this link is for, and whether the call is on now. */
export async function guestInfo(req: Request, res: Response): Promise<void> {
  const { conv, title } = await byToken(req.params.token)
  const call = Calls.liveForConversation(conv.id)
  res.json({ title, live: !!call && call.participants.size > 0, video: call?.video ?? true })
}

/** POST /api/guest/:token/knock { name } — ask to join the running call. */
export async function guestKnock(req: Request, res: Response): Promise<void> {
  const { conv, title } = await byToken(req.params.token)
  const { name } = parse(z.object({ name: z.string().trim().min(2, 'Type your name').max(40).regex(/^[^<>{}]+$/, 'Use letters and spaces') }), req.body)
  const call = Calls.liveForConversation(conv.id)
  if (!call || call.participants.size === 0) throw new HttpError(409, 'The meeting has not started yet. Try again when it starts.')
  if (Calls.waitingGuests(call).length >= 10) throw new HttpError(429, 'Too many people are waiting. Try again in a minute.')
  // Asking again from the same browser keeps the same place in the queue.
  const prev = readGuestPass(req)
  const gid = prev && prev.conv === conv.id ? prev.gid : newGuestId()
  const existing = call.lobby.get(gid)
  if (!existing || existing.status === 'denied') call.lobby.set(gid, { name, at: Date.now(), status: 'waiting' })
  else existing.name = name
  setGuestPass(res, { gid, name, conv: conv.id })
  res.json({ status: call.lobby.get(gid)!.status, callId: call.callId, title })
}

/** GET /api/guest/:token/status — waiting, let in, or not. */
export async function guestStatus(req: Request, res: Response): Promise<void> {
  const { conv, title } = await byToken(req.params.token)
  const pass = readGuestPass(req)
  if (!pass || pass.conv !== conv.id) { res.json({ status: 'none', title }); return }
  const call = Calls.liveForConversation(conv.id)
  if (!call) { res.json({ status: 'ended', title }); return }
  const g = call.lobby.get(pass.gid)
  if (!g) { res.json({ status: 'none', title }); return }
  if (g.status === 'waiting') g.at = Date.now() // still there
  res.json({ status: g.status, title, ...(g.status === 'admitted' ? { callId: call.callId, conversationId: conv.id, video: call.video, me: pass.gid, name: call.guestNames.get(pass.gid) } : {}) })
}
