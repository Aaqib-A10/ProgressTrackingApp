import { api } from './api'

/**
 * Pop-up notifications that work even when PulseTrack is closed (Web Push).
 * The background worker (/sw.js) shows them; this file turns them on or off for this
 * browser and keeps the server's copy of the subscription fresh.
 */

export type PushState = 'unsupported' | 'ios-install' | 'denied' | 'off' | 'on'

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext
}

/** iPhone / iPad: pop-ups only work once PulseTrack is added to the Home Screen. */
export function needsIosInstall(): boolean {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true
  return ios && !standalone
}

let reg: Promise<ServiceWorkerRegistration | null> | null = null

/** Register the background worker once (quietly does nothing where unsupported). */
export function registerWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!reg) {
    reg = 'serviceWorker' in navigator && window.isSecureContext
      ? navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => null)
      : Promise.resolve(null)
  }
  return reg
}

export async function pushState(): Promise<PushState> {
  if (needsIosInstall()) return 'ios-install'
  if (!pushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const r = await registerWorker()
  const sub = await r?.pushManager.getSubscription().catch(() => null)
  return sub && Notification.permission === 'granted' ? 'on' : 'off'
}

function keyBytes(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

/** Ask the browser (must come from a click) and subscribe. */
export async function enablePush(): Promise<PushState> {
  if (needsIosInstall()) return 'ios-install'
  if (!pushSupported()) return 'unsupported'
  const perm = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off'
  const r = await registerWorker()
  if (!r) return 'unsupported'
  await navigator.serviceWorker.ready
  const { publicKey } = await api.get<{ publicKey: string }>('/push/key')
  let sub = await r.pushManager.getSubscription()
  // Subscribed with an older server key: start again with the current one.
  const cur = sub?.options.applicationServerKey
  if (sub && cur && btoa(String.fromCharCode(...new Uint8Array(cur))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== publicKey.replace(/=+$/, '')) {
    await sub.unsubscribe().catch(() => undefined)
    sub = null
  }
  if (!sub) sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource })
  await api.post('/push/subscribe', sub.toJSON() as unknown as Record<string, unknown>)
  return 'on'
}

export async function disablePush(): Promise<void> {
  const r = await registerWorker()
  const sub = await r?.pushManager.getSubscription().catch(() => null)
  if (!sub) return
  await api.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => undefined)
  await sub.unsubscribe().catch(() => undefined)
}

/** On every app start: if pop-ups are on here, make sure the server still has them for me. */
export async function syncPush(): Promise<void> {
  try {
    if (!pushSupported() || Notification.permission !== 'granted') return
    await enablePush()
  } catch { /* offline; next start */ }
}

export function testPush(): Promise<{ devices: number; sent: number }> {
  return api.post('/push/test', {})
}
