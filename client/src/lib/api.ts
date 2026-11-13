// Thin typed fetch wrapper around the Metriq API.
// Base URL comes from VITE_API_URL; in dev, Vite also proxies /api to the server.
import { isMobileOrTablet } from './device'
import { holdUpdates } from './silentUpdate'
import { apiBase, noteAuthResponse, sessionHeaders } from './session'

// On the website this is /api on the same host; the phone app points it at the server (lib/session).
const BASE_URL = apiBase()

type JsonBody = unknown

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** The words to show for a failed request: the server's {"error": "..."} text, not the raw JSON. */
export function apiErrorText(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError) || !err.message) return fallback
  try {
    const j = JSON.parse(err.message) as { error?: unknown }
    return typeof j.error === 'string' && j.error ? j.error : fallback
  } catch {
    return err.message
  }
}

// Global handler invoked when an authenticated request comes back 401 — i.e. the
// session died mid-use (expired, or revoked server-side by a disable/reset). The
// AuthProvider registers it to clear auth state so the route guard redirects to
// login. Auth endpoints (/auth/*) manage their own 401s and are exempt.
let onUnauthorized: (() => void) | null = null

// The guest page (people outside Metriq joining a call by link) marks its requests, so the
// server uses the guest pass even if this browser is also signed in to Metriq.
let guestMode = false
export function setGuestMode(on: boolean): void {
  guestMode = on
}
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn
}

// The account this page shows. The sign-in is one cookie for the whole browser, so signing in as someone else in
// another tab changes who EVERY tab's requests are answered as, while this tab still shows the first account: that
// person then saw the other account's data here (first noticed as "another user's recent Metra chats"). Every answer
// says whose it is (X-PT-User); when that is not the account on screen, nothing of it is used and the page reloads
// as the account that is really signed in.
let shownUser: string | null = null
let reloading = false
export function setShownUser(id: string | null): void {
  shownUser = id
}
/** True when the answer belongs to another account than the one on screen (the page is then reloading). */
export function answeredAsSomeoneElse(res: Response, path: string): boolean {
  if (reloading) return true
  if (!shownUser || guestMode || path.startsWith('/auth/')) return false
  const who = res.headers.get('X-PT-User')
  if (!who || who === shownUser) return false
  reloading = true
  window.location.reload()
  return true
}
const ACCOUNT_CHANGED = 'The signed-in account changed in another tab. Reloading.'

async function request<T>(method: string, path: string, body?: JsonBody): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      // Spoof-resistant device signal for the attendance laptop-only gate — set on
      // every request (harmless elsewhere); the server reads it on attendance POSTs.
      'X-Client-Mobile': isMobileOrTablet() ? '1' : '0',
      // Is this tab in front? (the server then skips pushing pop-ups to this person)
      'X-PT-Visible': typeof document !== 'undefined' && document.visibilityState === 'visible' ? '1' : '0',
      ...(guestMode ? { 'X-PT-Guest': '1' } : {}),
      ...sessionHeaders(),
    },
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  })
  if (answeredAsSomeoneElse(res, path)) throw new ApiError(ACCOUNT_CHANGED, 409)

  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/') && !guestMode) onUnauthorized?.()
    const message = await res.text().catch(() => res.statusText)
    throw new ApiError(message || `Request failed (${res.status})`, res.status)
  }

  if (res.status === 204) { if (path.startsWith('/auth/')) noteAuthResponse(path, null); return undefined as T }
  const data = (await res.json()) as T
  if (path.startsWith('/auth/')) noteAuthResponse(path, data)
  return data
}

// Raw (non-JSON) POST — e.g. a file/CSV body the server reads with express.raw().
// Sends the body verbatim with the given content-type (default octet-stream).
async function requestRaw<T>(path: string, body: BodyInit, contentType = 'application/octet-stream'): Promise<T> {
  const release = holdUpdates() // an upload: no silent update until it is done
  try { return await sendRaw<T>(path, body, contentType) } finally { release() }
}

async function sendRaw<T>(path: string, body: BodyInit, contentType: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType, ...sessionHeaders() },
    credentials: 'include',
    body,
  })
  if (answeredAsSomeoneElse(res, path)) throw new ApiError(ACCOUNT_CHANGED, 409)
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized?.()
    const message = await res.text().catch(() => res.statusText)
    throw new ApiError(message || `Request failed (${res.status})`, res.status)
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

export const api = {
  get: <T = unknown>(path: string) => request<T>('GET', path),
  post: <T = unknown>(path: string, body?: JsonBody) => request<T>('POST', path, body),
  put: <T = unknown>(path: string, body?: JsonBody) => request<T>('PUT', path, body),
  patch: <T = unknown>(path: string, body?: JsonBody) => request<T>('PATCH', path, body),
  del: <T = unknown>(path: string) => request<T>('DELETE', path),
  postRaw: <T = unknown>(path: string, body: BodyInit, contentType?: string) => requestRaw<T>(path, body, contentType),
}
