/* PulseTrack background worker: shows pop-up notifications (messages, incoming calls,
 * missed calls) even when no PulseTrack tab is open, and opens the right place on click.
 * It does not cache pages, so it never serves an old version of the app. */

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

/** Is a PulseTrack tab in front right now? (then the page shows its own ring / message) */
async function focusedClient() {
  const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  return list.find((c) => c.focused && c.visibilityState === 'visible') || null
}

self.addEventListener('push', (event) => {
  let p = {}
  try { p = event.data ? event.data.json() : {} } catch { p = { title: 'PulseTrack', body: event.data ? event.data.text() : '' } }
  event.waitUntil((async () => {
    const front = await focusedClient()
    // Looking at PulseTrack already: a message needs no pop-up (the app shows it).
    if (front && p.kind === 'msg') {
      front.postMessage({ type: 'pt-push', payload: p })
      return
    }
    const isCall = p.kind === 'call'
    const options = {
      body: p.body || '',
      tag: p.tag || undefined,
      renotify: true,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      requireInteraction: !!p.sticky,
      vibrate: isCall ? [400, 200, 400, 200, 400, 200, 400] : [120, 60, 120],
      timestamp: Date.now(),
      data: { url: p.url || '/app', kind: p.kind, callId: p.callId, conversationId: p.conversationId },
      actions: isCall
        ? [{ action: 'answer', title: p.video ? 'Answer (video)' : 'Answer' }, { action: 'decline', title: 'Decline' }]
        : p.kind === 'msg'
          ? [{ action: 'open', title: 'Open chat' }]
          : p.kind === 'missed'
            ? [{ action: 'open', title: 'Call back' }]
            : [],
    }
    await self.registration.showNotification(p.title || 'PulseTrack', options)
  })())
})

self.addEventListener('notificationclick', (event) => {
  const n = event.notification
  const d = n.data || {}
  n.close()
  event.waitUntil((async () => {
    if (event.action === 'decline' && d.callId) {
      await fetch(`/api/chat/calls/${encodeURIComponent(d.callId)}/decline`, { method: 'POST', credentials: 'include' }).catch(() => undefined)
      return
    }
    let url = d.url || '/app'
    // Clicking the call itself (not a button) also answers it.
    if (d.kind === 'call' && event.action !== 'answer' && !url.includes('answer=')) url += (url.includes('?') ? '&' : '?') + 'answer=' + encodeURIComponent(d.callId || '')
    const target = new URL(url, self.location.origin).href
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    // A PulseTrack tab is open: bring it forward and send it there (no reload).
    const tab = list.find((c) => c.url.startsWith(self.location.origin))
    if (tab) {
      await tab.focus().catch(() => undefined)
      tab.postMessage({ type: 'pt-open', url })
      return
    }
    await self.clients.openWindow(target)
  })())
})

// The browser renewed the subscription by itself: tell the server about the new one.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    try {
      const keyRes = await fetch('/api/push/key', { credentials: 'include' })
      if (!keyRes.ok) return
      const { publicKey } = await keyRes.json()
      const pad = '='.repeat((4 - (publicKey.length % 4)) % 4)
      const raw = atob((publicKey + pad).replace(/-/g, '+').replace(/_/g, '/'))
      const key = Uint8Array.from(raw, (c) => c.charCodeAt(0))
      const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
      await fetch('/api/push/subscribe', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub.toJSON()) })
    } catch { /* next app start re-subscribes */ }
  })())
})
