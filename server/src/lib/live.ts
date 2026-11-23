import type { Response } from 'express'
import { prisma, onNotificationSaved, onRecordChanged } from './prisma'
import { isOn } from './flags'

/**
 * Live updates (plan 2026-11, stage 4): an open tab keeps one quiet connection to the server (GET /api/live, server
 * sent events), and the server says "something new" the moment a notification or a chat message is saved for that
 * person. The tab then reads it at once through the same requests it always used; nothing new travels on this line
 * but the nudge itself, so no record can leak through it. Tabs that cannot hold the connection keep polling as before.
 *
 * One server process holds the connections in memory (as chat presence does). With more than one process this needs
 * a shared channel between them; until then a nudge reaches every tab because there is one process.
 */

export type LiveTopic = 'notifications' | 'chat'
export interface LiveEvent { topic: LiveTopic; conversationId?: string }

/** What a connection needs: write a piece, and know when it is closed (an Express response, or a stand-in in tests). */
export interface LiveSink { write: (chunk: string) => unknown; end?: () => unknown }

const clients = new Map<string, Set<LiveSink>>()
/** At most this many open tabs per person hold a connection; the oldest is closed for a newer one. */
export const MAX_PER_PERSON = 6

export function addClient(userId: string, sink: LiveSink): () => void {
  const set = clients.get(userId) ?? new Set<LiveSink>()
  clients.set(userId, set)
  if (set.size >= MAX_PER_PERSON) {
    const oldest = set.values().next().value as LiveSink
    set.delete(oldest)
    try { oldest.end?.() } catch { /* already gone */ }
  }
  set.add(sink)
  return () => {
    set.delete(sink)
    if (!set.size) clients.delete(userId)
  }
}

/** Tell these people's open tabs that something changed. Returns how many connections heard it. */
export function poke(userIds: Iterable<string>, event: LiveEvent): number {
  const line = `event: poke\ndata: ${JSON.stringify(event)}\n\n`
  let n = 0
  for (const id of new Set(userIds)) {
    for (const sink of clients.get(id) ?? []) {
      try { sink.write(line); n++ } catch { /* a closed tab: its close handler removes it */ }
    }
  }
  return n
}

export const liveStats = () => ({ people: clients.size, connections: [...clients.values()].reduce((s, x) => s + x.size, 0) })

/** GET /api/live: hold the connection open for this person (behind the company's "live-updates" switch). */
export async function openLive(user: { id: string; companyId: string }, res: Response, onClose: (fn: () => void) => void, wantsStream = true): Promise<void> {
  // Only a browser's EventSource (it asks for text/event-stream) holds the line. Anything else that reads this address
  // (the hourly self check calls every read route) is answered at once, or it would wait for ever.
  if (!wantsStream || !(await isOn('live-updates', user.companyId))) { res.status(204).end(); return }
  res.status(200)
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('X-Accel-Buffering', 'no') // Nginx: pass each piece on at once
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()
  res.write('retry: 5000\nevent: hello\ndata: {}\n\n')
  const remove = addClient(user.id, res)
  // A line every 25 seconds keeps proxies from closing a quiet connection, and tells the tab the line is alive.
  const beat = setInterval(() => { try { res.write('event: beat\ndata: {}\n\n') } catch { /* closed */ } }, 25_000)
  onClose(() => { clearInterval(beat); remove() })
}

let started = false
/** Hook the saves that people wait for. Called once on boot. */
export function startLive(): void {
  if (started) return
  started = true
  onNotificationSaved((rows) => { poke(rows.map((r) => r.userId).filter(Boolean), { topic: 'notifications' }) }, 'live')
  onRecordChanged((c) => {
    if (c.model !== 'ChatMessage' || c.operation !== 'create') return
    const conversationId = (c.result as { conversationId?: string } | null)?.conversationId
    if (!conversationId) return
    // Who is in the chat: read after the save, never holding it up.
    void prisma.chatMember.findMany({ where: { conversationId }, select: { userId: true } })
      .then((members) => { poke(members.map((m) => m.userId), { topic: 'chat', conversationId }) })
      .catch(() => undefined)
  }, 'live')
}
