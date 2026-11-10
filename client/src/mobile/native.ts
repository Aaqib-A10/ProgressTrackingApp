/**
 * The Metriq phone app (mobile phase B). The app is a native shell that opens this same website,
 * so everything here is what the website does differently when it finds itself inside the app:
 * the phone's back button, native push notifications, and opening the right place when a
 * notification is tapped. In a browser none of this runs.
 *
 * The shell puts `window.Capacitor` on the page (its "bridge"). We talk to it directly, so the
 * website needs no extra packages and loads nothing more for people in a browser.
 */

interface Bridge {
  isNativePlatform?: () => boolean
  getPlatform?: () => string
  nativePromise?: <T>(plugin: string, method: string, options?: unknown) => Promise<T>
  addListener?: (plugin: string, event: string, cb: (data: unknown) => void) => { remove: () => Promise<void> }
}

const bridge = (): Bridge | null => (typeof window === 'undefined' ? null : ((window as unknown as { Capacitor?: Bridge }).Capacitor ?? null))
const ua = (): string => (typeof navigator === 'undefined' ? '' : navigator.userAgent)

/** Inside the Metriq phone app (not a browser, not the home-screen web app). */
export function isNativeApp(): boolean {
  return !!bridge()?.isNativePlatform?.() || /\bMetriqApp\//.test(ua())
}

export function nativePlatform(): 'android' | 'ios' | null {
  if (!isNativeApp()) return null
  const p = bridge()?.getPlatform?.()
  if (p === 'ios' || p === 'android') return p
  return /iPhone|iPad|iPod/.test(ua()) ? 'ios' : 'android'
}

/** This build of the app can receive push (it was built with the push service's settings file). */
export function nativePushBuilt(): boolean {
  return isNativeApp() && /\bMetriqApp\/[\d.]+ Push\b/.test(ua())
}

function call<T>(plugin: string, method: string, options?: unknown): Promise<T> {
  const b = bridge()
  if (!b?.nativePromise) return Promise.reject(new Error('Not in the Metriq app'))
  return b.nativePromise<T>(plugin, method, options)
}
function listen(plugin: string, event: string, cb: (data: unknown) => void): void {
  try { bridge()?.addListener?.(plugin, event, cb) } catch { /* an older shell without this plugin */ }
}

// ------------------------------------------------------------------ going to a place in the app

let navigator_: ((to: string) => void) | null = null
let waiting: string | null = null

/** Only Metriq's own in-app addresses are opened ("/app/…"), whatever a notification carries. */
function inAppPath(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null
  try {
    const u = new URL(raw, window.location.origin)
    if (u.origin !== window.location.origin) return null
    return u.pathname.startsWith('/') && !u.pathname.startsWith('//') ? `${u.pathname}${u.search}${u.hash}` : null
  } catch { return null }
}

function open(raw: unknown): void {
  const to = inAppPath(raw)
  if (!to) return
  if (navigator_) navigator_(to)
  else waiting = to // the app is still starting (opened by tapping a notification): the signed-in app takes it once it is up
}

/** The signed-in app tells us how to move between pages (react-router). */
export function setNativeNavigator(fn: ((to: string) => void) | null): void {
  navigator_ = fn
}

/**
 * A place that was asked for while the app was still starting (a notification tapped with the app
 * closed, or before sign-in). The signed-in app calls this once it has settled on its first page.
 */
export function takeWaitingPlace(): string | null {
  const to = waiting
  waiting = null
  return to
}

// ------------------------------------------------------------------ start (once per page load)

