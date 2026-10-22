import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, ArrowDownRight } from 'lucide-react'
import { cn } from '../lib/cn'
import { formatSignedPercent } from '../lib/format'

export interface StatCardProps {
  label: string
  value: ReactNode
  /** Signed fraction for the period-over-period delta, e.g. +0.125. */
  delta?: number
  /** Override the formatted delta text. */
  deltaLabel?: string
  /** Small caption under the value, e.g. "vs last month" or "Target 30%". */
  caption?: ReactNode
  /** Leading icon (e.g. a lucide icon in a tinted square). */
  icon?: ReactNode
  /** Optional sparkline / mini-chart area below the value. */
  children?: ReactNode
  /** When set, the card becomes a link that drills into more detail. */
  to?: string
  className?: string
  /** Override the value's text size (default text-metric-lg). Use a smaller token on dense/narrow rows. */
  valueClassName?: string
}

/** KPI card: small label, big tabular metric, ▲/▼ % delta (CLAUDE.md). */
export function StatCard({ label, value, delta, deltaLabel, caption, icon, children, to, className, valueClassName }: StatCardProps) {
  const hasDelta = delta !== undefined || deltaLabel !== undefined
  const positive = (delta ?? 0) >= 0
  const inner = (
    <>
      <div className="flex items-center justify-between">
        <span className="truncate text-[13px] font-medium text-ink-muted">{label}</span>
        {icon && (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-slate-50 text-ink-muted [&>svg]:h-[15px] [&>svg]:w-[15px]">
            {icon}
          </span>
        )}
      </div>

      <div className="mt-2.5 flex min-w-0 items-center justify-between gap-3">
        <span className={cn('min-w-0 tabular-nums text-ink', valueClassName ?? 'text-metric-lg')}>{value}</span>
        {hasDelta && (
          <span
            className={cn(
              'inline-flex h-6 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-[12px] font-medium tabular-nums',
              positive ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger',
            )}
          >
            {positive ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
            {deltaLabel ?? formatSignedPercent(delta ?? 0)}
          </span>
        )}
      </div>

      {caption && <p className="mt-1 truncate text-[12.5px] text-ink-faint">{caption}</p>}
      {children && <div className="mt-3">{children}</div>}
    </>
  )

  const base = 'rounded-card border border-line bg-card px-5 py-4 shadow-xs'
  if (to) {
    return (
      <Link
        to={to}
        className={cn(
          base,
          'block transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          className,
        )}
      >
        {inner}
      </Link>
    )
  }
  return <div className={cn(base, className)}>{inner}</div>
}
