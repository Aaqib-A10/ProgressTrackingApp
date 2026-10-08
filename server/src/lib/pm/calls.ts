import { prisma } from '../prisma'
import { pmNotify } from './pmNotify'

/**
 * Voice/video calls. Audio and video go browser to browser (WebRTC mesh, up to
 * MAX_PARTICIPANTS); the server only introduces people to each other by relaying
 * small "signal" messages (offer / answer / network candidates) over normal HTTP
 * polling, so nothing extra is needed on the network or in Nginx.
 *
 * Live call state is kept in memory (one PM2 process, same as presence/typing).
 * Each call is also stored in ChatCall so the chat shows "started a call" /
 * "Call ended · 12 min" history.
 */

export const MAX_PARTICIPANTS = 6
const STALE_MS = 20_000 // a participant who stops polling for this long is dropped
const RING_MS = 60_000 // how long people who haven't joined see the incoming call

export type SignalKind = 'offer' | 'answer' | 'ice' | 'bye' | 'state'

export interface Signal { id: number; from: string; kind: SignalKind; data: unknown }

export interface Participant {
  userId: string
  name: string
  joinedAt: number
  lastSeen: number
  mic: boolean
  cam: boolean
  screen: boolean
}

export interface LiveCall {
  callId: string
  conversationId: string
  video: boolean
  startedById: string
  startedByName: string
  startedAt: number
  /** One-to-one call (missed-call alerts are only sent for these). */
  isDirect: boolean
  participants: Map<string, Participant>
  inbox: Map<string, Signal[]>
  joinedIds: Set<string>
  /** People who declined the ring (they stop seeing the banner). */
  declined: Set<string>
}

const live = new Map<string, LiveCall>()
let signalSeq = 0

export function getLive(callId: string): LiveCall | undefined {
  return live.get(callId)
}

export function liveForConversation(conversationId: string): LiveCall | undefined {
  for (const c of live.values()) if (c.conversationId === conversationId) return c
  return undefined
}

export function allLive(): LiveCall[] {
  return [...live.values()]
}

export function registerLive(c: Omit<LiveCall, 'participants' | 'inbox' | 'joinedIds' | 'declined'>): LiveCall {
  const call: LiveCall = { ...c, participants: new Map(), inbox: new Map(), joinedIds: new Set(), declined: new Set() }
  live.set(c.callId, call)
  return call
}

export function participantList(call: LiveCall) {
  return [...call.participants.values()].map((p) => ({ userId: p.userId, name: p.name, mic: p.mic, cam: p.cam, screen: p.screen, joinedAt: new Date(p.joinedAt).toISOString() }))
}

export function push(call: LiveCall, to: string, from: string, kind: SignalKind, data: unknown): void {
  const box = call.inbox.get(to)
  if (!box) return
  box.push({ id: ++signalSeq, from, kind, data })
  if (box.length > 500) box.splice(0, box.length - 500) // never grow without bound
}

export function join(call: LiveCall, userId: string, name: string, media: { mic: boolean; cam: boolean }): void {
  const now = Date.now()
  const existing = call.participants.get(userId)
  if (existing) {
    // Rejoin (e.g. page refresh): tell the others to drop the old connection first.
    for (const other of call.participants.keys()) if (other !== userId) push(call, other, userId, 'bye', null)
  }
  call.participants.set(userId, { userId, name, joinedAt: now, lastSeen: now, mic: media.mic, cam: media.cam, screen: false })
  call.inbox.set(userId, [])
  call.joinedIds.add(userId)
}

export function leave(call: LiveCall, userId: string): void {
  if (!call.participants.delete(userId)) return
  call.inbox.delete(userId)
  for (const other of call.participants.keys()) push(call, other, userId, 'bye', null)
}

export function decline(call: LiveCall, userId: string): void {
  call.declined.add(userId)
}

export function isRinging(call: LiveCall, userId: string, now = Date.now()): boolean {
  return !call.joinedIds.has(userId) && !call.declined.has(userId) && call.participants.size > 0 && now - call.startedAt < RING_MS
}

/** Mark a call ended in the database and forget it. */
export async function endCall(call: LiveCall): Promise<void> {
  if (!live.delete(call.callId)) return
  await prisma.chatCall.update({ where: { id: call.callId }, data: { endedAt: new Date(), joinedIds: [...call.joinedIds] } }).catch(() => undefined)
  if (!call.isDirect) return
  // Leave a "missed call" alert for the person who never picked up (not if they pressed Decline).
  const members = await prisma.chatMember.findMany({ where: { conversationId: call.conversationId }, select: { userId: true } }).catch(() => [])
  const missed = members.map((m) => m.userId).filter((id) => !call.joinedIds.has(id) && !call.declined.has(id))
  if (missed.length) {
    await pmNotify({
      userIds: missed,
      actorId: call.startedById,
      type: 'CHAT_MESSAGE',
      title: `Missed ${call.video ? 'video' : 'voice'} call from ${call.startedByName}`,
      body: 'Open the chat to call back.',
      link: `/app/chat?c=${encodeURIComponent(call.conversationId)}`,
    })
  }
}

/** Drop people who stopped polling; end calls that are empty. */
export async function sweep(now = Date.now()): Promise<void> {
  for (const call of [...live.values()]) {
    for (const p of [...call.participants.values()]) if (now - p.lastSeen > STALE_MS) leave(call, p.userId)
    // Give the starter a moment to connect before an empty call is ended.
    if (call.participants.size === 0 && now - call.startedAt > 15_000) await endCall(call)
  }
}

let timer: NodeJS.Timeout | undefined
export function startCallSweeper(): void {
  if (timer) return
  // Live state is in memory, so any call still "open" in the DB from before a restart is over.
  void prisma.chatCall.updateMany({ where: { endedAt: null }, data: { endedAt: new Date() } }).catch(() => undefined)
  timer = setInterval(() => { void sweep() }, 5000)
  timer.unref?.()
}

/** Test helper. */
export function resetCalls(): void {
  live.clear()
}

// ---------- ICE servers (how browsers find a path to each other) ----------

let turnCache: { at: number; servers: RTCIceServerLike[] } | null = null
export interface RTCIceServerLike { urls: string | string[]; username?: string; credential?: string }

const STUN: RTCIceServerLike[] = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }]

/**
 * STUN always; TURN relay from Cloudflare when CF_TURN_KEY_ID + CF_TURN_API_TOKEN are set
 * (Cloudflare dashboard > Realtime > TURN). TURN lets calls connect even on strict networks.
 */
export async function iceServers(): Promise<RTCIceServerLike[]> {
  const keyId = process.env.CF_TURN_KEY_ID
  const token = process.env.CF_TURN_API_TOKEN
  if (!keyId || !token) return STUN
  if (turnCache && Date.now() - turnCache.at < 6 * 3600_000) return turnCache.servers
  try {
    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 86400 }),
    })
    if (!r.ok) throw new Error(`TURN ${r.status}`)
    const j = (await r.json()) as { iceServers?: RTCIceServerLike | RTCIceServerLike[] }
    const turn = Array.isArray(j.iceServers) ? j.iceServers : j.iceServers ? [j.iceServers] : []
    const servers = [...STUN, ...turn]
    turnCache = { at: Date.now(), servers }
    return servers
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[calls] could not get TURN credentials, using STUN only:', (e as Error).message)
    return STUN
  }
}
