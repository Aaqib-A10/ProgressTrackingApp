import type { Response } from 'express'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { HttpError, TASK_CODE_RE, loadProjectCtx, visibleProjectIds } from '../lib/pm/access'
import { parse, viewer } from '../lib/pm/http'
import { presenceOf as basePresence, setTyping, touch, typingIn } from '../lib/pm/presence'
import { pmNotify, trunc } from '../lib/pm/pmNotify'
import { syncProjectChannel } from '../lib/pm/tasks'
import * as Calls from '../lib/pm/calls'
import { generateNotes, notesProvider, transcriptText, type MeetingNotes } from '../lib/pm/notes'
import { groqEnabled } from '../lib/pm/groq'
import * as Stt from '../lib/pm/stt'
import { meetingFor } from '../lib/pm/meetings'

/** Presence with "busy" while the person is in a call. */
function presenceOf(userId: string): 'online' | 'away' | 'offline' | 'busy' {
  return Calls.isInCall(userId) ? 'busy' : basePresence(userId)
}

/**
 * Team chat: direct messages, named group chats and one # channel per project
 * (membership mirrors the project). Clients poll with a `seq` cursor, so the
 * feature needs no websocket infrastructure; presence and typing live in memory.
 *
 * Privacy: every read and write checks ChatMember for the caller. Admins have no
 * back door into direct messages they are not part of.
 */

const UPLOAD_DIR = path.resolve('uploads', 'chat')
const MAX_BYTES = 25 * 1024 * 1024
const BLOCKED_EXT = new Set(['exe', 'bat', 'cmd', 'com', 'msi', 'scr', 'sh', 'ps1', 'vbs', 'js', 'mjs', 'cjs', 'jar', 'apk', 'app', 'html', 'htm', 'svg'])
const MAX_BODY = 5000

// Simple per-user send limiter: 30 messages per rolling minute.
const sendLog = new Map<string, number[]>()
function rateLimitSend(userId: string): void {
  const now = Date.now()
  const arr = (sendLog.get(userId) ?? []).filter((t) => now - t < 60_000)
  if (arr.length >= 30) throw new HttpError(429, 'You are sending messages too quickly. Wait a moment.')
  arr.push(now)
  sendLog.set(userId, arr)
}

const MESSAGE_INCLUDE = {
  user: { select: { id: true, name: true } },
  replyTo: { select: { id: true, body: true, deletedAt: true, user: { select: { name: true } } } },
  taskRef: { select: { id: true, code: true, title: true, projectId: true, dueAt: true, deletedAt: true, project: { select: { key: true, name: true, color: true } }, column: { select: { name: true, category: true } } } },
  call: { select: { id: true, video: true, startedAt: true, endedAt: true, joinedIds: true } },
  reactions: { select: { emoji: true, userId: true }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.ChatMessageInclude

type MessageRow = Prisma.ChatMessageGetPayload<{ include: typeof MESSAGE_INCLUDE }>

function serializeMessage(m: MessageRow, visibleProjects: Set<string>) {
  const deleted = !!m.deletedAt
  const t = m.taskRef
  const taskVisible = t && !t.deletedAt && visibleProjects.has(t.projectId)
  return {
    id: m.id,
    seq: m.seq,
    conversationId: m.conversationId,
    user: m.user,
    body: deleted ? '' : m.body,
    deleted,
    mentions: deleted ? [] : m.mentions,
    replyTo: m.replyTo ? { id: m.replyTo.id, userName: m.replyTo.user.name, body: m.replyTo.deletedAt ? 'Message deleted' : trunc(m.replyTo.body, 120) } : null,
    // A task card only for viewers who can open that project; others see the plain text code.
    task: !deleted && taskVisible
      ? { code: t.code, title: t.title, projectKey: t.project.key, projectName: t.project.name, color: t.project.color, status: t.column.name, done: t.column.category === 'DONE', dueAt: t.dueAt?.toISOString() ?? null, overdue: !!t.dueAt && t.dueAt < new Date() && t.column.category !== 'DONE' }
      : null,
    file: !deleted && m.fileStoredName ? { name: m.fileName, size: m.fileSize, mime: m.fileMime, url: `/api/chat/files/${m.id}` } : null,
    call: m.call
      ? {
          id: m.call.id,
          video: m.call.video,
          active: !m.call.endedAt && !!Calls.getLive(m.call.id),
          startedAt: m.call.startedAt.toISOString(),
          endedAt: m.call.endedAt?.toISOString() ?? null,
          durationSec: m.call.endedAt ? Math.round((m.call.endedAt.getTime() - m.call.startedAt.getTime()) / 1000) : null,
          joinedCount: m.call.joinedIds.length,
        }
      : null,
    notes: m.notesCallId && !deleted ? { callId: m.notesCallId } : null,
    reactions: groupReactions(m.reactions),
    editedAt: m.editedAt?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
  }
}

function groupReactions(rows: { emoji: string; userId: string }[]): { emoji: string; userIds: string[] }[] {
  const map = new Map<string, string[]>()
  for (const r of rows) map.set(r.emoji, [...(map.get(r.emoji) ?? []), r.userId])
  return [...map].map(([emoji, userIds]) => ({ emoji, userIds }))
}

async function membership(conversationId: string, userId: string) {
  const m = await prisma.chatMember.findUnique({ where: { conversationId_userId: { conversationId, userId } }, include: { conversation: true } })
  if (!m) throw new HttpError(404, 'Conversation not found')
  // Project channels follow project visibility (archived projects stay readable to members).
  return m
}

async function unreadByConversation(userId: string): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<{ conversationId: string; n: bigint }[]>(Prisma.sql`
    SELECT m."conversationId", COUNT(*)::bigint AS n
    FROM "ChatMessage" m
    JOIN "ChatMember" cm ON cm."conversationId" = m."conversationId" AND cm."userId" = ${userId}
    WHERE m.seq > cm."lastReadSeq" AND m."userId" <> ${userId} AND m."deletedAt" IS NULL
    GROUP BY m."conversationId"`)
  return new Map(rows.map((r) => [r.conversationId, Number(r.n)]))
}

// ---------- Conversations ----------

/** GET /api/chat/conversations */
export async function listConversations(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  touch(me.id)
  const mems = await prisma.chatMember.findMany({
    where: { userId: me.id },
    include: {
      conversation: {
        include: {
          project: { select: { key: true, color: true, status: true } },
          members: { include: { user: { select: { id: true, name: true, isActive: true } } } },
          messages: { orderBy: { seq: 'desc' }, take: 1, include: { user: { select: { name: true } } } },
        },
      },
    },
  })
  const unread = await unreadByConversation(me.id)
  const now = new Date()
  const list = mems.map((m) => {
    const c = m.conversation
    const others = c.members.filter((x) => x.userId !== me.id)
    const last = c.messages[0]
    const title = c.type === 'DIRECT' ? others[0]?.user.name ?? 'Direct message' : c.type === 'PROJECT' ? `# ${c.name ?? c.project?.key ?? 'project'}` : c.name ?? 'Group'
    return {
      id: c.id,
      type: c.type,
      title,
      projectKey: c.project?.key ?? null,
      color: c.project?.color ?? null,
      archived: c.project?.status === 'ARCHIVED',
      memberCount: c.members.length,
      other: c.type === 'DIRECT' && others[0] ? { id: others[0].user.id, name: others[0].user.name, presence: presenceOf(others[0].user.id) } : null,
      lastMessage: last ? { body: last.deletedAt ? 'Message deleted' : last.fileStoredName && !last.body ? `📎 ${last.fileName}` : trunc(last.body, 90), userName: last.user.name, createdAt: last.createdAt.toISOString(), mine: last.userId === me.id } : null,
      lastMessageAt: c.lastMessageAt.toISOString(),
      unread: unread.get(c.id) ?? 0,
      muted: !!m.mutedUntil && m.mutedUntil > now,
      mutedUntil: m.mutedUntil?.toISOString() ?? null,
    }
  })
  list.sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1))
  res.json({ conversations: list })
}

const createSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('DIRECT'), userId: z.string() }),
  z.object({ type: z.literal('GROUP'), name: z.string().trim().min(1).max(60), userIds: z.array(z.string()).min(1).max(100) }),
])

/** POST /api/chat/conversations — open (or reuse) a DM, or create a group. */
export async function createConversation(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const body = parse(createSchema, req.body)
  if (body.type === 'DIRECT') {
    if (body.userId === me.id) throw new HttpError(422, 'You cannot message yourself')
    const other = await prisma.user.findFirst({ where: { id: body.userId, isActive: true, status: 'ACTIVE' }, select: { id: true } })
    if (!other) throw new HttpError(422, 'That person is not an active PulseTrack user')
    const directKey = [me.id, other.id].sort().join(':')
    const existing = await prisma.chatConversation.findUnique({ where: { directKey } })
    if (existing) {
      res.json({ conversation: { id: existing.id } })
      return
    }
    try {
      const c = await prisma.chatConversation.create({
        data: { type: 'DIRECT', directKey, createdById: me.id, members: { create: [{ userId: me.id }, { userId: other.id }] } },
      })
      res.status(201).json({ conversation: { id: c.id } })
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        const c = await prisma.chatConversation.findUniqueOrThrow({ where: { directKey } })
        res.json({ conversation: { id: c.id } })
        return
      }
      throw e
    }
    return
  }
  const ids = [...new Set(body.userIds.filter((id) => id !== me.id))]
  const ok = await prisma.user.count({ where: { id: { in: ids }, isActive: true, status: 'ACTIVE' } })
  if (ok !== ids.length) throw new HttpError(422, 'Some selected people are not active users')
  const c = await prisma.chatConversation.create({
    data: {
      type: 'GROUP',
      name: body.name,
      createdById: me.id,
      members: { create: [{ userId: me.id, isAdmin: true }, ...ids.map((userId) => ({ userId }))] },
    },
  })
  res.status(201).json({ conversation: { id: c.id } })
}

/** GET /api/chat/conversations/:id — header info + members with presence and read state. */
export async function getConversation(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  touch(me.id)
  const m = await membership(req.params.id, me.id)
  const c = await prisma.chatConversation.findUniqueOrThrow({
    where: { id: m.conversationId },
    include: { project: { select: { key: true, name: true, color: true } }, members: { include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { joinedAt: 'asc' } } },
  })
  const others = c.members.filter((x) => x.userId !== me.id)
  // Picture: group admins for groups; project admins (or Super Admins) for project channels.
  const canChangePicture = c.type === 'GROUP'
    ? m.isAdmin || c.createdById === me.id
    : c.type === 'PROJECT' && !!c.projectId && (me.role === 'SUPER_ADMIN' || !!(await prisma.pmProjectMember.findFirst({ where: { projectId: c.projectId, userId: me.id, role: 'ADMIN' }, select: { id: true } })))
  res.json({
    conversation: {
      id: c.id,
      type: c.type,
      canChangePicture,
      title: c.type === 'DIRECT' ? others[0]?.user.name ?? 'Direct message' : c.type === 'PROJECT' ? `# ${c.name}` : c.name,
      name: c.name,
      project: c.project,
      canManage: c.type === 'GROUP' && m.isAdmin,
      muted: !!m.mutedUntil && m.mutedUntil > new Date(),
      mutedUntil: m.mutedUntil?.toISOString() ?? null,
      members: c.members.map((x) => ({ id: x.user.id, name: x.user.name, email: x.user.email, isAdmin: x.isAdmin, presence: presenceOf(x.userId), lastReadSeq: x.lastReadSeq })),
    },
  })
}

const patchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  addUserIds: z.array(z.string()).max(100).optional(),
  removeUserIds: z.array(z.string()).max(100).optional(),
})

/** PATCH /api/chat/conversations/:id — rename / add / remove (group admins only). */
export async function updateConversation(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const m = await membership(req.params.id, me.id)
  if (m.conversation.type !== 'GROUP') throw new HttpError(422, 'Only group chats can be edited here')
  if (!m.isAdmin) throw new HttpError(403, 'Only the group admin can change this group')
  const body = parse(patchSchema, req.body)
  if (body.name) await prisma.chatConversation.update({ where: { id: m.conversationId }, data: { name: body.name } })
  if (body.addUserIds?.length) {
    const ok = await prisma.user.findMany({ where: { id: { in: body.addUserIds }, isActive: true, status: 'ACTIVE' }, select: { id: true } })
    await prisma.chatMember.createMany({ data: ok.map((u) => ({ conversationId: m.conversationId, userId: u.id })), skipDuplicates: true })
  }
  if (body.removeUserIds?.length) {
    await prisma.chatMember.deleteMany({ where: { conversationId: m.conversationId, userId: { in: body.removeUserIds.filter((id) => id !== me.id) } } })
  }
  res.json({ ok: true })
}

/** POST /api/chat/conversations/:id/leave — leave a group. */
export async function leaveConversation(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const m = await membership(req.params.id, me.id)
  if (m.conversation.type !== 'GROUP') throw new HttpError(422, 'You can only leave group chats')
  await prisma.chatMember.delete({ where: { id: m.id } })
  if (m.isAdmin) {
    const next = await prisma.chatMember.findFirst({ where: { conversationId: m.conversationId }, orderBy: { joinedAt: 'asc' } })
    if (next) await prisma.chatMember.update({ where: { id: next.id }, data: { isAdmin: true } })
  }
  res.status(204).end()
}

