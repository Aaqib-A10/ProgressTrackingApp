import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useCalls } from '../calls/CallProvider'
import { flagOn, refreshFlags } from '../../lib/flags'
import { hasUnsavedText, shouldReload, updatesHeld, RELOADED_KEY, type Trigger } from '../../lib/silentUpdate'

/**
 * A tab that stays open keeps running the version it was opened with. This notices that the live
 * site has a newer build and reloads by itself at a moment nobody notices (see lib/silentUpdate).
 * It replaced the "PulseTrack has been updated, Reload" banner (Oct 2026). Renders nothing.
 */

const CHECK_MS = 2 * 60_000

function entryOf(src: string | null | undefined): string | null {
  if (!src) return null
  try { return new URL(src, window.location.origin).pathname } catch { return null }
}

/** The main script this tab is running (null in local development). */
function runningEntry(): string | null {
  const el = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]')
  return entryOf(el?.getAttribute('src'))
}

/** The main script the live site serves right now. */
async function liveEntry(): Promise<string | null> {
  const r = await fetch(`/?pt-version=${Date.now()}`, { cache: 'no-store', credentials: 'same-origin' })
  if (!r.ok) return null
  const m = (await r.text()).match(/<script[^>]+src="([^"]*\/assets\/index-[^"]+\.js)"/)
  return entryOf(m?.[1])
}

function lastReloadAt(): number | null {
  try { const v = Number(sessionStorage.getItem(RELOADED_KEY)); return Number.isFinite(v) && v > 0 ? v : null } catch { return null }
}

export function SilentUpdater() {
  const calls = useCalls()
  const location = useLocation()
  const outdated = useRef(false)
  const inCall = useRef(false)
  const hiddenSince = useRef<number | null>(null)
  const lastInput = useRef(Date.now())
  const firstPath = useRef(true)
  inCall.current = !!calls?.call

  const tryReload = (trigger: Trigger, since: number) => {
    if (!flagOn('silent-updates')) return // switched off by the owner
    const now = Date.now()
    const ok = shouldReload({
      outdated: outdated.current,
      trigger,
      now,
      since,
      lastReloadAt: lastReloadAt(),
      state: { inCall: inCall.current, path: window.location.pathname, held: updatesHeld(), unsavedText: hasUnsavedText(document) },
    })
    if (!ok) return
    try { sessionStorage.setItem(RELOADED_KEY, String(now)) } catch { /* private mode: the gap check just won't apply */ }
    window.location.reload()
  }

  // Watch for a newer build.
  useEffect(() => {
    const running = runningEntry()
    if (!running) return // dev server: nothing to compare
    let last = 0
    const check = async () => {
      if (Date.now() - last < 30_000) return
      last = Date.now()
      try {
        await refreshFlags()
        const live = await liveEntry()
        if (live && live !== running) outdated.current = true
      } catch { /* offline: try again later */ }
    }
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void check() }, CHECK_MS)
    const onVis = () => {
      if (document.visibilityState === 'visible') { hiddenSince.current = null; void check() }
      else hiddenSince.current = Date.now()
    }
    document.addEventListener('visibilitychange', onVis)
    void check()
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', onVis) }
  }, [])

  // Safe moment 1: the person opened another page.
  useEffect(() => {
    if (firstPath.current) { firstPath.current = false; return }
    tryReload('page-change', Date.now())
  }, [location.pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  // Safe moments 2 and 3: a tab left in the background, or a long idle.
  useEffect(() => {
    const onInput = () => { lastInput.current = Date.now() }
    const opts = { passive: true, capture: true } as const
    for (const e of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) window.addEventListener(e, onInput, opts)
    const t = window.setInterval(() => {
      if (hiddenSince.current != null) tryReload('hidden', hiddenSince.current)
      else tryReload('idle', lastInput.current)
    }, 30_000)
    return () => {
      window.clearInterval(t)
      for (const e of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) window.removeEventListener(e, onInput, opts)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}

