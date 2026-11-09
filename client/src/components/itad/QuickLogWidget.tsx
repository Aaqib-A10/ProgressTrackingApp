import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ClipboardPen, X } from 'lucide-react'
import { cn } from '../../lib/cn'
import type { CurrentUser } from '../../lib/types'
import { filterNav } from '../layout/navConfig'
import { useToast } from '../ui/Toast'
import { QuickLogPanel } from './QuickLog'

/**
 * The floating Quick Log button: on every Metriq page for people who have the ITAD Daily Log in
 * their menu. Opens the panel in place; "Detach" opens the same panel in a small window of its own
 * that stays open while they move around Metriq (or another app).
 */

const openKey = (userId: string) => `pt-quicklog-open:${userId}`
export const QUICKLOG_WINDOW = 'metriq-quicklog'

/** Open (or focus) the pop-out window. Returns false when the browser blocked it. */
export function openQuickLogWindow(): boolean {
  const w = window.open('/quicklog', QUICKLOG_WINDOW, 'popup=yes,width=340,height=560,resizable=yes,scrollbars=yes')
  if (!w) return false
  try { w.focus() } catch { /* fine */ }
  return true
}

export function QuickLogWidget({ user }: { user: CurrentUser }) {
  const { pathname } = useLocation()
  const { addToast } = useToast()
  // People who fill the ITAD Daily Log themselves (the Super Admin only reads it).
  const show = useMemo(() => user.role !== 'SUPER_ADMIN' && filterNav(user).some((g) => [...g.items, ...(g.subgroups ?? []).flatMap((s) => s.items)].some((i) => i.to === '/app/itad/log')), [user])
  const [open, setOpen] = useState(() => { try { return sessionStorage.getItem(openKey(user.id)) === '1' } catch { return false } })
  const [blocked, setBlocked] = useState(false)
  useEffect(() => { try { sessionStorage.setItem(openKey(user.id), open ? '1' : '0') } catch { /* fine */ } }, [open, user.id])
  // The full page is the log itself; the pop-out window has its own copy.
  if (!show || pathname.startsWith('/app/itad/log')) return null

  const detach = () => {
    if (openQuickLogWindow()) { setOpen(false); setBlocked(false) } else { setBlocked(true); addToast({ type: 'error', message: 'Your browser blocked the little window. Allow pop-ups for Metriq, or use "Open in a tab".' }) }
  }

  return (
    <>
      {open && (
        <div className="fixed inset-x-2 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 flex max-h-[min(560px,calc(100dvh-6rem))] flex-col overflow-hidden rounded-card border border-line bg-card shadow-overlay md:inset-x-auto md:bottom-[4.75rem] md:right-20 md:w-[300px]" role="dialog" aria-label="Quick Log">
          {blocked && (
            <div className="flex items-center gap-2 border-b border-warning/40 bg-warning/10 px-3 py-1.5 text-[12px] text-ink">
              Pop-ups are blocked here. <a href="/quicklog" target="_blank" rel="noopener" className="font-semibold text-primary underline" onClick={() => setBlocked(false)}>Open in a tab</a>
              <button type="button" onClick={() => setBlocked(false)} className="ml-auto text-ink-muted" aria-label="Dismiss"><X size={13} /></button>
            </div>
          )}
          <div className="flex min-h-0 flex-1 flex-col"><QuickLogPanel onClose={() => setOpen(false)} onMinimize={() => setOpen(false)} onDetach={detach} /></div>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn('fixed z-40 flex h-12 items-center gap-2 rounded-full bg-ink px-4 text-card shadow-overlay transition-transform hover:scale-105 focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/30',
          'right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-4 md:right-20',
          open && 'bg-primary text-white max-md:hidden')} // on a phone the open panel covers this corner: its own Close and Minimize take over
        aria-label={open ? 'Hide Quick Log' : 'Quick Log: today’s activity'}
        title="Quick Log: add today’s calls, emails and results from anywhere"
      >
        <ClipboardPen size={18} /><span className="text-body-sm font-semibold">Quick Log</span>
      </button>
    </>
  )
}
