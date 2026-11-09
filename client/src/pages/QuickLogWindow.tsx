import { useEffect } from 'react'
import { QuickLogPanel } from '../components/itad/QuickLog'

/**
 * /quicklog — the Quick Log in a window of its own (Detach). Same sign-in, same panel, same daily
 * entry as the floating one; nothing else on the page so it fits a small window.
 */
export default function QuickLogWindow() {
  useEffect(() => {
    const was = document.title
    document.title = 'Quick Log · Metriq'
    return () => { document.title = was }
  }, [])
  return (
    <div className="flex h-dvh flex-col bg-card">
      <QuickLogPanel standalone />
    </div>
  )
}
