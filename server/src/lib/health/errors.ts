import { createHash } from 'node:crypto'
import type { ErrorSource, Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { auditStore } from './auditContext'
import { alertDevelopers } from './alerts'

/**
 * The error log. Anything that breaks (an API crash, a page that broke in someone's browser,
 * a background job, a request that took too long) comes here. The same error is one group
 * with a count, so a storm of 500 identical errors is one row, not 500. Hits are collected
 * in memory and saved every few seconds, so an error storm cannot flood the database.
 *
 * Nothing secret is kept: tokens, connector keys, passwords and cookies are cut out of every
 * message, stack and address before saving, and request bodies are never stored.
 */

export interface ErrorInput {
  source: ErrorSource
  message: string
  stack?: string | null
  /** "GET /api/projects/:key", a page path like "/app/projects/:key", or "job:auto-checkout". */
  route?: string | null
  status?: number | null
  userId?: string | null
  url?: string | null
  durationMs?: number | null
  meta?: Record<string, unknown> | null
}

const MAX_MESSAGE = 1000
const MAX_STACK = 8000
const EVENTS_PER_FLUSH = 5 // per error kind, per flush (a sample during storms)
const FLUSH_MS = 3000

/** Cut secrets out of any text before it is saved. */
export function scrub(text: string): string {
  return text
    .replace(/\/api\/mcp\/[^/\s?#"']+/g, '/api/mcp/[key]')
    .replace(/\bmtq_[A-Za-z0-9_-]+/g, 'mtq_[hidden]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [hidden]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[token]')
    .replace(/((?:password|passwd|pwd|token|secret|api[_-]?key|authorization|cookie)["']?\s*[:=]\s*["']?)[^\s"'&,;}]+/gi, '$1[hidden]')
    .replace(/([?&](?:token|key|code|password|secret|sig)=)[^&#\s]+/gi, '$1[hidden]')
}

/** "/api/projects/cmabc123.../tasks/42" → "/api/projects/:id/tasks/:n" (for grouping pages). */
export function normalizePath(p: string): string {
  const path = p.split(/[?#]/)[0]
  return path
    .split('/')
    .map((seg) => {
      if (!seg) return seg
      if (/^c[a-z0-9]{20,}$/i.test(seg) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg) || /^[0-9a-f]{24,}$/i.test(seg)) return ':id'
      if (/^\d+$/.test(seg)) return ':n'
      if (/^[A-Z][A-Z0-9]{1,9}-\d+$/.test(seg)) return ':code'
      return seg
    })
    .join('/')
}

/** The first line of the stack that points at our own code, without line numbers or build hashes. */
function topFrame(stack: string | null | undefined): string {
  if (!stack) return ''
  for (const line of stack.split('\n').slice(1)) {
    const l = line.trim()
    if (!l || /node_modules|node:internal|<anonymous>|\(native\)/.test(l)) continue
    return l
      .replace(/:\d+(:\d+)?\)?$/, '')
      .replace(/\?[^\s)]*/g, '')
      .replace(/-[A-Za-z0-9_]{8}\.js/g, '.js')
      .replace(/https?:\/\/[^/\s]+/g, '')
  }
  return ''
}

/** Words that change every time (ids, numbers, quoted values) are blanked so the same error groups together. */
function normalizeMessage(m: string): string {
  return m
    .replace(/c[a-z0-9]{20,}/gi, '<id>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\b\d+(\.\d+)?\b/g, '<n>')
    .replace(/"[^"]{0,80}"|'[^']{0,80}'/g, '<s>')
    .trim()
}

export function fingerprintOf(e: Pick<ErrorInput, 'source' | 'message' | 'stack' | 'route'>): string {
  const base = e.source === 'SLOW'
    ? `SLOW|${e.route ?? ''}`
    : `${e.source}|${e.route ?? ''}|${normalizeMessage(e.message)}|${topFrame(e.stack)}`
  return createHash('sha1').update(base).digest('hex')
}

interface Pending {
  input: ErrorInput
  count: number
  userIds: Set<string>
  samples: ErrorInput[]
  lastAt: Date
}

const pending = new Map<string, Pending>()
let timer: NodeJS.Timeout | null = null
let flushing: Promise<void> | null = null

/** Record an error. Never throws and never slows the request down. */
export function captureError(input: ErrorInput): void {
  try {
    const probe = auditStore.getStore()
    if (probe) {
      // The self check's own test requests: keep it for its report, not the error log.
      probe.error ??= { message: scrub(input.message).slice(0, MAX_MESSAGE), stack: input.stack ? scrub(input.stack).slice(0, MAX_STACK) : undefined }
      return
    }
    const clean: ErrorInput = {
      ...input,
      message: scrub(String(input.message || 'Unknown error')).slice(0, MAX_MESSAGE),
      stack: input.stack ? scrub(input.stack).slice(0, MAX_STACK) : null,
      route: input.route ? scrub(input.route).slice(0, 300) : null,
      url: input.url ? scrub(input.url).slice(0, 500) : null,
    }
    const fp = fingerprintOf(clean)
    const p = pending.get(fp) ?? { input: clean, count: 0, userIds: new Set<string>(), samples: [], lastAt: new Date() }
    p.count++
    p.input = clean // the latest message and stack win
    p.lastAt = new Date()
    if (clean.userId) p.userIds.add(clean.userId)
    if (p.samples.length < EVENTS_PER_FLUSH) p.samples.push(clean)
    pending.set(fp, p)
    if (!timer) {
      timer = setTimeout(() => { timer = null; void flushErrors() }, FLUSH_MS)
      timer.unref()
    }
  } catch {
    // The error log must never break the app.
  }
}

/** Save what has been collected. Also called by tests and before the process exits. */
export async function flushErrors(): Promise<void> {
  if (flushing) await flushing
  if (!pending.size) return
  const batch = [...pending.entries()]
  pending.clear()
  flushing = (async () => {
    for (const [fp, p] of batch) {
      try { await saveGroup(fp, p) } catch (e) { console.error('[health] could not save an error', (e as Error).message) } // eslint-disable-line no-console
    }
  })()
  try { await flushing } finally { flushing = null }
}

async function saveGroup(fp: string, p: Pending): Promise<void> {
  const i = p.input
  const existing = await prisma.errorGroup.findUnique({ where: { fingerprint: fp }, select: { id: true, state: true, userIds: true } })
  let groupId: string
  let alert: 'new' | 'back' | null = null
  if (!existing) {
    const g = await prisma.errorGroup.create({
      data: {
        fingerprint: fp, source: i.source, message: i.message, stack: i.stack, route: i.route, status: i.status ?? null,
        count: p.count, userIds: [...p.userIds].slice(0, 50), firstSeenAt: p.lastAt, lastSeenAt: p.lastAt,
      },
      select: { id: true },
    })
    groupId = g.id
    alert = 'new'
  } else {
    const users = [...new Set([...existing.userIds, ...p.userIds])].slice(0, 50)
    const cameBack = existing.state === 'RESOLVED'
    await prisma.errorGroup.update({
      where: { id: existing.id },
      data: {
        count: { increment: p.count }, message: i.message, stack: i.stack ?? undefined, status: i.status ?? undefined,
        lastSeenAt: p.lastAt, userIds: users,
        ...(cameBack ? { state: 'OPEN', reopenedAt: p.lastAt, resolvedAt: null, resolvedById: null } : {}),
      },
    })
    groupId = existing.id
    if (cameBack) alert = 'back'
  }
  await prisma.errorEvent.createMany({
    data: p.samples.map((s) => ({
      groupId, userId: s.userId ?? null, url: s.url ?? null, status: s.status ?? null, durationMs: s.durationMs ?? null,
      meta: (s.meta ?? undefined) as Prisma.InputJsonValue | undefined,
    })),
  })
  // Slow requests are listed but never ping anyone.
  if (alert && i.source !== 'SLOW') {
    const where = i.source === 'BROWSER' ? 'in a browser' : i.source === 'JOB' ? 'in a background job' : 'on the server'
    await alertDevelopers({
      title: alert === 'new' ? `New error ${where}` : `An error came back ${where}`,
      body: `${i.route ? `${i.route}: ` : ''}${i.message}`.slice(0, 180),
      link: `/app/admin/health?error=${groupId}`,
      key: `error:${fp}`,
    })
  }
}
