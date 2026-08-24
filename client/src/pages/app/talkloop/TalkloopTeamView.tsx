import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Phone, PhoneCall, MonitorPlay, Percent, Trophy, Plane } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Badge, SubmissionBadge, PerfFlagBadge } from '../../../components/ui/Badge'
import { StatCard } from '../../../components/StatCard'
import { DataTable, type Column } from '../../../components/DataTable'
import { ListToolbar } from '../../../components/ListToolbar'
import { StackedBarChart } from '../../../components/charts/StackedBarChart'
import { useRange } from '../../../components/layout/AppShell'
import { useToast } from '../../../components/ui/Toast'
import { formatNumber, formatPercent } from '../../../lib/format'
import { getTalkloopTeam, type TalkloopTeamResponse, type TalkloopAgentRow } from '../../../lib/talkloopApi'

const RANGE_LABEL: Record<string, string> = {
  today: 'Today',
  week: 'This Week',
  month: 'This Month',
  rolling3m: 'Last 3 Months',
  custom: 'This Month',
}
const LEAVE_LABEL: Record<string, string> = { ON_LEAVE: 'On Leave', HOLIDAY: 'Holiday', OFF: 'Off' }
function leaveTitle(status: string | null, days: number): string {
  if (days > 1) return `${days} leave days in this period`
  return LEAVE_LABEL[status ?? 'ON_LEAVE'] ?? 'On Leave'
}

export default function TalkloopTeamView() {
  const { range, custom } = useRange()
  const { addToast } = useToast()
  const navigate = useNavigate()
  const [data, setData] = useState<TalkloopTeamResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

  const filteredAgents = useMemo(() => {
    const q = query.trim().toLowerCase()
    return !q ? data?.agents ?? [] : (data?.agents ?? []).filter((a) => a.name.toLowerCase().includes(q))
  }, [data, query])

  useEffect(() => {
    let active = true
    setLoading(true)
    getTalkloopTeam(range, custom)
      .then((res) => active && setData(res))
      .catch(() => active && addToast({ type: 'error', message: 'Could not load team data.' }))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [range, custom, addToast])

  const columns: Column<TalkloopAgentRow>[] = [
    {
      key: 'name',
      header: 'Member',
      render: (r) => (
        <div className="flex flex-col">
          <span className="flex items-center gap-1.5 font-medium text-ink">
            {r.name}
            {r.leaveDays > 0 && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-label-sm font-medium text-ink-muted" title={leaveTitle(r.leaveStatus, r.leaveDays)}>
                <Plane size={11} />
                {r.leaveDays > 1 && <span className="tabular-nums">{r.leaveDays}</span>}
              </span>
            )}
          </span>
          <span className="mt-0.5"><PerfFlagBadge flag={r.flag} /></span>
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (r) => <SubmissionBadge status={r.status} /> },
    { key: 'callsMade', header: 'Calls', align: 'right', render: (r) => formatNumber(r.totals.callsMade) },
    { key: 'connects', header: 'Connects', align: 'right', render: (r) => formatNumber(r.totals.connects) },
    { key: 'demosScheduled', header: 'Demos Sched.', align: 'right', render: (r) => formatNumber(r.totals.demosScheduled) },
    { key: 'demosConducted', header: 'Demos Done', align: 'right', render: (r) => formatNumber(r.totals.demosConducted) },
    { key: 'connectRate', header: 'Connect %', align: 'right', render: (r) => formatPercent(r.kpis.connectRate) },
    { key: 'showRate', header: 'Show %', align: 'right', render: (r) => formatPercent(r.kpis.showRate) },
  ]

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">Talkloop Team View</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">Calls, demos & per-country performance · {RANGE_LABEL[range] ?? 'This Month'}</p>
        </div>
        {data && <Badge tone="success" dot>Live</Badge>}
      </div>

      {loading || !data ? (
        <div className="text-body-md text-ink-muted">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Calls Made" value={formatNumber(data.team.totals.callsMade)} delta={data.deltas.callsMade} icon={<Phone size={16} />} />
            <StatCard label="Connect Rate" value={formatPercent(data.team.kpis.connectRate)} delta={data.deltas.connects} icon={<PhoneCall size={16} />} />
            <StatCard label="Demos Conducted" value={formatNumber(data.team.totals.demosConducted)} delta={data.deltas.demosConducted} icon={<MonitorPlay size={16} />} />
            <StatCard label="Show Rate" value={formatPercent(data.team.kpis.showRate)} delta={data.deltas.showRate} caption="conducted ÷ scheduled" icon={<Percent size={16} />} />
          </div>

          <Card title="By Country" subtitle="Calls vs demos per country in this period">
            {data.byCountry.length ? (
              <StackedBarChart
                data={data.byCountry as unknown as Record<string, string | number>[]}
                xKey="country"
                series={[
                  { key: 'calls', label: 'Calls' },
                  { key: 'demos', label: 'Demos' },
                ]}
              />
            ) : (
              <p className="py-10 text-center text-body-sm text-ink-muted">No country activity logged in this period yet.</p>
            )}
          </Card>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
            <div className="lg:col-span-3">
              <Card title="Team Performance Matrix" subtitle="Per-member calls & demos with team totals" flush>
                <div className="border-b border-line px-4 py-2.5">
                  <ListToolbar query={query} onQuery={setQuery} placeholder="Search members…" />
                </div>
                <DataTable
                  columns={columns}
                  rows={filteredAgents}
                  getRowId={(r) => r.id}
                  onRowClick={(r) => navigate(`/app/members/${r.id}`)}
                  emptyMessage={query ? 'No members match your search.' : 'No members in this team yet.'}
                  totalRow={{
                    cells: {
                      name: 'Team Totals',
                      status: '',
                      callsMade: formatNumber(data.team.totals.callsMade),
                      connects: formatNumber(data.team.totals.connects),
                      demosScheduled: formatNumber(data.team.totals.demosScheduled),
                      demosConducted: formatNumber(data.team.totals.demosConducted),
                      connectRate: formatPercent(data.team.kpis.connectRate),
                      showRate: formatPercent(data.team.kpis.showRate),
                    },
                  }}
                  renderRowBanner={(r) =>
                    r.onLeaveToday ? (
                      <div className="flex items-center gap-2 rounded-btn bg-warning/10 px-3 py-1.5 text-body-sm font-medium text-warning">
                        <Badge tone="warning">On Leave</Badge>
                        {r.name} is On Leave / Off today — excluded from averages.
                      </div>
                    ) : null
                  }
                />
              </Card>
            </div>
            <div>
              <Card title="Top Performers" subtitle="By calls this period">
                <ul className="space-y-3">
                  {data.topAgents.map((a, i) => (
                    <li key={a.id} className="flex items-center gap-3">
                      <span className={'flex h-7 w-7 items-center justify-center rounded-full text-body-sm font-semibold ' + (i === 0 ? 'bg-warning/15 text-warning' : 'bg-slate-100 text-ink-muted')}>
                        {i === 0 ? <Trophy size={14} /> : i + 1}
                      </span>
                      <span className="flex-1 truncate text-body-md text-ink">{a.name}</span>
                      <span className="text-body-md font-semibold tabular-nums text-ink">{formatNumber(a.calls)}</span>
                    </li>
                  ))}
                  {data.topAgents.length === 0 && <li className="text-body-sm text-ink-muted">No activity yet.</li>}
                </ul>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
