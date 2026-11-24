/**
 * After a deploy the old page files are replaced. A tab opened before the deploy that tries to
 * load one of them reloads once to pick up the new version instead of breaking.
 *
 * The trap (System Health, 27 Oct 2026, Waleed on /app/tasks: "Cannot read properties of
 * undefined (reading 'default')"): when the vite:preloadError event is cancelled, Vite does not
 * throw; the page's import() resolves to undefined and React.lazy crashes reading `.default`.
 * So the event is cancelled ONLY when we really reload, and lazy pages wait (keep the loader on
 * screen) while the reload happens instead of rendering nothing.
 */

export const RELOAD_KEY = 'pt-reloaded-at'
const RELOAD_GAP_MS = 30_000

interface Env { storage: Pick<Storage, 'getItem' | 'setItem'> | null; reload: () => void; now: number }

/** Handle a failed page-file load. Returns true when the page is reloading. */
export function onPreloadError(e: Pick<Event, 'preventDefault'>, env: Env): boolean {
  // Without storage we cannot tell whether we just reloaded: let the error show (no reload loop).
  if (!env.storage) return false
  let last = 0
  try { last = Number(env.storage.getItem(RELOAD_KEY) ?? 0) } catch { return false }
  // Reloaded a moment ago and still failing: let the error through to the error screen.
  if (env.now - last < RELOAD_GAP_MS) return false
  try { env.storage.setItem(RELOAD_KEY, String(env.now)) } catch { return false }
  e.preventDefault()
  env.reload()
  return true
}

/**
 * Wrap a lazy page's import: if the import came back empty (the page is reloading after a
 * deploy), wait for the reload instead of handing React nothing.
 */
export function pageModule<T>(load: () => Promise<T>): () => Promise<T> {
  PAGES.push(load)
  return () => load().then((m) => (m == null ? new Promise<T>(() => { /* the reload replaces this page */ }) : m))
}

/** Every page's loader, so the pages can be fetched ahead of time (warmPages). */
const PAGES: (() => Promise<unknown>)[] = []
let warming = false

/**
 * Fetch every page's file in the background once the app has loaded (24 Nov 2026). Each request to the server takes
 * 0.5 to 8 seconds on the network (the server itself answers in a millisecond), and every deploy gives the page files
 * new names, so the first time a page was opened after a deploy it waited seconds for its file before it could even ask
 * for its data. Fetched ahead (about 1 MB in all, two at a time, only when the browser is idle), every page then opens
 * at once, and Cloudflare keeps the files close to everyone else too. Skipped when the person asked to save data.
 */
export function warmPages(): void {
  if (warming || typeof window === 'undefined') return
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection
  if (conn?.saveData || conn?.effectiveType === '2g' || conn?.effectiveType === 'slow-2g') return
  warming = true
  const ric = (window as Window & { requestIdleCallback?: (fn: () => void, o?: { timeout: number }) => number }).requestIdleCallback
  const idle = (fn: () => void) => { if (ric) ric.call(window, fn, { timeout: 3000 }); else setTimeout(fn, 200) }
  const queue = [...PAGES]
  const next = (): void => {
    const load = queue.shift()
    if (!load) return
    // A page that fails to load here is simply loaded when it is opened (and reloads after a deploy, as above).
    idle(() => { load().catch(() => undefined).finally(next) })
  }
  // Let the page the person opened finish first; then two at a time.
  window.setTimeout(() => { next(); next() }, 2500)
}
