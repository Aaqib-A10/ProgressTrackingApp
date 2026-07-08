import { useEffect, useMemo, useState } from 'react'
import { ShoppingCart, Store, Boxes, Users } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { StatCard } from '../../../components/StatCard'
import { Badge, SubmissionBadge } from '../../../components/ui/Badge'
import { DataTable, type Column } from '../../../components/DataTable'
import { ListToolbar } from '../../../components/ListToolbar'
import { useRange } from '../../../components/layout/AppShell'
import { useToast } from '../../../components/ui/Toast'
import { formatNumber } from '../../../lib/format'
import { getEcommerceTeam, type EcommerceTeamResponse, type EcommerceAgentRow, type EcomTask, type EcomTaskStatus } from '../../../lib/ecommerceApi'

const RANGE_LABEL: Record<string, string> = { today: 'Today', week: 'This Week', month: 'This Month', rolling3m: 'Last 3 Months', custom: 'This Month' }
const TASK_COLS: { status: EcomTaskStatus; label: string }[] = [
  { status: 'TODO', label: 'To Do' },
  { status: 'IN_PROGRESS', label: 'In Progress' },
  { status: 'DONE', label: 'Done' },
]
const initials = (n: string) => n.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()

export default function EcommerceTeamView() {
  const { range, custom } = useRange()
  const { addToast } = useToast()
  const [data, setData] = useState<EcommerceTeamResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

  const filteredAgents = useMemo(() => {
    const q = query.trim().toLowerCase()
    return !q ? data?.agents ?? [] : (data?.agents ?? []).filter((a) => a.name.toLowerCase().includes(q))
  }, [data, query])

  useEffect(() => {
    let active = true
    setLoading(true)
    getEcommerceTeam(range, custom)
      .then((r) => active && setData(r))
      .catch(() => active && addToast({ type: 'error', message: 'Could not load team data.' }))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [range, custom, addToast])

  const columns: Column<EcommerceAgentRow>[] = [
    { key: 'name', header: 'Agent', render: (r) => <span className="font-medium text-ink">{r.name}</span> },
    { key: 'status', header: 'Status', render: (r) => <SubmissionBadge status={r.status} /> },
    { key: 'daysLogged', header: 'Days', align: 'right', render: (r) => r.daysLogged },
    { key: 'totalListings', header: 'Actions', align: 'right', render: (r) => formatNumber(r.totalListings) },
  ]

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">Ecommerce Team View</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">Team tasks, listings & stock · {RANGE_LABEL[range] ?? 'This Month'}</p>
        </div>
        {data && <Badge tone="success" dot>Live</Badge>}
      </div>

      {loading || !data ? (
        <Card><p className="py-10 text-center text-body-md text-ink-muted">Loading…</p></Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total actions" value={formatNumber(data.team.totalActions)} icon={<ShoppingCart size={16} />} />
            <StatCard label="Top marketplace" value={data.team.topMarketplace ?? '—'} icon={<Store size={16} />} />
            <StatCard label="Team members" value={data.team.agents} icon={<Users size={16} />} />
            <StatCard to="/app/ecommerce/stock" label="Open stock requests" value={data.team.openStockRequests} icon={<Boxes size={16} />} />
          </div>

          <Card title="By work type" subtitle="Totals per type & marketplace this period">
            {data.byType.length === 0 ? (
              <p className="py-6 text-center text-body-sm text-ink-muted">No activity logged.</p>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {data.byType.map((t) => (
                  <div key={t.type} className="rounded-card border border-line p-3">
                    <div className="flex items-baseline justify-between">
                      <span className="text-body-md font-semibold text-ink">{t.type}</span>
                      <span className="text-headline-md tabular-nums text-ink">{formatNumber(t.total)}</span>
                    </div>
                    <ul className="mt-2 space-y-1 border-t border-line pt-2 text-body-sm">
                      {t.byMarketplace.map((m) => (
                        <li key={m.name} className="flex items-center justify-between">
                          <span className="text-ink-muted">{m.name}</span>
                          <span className="font-medium tabular-nums text-ink">{formatNumber(m.value)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Team tasks" subtitle={`${data.tasks.length} total · ${data.team.tasksTodo} to do · ${data.team.tasksInProgress} in progress · ${data.team.tasksDone} done`}>
            {data.tasks.length === 0 ? (
              <p className="py-6 text-center text-body-sm text-ink-muted">No tasks yet. The HOD assigns tasks on the Task Board.</p>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {TASK_COLS.map((col) => {
                  const colTasks = data.tasks.filter((t: EcomTask) => t.status === col.status)
                  return (
                    <div key={col.status} className="rounded-card border border-line bg-bg/50 p-2">
                      <div className="flex items-center justify-between px-2 py-1.5">
                        <span className="text-label-md uppercase text-ink-muted">{col.label}</span>
                        <span className="rounded-full bg-slate-200 px-2 text-body-sm font-semibold text-ink-muted">{colTasks.length}</span>
                      </div>
                      <ul className="space-y-1.5 p-1">
                        {colTasks.map((t) => (
                          <li key={t.id} className="rounded-btn border border-line bg-card p-2.5">
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-body-sm font-medium text-ink">{t.title}</span>
                              {t.assignee && (
                                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary" title={t.assignee.name}>{initials(t.assignee.name)}</span>
                              )}
                            </div>
                            {t.assignee && <p className="mt-0.5 text-[11px] text-ink-muted">{t.assignee.name}{t.dueDate ? ` · due ${t.dueDate}` : ''}</p>}
                          </li>
                        ))}
                        {colTasks.length === 0 && <li className="px-2 py-3 text-center text-body-sm text-ink-muted">—</li>}
                      </ul>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Card title="Per-agent listings" subtitle="Output across the period" flush>
                <div className="border-b border-line px-4 py-2.5">
                  <ListToolbar query={query} onQuery={setQuery} placeholder="Search agents…" />
                </div>
                <DataTable
                  columns={columns}
                  rows={filteredAgents}
                  getRowId={(r) => r.id}
                  emptyMessage={query ? 'No agents match your search.' : 'No team members yet.'}
                  totalRow={{ cells: { name: 'Team Totals', status: '', daysLogged: '', totalListings: formatNumber(data.team.totalListings) } }}
                  renderRowBanner={(r) => r.onLeaveToday ? (
                    <div className="flex items-center gap-2 rounded-btn bg-warning/10 px-3 py-1.5 text-body-sm font-medium text-warning">
                      <Badge tone="warning">On Leave</Badge>{r.name} is On Leave / Off today.
                    </div>
                  ) : null}
                />
              </Card>
            </div>
            <Card title="Listings by marketplace" subtitle="This period">
              {data.byMarketplace.length === 0 ? (
                <p className="py-8 text-center text-body-sm text-ink-muted">No listings logged.</p>
              ) : (
                <ul className="space-y-2">
                  {data.byMarketplace.map((m) => (
                    <li key={m.name} className="flex items-center justify-between">
                      <span className="text-body-md text-ink">{m.name}</span>
                      <span className="text-body-md font-semibold tabular-nums text-ink">{formatNumber(m.listings)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
