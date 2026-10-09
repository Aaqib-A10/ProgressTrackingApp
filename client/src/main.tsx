import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { router } from './routes/router'
import { ToastProvider } from './components/ui/Toast'
import { AuthProvider } from './lib/auth'
import './index.css'
import { registerWorker } from './lib/push'

// After a deploy the old page files are replaced. If this tab (opened before the deploy)
// tries to load one of them, reload once to pick up the new version instead of breaking.
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault()
  try {
    const last = Number(sessionStorage.getItem('pt-reloaded-at') ?? 0)
    if (Date.now() - last < 30_000) return // never loop
    sessionStorage.setItem('pt-reloaded-at', String(Date.now()))
  } catch { /* private mode */ }
  window.location.reload()
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
