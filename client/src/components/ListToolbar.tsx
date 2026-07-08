import { Search, X } from 'lucide-react'
import { cn } from '../lib/cn'

export interface FilterDef {
  /** Stable key for the filter. */
  key: string
  /** Placeholder / all-option label, e.g. "All roles". */
  allLabel: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}

/**
 * Shared search + filter bar for list/table pages. Renders a search box and any
 * number of filter dropdowns on one responsive row, with a "Clear" affordance
 * once anything is active.
 */
export function ListToolbar({
  query,
  onQuery,
  placeholder = 'Search…',
  filters = [],
  className,
  right,
}: {
  query: string
  onQuery: (value: string) => void
  placeholder?: string
  filters?: FilterDef[]
  className?: string
  /** Optional extra controls pinned to the right (e.g. a toggle). */
  right?: React.ReactNode
}) {
  const anyActive = query.trim() !== '' || filters.some((f) => f.value !== '')
  const clearAll = () => {
    onQuery('')
    filters.forEach((f) => f.onChange(''))
  }
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <div className="relative min-w-[200px] flex-1">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={placeholder}
          className="h-9 w-full rounded-btn border border-line bg-bg pl-9 pr-3 text-body-sm text-ink placeholder:text-ink-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </div>
      {filters.map((f) => (
        <select
          key={f.key}
          value={f.value}
          onChange={(e) => f.onChange(e.target.value)}
          className={cn(
            'h-9 rounded-btn border bg-card px-2 text-body-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20',
            f.value ? 'border-primary/50 font-semibold text-primary' : 'border-line text-ink',
          )}
        >
          <option value="">{f.allLabel}</option>
          {f.options.map((o) => (
            <option key={o.value} value={o.value} className="text-ink">
              {o.label}
            </option>
          ))}
        </select>
      ))}
      {anyActive && (
        <button onClick={clearAll} className="inline-flex items-center gap-1 rounded-btn px-2 py-1.5 text-body-sm font-semibold text-ink-muted hover:text-ink">
          <X size={14} /> Clear
        </button>
      )}
      {right}
    </div>
  )
}
