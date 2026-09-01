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
}

export function signToken(payload: { sub: string; role: Role }): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as SignOptions)
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload
}

// --- Stateless password-reset token (no DB table needed) ---
export function signResetToken(userId: string): string {
  return jwt.sign({ sub: userId, kind: 'reset' }, JWT_SECRET, { expiresIn: RESET_EXPIRES_IN })
}

export function verifyResetToken(token: string): string {
  const payload = jwt.verify(token, JWT_SECRET) as { sub: string; kind?: string }
  if (payload.kind !== 'reset') throw new Error('Not a reset token')
  return payload.sub
}

/** Longer-lived "set your password & join" token for invite emails (7 days). */
export function signInviteToken(userId: string): string {
  return jwt.sign({ sub: userId, kind: 'reset' }, JWT_SECRET, { expiresIn: '7d' })
}
