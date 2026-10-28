import type { Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { companyIdOfUser } from '../lib/company'
import { isOn } from '../lib/flags'

/**
 * The Help button (erp, step 0): anyone in a company tells Metriq support about a problem. It
 * lands in the owner console with the page they were on, their browser and any errors they hit.
 * Each company's Help button is switched on or off by the owner (off for 99 Technologies).
 */

async function myCompany(userId: string) {
  const id = await companyIdOfUser(userId)
  return prisma.company.findUnique({ where: { id }, select: { id: true, helpEnabled: true, status: true } })
}

/** GET /api/support/status → { enabled } (the app shows the Help button only when true). */
export async function supportStatus(req: AuthedRequest, res: Response): Promise<void> {
  const c = await myCompany(req.user!.id)
  res.json({ enabled: !!c?.helpEnabled && (await isOn('help-button')) })
}

const createSchema = z.object({
  subject: z.string().trim().min(3, 'Add a short title').max(160),
  body: z.string().trim().min(5, 'Tell us what happened').max(5000),
  pageUrl: z.string().max(500).optional(),
  userAgent: z.string().max(400).optional(),
})

/** POST /api/support — send a complaint or question. */
export async function createTicket(req: AuthedRequest, res: Response): Promise<void> {
  const c = await myCompany(req.user!.id)
  if (!c?.helpEnabled || !(await isOn('help-button'))) { res.status(403).json({ error: 'Help is not switched on for your company.' }); return }
  const p = createSchema.safeParse(req.body)
  if (!p.success) { res.status(400).json({ error: p.error.issues[0]?.message ?? 'Invalid input' }); return }
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { id: true, name: true, email: true } })
  // Errors this person hit in the last 24 hours, so support sees them without asking.
  const since = new Date(Date.now() - 24 * 60 * 60_000)
  const hits = await prisma.errorEvent.findMany({ where: { userId: me.id, at: { gte: since } }, select: { groupId: true }, orderBy: { at: 'desc' }, take: 50 })
  const errorIds = [...new Set(hits.map((h) => h.groupId))].slice(0, 10)
  const t = await prisma.supportTicket.create({
    data: {
      companyId: c.id, userId: me.id, userName: me.name, userEmail: me.email,
      subject: p.data.subject, body: p.data.body,
      pageUrl: p.data.pageUrl ?? null, userAgent: p.data.userAgent ?? String(req.headers['user-agent'] ?? '').slice(0, 400),
      errorIds,
    },
  })
  res.status(201).json({ ticket: { id: t.id, number: t.number, subject: t.subject, status: t.status, createdAt: t.createdAt.toISOString() } })
}

/** GET /api/support/mine — my requests and their status. */
export async function myTickets(req: AuthedRequest, res: Response): Promise<void> {
  const rows = await prisma.supportTicket.findMany({
    where: { userId: req.user!.id }, orderBy: { updatedAt: 'desc' }, take: 50,
    include: { messages: { orderBy: { createdAt: 'asc' }, select: { id: true, fromOwner: true, authorName: true, body: true, createdAt: true } } },
  })
  res.json({
    tickets: rows.map((t) => ({
      id: t.id, number: t.number, subject: t.subject, body: t.body, status: t.status, createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString(),
      messages: t.messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
    })),
  })
}

/** POST /api/support/mine/:id/reply { body } — answer support on my own request. */
export async function replyMine(req: AuthedRequest, res: Response): Promise<void> {
  const t = await prisma.supportTicket.findUnique({ where: { id: req.params.id } })
  if (!t || t.userId !== req.user!.id) { res.status(404).json({ error: 'Not found' }); return }
  const body = String(req.body?.body ?? '').trim()
  if (!body || body.length > 5000) { res.status(400).json({ error: 'Write a message.' }); return }
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { name: true } })
  await prisma.$transaction([
    prisma.supportMessage.create({ data: { ticketId: t.id, fromOwner: false, authorName: me.name, body } }),
    // A reply from the company puts it back in support's queue.
    prisma.supportTicket.update({ where: { id: t.id }, data: { status: t.status === 'RESOLVED' || t.status === 'WAITING_ON_COMPANY' ? 'OPEN' : t.status, resolvedAt: null } }),
  ])
  res.status(201).json({ ok: true })
}
