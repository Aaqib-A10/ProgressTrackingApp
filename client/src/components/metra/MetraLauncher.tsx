import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { MetraMark } from './MetraMark'
import { pageModule } from '../../lib/staleChunks'
import { OPEN_METRA_EVENT, metraReady, useMetraStatus } from '../../lib/metraApi'

// The panel downloads the first time it is opened.
const MetraPanel = lazy(() => pageModule(() => import('./MetraPanel'))().then((m) => ({ default: m.MetraPanel })))

/**
 * Metra's launcher on every app page, above the chat button: opens the side panel (a sheet on phones).
 * Shows nothing while the `metra` switch is off for the company or the server says Metra is not on.
 */
export function MetraLauncher({ firstName }: { firstName?: string }) {
  const status = useMetraStatus()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [question, setQuestion] = useState<{ q: string; n: number } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const onPage = pathname.startsWith('/app/metra')
  const onPageRef = useRef(onPage)
  onPageRef.current = onPage
  const ready = metraReady(status)

  useEffect(() => {
    if (!ready) return
    const onOpen = (e: Event) => {
      if (onPageRef.current) return // the full page answers it
      const q = (e as CustomEvent<{ question?: string }>).detail?.question?.trim()
      setLoaded(true)
      setOpen(true)
      if (q) setQuestion((p) => ({ q, n: (p?.n ?? 0) + 1 }))
    }
    window.addEventListener(OPEN_METRA_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_METRA_EVENT, onOpen)
  }, [ready])

  // Going to the full page closes the panel.
  useEffect(() => { if (onPage) setOpen(false) }, [onPage])

  if (!ready) return null
  const close = () => { setOpen(false); window.setTimeout(() => button.current?.focus(), 0) }

  return (
    <>
      {loaded && (
        <Suspense fallback={null}>
          <MetraPanel open={open} onClose={close} status={status} firstName={firstName} question={question} />
        </Suspense>
      )}
      {!onPage && !pathname.startsWith('/app/chat') && !open && (
        // Phones: above the bottom tab bar and the Quick Log button. Computers: the bottom-right corner (the chat bubble is gone).
        <div className="fixed right-3 z-40 bottom-[calc(8.25rem+env(safe-area-inset-bottom))] md:bottom-8 md:right-8 motion-safe:animate-metra-float">
          <button
            ref={button}
            type="button"
            onClick={() => { setLoaded(true); setOpen(true) }}
            aria-haspopup="dialog"
            className="group flex flex-col items-center gap-1 rounded-[18px] focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/30"
          >
            <span className="relative flex h-12 w-12 items-center justify-center md:h-[52px] md:w-[52px]">
              {/* A soft shadow on the "ground" under the floating mark. */}
              <span aria-hidden className="absolute -bottom-2 left-1/2 h-2 w-9 -translate-x-1/2 rounded-full bg-[#4F46E5]/25 blur-[6px]" />
              <span aria-hidden className="absolute inset-0 rounded-[30%] bg-gradient-to-br from-[#4F46E5] to-[#38BDF8] motion-safe:animate-metra-glow" />
              <span className="relative rounded-[30%] shadow-[0_10px_24px_-8px_rgba(79,70,229,0.55)] transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:scale-105 group-active:scale-95">
                <MetraMark size={52} className="h-12 w-12 md:h-[52px] md:w-[52px]" />
              </span>
            </span>
            <span className="whitespace-nowrap rounded-full border border-line bg-card/95 px-1.5 py-px text-[10px] font-semibold leading-4 text-ink shadow-xs backdrop-blur md:px-2 md:text-[11px]">
              Ask Metra
            </span>
          </button>
        </div>
      )}
    </>
  )
}