let started = false
export function startNative(): void {
  if (started || !isNativeApp() || !bridge()?.addListener) return
  started = true

  // The phone's back button: close an open window first, then go back a page, and at the first page leave the app (it stays open behind).
  listen('App', 'backButton', (d) => {
    if (document.querySelector('[role="dialog"]')) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
      return
    }
    if ((d as { canGoBack?: boolean } | null)?.canGoBack) window.history.back()
    else void call('App', 'minimizeApp').catch(() => undefined)
  })
  // A Metriq link opened from outside the app (an email, a chat) lands on the same place inside it.
  listen('App', 'appUrlOpen', (d) => open((d as { url?: string } | null)?.url))
  // A notification was tapped: open what it is about.
  listen('PushNotifications', 'pushNotificationActionPerformed', (d) => {
    const data = (d as { notification?: { data?: Record<string, unknown> } } | null)?.notification?.data
    open(data?.url ?? '/app/notifications')
  })
}

// ------------------------------------------------------------------ push notifications

const TOKEN_KEY = 'pt-native-push-token'
export type NativePushState = 'app-later' | 'app-denied' | 'off' | 'on'

const savedToken = (): string | null => { try { return localStorage.getItem(TOKEN_KEY) } catch { return null } }
const saveToken = (t: string | null): void => { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY) } catch { /* fine */ } }

type Send = (path: string, body: Record<string, unknown>) => Promise<unknown>

async function permission(): Promise<'granted' | 'denied' | 'prompt'> {
  const r = await call<{ receive?: string }>('PushNotifications', 'checkPermissions')
  return r.receive === 'granted' ? 'granted' : r.receive === 'denied' ? 'denied' : 'prompt'
}

/** Where push stands on this phone. `serverReady`: the server has its push key (GET /push/key → nativePush). */
export async function nativePushState(serverReady: boolean): Promise<NativePushState> {
  if (!nativePushBuilt() || !serverReady) return 'app-later'
  try {
    const p = await permission()
    if (p === 'denied') return 'app-denied'
    return p === 'granted' && savedToken() ? 'on' : 'off'
  } catch { return 'app-later' }
}

/** Ask the phone for its push token (the shell answers through a "registration" event). */
function register(): Promise<string> {
  return new Promise((resolve, reject) => {
    let done = false
    const timer = window.setTimeout(() => { if (!done) { done = true; reject(new Error('The phone did not answer. Try again.')) } }, 20_000)
    listen('PushNotifications', 'registration', (d) => {
      const t = (d as { value?: string } | null)?.value
      if (done || !t) return
      done = true; window.clearTimeout(timer); resolve(t)
    })
    listen('PushNotifications', 'registrationError', (d) => {
      if (done) return
      done = true; window.clearTimeout(timer); reject(new Error(String((d as { error?: string } | null)?.error ?? 'Could not turn on notifications')))
    })
    call('PushNotifications', 'register').catch((e) => { if (!done) { done = true; window.clearTimeout(timer); reject(e instanceof Error ? e : new Error(String(e))) } })
  })
}

/** Turn notifications on for this phone (asks the person the first time; call it from a tap). */
export async function enableNativePush(serverReady: boolean, send: Send): Promise<NativePushState> {
  if (!nativePushBuilt() || !serverReady) return 'app-later'
  let p = await permission()
  if (p === 'prompt') {
    const r = await call<{ receive?: string }>('PushNotifications', 'requestPermissions')
    p = r.receive === 'granted' ? 'granted' : r.receive === 'denied' ? 'denied' : 'prompt'
  }
  if (p !== 'granted') return p === 'denied' ? 'app-denied' : 'off'
  const token = await register()
  await send('/push/device', { token, platform: nativePlatform() ?? 'android' })
  saveToken(token)
  return 'on'
}

/** Stop notifications on this phone (the switch in Settings, or signing out). */
export async function disableNativePush(send: Send): Promise<void> {
  const token = savedToken()
  if (!token) return
  await send('/push/device/remove', { token }).catch(() => undefined)
  saveToken(null)
}

/** On app start: if notifications are on here, give the server the phone's current token (tokens change). */
export async function syncNativePush(serverReady: boolean, send: Send): Promise<void> {
  try {
    if ((await nativePushState(serverReady)) !== 'on') return
    const token = await register()
    await send('/push/device', { token, platform: nativePlatform() ?? 'android' })
    saveToken(token)
  } catch { /* offline; next start */ }
}
