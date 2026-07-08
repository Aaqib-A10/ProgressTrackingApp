import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ListChecks, AlertTriangle, CalendarClock, CheckCircle2 } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { getMyTasks, type MyTasksResponse } from '../../lib/tasksApi'
import { cn } from '../../lib/cn'

const SOURCE_LABEL: Record<string, string> = { ecommerce: 'Ecommerce', marketing: 'Marketing' }

/** Full list of tasks assigned to the current user — /app/tasks. Private to them. */
export default function MyTasks() {
  const [data, setData] = useState<MyTasksResponse | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    getMyTasks()
      .then(setData)
      .catch(() => setFailed(true))
  }, [])

  if (failed) return <p className="text-body-md text-ink-muted">Could not load your tasks.</p>
  if (!data) return <p className="text-body-md text-ink-muted">Loading…</p>

  const { pending, stats } = data

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-headline-lg text-ink">My Tasks</h1>
        <p className="mt-1 text-body-md text-ink-muted">Tasks assigned to you across every board. Only you see this list.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile icon={<ListChecks size={18} />} label="Open" value={stats.openCount} />
        <StatTile icon={<CalendarClock size={18} />} label="Due today" value={stats.dueTodayCount} tone="warning" />
        <StatTile icon={<AlertTriangle size={18} />} label="Overdue" value={stats.overdueCount} tone="danger" />
        <StatTile icon={<CheckCircle2 size={18} />} label="Done this week" value={stats.completedThisWeek} tone="success" />
      </div>

      <Card title="Pending" subtitle={`${pending.length} open`}>
        {pending.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <CheckCircle2 size={26} className="text-success" />
            <p className="text-body-md text-ink-muted">You have no open tasks. Nice work.</p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {pending.map((t) => (
              <li key={`${t.source}-${t.id}`}>
                <Link to={t.link} className="flex items-center gap-3 py-3 transition-colors hover:bg-slate-50">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body-md font-medium text-ink">{t.title}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <Badge tone={t.source === 'ecommerce' ? 'accent' : 'primary'}>{SOURCE_LABEL[t.source] ?? t.source}</Badge>
                      <span className="text-body-sm text-ink-muted">{t.status}</span>
                    </div>
                  </div>
                  {t.dueDate && (
                    <span className={cn('shrink-0 text-body-sm', t.overdue ? 'font-semibold text-danger' : 'text-ink-muted')}>
                      {t.overdue ? `Overdue · ${t.dueDate}` : `Due ${t.dueDate}`}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="text-body-sm text-ink-muted">
        Completed — today <b className="text-ink tabular-nums">{stats.completedToday}</b> · this week{' '}
        <b className="text-ink tabular-nums">{stats.completedThisWeek}</b> · this month{' '}
        <b className="text-ink tabular-nums">{stats.completedThisMonth}</b>
      </p>
    </div>
  )
}

function StatTile({ icon, label, value, tone = 'primary' }: { icon: React.ReactNode; label: string; value: number; tone?: 'primary' | 'warning' | 'danger' | 'success' }) {
  const toneCls = { primary: 'text-primary', warning: 'text-warning', danger: 'text-danger', success: 'text-success' }[tone]
  return (
    <div className="rounded-card border border-line bg-card p-4 shadow-card">
      <div className={cn('flex items-center gap-1.5 text-body-sm', value > 0 || tone === 'primary' ? toneCls : 'text-ink-muted')}>
        {icon} {label}
      </div>
      <div className="mt-1 text-display-lg tabular-nums text-ink">{value}</div>
    </div>
  )
}