/** GET /api/chat/projects/:key — the project's # channel id (Super Admins auto join). */
export async function projectConversation(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const ctx = await loadProjectCtx(req.params.key, me)
  await syncProjectChannel(ctx.project.id)
  const conv = await prisma.chatConversation.findUniqueOrThrow({ where: { projectId: ctx.project.id } })
  if (ctx.isSuperAdmin && !ctx.pmRole) {
    await prisma.chatMember.createMany({ data: [{ conversationId: conv.id, userId: me.id, isAdmin: true }], skipDuplicates: true })
  }
  res.json({ conversation: { id: conv.id } })
}

// ---------- Messages ----------

/**
 * GET /api/chat/conversations/:id/messages?after=<seq> | ?before=<seq>&limit=50
 * `after` is the live poll (new messages since the cursor), `before` pages history.
 * Also returns who is typing and each member's read cursor (for "Seen").
 */
export async function listMessages(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  touch(me.id)
  const m = await membership(req.params.id, me.id)
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100)
  const after = req.query.after !== undefined ? Number(req.query.after) : null
  const before = req.query.before !== undefined ? Number(req.query.before) : null
  let rows: MessageRow[]
  let hasMore = false
  if (after !== null && Number.isFinite(after)) {
    rows = await prisma.chatMessage.findMany({ where: { conversationId: m.conversationId, seq: { gt: after } }, include: MESSAGE_INCLUDE, orderBy: { seq: 'asc' }, take: 200 })
  } else {
    const desc = await prisma.chatMessage.findMany({
      where: { conversationId: m.conversationId, ...(before !== null && Number.isFinite(before) ? { seq: { lt: before } } : {}) },
      include: MESSAGE_INCLUDE,
      orderBy: { seq: 'desc' },
      take: limit + 1,
    })
    hasMore = desc.length > limit
    rows = desc.slice(0, limit).reverse()
  }
  // Edits/deletes since the client's last poll, so open threads stay correct.
  const changedSince = req.query.changedSince ? new Date(String(req.query.changedSince)) : null
  let changed: MessageRow[] = []
  if (changedSince && !Number.isNaN(changedSince.getTime())) {
    changed = await prisma.chatMessage.findMany({
      where: { conversationId: m.conversationId, OR: [{ editedAt: { gt: changedSince } }, { deletedAt: { gt: changedSince } }, { call: { is: { endedAt: { gt: changedSince } } } }, { reactedAt: { gt: changedSince } }] },
      include: MESSAGE_INCLUDE,
      take: 100,
    })
  }
  const visible = new Set(await visibleProjectIds(me, true))
  const members = await prisma.chatMember.findMany({ where: { conversationId: m.conversationId }, select: { userId: true, lastReadSeq: true } })
  res.json({
    messages: rows.map((r) => serializeMessage(r, visible)),
    changed: changed.map((r) => serializeMessage(r, visible)),
    hasMore,
    typing: typingIn(m.conversationId, me.id),
    reads: members.map((x) => ({ userId: x.userId, lastReadSeq: x.lastReadSeq })),
    serverTime: new Date().toISOString(),
  })
}

const sendSchema = z.object({
  body: z.string().max(MAX_BODY, `Messages are limited to ${MAX_BODY} characters`).default(''),
  replyToId: z.string().nullable().optional(),
  mentions: z.array(z.string()).max(30).optional(),
})

async function resolveTaskRef(body: string): Promise<string | null> {
  const m = body.match(TASK_CODE_RE)
  if (!m) return null
  const t = await prisma.pmTask.findUnique({ where: { code: `${m[1]}-${m[2]}` }, select: { id: true, deletedAt: true } })
  return t && !t.deletedAt ? t.id : null
}

async function afterSend(convId: string, senderId: string, senderName: string, body: string, mentions: string[], convTitle: string) {
  await prisma.chatConversation.update({ where: { id: convId }, data: { lastMessageAt: new Date() } })
  if (mentions.length) {
    await pmNotify({
      userIds: mentions,
      actorId: senderId,
      type: 'MENTION',
      title: `${senderName} mentioned you in ${convTitle}`,
      body: trunc(body, 100),
      link: `/app/chat?c=${convId}`,
      email: { pref: 'emailMention', subject: `${senderName} mentioned you in ${convTitle}`, heading: `You were mentioned in ${convTitle}`, lines: [`${senderName} wrote:`, `"${trunc(body, 400)}"`], cta: 'Open the chat' },
    })
  }
}

function convTitleFor(c: { type: string; name: string | null }, senderName: string): string {
  if (c.type === 'DIRECT') return `a message from ${senderName}`
  if (c.type === 'PROJECT') return `# ${c.name}`
  return c.name ?? 'a group chat'
}

/** POST /api/chat/conversations/:id/messages */
export async function sendMessage(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  touch(me.id)
  const m = await membership(req.params.id, me.id)
  const body = parse(sendSchema, req.body)
  const text = body.body.trim()
  if (!text) throw new HttpError(422, 'Message is empty')
  rateLimitSend(me.id)
  const memberIds = new Set((await prisma.chatMember.findMany({ where: { conversationId: m.conversationId }, select: { userId: true } })).map((x) => x.userId))
  // "@all" (or "@everyone") mentions every member of the conversation except the sender.
  const mentionAll = /(^|\s)@(all|everyone)\b/i.test(text)
  const mentions = mentionAll
    ? [...memberIds].filter((id) => id !== me.id)
    : [...new Set(body.mentions ?? [])].filter((id) => memberIds.has(id) && id !== me.id)
  let replyToId: string | null = null
  if (body.replyToId) {
    const r = await prisma.chatMessage.findFirst({ where: { id: body.replyToId, conversationId: m.conversationId }, select: { id: true } })
    replyToId = r?.id ?? null
  }
  const msg = await prisma.chatMessage.create({
    data: { conversationId: m.conversationId, userId: me.id, body: text, mentions, replyToId, taskRefId: await resolveTaskRef(text) },
    include: MESSAGE_INCLUDE,
  })
  // Sending means you've read everything up to your own message.
  await prisma.chatMember.update({ where: { id: m.id }, data: { lastReadSeq: msg.seq, lastReadAt: new Date() } })
  setTyping(m.conversationId, me.id, false)
  await afterSend(m.conversationId, me.id, msg.user.name, text, mentions, convTitleFor(m.conversation, msg.user.name))
  const visible = new Set(await visibleProjectIds(me, true))
  res.status(201).json({ message: serializeMessage(msg, visible) })
}

