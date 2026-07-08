import { useEffect, useRef, useState } from 'react'
import { CalendarDays, ChevronDown } from 'lucide-react'
import { cn } from '../../lib/cn'

export type RangeKey = 'today' | 'week' | 'month' | 'rolling3m' | 'custom'

export interface CustomRange {
  start: string
  end: string
}

const PRESETS: { value: Exclude<RangeKey, 'custom'>; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'rolling3m', label: '3 Months' },
]

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export interface RangeSelectorProps {
  value: RangeKey
  onChange: (value: Exclude<RangeKey, 'custom'>) => void
  custom: CustomRange | null
  onApplyCustom: (range: CustomRange) => void
  className?: string
}

/** Today / Week / Month / 3 Months / Custom (with a start–end date picker). */
export function RangeSelector({ value, onChange, custom, onApplyCustom, className }: RangeSelectorProps) {
  const [open, setOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const today = iso(new Date())
  const monthAgo = iso(new Date(Date.now() - 30 * 86400000))
  const [start, setStart] = useState(custom?.start ?? monthAgo)
  const [end, setEnd] = useState(custom?.end ?? today)
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!open && !mobileOpen) return
    const close = () => { setOpen(false); setMobileOpen(false) }
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, mobileOpen])

  function apply() {
    if (start > end) {
      setError('Start date must be before end date')
      return
    }
    setError(undefined)
    onApplyCustom({ start, end })
    setOpen(false)
  }

  const customActive = value === 'custom'
  const customLabel = customActive && custom ? `${custom.start} → ${custom.end}` : 'Custom'
  const compactLabel = customActive ? 'Custom' : PRESETS.find((p) => p.value === value)?.label ?? 'Range'

  return (
    <div className={cn('relative', className)} ref={ref}>
      {/* Compact trigger (mobile) */}
      <button
        type="button"
        onClick={() => setMobileOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1.5 text-body-sm font-semibold text-ink sm:hidden"
        aria-haspopup="menu"
        aria-expanded={mobileOpen}
      >
        <CalendarDays size={14} className="text-ink-muted" />
        {compactLabel}
        <ChevronDown size={14} className="text-ink-muted" />
      </button>

      {/* Mobile dropdown */}
      {mobileOpen && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-44 animate-scale-in overflow-hidden rounded-card border border-line bg-card p-1 shadow-overlay sm:hidden">
          {PRESETS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setMobileOpen(false) }}
              className={cn(
                'flex w-full items-center rounded-btn px-3 py-2 text-left text-body-md font-medium transition-colors',
                opt.value === value ? 'bg-primary/10 text-primary' : 'text-ink hover:bg-slate-100',
              )}
            >
              {opt.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => { setMobileOpen(false); setOpen(true) }}
            className={cn(
              'flex w-full items-center gap-2 rounded-btn px-3 py-2 text-left text-body-md font-medium transition-colors',
              customActive ? 'bg-primary/10 text-primary' : 'text-ink hover:bg-slate-100',
            )}
          >
            <CalendarDays size={14} /> Custom range…
          </button>
        </div>
      )}

      {/* Pill row (sm and up) */}
      <div className="hidden items-center gap-0.5 rounded-full border border-line bg-card p-1 sm:inline-flex">
        {PRESETS.map((opt) => {
          const active = opt.value === value
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={cn(
                'rounded-full px-3 py-1.5 text-body-sm font-semibold transition-colors',
                active ? 'bg-primary/10 text-primary' : 'text-ink-muted hover:text-ink',
              )}
            >
              {opt.label}
            </button>
          )
        })}

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-body-sm font-semibold transition-colors',
            customActive ? 'bg-primary/10 text-primary' : 'text-ink-muted hover:text-ink',
          )}
        >
          <CalendarDays size={14} />
          {customLabel}
        </button>
      </div>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 animate-scale-in rounded-card border border-line bg-card p-4 shadow-overlay">
          <p className="mb-3 text-body-sm font-semibold text-ink">Select date range</p>
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-body-sm text-ink-muted">Start</span>
              <input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} className="h-9 w-full rounded-btn border border-line bg-card px-2 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10" />
            </label>
            <label className="block">
              <span className="mb-1 block text-body-sm text-ink-muted">End</span>
              <input type="date" value={end} min={start} max={today} onChange={(e) => setEnd(e.target.value)} className="h-9 w-full rounded-btn border border-line bg-card px-2 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10" />
            </label>
            {error && <p className="text-body-sm text-danger">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setOpen(false)} className="rounded-btn px-3 py-1.5 text-body-sm font-semibold text-ink-muted hover:bg-slate-100">Cancel</button>
              <button type="button" onClick={apply} className="rounded-btn bg-primary px-3 py-1.5 text-body-sm font-semibold text-white hover:bg-primary-700">Apply</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
