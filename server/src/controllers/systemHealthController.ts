import os from 'node:os'
import type { NextFunction, Request, Response } from 'express'
import { z } from 'zod'
import type { ErrorSource, ErrorState, Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { verifyToken } from '../lib/auth'
import type { AuthedRequest } from '../middleware/auth'
import { captureError, normalizePath } from '../lib/health/errors'
import { isForeignScriptError } from '../lib/health/foreignScript'
import { nextRunAt, startAudit } from '../lib/health/audit'
import { JOBS } from '../lib/health/jobs'
import { errorBrief } from '../lib/health/report'
import { lastUptimePing, recordOutage, recordPing, uptimeConfigured, uptimeTokenOk } from '../lib/health/uptime'
import { invokeAs, invokedError } from '../lib/pm/invoke'
import * as T from './pmTasksController'

/**
 * System Health (/app/admin/health): the error log, the hourly self check, background jobs,
 * the server and outages. Only Super Admins and developers (User.isDeveloper) get in.
 */

/** Super Admins and developers only. Use after requireAuth. */
export async function requireHealthAccess(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  if (req.user?.role === 'SUPER_ADMIN') { next(); return }
  const u = req.user ? await prisma.user.findUnique({ where: { id: req.user.id }, select: { isDeveloper: true } }) : null
  if (!u?.isDeveloper) { res.status(403).json({ error: 'Only developers and Super Admins can open System Health' }); return }
  next()
}

export async function canSeeHealth(user: { id: string; role: string }): Promise<boolean> {
  if (user.role === 'SUPER_ADMIN') return true
  const u = await prisma.user.findUnique({ where: { id: user.id }, select: { isDeveloper: true } })
  return !!u?.isDeveloper
}

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null
const DAY = 86400_000

/** GET /summary: everything the top of the page needs in one call. */
export async function healthSummary(req: AuthedRequest, res: Response): Promise<void> {
  const since = new Date(Date.now() - DAY)
  const [lastRun, running, open, new24h, seen24h, slow24h, bySource, beats, outages, devCount] = await Promise.all([
    prisma.auditRun.findFirst({ where: { state: { not: 'RUNNING' } }, orderBy: { startedAt: 'desc' } }),
    prisma.auditRun.findFirst({ where: { state: 'RUNNING', startedAt: { gt: new Date(Date.now() - 15 * 60_000) } }, orderBy: { startedAt: 'desc' } }),
    prisma.errorGroup.count({ where: { state: 'OPEN', source: { not: 'SLOW' } } }),
    prisma.errorGroup.count({ where: { firstSeenAt: { gte: since }, source: { not: 'SLOW' } } }),
    prisma.errorGroup.aggregate({ where: { lastSeenAt: { gte: since }, source: { not: 'SLOW' } }, _count: true }),
    prisma.errorGroup.count({ where: { source: 'SLOW', lastSeenAt: { gte: since } } }),
    prisma.errorGroup.groupBy({ by: ['source'], where: { state: 'OPEN' }, _count: true }),
    prisma.jobHeartbeat.findMany(),
    prisma.uptimeEvent.findMany({ orderBy: { downAt: 'desc' }, take: 5 }),
    prisma.user.count({ where: { isDeveloper: true, isActive: true, status: 'ACTIVE' } }),
  ])
  const checks = lastRun ? await prisma.auditCheck.findMany({ where: { runId: lastRun.id }, select: { category: true, name: true, result: true, detail: true } }) : []
  const api = (cat: string) => {
    const rows = checks.filter((c) => c.category === cat && c.result !== 'SKIP')
    return { total: rows.length, passed: rows.filter((c) => c.result === 'PASS').length, failed: rows.filter((c) => c.result === 'FAIL').length }
  }
  const pick = (name: string) => checks.find((c) => c.name === name) ?? null
  const beatMap = new Map(beats.map((b) => [b.name, b]))
  const now = Date.now()
  const jobs = JOBS.map((j) => {
    const b = beatMap.get(j.name)
    const stale = !!b && j.everyMs !== null && now - b.lastRunAt.getTime() > j.everyMs * 3 + 60_000
    return {
      name: j.name, label: j.label, everyMs: j.everyMs,
      lastRunAt: iso(b?.lastRunAt), lastOkAt: iso(b?.lastOkAt), lastError: b?.lastError ?? null,
      lastDurationMs: b?.lastDurationMs ?? null, runs: b?.runs ?? 0, failures: b?.failures ?? 0,
      state: !b ? 'waiting' : b.lastError ? 'failing' : stale ? 'stopped' : 'ok',
    }
  })
  const jobProblems = jobs.filter((j) => j.state === 'failing' || j.state === 'stopped').length
  const status = (lastRun?.failed ?? 0) > 0 || jobProblems > 0 ? 'fail' : (lastRun?.warned ?? 0) > 0 || new24h > 0 ? 'warn' : 'ok'
  res.json({
    status,
    lastRun: lastRun ? runView(lastRun) : null,
    running: running ? { id: running.id, startedAt: iso(running.startedAt) } : null,
    nextRunAt: process.env.HEALTH_AUDIT === 'off' ? null : nextRunAt().toISOString(),
    errors: { open, new24h, seen24h: seen24h._count, slow24h, bySource: Object.fromEntries(bySource.map((b) => [b.source, b._count])) },
    api: { read: api('api-read'), write: api('api-write') },
    jobs,
    server: {
      uptimeSec: Math.round(process.uptime()), rss: process.memoryUsage().rss, freemem: os.freemem(), totalmem: os.totalmem(),
      load: os.loadavg()[0], cpus: os.cpus().length, node: process.version,
      disk: pick('Disk space'), ssl: pick('SSL certificate'), db: pick('Connection'), migrations: pick('Migrations'),
    },
    uptime: { configured: uptimeConfigured(), lastPingAt: iso(lastUptimePing()), outages: outages.map((o) => ({ id: o.id, downAt: iso(o.downAt), upAt: iso(o.upAt), minutes: o.minutes, detail: o.detail })) },
    alertsTo: devCount > 0 ? 'developers' : 'super-admins',
    developers: devCount,
    canManageDevelopers: req.user!.role === 'SUPER_ADMIN',
  })
}

function runView(r: { id: string; trigger: string; state: string; startedAt: Date; finishedAt: Date | null; durationMs: number | null; total: number; passed: number; warned: number; failed: number; skipped: number; newProblems: number; fixed: number }) {
  return { id: r.id, trigger: r.trigger, state: r.state, startedAt: iso(r.startedAt), finishedAt: iso(r.finishedAt), durationMs: r.durationMs, total: r.total, passed: r.passed, warned: r.warned, failed: r.failed, skipped: r.skipped, newProblems: r.newProblems, fixed: r.fixed }
}

const listQuery = z.object({
  state: z.enum(['OPEN', 'RESOLVED', 'IGNORED', 'ALL']).default('OPEN'),
  source: z.enum(['SERVER', 'BROWSER', 'JOB', 'SLOW', 'ALL']).default('ALL'),
  q: z.string().trim().max(100).optional(),
  take: z.coerce.number().int().min(1).max(200).default(100),
})

/** GET /errors?state=&source=&q= */
export async function listErrors(req: AuthedRequest, res: Response): Promise<void> {
  const p = listQuery.safeParse(req.query)
  if (!p.success) { res.status(400).json({ error: 'Bad filter' }); return }
  const { state, source, q, take } = p.data
  const where: Prisma.ErrorGroupWhereInput = {
    ...(state !== 'ALL' ? { state: state as ErrorState } : {}),
    ...(source !== 'ALL' ? { source: source as ErrorSource } : {}),
    ...(q ? { OR: [{ message: { contains: q, mode: 'insensitive' } }, { route: { contains: q, mode: 'insensitive' } }] } : {}),
  }
  const rows = await prisma.errorGroup.findMany({ where, orderBy: { lastSeenAt: 'desc' }, take })
  res.json({
    errors: rows.map((g) => ({
      id: g.id, source: g.source, message: g.message, route: g.route, status: g.status, count: g.count, people: g.userIds.length,
      state: g.state, firstSeenAt: iso(g.firstSeenAt), lastSeenAt: iso(g.lastSeenAt), reopenedAt: iso(g.reopenedAt),
    })),
  })
}

/** GET /errors/:id: the error, who it hit, the latest times and an hour by hour count. */
export async function getError(req: AuthedRequest, res: Response): Promise<void> {
  const g = await prisma.errorGroup.findUnique({ where: { id: req.params.id } })
  if (!g) { res.status(404).json({ error: 'Error not found' }); return }
  const events = await prisma.errorEvent.findMany({ where: { groupId: g.id }, orderBy: { at: 'desc' }, take: 30 })
  const recent = await prisma.errorEvent.findMany({ where: { groupId: g.id, at: { gte: new Date(Date.now() - 2 * DAY) } }, select: { at: true } })
  const ids = [...new Set([...g.userIds, ...events.map((e) => e.userId).filter((x): x is string => !!x), ...(g.resolvedById ? [g.resolvedById] : [])])]
  const names = new Map((await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]))
  const hours = Array.from({ length: 48 }, () => 0)
  const nowH = Math.floor(Date.now() / 3600_000)
  for (const e of recent) { const i = 47 - (nowH - Math.floor(e.at.getTime() / 3600_000)); if (i >= 0 && i < 48) hours[i]++ }
  res.json({
    error: {
      id: g.id, source: g.source, message: g.message, stack: g.stack, route: g.route, status: g.status, count: g.count, state: g.state,
      firstSeenAt: iso(g.firstSeenAt), lastSeenAt: iso(g.lastSeenAt), reopenedAt: iso(g.reopenedAt), resolvedAt: iso(g.resolvedAt),
      resolvedBy: g.resolvedById ? names.get(g.resolvedById) ?? null : null,
      people: g.userIds.map((id) => ({ id, name: names.get(id) ?? 'Someone' })),
      hours,
      events: events.map((e) => ({ id: e.id, at: iso(e.at), user: e.userId ? { id: e.userId, name: names.get(e.userId) ?? 'Someone' } : null, url: e.url, status: e.status, durationMs: e.durationMs, meta: e.meta })),
    },
  })
}

