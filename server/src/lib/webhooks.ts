import { createHmac, randomBytes } from 'crypto'
import { lookup } from 'dns/promises'
import { prisma, onRecordChanged, type RecordChange } from './prisma'
import { runAsCompany, maybeCompanyId } from './tenancy'
import { inAudit } from './health/auditContext'

/**
 * Webhooks: a company gives Metriq an address, and Metriq tells that address when something happens (a lead comes
 * in, a task is finished, someone checks in). Company settings → API. For connecting Metriq to other tools without
 * anyone copying data by hand.
 *
 *  - Each message is a POST with a JSON body { id, event, createdAt, data } and is signed: the header
 *    X-Metriq-Signature is "sha256=" + HMAC-SHA256(body, the webhook's secret).
 *  - Three tries (at once, after 2 seconds, after 15 seconds), 8 seconds each. Every try is kept in the delivery list.
 *  - Twenty failures in a row switch the webhook off, so a dead address is not called for ever.
 *  - Only an https address on the public internet (never the server's own network).
 *
 * Events come from one place: every save passes lib/prisma, which tells this file what changed. No screen has to
 * remember to announce anything.
 */

export const EVENTS: Record<string, string> = {
  'lead.created': 'A new lead comes in',
  'lead.status_changed': "A lead's status changes",
  'task.created': 'A project task is made',
  'task.completed': 'A project task is finished',
  'attendance.checked_in': 'Someone checks in',
  'attendance.checked_out': 'Someone checks out',
  'deal.decided': 'A deal is won, lost or becomes a contract',
}
export const EVENT_KEYS = Object.keys(EVENTS)

const MAX_FAILS = 20
const TIMEOUT_MS = 8000
const RETRY_AFTER_MS = [2000, 15000]

