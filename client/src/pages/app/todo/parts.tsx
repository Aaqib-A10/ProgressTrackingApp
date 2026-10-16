import { useState } from 'react'
import { Check, Clock, Eye, Hash, LifeBuoy, Lock, Pencil, Play, Redo2, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { cn } from '../../../lib/cn'
import type { WorkEntry, WorkPeriod, WorkRating, WorkReview } from '../../../lib/workLogApi'

/** Shared pieces of My To-Do (own list, board and the Team Lead's team view). */

export const NOUN: Record<WorkPeriod, string> = { DAY: 'day', WEEK: 'week', MONTH: 'month', YEAR: 'year' }

export function errMsg(e: unknown, fallback: string): string {
  const m = (e as { message?: string })?.message
  if (!m) return fallback
  try { return (JSON.parse(m) as { error?: string }).error || fallback } catch { return m }
}

export function linkify(text: string): React.ReactNode[] {
  return text.split(/(https?:\/\/[^\s)]+)/g).map((p, i) => (/^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noreferrer noopener" className="text-primary underline">{p}</a> : p))
}

/** Entry text that keeps its line breaks; long text is folded to a few lines with "Show more". */
export function EntryText({ text, done, className, lines = 4 }: { text: string; done?: boolean; className?: string; lines?: 3 | 4 }) {
  const [open, setOpen] = useState(false)
  const long = text.length > 220 || text.split(/\r?\n/).length > lines
  return (
    <div className={className}>
      <p className={cn('whitespace-pre-wrap break-words', done ? 'text-ink-muted' : 'font-medium text-ink', long && !open && (lines === 3 ? 'line-clamp-3' : 'line-clamp-4'))}>{linkify(text)}</p>
      {long && <button type="button" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }} className="mt-0.5 text-[12px] font-semibold text-primary">{open ? 'Show less' : 'Show more'}</button>}
    </div>
  )
}

export function Chips({ e }: { e: WorkEntry }) {
  if (!(e.tag || e.hours != null || e.quantity != null || e.private || (e.blocked && e.status !== 'DONE') || e.status === 'IN_PROGRESS')) return null
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
      {e.blocked && e.status !== 'DONE' && <span className="inline-flex items-center gap-0.5 rounded-full bg-danger/10 px-2 py-0.5 font-semibold text-danger"><LifeBuoy size={10} />Needs help</span>}
      {e.status === 'IN_PROGRESS' && <span className="rounded-full bg-warning/10 px-2 py-0.5 font-semibold text-warning">In progress</span>}
      {e.tag && <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary"><Hash size={10} />{e.tag}</span>}
      {e.quantity != null && <span className="rounded-full bg-accent/10 px-2 py-0.5 font-semibold text-accent">{e.quantity.toLocaleString()} items</span>}
      {e.hours != null && <span className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-ink-muted"><Clock size={10} />{e.hours} h</span>}
      {e.private && <span className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-ink-muted"><Lock size={10} />private</span>}
    </div>
  )
}

export function IconBtn({ label, onClick, children, danger, active }: { label: string; onClick: () => void; children: React.ReactNode; danger?: boolean; active?: boolean }) {
  return (
    <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onClick() }} title={label} aria-label={label}
      className={cn('rounded-btn p-1.5 hover:bg-slate-100', active ? 'text-danger' : 'text-ink-muted', danger ? 'hover:text-danger' : 'hover:text-ink')}>
      {children}
    </button>
  )
}

export interface EntryActions {
  onStatus: (e: WorkEntry, status: WorkEntry['status']) => void
  onBlocked: (e: WorkEntry) => void
  onCarry: (e: WorkEntry) => void
  onEdit: (e: WorkEntry) => void
  onDelete: (e: WorkEntry) => void
}

/** The small action buttons on a row or a card. */
export function RowActions({ e, a, compact }: { e: WorkEntry; a: EntryActions; compact?: boolean }) {
  return (
    <div className={cn('flex shrink-0 items-center gap-0.5', compact ? '' : 'opacity-60 group-hover:opacity-100')}>
      {e.status === 'PLANNED' && <IconBtn label="Start (In progress)" onClick={() => a.onStatus(e, 'IN_PROGRESS')}><Play size={15} /></IconBtn>}
      {e.status !== 'DONE' && <IconBtn label={e.blocked ? 'No longer needs help' : 'Needs help from my lead'} active={e.blocked} onClick={() => a.onBlocked(e)}><LifeBuoy size={15} /></IconBtn>}
      {e.status !== 'DONE' && <IconBtn label={`Move to next ${NOUN[e.period]}`} onClick={() => a.onCarry(e)}><Redo2 size={15} /></IconBtn>}
      <IconBtn label="Edit" onClick={() => a.onEdit(e)}><Pencil size={15} /></IconBtn>
      <IconBtn label="Delete" onClick={() => a.onDelete(e)} danger><Trash2 size={15} /></IconBtn>
    </div>
  )
}