/** PATCH /errors/:id { state }: resolve, ignore or reopen. */
export async function setErrorState(req: AuthedRequest, res: Response): Promise<void> {
  const p = z.object({ state: z.enum(['OPEN', 'RESOLVED', 'IGNORED']) }).safeParse(req.body)
  if (!p.success) { res.status(400).json({ error: 'State must be OPEN, RESOLVED or IGNORED' }); return }
  const g = await prisma.errorGroup.findUnique({ where: { id: req.params.id }, select: { id: true } })
  if (!g) { res.status(404).json({ error: 'Error not found' }); return }
  const resolved = p.data.state === 'RESOLVED'
  await prisma.errorGroup.update({ where: { id: g.id }, data: { state: p.data.state, resolvedAt: resolved ? new Date() : null, resolvedById: resolved ? req.user!.id : null } })
  res.json({ ok: true })
}

/** GET /errors/:id/brief: the error as text to paste into Claude. */
export async function errorBriefText(req: AuthedRequest, res: Response): Promise<void> {
  const text = await errorBrief(req.params.id)
  if (!text) { res.status(404).json({ error: 'Error not found' }); return }
  res.json({ text })
}

/** POST /errors/:id/ticket { project, assigneeIds? }: a ticket with the whole error in it. */
export async function errorTicket(req: AuthedRequest, res: Response): Promise<void> {
  const p = z.object({ project: z.string().trim().min(1).max(20), assigneeIds: z.array(z.string()).max(10).optional() }).safeParse(req.body)
  if (!p.success) { res.status(400).json({ error: 'Pick a project' }); return }
  const g = await prisma.errorGroup.findUnique({ where: { id: req.params.id } })
  if (!g) { res.status(404).json({ error: 'Error not found' }); return }
  const brief = (await errorBrief(g.id)) ?? g.message
  const r = await invokeAs(T.createTask, req.user!, {
    params: { key: p.data.project.toUpperCase() },
    body: {
      title: `Fix error: ${g.message}`.slice(0, 200),
      description: `${brief}\n\nFrom System Health: ${(process.env.APP_URL || '').replace(/\/$/, '')}/app/admin/health?error=${g.id}`.slice(0, 10000),
      priority: g.source === 'SLOW' ? 'MEDIUM' : 'HIGH',
      ...(p.data.assigneeIds?.length ? { assigneeIds: p.data.assigneeIds } : {}),
    },
  })
  if (r.status >= 400) { res.status(r.status).json({ error: invokedError(r) }); return }
  const t = (r.body as { task: { code: string; projectKey?: string } }).task
  res.status(201).json({ code: t.code })
}

