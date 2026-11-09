import { useEffect, useState } from 'react'
import { Download, Smartphone, X } from 'lucide-react'

/**
 * "Add Metriq to your phone": on Android (Chrome, Edge, Samsung) the browser offers a real
 * install; one tap puts the Metriq icon on the home screen and it opens full screen like an
 * app. iPhones have no install prompt: the PushBanner explains Share → Add to Home Screen.
 * Shown on phones only, never inside the installed app, and "Not now" hides it for a month.
 */

const DISMISS_KEY = 'pt-install-dismissed'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** Opened from the home screen (the installed app) rather than a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true
}

// The browser fires this once, often before React mounts: keep it for the banner.
let pending: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); pending = e as BeforeInstallPromptEvent; listeners.forEach((f) => f()) })
  window.addEventListener('appinstalled', () => { pending = null; listeners.forEach((f) => f()) })
}

export function InstallBanner() {
  const [, bump] = useState(0)
  const [hidden, setHidden] = useState(() => {
    try { return Number(localStorage.getItem(DISMISS_KEY) ?? 0) > Date.now() } catch { return false }
  })
  useEffect(() => { const f = () => bump((n) => n + 1); listeners.add(f); return () => { listeners.delete(f) } }, [])
  if (hidden || isStandalone() || !pending) return null
  const later = () => { setHidden(true); try { localStorage.setItem(DISMISS_KEY, String(Date.now() + 30 * 86_400_000)) } catch { /* fine */ } }
  const install = async () => {
    const ev = pending
    if (!ev) return
    try { await ev.prompt(); const r = await ev.userChoice; if (r.outcome === 'accepted') pending = null } catch { /* the browser said no */ }
    bump((n) => n + 1)
  }
  return (
    <div className="mb-4 flex animate-fade-in items-center gap-3 rounded-card border border-primary/20 bg-primary/5 px-3.5 py-2.5 md:hidden">
      <Smartphone size={18} className="shrink-0 text-primary" />
      <p className="min-w-0 flex-1 text-body-sm text-ink"><b>Put Metriq on your phone.</b> One tap adds the icon; it opens full screen like an app.</p>
      <button type="button" onClick={install} className="inline-flex shrink-0 items-center gap-1.5 rounded-btn bg-primary px-3 py-1.5 text-body-sm font-semibold text-white hover:bg-primary/90"><Download size={14} /> Add</button>
      <button type="button" onClick={later} className="shrink-0 rounded-btn p-1 text-ink-muted hover:bg-slate-100 hover:text-ink" aria-label="Not now"><X size={16} /></button>
    </div>
  )
}
