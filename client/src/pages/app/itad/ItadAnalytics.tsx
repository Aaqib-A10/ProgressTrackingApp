import { useEffect, useState } from 'react'
import { Card } from '../../../components/ui/Card'
import { StatCard } from '../../../components/StatCard'
import { DataTable, type Column } from '../../../components/DataTable'
import { TrendLineChart } from '../../../components/charts/TrendLineChart'
import { FunnelChart } from '../../../components/charts/FunnelChart'
import { CHART } from '../../../components/charts/chartTheme'
import { useRange } from '../../../components/layout/AppShell'
import { useToast } from '../../../components/ui/Toast'
import { formatNumber, formatPercent } from '../../../lib/format'
import { getItadAnalytics, type ItadAnalyticsData, type ItadPeriodRow } from '../../../lib/itadApi'

const RANGE_LABEL: Record<string, string> = {
  today: 'Today',
  week: 'This Week',
  month: 'This Month',
  rolling3m: 'Last 3 Months',
  custom: 'This Month',
}

export default function ItadAnalytics() {
  const { range, custom } = useRange()
  const { addToast } = useToast()
  const [data, setData] = useState<ItadAnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    getItadAnalytics(range, custom)
      .then((res) => active && setData(res))
      .catch(() => active && addToast({ type: 'error', message: 'Could not load analytics.' }))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [range, custom, addToast])

  const cmpColumns: Column<ItadPeriodRow>[] = [
    { key: 'label', header: 'Period', render: (r) => <span className="font-medium text-ink">{r.label}</span> },
    { key: 'dials', header: 'Dials', align: 'right', render: (r) => formatNumber(r.dials) },
    { key: 'connectRate', header: 'Connect Rate', align: 'right', render: (r) => formatPercent(r.connectRate) },
    { key: 'interested', header: 'Interested', align: 'right', render: (r) => formatNumber(r.interested) },
    { key: 'closed', header: 'Closed', align: 'right', render: (r) => formatNumber(r.closed) },
  ]

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-headline-lg text-ink">ITAD Analytics</h1>
        <p className="mt-0.5 text-body-md text-ink-muted">Trends, period comparison & lifecycle · {RANGE_LABEL[range] ?? 'This Month'}</p>
      </div>

      {loading || !data ? (
        <div className="text-body-md text-ink-muted">Loading…</div>
      ) : (
        <>
          {/* KPI rate cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {data.kpis.map((k) => (
              <StatCard key={k.label} label={k.label} value={formatPercent(k.value)} delta={k.delta} caption="vs last period" />
            ))}
          </div>

          {/* Trends */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title="Dial Volume" subtitle="Actual vs target">
              <TrendLineChart data={data.trends.dials.points} showTargetSeries={data.trends.dials.points.some((p) => p.target !== undefined)} />
            </Card>
            <Card title="Connect Rate Trend" subtitle="Conversations per dial">
              <TrendLineChart
                data={data.trends.connectRate.points.map((p) => ({ ...p, value: Math.round(p.value * 1000) / 10 }))}
                color={CHART.accent}
              />
            </Card>
          </div>

          {/* Lifecycle funnel + period comparison */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card title="Lifecycle Funnel" subtitle="Dialed → RFQs">
              <FunnelChart stages={data.lifecycle} />
            </Card>
            <Card title="Period Comparison" subtitle="This vs last vs earlier" flush>
              <DataTable columns={cmpColumns} rows={data.periodComparison} getRowId={(r) => r.label} />
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
