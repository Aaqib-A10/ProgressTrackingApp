import { BellOff } from 'lucide-react'
import { cn } from '../../lib/cn'

export interface NotifyTab<K extends string> {
  key: K
  label: string
  /** Full name, shown on hover when `label` is shortened. */
  title?: string
  count?: number
  muted?: boolean
}

/** Pill tabs for the bell and the Notifications page (one per category). Scrolls sideways on narrow screens. */
export function NotifyTabs<K extends string>({ tabs, value, onChange, className }: { tabs: NotifyTab<K>[]; value: K; onChange: (k: K) => void; className?: string }) {
  return (
    <div role="tablist" aria-label="Notification types" className={cn('flex gap-1.5 overflow-x-auto', className)}>
      {tabs.map((t) => {
        const on = t.key === value
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={on}
            title={t.title ?? t.label}
            onClick={() => onChange(t.key)}
            className={cn(
              'inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-body-sm font-semibold transition-colors',
              on ? 'border-primary bg-primary text-white' : 'border-line bg-card text-ink-muted hover:bg-primary/5 hover:text-ink',
            )}
          >
            {t.muted && <BellOff size={12} aria-label="Muted" />}
            {t.label}
            {!!t.count && (
              <span className={cn('min-w-[18px] rounded-full px-1 text-center text-[10.5px] leading-[18px] tabular-nums', on ? 'bg-white/20 text-white' : t.muted ? 'bg-line text-ink-muted' : 'bg-primary/10 text-primary')}>
                {t.count > 99 ? '99+' : t.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