export const newWebhookSecret = (): string => `whsec_${randomBytes(24).toString('base64url')}`
export const sign = (body: string, secret: string): string => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`

/** Tests only: what would have been sent (nothing leaves the machine in tests). */
export const webhookLog: { url: string; event: string; body: string; signature: string }[] = []

const PRIVATE_V4 = /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/
const isPrivate = (ip: string): boolean => PRIVATE_V4.test(ip) || ip === '::1' || /^f[cd]/i.test(ip) || /^fe80:/i.test(ip) || ip === '::'

/** Why this address cannot be a webhook, or null when it can. Local addresses are allowed outside production, for trying it out. */
export function badWebhookUrl(raw: string): string | null {
  let u: URL
  try { u = new URL(raw) } catch { return 'Enter a full address, like https://example.com/metriq' }
  const prod = process.env.NODE_ENV === 'production'
  if (u.protocol !== 'https:' && (prod || u.protocol !== 'http:')) return 'The address must start with https://'
  if (u.username || u.password) return 'Leave any user name and password out of the address.'
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (prod && (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || isPrivate(host))) return 'That address is not on the public internet.'
  return null
}

// The company's switched-on webhooks, kept for half a minute (asked on every save of a watched record).
const cache = new Map<string, { at: number; hooks: { id: string; url: string; secret: string; events: string[] }[] }>()
export function forgetWebhooks(companyId: string): void { cache.delete(companyId) }
async function hooksOf(companyId: string) {
  const hit = cache.get(companyId)
  if (hit && Date.now() - hit.at < 30_000) return hit.hooks
  const hooks = await runAsCompany(companyId, () => prisma.webhook.findMany({ where: { active: true }, select: { id: true, url: true, secret: true, events: true } }))
  cache.set(companyId, { at: Date.now(), hooks })
  return hooks
}

async function record(companyId: string, webhookId: string, event: string, r: { ok: boolean; status?: number; error?: string; ms: number }, last: boolean): Promise<void> {
  await runAsCompany(companyId, async () => {
    await prisma.webhookDelivery.create({ data: { webhookId, event, ok: r.ok, status: r.status ?? null, error: r.error?.slice(0, 300) ?? null, durationMs: r.ms } })
    if (r.ok) await prisma.webhook.update({ where: { id: webhookId }, data: { failCount: 0, lastStatus: r.status ?? null, lastAt: new Date() } })
    else if (last) {
      const w = await prisma.webhook.update({ where: { id: webhookId }, data: { failCount: { increment: 1 }, lastStatus: r.status ?? null, lastAt: new Date() } })
      if (w.failCount >= MAX_FAILS && w.active) { await prisma.webhook.update({ where: { id: webhookId }, data: { active: false } }); forgetWebhooks(companyId) }
    }
    // Keep the list short: the newest 100 per webhook.
    if (Math.random() < 0.05) {
      const old = await prisma.webhookDelivery.findMany({ where: { webhookId }, orderBy: { createdAt: 'desc' }, skip: 100, take: 500, select: { id: true } })
      if (old.length) await prisma.webhookDelivery.deleteMany({ where: { id: { in: old.map((o) => o.id) } } })
    }
  }).catch(() => undefined)
}

async function post(url: string, event: string, body: string, signature: string): Promise<{ ok: boolean; status?: number; error?: string; ms: number }> {
  const started = Date.now()
  if (process.env.NODE_ENV === 'test') { webhookLog.push({ url, event, body, signature }); return { ok: !url.includes('fail'), status: url.includes('fail') ? 500 : 200, ms: 0 } }
  try {
    const bad = badWebhookUrl(url)
    if (bad) return { ok: false, error: bad, ms: 0 }
    if (process.env.NODE_ENV === 'production') {
      // The name must not point back into the server's own network (checked again each time: names can change).
      const found = await lookup(new URL(url).hostname, { all: true })
      if (found.some((a) => isPrivate(a.address))) return { ok: false, error: 'That address is not on the public internet.', ms: Date.now() - started }
    }
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(url, { method: 'POST', redirect: 'error', signal: ctl.signal, headers: { 'Content-Type': 'application/json', 'User-Agent': 'Metriq-Webhooks/1', 'X-Metriq-Event': event, 'X-Metriq-Signature': signature }, body })
      return { ok: res.status >= 200 && res.status < 300, status: res.status, ms: Date.now() - started }
    } finally { clearTimeout(timer) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? (e.name === 'AbortError' ? `No answer in ${TIMEOUT_MS / 1000} seconds` : e.message) : 'Could not reach the address', ms: Date.now() - started }
  }
}

async function deliver(companyId: string, hook: { id: string; url: string; secret: string }, event: string, body: string, attempt = 0): Promise<boolean> {
  const r = await post(hook.url, event, body, sign(body, hook.secret))
  const last = r.ok || attempt >= RETRY_AFTER_MS.length || process.env.NODE_ENV === 'test'
  await record(companyId, hook.id, event, r, last)
  if (!last) { const t = setTimeout(() => { void deliver(companyId, hook, event, body, attempt + 1) }, RETRY_AFTER_MS[attempt]); t.unref?.() }
  return r.ok
}

/** Tell the company's webhooks that want this event. Never throws, never waited on by the save that caused it. */
export async function emit(companyId: string, event: string, data: Record<string, unknown>): Promise<void> {
  try {
    if (inAudit()) return // the hourly self check changes nothing and tells nobody
    const hooks = (await hooksOf(companyId)).filter((h) => h.events.includes(event))
    if (!hooks.length) return
    const body = JSON.stringify({ id: `evt_${randomBytes(12).toString('hex')}`, event, createdAt: new Date().toISOString(), data })
    await Promise.all(hooks.map((h) => deliver(companyId, h, event, body)))
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[webhooks] could not send', event, e instanceof Error ? e.message : e)
  }
}

/** A test message to one webhook (Company settings → API → Send a test). */
export async function sendTest(companyId: string, hook: { id: string; url: string; secret: string }): Promise<boolean> {
  const body = JSON.stringify({ id: `evt_${randomBytes(12).toString('hex')}`, event: 'test', createdAt: new Date().toISOString(), data: { message: 'This is a test from Metriq. Your address answers, and the signature can be checked with your secret.' } })
  const r = await post(hook.url, 'test', body, sign(body, hook.secret))
  await record(companyId, hook.id, 'test', r, true)
  return r.ok
}

// ------------------------------------------------------------------ what a save means

const iso = (d: unknown): string | null => (d instanceof Date ? d.toISOString() : typeof d === 'string' ? d : null)
const num = (v: unknown): number | null => (v == null ? null : typeof v === 'number' ? v : typeof (v as { toNumber?: () => number }).toNumber === 'function' ? (v as { toNumber: () => number }).toNumber() : Number(v))
type Row = Record<string, unknown>
const dataOf = (args: unknown, key: 'data' | 'create' | 'update' = 'data'): Row => ((args as Record<string, unknown> | undefined)?.[key] as Row | undefined) ?? {}

const lead = (r: Row) => ({ id: r.id, name: r.name, email: r.email ?? null, phone: r.phone ?? null, organization: r.organization ?? null, status: r.status, source: r.source, value: num(r.value), businessId: r.businessId, createdAt: iso(r.createdAt) })
const task = (r: Row) => ({ id: r.id, code: r.code, title: r.title, projectId: r.projectId, priority: r.priority, dueAt: iso(r.dueAt), completedAt: iso(r.completedAt), createdAt: iso(r.createdAt) })
const day = (r: Row) => ({ id: r.id, personId: r.userId, date: iso(r.date)?.slice(0, 10) ?? null, checkInAt: iso(r.checkInAt), checkOutAt: iso(r.checkOutAt) })
const deal = (r: Row) => ({ id: r.id, number: r.number, title: r.title, company: r.company, status: r.status, awardedPrice: num(r.awardedPrice), totalAmount: num(r.totalAmount), closedDate: iso(r.closedDate) })

/** The events a save stands for, with what to send. Only single-row saves that return the row are announced. */
export function eventsOf(c: RecordChange): { event: string; data: Record<string, unknown> }[] {
  const r = c.result as Row | null
  if (!r || typeof r !== 'object' || typeof r.id !== 'string') return []
  const d = dataOf(c.args)
  if (c.model === 'Lead') {
    if (c.operation === 'create') return [{ event: 'lead.created', data: lead(r) }]
    if (c.operation === 'update' && typeof d.status === 'string') return [{ event: 'lead.status_changed', data: lead(r) }]
  }
  if (c.model === 'PmTask') {
    if (c.operation === 'create') return [{ event: 'task.created', data: task(r) }]
    if (c.operation === 'update' && d.completedAt instanceof Date) return [{ event: 'task.completed', data: task(r) }]
  }
  if (c.model === 'AttendanceDay') {
    const made = c.operation === 'create' ? d : c.operation === 'upsert' ? dataOf(c.args, 'create') : {}
    const changed = c.operation === 'update' ? d : c.operation === 'upsert' ? dataOf(c.args, 'update') : {}
    const out: { event: string; data: Record<string, unknown> }[] = []
    if ((made.checkInAt instanceof Date || changed.checkInAt instanceof Date) && r.checkInAt && !r.checkOutAt) out.push({ event: 'attendance.checked_in', data: day(r) })
    if (changed.checkOutAt instanceof Date && r.checkOutAt) out.push({ event: 'attendance.checked_out', data: day(r) })
    return out
  }
  if (c.model === 'Bid' && c.operation === 'update' && ['WON', 'LOST', 'CONTRACT'].includes(String(d.status))) return [{ event: 'deal.decided', data: deal(r) }]
  return []
}

const WATCHED = new Set(['Lead', 'PmTask', 'AttendanceDay', 'Bid'])

/** Start announcing saves (called once when the server starts). */
export function startWebhooks(): void {
  onRecordChanged((c) => {
    if (!WATCHED.has(c.model)) return
    const found = eventsOf(c)
    if (!found.length) return
    const companyId = maybeCompanyId() ?? (typeof (c.result as Row | null)?.companyId === 'string' ? ((c.result as Row).companyId as string) : null)
    if (!companyId) return
    // After the save has returned, so a slow address never holds anyone's click up.
    setImmediate(() => { for (const f of found) void emit(companyId, f.event, f.data) })
  })
}
