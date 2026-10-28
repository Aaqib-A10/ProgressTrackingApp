import type { Response, NextFunction } from 'express'
import type { AuthedRequest } from '../middleware/auth'
import { hasPower } from './permissions'

/**
 * The financial system is for people with the finance power (Phase 1, step 4), not merely for
 * the Super Admin role, so another Super Admin cannot see cost, revenue or salary data.
 * 99 Technologies' finance people (FINANCE_ALLOWED_EMAILS, Aqib by default) have it as before.
 */
export async function requireFinanceAccess(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  if (req.user && (await hasPower(req.user.id, 'finance'))) {
    next()
    return
  }
  res.status(403).json({ error: 'Financial reports are restricted.' })
}
