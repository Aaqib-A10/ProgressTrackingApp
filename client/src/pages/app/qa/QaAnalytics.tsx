import { useEffect, useState } from 'react'
import { Card } from '../../../components/ui/Card'
import { StatCard } from '../../../components/StatCard'
import { DonutChart } from '../../../components/charts/DonutChart'
import { StackedBarChart } from '../../../components/charts/StackedBarChart'
import { TrendLineChart } from '../../../components/charts/TrendLineChart'
import { CHART } from '../../../components/charts/chartTheme'
import { useRange } from '../../../components/layout/AppShell'
import { useToast } from '../../../components/ui/Toast'
import { useAuth } from '../../../lib/auth'
import { getQaAnalytics, type QaAnalytics as QaAnalyticsData } from '../../../lib/qaApi'
import { EmployeeOfMonthCard } from '../../../components/EmployeeOfMonthCard'

const BAND_COLOR: Record<string, string> = { Excellent: CHART.success, Good: CHART.primary, Acceptable: CHART.warning, Unacceptable: CHART.danger }

export default function QaAnalytics() {
  const { range, custom } = useRange()
  const { addToast } = useToast()
  const { user } = useAuth()
  const canFilter = user?.role === 'QA' || user?.role === 'QA_LEAD' || user?.role === 'SUPER_ADMIN'
  const [dept, setDept] = useState<'' | 'ITAD' | 'CSR'>('')
  const [data, setData] = useState<QaAnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    getQaAnalytics(canFilter ? dept : '', range, custom)
      .then((r) => active && setData(r))
      .catch(() => active && addToast({ type: 'error', message: 'Could not load QA analytics.' }))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [dept, range, custom, canFilter, addToast])

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">QA Analytics</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">Call-quality trends, distribution and agent performance.</p>
        </div>
        {canFilter && (
          <div className="inline-flex gap-1.5">
            {([['', 'All'], ['ITAD', 'ITAD'], ['CSR', 'CSR']] as const).map(([v, l]) => (
              <button key={v} onClick={() => setDept(v)} className={'rounded-full px-3.5 py-1.5 text-body-md font-medium transition-colors ' + (dept === v ? 'bg-primary text-white' : 'bg-slate-100 text-ink-muted hover:bg-slate-200')}>{l}</button>
            ))}
          </div>
        )}
      </div>

      <EmployeeOfMonthCard />

      {loading || !data ? (
        <div className="text-body-md text-ink-muted">Loading…</div>
      ) : data.totals.evaluations === 0 ? (
        <Card><p className="py-10 text-center text-body-md text-ink-muted">No QA evaluations in this period.</p></Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="Evaluations" value={data.totals.evaluations} to="/app/qa/evaluations" caption="View all →" />
            <StatCard label="Average score" value={`${data.totals.avgScore}%`} />
            <StatCard label="Pass rate" value={`${data.totals.passRate}%`} />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card title="Quality distribution">
              <DonutChart data={data.distribution.map((d) => ({ name: d.name, value: d.value, color: BAND_COLOR[d.name] }))} centerValue={`${data.totals.avgScore}%`} centerLabel="Avg" />
            </Card>
            <Card title="Pass vs Fail">
              <DonutChart data={[{ name: 'Pass', value: data.passFail[0]?.value ?? 0, color: CHART.success }, { name: 'Fail', value: data.passFail[1]?.value ?? 0, color: CHART.danger }]} centerValue={`${data.totals.passRate}%`} centerLabel="Pass" />
            </Card>
          </div>

          <Card title="Score trend"><TrendLineChart data={data.trend} /></Card>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card title="Agent performance (avg %)">
              {data.agents.length ? <StackedBarChart data={data.agents.map((a) => ({ name: a.name, avg: a.avg }))} xKey="name" series={[{ key: 'avg', label: 'Avg %', color: CHART.primary }]} /> : <p className="py-8 text-center text-body-sm text-ink-muted">No data.</p>}
            </Card>
            <Card title="Category breakdown (avg %)">
              {data.categories.length ? <StackedBarChart data={data.categories.map((c) => ({ name: c.name, avg: c.avg }))} xKey="name" series={[{ key: 'avg', label: 'Avg %', color: CHART.accent }]} /> : <p className="py-8 text-center text-body-sm text-ink-muted">No data.</p>}
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
