import { cn } from '../../lib/cn'

export interface PillOption<T extends string> {
  value: T
  label: string
}

export interface PillFilterProps<T extends string> {
  options: PillOption<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
  size?: 'sm' | 'md'
}

/** Segmented pill filter (e.g. All / SEO / Social / Content). */
export function PillFilter<T extends string>({
  options,
  value,
  onChange,
  className,
  size = 'md',
}: PillFilterProps<T>) {
  return (
    <div className={cn('inline-flex flex-wrap gap-1.5', className)}>
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              'rounded-full font-medium transition-colors',
              size === 'sm' ? 'px-3 py-1 text-body-sm' : 'px-3.5 py-1.5 text-body-md',
              active
                ? 'bg-primary text-white'
                : 'bg-slate-100 text-ink-muted hover:bg-slate-200 hover:text-ink',
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
