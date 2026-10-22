import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

/** A calm empty state: an icon, what is missing, and (optionally) the one thing to do next. */
export function EmptyState({ icon, title, hint, action, className, compact }: { icon?: ReactNode; title: string; hint?: ReactNode; action?: ReactNode; className?: string; compact?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'gap-1 py-6' : 'gap-1.5 py-10', className)}>
      {icon && <span className={cn('mb-1.5 flex items-center justify-center rounded-lg border border-line bg-slate-50 text-ink-faint shadow-xs', compact ? 'h-9 w-9 [&>svg]:h-4 [&>svg]:w-4' : 'h-11 w-11 [&>svg]:h-5 [&>svg]:w-5')}>{icon}</span>}
      <p className="text-body-md font-medium text-ink">{title}</p>
      {hint && <p className="max-w-xs text-body-sm text-ink-muted">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
