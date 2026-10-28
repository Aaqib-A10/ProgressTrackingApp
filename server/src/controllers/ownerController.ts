import type { Request, Response } from 'express'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { DUMMY_PASSWORD_HASH, signOwnerToken, verifyOwnerToken, verifyPassword } from '../lib/auth'
import { checkTotp } from '../lib/totp'
import { getClientIp } from '../lib/ip'
import { companyUserWhere, HOME_COMPANY_ID } from '../lib/company'
import { companyToday, dbDateFromString } from '../lib/time'
import { OWNER_COOKIE, type OwnerRequest } from '../middleware/owner'
import { FLAGS, FLAG_KEYS, allFlags, companyFlags, isOn, setCompanyFlag, setFlag, type FlagKey } from '../lib/flags'

/**
 * The owner console (erp, step 0): where Metriq is run as a business. One owner account (Anees),
 * created with a command, never in code. Sign in = password, plus a 6 digit code from an
 * authenticator app once that is switched on (code-on); 5 wrong tries lock it for 15 minutes.
 * Every action is logged.
 */

export const MAX_TRIES = 5
export const LOCK_MS = 15 * 60_000
const SESSION_MS = 12 * 60 * 60_000

async function audit(req: Request, ownerId: string | null, action: string, extra: { companyId?: string; target?: string; detail?: Prisma.InputJsonValue } = {}) {
  await prisma.ownerAuditLog.create({ data: { ownerId, action, ip: getClientIp(req), ...extra } }).catch(() => undefined)
}

function setOwnerCookie(res: Response, token: string) {
  res.cookie(OWNER_COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: SESSION_MS, path: '/api/owner' })
}

/** A wrong password or code: count it, and lock after MAX_TRIES. */
async function failed(req: Request, owner: { id: string; failedLogins: number }, what: string) {
  const tries = owner.failedLogins + 1
  if (tries >= MAX_TRIES) {
    await prisma.platformOwner.update({ where: { id: owner.id }, data: { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MS) } })
    await audit(req, owner.id, 'LOCKED', { detail: { after: what } })
  } else {
    await prisma.platformOwner.update({ where: { id: owner.id }, data: { failedLogins: tries } })
    await audit(req, owner.id, 'LOGIN_FAILED', { detail: { what } })
  }
}

const lockedMessage = (until: Date) => `Too many wrong tries. The owner sign in is locked until ${until.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Karachi' })} (Pakistan time).`

/** "email" may be the email or the username. */
const loginSchema = z.object({ email: z.string().trim().toLowerCase().min(1).max(200), password: z.string().min(1).max(200) })

/** Test owners made on a PC (src/scripts/devOwner.ts) never sign in on the live server. */
export const isLocalTestOwner = (o: { email: string }) => o.email.endsWith('@local.test')

/** POST /api/owner/login { email, password } → { needCode, ticket } (step 1 of 2). */
export async function ownerLogin(req: Request, res: Response): Promise<void> {
  const p = loginSchema.safeParse(req.body)
  if (!p.success) { res.status(400).json({ error: 'Enter your email or username and password.' }); return }
  const found = await prisma.platformOwner.findFirst({ where: { OR: [{ email: p.data.email }, { username: p.data.email }] } })
  const owner = found && process.env.NODE_ENV === 'production' && isLocalTestOwner(found) ? null : found
  if (owner?.lockedUntil && owner.lockedUntil > new Date()) { res.status(423).json({ error: lockedMessage(owner.lockedUntil) }); return }
  const ok = await verifyPassword(p.data.password, owner?.passwordHash ?? DUMMY_PASSWORD_HASH)
  if (!owner || !ok) {
    if (owner) await failed(req, owner, 'password')
    else await audit(req, null, 'LOGIN_FAILED', { detail: { what: 'unknown email' } })
    res.status(401).json({ error: 'Wrong email, username or password.' })
    return
  }
  // Phone code switched on: a short ticket now, the session after the code.
  if (owner.totpSecret) { res.json({ needCode: true, ticket: signOwnerToken(owner.id, 'owner-2fa', 300) }); return }
  await startSession(req, res, owner)
}

