import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Pin, PinOff, RotateCcw, SlidersHorizontal, X } from 'lucide-react'
import { dialerApi, type DialerPrefs } from '../../../../lib/dialerApi'
import { NO_FILTERS, type Filters } from '../../../../lib/dialer'
import { cn } from '../../../../lib/cn'

/**
 * One filter state for every Lead Dialer page, kept in the address bar (ITAD revised spec, 4 Nov 2026).
 *
 * The Dashboard, Funnel, Industries and Follow-ups share the same keys for the same things
 * (fs state, fr region, fi industry, fst status/stage), so expanding a card, switching tabs,
 * Back, Forward and a refresh all find the same filters. Page-only filters (Follow-ups' quiet
 * days, the Dashboard's date range...) sit next to them under their own keys.
 */

/** Address-bar keys for the Dashboard / Funnel / Industries filters (the first four are shared with Follow-ups). */
export const SHARED_KEY: Record<keyof Filters, string> = { state: 'fs', region: 'fr', industry: 'fi', status: 'fst', rep: 'frp', list: 'fl', date: 'fd' }

export function useSharedFilters(): { filters: Filters; set: (k: keyof Filters, v: string) => void; update: (patch: Partial<Filters>) => void; clear: () => void; on: boolean; count: number } {
  const [params, setParams] = useSearchParams()
  const filters = useMemo((): Filters => {
    const f = { ...NO_FILTERS }
    for (const k of Object.keys(SHARED_KEY) as (keyof Filters)[]) f[k] = params.get(SHARED_KEY[k]) ?? ''
    return f
  }, [params])
  const write = useCallback((patch: Partial<Filters>) => {
    setParams((p) => {
      const n = new URLSearchParams(p)
      for (const [k, v] of Object.entries(patch)) { if (v) n.set(SHARED_KEY[k as keyof Filters], v); else n.delete(SHARED_KEY[k as keyof Filters]) }
      n.delete('fn') // "show more" starts over when the list changes
      return n
    }, { replace: true })
  }, [setParams])
  const set = useCallback((k: keyof Filters, v: string) => write({ [k]: v }), [write])
  const clear = useCallback(() => write({ ...NO_FILTERS }), [write])
  const count = Object.values(filters).filter(Boolean).length
  return { filters, set, update: write, clear, on: count > 0, count }
}

// ------------------------------------------------------------------ the Filters button, pins and chips

export interface FilterDef {
  key: string
  label: string
  /** Stage, Location, Company, Activity, Tasks... */
  group: string
  active: boolean
  /** What is picked, for the chip ("Printing", "over 30 days"). */
  summary?: string
  control: ReactNode
  clear: () => void
}

/** What each page pins the first time. */
export const DEFAULT_PINS: Record<string, string[]> = {
  dashboard: ['state', 'region', 'industry', 'status'],
  followups: ['state', 'region', 'quiet', 'callNow'],
  leads: ['state', 'region', 'status', 'callAt'],
}

// The pins every FilterBar on the page shares, so a change in one bar shows in the others at once.
let pinsCache: Record<string, string[]> | null = null
const listeners = new Set<() => void>()

function usePins(page: string, prefs: DialerPrefs): [string[], (next: string[] | null) => void] {
  if (!pinsCache) pinsCache = { ...(prefs.filterPins ?? {}) }
  const [, tick] = useState(0)
  useEffect(() => { const fn = () => tick((n) => n + 1); listeners.add(fn); return () => { listeners.delete(fn) } }, [])
  const pins = pinsCache[page] ?? DEFAULT_PINS[page] ?? []
  const set = (next: string[] | null) => {
    if (next) pinsCache![page] = next; else delete pinsCache![page]
    listeners.forEach((fn) => fn())
    void dialerApi.savePrefs({ filterPins: { [page]: next ?? DEFAULT_PINS[page] ?? [] } }).catch(() => undefined)
  }
  return [pins, set]
}

