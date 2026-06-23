import type { Response } from 'express'
import { z } from 'zod'
import type { SeoDailyEntry, Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { companyToday, dbDateFromString, dateStringFromDb } from '../lib/time'

function loadUser(id: string) {
  return prisma.user.findUniqueOrThrow({ where: { id }, include: { department: true } })
}

async function marketingUser(req: AuthedRequest, res: Response) {
  const me = await loadUser(req.user!.id)
  if (me.department?.type === 'MARKETING' || me.role === 'SUPER_ADMIN') return me
  res.status(403).json({ error: 'Marketing access only' })
  return null
}

// ---------- SEO ----------
const SEO_KEYS = ['keywordsTracked', 'pagesOptimized', 'backlinksBuilt', 'technicalFixes', 'organicTraffic'] as const

function serializeSeo(e: SeoDailyEntry) {
  return {
    id: e.id,
    date: dateStringFromDb(e.date),
    status: e.status,
    keywordsTracked: e.keywordsTracked,
    pagesOptimized: e.pagesOptimized,
    backlinksBuilt: e.backlinksBuilt,
    technicalFixes: e.technicalFixes,
    organicTraffic: e.organicTraffic,
    notes: e.notes ?? '',
  }
}

export async function seoGet(req: AuthedRequest, res: Response): Promise<void> {
  const me = await marketingUser(req, res)
  if (!me) return
  const dateStr = (req.query.date as string) || companyToday()
  const entry = await prisma.seoDailyEntry.findUnique({ where: { userId_date: { userId: me.id, date: dbDateFromString(dateStr) } } })
  const recent = await prisma.seoDailyEntry.findMany({ where: { userId: me.id, status: 'SUBMITTED' }, orderBy: { date: 'desc' }, take: 14 })
  const avgTraffic = recent.length ? Math.round(recent.reduce((a, e) => a + e.organicTraffic, 0) / recent.length) : 0
  res.json({ date: dateStr, entry: entry ? serializeSeo(entry) : null, stats: { avgOrganicTraffic: avgTraffic } })
}

const seoSchema = z.object({
  date: z.string().optional(),
  status: z.enum(['SUBMITTED', 'ON_LEAVE', 'HOLIDAY', 'OFF']).default('SUBMITTED'),
  notes: z.string().max(2000).optional(),
  keywordsTracked: z.number().int().min(0).optional(),
  pagesOptimized: z.number().int().min(0).optional(),
  backlinksBuilt: z.number().int().min(0).optional(),
  technicalFixes: z.number().int().min(0).optional(),
  organicTraffic: z.number().int().min(0).optional(),
})

export async function seoUpsert(req: AuthedRequest, res: Response): Promise<void> {
  const me = await marketingUser(req, res)
  if (!me) return
  const parsed = seoSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const { date, status, notes } = parsed.data
  const dateStr = date || companyToday()
  const metrics: Record<string, number> = {}
  for (const k of SEO_KEYS) metrics[k] = status === 'SUBMITTED' ? parsed.data[k] ?? 0 : 0
  const dateValue = dbDateFromString(dateStr)
  const entry = await prisma.seoDailyEntry.upsert({
    where: { userId_date: { userId: me.id, date: dateValue } },
    update: { status, notes: notes ?? null, ...metrics },
    create: { userId: me.id, date: dateValue, status, notes: notes ?? null, ...metrics },
  })
  res.json({ entry: serializeSeo(entry) })
}

// ---------- Social ----------
const SOCIAL_KEYS = ['postsPublished', 'postsScheduled', 'reach', 'engagement', 'followersGained'] as const

type SocialWithPlatforms = Prisma.SocialDailyEntryGetPayload<{ include: { platformCounts: { include: { tag: true } } } }>

function serializeSocial(e: SocialWithPlatforms) {
  return {
    id: e.id,
    date: dateStringFromDb(e.date),
    status: e.status,
    postsPublished: e.postsPublished,
    postsScheduled: e.postsScheduled,
    reach: e.reach,
    engagement: e.engagement,
    followersGained: e.followersGained,
    notes: e.notes ?? '',
    platformCounts: e.platformCounts.map((p) => ({ tagId: p.tagId, posts: p.posts })),
  }
}

export async function socialGet(req: AuthedRequest, res: Response): Promise<void> {
  const me = await marketingUser(req, res)
  if (!me) return
  const dept = me.department ?? (await prisma.department.findUnique({ where: { type: 'MARKETING' } }))
  const dateStr = (req.query.date as string) || companyToday()
  const entry = await prisma.socialDailyEntry.findUnique({
    where: { userId_date: { userId: me.id, date: dbDateFromString(dateStr) } },
    include: { platformCounts: { include: { tag: true } } },
  })
  const platforms = await prisma.tag.findMany({ where: { departmentId: dept?.id, type: 'PLATFORM', isActive: true }, orderBy: { name: 'asc' } })
  res.json({ date: dateStr, entry: entry ? serializeSocial(entry) : null, platforms: platforms.map((p) => ({ id: p.id, name: p.name })) })
}

const socialSchema = z.object({
  date: z.string().optional(),
  status: z.enum(['SUBMITTED', 'ON_LEAVE', 'HOLIDAY', 'OFF']).default('SUBMITTED'),
  notes: z.string().max(2000).optional(),
  postsPublished: z.number().int().min(0).optional(),
  postsScheduled: z.number().int().min(0).optional(),
  reach: z.number().int().min(0).optional(),
  engagement: z.number().int().min(0).optional(),
  followersGained: z.number().int().min(0).optional(),
  platformCounts: z.array(z.object({ tagId: z.string(), posts: z.number().int().min(0) })).optional(),
})

export async function socialUpsert(req: AuthedRequest, res: Response): Promise<void> {
  const me = await marketingUser(req, res)
  if (!me) return
  const dept = me.department ?? (await prisma.department.findUnique({ where: { type: 'MARKETING' } }))
  const parsed = socialSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const { date, status, notes, platformCounts } = parsed.data
  const dateStr = date || companyToday()
  const metrics: Record<string, number> = {}
  for (const k of SOCIAL_KEYS) metrics[k] = status === 'SUBMITTED' ? parsed.data[k] ?? 0 : 0
  const dateValue = dbDateFromString(dateStr)
  const entry = await prisma.socialDailyEntry.upsert({
    where: { userId_date: { userId: me.id, date: dateValue } },
    update: { status, notes: notes ?? null, ...metrics },
    create: { userId: me.id, date: dateValue, status, notes: notes ?? null, ...metrics },
  })
  await prisma.socialPlatformCount.deleteMany({ where: { entryId: entry.id } })
  if (status === 'SUBMITTED' && platformCounts?.length) {
    const valid = new Set((await prisma.tag.findMany({ where: { departmentId: dept?.id, type: 'PLATFORM' } })).map((t) => t.id))
    const rows = platformCounts.filter((p) => p.posts > 0 && valid.has(p.tagId))
    if (rows.length) await prisma.socialPlatformCount.createMany({ data: rows.map((p) => ({ entryId: entry.id, tagId: p.tagId, posts: p.posts })) })
  }
  const full = await prisma.socialDailyEntry.findUniqueOrThrow({ where: { id: entry.id }, include: { platformCounts: { include: { tag: true } } } })
  res.json({ entry: serializeSocial(full) })
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
