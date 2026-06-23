import type { Request, Response, NextFunction } from 'express'
import type { Role } from '@prisma/client'
import { verifyToken } from '../lib/auth'

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

/** Verifies the session and attaches req.user; 401 otherwise. */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const token = extractToken(req)
  if (!token) {
    res.status(401).json({ error: 'Not authenticated' })
    return
  }
  try {
    const payload = verifyToken(token)
    req.user = { id: payload.sub, role: payload.role }
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
