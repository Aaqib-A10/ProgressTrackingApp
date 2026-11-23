import { flagOn } from './flags'

/**
 * Live updates: one quiet connection per tab to GET /api/live. The server sends a nudge ("poke") the moment a
 * notification or a chat message is saved for this person, and the parts of the app that used to wait for their next
 * poll read at once. If the connection cannot be held (an old proxy, the phone app's own sign-in, the switch is off)
 * nothing breaks: polling carries on exactly as before.
 */

export interface LivePoke { topic: 'notifications' | 'chat'; conversationId?: string }
export const LIVE_EVENT = 'pt:live'

let source: EventSource | null = null
let lastHeard = 0

/** Is the line open and heard from in the last 40 seconds (the server sends a beat every 25)? */
export const liveConnected = (): boolean => !!source && source.readyState === 1 && Date.now() - lastHeard < 40_000

export function startLive(): void {
  if (source || typeof EventSource === 'undefined' || !flagOn('live-updates')) return
  try {
    const es = new EventSource('/api/live', { withCredentials: true })
    source = es
    const heard = () => { lastHeard = Date.now() }
    es.addEventListener('hello', heard)
    es.addEventListener('beat', heard)
    es.addEventListener('poke', (e) => {
      heard()
      try { window.dispatchEvent(new CustomEvent<LivePoke>(LIVE_EVENT, { detail: JSON.parse((e as MessageEvent<string>).data) as LivePoke })) } catch { /* a line we do not understand */ }
    })
    // The browser reconnects by itself after an error; a server that answers "not for you" (204, 401) closes it for good.
    es.onerror = () => { if (es.readyState === 2) { source = null } }
  } catch { source = null }
}

export function stopLive(): void {
  source?.close()
  source = null
  lastHeard = 0
}

/** Run `fn` when a poke that fits arrives. Returns the function that stops listening. */
export function onLive(fits: (p: LivePoke) => boolean, fn: () => void): () => void {
  const h = (e: Event) => { const d = (e as CustomEvent<LivePoke>).detail; if (d && fits(d)) fn() }
  window.addEventListener(LIVE_EVENT, h)
  return () => window.removeEventListener(LIVE_EVENT, h)
}
