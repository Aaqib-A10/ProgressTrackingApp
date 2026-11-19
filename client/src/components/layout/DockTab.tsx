import { ChevronLeft, ChevronsRight } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { setDockTucked, useDock } from '../../lib/dock'
import { MetraMark } from '../metra/MetraMark'
import { cn } from '../../lib/cn'

/**
 * Puts the floating buttons (Quick Log, Ask Metra) aside and brings them back (lib/dock). Open: a small "move aside"
 * button in the corner under them. Put aside: a slim tab on the right edge of the screen.
 */
export function DockTab() {
  const { pathname } = useLocation()
  const { tucked, any, place } = useDock(pathname)
  if (!any || pathname.startsWith('/app/metra')) return null

  if (tucked) {
    return (
      <button
        type="button"
        onClick={() => setDockTucked(place, false)}
        title="Show Quick Log and Ask Metra"
        aria-label="Show Quick Log and Ask Metra"
        className={cn(
          'fixed right-0 z-40 flex items-center gap-1 rounded-l-xl border border-r-0 border-line bg-card py-2 pl-1.5 pr-1 text-ink-muted shadow-raised transition-[padding,color] hover:pr-2 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          // On the chat page high up, clear of the message box; elsewhere low, where the buttons were.
          place === 'chat' ? 'top-32' : 'bottom-[calc(5.25rem+env(safe-area-inset-bottom))] md:bottom-24',
        )}
      >
        <ChevronLeft size={15} />
        <MetraMark size={20} className="h-5 w-5" />
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={() => setDockTucked(place, true)}
      title="Move these buttons aside (a tab on the edge brings them back)"
      aria-label="Move Quick Log and Ask Metra aside"
      className="fixed z-40 flex h-6 w-6 items-center justify-center rounded-full border border-line bg-card text-ink-faint shadow-xs transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 right-[4.4rem] bottom-[calc(5.5rem+env(safe-area-inset-bottom))] md:bottom-2 md:right-2"
    >
      <ChevronsRight size={14} />
    </button>
  )
}
