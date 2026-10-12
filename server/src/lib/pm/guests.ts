import { randomBytes } from 'node:crypto'
import jwt from 'jsonwebtoken'
import type { Request, Response } from 'express'

/**
 * People outside Metriq joining a call by link.
 *
 * A chat (group, project channel, meeting chat) can have a guest link. Someone with the
 * link types their name and asks to join; they wait until a person in the call lets them
 * in. Their browser then holds a short-lived "guest pass" (an httpOnly cookie) that only
 * works for the calls of that one chat, and only for taking part in the call itself
 * (no chat, no files, no notes, nothing else in PulseTrack).
 */

export const GUEST_COOKIE = 'pt_guest'
const PASS_HOURS = 8

const secret = (): string => {
  const s = process.env.JWT_SECRET
  if (s) return s
  if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET is required')
  return 'dev-secret-change-me'
}

export interface GuestPass { gid: string; name: string; conv: string }

export function newGuestToken(): string {
  return randomBytes(18).toString('base64url')
}

export function newGuestId(): string {
  return `guest-${randomBytes(8).toString('hex')}`
}

export function setGuestPass(res: Response, pass: GuestPass): void {
  const token = jwt.sign({ kind: 'guest', ...pass }, secret(), { expiresIn: `${PASS_HOURS}h` })
  res.cookie(GUEST_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: PASS_HOURS * 3600_000, path: '/api' })
}

export function readGuestPass(req: Request): GuestPass | null {
  const raw = (req as Request & { cookies?: Record<string, string> }).cookies?.[GUEST_COOKIE]
  if (!raw) return null
  try {
    const p = jwt.verify(raw, secret(), { algorithms: ['HS256'] }) as Partial<GuestPass> & { kind?: string }
    if (p.kind !== 'guest' || !p.gid?.startsWith('guest-') || !p.conv || !p.name) return null
    return { gid: p.gid, name: p.name, conv: p.conv }
  } catch {
    return null
  }
}

/** Calls endpoints a guest may use: joining, the connection itself, mic/camera state, reactions, leaving. */
export const GUEST_CALL_PATH = /^\/calls\/[^/]+\/(join|signal|poll|state|leave|react)$/
