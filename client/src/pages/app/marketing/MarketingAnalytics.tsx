import { useEffect, useState } from 'react'
import { Card } from '../../../components/ui/Card'
import { StatCard } from '../../../components/StatCard'
import { TrendLineChart } from '../../../components/charts/TrendLineChart'
import { CHART } from '../../../components/charts/chartTheme'
import { useRange } from '../../../components/layout/AppShell'
import { useToast } from '../../../components/ui/Toast'
import { formatNumber } from '../../../lib/format'
import { getMarketingAnalytics, type MarketingAnalyticsData, type MktKpi } from '../../../lib/marketingApi'

const STATUS_LABEL: Record<string, string> = {
  BACKLOG: 'Backlog',
  IN_PROGRESS: 'In Progress',
  IN_REVIEW: 'In Review',
  SCHEDULED: 'Scheduled',
  PUBLISHED: 'Published',
}

const kpiCard = (k: MktKpi) =>
  <StatCard key={k.label} label={k.label} value={formatNumber(k.value)} delta={k.delta} caption="vs prev period" />

export default function MarketingAnalytics() {
  const { range, custom } = useRange()
  const { addToast } = useToast()
  const [data, setData] = useState<MarketingAnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    getMarketingAnalytics(range, custom)
      .then((res) => active && setData(res))
      .catch(() => active && addToast({ type: 'error', message: 'Could not load analytics.' }))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [range, custom, addToast])

  return (
    <div className="mx-auto w-full max-w-[1800px] space-y-6">
      <div>
        <h1 className="text-headline-lg text-ink">Marketing Analytics</h1>
        <p className="mt-0.5 text-body-md text-ink-muted">Work published by the team, the content pipeline and velocity. Social numbers per brand are in Social Reports.</p>
      </div>

      {loading || !data ? (
        <div className="text-body-md text-ink-muted">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">{data.kpis.map(kpiCard)}</div>

          {/* Content + velocity */}
          <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card title="Content Pipeline" subtitle={`${data.content.publishedThisPeriod} published this period`}>
              <div className="space-y-3">
                {data.content.pipeline.map((p) => {
                  const max = Math.max(1, ...data.content.pipeline.map((x) => x.count))
                  return (
                    <div key={p.status} className="flex items-center gap-3">
                      <span className="w-24 shrink-0 text-body-sm text-ink-muted">{STATUS_LABEL[p.status]}</span>
                      <div className="h-5 flex-1 overflow-hidden rounded-btn bg-slate-100">
                        <div className="h-full rounded-btn bg-primary/70" style={{ width: `${(p.count / max) * 100}%` }} />
                      </div>
                      <span className="w-6 text-right text-body-sm font-semibold tabular-nums text-ink">{p.count}</span>
                    </div>
                  )
                })}
              </div>
            </Card>
            <Card title="Marketing Velocity" subtitle="Tasks reaching Published">
              <TrendLineChart data={data.velocity.points} color={CHART.success} />
            </Card>
          </section>
        </>
      )}
    </div>
  )
}
