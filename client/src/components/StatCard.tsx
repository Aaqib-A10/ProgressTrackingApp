import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { TrendingUp, TrendingDown } from 'lucide-react'
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
}

/** KPI card: small label, big tabular metric, ▲/▼ % delta (CLAUDE.md). */
export function StatCard({ label, value, delta, deltaLabel, caption, icon, children, to, className }: StatCardProps) {
  const hasDelta = delta !== undefined || deltaLabel !== undefined
  const positive = (delta ?? 0) >= 0
  const inner = (
    <>
      <div className="flex items-center justify-between">
        <span className="text-label-md uppercase text-ink-muted">{label}</span>
        {icon && (
          <span className="flex h-8 w-8 items-center justify-center rounded-btn bg-primary/10 text-primary">
            {icon}
          </span>
        )}
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <span className="text-metric-lg tabular-nums text-ink">{value}</span>
        {hasDelta && (
          <span
            className={cn(
              'mb-1 inline-flex items-center gap-0.5 text-body-sm font-semibold tabular-nums',
              positive ? 'text-success' : 'text-danger',
            )}
          >
            {positive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            {deltaLabel ?? formatSignedPercent(delta ?? 0)}
          </span>
        )}
      </div>

      {caption && <p className="mt-1 text-body-sm text-ink-muted">{caption}</p>}
      {children && <div className="mt-3">{children}</div>}
    </>
  )

  const base = 'rounded-card border border-line bg-card p-5 shadow-card'
  if (to) {
    return (
      <Link
        to={to}
        className={cn(
          base,
          'block transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          className,
        )}
      >
        {inner}
      </Link>
    )
  }
  return <div className={cn(base, className)}>{inner}</div>
}