/** GET /audits: the latest runs. */
export async function listAudits(_req: AuthedRequest, res: Response): Promise<void> {
  const runs = await prisma.auditRun.findMany({ orderBy: { startedAt: 'desc' }, take: 72 })
  res.json({ runs: runs.map(runView) })
}

/** GET /audits/:id: one run with every check, problems first. */
export async function getAudit(req: AuthedRequest, res: Response): Promise<void> {
  const run = await prisma.auditRun.findUnique({ where: { id: req.params.id } })
  if (!run) { res.status(404).json({ error: 'Run not found' }); return }
  const checks = await prisma.auditCheck.findMany({ where: { runId: run.id }, orderBy: [{ category: 'asc' }, { name: 'asc' }] })
  const rank: Record<string, number> = { FAIL: 0, WARN: 1, PASS: 2, SKIP: 3 }
  checks.sort((a, b) => rank[a.result] - rank[b.result])
  res.json({ run: runView(run), checks: checks.map((c) => ({ id: c.id, category: c.category, name: c.name, result: c.result, ms: c.ms, status: c.status, detail: c.detail, isNew: c.isNew, fixed: c.fixed })) })
}

/** POST /audits/run: start a self check now. */
export async function runAudit(req: AuthedRequest, res: Response): Promise<void> {
  const r = await startAudit({ trigger: 'manual', startedById: req.user!.id })
  res.status(r.already ? 200 : 202).json(r)
}

