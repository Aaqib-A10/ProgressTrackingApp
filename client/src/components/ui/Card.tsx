import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Optional header title shown with standard padding. */
  title?: ReactNode
  /** Optional right-aligned header content (actions, filters). */
  action?: ReactNode
  /** Subtitle under the title. */
  subtitle?: ReactNode
  /** Remove inner padding (e.g. for a flush DataTable). */
  flush?: boolean
}

// Level-1 surface: white, 1px border, 12px radius, soft shadow (DESIGN.md).
export function Card({ title, subtitle, action, flush, className, children, ...props }: CardProps) {
  const hasHeader = title != null || action != null
  return (
    <div
      className={cn('rounded-card border border-line bg-card shadow-card', className)}
      {...props}
    >
      {hasHeader && (
        <div className="flex items-start justify-between gap-4 px-5 pt-5">
          <div>
            {title != null && <h3 className="text-headline-md text-ink">{title}</h3>}
            {subtitle != null && <p className="mt-0.5 text-body-sm text-ink-muted">{subtitle}</p>}
          </div>
          {action != null && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={cn(!flush && 'p-5', hasHeader && !flush && 'pt-4')}>{children}</div>
    </div>
  )
}