/** POST /api/chat/conversations/:id/files?name=&caption= — raw binary body. */
export async function sendFile(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const m = await membership(req.params.id, me.id)
  rateLimitSend(me.id)
  const buf = req.body as Buffer
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw new HttpError(400, 'No file received')
  if (buf.length > MAX_BYTES) throw new HttpError(413, 'File is larger than 25 MB')
  const originalName = String(req.query.name || 'file').slice(0, 200).replace(/[\r\n"]/g, '').trim() || 'file'
  const ext = path.extname(originalName).replace('.', '').toLowerCase()
  if (BLOCKED_EXT.has(ext)) throw new HttpError(415, 'That file type is not allowed')
  const caption = String(req.query.caption || '').slice(0, MAX_BODY).trim()
  await fs.mkdir(UPLOAD_DIR, { recursive: true })
  const storedName = `${randomUUID()}${ext ? `.${ext}` : ''}`
  await fs.writeFile(path.join(UPLOAD_DIR, storedName), buf)
  const msg = await prisma.chatMessage.create({
    data: {
      conversationId: m.conversationId,
      userId: me.id,
      body: caption,
      fileStoredName: storedName,
      fileName: originalName,
      fileMime: String(req.headers['content-type'] || 'application/octet-stream').slice(0, 120),
      fileSize: buf.length,
      taskRefId: caption ? await resolveTaskRef(caption) : null,
    },
    include: MESSAGE_INCLUDE,
  })
  await prisma.chatMember.update({ where: { id: m.id }, data: { lastReadSeq: msg.seq, lastReadAt: new Date() } })
  await prisma.chatConversation.update({ where: { id: m.conversationId }, data: { lastMessageAt: new Date() } })
  const visible = new Set(await visibleProjectIds(me, true))
  res.status(201).json({ message: serializeMessage(msg, visible) })
}

/** GET /api/chat/files/:messageId — members of that conversation only. */
export async function downloadFile(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const msg = await prisma.chatMessage.findUnique({ where: { id: req.params.messageId } })
  if (!msg || msg.deletedAt || !msg.fileStoredName) throw new HttpError(404, 'File not found')
  await membership(msg.conversationId, me.id)
  const filePath = path.join(UPLOAD_DIR, msg.fileStoredName)
  try { await fs.access(filePath) } catch { throw new HttpError(404, 'File missing on server') }
  // Raster images and videos (call recordings) may play inline; everything else is forced to download.
  const isMedia = /^(image\/(png|jpe?g|gif|webp)|video\/(webm|mp4))$/i.test(msg.fileMime ?? '')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Type', isMedia ? msg.fileMime! : 'application/octet-stream')
  res.setHeader('Content-Disposition', `${isMedia && req.query.inline === '1' ? 'inline' : 'attachment'}; filename="${encodeURIComponent(msg.fileName ?? 'file')}"`)
  res.sendFile(filePath)
}

async function ownMessage(req: AuthedRequest) {
  const me = viewer(req)
  const msg = await prisma.chatMessage.findUnique({ where: { id: req.params.id } })
  if (!msg || msg.deletedAt) throw new HttpError(404, 'Message not found')
  await membership(msg.conversationId, me.id)
  if (msg.userId !== me.id) throw new HttpError(403, 'You can only change your own messages')
  return { msg, me }
}

export async function editMessage(req: AuthedRequest, res: Response): Promise<void> {
  const { msg, me } = await ownMessage(req)
  const { body } = parse(z.object({ body: z.string().trim().min(1).max(MAX_BODY) }), req.body)
  const row = await prisma.chatMessage.update({ where: { id: msg.id }, data: { body, editedAt: new Date(), taskRefId: await resolveTaskRef(body) }, include: MESSAGE_INCLUDE })
  const visible = new Set(await visibleProjectIds(me, true))
  res.json({ message: serializeMessage(row, visible) })
}

export async function deleteMessage(req: AuthedRequest, res: Response): Promise<void> {
  const { msg } = await ownMessage(req)
  await prisma.chatMessage.update({ where: { id: msg.id }, data: { deletedAt: new Date() } })
  if (msg.fileStoredName) await fs.rm(path.join(UPLOAD_DIR, msg.fileStoredName), { force: true }).catch(() => undefined)
  res.status(204).end()
}

/** POST /api/chat/conversations/:id/read { seq } — read cursor only ever moves forward. */
export async function markRead(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const m = await membership(req.params.id, me.id)
  const { seq } = parse(z.object({ seq: z.number().int().min(0) }), req.body)
  const max = await prisma.chatMessage.aggregate({ where: { conversationId: m.conversationId }, _max: { seq: true } })
  const target = Math.min(seq, max._max.seq ?? 0)
  if (target > m.lastReadSeq) await prisma.chatMember.update({ where: { id: m.id }, data: { lastReadSeq: target, lastReadAt: new Date() } })
  res.json({ lastReadSeq: Math.max(target, m.lastReadSeq) })
}

/** POST /api/chat/conversations/:id/mute { until: ISO | null } */
export async function mute(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const m = await membership(req.params.id, me.id)
  const { until } = parse(z.object({ until: z.string().datetime().nullable() }), req.body)
  await prisma.chatMember.update({ where: { id: m.id }, data: { mutedUntil: until ? new Date(until) : null } })
  res.json({ mutedUntil: until })
}

/** POST /api/chat/conversations/:id/typing { typing } */
export async function typingPing(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const m = await membership(req.params.id, me.id)
  touch(me.id)
  setTyping(m.conversationId, me.id, req.body?.typing !== false)
  res.status(204).end()
}

/** GET /api/chat/unread — badge count for the top bar (muted chats excluded) + presence ping. */
export async function unreadSummary(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  touch(me.id)
  const unread = await unreadByConversation(me.id)
  const muted = await prisma.chatMember.findMany({ where: { userId: me.id, mutedUntil: { gt: new Date() } }, select: { conversationId: true } })
  const mutedIds = new Set(muted.map((x) => x.conversationId))
  let total = 0
  let conversations = 0
  for (const [cid, n] of unread) {
    if (mutedIds.has(cid) || n === 0) continue
    total += n
    conversations++
  }
  // Newest unread message (not muted) so the browser can show a desktop pop-up for it.
  let latest: { id: string; conversationId: string; from: string; text: string; where: string | null; isDirect: boolean; isCall: boolean } | null = null
  if (total > 0) {
    const rows = await prisma.$queryRaw<{ id: string; conversationId: string; body: string; hasFile: boolean; isCall: boolean; from: string; type: string; name: string | null }[]>(Prisma.sql`
      SELECT m.id, m."conversationId", m.body, (m."fileName" IS NOT NULL) AS "hasFile", (m."callId" IS NOT NULL) AS "isCall", u.name AS "from", c.type::text AS type, c.name
      FROM "ChatMessage" m
      JOIN "ChatMember" cm ON cm."conversationId" = m."conversationId" AND cm."userId" = ${me.id}
      JOIN "ChatConversation" c ON c.id = m."conversationId"
      JOIN "User" u ON u.id = m."userId"
      WHERE m.seq > cm."lastReadSeq" AND m."userId" <> ${me.id} AND m."deletedAt" IS NULL
        AND (cm."mutedUntil" IS NULL OR cm."mutedUntil" <= NOW())
      ORDER BY m."createdAt" DESC
      LIMIT 1`)
    const r = rows[0]
    if (r) {
      latest = {
        id: r.id,
        conversationId: r.conversationId,
        from: r.from,
        text: trunc(r.body || (r.hasFile ? 'Sent a file' : ''), 120),
        where: r.type === 'DIRECT' ? null : r.type === 'PROJECT' ? `# ${r.name ?? ''}` : r.name,
        isDirect: r.type === 'DIRECT',
        isCall: r.isCall,
      }
    }
  }
  res.json({ total, conversations, latest })
}

/** GET /api/chat/users?q= — active people you can message, with presence. */
export async function chatUsers(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const q = String(req.query.q || '').trim()
  const users = await prisma.user.findMany({
    where: { isActive: true, status: 'ACTIVE', id: { not: me.id }, ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] } : {}) },
    select: { id: true, name: true, email: true, department: { select: { name: true } } },
    orderBy: { name: 'asc' },
    take: 300,
  })
  res.json({ users: users.map((u) => ({ id: u.id, name: u.name, email: u.email, department: u.department?.name ?? null, presence: presenceOf(u.id) })) })
}

