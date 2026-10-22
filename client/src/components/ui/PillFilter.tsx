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

/** Segmented control (e.g. All / SEO / Social / Content): the picked option sits raised on a soft track. */
export function PillFilter<T extends string>({
  options,
  value,
  onChange,
  className,
  size = 'md',
}: PillFilterProps<T>) {
  return (
    <div className={cn('inline-flex flex-wrap gap-0.5 rounded-lg bg-slate-100 p-0.5 ring-1 ring-inset ring-line/60', className)}>
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={cn(
              'rounded-md font-medium transition-[background-color,color,box-shadow] duration-150',
              size === 'sm' ? 'px-2.5 py-[3px] text-[12.5px]' : 'px-3 py-1 text-body-md',
              active
                ? 'bg-card text-ink shadow-[0_1px_2px_rgb(var(--shadow)/0.08),0_0_0_1px_rgb(var(--line-strong)/0.5)]'
                : 'text-ink-muted hover:text-ink',
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
