import type { Role } from '@prisma/client'
import { signConnectorToken } from '../auth'
import { AsyncLocalStorage } from 'node:async_hooks'
import { apiBaseUrl } from '../health/audit'

/**
 * Call Metriq's own API as the person behind a connector key, over HTTP inside the server, so
 * every check the app makes still applies: login, role, department (requireDepartment), project
 * membership, the System Health log. Whatever the person cannot open in the app, the connector
 * cannot open either.
 */
export interface ApiResult { status: number; body: unknown; contentType: string }

// Reads made while one answer is being worked out (Metra): the same screen asked for twice is read once. The Lead
// Dialer tools each load the person's whole lead list, and a question often needs three of them.
const reads = new AsyncLocalStorage<Map<string, Promise<ApiResult>>>()
/** Run `fn` with a memory of its GETs (per person and address). Writes are never remembered. */
export function withApiCache<T>(fn: () => Promise<T>): Promise<T> { return reads.run(new Map(), fn) }

export async function apiAs(
  u: { id: string; role: Role },
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
  path: string,
  opts: { query?: Record<string, string>; body?: unknown } = {},
): Promise<ApiResult> {
  const qs = opts.query && Object.keys(opts.query).length ? `?${new URLSearchParams(opts.query).toString()}` : ''
  const seen = method === 'GET' ? reads.getStore() : undefined
  if (!seen) return call(u, method, path, qs, opts.body)
  const key = `${u.id} ${path}${qs}`
  let hit = seen.get(key)
  if (!hit) {
    // One more try when the first read fails on the way (time-out, dropped connection): a blip is not "could not read".
    hit = call(u, method, path, qs, undefined).catch(() => call(u, method, path, qs, undefined))
    seen.set(key, hit)
    hit.catch(() => seen.delete(key))
  }
  return hit
}

async function call(u: { id: string; role: Role }, method: string, path: string, qs: string, sent: unknown): Promise<ApiResult> {
  const opts = { body: sent }
  const r = await fetch(`${apiBaseUrl()}${path}${qs}`, {
    method,
    headers: {
      Authorization: `Bearer ${signConnectorToken({ sub: u.id, role: u.role })}`,
      Accept: 'application/json',
      'X-Metriq-Connector': '1',
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(30_000),
  })
  const contentType = r.headers.get('content-type') ?? ''
  const raw = await r.text()
  let body: unknown = raw
  if (contentType.includes('json')) { try { body = JSON.parse(raw) } catch { body = raw } }
  return { status: r.status, body, contentType }
}

export const apiError = (r: ApiResult): string =>
  (r.body && typeof r.body === 'object' && 'error' in r.body ? String((r.body as { error: unknown }).error) : '') || `Metriq answered ${r.status}.`
