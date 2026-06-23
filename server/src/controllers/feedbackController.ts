import type { Response } from 'express'
import { z } from 'zod'
import type { Prisma, User } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'

type Sentiment = 'PRAISE' | 'NEUTRAL' | 'IMPROVEMENT'

const SENTIMENTS: [Sentiment, ...Sentiment[]] = ['PRAISE', 'NEUTRAL', 'IMPROVEMENT']

/** Can `me` author/manage feedback for `recipient`? Mirrors getMemberProfile RBAC. */
function canManage(me: { id: string; role: string; departmentId: string | null }, recipient: { departmentId: string | null }): boolean {
  if (me.role === 'SUPER_ADMIN') return true
  return me.role === 'TEAM_LEAD' && me.departmentId != null && me.departmentId === recipient.departmentId
}

type ThreadWithReplies = Prisma.FeedbackGetPayload<{
  include: { author: true; recipient: true; replies: true }
}>

/** Latest activity in a thread = newest of feedback + replies. */
function latestActivity(t: ThreadWithReplies): Date {
  return t.replies.reduce((max, r) => (r.createdAt > max ? r.createdAt : max), t.createdAt)
}

/** Is the thread unread for this viewer (member uses recipientReadAt, lead authorReadAt)? */
function isUnread(t: ThreadWithReplies, viewerId: string): boolean {
  const readAt = viewerId === t.recipientId ? t.recipientReadAt : viewerId === t.authorId ? t.authorReadAt : null
  if (!readAt) return true
  return latestActivity(t) > readAt
}

function thin(u: User) {
  return { id: u.id, name: u.name, email: u.email, role: u.role }
}

function serializeThread(t: ThreadWithReplies, viewerId: string) {
  return {
    id: t.id,
    title: t.title,
    body: t.body,
    sentiment: t.sentiment,
    author: thin(t.author),
    recipient: thin(t.recipient),
    replyCount: t.replies.length,
    unread: isUnread(t, viewerId),
    createdAt: t.createdAt.toISOString(),
    updatedAt: latestActivity(t).toISOString(),
  }
}

/** GET /api/notifications uses this — count of threads with unread activity for a user. */
export async function countUnreadFeedback(userId: string): Promise<number> {
  const threads = await prisma.feedback.findMany({
    where: { OR: [{ recipientId: userId }, { authorId: userId }] },
    include: { author: true, recipient: true, replies: true },
  })
  return threads.filter((t) => isUnread(t, userId)).length
}

/** GET /api/feedback/unread-count — unread thread count for the sidebar badge. */
export async function getUnreadCount(req: AuthedRequest, res: Response): Promise<void> {
  const count = await countUnreadFeedback(req.user!.id)
  res.json({ count })
}

const createSchema = z.object({
  recipientId: z.string().min(1),
  title: z.string().max(120).optional(),
  body: z.string().min(1).max(4000),
  sentiment: z.enum(SENTIMENTS).default('NEUTRAL'),
})

/** POST /api/feedback — a lead/admin leaves feedback for an employee. */
export async function createFeedback(req: AuthedRequest, res: Response): Promise<void> {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, include: { department: true } })
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const recipient = await prisma.user.findUnique({ where: { id: parsed.data.recipientId } })
  if (!recipient) {
    res.status(404).json({ error: 'Recipient not found' })
    return
  }
  if (!canManage(me, recipient) || recipient.id === me.id) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  const created = await prisma.feedback.create({
    data: {
      authorId: me.id,
      recipientId: recipient.id,
      departmentId: recipient.departmentId,
      title: parsed.data.title?.trim() || null,
      body: parsed.data.body.trim(),
      sentiment: parsed.data.sentiment,
      authorReadAt: new Date(), // author has, by definition, read their own message
    },
    include: { author: true, recipient: true, replies: true },
  })
  res.status(201).json({ feedback: serializeThread(created, me.id) })
}

/**
 * GET /api/feedback           — threads where the caller participates.
 * GET /api/feedback?recipientId=X — threads about member X (lead/admin/self).
 */
export async function listFeedback(req: AuthedRequest, res: Response): Promise<void> {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, include: { department: true } })
  const recipientId = req.query.recipientId as string | undefined

  let where: Prisma.FeedbackWhereInput
  if (recipientId) {
    const recipient = await prisma.user.findUnique({ where: { id: recipientId } })
    if (!recipient) {
      res.status(404).json({ error: 'Recipient not found' })
      return
    }
    if (recipient.id !== me.id && !canManage(me, recipient)) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }
    where = { recipientId }
  } else {
    where = { OR: [{ recipientId: me.id }, { authorId: me.id }] }
  }

  const threads = await prisma.feedback.findMany({
    where,
    include: { author: true, recipient: true, replies: true },
    orderBy: { updatedAt: 'desc' },
  })
  res.json({ feedback: threads.map((t) => serializeThread(t, me.id)) })
}

/** GET /api/feedback/:id — full thread; stamps the caller's read timestamp. */
export async function getFeedbackThread(req: AuthedRequest, res: Response): Promise<void> {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, include: { department: true } })
  const t = await prisma.feedback.findUnique({
    where: { id: req.params.id },
    include: { author: true, recipient: true, replies: { include: { author: true }, orderBy: { createdAt: 'asc' } } },
  })
  if (!t) {
    res.status(404).json({ error: 'Feedback not found' })
    return
  }
  const isParticipant = me.id === t.authorId || me.id === t.recipientId
  if (!isParticipant && !canManage(me, t.recipient)) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  // Stamp read for whichever participant is viewing.
  if (me.id === t.recipientId) await prisma.feedback.update({ where: { id: t.id }, data: { recipientReadAt: new Date() } })
  else if (me.id === t.authorId) await prisma.feedback.update({ where: { id: t.id }, data: { authorReadAt: new Date() } })

  res.json({
    id: t.id,
    title: t.title,
    body: t.body,
    sentiment: t.sentiment,
    author: thin(t.author),
    recipient: thin(t.recipient),
    createdAt: t.createdAt.toISOString(),
    replies: t.replies.map((r) => ({ id: r.id, body: r.body, author: thin(r.author), createdAt: r.createdAt.toISOString() })),
  })
}

const replySchema = z.object({ body: z.string().min(1).max(4000) })

/** POST /api/feedback/:id/replies — a participant replies in the thread. */
export async function replyToFeedback(req: AuthedRequest, res: Response): Promise<void> {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } })
  const t = await prisma.feedback.findUnique({ where: { id: req.params.id } })
  if (!t) {
    res.status(404).json({ error: 'Feedback not found' })
    return
  }
  if (me.id !== t.authorId && me.id !== t.recipientId) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const parsed = replySchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }

  const reply = await prisma.feedbackReply.create({
    data: { feedbackId: t.id, authorId: me.id, body: parsed.data.body.trim() },
    include: { author: true },
  })
  // Bump thread + mark read for the replier.
  await prisma.feedback.update({
    where: { id: t.id },
    data: {
      updatedAt: new Date(),
      ...(me.id === t.recipientId ? { recipientReadAt: new Date() } : { authorReadAt: new Date() }),
    },
  })

  res.status(201).json({ reply: { id: reply.id, body: reply.body, author: thin(reply.author), createdAt: reply.createdAt.toISOString() } })
}
