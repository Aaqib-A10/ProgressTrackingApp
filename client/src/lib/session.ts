/**
 * Where Metriq runs and how it keeps the sign-in.
 *
 * On the website the browser keeps an httpOnly cookie and the API is on the same host (/api).
 * The phone app (the Capacitor shell, Phase B) serves the same pages from its own origin, so it
 * tells the API where to find it (window.__METRIQ_API__) and keeps the session token itself,
 * sending it as `Authorization: Bearer`. Nothing here changes how the website works.
 */

declare global {
  interface Window {
    /** Set by the phone app before the page loads: the API's absolute address (…/api). */
    __METRIQ_API__?: string
    Capacitor?: { isNativePlatform?: () => boolean }
  }
}

const TOKEN_KEY = 'pt-token'
const BASE_KEY = 'pt-api-base'

/** Running inside the phone app (or a build pointed at a remote API) rather than the website. */
export function inAppShell(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (window.Capacitor?.isNativePlatform?.()) return true
    if (window.__METRIQ_API__) return true
    return !!localStorage.getItem(BASE_KEY)
  } catch { return !!window.__METRIQ_API__ }
}

/** The API's address: the app's setting, a saved one, the build's VITE_API_URL, or /api on this host. */
export function apiBase(): string {
  if (typeof window !== 'undefined') {
    if (window.__METRIQ_API__) return window.__METRIQ_API__.replace(/\/$/, '')
    try { const saved = localStorage.getItem(BASE_KEY); if (saved) return saved.replace(/\/$/, '') } catch { /* fine */ }
  }
  return (import.meta.env.VITE_API_URL as string | undefined) ?? '/api'
}

/** Point this installation at another API (the phone app's settings screen, later). */
export function setApiBase(url: string | null): void {
  try { if (url) localStorage.setItem(BASE_KEY, url); else localStorage.removeItem(BASE_KEY) } catch { /* fine */ }
}

export function getToken(): string | null {
  if (!inAppShell()) return null
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}
export function setToken(token: string | null): void {
  if (!inAppShell()) return
  try { if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY) } catch { /* fine */ }
}

/** Headers every request carries in the app: who we are, and that the token should come back in the body. */
export function sessionHeaders(): Record<string, string> {
  if (!inAppShell()) return {}
  const t = getToken()
  return { 'X-PT-App': '1', ...(t ? { Authorization: `Bearer ${t}` } : {}) }
}

/** After an /auth/* answer: keep a fresh token, forget it on sign-out. */
export function noteAuthResponse(path: string, body: unknown): void {
  if (!inAppShell()) return
  if (path === '/auth/logout') { setToken(null); return }
  const t = (body as { token?: unknown } | null)?.token
  if (typeof t === 'string' && t) setToken(t)
}