async function startSession(req: Request, res: Response, owner: { id: string; name: string; email: string }) {
  await prisma.platformOwner.update({ where: { id: owner.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } })
  await audit(req, owner.id, 'LOGIN', { detail: { userAgent: String(req.headers['user-agent'] ?? '').slice(0, 200) } })
  setOwnerCookie(res, signOwnerToken(owner.id, 'owner', SESSION_MS / 1000))
  res.json({ needCode: false, owner: { name: owner.name, email: owner.email } })
}

/** POST /api/owner/login/code { ticket, code } → sets the owner session (step 2 of 2). */
export async function ownerLoginCode(req: Request, res: Response): Promise<void> {
  const ticket = String(req.body?.ticket ?? '')
  const code = String(req.body?.code ?? '')
  let sub: string
  try { sub = verifyOwnerToken(ticket, 'owner-2fa').sub } catch { res.status(401).json({ error: 'That took too long. Sign in again.' }); return }
  const owner = await prisma.platformOwner.findUnique({ where: { id: sub } })
  if (!owner) { res.status(401).json({ error: 'Sign in again.' }); return }
  if (owner.lockedUntil && owner.lockedUntil > new Date()) { res.status(423).json({ error: lockedMessage(owner.lockedUntil) }); return }
  if (!owner.totpSecret || !checkTotp(owner.totpSecret, code)) {
    await failed(req, owner, 'code')
    res.status(401).json({ error: 'That code is not right. Use the newest code in your authenticator app.' })
    return
  }
  await startSession(req, res, owner)
}

export async function ownerLogout(req: OwnerRequest, res: Response): Promise<void> {
  if (req.owner) await audit(req, req.owner.id, 'LOGOUT')
  res.clearCookie(OWNER_COOKIE, { path: '/api/owner' })
  res.status(204).end()
}

export async function ownerMe(req: OwnerRequest, res: Response): Promise<void> {
  res.json({ owner: req.owner })
}

// ------------------------------------------------------------------ home

async function companyStats(companyId: string) {
  const people = companyUserWhere(companyId)
  const today = dbDateFromString(companyToday())
  const [total, active, inToday, lastLogin, openTickets] = await Promise.all([
    prisma.user.count({ where: people }),
    prisma.user.count({ where: { ...people, isActive: true, status: 'ACTIVE' } }),
    prisma.attendanceDay.count({ where: { date: today, checkInAt: { not: null }, user: people } }),
    prisma.loginEvent.findFirst({ where: { user: people }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    prisma.supportTicket.count({ where: { companyId, status: { not: 'RESOLVED' } } }),
  ])
  return { people: active, peopleTotal: total, inToday, lastActiveAt: lastLogin?.createdAt.toISOString() ?? null, openTickets }
}

/** GET /api/owner/home */
export async function ownerHome(_req: OwnerRequest, res: Response): Promise<void> {
  const day = new Date(Date.now() - 24 * 60 * 60_000)
  const [companies, openTickets, urgent, errors, recent, locks] = await Promise.all([
    prisma.company.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.supportTicket.count({ where: { status: { not: 'RESOLVED' } } }),
    prisma.supportTicket.count({ where: { status: { not: 'RESOLVED' }, priority: { in: ['HIGH', 'URGENT'] } } }),
    prisma.errorGroup.count({ where: { state: 'OPEN', lastSeenAt: { gte: day } } }),
    prisma.supportTicket.findMany({ where: { status: { not: 'RESOLVED' } }, orderBy: { updatedAt: 'desc' }, take: 5, include: { company: { select: { name: true } } } }),
    prisma.ownerAuditLog.findMany({ where: { action: { in: ['LOCKED', 'LOGIN_FAILED'] }, createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60_000) } }, orderBy: { createdAt: 'desc' }, take: 5 }),
  ])
  let people = 0, inToday = 0
  for (const c of companies) { const s = await companyStats(c.id); people += s.people; inToday += s.inToday }
  res.json({
    counts: { companies: companies.length, trials: companies.filter((c) => c.status === 'TRIAL').length, people, inToday, openTickets, urgentTickets: urgent, errors24h: errors },
    tickets: recent.map((t) => ({ id: t.id, number: t.number, subject: t.subject, company: t.company.name, status: t.status, priority: t.priority, updatedAt: t.updatedAt.toISOString() })),
    signInAlerts: locks.map((l) => ({ at: l.createdAt.toISOString(), action: l.action, ip: l.ip })),
  })
}

// ------------------------------------------------------------------ companies

