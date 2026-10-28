import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardList, ClipboardCheck, ArrowRight, MessageSquare, LineChart } from 'lucide-react'
import { canOpen } from '../../lib/access'
import { useAuth } from '../../lib/auth'
import { ROLE_LABEL, type CurrentUser } from '../../lib/types'
import { Card } from '../../components/ui/Card'
import { Badge, FeedbackSentimentBadge } from '../../components/ui/Badge'
import { listFeedback, type FeedbackThread } from '../../lib/feedbackApi'
import { fromNow } from '../../lib/datetime'
import { DEPARTMENT_LABEL } from '../../lib/departments'
import { EmployeeOfMonthCard } from '../../components/EmployeeOfMonthCard'
import { AssignedTasksCard } from '../../components/AssignedTasksCard'
import { TodoList } from '../../components/TodoList'

/** Where this user logs their daily work — Marketing routes to its sub-department page. */
function logPath(user: CurrentUser): string | null {
  switch (user.department) {
    case 'ITAD':
      return '/app/itad/log'
    case 'LEAD_GEN':
      return '/app/leadgen/log'
    case 'ECOMMERCE':
      return '/app/ecommerce/log'
    case 'MARKETING':
      if (user.subDepartment === 'seo') return '/app/marketing/seo'
      // Social, Ads and Email have no daily log (Social works in the planner and monthly reports).
      if (user.subDepartment === 'social' || user.subDepartment === 'ads' || user.subDepartment === 'email') return null
      return '/app/marketing/content/log'
    default:
      return null
  }
}

function greeting(): string {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export default function DashboardHome() {
  const { user } = useAuth()
  if (!user) return null

  const log = logPath(user)

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <p className="text-body-sm font-medium text-ink-faint">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-ink">{greeting()}, {user.name.split(' ')[0]}</h1>
          <Badge tone="primary">{ROLE_LABEL[user.role]}</Badge>
        </div>
        <p className="mt-1 text-body-md text-ink-muted">
          {user.department ? `${DEPARTMENT_LABEL[user.department]} · ` : ''}Here&apos;s where you pick up your work.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {log && (
          <QuickAction
            to={log}
            icon={<ClipboardList size={17} />}
            title="Log today's progress"
            desc="Submit your daily entry in under a minute."
          />
        )}
        {canOpen(user, '/app/qa/my') && (
          <QuickAction
            to="/app/qa/my"
            icon={<ClipboardCheck size={17} />}
            title="My QA scores"
            desc="See how your calls were scored and what to work on."
          />
        )}
        {canOpen(user, '/app/analytics') && (
          <QuickAction
            to="/app/analytics"
            icon={<LineChart size={17} />}
            title="My analytics"
            desc="Track your KPIs, trends and targets over time."
          />
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <AssignedTasksCard />
        <Card title="My To-Do" subtitle="Private to you">
          <TodoList limit={6} />
        </Card>
      </div>

      <EmployeeOfMonthCard />

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
        <Link to="/app/feedback" className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-body-sm font-medium text-ink-muted hover:bg-slate-100 hover:text-ink">
          View all <ArrowRight size={13} />
        </Link>
      }
      subtitle={unread ? `${unread} unread` : undefined}
    >
      <div className="space-y-2">
        {threads.slice(0, 3).map((t) => (
          <Link key={t.id} to={`/app/feedback/${t.id}`} className="-mx-2 flex items-start gap-3 rounded-lg p-2 transition-colors hover:bg-slate-50">
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
      className="group flex items-start gap-3.5 rounded-card border border-line bg-card p-4 shadow-xs transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-raised"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
          <ArrowRight size={15} className="shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
        </div>
        <p className="mt-0.5 text-body-sm text-ink-muted">{desc}</p>
      </div>
    </Link>
  )
}
