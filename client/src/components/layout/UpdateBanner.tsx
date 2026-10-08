import { useEffect, useState } from 'react'
import { RefreshCw, Sparkles } from 'lucide-react'
import { useCalls } from '../calls/CallProvider'

/**
 * A tab that stays open keeps running the version of PulseTrack it was opened with.
 * After every deploy, this notices that the live site has a newer build and asks the
 * person to reload, so new features (and fixes) reach everyone, not only fresh tabs.
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

export function UpdateBanner() {
  const calls = useCalls()
  const [outdated, setOutdated] = useState(false)

  useEffect(() => {
    const running = runningEntry()
    if (!running) return // dev server: nothing to compare
    let last = 0
    const check = async () => {
      if (Date.now() - last < 30_000) return
      last = Date.now()
      try {
        const live = await liveEntry()
        if (live && live !== running) setOutdated(true)
      } catch { /* offline: try again later */ }
    }
    const t = window.setInterval(() => { void check() }, CHECK_MS)
    const onVis = () => { if (document.visibilityState === 'visible') void check() }
    document.addEventListener('visibilitychange', onVis)
    void check()
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', onVis) }
  }, [])

  if (!outdated) return null
  const inCall = !!calls?.call
  return (
    <div className="fixed bottom-4 left-1/2 z-[75] flex w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 animate-scale-in items-center gap-3 rounded-card bg-ink px-4 py-3 text-white shadow-overlay" role="status">
      <Sparkles size={18} className="shrink-0 text-warning" />
      <p className="min-w-0 flex-1 text-body-sm">
        <b>PulseTrack has been updated.</b> {inCall ? 'Reload after your call to get the latest version.' : 'Reload to get the latest version.'}
      </p>
      <button type="button" disabled={inCall} onClick={() => window.location.reload()} className="inline-flex shrink-0 items-center gap-1.5 rounded-btn bg-white px-3 py-1.5 text-body-sm font-semibold text-ink hover:bg-slate-100 disabled:opacity-50">
        <RefreshCw size={14} /> Reload
      </button>
    </div>
  )
}
