import type { Response, NextFunction } from 'express'
import { prisma } from './prisma'
import type { AuthedRequest } from '../middleware/auth'

/**
 * The financial system is restricted to specific people (Aqib), not merely to the
 * SUPER_ADMIN role — so even another Super Admin cannot see cost/revenue/salary data.
 * The allowlist is configurable via FINANCE_ALLOWED_EMAILS (comma-separated); it
 * defaults to Aqib's account.
 */
export const FINANCE_EMAILS = (process.env.FINANCE_ALLOWED_EMAILS ?? 'aqibalishehzad3@gmail.com')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)

/** Express guard: allow only allowlisted identities. Use after requireAuth. */
export async function requireFinanceAccess(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const u = req.user ? await prisma.user.findUnique({ where: { id: req.user.id }, select: { email: true } }) : null
  if (u && FINANCE_EMAILS.includes(u.email.toLowerCase())) {
    next()
    return
  }
  res.status(403).json({ error: 'Financial reports are restricted.' })
}
