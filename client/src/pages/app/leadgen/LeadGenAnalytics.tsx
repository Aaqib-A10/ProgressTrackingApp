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
import { getLeadGenAnalytics, type LeadGenAnalyticsData, type LeadGenPeriodRow } from '../../../lib/leadgenApi'

const RANGE_LABEL: Record<string, string> = {
  today: 'Today',
  week: 'This Week',
  month: 'This Month',
  rolling3m: 'Last 3 Months',
  custom: 'This Month',
}

export default function LeadGenAnalytics() {
  const { range, custom } = useRange()
  const { addToast } = useToast()
  const [data, setData] = useState<LeadGenAnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    getLeadGenAnalytics(range, custom)
      .then((res) => active && setData(res))
      .catch(() => active && addToast({ type: 'error', message: 'Could not load analytics.' }))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [range, custom, addToast])

  const cmpColumns: Column<LeadGenPeriodRow>[] = [
    { key: 'label', header: 'Period', render: (r) => <span className="font-medium text-ink">{r.label}</span> },
    { key: 'leads', header: 'Leads', align: 'right', render: (r) => formatNumber(r.leads) },
    { key: 'qualified', header: 'Qualified', align: 'right', render: (r) => formatNumber(r.qualified) },
    { key: 'mqlToSql', header: 'MQL → SQL', align: 'right', render: (r) => formatPercent(r.mqlToSql) },
    { key: 'contacts', header: 'Contacts', align: 'right', render: (r) => formatNumber(r.contacts) },
  ]

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-headline-lg text-ink">Lead Gen Analytics</h1>
        <p className="mt-0.5 text-body-md text-ink-muted">Trends, period comparison & pipeline · {RANGE_LABEL[range] ?? 'This Month'}</p>
      </div>

      {loading || !data ? (
        <div className="text-body-md text-ink-muted">Loading…</div>
      ) : (
        <>
          {/* KPI rate cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {data.kpis.map((k) => (
              <StatCard key={k.label} label={k.label} value={formatPercent(k.value)} delta={k.delta} caption="vs last period" />
            ))}
          </div>

          {/* Trends */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title="Lead Volume" subtitle="Actual vs target">
              <TrendLineChart data={data.trends.leads.points} showTargetSeries={data.trends.leads.points.some((p) => p.target !== undefined)} />
            </Card>
            <Card title="Lead → Qualified Trend" subtitle="Qualification rate over time">
              <TrendLineChart
                data={data.trends.leadToQualified.points.map((p) => ({ ...p, value: Math.round(p.value * 1000) / 10 }))}
                color={CHART.accent}
              />
            </Card>
          </div>

          {/* Pipeline funnel + period comparison */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card title="Lead Pipeline" subtitle="Researched → Handed to Sales">
              <FunnelChart stages={data.funnel} />
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
