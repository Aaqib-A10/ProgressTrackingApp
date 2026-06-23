import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { MessageSquare, ChevronRight, MessagesSquare } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { FeedbackSentimentBadge } from '../../components/ui/Badge'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../components/ui/Toast'
import { listFeedback, type FeedbackThread } from '../../lib/feedbackApi'
import { fromNow } from '../../lib/datetime'

export default function Feedback() {
  const { user } = useAuth()
  const { addToast } = useToast()
  const [threads, setThreads] = useState<FeedbackThread[] | null>(null)

  useEffect(() => {
    let active = true
    listFeedback()
      .then((r) => active && setThreads(r.feedback))
      .catch(() => {
        if (active) {
          setThreads([])
          addToast({ type: 'error', message: 'Could not load feedback.' })
        }
      })
    return () => {
      active = false
    }
  }, [addToast])

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-headline-lg text-ink">Feedback</h1>
        <p className="mt-0.5 text-body-md text-ink-muted">Reviews and conversations between you and your team lead.</p>
      </div>

      {threads === null ? (
        <div className="text-body-md text-ink-muted">Loading…</div>
      ) : threads.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary"><MessagesSquare size={22} /></span>
            <p className="text-headline-md text-ink">No feedback yet</p>
            <p className="max-w-sm text-body-md text-ink-muted">When your team lead leaves feedback, it will show up here.</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {threads.map((t) => {
            // The "other" participant relative to the current user.
            const other = user && t.author.id === user.id ? t.recipient : t.author
            return (
              <Link
                key={t.id}
                to={`/app/feedback/${t.id}`}
                className="block rounded-card border border-line bg-card p-4 shadow-card transition-colors hover:border-primary/30"
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-body-sm font-semibold text-primary">
                    {initials(other.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <FeedbackSentimentBadge sentiment={t.sentiment} />
                      {t.unread && <span className="h-2 w-2 rounded-full bg-danger" aria-label="Unread" />}
                      <span className="text-body-sm text-ink-muted">
                        {t.author.id === user?.id ? `To ${t.recipient.name}` : `From ${t.author.name}`}
                      </span>
                      <span className="ml-auto text-body-sm text-ink-muted">{fromNow(t.updatedAt)}</span>
                    </div>
                    {t.title && <p className={'mt-1 text-body-md text-ink ' + (t.unread ? 'font-semibold' : 'font-medium')}>{t.title}</p>}
                    <p className="mt-0.5 line-clamp-2 text-body-sm text-ink-muted">{t.body}</p>
                    <p className="mt-1.5 flex items-center gap-1 text-body-sm text-ink-muted">
                      <MessageSquare size={13} /> {t.replyCount} {t.replyCount === 1 ? 'reply' : 'replies'}
                    </p>
                  </div>
                  <ChevronRight size={16} className="mt-1 shrink-0 text-ink-muted" />
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}
