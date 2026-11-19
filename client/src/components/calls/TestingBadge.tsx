import { FlaskConical } from 'lucide-react'
import { cn } from '../../lib/cn'

/** "Testing phase" next to AI notes: results are still being improved. */
export function TestingBadge({ className, dark }: { className?: string; dark?: boolean }) {
  return (
    <span
      className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide', dark ? 'bg-yellow-vivid text-yellow-on' : 'bg-yellow-muted text-yellow-ink', className)}
      title="AI notes are in testing: the words and the summary may not be fully right yet. Please check before relying on them."
    >
      <FlaskConical size={10} /> Testing phase
    </span>
  )
}