export function FilterBar({ page, defs, prefs, search, onClearAll, after }: { page: string; defs: FilterDef[]; prefs: DialerPrefs; search?: ReactNode; onClearAll: () => void; after?: ReactNode }) {
  const [pins, setPins] = usePins(page, prefs)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', off); window.addEventListener('keydown', key)
    return () => { window.removeEventListener('mousedown', off); window.removeEventListener('keydown', key) }
  }, [open])
  // A saved pin for a filter the page no longer has is ignored.
  const byKey = new Map(defs.map((d) => [d.key, d]))
  const pinned = pins.map((k) => byKey.get(k)).filter((d): d is FilterDef => !!d)
  const active = defs.filter((d) => d.active)
  const chips = active.filter((d) => !pins.includes(d.key))
  const groups = [...new Set(defs.map((d) => d.group))]
  const isDefault = JSON.stringify(pins) === JSON.stringify(DEFAULT_PINS[page] ?? [])
  const toggle = (k: string) => setPins(pins.includes(k) ? pins.filter((x) => x !== k) : [...pins, k])
  return (
    <div className="flex flex-wrap items-center gap-2">
      {search}
      <div ref={box} className="relative">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={cn('inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-body-sm font-semibold', active.length ? 'border-primary bg-primary/5 text-primary' : 'border-line bg-card text-ink hover:bg-slate-50')}>
          <SlidersHorizontal size={14} />Filters{active.length ? ` (${active.length})` : ''}
        </button>
        {open && (
          <div className="absolute left-0 top-9 z-30 w-[min(92vw,640px)] rounded-card border border-line bg-card p-3 shadow-overlay">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-body-sm text-ink-muted">Every filter on this page. <Pin size={11} className="inline" /> keeps one in the bar; the rest stay here.</p>
              {!isDefault && <button type="button" onClick={() => setPins(null)} className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary hover:underline"><RotateCcw size={12} />Reset to default</button>}
            </div>
            <div className="max-h-[60vh] space-y-3 overflow-auto pr-1">
              {groups.map((g) => (
                <div key={g}>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{g}</p>
                  <ul className="space-y-1">
                    {defs.filter((d) => d.group === g).map((d) => {
                      const on = pins.includes(d.key)
                      return (
                        <li key={d.key} className={cn('flex flex-wrap items-center gap-2 rounded-btn px-2 py-1', d.active && 'bg-primary/[0.04]')}>
                          <button type="button" onClick={() => toggle(d.key)} aria-pressed={on} aria-label={`${on ? 'Unpin' : 'Pin'} ${d.label}`} title={on ? 'In the bar' : 'Pin to the bar'} className={cn('rounded p-1', on ? 'text-primary' : 'text-ink-faint hover:text-ink')}>{on ? <Pin size={14} className="fill-current" /> : <PinOff size={14} />}</button>
                          <span className="w-28 shrink-0 text-body-sm text-ink">{d.label}</span>
                          <span className="min-w-0 flex-1">{d.control}</span>
                          {d.active && <button type="button" onClick={d.clear} className="text-[12px] text-ink-muted hover:text-ink">clear</button>}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
            {active.length > 0 && <div className="mt-3 border-t border-line pt-2"><button type="button" onClick={() => { onClearAll(); setOpen(false) }} className="inline-flex items-center gap-1 text-body-sm font-semibold text-ink-muted hover:text-ink"><X size={14} />Clear all</button></div>}
          </div>
        )}
      </div>
      {/* Pinned filters: one click each. On a narrow screen only the button and the chips show. */}
      <div className="hidden flex-wrap items-center gap-2 sm:flex">{pinned.map((d) => <span key={d.key}>{d.control}</span>)}</div>
      {/* An active filter that is not pinned still shows, so nothing hidden changes the list quietly. */}
      {chips.map((d) => (
        <span key={d.key} className="inline-flex h-8 items-center gap-1 rounded-full border border-primary bg-primary/5 pl-3 pr-1 text-body-sm text-primary">
          <span className="max-w-[220px] truncate"><span className="font-semibold">{d.label}</span>{d.summary ? `: ${d.summary}` : ''}</span>
          <button type="button" onClick={d.clear} className="rounded-full p-1 hover:bg-primary/10" aria-label={`Remove ${d.label} filter`}><X size={12} /></button>
        </span>
      ))}
      {active.length > 0 && <button type="button" onClick={onClearAll} className="inline-flex items-center gap-1 text-body-sm text-ink-muted hover:text-ink"><X size={14} /> Clear all</button>}
      {after}
    </div>
  )
}
