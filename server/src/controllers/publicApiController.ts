import type { NextFunction, Request, Response } from 'express'
import { createHash, randomBytes } from 'crypto'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { runAsCompany, runAsSystem } from '../lib/tenancy'
import { billingState, readOnlyReason } from '../lib/billing/billing'
import { dateStringFromDb, dbDateFromString } from '../lib/time'
import { receiveLead, cleanInput } from '../lib/leads/intake'

/**
 * The public API (/api/v1): another program reads a company's Metriq, or adds a lead to it, with a key the company
 * made in Company settings → API. Every answer is the key's own company and nothing else: the request runs inside
 * that company exactly like a signed-in person's, so the same walls apply.
 *
 *   Authorization: Bearer mtq_...        (or the header X-API-Key)
 *   GET  /api/v1/company
 *   GET  /api/v1/people
 *   GET  /api/v1/departments
 *   GET  /api/v1/attendance?from=YYYY-MM-DD&to=YYYY-MM-DD[&personId=]
 *   GET  /api/v1/tasks[?status=open|done|all][&updatedSince=ISO]
 *   GET  /api/v1/leads[?status=][&updatedSince=ISO]
 *   POST /api/v1/leads                    (a key with write access)
 *   GET  /api/v1/deals[?status=]
 *
 * Lists take limit (1 to 200, default 50) and cursor (the nextCursor of the page before). Money, passwords, sign-in
 * secrets and private notes are never part of an answer.
 */

export const hashKey = (token: string): string => createHash('sha256').update(token).digest('hex')
/** A new key: the token is shown to the person once; only its hash and first characters are kept. */
export function newApiKey(): { token: string; prefix: string; tokenHash: string } {
  const token = `mtq_${randomBytes(27).toString('base64url')}`
  return { token, prefix: token.slice(0, 10), tokenHash: hashKey(token) }
}

type KeyedRequest = Request & { apiKey?: { id: string; companyId: string; access: string } }
const usedAt = new Map<string, number>()

/** Let the request in when its key is good for this (reading, or writing), and run the rest inside the key's company. */
export function requireApiKey(need: 'read' | 'write') {
  return async (req: KeyedRequest, res: Response, next: NextFunction): Promise<void> => {
    const header = String(req.headers.authorization ?? '')
    const token = (header.toLowerCase().startsWith('bearer ') ? header.slice(7) : String(req.headers['x-api-key'] ?? '')).trim()
    if (!token.startsWith('mtq_')) { res.status(401).json({ error: 'Send your API key: Authorization: Bearer mtq_...' }); return }
    const found = await runAsSystem(() => prisma.apiKey.findUnique({ where: { tokenHash: hashKey(token) }, include: { company: { include: { subscription: true } } } }))
    if (!found || found.revokedAt) { res.status(401).json({ error: 'This API key is not valid (it may have been removed).' }); return }
    if (found.company.status === 'SUSPENDED') { res.status(403).json({ error: 'This company is paused.' }); return }
    if (need === 'write') {
      if (found.access !== 'write') { res.status(403).json({ error: 'This key can only read. Make a key with write access in Company settings, API.' }); return }
      const why = readOnlyReason(billingState(found.company, found.company.subscription))
      if (why) { res.status(402).json({ error: why }); return }
    }
    // "Last used", at most once a minute per key.
    if (Date.now() - (usedAt.get(found.id) ?? 0) > 60_000) {
      usedAt.set(found.id, Date.now())
      void runAsSystem(() => prisma.apiKey.update({ where: { id: found.id }, data: { lastUsedAt: new Date() } })).catch(() => undefined)
    }
    req.apiKey = { id: found.id, companyId: found.companyId, access: found.access }
    void runAsCompany(found.companyId, next, found.company.timeZone)
  }
}

// ------------------------------------------------------------------ helpers

const page = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.string().max(60).optional() })
const since = (v: unknown): Date | undefined => { const d = typeof v === 'string' && v ? new Date(v) : null; return d && !isNaN(d.getTime()) ? d : undefined }
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null)

