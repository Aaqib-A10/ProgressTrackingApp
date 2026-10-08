import { useState } from 'react'
import { CheckCircle2, MessageSquareText, RotateCcw, Star, Trash2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { cn } from '../../lib/cn'
import type { ReviewVerdict, TaskReview } from '../../lib/projectsApi'
import { PersonAvatar, fieldCls, fmtAgo, fmtDateTime } from './pmUi'

export const VERDICT_META: Record<ReviewVerdict, { label: string; short: string; cls: string; icon: JSX.Element }> = {
  APPROVED: { label: 'Approved', short: 'Approved', cls: 'bg-success/10 text-success', icon: <CheckCircle2 size={13} /> },
  CHANGES_REQUESTED: { label: 'Changes requested', short: 'Changes', cls: 'bg-warning/15 text-amber-700', icon: <RotateCcw size={13} /> },
  COMMENT: { label: 'Feedback', short: 'Feedback', cls: 'bg-primary/10 text-primary', icon: <MessageSquareText size={13} /> },
}

const VERDICTS: ReviewVerdict[] = ['APPROVED', 'CHANGES_REQUESTED', 'COMMENT']

export function VerdictBadge({ verdict, short }: { verdict: ReviewVerdict; short?: boolean }) {
  const m = VERDICT_META[verdict]
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', m.cls)}>{m.icon}{short ? m.short : m.label}</span>
}

export function Stars({ value, onChange, size = 14 }: { value: number | null; onChange?: (v: number | null) => void; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={value ? `${value} out of 5` : 'No rating'}>
      {[1, 2, 3, 4, 5].map((n) => {
        const on = (value ?? 0) >= n
        const icon = <Star size={size} className={on ? 'fill-amber-400 text-amber-400' : 'text-slate-300'} />
        return onChange
          ? <button key={n} type="button" onClick={() => onChange(value === n ? null : n)} aria-label={`${n} star${n > 1 ? 's' : ''}`} className="rounded p-0.5 hover:bg-slate-100">{icon}</button>
          : <span key={n}>{icon}</span>
      })}
    </span>
  )
}

/** One review: who, verdict, optional stars, text, when. */
export function ReviewItem({ review, canDelete, onDelete }: { review: TaskReview; canDelete?: boolean; onDelete?: () => void }) {
  return (
    <li className="rounded-btn border border-line bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <PersonAvatar person={review.reviewer} size={22} />
        <span className="text-body-sm font-semibold text-ink">{review.reviewer.name}</span>
        <VerdictBadge verdict={review.verdict} />
        {review.rating != null && <Stars value={review.rating} size={12} />}
        <span className="ml-auto text-[11px] text-ink-muted" title={fmtDateTime(review.createdAt)}>{fmtAgo(review.createdAt)}</span>
        {canDelete && onDelete && <button type="button" onClick={onDelete} aria-label="Delete review"><Trash2 size={13} className="text-ink-muted hover:text-danger" /></button>}
      </div>
      <p className="mt-1.5 whitespace-pre-wrap break-words text-body-sm text-ink">{review.body}</p>
    </li>
  )
}

/** Verdict buttons + optional stars + text. */
export function ReviewForm({ onSubmit, onCancel }: { onSubmit: (v: { verdict: ReviewVerdict; rating: number | null; body: string }) => Promise<boolean>; onCancel: () => void }) {
  const [verdict, setVerdict] = useState<ReviewVerdict>('APPROVED')
  const [rating, setRating] = useState<number | null>(null)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="space-y-2 rounded-btn border border-primary/30 bg-primary/[0.03] p-3"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!body.trim()) return
        setBusy(true)
        const ok = await onSubmit({ verdict, rating, body: body.trim() })
        setBusy(false)
        if (ok) { setBody(''); setRating(null) }
      }}
    >
      <div className="flex flex-wrap gap-1">
        {VERDICTS.map((v) => (
          <button key={v} type="button" onClick={() => setVerdict(v)} className={cn('inline-flex h-8 items-center gap-1 rounded-btn border px-2.5 text-body-sm font-medium', verdict === v ? 'border-primary bg-card text-ink' : 'border-line bg-card text-ink-muted hover:text-ink')}>
            {VERDICT_META[v].icon}{VERDICT_META[v].label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 text-body-sm text-ink-muted">Rating <span className="text-[11px]">(optional)</span> <Stars value={rating} onChange={setRating} /></div>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={5000} placeholder="What's good, what needs to change?" className={cn(fieldCls, 'h-auto py-2')} aria-label="Review" autoFocus />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="submit" size="sm" disabled={busy || !body.trim()}>{busy ? 'Posting…' : 'Post review'}</Button>
      </div>
    </form>
  )
}
