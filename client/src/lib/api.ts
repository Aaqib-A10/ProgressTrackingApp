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

async function request<T>(method: string, path: string, body?: JsonBody): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
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
