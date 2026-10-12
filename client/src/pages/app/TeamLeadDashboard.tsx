import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { StatCard } from '../../components/StatCard'
import { SubmissionBadge } from '../../components/ui/Badge'
import { DataTable, type Column } from '../../components/DataTable'
import { TrendLineChart } from '../../components/charts/TrendLineChart'
import { DonutChart } from '../../components/charts/DonutChart'
import { useRange } from '../../components/layout/AppShell'
import { useToast } from '../../components/ui/Toast'
import { useAuth } from '../../lib/auth'
import { formatNumber, formatPercent } from '../../lib/format'
import { getTeamDashboard, type TeamDashboard, type DashSubmission } from '../../lib/dashboardApi'
import { EmployeeOfMonthCard } from '../../components/EmployeeOfMonthCard'
import { DEPARTMENT_LABEL } from '../../lib/departments'

const RANGE_LABEL: Record<string, string> = {
  today: 'Today',
  week: 'This Week',
  month: 'This Month',
  rolling3m: 'Last 3 Months',
  custom: 'This Month',
}

export default function TeamLeadDashboard() {
  const { range, custom } = useRange()
  const { addToast } = useToast()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [data, setData] = useState<TeamDashboard | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    getTeamDashboard(range, custom)
      .then((res) => active && setData(res))
      .catch(() => active && addToast({ type: 'error', message: 'Could not load dashboard.' }))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [range, custom, addToast])

  const fmt = (k: { value: number; format: 'number' | 'percent' }) =>
    k.format === 'percent' ? formatPercent(k.value) : formatNumber(k.value)

  const showStatus = data?.people?.showStatus ?? true
  // Only a team lead (or the Super Admin) can open someone's profile.
  const canOpenProfile = user?.role === 'TEAM_LEAD' || user?.role === 'SUPER_ADMIN'
  const subColumns: Column<DashSubmission>[] = [
    { key: 'name', header: 'Team Member', render: (r) => <span className="font-medium text-ink">{r.name}</span> },
    ...(showStatus ? [{ key: 'status', header: 'Status', render: (r: DashSubmission) => <SubmissionBadge status={r.status} /> }] : []),
    {
      key: 'metric',
      header: data?.todaySubmissions[0]?.metricLabel ?? 'Today',
      align: 'right',
      render: (r) => formatNumber(r.metricValue),
    },
  ]

  const breakdownTotal = data?.breakdown.reduce((a, b) => a + b.value, 0) ?? 0

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-headline-lg text-ink">Team Performance Overview</h1>
        <p className="mt-0.5 text-body-md text-ink-muted">
          {user?.department ? DEPARTMENT_LABEL[user.department] : ''} · {RANGE_LABEL[range] ?? 'This Month'}
        </p>
      </div>

      <EmployeeOfMonthCard />

      {loading || !data ? (
        <div className="text-body-md text-ink-muted">Loading…</div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {data.kpis.map((k) => (
              <StatCard key={k.label} label={k.label} value={fmt(k)} delta={k.now ? undefined : k.delta} caption={k.caption} />
            ))}
          </div>

          {/* Trend + breakdown */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card
              title={`${data.trend.metricLabel} over time`}
              subtitle={data.trend.points.some((p) => p.target !== undefined) ? 'Actual vs target' : 'Team total'}
              className="lg:col-span-2"
            >
              <TrendLineChart
                data={data.trend.points}
                showTargetSeries={data.trend.points.some((p) => p.target !== undefined)}
              />
            </Card>
            <Card title={data.breakdownTitle ?? 'Activity Breakdown'}>
              {breakdownTotal > 0 ? (
                <DonutChart data={data.breakdown} centerValue={formatNumber(breakdownTotal)} centerLabel="Total" />
              ) : (
                <p className="py-10 text-center text-body-sm text-ink-muted">No activity in this period.</p>
              )}
            </Card>
          </div>

          {/* Improvement summary */}
          <Card className="border-primary/20 bg-primary/5">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-btn bg-primary/10 text-primary">
                <Sparkles size={18} />
              </span>
              <div>
                <p className="text-body-sm font-semibold uppercase tracking-wide text-primary">Improvement Summary</p>
                <p className="mt-0.5 text-body-md text-ink">{data.improvement}</p>
              </div>
            </div>
          </Card>

          {/* Today's submissions */}
          <Card
            title={data.people?.title ?? "Today's Submissions"}
            subtitle={data.people?.subtitle ?? `${data.counts.submitted} of ${data.counts.total} submitted`}
            flush
          >
            <DataTable
              columns={subColumns}
              rows={data.todaySubmissions}
              getRowId={(r) => r.id}
              onRowClick={canOpenProfile ? (r) => navigate(`/app/members/${r.id}`) : undefined}
              emptyMessage="No team members yet."
            />
          </Card>
        </>
      )}
    </div>
  )
}