/** GET /api/chat/search?q=&conversationId= — search messages in chats I belong to. */
export async function searchMessages(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const q = String(req.query.q || '').trim()
  if (q.length < 2) {
    res.json({ results: [] })
    return
  }
  const convIds = (await prisma.chatMember.findMany({ where: { userId: me.id }, select: { conversationId: true } })).map((x) => x.conversationId)
  const only = req.query.conversationId ? String(req.query.conversationId) : null
  const scope = only ? convIds.filter((id) => id === only) : convIds
  const rows = await prisma.chatMessage.findMany({
    where: { conversationId: { in: scope }, deletedAt: null, body: { contains: q, mode: 'insensitive' } },
    include: { user: { select: { name: true } }, conversation: { select: { id: true, type: true, name: true } } },
    orderBy: { seq: 'desc' },
    take: 50,
  })
  res.json({
    results: rows.map((r) => ({ id: r.id, seq: r.seq, conversationId: r.conversationId, conversationName: r.conversation.type === 'DIRECT' ? 'Direct message' : r.conversation.name, userName: r.user.name, body: trunc(r.body, 160), createdAt: r.createdAt.toISOString() })),
  })
}

// ---------- Calls (voice / video) ----------

async function liveCallFor(req: AuthedRequest) {
  const me = viewer(req)
  const call = Calls.getLive(req.params.callId)
  if (!call) throw new HttpError(410, 'This call has ended')
  // Members of the conversation, plus people added to this call ("Add people").
  if (!call.invited.has(me.id) && !call.participants.has(me.id)) await membership(call.conversationId, me.id) // 404 for others
  return { me, call }
}

async function displayName(userId: string): Promise<string> {
  return (await prisma.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ?? 'Someone'
}

/** POST /api/chat/conversations/:id/calls { video } — start a call (or get the one already running here). */
export async function startCall(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const m = await membership(req.params.id, me.id)
  const video = req.body?.video !== false
  const existing = Calls.liveForConversation(m.conversationId)
  if (existing) {
    res.json({ call: { id: existing.callId, video: existing.video, conversationId: existing.conversationId }, existing: true })
    return
  }
  const name = await displayName(me.id)
  const meetingId = await meetingFor(m.conversationId)
  // Scheduled meetings can switch the AI note taker on by themselves.
  const autoNotes = meetingId ? (await prisma.meeting.findUnique({ where: { id: meetingId }, select: { autoNotes: true } }))?.autoNotes ?? false : false
  const call = await prisma.chatCall.create({ data: { conversationId: m.conversationId, startedById: me.id, video, joinedIds: [me.id], meetingId, noteTaker: autoNotes } })
  // People are told by the in-app ringing banner (+ desktop pop-up); a missed one-to-one call leaves an alert.
  Calls.registerLive({ callId: call.id, conversationId: m.conversationId, video, startedById: me.id, startedByName: name, startedAt: Date.now(), isDirect: m.conversation.type === 'DIRECT', meetingId })
  if (autoNotes) Calls.getLive(call.id)!.noteTaker = true
  await prisma.chatMessage.create({ data: { conversationId: m.conversationId, userId: me.id, body: `Started a ${video ? 'video' : 'voice'} call`, callId: call.id, mentions: [] } })
  await prisma.chatConversation.update({ where: { id: m.conversationId }, data: { lastMessageAt: new Date() } })
  res.status(201).json({ call: { id: call.id, video, conversationId: m.conversationId }, existing: false })
}

/** GET /api/chat/calls/active — calls running in my conversations (ringing = I have not joined or declined yet). */
export async function activeCalls(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  touch(me.id)
  const lives = Calls.allLive()
  if (!lives.length) { res.json({ calls: [] }); return }
  const mine = await prisma.chatMember.findMany({
    where: { userId: me.id, conversationId: { in: lives.map((c) => c.conversationId) } },
    select: { conversationId: true, conversation: { select: { type: true, name: true, members: { select: { user: { select: { id: true, name: true } } } } } } },
  })
  const byConv = new Map(mine.map((x) => [x.conversationId, x.conversation]))
  const now = Date.now()
  res.json({
    calls: lives.filter((c) => byConv.has(c.conversationId) || c.invited.has(me.id) || c.participants.has(me.id)).map((c) => {
      const conv = byConv.get(c.conversationId)
      const title = !conv ? `${c.startedByName}'s call` : conv.type === 'DIRECT' ? (conv.members.find((x) => x.user.id !== me.id)?.user.name ?? 'Direct message') : conv.type === 'PROJECT' ? `# ${conv.name ?? ''}` : (conv.name ?? 'Group')
      return {
        id: c.callId,
        conversationId: c.conversationId,
        title,
        isDirect: !!conv && conv.type === 'DIRECT' && !c.invited.has(me.id),
        video: c.video,
        startedBy: { id: c.startedById, name: c.startedByName },
        startedAt: new Date(c.startedAt).toISOString(),
        participants: Calls.participantList(c),
        joined: c.participants.has(me.id),
        ringing: Calls.isRinging(c, me.id, now),
        full: c.participants.size >= Calls.MAX_PARTICIPANTS,
        invitedBy: c.invitedBy.get(me.id) ?? null,
        guest: !conv,
        meetingId: c.meetingId,
      }
    }),
  })
}

const joinSchema = z.object({ mic: z.boolean().default(true), cam: z.boolean().default(false) })

/** POST /api/chat/calls/:callId/join — returns who is already here (the newcomer calls each of them) + ICE servers. */
export async function joinCall(req: AuthedRequest, res: Response): Promise<void> {
  const { me, call } = await liveCallFor(req)
  const body = parse(joinSchema, req.body ?? {})
  if (!call.participants.has(me.id) && call.participants.size >= Calls.MAX_PARTICIPANTS) throw new HttpError(409, `Calls are limited to ${Calls.MAX_PARTICIPANTS} people`)
  const others = Calls.participantList(call).filter((p) => p.userId !== me.id)
  Calls.join(call, me.id, await displayName(me.id), body)
  await prisma.chatCall.update({ where: { id: call.callId }, data: { joinedIds: [...call.joinedIds] } }).catch(() => undefined)
  res.json({ callId: call.callId, video: call.video, conversationId: call.conversationId, me: me.id, others, iceServers: await Calls.iceServers(), guest: call.guests.has(me.id), noteTaker: call.noteTaker, meetingId: call.meetingId, isDirect: call.isDirect, sttMode: groqEnabled() ? 'server' : 'browser' })
}

const signalSchema = z.object({ to: z.string(), kind: z.enum(['offer', 'answer', 'ice']), data: z.unknown() })

/** POST /api/chat/calls/:callId/signal — relay an offer / answer / network candidate to one participant. */
export async function callSignal(req: AuthedRequest, res: Response): Promise<void> {
  const { me, call } = await liveCallFor(req)
  if (!call.participants.has(me.id)) throw new HttpError(409, 'Join the call first')
  const body = parse(signalSchema, req.body)
  if (!call.participants.has(body.to)) { res.json({ ok: false }); return }
  const size = JSON.stringify(body.data ?? null).length
  if (size > 64_000) throw new HttpError(413, 'Signal too large')
  Calls.push(call, body.to, me.id, body.kind, body.data)
  res.json({ ok: true })
}

const stateSchema = z.object({ mic: z.boolean().optional(), cam: z.boolean().optional(), screen: z.boolean().optional(), hand: z.boolean().optional(), rec: z.boolean().optional() })

/** GET /api/chat/calls/:callId/poll — my pending signals + who is in the call. Also keeps me "present". */
export async function pollCall(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const call = Calls.getLive(req.params.callId)
  if (!call) { res.json({ ended: true, participants: [], signals: [] }); return }
  const p = call.participants.get(me.id)
  if (!p) { res.json({ ended: false, removed: true, participants: Calls.participantList(call), signals: [] }); return }
  p.lastSeen = Date.now()
  const signals = call.inbox.get(me.id) ?? []
  call.inbox.set(me.id, [])
  res.json({ ended: false, participants: Calls.participantList(call), signals, declined: [...call.declined], noteTaker: call.noteTaker, captions: Calls.recentCaptions(call), invited: [...call.invited.keys()].filter((id) => !call.participants.has(id)) })
}

/** POST /api/chat/calls/:callId/state — mic / camera / screen share on or off (shown to others). */
export async function callState(req: AuthedRequest, res: Response): Promise<void> {
  const { me, call } = await liveCallFor(req)
  const p = call.participants.get(me.id)
  if (!p) throw new HttpError(409, 'Join the call first')
  const body = parse(stateSchema, req.body ?? {})
  Object.assign(p, Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)))
  p.lastSeen = Date.now()
  res.json({ ok: true })
}

