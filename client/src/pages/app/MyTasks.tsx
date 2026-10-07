import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ListChecks, AlertTriangle, CalendarClock, CheckCircle2, Send } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { getMyTasks, type MyTasksResponse, type PendingTask } from '../../lib/tasksApi'
import { projectsApi, type TaskCard } from '../../lib/projectsApi'
import { AvatarStack, DueChip } from '../../components/projects/pmUi'
import { cn } from '../../lib/cn'

const SOURCE_LABEL: Record<string, string> = { ecommerce: 'Ecommerce', marketing: 'Marketing', project: 'Project' }

type Bucket = 'Overdue' | 'Due today' | 'This week' | 'Later' | 'No due date'
const BUCKETS: Bucket[] = ['Overdue', 'Due today', 'This week', 'Later', 'No due date']

function bucketOf(t: PendingTask, today: string, weekEnd: string): Bucket {
  if (t.overdue) return 'Overdue'
  if (!t.dueDate) return 'No due date'
  if (t.dueDate <= today) return 'Due today'
  if (t.dueDate <= weekEnd) return 'This week'
  return 'Later'
}
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** /app/tasks — tasks assigned to me across every board, plus project tasks I assigned to others. */
export default function MyTasks() {
  const [tab, setTab] = useState<'mine' | 'byme'>('mine')
  const [data, setData] = useState<MyTasksResponse | null>(null)
  const [byMe, setByMe] = useState<(TaskCard & { project: { key: string; name: string; color: string } })[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => { getMyTasks().then(setData).catch(() => setFailed(true)) }, [])
  useEffect(() => { if (tab === 'byme' && !byMe) projectsApi.myTasks('created').then((r) => setByMe(r.tasks)).catch(() => setByMe([])) }, [tab, byMe])

  const grouped = useMemo(() => {
    const now = new Date()
    const today = isoDay(now)
    const end = new Date(now); end.setDate(end.getDate() + ((7 - end.getDay()) % 7))
    const weekEnd = isoDay(end)
    const m = new Map<Bucket, PendingTask[]>(BUCKETS.map((b) => [b, []]))
    for (const t of data?.pending ?? []) m.get(bucketOf(t, today, weekEnd))!.push(t)
    return m
  }, [data])

  if (failed) return <p className="text-body-md text-ink-muted">Could not load your tasks.</p>
  if (!data) return <p className="text-body-md text-ink-muted">Loading…</p>

  const { pending, stats } = data

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-headline-lg text-ink">My Tasks</h1>
        <p className="mt-1 text-body-md text-ink-muted">Tasks assigned to you across every board and project. Only you see this list.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile icon={<ListChecks size={18} />} label="Open" value={stats.openCount} />
        <StatTile icon={<CalendarClock size={18} />} label="Due today" value={stats.dueTodayCount} tone="warning" />
        <StatTile icon={<AlertTriangle size={18} />} label="Overdue" value={stats.overdueCount} tone="danger" />
        <StatTile icon={<CheckCircle2 size={18} />} label="Done this week" value={stats.completedThisWeek} tone="success" />
      </div>

      <div className="flex gap-1 border-b border-line" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'mine'} onClick={() => setTab('mine')} className={cn('-mb-px border-b-2 px-4 py-2 text-body-md font-medium', tab === 'mine' ? 'border-primary text-ink' : 'border-transparent text-ink-muted hover:text-ink')}>Assigned to me ({pending.length})</button>
        <button type="button" role="tab" aria-selected={tab === 'byme'} onClick={() => setTab('byme')} className={cn('-mb-px inline-flex items-center gap-1.5 border-b-2 px-4 py-2 text-body-md font-medium', tab === 'byme' ? 'border-primary text-ink' : 'border-transparent text-ink-muted hover:text-ink')}><Send size={14} /> Assigned by me</button>
      </div>

      {tab === 'mine' ? (
        pending.length === 0 ? (
          <Card>
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <CheckCircle2 size={26} className="text-success" />
              <p className="text-body-md text-ink-muted">You have no open tasks. Nice work.</p>
            </div>
          </Card>
        ) : (
          <div className="space-y-4">
            {BUCKETS.map((b) => {
              const list = grouped.get(b) ?? []
              if (!list.length) return null
              return (
                <Card key={b} title={<span className={cn(b === 'Overdue' && 'text-danger')}>{b}</span>} subtitle={`${list.length} task${list.length === 1 ? '' : 's'}`}>
                  <ul className="divide-y divide-line">
                    {list.map((t) => (
                      <li key={`${t.source}-${t.id}`}>
                        <Link to={t.link} className="flex items-center gap-3 py-3 transition-colors hover:bg-slate-50">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-body-md font-medium text-ink">{t.code && <span className="mr-2 font-mono text-body-sm text-ink-muted">{t.code}</span>}{t.title}</p>
                            <div className="mt-1 flex items-center gap-2">
                              <Badge tone={t.source === 'ecommerce' ? 'accent' : t.source === 'project' ? 'neutral' : 'primary'}>{t.projectName ?? SOURCE_LABEL[t.source] ?? t.source}</Badge>
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
                </Card>
              )
            })}
          </div>
        )
      ) : (
        <Card title="Tasks you assigned to other people" subtitle="Open project tasks, plus anything finished in the last 7 days">
          {!byMe ? <p className="text-body-sm text-ink-muted">Loading…</p> : byMe.length === 0 ? (
            <p className="py-8 text-center text-body-md text-ink-muted">You haven't assigned any project tasks to others yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {byMe.map((t) => (
                <li key={t.id}>
                  <Link to={`/app/projects/${t.project.key}?task=${t.code}`} className="flex items-center gap-3 py-3 hover:bg-slate-50">
                    <span className="h-8 w-1 shrink-0 rounded-full" style={{ backgroundColor: t.project.color }} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body-md font-medium text-ink"><span className="mr-2 font-mono text-body-sm text-ink-muted">{t.code}</span>{t.title}</p>
                      <div className="mt-1 flex items-center gap-2 text-body-sm text-ink-muted">
                        <span>{t.project.name}</span>·<span className={cn(t.category === 'DONE' && 'font-semibold text-success')}>{t.status}</span>
                      </div>
                    </div>
                    <DueChip dueAt={t.dueAt} category={t.category} />
                    <AvatarStack people={t.assignees} size={24} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

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
