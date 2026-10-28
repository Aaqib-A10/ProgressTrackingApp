import type { Request, Response, NextFunction } from 'express'
import type { Role } from '@prisma/client'
import { verifyToken } from '../lib/auth'
import { prisma } from '../lib/prisma'
import { runAsCompany } from '../lib/tenancy'
import { areaOf } from '../lib/permissions'
import { companyAreasOff } from '../lib/plans'
import { billingState, readOnlyReason } from '../lib/billing/billing'

/** Open after a free trial ends: signing out, billing, and sending a complaint. */
const TRIAL_OPEN = /^\/api\/(auth\/|billing|support)/

/** Closed to a help sign-in: money, passwords, keys and the people's powers. */
const SUPPORT_CLOSED = /^\/api\/(financials|claude|company\/people|auth\/(change-password|password))/

export interface AuthUser {
  id: string
  role: Role
  /** The person's company (or personal workspace). */
  companyId: string
  /** Help sign-in: the owner (Metriq support) signed in as this person. */
  supportBy?: string
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
  let timeZone: string | undefined
  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true, role: true, companyId: true, isActive: true, status: true, sessionsValidFrom: true,
        company: { select: { id: true, status: true, timeZone: true, plan: true, modulesOff: true, modulesOn: true, supportAccessUntil: true, trialEndsAt: true, subscription: { select: { status: true, currentPeriodEnd: true, pastDueSince: true, cancelAtPeriodEnd: true } } } },
        customRole: { select: { areasOff: true } },
      },
    })
    // A suspended company (owner console) signs all its people out.
    if (!user || !user.isActive || user.status !== 'ACTIVE' || user.company?.status === 'SUSPENDED') {
      res.status(401).json({ error: 'Session is no longer valid' })
      return
    }
    // Tokens issued before the account's revocation point are dead. iat is in
    // seconds; compare at second granularity so a login isn't tripped by sub-second skew.
    if (user.sessionsValidFrom && payload.iat !== undefined && payload.iat < Math.floor(user.sessionsValidFrom.getTime() / 1000)) {
      res.status(401).json({ error: 'Session is no longer valid' })
      return
    }
    // Help sign-in only while the company still allows it, and never for money or passwords.
    if (payload.support) {
      if (!user.company.supportAccessUntil || user.company.supportAccessUntil < new Date()) {
        res.status(401).json({ error: 'Help sign-in has ended' })
        return
      }
      if (SUPPORT_CLOSED.test(req.originalUrl)) {
        res.status(403).json({ error: 'Metriq support cannot open this part.' })
        return
      }
    }
    // A free trial that ended, a payment that has failed for a week, or a plan that ended
    // (Phase 1, steps 7 and 8): everything can still be looked at, and Billing opens, but
    // nothing new is saved until it is paid.
    if (req.method !== 'GET' && !TRIAL_OPEN.test(req.originalUrl)) {
      const state = billingState(user.company, user.company.subscription)
      const why = readOnlyReason(state)
      if (why) {
        res.status(402).json({ error: why, trialEnded: state === 'trial_ended', billing: state })
        return
      }
    }
    // Parts of Metriq can be switched off for the company (its plan, or the owner; Phase 1,
    // step 6) or for a company role (step 4).
    const companyOff = companyAreasOff(user.company)
    const roleOff = user.customRole?.areasOff ?? []
    const area = companyOff.length || roleOff.length ? areaOf(req.originalUrl, 'api') : null
    if (area && companyOff.includes(area)) {
      res.status(403).json({ error: 'This part of Metriq is not in your company\'s plan.' })
      return
    }
    if (area && roleOff.includes(area)) {
      res.status(403).json({ error: 'This part of Metriq is switched off for your role.' })
      return
    }
    req.user = { id: user.id, role: user.role, companyId: user.companyId, ...(payload.support ? { supportBy: payload.support } : {}) }
    timeZone = user.company.timeZone
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' })
    return
  }
  // Company walls: everything this request reads or writes is limited to the person's company.
  void runAsCompany(req.user.companyId, next, timeZone)
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