/** POST /api/chat/calls/:callId/leave */
export async function leaveCall(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const call = Calls.getLive(req.params.callId)
  if (call) {
    Calls.leave(call, me.id)
    if (call.participants.size === 0) await Calls.endCall(call)
  }
  res.json({ ok: true })
}

/** POST /api/chat/calls/:callId/decline — stop ringing for me. */
export async function declineCall(req: AuthedRequest, res: Response): Promise<void> {
  const { me, call } = await liveCallFor(req)
  Calls.decline(call, me.id)
  res.json({ ok: true })
}

// ---------- In-call extras: add people, reactions, captions, AI notes, recordings ----------

const inviteSchema = z.object({ userIds: z.array(z.string()).min(1).max(20) })

/** POST /api/chat/calls/:callId/invite { userIds } — ring more people into a running call. */
export async function inviteToCall(req: AuthedRequest, res: Response): Promise<void> {
  const { me, call } = await liveCallFor(req)
  if (!call.participants.has(me.id)) throw new HttpError(409, 'Join the call first')
  const { userIds } = parse(inviteSchema, req.body)
  const users = await prisma.user.findMany({ where: { id: { in: userIds.filter((id) => id !== me.id) }, isActive: true, status: 'ACTIVE' }, select: { id: true, name: true } })
  if (!users.length) throw new HttpError(422, 'Pick people who use PulseTrack')
  const conv = await prisma.chatConversation.findUniqueOrThrow({ where: { id: call.conversationId }, select: { type: true } })
  const members = new Set((await prisma.chatMember.findMany({ where: { conversationId: call.conversationId }, select: { userId: true } })).map((x) => x.userId))
  const myName = await displayName(me.id)
  for (const u of users) {
    let guest = !members.has(u.id)
    // Group chats (and meeting chats) take them in as members, so they also get the chat.
    if (guest && conv.type === 'GROUP') {
      await prisma.chatMember.create({ data: { conversationId: call.conversationId, userId: u.id } }).catch(() => undefined)
      if (call.meetingId) await prisma.meetingAttendee.create({ data: { meetingId: call.meetingId, userId: u.id, response: 'ACCEPTED' } }).catch(() => undefined)
      guest = false
    }
    Calls.invite(call, u.id, guest, myName)
  }
  res.json({ invited: users.map((u) => ({ id: u.id, name: u.name })) })
}

const REACTIONS = ['👍', '👏', '❤️', '😂', '😮', '🎉', '✋', '🙏']

/** POST /api/chat/calls/:callId/react { emoji } — a floating reaction everyone sees. */
export async function reactInCall(req: AuthedRequest, res: Response): Promise<void> {
  const { me, call } = await liveCallFor(req)
  const p = call.participants.get(me.id)
  if (!p) throw new HttpError(409, 'Join the call first')
  const { emoji } = parse(z.object({ emoji: z.string().refine((e) => REACTIONS.includes(e), 'Unknown reaction') }), req.body)
  Calls.broadcast(call, me.id, 'react', { emoji, name: p.name })
  res.json({ ok: true })
}

