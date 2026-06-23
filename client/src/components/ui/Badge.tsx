import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'accent'

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-ink-muted',
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger',
  accent: 'bg-accent/10 text-accent',
}

export interface BadgeProps {
  tone?: BadgeTone
  children: ReactNode
  className?: string
  /** Show a leading status dot. */
  dot?: boolean
}

/** Pill-shaped status chip (fully rounded per DESIGN.md). */
export function Badge({ tone = 'neutral', dot, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-body-sm font-medium',
        TONES[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}

// --- Domain status helpers (normalized labels) ---

/** Daily entry submission status → tone + label. */
export type SubmissionStatus = 'SUBMITTED' | 'PENDING' | 'FLAGGED' | 'ON_LEAVE'

export function SubmissionBadge({ status }: { status: SubmissionStatus }) {
  const map: Record<SubmissionStatus, { tone: BadgeTone; label: string }> = {
    SUBMITTED: { tone: 'success', label: 'Submitted' },
    PENDING: { tone: 'warning', label: 'Pending' },
    FLAGGED: { tone: 'danger', label: 'Flagged' },
    ON_LEAVE: { tone: 'neutral', label: 'On Leave' },
  }
  const { tone, label } = map[status]
  return (
    <Badge tone={tone} dot>
      {label}
    </Badge>
  )
}

/** Feedback sentiment → tone + label. */
export type FeedbackSentiment = 'PRAISE' | 'NEUTRAL' | 'IMPROVEMENT'

export function FeedbackSentimentBadge({ sentiment }: { sentiment: FeedbackSentiment }) {
  const map: Record<FeedbackSentiment, { tone: BadgeTone; label: string }> = {
    PRAISE: { tone: 'success', label: 'Praise' },
    NEUTRAL: { tone: 'neutral', label: 'Neutral' },
    IMPROVEMENT: { tone: 'warning', label: 'Needs Improvement' },
  }
  const { tone, label } = map[sentiment]
  return <Badge tone={tone}>{label}</Badge>
}

/** ITAD performance flag (integrity matrix) → tone + label (plan §4.3). */
export type PerfFlag = 'EXCEEDING' | 'OPTIMAL' | 'ATTENTION' | 'BELOW'

export function PerfFlagBadge({ flag }: { flag: PerfFlag }) {
  const map: Record<PerfFlag, { tone: BadgeTone; label: string }> = {
    EXCEEDING: { tone: 'success', label: 'Exceeding' },
    OPTIMAL: { tone: 'primary', label: 'Optimal' },
    ATTENTION: { tone: 'warning', label: 'Attention' },
    BELOW: { tone: 'danger', label: 'Below Target' },
  }
  const { tone, label } = map[flag]
  return <Badge tone={tone}>{label}</Badge>
}
