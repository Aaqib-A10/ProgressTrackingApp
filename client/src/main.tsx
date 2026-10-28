import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { router } from './routes/router'
import { ToastProvider } from './components/ui/Toast'
import { AuthProvider } from './lib/auth'
import './index.css'
import { registerWorker } from './lib/push'
import { initTheme } from './lib/theme'
import { installErrorReporter } from './lib/errorReporter'
import { onPreloadError } from './lib/staleChunks'

initTheme()
installErrorReporter()

// After a deploy the old page files are replaced: reload once to pick up the new version.
window.addEventListener('vite:preloadError', (e) => {
  let storage: Storage | null = null
  try { storage = window.sessionStorage } catch { /* private mode */ }
  onPreloadError(e, { storage, reload: () => window.location.reload(), now: Date.now() })
})

// Background worker for pop-up notifications when PulseTrack is closed. A click on one
// while a tab is open sends that tab to the right chat (no new tab, no reload).
void registerWorker()
navigator.serviceWorker?.addEventListener('message', (e: MessageEvent) => {
  const d = e.data as { type?: string; url?: string } | null
  if (d?.type === 'pt-open' && d.url) window.dispatchEvent(new CustomEvent('pt:navigate', { detail: d.url }))
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ToastProvider>
  </React.StrictMode>,
)