const companyView = async (c: { id: string; name: string; slug: string; kind: string; timeZone: string; status: string; plan: string; helpEnabled: boolean; createdAt: Date }) => ({
  id: c.id, name: c.name, slug: c.slug, kind: c.kind, timeZone: c.timeZone, status: c.status, plan: c.plan, helpEnabled: c.helpEnabled,
  createdAt: c.createdAt.toISOString(), home: c.id === HOME_COMPANY_ID, ...(await companyStats(c.id)),
})

/** GET /api/owner/companies */
export async function listCompanies(_req: OwnerRequest, res: Response): Promise<void> {
  const rows = await prisma.company.findMany({ orderBy: { createdAt: 'asc' } })
  res.json({ companies: await Promise.all(rows.map(companyView)) })
}

/** GET /api/owner/companies/:id */
export async function getCompany(req: OwnerRequest, res: Response): Promise<void> {
  const c = await prisma.company.findUnique({ where: { id: req.params.id } })
  if (!c) { res.status(404).json({ error: 'Company not found' }); return }
  const [tickets, activity] = await Promise.all([
    prisma.supportTicket.findMany({ where: { companyId: c.id }, orderBy: { updatedAt: 'desc' }, take: 10 }),
    prisma.ownerAuditLog.findMany({ where: { companyId: c.id }, orderBy: { createdAt: 'desc' }, take: 10, include: { owner: { select: { name: true } } } }),
  ])
  res.json({
    company: await companyView(c),
    tickets: tickets.map((t) => ({ id: t.id, number: t.number, subject: t.subject, status: t.status, priority: t.priority, userName: t.userName, updatedAt: t.updatedAt.toISOString() })),
    activity: activity.map((a) => ({ at: a.createdAt.toISOString(), action: a.action, by: a.owner?.name ?? 'system', detail: a.detail })),
  })
}

const companyPatch = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  status: z.enum(['TRIAL', 'ACTIVE', 'SUSPENDED']).optional(),
  helpEnabled: z.boolean().optional(),
})

/** PATCH /api/owner/companies/:id — rename, suspend or reactivate, turn the Help button on or off. */
export async function updateCompany(req: OwnerRequest, res: Response): Promise<void> {
  const c = await prisma.company.findUnique({ where: { id: req.params.id } })
  if (!c) { res.status(404).json({ error: 'Company not found' }); return }
  const p = companyPatch.safeParse(req.body)
  if (!p.success) { res.status(400).json({ error: p.error.issues[0]?.message ?? 'Invalid input' }); return }
  if (c.id === HOME_COMPANY_ID && p.data.status && p.data.status !== 'ACTIVE') {
    res.status(400).json({ error: '99 Technologies is company 1 and always stays active.' })
    return
  }
  const before: Record<string, unknown> = {}, after: Record<string, unknown> = {}
  for (const k of ['name', 'status', 'helpEnabled'] as const) {
    if (p.data[k] !== undefined && p.data[k] !== c[k]) { before[k] = c[k]; after[k] = p.data[k] }
  }
  if (!Object.keys(after).length) { res.json({ company: await companyView(c) }); return }
  const next = await prisma.company.update({ where: { id: c.id }, data: after })
  await audit(req, req.owner!.id, 'COMPANY_UPDATE', { companyId: c.id, target: c.name, detail: { before, after } as Prisma.InputJsonValue })
  res.json({ company: await companyView(next) })
}

// ------------------------------------------------------------------ support

const ticketRow = (t: { id: string; number: number; subject: string; status: string; priority: string; userName: string; userEmail: string; createdAt: Date; updatedAt: Date; company: { id: string; name: string }; _count?: { messages: number } }) => ({
  id: t.id, number: t.number, subject: t.subject, status: t.status, priority: t.priority, userName: t.userName, userEmail: t.userEmail,
  company: t.company, replies: t._count?.messages ?? 0, createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString(),
})