/** One page of a list ordered by id: the rows, and the cursor of the next page when there is one. */
async function paged<T extends { id: string }>(req: Request, res: Response, find: (take: number, cursor?: string) => Promise<T[]>, shape: (row: T) => unknown): Promise<void> {
  const p = page.safeParse(req.query)
  if (!p.success) { res.status(400).json({ error: 'limit is 1 to 200; cursor is the nextCursor of the page before.' }); return }
  const rows = await find(p.data.limit + 1, p.data.cursor)
  const more = rows.length > p.data.limit
  const out = more ? rows.slice(0, p.data.limit) : rows
  res.json({ data: out.map(shape), nextCursor: more ? out[out.length - 1].id : null })
}
const cursorArgs = (take: number, cursor?: string) => ({ take, orderBy: { id: 'asc' as const }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) })

// ------------------------------------------------------------------ reading

export async function company(req: KeyedRequest, res: Response): Promise<void> {
  const c = await prisma.company.findUniqueOrThrow({ where: { id: req.apiKey!.companyId }, select: { id: true, name: true, timeZone: true, plan: true, createdAt: true } })
  res.json({ data: { ...c, createdAt: iso(c.createdAt) } })
}

export async function people(req: Request, res: Response): Promise<void> {
  await paged(req, res,
    (take, cursor) => prisma.user.findMany({ ...cursorArgs(take, cursor), include: { department: { select: { id: true, name: true } } } }),
    (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, active: u.isActive && u.status === 'ACTIVE', department: u.department ? { id: u.department.id, name: u.department.name } : null, createdAt: iso(u.createdAt) }))
}

export async function departments(_req: Request, res: Response): Promise<void> {
  const rows = await prisma.department.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, name: true, type: true, _count: { select: { users: true } } } })
  res.json({ data: rows.map((d) => ({ id: d.id, name: d.name, kind: d.type, people: d._count.users })) })
}

export async function attendance(req: Request, res: Response): Promise<void> {
  const q = z.object({ from: ymd, to: ymd, personId: z.string().max(40).optional() }).safeParse(req.query)
  if (!q.success) { res.status(400).json({ error: 'Send from and to as YYYY-MM-DD (and optionally personId).' }); return }
  const from = dbDateFromString(q.data.from), to = dbDateFromString(q.data.to)
  if (to < from || to.getTime() - from.getTime() > 92 * 86400_000) { res.status(400).json({ error: 'Ask for at most 3 months at a time, with to on or after from.' }); return }
  await paged(req, res,
    (take, cursor) => prisma.attendanceDay.findMany({ ...cursorArgs(take, cursor), where: { date: { gte: from, lte: to }, ...(q.data.personId ? { userId: q.data.personId } : {}) }, include: { breaks: { select: { startAt: true, endAt: true } } } }),
    (d) => ({
      id: d.id, personId: d.userId, date: dateStringFromDb(d.date), checkInAt: iso(d.checkInAt), checkOutAt: iso(d.checkOutAt),
      breakMinutes: Math.round(d.breaks.reduce((t, b) => t + (b.endAt ? b.endAt.getTime() - b.startAt.getTime() : 0), 0) / 60000),
    }))
}

export async function tasks(req: Request, res: Response): Promise<void> {
  const status = req.query.status === 'done' ? 'done' : req.query.status === 'all' ? 'all' : 'open'
  const updated = since(req.query.updatedSince)
  await paged(req, res,
    (take, cursor) => prisma.pmTask.findMany({
      ...cursorArgs(take, cursor),
      where: { deletedAt: null, ...(status === 'open' ? { column: { category: { not: 'DONE' } } } : status === 'done' ? { column: { category: 'DONE' } } : {}), ...(updated ? { updatedAt: { gte: updated } } : {}) },
      include: { project: { select: { key: true, name: true } }, column: { select: { name: true, category: true } }, assignees: { select: { userId: true } } },
    }),
    (t) => ({
      id: t.id, code: t.code, title: t.title, project: { key: t.project.key, name: t.project.name }, status: t.column.name, done: t.column.category === 'DONE',
      priority: t.priority, assigneeIds: t.assignees.map((a) => a.userId), dueAt: iso(t.dueAt), completedAt: iso(t.completedAt), createdAt: iso(t.createdAt), updatedAt: iso(t.updatedAt),
    }))
}

