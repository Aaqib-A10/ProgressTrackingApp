import type { Request, Response, NextFunction } from 'express'
import { verifyOwnerToken } from '../lib/auth'
import { prisma } from '../lib/prisma'

/** The owner console's own session cookie, sent only to /api/owner. */
export const OWNER_COOKIE = 'pt_owner'

export interface OwnerRequest extends Request {
  owner?: { id: string; name: string; email: string }
}

/**
 * Only the owner's own session opens the console: its own cookie, its own audience, and the
 * account is looked up on every request (a reset or a lock ends existing sessions at once).
 * A company user's session (any role, Super Admin included) is refused.
 */
export async function requireOwner(req: OwnerRequest, res: Response, next: NextFunction): Promise<void> {
  const token = (req as Request & { cookies?: Record<string, string> }).cookies?.[OWNER_COOKIE]
  if (!token) { res.status(401).json({ error: 'Sign in to the owner console' }); return }
  let payload
  try { payload = verifyOwnerToken(token, 'owner') } catch { res.status(401).json({ error: 'Your owner session has ended. Sign in again.' }); return }
  const o = await prisma.platformOwner.findUnique({ where: { id: payload.sub }, select: { id: true, name: true, email: true, sessionsFrom: true, lockedUntil: true } })
  if (!o || (payload.iat !== undefined && payload.iat < Math.floor(o.sessionsFrom.getTime() / 1000)) || (o.lockedUntil && o.lockedUntil > new Date())) {
    res.status(401).json({ error: 'Your owner session has ended. Sign in again.' })
    return
  }
  req.owner = { id: o.id, name: o.name, email: o.email }
  next()
}
