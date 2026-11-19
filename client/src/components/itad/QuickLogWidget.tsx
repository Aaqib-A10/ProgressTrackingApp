import { useEffect, useMemo, useState } from 'react'
import { ClipboardPen, X } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { registerDockButton, useDock } from '../../lib/dock'
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
  const { addToast } = useToast()
  // People who fill the ITAD Daily Log themselves (the Super Admin only reads it).
  const show = useMemo(() => user.role !== 'SUPER_ADMIN' && filterNav(user).some((g) => [...g.items, ...(g.subgroups ?? []).flatMap((s) => s.items)].some((i) => i.to === '/app/itad/log')), [user])
  const [open, setOpen] = useState(() => { try { return sessionStorage.getItem(openKey(user.id)) === '1' } catch { return false } })
  const [blocked, setBlocked] = useState(false)
  useEffect(() => { try { sessionStorage.setItem(openKey(user.id), open ? '1' : '0') } catch { /* fine */ } }, [open, user.id])
  // One of the corner buttons: it can be put aside with Ask Metra (lib/dock, layout/DockTab).
  const { pathname } = useLocation()
  const { tucked } = useDock(pathname)
  useEffect(() => registerDockButton('quicklog', show), [show])
  // Everywhere, the full Daily Log page included (people detach it from there).
  if (!show) return null

  const detach = () => {
    if (openQuickLogWindow()) { setOpen(false); setBlocked(false) } else { setBlocked(true); addToast({ type: 'error', message: 'Your browser blocked the little window. Allow pop-ups for Metriq, or use "Open in a tab".' }) }
  }

  return (
    <>
      {open && (
        <div className="fixed inset-x-2 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 flex max-h-[min(560px,calc(100dvh-6rem))] flex-col overflow-hidden rounded-card border border-line bg-card shadow-overlay md:inset-x-auto md:bottom-8 md:right-28 md:w-[300px]" role="dialog" aria-label="Quick Log">
          {blocked && (
            <div className="flex items-center gap-2 border-b border-warning/40 bg-warning/10 px-3 py-1.5 text-[12px] text-ink">
              Pop-ups are blocked here. <a href="/quicklog" target="_blank" rel="noopener" className="font-semibold text-primary-ink underline" onClick={() => setBlocked(false)}>Open in a tab</a>
              <button type="button" onClick={() => setBlocked(false)} className="ml-auto text-ink-muted" aria-label="Dismiss"><X size={13} /></button>
            </div>
          )}
          <div className="flex min-h-0 flex-1 flex-col"><QuickLogPanel onClose={() => setOpen(false)} onMinimize={() => setOpen(false)} onDetach={detach} /></div>
        </div>
      )}
      {/* A round button stacked above Ask Metra, so the two take a narrow column, not a strip across the page. Its
          name shows on hover (and to screen readers). Hidden while the corner buttons are put aside, unless open. */}
      {(!tucked || open) && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={cn('group fixed z-40 flex h-12 w-12 items-center justify-center rounded-full bg-ink text-card shadow-overlay transition-transform hover:scale-105 focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/30',
            'right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] md:bottom-[7.5rem] md:right-10',
            open && 'bg-primary text-primary-on max-md:hidden')} // on a phone the open panel covers this corner: its own Close and Minimize take over
          aria-label={open ? 'Hide Quick Log' : 'Quick Log: today’s activity'}
          title="Quick Log: add today’s calls, emails and results from anywhere"
        >
          <ClipboardPen size={19} />
          <span className="pointer-events-none absolute right-full mr-2 hidden whitespace-nowrap rounded-full bg-ink px-2.5 py-1 text-[12px] font-semibold text-card opacity-0 shadow-raised transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 md:block">Quick Log</span>
        </button>
      )}
    </>
  )
}