/** GET /developers: everyone, with who is a developer (Super Admins only). */
export async function listDevelopers(req: AuthedRequest, res: Response): Promise<void> {
  if (req.user!.role !== 'SUPER_ADMIN') { res.status(403).json({ error: 'Only Super Admins can choose developers' }); return }
  const users = await prisma.user.findMany({ where: { isActive: true, status: 'ACTIVE' }, select: { id: true, name: true, email: true, role: true, isDeveloper: true }, orderBy: [{ isDeveloper: 'desc' }, { name: 'asc' }] })
  res.json({ users })
}

/** PATCH /developers/:userId { isDeveloper } (Super Admins only). */
export async function setDeveloper(req: AuthedRequest, res: Response): Promise<void> {
  if (req.user!.role !== 'SUPER_ADMIN') { res.status(403).json({ error: 'Only Super Admins can choose developers' }); return }
  const p = z.object({ isDeveloper: z.boolean() }).safeParse(req.body)
  if (!p.success) { res.status(400).json({ error: 'isDeveloper must be true or false' }); return }
  const u = await prisma.user.findUnique({ where: { id: req.params.userId }, select: { id: true } })
  if (!u) { res.status(404).json({ error: 'Person not found' }); return }
  await prisma.user.update({ where: { id: u.id }, data: { isDeveloper: p.data.isDeveloper } })
  res.json({ ok: true })
}

// --- Browser errors -----------------------------------------------------------------------

const clientError = z.object({
  message: z.string().min(1).max(2000),
  stack: z.string().max(8000).optional().nullable(),
  url: z.string().max(1000).optional().nullable(),
  kind: z.enum(['error', 'rejection', 'render']).optional(),
  release: z.string().max(60).optional().nullable(),
})