const leadShape = (l: { id: string; name: string; email: string | null; phone: string | null; organization: string | null; status: string; source: string; value: number | null; businessId: string; assigneeId?: string | null; createdAt: Date; updatedAt: Date }) => ({
  id: l.id, name: l.name, email: l.email, phone: l.phone, organization: l.organization, status: l.status, source: l.source, value: l.value, businessId: l.businessId, assigneeId: l.assigneeId ?? null, createdAt: iso(l.createdAt), updatedAt: iso(l.updatedAt),
})

export async function leads(req: Request, res: Response): Promise<void> {
  const status = typeof req.query.status === 'string' && req.query.status ? req.query.status.toUpperCase().slice(0, 40) : undefined
  const updated = since(req.query.updatedSince)
  await paged(req, res,
    (take, cursor) => prisma.lead.findMany({ ...cursorArgs(take, cursor), where: { ...(status ? { status } : {}), ...(updated ? { updatedAt: { gte: updated } } : {}) } }),
    leadShape)
}

export async function deals(req: Request, res: Response): Promise<void> {
  const status = ['ACTIVE', 'SUBMITTED', 'WON', 'LOST', 'CONTRACT'].includes(String(req.query.status ?? '').toUpperCase()) ? (String(req.query.status).toUpperCase() as 'ACTIVE') : undefined
  await paged(req, res,
    (take, cursor) => prisma.bid.findMany({ ...cursorArgs(take, cursor), where: status ? { status } : {} }),
    (b) => ({ id: b.id, number: b.number, title: b.title, company: b.company, type: b.type, status: b.status, agentId: b.agentId, dueDate: iso(b.dueDate), closedDate: iso(b.closedDate), createdAt: iso(b.createdAt) }))
}

// ------------------------------------------------------------------ writing

const newLead = z.object({
  name: z.string().trim().max(160).optional(),
  email: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(60).optional(),
  organization: z.string().trim().max(200).optional(),
  message: z.string().trim().max(4000).optional(),
  /** Which of the company's lead businesses it belongs to (GET /api/v1/leads shows businessId); the first one when left out. */
  businessId: z.string().max(40).optional(),
  /** Your own id for it: sending the same one again does not make a second lead. */
  externalId: z.string().trim().max(120).optional(),
})

/** POST /api/v1/leads — a lead from another system (a form tool, an ad platform, a chatbot). */
export async function createLead(req: Request, res: Response): Promise<void> {
  const p = newLead.safeParse(req.body)
  if (!p.success) { res.status(400).json({ error: p.error.issues[0]?.message ?? 'Invalid lead' }); return }
  const v = p.data
  if (!v.name && !v.email && !v.phone) { res.status(400).json({ error: 'Send at least a name, an email or a phone.' }); return }
  const business = v.businessId
    ? await prisma.leadBusiness.findFirst({ where: { id: v.businessId, isActive: true } })
    : await prisma.leadBusiness.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' } })
  if (!business) { res.status(409).json({ error: 'This company has no lead business yet. Make one in the CRM settings first.' }); return }
  const input = cleanInput({ name: v.name ?? '', email: v.email ?? null, phone: v.phone ?? null, organization: v.organization ?? null, message: v.message ?? null, externalId: v.externalId ?? null } as Parameters<typeof cleanInput>[0])
  const r = await receiveLead(business, input, { source: 'FORM', mergeRepeats: true })
  res.status(r.repeat || r.duplicate ? 200 : 201).json({ data: leadShape(r.lead), repeat: r.repeat || r.duplicate })
}
