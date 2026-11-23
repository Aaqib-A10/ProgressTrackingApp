import { Router, type Response } from 'express'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { requireAuth, type AuthedRequest } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'
import { prisma } from '../lib/prisma'
import * as S from '../controllers/salesDocsController'
import { RANGES, ReportError, SOURCES, runReport, type ReportSpec } from '../lib/reportBuilder'

/** Quotes and invoices (controllers/salesDocsController). */
export const salesDocsRouter = Router()
salesDocsRouter.use(requireAuth)
salesDocsRouter.get('/', asyncHandler(S.listDocs))
salesDocsRouter.post('/', asyncHandler(S.createDoc))
salesDocsRouter.get('/:id', asyncHandler(S.getDoc))
salesDocsRouter.put('/:id', asyncHandler(S.updateDoc))
salesDocsRouter.delete('/:id', asyncHandler(S.deleteDoc))
salesDocsRouter.post('/:id/status', asyncHandler(S.setStatus))
salesDocsRouter.post('/:id/convert', asyncHandler(S.convertDoc))
salesDocsRouter.post('/:id/send', asyncHandler(S.sendDoc))

/** The report builder (lib/reportBuilder): run a report, and keep the ones worth keeping. */
export const reportBuilderRouter = Router()
reportBuilderRouter.use(requireAuth)

const specSchema = z.object({ source: z.string().max(40), measure: z.string().max(40), groupBy: z.string().max(40), range: z.enum(RANGES), chart: z.enum(['bar', 'line', 'pie', 'table']).optional() })
const viewer = (req: AuthedRequest) => prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { id: true, role: true, departmentId: true } })
const builder = (role: string) => role === 'SUPER_ADMIN' || role === 'TEAM_LEAD'

async function run(req: AuthedRequest, res: Response, spec: ReportSpec): Promise<void> {
  try {
    res.json({ spec, result: await runReport(spec, await viewer(req)) })
  } catch (e) {
    if (e instanceof ReportError) { res.status(e.status).json({ error: e.message }); return }
    throw e
  }
}

/** GET /api/report-builder/sources: what a report can be about. */
reportBuilderRouter.get('/sources', asyncHandler(async (req: AuthedRequest, res) => {
  if (!builder(req.user!.role)) { res.status(403).json({ error: 'Reports are built by team leads and admins.' }); return }
  res.json({ sources: SOURCES, ranges: RANGES })
}))

/** POST /api/report-builder/run { source, measure, groupBy, range } */
reportBuilderRouter.post('/run', asyncHandler(async (req: AuthedRequest, res) => {
  const p = specSchema.safeParse(req.body)
  if (!p.success) { res.status(400).json({ error: 'Pick what to count, how to split it and the dates.' }); return }
  await run(req, res, p.data)
}))

/** GET /api/report-builder/saved: my reports and the shared ones. */
reportBuilderRouter.get('/saved', asyncHandler(async (req: AuthedRequest, res) => {
  if (!builder(req.user!.role)) { res.status(403).json({ error: 'Reports are built by team leads and admins.' }); return }
  const rows = await prisma.savedReport.findMany({ where: { OR: [{ ownerId: req.user!.id }, { shared: true }] }, include: { owner: { select: { name: true } } }, orderBy: { updatedAt: 'desc' } })
  res.json({ reports: rows.map((r) => ({ id: r.id, name: r.name, shared: r.shared, mine: r.ownerId === req.user!.id, owner: r.owner.name, spec: r.spec, updatedAt: r.updatedAt.toISOString() })) })
}))

/** POST /api/report-builder/saved { name, shared, spec } */
reportBuilderRouter.post('/saved', asyncHandler(async (req: AuthedRequest, res) => {
  if (!builder(req.user!.role)) { res.status(403).json({ error: 'Reports are built by team leads and admins.' }); return }
  const p = z.object({ name: z.string().trim().min(1, 'Give the report a name.').max(80), shared: z.boolean().optional(), spec: specSchema }).safeParse(req.body)
  if (!p.success) { res.status(400).json({ error: p.error.issues[0]?.message ?? 'Check the report.' }); return }
  const row = await prisma.savedReport.create({ data: { name: p.data.name, shared: !!p.data.shared, ownerId: req.user!.id, spec: p.data.spec as unknown as Prisma.InputJsonValue } })
  res.status(201).json({ id: row.id })
}))

/** GET /api/report-builder/saved/:id/run: run a kept report with today's numbers. */
reportBuilderRouter.get('/saved/:id/run', asyncHandler(async (req: AuthedRequest, res) => {
  const row = await prisma.savedReport.findFirst({ where: { id: req.params.id, OR: [{ ownerId: req.user!.id }, { shared: true }] } })
  const p = specSchema.safeParse(row?.spec)
  if (!row || !p.success) { res.status(404).json({ error: 'Report not found' }); return }
  await run(req, res, p.data)
}))

/** DELETE /api/report-builder/saved/:id: its owner, or an admin. */
reportBuilderRouter.delete('/saved/:id', asyncHandler(async (req: AuthedRequest, res) => {
  const r = await prisma.savedReport.deleteMany({ where: { id: req.params.id, ...(req.user!.role === 'SUPER_ADMIN' ? {} : { ownerId: req.user!.id }) } })
  if (!r.count) { res.status(404).json({ error: 'Report not found' }); return }
  res.status(204).end()
}))