const perMinute = new Map<string, { at: number; n: number }>()
const CLIENT_PER_MINUTE = 20

/** Who is sending, if they are signed in (a broken login page still gets reported, without a name). */
function optionalUser(req: Request): string | null {
  const cookie = (req as Request & { cookies?: Record<string, string> }).cookies?.token
  const header = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null
  const token = cookie || header
  if (!token) return null
  try { return verifyToken(token).sub ?? null } catch { return null }
}

function shortBrowser(ua: string | undefined): string | null {
  if (!ua) return null
  const b = /Edg\/(\d+)/.exec(ua) ? `Edge ${/Edg\/(\d+)/.exec(ua)![1]}` : /Chrome\/(\d+)/.exec(ua) ? `Chrome ${/Chrome\/(\d+)/.exec(ua)![1]}` : /Firefox\/(\d+)/.exec(ua) ? `Firefox ${/Firefox\/(\d+)/.exec(ua)![1]}` : /Version\/(\d+).*Safari/.exec(ua) ? `Safari ${/Version\/(\d+)/.exec(ua)![1]}` : 'Browser'
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : ''
  return `${b}${os ? ` on ${os}` : ''}`
}

/** POST /client-error: a page broke in someone's browser. */
export async function reportClientError(req: Request, res: Response): Promise<void> {
  const p = clientError.safeParse(req.body)
  if (!p.success) { res.status(400).json({ error: 'Bad report' }); return }
  const userId = optionalUser(req)
  const who = userId ?? req.ip ?? 'anon'
  const now = Date.now()
  const slot = perMinute.get(who)
  if (slot && now - slot.at < 60_000) {
    if (slot.n >= CLIENT_PER_MINUTE) { res.status(429).json({ error: 'Too many reports' }); return }
    slot.n++
  } else perMinute.set(who, { at: now, n: 1 })
  if (perMinute.size > 5000) perMinute.clear()
  // A browser extension's or another site's script broke, not ours: nothing to fix in Metriq.
  if (isForeignScriptError(p.data.stack, p.data.url)) { res.status(202).json({ ok: true, ignored: 'not Metriq code' }); return }
  let page: string | null = null
  try { page = p.data.url ? normalizePath(new URL(p.data.url, 'http://x').pathname) : null } catch { page = null }
  captureError({
    source: 'BROWSER',
    message: p.data.kind === 'render' ? `Screen crashed: ${p.data.message}` : p.data.message,
    stack: p.data.stack ?? null,
    route: page,
    userId,
    url: p.data.url ?? null,
    meta: { browser: shortBrowser(req.headers['user-agent']), kind: p.data.kind ?? 'error', release: p.data.release ?? null },
  })
  res.status(202).json({ ok: true })
}

// --- Outside uptime checker ---------------------------------------------------------------

const uptimeBody = z.discriminatedUnion('event', [
  z.object({ event: z.literal('ping') }),
  z.object({ event: z.literal('outage'), downAt: z.coerce.date(), upAt: z.coerce.date(), detail: z.string().max(300).optional() }),
])

/** POST /uptime: the outside checker says it is alive, or reports an outage once the site is back. */
export async function uptimeReport(req: Request, res: Response): Promise<void> {
  if (!uptimeTokenOk(req.headers['x-uptime-token'])) { res.status(401).json({ error: 'Wrong or missing uptime token' }); return }
  const p = uptimeBody.safeParse(req.body)
  if (!p.success) { res.status(400).json({ error: 'Bad report' }); return }
  if (p.data.event === 'ping') { recordPing(); res.json({ ok: true }); return }
  if (p.data.upAt.getTime() < p.data.downAt.getTime()) { res.status(400).json({ error: 'upAt is before downAt' }); return }
  const r = await recordOutage({ downAt: p.data.downAt, upAt: p.data.upAt, detail: p.data.detail })
  res.status(201).json(r)
}