/** POST /api/chat/calls/:callId/notes { on } — switch the AI note taker on or off. */
export async function setNoteTaker(req: AuthedRequest, res: Response): Promise<void> {
  const { me, call } = await liveCallFor(req)
  if (!call.participants.has(me.id)) throw new HttpError(409, 'Join the call first')
  const { on } = parse(z.object({ on: z.boolean() }), req.body)
  if (call.noteTaker === on) { res.json({ noteTaker: on }); return }
  call.noteTaker = on
  if (on) {
    await prisma.chatCall.update({ where: { id: call.callId }, data: { noteTaker: true, notesStatus: null } })
  } else {
    // Stopped by hand: write the notes now rather than waiting for the call to end
    // (after a few seconds, so everyone's last piece of speech arrives first).
    scheduleNotes(call.callId)
  }
  res.json({ noteTaker: on })
}

const transcriptSchema = z.object({ text: z.string().trim().min(1).max(2000), final: z.boolean().default(true) })

/** POST /api/chat/calls/:callId/transcript { text, final } — my own speech, from my browser. */
export async function postTranscript(req: AuthedRequest, res: Response): Promise<void> {
  const { me, call } = await liveCallFor(req)
  const p = call.participants.get(me.id)
  if (!p) throw new HttpError(409, 'Join the call first')
  const { text, final } = parse(transcriptSchema, req.body)
  Calls.addCaption(call, me.id, p.name, text, final)
  // With Groq set up, the server transcribes the audio itself; browser text is only for live captions.
  if (final && call.noteTaker && !groqEnabled()) await prisma.callTranscriptLine.create({ data: { callId: call.callId, userId: me.id, speakerName: p.name, text } })
  res.json({ ok: true })
}

/** Members of the conversation, and anyone who was in the call, can read its notes. */
async function callForReader(callId: string, userId: string) {
  const call = await prisma.chatCall.findUnique({ where: { id: callId }, include: { meeting: { select: { id: true, title: true } }, conversation: { select: { id: true, name: true, type: true } } } })
  if (!call) throw new HttpError(404, 'Call not found')
  if (!call.joinedIds.includes(userId)) await membership(call.conversationId, userId)
  return call
}

/** GET /api/chat/calls/:callId/notes — AI notes + full transcript. */
export async function callNotes(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const call = await callForReader(req.params.callId, me.id)
  const lines = await prisma.callTranscriptLine.findMany({ where: { callId: call.id }, orderBy: { at: 'asc' } })
  const recordings = await prisma.callRecording.findMany({ where: { callId: call.id, status: 'ready' }, orderBy: { createdAt: 'asc' } })
  const notes = call.notes as unknown as (MeetingNotes & { error?: string }) | null
  res.json({
    call: { id: call.id, startedAt: call.startedAt.toISOString(), endedAt: call.endedAt?.toISOString() ?? null, video: call.video, title: call.meeting?.title ?? call.conversation.name ?? 'Call', meetingId: call.meeting?.id ?? null, conversationId: call.conversationId },
    status: call.notesStatus ?? (call.noteTaker ? (call.endedAt ? 'pending' : 'recording') : 'none'),
    provider: notesProvider(),
    piecesLeft: Stt.pendingFor(call.id),
    notes: notes && !notes.error ? notes : null,
    error: notes?.error ?? null,
    transcript: lines.map((l) => ({ id: l.id, userId: l.userId, speaker: l.speakerName, text: l.text, at: l.at.toISOString(), offsetSec: Math.max(0, Math.round((l.at.getTime() - call.startedAt.getTime()) / 1000)) })),
    transcriptText: transcriptText(call.startedAt, lines),
    recordings: recordings.map((r) => ({ id: r.id, messageId: r.messageId, size: r.size, durationSec: r.durationSec, url: r.messageId ? `/api/chat/files/${r.messageId}` : null, createdAt: r.createdAt.toISOString() })),
  })
}

/** POST /api/chat/calls/:callId/notes/retry — write the AI notes again. */
export async function retryNotes(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const call = await callForReader(req.params.callId, me.id)
  if (Calls.getLive(call.id)?.noteTaker) throw new HttpError(409, 'The note taker is still on. Stop it first.')
  await generateNotes(call.id, { force: true })
  res.json({ ok: true })
}

// Recordings are uploaded in small pieces while they are made (works behind the tunnel's size limit).
const MAX_RECORDING_BYTES = 4 * 1024 * 1024 * 1024
const MAX_CHUNK_BYTES = 10 * 1024 * 1024

/** POST /api/chat/calls/:callId/recordings { mime } — start a recording. */
export async function startRecording(req: AuthedRequest, res: Response): Promise<void> {
  const { me, call } = await liveCallFor(req)
  if (!call.participants.has(me.id)) throw new HttpError(409, 'Join the call first')
  const { mime } = parse(z.object({ mime: z.string().max(120).default('video/webm') }), req.body ?? {})
  if (!/^video\/(webm|mp4)/.test(mime)) throw new HttpError(415, 'Recordings must be video')
  await fs.mkdir(UPLOAD_DIR, { recursive: true })
  const storedName = `rec-${randomUUID()}.${mime.startsWith('video/mp4') ? 'mp4' : 'webm'}`
  await fs.writeFile(path.join(UPLOAD_DIR, storedName), Buffer.alloc(0))
  const rec = await prisma.callRecording.create({ data: { callId: call.callId, userId: me.id, storedName, mime: mime.split(';')[0] } })
  res.status(201).json({ recording: { id: rec.id } })
}

async function ownRecording(req: AuthedRequest) {
  const me = viewer(req)
  const rec = await prisma.callRecording.findUnique({ where: { id: req.params.recId } })
  if (!rec || rec.userId !== me.id) throw new HttpError(404, 'Recording not found')
  if (rec.status !== 'uploading') throw new HttpError(409, 'This recording is already finished')
  return { me, rec }
}

/** POST /api/chat/recordings/:recId/chunk?index=n — raw bytes, in order. */
export async function recordingChunk(req: AuthedRequest, res: Response): Promise<void> {
  const { rec } = await ownRecording(req)
  const index = Number(req.query.index)
  const buf = req.body as Buffer
  if (!Buffer.isBuffer(buf) || !buf.length) throw new HttpError(400, 'Empty piece')
  if (buf.length > MAX_CHUNK_BYTES) throw new HttpError(413, 'Piece too large')
  if (index < rec.chunks) { res.json({ ok: true, duplicate: true }); return } // a retry of a piece we already have
  if (index !== rec.chunks) throw new HttpError(409, `Expected piece ${rec.chunks}`)
  if (rec.size + buf.length > MAX_RECORDING_BYTES) throw new HttpError(413, 'Recording is too large')
  await fs.appendFile(path.join(UPLOAD_DIR, rec.storedName), buf)
  await prisma.callRecording.update({ where: { id: rec.id }, data: { chunks: { increment: 1 }, size: { increment: buf.length } } })
  res.json({ ok: true })
}

