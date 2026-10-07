/**
 * In-memory presence + typing state for chat.
 *
 * PulseTrack runs as a single Node process under PM2, so a process-local map is
 * enough: every chat poll marks the caller as seen, and "typing" pings expire on
 * their own after a few seconds. If the API is ever scaled to several processes,
 * move this to Postgres or Redis (nothing else depends on its shape).
 */

const ONLINE_MS = 60_000
const AWAY_MS = 5 * 60_000
const TYPING_MS = 6_000

const lastSeen = new Map<string, number>()
const typing = new Map<string, Map<string, number>>() // conversationId → userId → expiresAt

export function touch(userId: string, now = Date.now()): void {
  lastSeen.set(userId, now)
}

export type PresenceStatus = 'online' | 'away' | 'offline'

export function presenceOf(userId: string, now = Date.now()): PresenceStatus {
  const t = lastSeen.get(userId)
  if (!t) return 'offline'
  if (now - t < ONLINE_MS) return 'online'
  if (now - t < AWAY_MS) return 'away'
  return 'offline'
}

export function setTyping(conversationId: string, userId: string, isTyping: boolean, now = Date.now()): void {
  let m = typing.get(conversationId)
  if (!m) {
    m = new Map()
    typing.set(conversationId, m)
  }
  if (isTyping) m.set(userId, now + TYPING_MS)
  else m.delete(userId)
}

export function typingIn(conversationId: string, exceptUserId: string, now = Date.now()): string[] {
  const m = typing.get(conversationId)
  if (!m) return []
  const out: string[] = []
  for (const [uid, exp] of m) {
    if (exp < now) m.delete(uid)
    else if (uid !== exceptUserId) out.push(uid)
  }
  return out
}

/** Test helper. */
export function resetPresence(): void {
  lastSeen.clear()
  typing.clear()
}
