import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { TrendingUp, TrendingDown, Sparkles, ArrowRight, Users, Building2, ClipboardCheck, Percent, AlertTriangle } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { StatCard } from '../../components/StatCard'
import { DataTable, type Column } from '../../components/DataTable'
import { TrendLineChart } from '../../components/charts/TrendLineChart'
import { useRange } from '../../components/layout/AppShell'
import { useToast } from '../../components/ui/Toast'
import { formatNumber, formatPercent, formatSignedPercent } from '../../lib/format'
import { getExecutiveDashboard, type ExecutiveDashboardData, type ExecBenchmarkRow, type DashKpi } from '../../lib/dashboardApi'
import { EmployeeOfMonthCard } from '../../components/EmployeeOfMonthCard'

function Delta({ value }: { value: number }) {
  const pos = value >= 0
  return (
    <span className={'inline-flex items-center gap-0.5 text-body-sm font-semibold tabular-nums ' + (pos ? 'text-success' : 'text-danger')}>
      {pos ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
      {formatSignedPercent(value)}
    </span>
  )
}

const fmt = (k: { value: number; format: 'number' | 'percent' }) =>
  k.format === 'percent' ? formatPercent(k.value) : formatNumber(k.value)

export default function ExecutiveDashboard() {
  const { range, custom } = useRange()
  const { addToast } = useToast()
  const [data, setData] = useState<ExecutiveDashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    getExecutiveDashboard(range, custom)
      .then((res) => active && setData(res))
      .catch(() => active && addToast({ type: 'error', message: 'Could not load executive view.' }))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [range, custom, addToast])

  const benchCols: Column<ExecBenchmarkRow>[] = [
    { key: 'department', header: 'Department', render: (r) => <span className="font-medium text-ink">{r.department}</span> },
    { key: 'members', header: 'Team', align: 'right', render: (r) => formatNumber(r.members) },
    { key: 'submitted', header: 'Submitted Today', align: 'right', render: (r) => r.submitted },
    { key: 'primary', header: 'Volume', align: 'right', render: (r) => `${formatNumber(r.primaryValue)} ${r.primaryLabel.toLowerCase()}` },
    { key: 'secondary', header: 'Key metric', align: 'right', render: (r) => r.secondary },
    { key: 'delta', header: 'Trend', align: 'right', render: (r) => <Delta value={r.delta} /> },
  ]

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-headline-lg text-ink">Executive Overview</h1>
        <p className="mt-0.5 text-body-md text-ink-muted">Company-wide performance across all departments</p>
      </div>

      {data && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
          <StatCard label="Employees" value={formatNumber(data.summary.employees)} caption={`${data.summary.departments} departments`} icon={<Users size={16} />} />
          <StatCard label="Departments" value={data.summary.departments} caption="Active teams" icon={<Building2 size={16} />} />
          <StatCard label="Submitted today" value={`${data.summary.submittedToday}/${data.summary.formMembers}`} caption="Daily-log teams" icon={<ClipboardCheck size={16} />} />
          <StatCard label="On-time rate" value={formatPercent(data.summary.onTimeRate / 100)} caption="Logged today" icon={<Percent size={16} />} />
          <StatCard label="Needs attention" value={data.summary.alerts} caption={`${data.summary.pendingApprovals} approvals · ${data.summary.stockRequested} stock`} icon={<AlertTriangle size={16} />} />
        </div>
      )}

      <EmployeeOfMonthCard />

      {loading || !data ? (
        <div className="text-body-md text-ink-muted">Loading…</div>
      ) : (
        <>
          {/* Department summary cards — click through to each department's data */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {data.departments.map((d) => {
              const to = d.route
              const body = (
                <>
                  {d.headline.length ? (
                    <div className="space-y-3">
                      {d.headline.map((k: DashKpi) => (
                        <div key={k.label} className="flex items-center justify-between">
                          <span className="text-body-sm text-ink-muted">{k.label}</span>
                          <span className="flex items-center gap-2">
                            <span className="text-body-lg font-semibold tabular-nums text-ink">{fmt(k)}</span>
                            <Delta value={k.delta} />
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-body-sm text-ink-muted">{d.improvement}</p>
                  )}
                  {to && (
                    <span className="mt-4 inline-flex items-center gap-1 text-body-sm font-semibold text-primary">
                      View {d.name} <ArrowRight size={14} />
                    </span>
                  )}
                </>
              )
              return to ? (
                <Link
                  key={d.type}
                  to={to}
                  className="block rounded-card transition-shadow hover:shadow-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <Card title={d.name} subtitle={d.subtitle} className="h-full hover:border-primary/30">
                    {body}
                  </Card>
                </Link>
              ) : (
                <Card key={d.type} title={d.name} subtitle={d.subtitle}>
                  {body}
                </Card>
              )
            })}
          </div>

          {/* Combined trend */}
          <Card title="Company Activity" subtitle="Total submissions over time">
            <TrendLineChart data={data.combinedTrend.points} />
          </Card>

          {/* Executive insights */}
          <Card className="border-primary/20 bg-primary/5">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-btn bg-primary/10 text-primary">
                <Sparkles size={18} />
              </span>
              <div>
                <p className="text-body-sm font-semibold uppercase tracking-wide text-primary">Executive Insights</p>
                <ul className="mt-1 space-y-0.5 text-body-md text-ink">
                  {data.insights.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </div>
            </div>
          </Card>

          {/* Departmental benchmark */}
          <Card title="Departmental Benchmark" flush>
            <DataTable columns={benchCols} rows={data.benchmark} getRowId={(r) => r.department} />
          </Card>
        </>
      )}
    </div>
  )
}
