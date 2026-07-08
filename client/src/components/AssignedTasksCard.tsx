import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ListChecks, AlertTriangle, CalendarClock } from 'lucide-react'
import { Card } from './ui/Card'
import { getMyTasks, type MyTasksResponse } from '../lib/tasksApi'
import { cn } from '../lib/cn'

const SOURCE_LABEL: Record<string, string> = { ecommerce: 'Ecommerce', marketing: 'Marketing' }

/** Dashboard widget: tasks assigned to the current user (private to them). */
export function AssignedTasksCard({ limit = 5 }: { limit?: number }) {
  const [data, setData] = useState<MyTasksResponse | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    getMyTasks()
      .then(setData)
      .catch(() => setFailed(true))
  }, [])

  if (failed) return null
  if (!data) return null
  // Nothing assigned and nothing done recently — keep the dashboard clean.
  if (data.stats.openCount === 0 && data.stats.completedThisMonth === 0) return null

  const { pending, stats } = data
  const shown = pending.slice(0, limit)

  return (
    <Card
      title="My tasks"
      subtitle="Assigned to you"
      action={
        <Link to="/app/tasks" className="inline-flex items-center gap-1 text-body-sm font-semibold text-primary hover:underline">
          View all <ArrowRight size={14} />
        </Link>
      }
    >
      <div className="mb-4 grid grid-cols-3 gap-2">
        <Stat icon={<ListChecks size={16} />} label="Open" value={stats.openCount} tone="primary" />
        <Stat icon={<CalendarClock size={16} />} label="Due today" value={stats.dueTodayCount} tone="warning" />
        <Stat icon={<AlertTriangle size={16} />} label="Overdue" value={stats.overdueCount} tone="danger" />
      </div>

      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-body-sm text-ink-muted">
        <span>Completed — today <b className="text-ink tabular-nums">{stats.completedToday}</b></span>
        <span>this week <b className="text-ink tabular-nums">{stats.completedThisWeek}</b></span>
        <span>this month <b className="text-ink tabular-nums">{stats.completedThisMonth}</b></span>
      </div>

      {shown.length === 0 ? (
        <p className="py-2 text-body-sm text-ink-muted">No open tasks. Nice work.</p>
      ) : (
        <ul className="space-y-1">
          {shown.map((t) => (
            <li key={`${t.source}-${t.id}`}>
              <Link to={t.link} className="flex items-center gap-3 rounded-btn p-2 transition-colors hover:bg-slate-50">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body-md font-medium text-ink">{t.title}</p>
                  <p className="text-body-sm text-ink-muted">{SOURCE_LABEL[t.source] ?? t.source} · {t.status}</p>
                </div>
                {t.dueDate && (
                  <span className={cn('shrink-0 text-body-sm', t.overdue ? 'font-semibold text-danger' : 'text-ink-muted')}>
                    {t.overdue ? 'Overdue' : t.dueDate}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function Stat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: 'primary' | 'warning' | 'danger' }) {
  const toneCls = {
    primary: 'text-primary',
    warning: 'text-warning',
    danger: value > 0 ? 'text-danger' : 'text-ink-muted',
  }[tone]
  return (
    <div className="rounded-btn border border-line bg-bg p-3">
      <div className={cn('flex items-center gap-1.5 text-body-sm', toneCls)}>
        {icon} {label}
      </div>
      <div className={cn('mt-1 text-headline-lg tabular-nums', value > 0 ? 'text-ink' : 'text-ink-muted')}>{value}</div>
    </div>
  )
}
