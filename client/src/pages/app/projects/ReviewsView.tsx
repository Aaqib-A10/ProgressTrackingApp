import { useEffect, useState } from 'react'
import { ArrowRight, ClipboardCheck } from 'lucide-react'
import { errMsg, projectsApi, type ProjectReview, type ReviewVerdict } from '../../../lib/projectsApi'
import { PersonAvatar, fmtAgo, fmtDateTime } from '../../../components/projects/pmUi'
import { Stars, VERDICT_META, VerdictBadge } from '../../../components/projects/Reviews'
import { cn } from '../../../lib/cn'

/** Every review in the project: which task, who reviewed it, verdict and feedback. */
export function ReviewsView({ projectKey, refreshKey, onOpen }: { projectKey: string; refreshKey: string; onOpen: (code: string) => void }) {
  const [rows, setRows] = useState<ProjectReview[] | null>(null)
  const [error, setError] = useState('')
  const [verdict, setVerdict] = useState<ReviewVerdict | ''>('')
  const [who, setWho] = useState('')

  useEffect(() => {
    projectsApi.projectReviews(projectKey).then((r) => { setRows(r.reviews); setError('') }).catch((e) => setError(errMsg(e, 'Could not load reviews')))
  }, [projectKey, refreshKey])

  if (error) return <p className="rounded-card border border-danger/30 bg-danger/5 p-4 text-body-md text-danger">{error}</p>
  if (!rows) return <div className="h-40 animate-pulse rounded-card bg-slate-100" />

  const reviewers = [...new Map(rows.map((r) => [r.reviewer.id, r.reviewer])).values()]
  const shown = rows.filter((r) => (!verdict || r.verdict === verdict) && (!who || r.reviewer.id === who))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(['', 'APPROVED', 'CHANGES_REQUESTED', 'COMMENT'] as const).map((v) => (
          <button key={v || 'all'} type="button" onClick={() => setVerdict(v)} className={cn('inline-flex h-8 items-center gap-1 rounded-btn border px-2.5 text-body-sm font-medium', verdict === v ? 'border-primary bg-primary/5 text-primary' : 'border-line bg-card text-ink-muted hover:text-ink')}>
            {v ? <>{VERDICT_META[v].icon}{VERDICT_META[v].label}</> : 'All reviews'}
          </button>
        ))}
        {reviewers.length > 1 && (
          <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Reviewer" className="h-8 rounded-btn border border-line bg-card px-2 text-body-sm text-ink">
            <option value="">Reviewer: All</option>
            {reviewers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <span className="ml-auto text-body-sm text-ink-muted">{shown.length} review{shown.length === 1 ? '' : 's'}</span>
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-line bg-card py-12 text-center">
          <ClipboardCheck size={22} className="text-ink-muted" />
          <p className="text-body-md text-ink">{rows.length ? 'No reviews match these filters.' : 'No reviews yet'}</p>
          {!rows.length && <p className="text-body-sm text-ink-muted">Open any task and use Add review to approve the work or ask for changes.</p>}
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-card">
          {shown.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => onOpen(r.task.code)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50">
                <PersonAvatar person={r.reviewer} size={30} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm">
                    <b className="text-ink">{r.reviewer.name}</b>
                    <span className="text-ink-muted">reviewed</span>
                    <span className="rounded bg-slate-100 px-1.5 font-mono text-[11px] font-semibold text-ink-muted">{r.task.code}</span>
                    <span className="min-w-0 truncate font-medium text-ink">{r.task.title}</span>
                    <VerdictBadge verdict={r.verdict} />
                    {r.rating != null && <Stars value={r.rating} size={12} />}
                  </div>
                  <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-body-sm text-ink">{r.body}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-ink-muted">
                    Task assigned to {r.task.assignees.length ? r.task.assignees.map((a) => a.name).join(', ') : 'nobody'}
                    <ArrowRight size={10} /> now in {r.task.status}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] text-ink-muted" title={fmtDateTime(r.createdAt)}>{fmtAgo(r.createdAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