/** GET /api/owner/support?status=open|all|RESOLVED…&companyId= */
export async function listTickets(req: OwnerRequest, res: Response): Promise<void> {
  const status = String(req.query.status ?? 'open')
  const where: Prisma.SupportTicketWhereInput = {}
  if (status === 'open') where.status = { not: 'RESOLVED' }
  else if (['OPEN', 'IN_PROGRESS', 'WAITING_ON_COMPANY', 'RESOLVED'].includes(status)) where.status = status as Prisma.SupportTicketWhereInput['status']
  if (req.query.companyId) where.companyId = String(req.query.companyId)
  const rows = await prisma.supportTicket.findMany({
    where, take: 200,
    orderBy: [{ updatedAt: 'desc' }],
    include: { company: { select: { id: true, name: true } }, _count: { select: { messages: true } } },
  })
  const rank: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 }
  rows.sort((a, b) => (a.status === 'RESOLVED' ? 1 : 0) - (b.status === 'RESOLVED' ? 1 : 0) || rank[a.priority] - rank[b.priority])
  res.json({ tickets: rows.map(ticketRow) })
}

/** GET /api/owner/support/:id — the complaint, the conversation and the errors attached. */
export async function getTicket(req: OwnerRequest, res: Response): Promise<void> {
  const t = await prisma.supportTicket.findUnique({
    where: { id: req.params.id },
    include: { company: { select: { id: true, name: true } }, messages: { orderBy: { createdAt: 'asc' } } },
  })
  if (!t) { res.status(404).json({ error: 'Not found' }); return }
  const errors = t.errorIds.length
    ? await prisma.errorGroup.findMany({ where: { id: { in: t.errorIds } }, select: { id: true, message: true, route: true, source: true, count: true, lastSeenAt: true, state: true } })
    : []
  res.json({
    ticket: {
      ...ticketRow({ ...t, _count: { messages: t.messages.length } }),
      body: t.body, pageUrl: t.pageUrl, userAgent: t.userAgent, resolvedAt: t.resolvedAt?.toISOString() ?? null,
      messages: t.messages.map((m) => ({ id: m.id, fromOwner: m.fromOwner, authorName: m.authorName, body: m.body, createdAt: m.createdAt.toISOString() })),
      errors: errors.map((e) => ({ ...e, lastSeenAt: e.lastSeenAt.toISOString() })),
    },
  })
}

const replySchema = z.object({ body: z.string().trim().min(1).max(5000), status: z.enum(['OPEN', 'IN_PROGRESS', 'WAITING_ON_COMPANY', 'RESOLVED']).optional() })

/** POST /api/owner/support/:id/reply { body, status? } — the person sees it in their bell. */
export async function replyTicket(req: OwnerRequest, res: Response): Promise<void> {
  const t = await prisma.supportTicket.findUnique({ where: { id: req.params.id } })
  if (!t) { res.status(404).json({ error: 'Not found' }); return }
  const p = replySchema.safeParse(req.body)
  if (!p.success) { res.status(400).json({ error: 'Write a reply.' }); return }
  const status = p.data.status ?? (t.status === 'OPEN' ? 'IN_PROGRESS' : t.status)
  await prisma.$transaction([
    prisma.supportMessage.create({ data: { ticketId: t.id, fromOwner: true, authorName: 'Metriq support', body: p.data.body } }),
    prisma.supportTicket.update({ where: { id: t.id }, data: { status, resolvedAt: status === 'RESOLVED' ? new Date() : null } }),
  ])
  if (t.userId) {
    await prisma.notification.create({
      data: { userId: t.userId, type: 'SUPPORT_REPLY', title: `Metriq support replied: ${t.subject}`.slice(0, 200), body: p.data.body.slice(0, 300), link: `/app/help?ticket=${t.id}`, entityType: 'SupportTicket', entityId: t.id },
    }).catch(() => undefined)
  }
  await audit(req, req.owner!.id, 'TICKET_REPLY', { companyId: t.companyId, target: `#${t.number}`, detail: { status } })
  req.params.id = t.id
  await getTicket(req, res)
}

const ticketPatch = z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'WAITING_ON_COMPANY', 'RESOLVED']).optional(), priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional() })

/** PATCH /api/owner/support/:id { status?, priority? } */
export async function updateTicket(req: OwnerRequest, res: Response): Promise<void> {
  const t = await prisma.supportTicket.findUnique({ where: { id: req.params.id } })
  if (!t) { res.status(404).json({ error: 'Not found' }); return }
  const p = ticketPatch.safeParse(req.body)
  if (!p.success || (!p.data.status && !p.data.priority)) { res.status(400).json({ error: 'Nothing to change.' }); return }
  await prisma.supportTicket.update({
    where: { id: t.id },
    data: { ...p.data, ...(p.data.status ? { resolvedAt: p.data.status === 'RESOLVED' ? new Date() : null } : {}) },
  })
  await audit(req, req.owner!.id, 'TICKET_UPDATE', { companyId: t.companyId, target: `#${t.number}`, detail: { before: { status: t.status, priority: t.priority }, after: p.data } })
  await getTicket(req, res)
}

