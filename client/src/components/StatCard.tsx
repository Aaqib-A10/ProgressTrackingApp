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

export type StatTone = 'indigo' | 'sky' | 'emerald' | 'amber' | 'rose' | 'violet'

/**
 * KPI card: small label, big tabular metric, ▲/▼ % delta (CLAUDE.md). Each card has a colour tone (index.css,
 * `tone-*`): given with `tone`, or taken in turn by its place in the row, so every page's numbers look the same.
 */
export function StatCard({ label, value, delta, deltaLabel, caption, icon, children, to, className, valueClassName, tone }: StatCardProps & { tone?: StatTone }) {
  const hasDelta = delta !== undefined || deltaLabel !== undefined
  const positive = (delta ?? 0) >= 0
  const inner = (
    <>
      {/* A soft glow of the card's colour in the corner. */}
      <span aria-hidden className="g-fill pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full opacity-[0.13] blur-2xl dark:opacity-[0.22]" />
      <div className="relative flex items-center justify-between gap-2">
        <span className="truncate text-[13px] font-medium text-ink-muted max-md:whitespace-normal max-md:leading-tight">{label}</span>
        {icon && (
          <span className="g-fill g-glow flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] [&>svg]:h-4 [&>svg]:w-4">
            {icon}
          </span>
        )}
      </div>

      <div className="relative mt-2.5 flex min-w-0 items-center justify-between gap-3">
        <span className={cn('min-w-0 tabular-nums text-ink', valueClassName ?? 'text-metric-lg')}>{value}</span>
        {hasDelta && (
          <span
            className={cn(
              'inline-flex h-6 shrink-0 items-center gap-0.5 rounded-full px-2 text-[12px] font-semibold tabular-nums',
              positive ? 'bg-success/15 text-success-ink' : 'bg-danger/15 text-danger-ink',
            )}
          >
            {positive ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
            {deltaLabel ?? formatSignedPercent(delta ?? 0)}
          </span>
        )}
      </div>

      {caption && <p className="relative mt-1 truncate text-[12.5px] text-ink-muted">{caption}</p>}
      {children && <div className="relative mt-3">{children}</div>}
    </>
  )

  const base = cn('stat-card g-wash g-ring g-bar relative overflow-hidden rounded-card border bg-card px-5 pb-4 pt-[18px] shadow-card', tone && `tone-${tone}`)
  if (to) {
    return (
      <Link
        to={to}
        data-tone={tone}
        className={cn(base, 'g-lift block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40', className)}
      >
        {inner}
      </Link>
    )
  }
  return <div data-tone={tone} className={cn(base, className)}>{inner}</div>
}
