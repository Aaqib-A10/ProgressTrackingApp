import { useEffect, useRef, useState, type RefObject } from 'react'
import { RefreshCw } from 'lucide-react'
import { cn } from '../lib/cn'

/**
 * Pull down to refresh, on phones: pull the page down from the very top and let go, and the
 * screen loads its data again (the page is mounted afresh; nothing reloads, nobody is signed out).
 * Works with a finger only, below 768px, and stays out of the way of the chat, open windows,
 * lists that scroll inside themselves, and sideways swipes.
 */

const TRIGGER = 72 // px of pull (after resistance) that refreshes on release
const MAX = 110

function startsInsideScrolledBox(target: EventTarget | null, main: HTMLElement): boolean {
  for (let el = target instanceof Element ? target : null; el && el !== main; el = el.parentElement) {
    const oy = getComputedStyle(el).overflowY
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1 && el.scrollTop > 0) return true
  }
  return false
}

export function usePullToRefresh(mainRef: RefObject<HTMLElement | null>, onRefresh: () => void, disabled: boolean): { pull: number; busy: boolean } {
  const [pull, setPull] = useState(0)
  const [busy, setBusy] = useState(false)
  const s = useRef<{ y: number; x: number; on: boolean; decided: boolean } | null>(null)
  const latest = useRef({ onRefresh, disabled, pull: 0, busy: false })
  latest.current = { onRefresh, disabled, pull, busy }

  useEffect(() => {
    const main = mainRef.current
    if (!main) return
    const phone = () => window.matchMedia('(max-width: 767px) and (pointer: coarse)').matches
    const start = (e: TouchEvent) => {
      s.current = null
      if (latest.current.disabled || latest.current.busy || !phone() || e.touches.length !== 1) return
      if (main.scrollTop > 0 || document.querySelector('[role="dialog"]')) return
      if (startsInsideScrolledBox(e.target, main)) return
      s.current = { y: e.touches[0].clientY, x: e.touches[0].clientX, on: false, decided: false }
    }
    const move = (e: TouchEvent) => {
      const st = s.current
      if (!st) return
      const dy = e.touches[0].clientY - st.y, dx = e.touches[0].clientX - st.x
      if (!st.decided) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
        st.decided = true
        // A sideways swipe or a push up is someone else's gesture.
        st.on = dy > 0 && Math.abs(dy) > Math.abs(dx) * 1.3 && main.scrollTop <= 0
        if (!st.on) { s.current = null; return }
      }
      if (main.scrollTop > 0) { s.current = null; setPull(0); return }
      // Resistance: the further the pull, the slower it moves.
      setPull(Math.min(MAX, dy * 0.5))
      if (e.cancelable) e.preventDefault()
    }
    const end = () => {
      const st = s.current
      s.current = null
      if (!st?.on) return
      if (latest.current.pull >= TRIGGER) {
        setBusy(true)
        setPull(TRIGGER * 0.75)
        if (navigator.vibrate) { try { navigator.vibrate(10) } catch { /* not allowed */ } }
        latest.current.onRefresh()
        window.setTimeout(() => { setBusy(false); setPull(0) }, 700)
      } else {
        setPull(0)
      }
    }
    main.addEventListener('touchstart', start, { passive: true })
    main.addEventListener('touchmove', move, { passive: false })
    main.addEventListener('touchend', end, { passive: true })
    main.addEventListener('touchcancel', end, { passive: true })
    return () => {
      main.removeEventListener('touchstart', start)
      main.removeEventListener('touchmove', move)
      main.removeEventListener('touchend', end)
      main.removeEventListener('touchcancel', end)
    }
  }, [mainRef])

  return { pull, busy }
}

/** The round arrow that follows the finger, turns as the pull grows, and spins while the page loads again. */
export function PullIndicator({ pull, busy }: { pull: number; busy: boolean }) {
  if (!pull && !busy) return null
  const ready = pull >= TRIGGER || busy
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center md:hidden" style={{ transform: `translateY(${Math.max(0, pull - 40)}px)`, transition: busy || !pull ? 'transform 200ms ease-out' : undefined }}>
      <span className={cn('mt-2 flex h-10 w-10 items-center justify-center rounded-full border border-line bg-card shadow-raised', ready ? 'text-primary' : 'text-ink-muted')}>
        <RefreshCw size={18} className={cn(busy && 'animate-spin')} style={busy ? undefined : { transform: `rotate(${Math.round((pull / TRIGGER) * 270)}deg)`, opacity: Math.min(1, pull / 40) }} />
      </span>
    </div>
  )
}