/** POST /api/chat/recordings/:recId/finish { durationSec } — post the video in the chat. */
export async function finishRecording(req: AuthedRequest, res: Response): Promise<void> {
  const { me, rec } = await ownRecording(req)
  const { durationSec } = parse(z.object({ durationSec: z.number().int().min(0).max(24 * 3600).default(0) }), req.body ?? {})
  if (!rec.size) {
    await prisma.callRecording.update({ where: { id: rec.id }, data: { status: 'failed' } })
    await fs.rm(path.join(UPLOAD_DIR, rec.storedName), { force: true }).catch(() => undefined)
    res.json({ ok: false })
    return
  }
  const call = await prisma.chatCall.findUniqueOrThrow({ where: { id: rec.callId }, include: { meeting: { select: { title: true } } } })
  const mins = Math.max(1, Math.round(durationSec / 60))
  const when = new Date().toISOString().slice(0, 10)
  const name = `${(call.meeting?.title ?? 'Call recording').replace(/[\\/:*?"<>|]/g, ' ').slice(0, 80)} ${when}.${rec.storedName.split('.').pop()}`
  const msg = await prisma.chatMessage.create({
    data: {
      conversationId: call.conversationId,
      userId: me.id,
      body: `Call recording · ${durationSec < 60 ? `${durationSec} sec` : `${mins} min`}`,
      fileStoredName: rec.storedName,
      fileName: name,
      fileMime: rec.mime,
      fileSize: rec.size,
      callId: null,
      mentions: [],
    },
  })
  await prisma.callRecording.update({ where: { id: rec.id }, data: { status: 'ready', durationSec, messageId: msg.id } })
  await prisma.chatConversation.update({ where: { id: call.conversationId }, data: { lastMessageAt: new Date() } })
  res.json({ ok: true, messageId: msg.id })
}

// ---------- Emoji reactions on messages ----------

const MESSAGE_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🎉', '🙏', '✅']

/** POST /api/chat/messages/:id/react { emoji } — toggles my reaction. */
export async function toggleReaction(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const msg = await prisma.chatMessage.findUnique({ where: { id: req.params.id } })
  if (!msg || msg.deletedAt) throw new HttpError(404, 'Message not found')
  await membership(msg.conversationId, me.id)
  const { emoji } = parse(z.object({ emoji: z.string().refine((e) => MESSAGE_REACTIONS.includes(e), 'Unknown reaction') }), req.body)
  const existing = await prisma.chatReaction.findUnique({ where: { messageId_userId_emoji: { messageId: msg.id, userId: me.id, emoji } } })
  if (existing) await prisma.chatReaction.delete({ where: { id: existing.id } })
  else await prisma.chatReaction.create({ data: { messageId: msg.id, userId: me.id, emoji } })
  const row = await prisma.chatMessage.update({ where: { id: msg.id }, data: { reactedAt: new Date() }, include: MESSAGE_INCLUDE })
  const visible = new Set(await visibleProjectIds(me, true))
  res.json({ message: serializeMessage(row, visible) })
}

/** Write the notes a few seconds after the note taker stops, so the last pieces of speech arrive. */
export function scheduleNotes(callId: string, delayMs = Number(process.env.NOTES_DELAY_MS ?? 8000)): void {
  setTimeout(() => { void generateNotes(callId).catch((e) => console.error('[notes]', e)) }, delayMs) // eslint-disable-line no-console
}

const AUDIO_MAX = 6 * 1024 * 1024
const RECENT_END_MS = 3 * 60_000

/**
 * POST /api/chat/calls/:callId/audio?mode=mixed|en|ur — a short piece of MY microphone
 * while the note taker is on (raw webm/ogg). Accepted for a few minutes after the call
 * ends, so the last words are not lost.
 */
export async function postAudio(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  if (!groqEnabled()) throw new HttpError(409, 'Server transcription is not set up')
  const live = Calls.getLive(req.params.callId)
  let speaker: string | null = live?.participants.get(me.id)?.name ?? null
  let callId = live?.callId ?? null
  let title: string | null = null
  if (!live || !speaker) {
    // Just ended: still take the last piece from someone who was in it.
    const row = await prisma.chatCall.findUnique({ where: { id: req.params.callId }, select: { id: true, joinedIds: true, endedAt: true, noteTaker: true } })
    if (!row || !row.joinedIds.includes(me.id) || !row.noteTaker || (row.endedAt && Date.now() - row.endedAt.getTime() > RECENT_END_MS)) throw new HttpError(410, 'This call has ended')
    speaker = await displayName(me.id)
    callId = row.id
  } else if (!live.noteTaker) {
    throw new HttpError(409, 'The note taker is off')
  }
  const buf = req.body as Buffer
  if (!Buffer.isBuffer(buf) || buf.length < 200) { res.json({ ok: true, skipped: true }); return }
  if (buf.length > AUDIO_MAX) throw new HttpError(413, 'Piece too large')
  const mode = (['mixed', 'en', 'ur'] as const).find((m) => m === req.query.mode) ?? 'mixed'
  const durationMs = Math.min(Math.max(Number(req.query.durationMs) || 0, 0), 120_000)
  const mime = String(req.headers['content-type'] || 'audio/webm').split(';')[0].slice(0, 40)
  // Names and the meeting title help Whisper spell them right.
  if (live) {
    const conv = await prisma.chatConversation.findUnique({ where: { id: live.conversationId }, select: { name: true } })
    title = conv?.name ?? null
  }
  const names = live ? [...live.participants.values()].map((p) => p.name) : [speaker!]
  const prompt = `${title ? `${title}. ` : ''}Meeting with ${names.join(', ')}. PulseTrack, RTI, Minnesota Computers, 99 Technologies.`
  await Stt.enqueue({ callId: callId!, userId: me.id, speakerName: speaker!, at: new Date(Date.now() - durationMs), mime, mode, prompt, audio: buf })
  res.json({ ok: true })
}

/** PATCH /api/chat/calls/:callId/notes/action-items/:index { taskCode } — remember the task made from an action item. */
export async function linkActionItem(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const call = await callForReader(req.params.callId, me.id)
  const { taskCode } = parse(z.object({ taskCode: z.string().trim().min(2).max(20) }), req.body)
  const task = await prisma.pmTask.findFirst({ where: { code: taskCode, deletedAt: null }, select: { id: true } })
  if (!task) throw new HttpError(422, 'Task not found')
  const notes = call.notes as unknown as MeetingNotes | null
  const i = Number(req.params.index)
  if (!notes || !Array.isArray(notes.actionItems) || !notes.actionItems[i]) throw new HttpError(404, 'Action item not found')
  notes.actionItems[i] = { ...notes.actionItems[i], taskCode }
  await prisma.chatCall.update({ where: { id: call.id }, data: { notes: notes as unknown as Prisma.InputJsonValue } })
  res.json({ ok: true })
}
