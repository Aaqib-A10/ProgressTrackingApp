import { useMemo } from 'react'
import { CheckCircle2, Clock, MessageSquare, Paperclip } from 'lucide-react'
import { AvatarStack, PriorityIcon, fmtDateTime } from '../../../components/projects/pmUi'
import type { BoardColumn, TaskCard } from '../../../lib/projectsApi'
import { cn } from '../../../lib/cn'

/**
 * Every finished task of the project, newest first, grouped by when it was finished
 * (Today, Yesterday, This week, then by month). The board's Done column only keeps the
 * last day; nothing is deleted, it all stays here, in List view and in the reports.
 */
export function CompletedView({ tasks, columns, onOpen }: { tasks: TaskCard[]; columns: BoardColumn[]; onOpen: (code: string) => void }) {
  const doneCols = useMemo(() => new Set(columns.filter((c) => c.category === 'DONE').map((c) => c.id)), [columns])
  const done = useMemo(
    () => tasks
      .filter((t) => doneCols.has(t.columnId))
      .map((t) => ({ t, at: new Date(t.completedAt ?? t.updatedAt) }))
      .sort((a, b) => b.at.getTime() - a.at.getTime()),
    [tasks, doneCols],
  )

  const now = new Date()
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const today = startOfDay(now)
  const weekStart = today - ((now.getDay() + 6) % 7) * 86400000 // Monday
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  const groupOf = (d: Date): string => {
    const t = d.getTime()
    if (t >= today) return 'Today'
    if (t >= today - 86400000) return 'Yesterday'
    if (t >= weekStart) return 'Earlier this week'
    if (t >= monthStart) return 'Earlier this month'
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }
  const groups: { name: string; rows: typeof done }[] = []
  for (const r of done) {
    const g = groupOf(r.at)
    const last = groups[groups.length - 1]
    if (last && last.name === g) last.rows.push(r)
    else groups.push({ name: g, rows: [r] })
  }

  const thisWeek = done.filter((r) => r.at.getTime() >= weekStart).length
  const thisMonth = done.filter((r) => r.at.getTime() >= monthStart).length
  const withDue = done.filter((r) => r.t.dueAt)
  const onTime = withDue.filter((r) => r.at.getTime() <= new Date(r.t.dueAt!).getTime()).length
  const late = (r: (typeof done)[number]) => !!r.t.dueAt && r.at.getTime() > new Date(r.t.dueAt).getTime()

  if (done.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-line bg-card py-14 text-center">
        <CheckCircle2 size={28} className="text-ink-muted" />
        <p className="text-body-lg text-ink">No finished tasks yet</p>
        <p className="text-body-md text-ink-muted">Tasks moved to Done show up here, grouped by when they were finished.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Finished in total" value={done.length} />
        <Stat label="This week" value={thisWeek} />
        <Stat label="This month" value={thisMonth} />
        <Stat label="On time" value={withDue.length ? `${Math.round((onTime / withDue.length) * 100)}%` : '—'} hint={withDue.length ? `${onTime} of ${withDue.length} with a due date` : 'No due dates set'} />
      </div>

      {groups.map((g) => (
        <section key={g.name} className="overflow-hidden rounded-card border border-line bg-card">
          <header className="flex items-center justify-between border-b border-line bg-slate-50/80 px-4 py-2">
            <h3 className="text-label-md uppercase text-ink-muted">{g.name}</h3>
            <span className="text-body-sm text-ink-muted">{g.rows.length} {g.rows.length === 1 ? 'task' : 'tasks'}</span>
          </header>
          <ul className="divide-y divide-line">
            {g.rows.map((r) => (
              <li key={r.t.id}>
                <button type="button" onClick={() => onOpen(r.t.code)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50">
                  <CheckCircle2 size={16} className="shrink-0 text-success" />
                  <span className="w-16 shrink-0 font-mono text-[11px] font-semibold text-ink-muted">{r.t.code}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-md font-medium text-ink">{r.t.title}</span>
                    <span className="block truncate text-body-sm text-ink-muted">
                      {r.t.assignees.length ? r.t.assignees.map((a) => a.name).join(', ') : 'Unassigned'}
                    </span>
                  </span>
                  <PriorityIcon priority={r.t.priority} />
                  <span className="hidden items-center gap-3 text-[11px] text-ink-muted md:inline-flex">
                    {r.t.counts.comments > 0 && <span className="inline-flex items-center gap-1"><MessageSquare size={12} />{r.t.counts.comments}</span>}
                    {r.t.counts.attachments > 0 && <span className="inline-flex items-center gap-1"><Paperclip size={12} />{r.t.counts.attachments}</span>}
                  </span>
                  {late(r) && <span className="hidden rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning sm:inline">Late</span>}
                  <span className="hidden w-40 shrink-0 text-right text-body-sm text-ink-muted sm:inline-flex sm:items-center sm:justify-end sm:gap-1" title="Finished">
                    <Clock size={12} />{fmtDateTime(r.at.toISOString())}
                  </span>
                  <span className="hidden lg:block">{r.t.assignees.length > 0 && <AvatarStack people={r.t.assignees} max={3} size={22} />}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className={cn('rounded-card border border-line bg-card px-4 py-3')}>
      <p className="text-label-md uppercase text-ink-muted">{label}</p>
      <p className="mt-1 text-headline-md tabular-nums text-ink">{value}</p>
      {hint && <p className="text-body-sm text-ink-muted">{hint}</p>}
    </div>
  )
}
