import type { Response } from 'express'
import { z } from 'zod'
import type { SeoDailyEntry, ContentDailyEntry, Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { dbDateFromString, dateStringFromDb } from '../lib/time'
import { userToday } from '../lib/userDay'

function loadUser(id: string) {
  return prisma.user.findUniqueOrThrow({ where: { id }, include: { department: true } })
}

async function marketingUser(req: AuthedRequest, res: Response) {
  const me = await loadUser(req.user!.id)
  if (me.department?.type === 'MARKETING' || me.role === 'SUPER_ADMIN') return me
  res.status(403).json({ error: 'Marketing access only' })
  return null
}

// ---------- SEO daily log (free text) ----------
function serializeSeo(e: SeoDailyEntry) {
  return {
    id: e.id,
    date: dateStringFromDb(e.date),
    status: e.status,
    body: e.body ?? '',
    notes: e.notes ?? '',
  }
}

export async function seoGet(req: AuthedRequest, res: Response): Promise<void> {
  const me = await marketingUser(req, res)
  if (!me) return
  const dateStr = (req.query.date as string) || (await userToday(me.id, me.departmentId))
  const entry = await prisma.seoDailyEntry.findUnique({ where: { userId_date: { userId: me.id, date: dbDateFromString(dateStr) } } })
  res.json({ date: dateStr, entry: entry ? serializeSeo(entry) : null })
}

const seoSchema = z.object({
  date: z.string().optional(),
  status: z.enum(['SUBMITTED', 'ON_LEAVE', 'HOLIDAY', 'OFF']).default('SUBMITTED'),
  body: z.string().max(5000).optional(),
  notes: z.string().max(2000).optional(),
})

export async function seoUpsert(req: AuthedRequest, res: Response): Promise<void> {
  const me = await marketingUser(req, res)
  if (!me) return
  const parsed = seoSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const { date, status, body, notes } = parsed.data
  const dateStr = date || (await userToday(me.id, me.departmentId))
  const bodyVal = status === 'SUBMITTED' ? body ?? null : null
  const dateValue = dbDateFromString(dateStr)
  const entry = await prisma.seoDailyEntry.upsert({
    where: { userId_date: { userId: me.id, date: dateValue } },
    update: { status, body: bodyVal, notes: notes ?? null },
    create: { userId: me.id, date: dateValue, status, body: bodyVal, notes: notes ?? null },
  })
  res.json({ entry: serializeSeo(entry) })
}

// ---------- Content daily log (free text) ----------
function serializeContent(e: ContentDailyEntry) {
  return { id: e.id, date: dateStringFromDb(e.date), status: e.status, body: e.body ?? '', notes: e.notes ?? '' }
}

export async function contentGet(req: AuthedRequest, res: Response): Promise<void> {
  const me = await marketingUser(req, res)
  if (!me) return
  const dateStr = (req.query.date as string) || (await userToday(me.id, me.departmentId))
  const entry = await prisma.contentDailyEntry.findUnique({
    where: { userId_date: { userId: me.id, date: dbDateFromString(dateStr) } },
  })
  res.json({ date: dateStr, entry: entry ? serializeContent(entry) : null })
}

const contentSchema = z.object({
  date: z.string().optional(),
  status: z.enum(['SUBMITTED', 'ON_LEAVE', 'HOLIDAY', 'OFF']).default('SUBMITTED'),
  body: z.string().max(5000).optional(),
  notes: z.string().max(2000).optional(),
})

export async function contentUpsert(req: AuthedRequest, res: Response): Promise<void> {
  const me = await marketingUser(req, res)
  if (!me) return
  const parsed = contentSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const { date, status, body, notes } = parsed.data
  const dateStr = date || (await userToday(me.id, me.departmentId))
  const bodyVal = status === 'SUBMITTED' ? body ?? null : null
  const dateValue = dbDateFromString(dateStr)
  const entry = await prisma.contentDailyEntry.upsert({
    where: { userId_date: { userId: me.id, date: dateValue } },
    update: { status, body: bodyVal, notes: notes ?? null },
    create: { userId: me.id, date: dateValue, status, body: bodyVal, notes: notes ?? null },
  })
  res.json({ entry: serializeContent(entry) })
}

// ---------- Content (task list, discipline = CONTENT) ----------
export async function contentList(req: AuthedRequest, res: Response): Promise<void> {
  const me = await marketingUser(req, res)
  if (!me) return
  const tasks = await prisma.marketingTask.findMany({
    where: { discipline: 'CONTENT' },
    include: { assignee: { select: { id: true, name: true } } },
    orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
  })
  res.json({
    items: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      contentType: t.contentType,
      wordCount: t.wordCount,
      wordTarget: t.wordTarget,
      dueDate: t.dueDate ? dateStringFromDb(t.dueDate) : null,
      publishedDate: t.publishedDate ? dateStringFromDb(t.publishedDate) : null,
      assignee: t.assignee,
    })),
  })
}
