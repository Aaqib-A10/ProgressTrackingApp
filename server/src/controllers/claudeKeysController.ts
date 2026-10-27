import type { Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { hashKey, newKey } from '../lib/mcp'

/**
 * Connectors (Claude, ChatGPT, Gemini). A person makes a private key for one of these apps; the
 * connector link (https://<site>/api/mcp/<key>) is shown once, to paste into that app as a custom
 * connector. The app then works in Metriq as that person, with the same tools whichever app it
 * is. Switching a key off stops it at once.
 */

export const CLIENTS = ['claude', 'chatgpt', 'gemini'] as const

const APP_URL = () => (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '')
/** Keys on at once, per app. */
const MAX_KEYS = 5

const view = (k: { id: string; name: string; client: string; prefix: string; lastUsedAt: Date | null; createdAt: Date }) => ({
  id: k.id, name: k.name, client: k.client, prefix: k.prefix, lastUsedAt: k.lastUsedAt?.toISOString() ?? null, createdAt: k.createdAt.toISOString(),
})

/** GET /api/claude/keys — my keys that are still on (never the key itself). */
export async function listClaudeKeys(req: AuthedRequest, res: Response): Promise<void> {
  const keys = await prisma.claudeKey.findMany({ where: { userId: req.user!.id, revokedAt: null }, orderBy: { createdAt: 'desc' } })
  res.json({ keys: keys.map(view) })
}

/** POST /api/claude/keys { name, client? } — a new key; the connector link is returned this once only. */
export async function createClaudeKey(req: AuthedRequest, res: Response): Promise<void> {
  const parsed = z.object({
    name: z.string().trim().min(1, 'Give it a name, e.g. My Claude.').max(60),
    client: z.enum(CLIENTS).default('claude'),
  }).safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Give it a name.' }); return }
  const { name, client } = parsed.data
  const active = await prisma.claudeKey.count({ where: { userId: req.user!.id, client, revokedAt: null } })
  if (active >= MAX_KEYS) { res.status(400).json({ error: `You already have ${MAX_KEYS} keys for this app. Switch one off first.` }); return }
  const secret = newKey()
  const k = await prisma.claudeKey.create({ data: { userId: req.user!.id, name, client, tokenHash: hashKey(secret), prefix: secret.slice(0, 10) } })
  res.status(201).json({ key: view(k), connectorUrl: `${APP_URL()}/api/mcp/${secret}` })
}

/** DELETE /api/claude/keys/:id — switch a key off (the app loses access at once). */
export async function revokeClaudeKey(req: AuthedRequest, res: Response): Promise<void> {
  const r = await prisma.claudeKey.updateMany({ where: { id: req.params.id, userId: req.user!.id, revokedAt: null }, data: { revokedAt: new Date() } })
  if (r.count === 0) { res.status(404).json({ error: 'Key not found' }); return }
  res.status(204).end()
}
