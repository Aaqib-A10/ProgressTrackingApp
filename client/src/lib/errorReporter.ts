import { ApiError } from './api'

/**
 * Sends errors that happen in this browser to System Health, so developers see a broken
 * page before anyone has to report it. Quiet on purpose: the same error is sent once per
 * page load, at most 10 per page load, and known browser noise is skipped.
 */

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api'
const NOISE = [
  /ResizeObserver loop/i,
  /^Script error\.?$/i,
  /(chrome|moz|safari(-web)?)-extension:/i,
  /dynamically imported module|Importing a module script failed|Unable to preload CSS/i,
  /AbortError|aborted|The operation was aborted/i,
  /^(TypeError: )?(Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?)$/i,
  /NotAllowedError|Permission denied|play\(\) request was interrupted/i,
]
/**
 * True when someone else's script broke on our page (a browser extension, antivirus, a
 * translator): its stack has frames but none from this site's own files, e.g.
 * "at <anonymous>:1:30" with a scrambled name like _0x5229ea. Nothing in Metriq can fix it.
 * The server has the same rule in server/src/lib/health/foreignScript.ts (keep the two in step).
 */
export function isForeignScriptError(stack: string | null | undefined, pageUrl: string): boolean {
  if (!stack) return false
  const locs: string[] = []
  for (const raw of stack.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('at ')) {
      const m = /\(([^()]*)\)\s*$/.exec(line)
      locs.push((m ? m[1] : line.slice(3).replace(/^async\s+/, '')).trim())
    } else if (/^[^\s@]*@\S+:\d+(:\d+)?$/.test(line)) {
      locs.push(line.slice(line.lastIndexOf('@', line.search(/:\d+(:\d+)?$/)) + 1))
    }
  }
  if (!locs.length) return false
  const host = (u: string) => { try { return new URL(u).host } catch { return null } }
  const own = host(pageUrl)
  return !locs.some((l) => /^https?:\/\//i.test(l) && (!own || host(l) === own))
}

const sent = new Set<string>()
let total = 0

export function reportError(e: { message: string; stack?: string | null; kind?: 'error' | 'rejection' | 'render' }): void {
  try {
    const message = (e.message || 'Unknown error').slice(0, 2000)
    if (NOISE.some((re) => re.test(message) || (e.stack ? re.test(e.stack.split('\n')[1] ?? '') : false))) return
    if (isForeignScriptError(e.stack, window.location.href)) return
    const key = `${message}|${(e.stack ?? '').slice(0, 200)}`
    if (sent.has(key) || total >= 10) return
    sent.add(key)
    total++
    void fetch(`${BASE_URL}/system-health/client-error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      keepalive: true,
      body: JSON.stringify({ message, stack: e.stack?.slice(0, 8000) ?? null, url: window.location.href.slice(0, 1000), kind: e.kind ?? 'error' }),
    }).catch(() => undefined)
  } catch {
    // Reporting must never cause an error of its own.
  }
}

export function installErrorReporter(): void {
  window.addEventListener('error', (ev) => {
    // A picture or script that failed to load is not a code error.
    if (!(ev instanceof ErrorEvent)) return
    const err = ev.error as Error | undefined
    reportError({ message: ev.message || err?.message || 'Error', stack: err?.stack, kind: 'error' })
  })
  window.addEventListener('unhandledrejection', (ev) => {
    const r = ev.reason as unknown
    // API answers (403, 404, 422...) are handled by the screens and logged by the server.
    if (r instanceof ApiError) return
    const err = r instanceof Error ? r : null
    reportError({ message: err ? `${err.name}: ${err.message}` : `Unhandled: ${String(r).slice(0, 300)}`, stack: err?.stack, kind: 'rejection' })
  })
}
