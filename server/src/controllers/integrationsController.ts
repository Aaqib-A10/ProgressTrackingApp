import type { Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { loadPowers } from '../lib/permissions'
import { recordActivity } from '../lib/audit'
import { EVENTS, EVENT_KEYS, badWebhookUrl, forgetWebhooks, newWebhookSecret, sendTest } from '../lib/webhooks'
import { newApiKey } from './publicApiController'

/**
 * Company settings → API: the company's API keys (for the public API, /api/v1) and its webhooks. Only people with
 * the Company settings power, and never during a help sign-in by Metriq support. A key and a webhook secret are shown
 * once, when made; afterwards only what tells them apart.
 */

const MAX_KEYS = 20
const MAX_HOOKS = 10

async function admin(req: AuthedRequest, res: Response): Promise<{ id: string; companyId: string } | null> {
  if (req.user!.supportBy) { res.status(403).json({ error: 'Metriq support cannot open this part.' }); return null }
  if (!(await loadPowers(req.user!.id)).includes('company.settings')) { res.status(403).json({ error: 'Only the Super Admin (or someone given Company settings) can manage the API.' }); return null }
  return { id: req.user!.id, companyId: req.user!.companyId }
}

const keyView = (k: { id: string; name: string; prefix: string; access: string; lastUsedAt: Date | null; revokedAt: Date | null; createdAt: Date }) => ({ id: k.id, name: k.name, prefix: k.prefix, access: k.access, lastUsedAt: k.lastUsedAt, createdAt: k.createdAt })
const hookView = (w: { id: string; url: string; events: string[]; active: boolean; failCount: number; lastStatus: number | null; lastAt: Date | null; createdAt: Date }) => ({ id: w.id, url: w.url, events: w.events, active: w.active, failCount: w.failCount, lastStatus: w.lastStatus, lastAt: w.lastAt, createdAt: w.createdAt })

/** GET /api/company/api — the keys, the webhooks and the events a webhook can ask for. */
export async function overview(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await admin(req, res))) return
  const [keys, hooks] = await Promise.all([
    prisma.apiKey.findMany({ where: { revokedAt: null }, orderBy: { createdAt: 'desc' } }),
    prisma.webhook.findMany({ orderBy: { createdAt: 'desc' } }),
  ])
  res.json({ keys: keys.map(keyView), webhooks: hooks.map(hookView), events: EVENT_KEYS.map((key) => ({ key, label: EVENTS[key] })) })
}

/** POST /api/company/api/keys { name, access } — a new key. The key itself is in this answer only. */
export async function createKey(req: AuthedRequest, res: Response): Promise<void> {
  const me = await admin(req, res)
  if (!me) return
  const p = z.object({ name: z.string().trim().min(2, 'Give the key a name, like the tool that will use it').max(60), access: z.enum(['read', 'write']).default('read') }).safeParse(req.body)
  if (!p.success) { res.status(400).json({ error: p.error.issues[0]?.message ?? 'Invalid input' }); return }
  if ((await prisma.apiKey.count({ where: { revokedAt: null } })) >= MAX_KEYS) { res.status(409).json({ error: `A company can have ${MAX_KEYS} keys. Remove one you no longer use.` }); return }
  const made = newApiKey()
  const key = await prisma.apiKey.create({ data: { name: p.data.name, access: p.data.access, prefix: made.prefix, tokenHash: made.tokenHash, createdById: me.id } })
  await recordActivity(me.id, 'CREATE', 'ApiKey', key.id, { after: { summary: `Made the API key "${key.name}" (${key.access === 'write' ? 'read and write' : 'read only'})` } })
  res.status(201).json({ key: keyView(key), token: made.token })
}

/** DELETE /api/company/api/keys/:id — the key stops working at once. */
export async function removeKey(req: AuthedRequest, res: Response): Promise<void> {
  const me = await admin(req, res)
  if (!me) return
  const key = await prisma.apiKey.findUnique({ where: { id: req.params.id } })
  if (!key || key.revokedAt) { res.status(404).json({ error: 'Key not found' }); return }
  await prisma.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } })
  await recordActivity(me.id, 'DELETE', 'ApiKey', key.id, { before: { summary: `Removed the API key "${key.name}"` } })
  res.status(204).end()
}

const hookSchema = z.object({
  url: z.string().trim().max(500),
  events: z.array(z.enum(EVENT_KEYS as [string, ...string[]])).min(1, 'Pick at least one event').max(EVENT_KEYS.length),
})

