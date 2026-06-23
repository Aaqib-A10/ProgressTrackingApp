import bcrypt from 'bcryptjs'
import jwt, { type SignOptions } from 'jsonwebtoken'
import type { Role } from '@prisma/client'

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me'
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d'
const RESET_EXPIRES_IN = '30m'

// --- Passwords ---
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10)
}
export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

// --- Session JWT ---
export interface JwtPayload {
  sub: string
  role: Role
}

export function signToken(payload: JwtPayload): string {
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
