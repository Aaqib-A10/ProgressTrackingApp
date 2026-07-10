import type { Response } from 'express'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { resolveMarketingActor, type MarketingActor } from '../lib/marketingAuth'
import { companyToday, dbDateFromString, dateStringFromDb } from '../lib/time'
import { prevMonth } from '../lib/monthTrends'
import { pctDelta } from '../lib/trends'

const MONTH_RE = /^\d{4}-\d{2}$/
const currentMonth = () => companyToday().slice(0, 7)

type BlogWithRefs = Prisma.BlogPostGetPayload<{ include: { brand: true; author: { select: { id: true; name: true } } } }>
function serialize(b: BlogWithRefs) {
  return {
    id: b.id,
    title: b.title,
    url: b.url,
    wordCount: b.wordCount,
    month: b.month,
    publishedAt: b.publishedAt ? dateStringFromDb(b.publishedAt) : null,
    brand: { id: b.brandId, name: b.brand.name },
    author: b.author,
  }
}

async function brandInDept(actor: MarketingActor, brandId: string) {
  const brand = await prisma.brand.findUnique({ where: { id: brandId } })
  return brand && brand.departmentId === actor.deptId ? brand : null
}

/** GET /api/marketing/blogs?brandId=&month= */
export async function listBlogs(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  const where: Prisma.BlogPostWhereInput = { brand: { departmentId: actor.deptId ?? undefined } }
  if (req.query.brandId) where.brandId = String(req.query.brandId)
  if (req.query.month) where.month = String(req.query.month)
  const blogs = await prisma.blogPost.findMany({
    where,
    include: { brand: true, author: { select: { id: true, name: true } } },
    orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
  })
  res.json({ blogs: blogs.map(serialize) })
}

const createSchema = z.object({
  brandId: z.string().min(1),
  title: z.string().min(1).max(300),
  url: z.string().max(600).optional(),
  wordCount: z.number().int().min(0).max(1_000_000).optional(),
  publishedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

/** POST /api/marketing/blogs — content team, lead or admin. */
export async function createBlog(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  if (!actor.canWriteContent) {
    res.status(403).json({ error: 'Content team, Team Lead or Admin only' })
    return
  }
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const brand = await brandInDept(actor, parsed.data.brandId)
  if (!brand) {
    res.status(404).json({ error: 'Brand not found' })
    return
  }
  const publishedStr = parsed.data.publishedAt || companyToday()
  const month = publishedStr.slice(0, 7)
  const blog = await prisma.blogPost.create({
    data: {
      brandId: brand.id,
      title: parsed.data.title,
      url: parsed.data.url || null,
      wordCount: parsed.data.wordCount ?? null,
      authorId: actor.me.id,
      publishedAt: dbDateFromString(publishedStr),
      month,
    },
    include: { brand: true, author: { select: { id: true, name: true } } },
  })
  res.status(201).json({ blog: serialize(blog) })
}

const updateSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  url: z.string().max(600).nullable().optional(),
  wordCount: z.number().int().min(0).max(1_000_000).nullable().optional(),
  brandId: z.string().optional(),
  publishedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

/** PATCH /api/marketing/blogs/:id */
export async function updateBlog(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  if (!actor.canWriteContent) {
    res.status(403).json({ error: 'Content team, Team Lead or Admin only' })
    return
  }
  const existing = await prisma.blogPost.findUnique({ where: { id: req.params.id }, include: { brand: true } })
  if (!existing || existing.brand.departmentId !== actor.deptId) {
    res.status(404).json({ error: 'Blog not found' })
    return
  }
  const parsed = updateSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const d = parsed.data
  if (d.brandId && !(await brandInDept(actor, d.brandId))) {
    res.status(404).json({ error: 'Brand not found' })
    return
  }
  const blog = await prisma.blogPost.update({
    where: { id: existing.id },
    data: {
      ...(d.title != null ? { title: d.title } : {}),
      ...(d.url !== undefined ? { url: d.url || null } : {}),
      ...(d.wordCount !== undefined ? { wordCount: d.wordCount } : {}),
      ...(d.brandId ? { brandId: d.brandId } : {}),
      ...(d.publishedAt ? { publishedAt: dbDateFromString(d.publishedAt), month: d.publishedAt.slice(0, 7) } : {}),
    },
    include: { brand: true, author: { select: { id: true, name: true } } },
  })
  res.json({ blog: serialize(blog) })
}

/** DELETE /api/marketing/blogs/:id */
export async function deleteBlog(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  if (!actor.canWriteContent) {
    res.status(403).json({ error: 'Content team, Team Lead or Admin only' })
    return
  }
  const existing = await prisma.blogPost.findUnique({ where: { id: req.params.id }, include: { brand: true } })
  if (!existing || existing.brand.departmentId !== actor.deptId) {
    res.status(404).json({ error: 'Blog not found' })
    return
  }
  await prisma.blogPost.delete({ where: { id: existing.id } })
  res.status(204).end()
}

/** GET /api/marketing/blogs/counts?month= — per-brand month-end counts + MoM delta. */
export async function blogCounts(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  if (!actor.deptId) {
    res.json({ month: currentMonth(), counts: [] })
    return
  }
  const month = String(req.query.month || currentMonth())
  if (!MONTH_RE.test(month)) {
    res.status(400).json({ error: 'month must be YYYY-MM' })
    return
  }
  const prev = prevMonth(month)
  const brands = await prisma.brand.findMany({ where: { departmentId: actor.deptId, isActive: true }, orderBy: { name: 'asc' } })
  const grouped = await prisma.blogPost.groupBy({
    by: ['brandId', 'month'],
    where: { brandId: { in: brands.map((b) => b.id) }, month: { in: [month, prev] } },
    _count: { _all: true },
  })
  const countOf = (brandId: string, m: string) => grouped.find((g) => g.brandId === brandId && g.month === m)?._count._all ?? 0
  res.json({
    month,
    total: brands.reduce((a, b) => a + countOf(b.id, month), 0),
    counts: brands.map((b) => ({
      brandId: b.id,
      name: b.name,
      count: countOf(b.id, month),
      delta: pctDelta(countOf(b.id, month), countOf(b.id, prev)),
    })),
  })
}
