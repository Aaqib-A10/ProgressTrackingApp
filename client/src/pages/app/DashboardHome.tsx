import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardList, Users, ArrowRight, MessageSquare, LineChart } from 'lucide-react'
import { useAuth } from '../../lib/auth'
import { ROLE_LABEL, type CurrentUser } from '../../lib/types'
import { Card } from '../../components/ui/Card'
import { Badge, FeedbackSentimentBadge } from '../../components/ui/Badge'
import { listFeedback, type FeedbackThread } from '../../lib/feedbackApi'
import { fromNow } from '../../lib/datetime'

const TL_ROLES = ['TEAM_LEAD', 'SUB_DEPT_LEAD', 'SUPER_ADMIN']

/** Where this user logs their daily work — Marketing routes to its sub-department page. */
function logPath(user: CurrentUser): string | null {
  switch (user.department) {
    case 'ITAD':
      return '/app/itad/log'
    case 'LEAD_GEN':
      return '/app/leadgen/log'
    case 'MARKETING':
      if (user.subDepartment === 'seo') return '/app/marketing/seo'
      if (user.subDepartment === 'social') return '/app/marketing/social'
      return '/app/marketing/content'
    default:
      return null
  }
}

/** Where this lead sees their team. */
function teamPath(user: CurrentUser): string | null {
  switch (user.department) {
    case 'ITAD':
      return '/app/itad/team'
    case 'LEAD_GEN':
      return '/app/leadgen/team'
    case 'MARKETING':
      return '/app/marketing/analytics'
    default:
      return null
  }
}

export default function DashboardHome() {
  const { user } = useAuth()
  if (!user) return null

  const log = logPath(user)
  const team = teamPath(user)
  const isLead = TL_ROLES.includes(user.role)

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-headline-lg text-ink">Welcome back, {user.name.split(' ')[0]}</h1>
          <Badge tone="primary">{ROLE_LABEL[user.role]}</Badge>
        </div>
        <p className="mt-1 text-body-md text-ink-muted">
          {user.department ? `${user.department.replace('_', ' ')} · ` : ''}Here&apos;s where you pick up your work.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {log && (
          <QuickAction
            to={log}
            icon={<ClipboardList size={20} />}
            title="Log today's progress"
            desc="Submit your daily entry in under a minute."
          />
        )}
        {isLead && team && (
          <QuickAction
            to={team}
            icon={<Users size={20} />}
            title="Team view"
            desc="See every member's progress and team totals."
          />
        )}
        {!isLead && log && (
          <QuickAction
            to="/app/analytics"
            icon={<LineChart size={20} />}
            title="My analytics"
            desc="Track your KPIs, trends and targets over time."
          />
        )}
      </div>

      <RecentFeedback />
    </div>
  )
}

/** Latest feedback threads for this user, with an unread count. */
function RecentFeedback() {
  const { user } = useAuth()
  const [threads, setThreads] = useState<FeedbackThread[] | null>(null)

  useEffect(() => {
    let active = true
    listFeedback()
      .then((r) => active && setThreads(r.feedback))
      .catch(() => active && setThreads([]))
    return () => {
      active = false
    }
  }, [])

  if (!threads || threads.length === 0) return null
  const unread = threads.filter((t) => t.unread).length

  return (
    <Card
      title="Recent feedback"
      action={
        <Link to="/app/feedback" className="inline-flex items-center gap-1 text-body-sm font-semibold text-primary hover:underline">
          View all <ArrowRight size={14} />
        </Link>
      }
      subtitle={unread ? `${unread} unread` : undefined}
    >
      <div className="space-y-2">
        {threads.slice(0, 3).map((t) => (
          <Link key={t.id} to={`/app/feedback/${t.id}`} className="flex items-start gap-3 rounded-btn p-2 transition-colors hover:bg-slate-50">
            <span className="mt-0.5 shrink-0"><FeedbackSentimentBadge sentiment={t.sentiment} /></span>
            <div className="min-w-0 flex-1">
              <p className={'text-body-md text-ink ' + (t.unread ? 'font-semibold' : 'font-medium')}>
                {t.title || (t.author.id === user?.id ? `To ${t.recipient.name}` : `From ${t.author.name}`)}
              </p>
              <p className="line-clamp-1 text-body-sm text-ink-muted">{t.body}</p>
            </div>
            <span className="mt-0.5 flex shrink-0 items-center gap-1.5 text-body-sm text-ink-muted">
              {t.unread && <span className="h-2 w-2 rounded-full bg-danger" />}
              <MessageSquare size={12} /> {fromNow(t.updatedAt)}
            </span>
          </Link>
        ))}
      </div>
    </Card>
  )
}

function QuickAction({ to, icon, title, desc }: { to: string; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <Link
      to={to}
      className="group rounded-card border border-line bg-card p-5 shadow-card transition-colors hover:border-primary/30"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-btn bg-primary/10 text-primary">{icon}</div>
      <div className="mt-3 flex items-center justify-between">
        <h3 className="text-headline-md text-ink">{title}</h3>
        <ArrowRight size={18} className="text-ink-muted transition-transform group-hover:translate-x-0.5" />
      </div>
      <p className="mt-1 text-body-sm text-ink-muted">{desc}</p>
    </Link>
  )
}
