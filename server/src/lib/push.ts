import webpush from 'web-push'
import { prisma } from './prisma'

/**
 * Pop-up notifications that reach people even when PulseTrack is closed (Web Push):
 * new messages, incoming calls and missed calls. The browser keeps a "subscription"
 * per device; we send to every device the person turned it on for.
 *
 * The server key pair is made once by itself and kept in the database (AppSecret), so
 * there is nothing to set up. VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in .env win if set.
 */

export interface PushPayload {
  kind: 'msg' | 'call' | 'missed' | 'test'
  title: string
  body: string
  /** Same tag replaces the earlier pop-up (one per chat, one per call). */
  tag: string
  /** In-app address to open on click. */
  url: string
  callId?: string
  conversationId?: string
  video?: boolean
  /** Keep on screen until clicked (ringing calls). */
  sticky?: boolean
}

let keys: Promise<{ publicKey: string; privateKey: string }> | null = null

async function loadKeys(): Promise<{ publicKey: string; privateKey: string }> {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY }
  const row = await prisma.appSecret.findUnique({ where: { name: 'vapid' } })
  if (row) return JSON.parse(row.value) as { publicKey: string; privateKey: string }
  const made = webpush.generateVAPIDKeys()
  // Two server starts at once: keep whichever was saved first.
  await prisma.appSecret.createMany({ data: [{ name: 'vapid', value: JSON.stringify(made) }], skipDuplicates: true })
  const saved = await prisma.appSecret.findUniqueOrThrow({ where: { name: 'vapid' } })
  return JSON.parse(saved.value) as { publicKey: string; privateKey: string }
}

export function vapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  if (!keys) {
    keys = loadKeys()
    keys.catch(() => { keys = null })
  }
  return keys
}

/** Someone looking at PulseTrack right now (a tab in front, polling) gets the in-app ring
 *  and messages instead. A tab in the background does not count: the pop-up is still sent,
 *  and the same tag means the browser shows it once. */
const ACTIVE_MS = 15_000
const lastPoll = new Map<string, number>()
export function markActive(userId: string, now = Date.now()): void {
  lastPoll.set(userId, now)
}
function isActive(userId: string, now = Date.now()): boolean {
  return now - (lastPoll.get(userId) ?? 0) < ACTIVE_MS
}

/** Send to every device of these people. Never throws; dead subscriptions are removed. */
export async function sendPush(userIds: string[], payload: PushPayload, opts: { ttl?: number; urgency?: 'normal' | 'high'; evenIfActive?: boolean } = {}): Promise<number> {
  if (process.env.NODE_ENV === 'test' && !process.env.PUSH_IN_TESTS) return 0
  const now = Date.now()
  const ids = [...new Set(userIds)].filter((id) => opts.evenIfActive || !isActive(id, now))
  if (!ids.length) return 0
  try {
    const subs = await prisma.pushSubscription.findMany({ where: { userId: { in: ids } } })
    if (!subs.length) return 0
    const k = await vapidKeys()
    const subject = (process.env.APP_URL || '').startsWith('https://') ? process.env.APP_URL! : 'mailto:admin@pulsetrack.online'
    const body = JSON.stringify(payload)
    let sent = 0
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
          TTL: opts.ttl ?? 60 * 60,
          urgency: opts.urgency ?? 'normal',
          topic: payload.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || undefined,
          vapidDetails: { subject, publicKey: k.publicKey, privateKey: k.privateKey },
          timeout: 10_000,
        })
        sent++
        void prisma.pushSubscription.update({ where: { id: s.id }, data: { lastOkAt: new Date() } }).catch(() => undefined)
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode
        // 404 / 410: the browser dropped this subscription (signed out, cleared data, uninstalled).
        if (code === 404 || code === 410) await prisma.pushSubscription.deleteMany({ where: { id: s.id } }).catch(() => undefined)
        else console.warn('[push] send failed', code ?? (e as Error).message)
      }
    }))
    return sent
  } catch (e) {
    console.warn('[push] failed', (e as Error).message)
    return 0
  }
}

/** A new chat message: everyone else in the chat who has not muted it (an @mention gets through a mute). */
export async function pushChatMessage(input: { conversationId: string; senderId: string; senderName: string; text: string; mentions: string[] }): Promise<void> {
  const conv = await prisma.chatConversation.findUnique({
    where: { id: input.conversationId },
    select: { type: true, name: true, members: { select: { userId: true, mutedUntil: true } } },
  })
  if (!conv) return
  const now = new Date()
  const to = conv.members
    .filter((m) => m.userId !== input.senderId)
    .filter((m) => !(m.mutedUntil && m.mutedUntil > now) || input.mentions.includes(m.userId))
    .map((m) => m.userId)
  if (!to.length) return
  const text = input.text.length > 140 ? `${input.text.slice(0, 139)}…` : input.text
  const isDirect = conv.type === 'DIRECT'
  await sendPush(to, {
    kind: 'msg',
    title: isDirect ? input.senderName : conv.name ?? 'Group chat',
    body: isDirect ? text : `${input.senderName}: ${text}`,
    tag: `chat-${input.conversationId}`,
    url: `/app/chat?c=${encodeURIComponent(input.conversationId)}`,
    conversationId: input.conversationId,
  })
}

/** Incoming call: ring the people who are not in it yet. */
export async function pushRing(input: { callId: string; conversationId: string; video: boolean; callerId: string; callerName: string; userIds: string[]; isDirect: boolean; title: string | null }): Promise<void> {
  const to = input.userIds.filter((id) => id !== input.callerId)
  if (!to.length) return
  const kind = input.video ? 'video' : 'voice'
  await sendPush(to, {
    kind: 'call',
    title: input.isDirect ? `${input.callerName} is calling you` : `${input.video ? 'Video' : 'Voice'} call in ${input.title ?? 'a group'}`,
    body: input.isDirect ? `Incoming ${kind} call` : `${input.callerName} started a ${kind} call. Tap to join.`,
    tag: `call-${input.callId}`,
    url: `/app/chat?c=${encodeURIComponent(input.conversationId)}&answer=${encodeURIComponent(input.callId)}`,
    callId: input.callId,
    conversationId: input.conversationId,
    video: input.video,
    sticky: input.isDirect,
  }, { ttl: 45, urgency: 'high' })
}

/** Missed one-to-one call: replaces the ringing pop-up. */
export async function pushMissed(input: { callId: string; conversationId: string; video: boolean; callerName: string; userIds: string[] }): Promise<void> {
  await sendPush(input.userIds, {
    kind: 'missed',
    title: `Missed ${input.video ? 'video' : 'voice'} call`,
    body: `${input.callerName} tried to call you. Tap to call back.`,
    tag: `call-${input.callId}`,
    url: `/app/chat?c=${encodeURIComponent(input.conversationId)}`,
    conversationId: input.conversationId,
  }, { ttl: 24 * 3600, evenIfActive: false })
}