/** POST /api/company/api/webhooks { url, events } — a new webhook. Its secret is in this answer only. */
export async function createWebhook(req: AuthedRequest, res: Response): Promise<void> {
  const me = await admin(req, res)
  if (!me) return
  const p = hookSchema.safeParse(req.body)
  if (!p.success) { res.status(400).json({ error: p.error.issues[0]?.message ?? 'Invalid input' }); return }
  const bad = badWebhookUrl(p.data.url)
  if (bad) { res.status(400).json({ error: bad }); return }
  if ((await prisma.webhook.count()) >= MAX_HOOKS) { res.status(409).json({ error: `A company can have ${MAX_HOOKS} webhooks. Remove one you no longer use.` }); return }
  const secret = newWebhookSecret()
  const w = await prisma.webhook.create({ data: { url: p.data.url, events: [...new Set(p.data.events)], secret, createdById: me.id } })
  forgetWebhooks(me.companyId)
  await recordActivity(me.id, 'CREATE', 'Webhook', w.id, { after: { summary: `Added a webhook to ${new URL(w.url).host} for ${w.events.join(', ')}` } })
  res.status(201).json({ webhook: hookView(w), secret })
}

/** PATCH /api/company/api/webhooks/:id { url?, events?, active? } — change it, or switch it on again after failures. */
export async function updateWebhook(req: AuthedRequest, res: Response): Promise<void> {
  const me = await admin(req, res)
  if (!me) return
  const p = hookSchema.partial().extend({ active: z.boolean().optional() }).safeParse(req.body)
  if (!p.success) { res.status(400).json({ error: p.error.issues[0]?.message ?? 'Invalid input' }); return }
  const w = await prisma.webhook.findUnique({ where: { id: req.params.id } })
  if (!w) { res.status(404).json({ error: 'Webhook not found' }); return }
  if (p.data.url) { const bad = badWebhookUrl(p.data.url); if (bad) { res.status(400).json({ error: bad }); return } }
  const next = await prisma.webhook.update({ where: { id: w.id }, data: { ...(p.data.url ? { url: p.data.url } : {}), ...(p.data.events ? { events: [...new Set(p.data.events)] } : {}), ...(p.data.active !== undefined ? { active: p.data.active, ...(p.data.active ? { failCount: 0 } : {}) } : {}) } })
  forgetWebhooks(me.companyId)
  await recordActivity(me.id, 'UPDATE', 'Webhook', w.id, { after: { summary: `Changed the webhook to ${new URL(next.url).host}${p.data.active !== undefined ? ` (${next.active ? 'on' : 'off'})` : ''}` } })
  res.json({ webhook: hookView(next) })
}

/** DELETE /api/company/api/webhooks/:id */
export async function removeWebhook(req: AuthedRequest, res: Response): Promise<void> {
  const me = await admin(req, res)
  if (!me) return
  const w = await prisma.webhook.findUnique({ where: { id: req.params.id } })
  if (!w) { res.status(404).json({ error: 'Webhook not found' }); return }
  await prisma.webhook.delete({ where: { id: w.id } })
  forgetWebhooks(me.companyId)
  await recordActivity(me.id, 'DELETE', 'Webhook', w.id, { before: { summary: `Removed the webhook to ${new URL(w.url).host}` } })
  res.status(204).end()
}

/** POST /api/company/api/webhooks/:id/test — send a test message now and say whether the address answered. */
export async function testWebhook(req: AuthedRequest, res: Response): Promise<void> {
  const me = await admin(req, res)
  if (!me) return
  const w = await prisma.webhook.findUnique({ where: { id: req.params.id } })
  if (!w) { res.status(404).json({ error: 'Webhook not found' }); return }
  const ok = await sendTest(me.companyId, w)
  const last = await prisma.webhookDelivery.findFirst({ where: { webhookId: w.id }, orderBy: { createdAt: 'desc' } })
  res.json({ ok, status: last?.status ?? null, error: last?.error ?? null })
}

/** GET /api/company/api/webhooks/:id/deliveries — the last 50 messages sent to it. */
export async function deliveries(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await admin(req, res))) return
  const rows = await prisma.webhookDelivery.findMany({ where: { webhookId: req.params.id }, orderBy: { createdAt: 'desc' }, take: 50 })
  res.json({ deliveries: rows.map((d) => ({ id: d.id, event: d.event, ok: d.ok, status: d.status, error: d.error, durationMs: d.durationMs, createdAt: d.createdAt })) })
}
