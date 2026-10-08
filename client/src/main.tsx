import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { router } from './routes/router'
import { ToastProvider } from './components/ui/Toast'
import { AuthProvider } from './lib/auth'
import './index.css'

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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ToastProvider>
  </React.StrictMode>,
)