export function DoneCheck({ e, readOnly, onToggle }: { e: WorkEntry; readOnly?: boolean; onToggle: () => void }) {
  return (
    <button type="button" disabled={readOnly} onPointerDown={(ev) => ev.stopPropagation()} onClick={(ev) => { ev.stopPropagation(); onToggle() }} aria-label={e.status === 'DONE' ? 'Mark as to do' : 'Mark as done'}
      className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
        e.status === 'DONE' ? 'border-success bg-success text-white' : e.status === 'IN_PROGRESS' ? 'border-warning hover:border-success' : 'border-line hover:border-success', readOnly && 'cursor-default')}>
      {e.status === 'DONE' && <Check size={12} strokeWidth={3} />}
      {e.status === 'IN_PROGRESS' && <span className="h-2 w-2 rounded-full bg-warning" />}
    </button>
  )
}

// ------------------------------------------------------------------ reviews

export const RATING_STYLE: Record<'GOOD' | 'NEEDS_WORK' | 'SEEN' | 'NONE', { bar: string; chip: string; label: string }> = {
  GOOD: { bar: 'border-l-success', chip: 'bg-success/10 text-success', label: 'Good work' },
  NEEDS_WORK: { bar: 'border-l-danger', chip: 'bg-danger/10 text-danger', label: 'Needs work' },
  SEEN: { bar: 'border-l-warning', chip: 'bg-warning/10 text-warning', label: 'Seen' },
  NONE: { bar: 'border-l-slate-200', chip: 'bg-slate-100 text-ink-muted', label: 'Not reviewed' },
}
export const ratingKey = (r: WorkReview | null) => (!r ? 'NONE' : r.rating ?? 'SEEN')

/** What the Team Lead said, shown to the person on their own day / week / month. */
export function ReviewNote({ review }: { review: WorkReview }) {
  const st = RATING_STYLE[ratingKey(review)]
  return (
    <div className={cn('mb-4 rounded-btn border border-line border-l-4 bg-card px-3 py-2', st.bar)}>
      <p className="text-body-sm text-ink"><span className={cn('mr-2 rounded-full px-2 py-0.5 text-[11px] font-bold', st.chip)}>{st.label}</span>Reviewed by <b>{review.reviewerName}</b></p>
      {review.comment && <p className="mt-1 whitespace-pre-wrap text-body-sm text-ink">{review.comment}</p>}
    </div>
  )
}

/** Team Lead: mark as seen, rate and comment. */
export function ReviewBox({ review, onSave, onClear, busy }: { review: WorkReview | null; onSave: (rating: WorkRating | null, comment: string) => void; onClear: () => void; busy?: boolean }) {
  const [rating, setRating] = useState<WorkRating | null>(review?.rating ?? null)
  const [comment, setComment] = useState(review?.comment ?? '')
  const changed = !review || rating !== review.rating || comment.trim() !== (review.comment ?? '')
  const pill = (on: boolean, cls: string) => cn('inline-flex h-8 items-center gap-1 rounded-full border px-3 text-body-sm font-semibold', on ? cls : 'border-line text-ink-muted hover:bg-slate-50')
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => setRating(rating === 'GOOD' ? null : 'GOOD')} className={pill(rating === 'GOOD', 'border-success bg-success/10 text-success')}><ThumbsUp size={14} /> Good work</button>
        <button type="button" onClick={() => setRating(rating === 'NEEDS_WORK' ? null : 'NEEDS_WORK')} className={pill(rating === 'NEEDS_WORK', 'border-danger bg-danger/10 text-danger')}><ThumbsDown size={14} /> Needs work</button>
        {review && <span className="ml-auto text-[11px] text-ink-muted">Reviewed by {review.reviewerName}</span>}
      </div>
      <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} rows={2} placeholder="Comment for them (optional)"
        className="w-full rounded-btn border border-line bg-card px-3 py-2 text-body-sm text-ink focus:border-primary focus:outline-none" />
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={busy || !changed} onClick={() => onSave(rating, comment.trim())} leadingIcon={<Eye size={14} />}>{review ? 'Update review' : rating ? 'Save review' : 'Mark as seen'}</Button>
        {review && <button type="button" onClick={onClear} disabled={busy} className="text-body-sm font-semibold text-ink-muted hover:text-danger">Remove review</button>}
      </div>
    </div>
  )
}
