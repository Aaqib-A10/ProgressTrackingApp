// Thin typed fetch wrapper around the PulseTrack API.
// Base URL comes from VITE_API_URL; in dev, Vite also proxies /api to the server.
const BASE_URL = import.meta.env.VITE_API_URL ?? '/api'

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

// Global handler invoked when an authenticated request comes back 401 — i.e. the
// session died mid-use (expired, or revoked server-side by a disable/reset). The
// AuthProvider registers it to clear auth state so the route guard redirects to
// login. Auth endpoints (/auth/*) manage their own 401s and are exempt.
let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn
}

async function request<T>(method: string, path: string, body?: JsonBody): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  })

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
}
