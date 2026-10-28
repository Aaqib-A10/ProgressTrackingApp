import bcrypt from 'bcryptjs'
import jwt, { type SignOptions } from 'jsonwebtoken'
import type { Role } from '@prisma/client'

// Fail CLOSED in production: a missing JWT_SECRET must never fall back to a
// public default (that would let anyone forge a Super-Admin token). The dev
// fallback is kept only for local/test convenience.
const JWT_SECRET = (() => {
  const s = process.env.JWT_SECRET
  if (s) return s
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable is required in production')
  }
  return 'dev-secret-change-me'
})()
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d'
const RESET_EXPIRES_IN = '30m'

// --- Passwords ---
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10)
}
export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

// Fixed bcrypt hash (of a throwaway string, not a secret) used to equalize login
// timing when the email doesn't exist — always run a real compare so response
// time can't reveal whether an account exists (user enumeration).
export const DUMMY_PASSWORD_HASH = bcrypt.hashSync('metriq-login-timing-guard', 10)

// --- Session JWT ---
export interface JwtPayload {
  sub: string
  role: Role
  /** issued-at, seconds since epoch — added by jwt.sign, read for session-revocation. */
  iat?: number
  exp?: number
  /** Help sign-in: the owner who is signed in as this person (see signSupportToken). */
  support?: string
}

export function signToken(payload: { sub: string; role: Role }): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as SignOptions)
}

/**
 * A two-minute session for one request the AI connectors make inside the server, as the person
 * who owns the key. It never leaves the server.
 */
export function signConnectorToken(payload: { sub: string; role: Role }): string {
  return jwt.sign({ ...payload, via: 'connector' }, JWT_SECRET, { expiresIn: 120 } as SignOptions)
}

export function verifyToken(token: string): JwtPayload {
  // Pin the algorithm so a token can't be verified under an unexpected alg.
  const p = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as JwtPayload & { kind?: string; aud?: unknown }
  // Only a session: never a password-reset link or an owner console token.
  if (p.kind || p.aud) throw new Error('Not a session')
  return p
}

/**
 * Help sign-in (Phase 1, step 6): Metriq support, with the company's consent, opens Metriq as
 * one of its people for at most an hour. The session says so (support = the owner's id), the
 * person's company sees it in its activity log, and a few things stay closed to it.
 */
export function signSupportToken(payload: { sub: string; role: Role; ownerId: string }, seconds: number): string {
  return jwt.sign({ sub: payload.sub, role: payload.role, support: payload.ownerId }, JWT_SECRET, { expiresIn: Math.max(60, Math.floor(seconds)) } as SignOptions)
}

// --- Stateless password-reset token (no DB table needed) ---
export function signResetToken(userId: string): string {
  return jwt.sign({ sub: userId, kind: 'reset' }, JWT_SECRET, { expiresIn: RESET_EXPIRES_IN })
}

export function verifyResetToken(token: string): string {
  const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as { sub: string; kind?: string }
  if (payload.kind !== 'reset') throw new Error('Not a reset token')
  return payload.sub
}

/** Longer-lived "set your password & join" token for invite emails (7 days). */
export function signInviteToken(userId: string): string {
  return jwt.sign({ sub: userId, kind: 'reset' }, JWT_SECRET, { expiresIn: '7d' })
}

// --- Owner console (erp): its own audience, so a company user's session can never open it and an
// owner session can never act as a company user (requireAuth also looks the user up by id).
export function signOwnerToken(ownerId: string, kind: 'owner' | 'owner-2fa', expiresIn: string | number): string {
  return jwt.sign({ sub: ownerId }, JWT_SECRET, { expiresIn, audience: kind, algorithm: 'HS256' } as SignOptions)
}
export function verifyOwnerToken(token: string, kind: 'owner' | 'owner-2fa'): { sub: string; iat?: number } {
  return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'], audience: kind }) as { sub: string; iat?: number }
}