// ------------------------------------------------------------------ activity log

/** GET /api/owner/activity?q=&companyId= — every owner action, newest first. */
export async function ownerActivity(req: OwnerRequest, res: Response): Promise<void> {
  const q = String(req.query.q ?? '').trim()
  const where: Prisma.OwnerAuditLogWhereInput = {}
  if (req.query.companyId) where.companyId = String(req.query.companyId)
  if (q) where.OR = [{ action: { contains: q, mode: 'insensitive' } }, { target: { contains: q, mode: 'insensitive' } }, { ip: { contains: q } }]
  const rows = await prisma.ownerAuditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: 300, include: { owner: { select: { name: true } } } })
  const companies = new Map((await prisma.company.findMany({ select: { id: true, name: true } })).map((c) => [c.id, c.name]))
  res.json({
    activity: rows.map((a) => ({ id: a.id, at: a.createdAt.toISOString(), action: a.action, by: a.owner?.name ?? '—', company: a.companyId ? companies.get(a.companyId) ?? null : null, target: a.target, detail: a.detail, ip: a.ip })),
  })
}

// ------------------------------------------------------------------ switches

/** GET /api/owner/flags — every on/off switch and who last changed it. */
export async function listFlags(_req: OwnerRequest, res: Response): Promise<void> {
  res.json({ flags: await allFlags() })
}

/** PATCH /api/owner/flags/:key { enabled } — takes effect everywhere within seconds, no deploy. */
export async function updateFlag(req: OwnerRequest, res: Response): Promise<void> {
  const key = req.params.key as FlagKey
  if (!FLAG_KEYS.includes(key)) { res.status(404).json({ error: 'No such switch' }); return }
  if (typeof req.body?.enabled !== 'boolean') { res.status(400).json({ error: 'enabled (true or false) is required' }); return }
  if (key === 'company-walls' && req.body.enabled === false && (await prisma.company.count()) > 1) {
    res.status(409).json({ error: 'Other companies use Metriq, so the company walls cannot be turned off.' })
    return
  }
  const before = await isOn(key)
  await setFlag(key, req.body.enabled, req.owner!.name)
  await audit(req, req.owner!.id, 'SWITCH', { target: FLAGS[key].label, detail: { key, before, after: req.body.enabled } })
  res.json({ flags: await allFlags() })
}

/** GET /api/owner/companies/:id/flags — the switches as this company has them. */
export async function listCompanyFlags(req: OwnerRequest, res: Response): Promise<void> {
  const c = await prisma.company.findUnique({ where: { id: String(req.params.id) }, select: { id: true } })
  if (!c) { res.status(404).json({ error: 'Company not found' }); return }
  res.json({ flags: await companyFlags(c.id) })
}

/**
 * PATCH /api/owner/companies/:id/flags/:key { enabled: true | false | null } — set a switch
 * for this one company (show a part to some companies and not others). null = follow the
 * all-companies setting again.
 */
export async function updateCompanyFlag(req: OwnerRequest, res: Response): Promise<void> {
  const key = req.params.key as FlagKey
  if (!FLAG_KEYS.includes(key)) { res.status(404).json({ error: 'No such switch' }); return }
  if ((FLAGS[key] as { scope: string }).scope !== 'company') { res.status(400).json({ error: 'This switch is for the whole of Metriq and cannot be set per company' }); return }
  const enabled = req.body?.enabled
  if (enabled !== null && typeof enabled !== 'boolean') { res.status(400).json({ error: 'enabled must be true, false or null' }); return }
  const c = await prisma.company.findUnique({ where: { id: String(req.params.id) }, select: { id: true, name: true } })
  if (!c) { res.status(404).json({ error: 'Company not found' }); return }
  const before = await isOn(key, c.id)
  await setCompanyFlag(key, c.id, enabled, req.owner!.name)
  await audit(req, req.owner!.id, 'SWITCH', { companyId: c.id, target: `${FLAGS[key].label} for ${c.name}`, detail: { key, before, after: enabled === null ? 'all-companies setting' : enabled } })
  res.json({ flags: await companyFlags(c.id), all: await allFlags() })
}
