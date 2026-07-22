import type { Request, Response, NextFunction } from 'express'
import type { Role } from '@prisma/client'
import { verifyToken } from '../lib/auth'
import { prisma } from '../lib/prisma'

export interface AuthUser {
  id: string
  role: Role
}

export interface AuthedRequest extends Request {
  user?: AuthUser
}

/** Token from the httpOnly cookie or an `Authorization: Bearer` header. */
function extractToken(req: Request): string | null {
  const cookieToken = (req as Request & { cookies?: Record<string, string> }).cookies?.token
  if (cookieToken) return cookieToken
  const header = req.headers.authorization
  if (header?.startsWith('Bearer ')) return header.slice(7)
  return null
}

/**
 * Verifies the session and attaches req.user; 401 otherwise. Beyond checking the
 * JWT signature/expiry, it re-loads the account each request so that disabling,
 * suspending, or resetting a user's password revokes their existing tokens
 * immediately (see User.sessionsValidFrom) — a stolen or stale cookie can't
 * outlive the account change. The role is taken fresh from the DB, so a role
 * change also takes effect at once.
 */
export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const token = extractToken(req)
  if (!token) {
    res.status(401).json({ error: 'Not authenticated' })
    return
  }
  let payload
  try {
    payload = verifyToken(token)
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' })
    return
  }
  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, isActive: true, status: true, sessionsValidFrom: true },
    })
    if (!user || !user.isActive || user.status !== 'ACTIVE') {
      res.status(401).json({ error: 'Session is no longer valid' })
      return
    }
    // Tokens issued before the account's revocation point are dead. iat is in
    // seconds; compare at second granularity so a login isn't tripped by sub-second skew.
    if (user.sessionsValidFrom && payload.iat !== undefined && payload.iat < Math.floor(user.sessionsValidFrom.getTime() / 1000)) {
      res.status(401).json({ error: 'Session is no longer valid' })
      return
    }
    req.user = { id: user.id, role: user.role }
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' })
  }
}

/** RBAC guard — allow only the given roles. Use after requireAuth. */
export function requireRole(...roles: Role[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }
    next()
  }
}
