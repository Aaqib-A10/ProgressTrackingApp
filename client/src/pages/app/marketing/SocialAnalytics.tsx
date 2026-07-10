import { useEffect, useState, useCallback } from 'react'
import { Card } from '../../../components/ui/Card'
import { StatCard } from '../../../components/StatCard'
import { Badge } from '../../../components/ui/Badge'
import { TrendLineChart } from '../../../components/charts/TrendLineChart'
import { CHART } from '../../../components/charts/chartTheme'
import { DataTable, type Column } from '../../../components/DataTable'
import { useToast } from '../../../components/ui/Toast'
import { formatNumber, formatSignedPercent } from '../../../lib/format'
import {
  listBrands,
  compareMonthlySocial,
  crossBrandSocial,
  SOCIAL_PLATFORMS,
  MONTHLY_METRICS,
  type Brand,
  type CompareResponse,
  type ComparePlatform,
  type CrossBrandResponse,
  type MonthlyMetricKey,
} from '../../../lib/marketingApi'

const sel =
  'h-10 rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'
const platformLabel = (k: string) => SOCIAL_PLATFORMS.find((p) => p.key === k)?.label ?? k

function thisMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function SocialAnalytics() {
  const { addToast } = useToast()
  const [brands, setBrands] = useState<Brand[]>([])
  const [brandId, setBrandId] = useState('')
  const [month, setMonth] = useState(thisMonth())
  const [data, setData] = useState<CompareResponse | null>(null)
  const [cross, setCross] = useState<CrossBrandResponse | null>(null)
  const [crossMetric, setCrossMetric] = useState<MonthlyMetricKey>('followers')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listBrands()
      .then((r) => {
        setBrands(r.brands)
        if (r.brands[0]) setBrandId(r.brands[0].id)
      })
      .catch(() => addToast({ type: 'error', message: 'Could not load brands.' }))
      .finally(() => setLoading(false))
  }, [addToast])

  const load = useCallback(() => {
    if (!brandId) return
    compareMonthlySocial(brandId, month, 6)
      .then(setData)
      .catch(() => addToast({ type: 'error', message: 'Could not load analytics.' }))
  }, [brandId, month, addToast])
  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    // Cross-brand is lead/admin only — silently skip if forbidden.
    crossBrandSocial(month, crossMetric)
      .then(setCross)
      .catch(() => setCross(null))
  }, [month, crossMetric])

  const t = data?.totals
  const delta = (v: number, had: boolean) => (had ? v : undefined)
  const bandTone = (b?: 'green' | 'amber' | 'red' | null): 'success' | 'warning' | 'danger' => (b === 'green' ? 'success' : b === 'amber' ? 'warning' : 'danger')
  const bandLabel = (b?: 'green' | 'amber' | 'red' | null) => (b === 'green' ? 'On target' : b === 'amber' ? 'Near target' : 'Below target')

  const platformColumns: Column<ComparePlatform>[] = [
    { key: 'platform', header: 'Platform', render: (r) => <span className="font-medium text-ink">{platformLabel(r.platform)}</span> },
    { key: 'followers', header: 'Followers', align: 'right', render: (r) => formatNumber(r.followers) },
    {
      key: 'growth',
      header: 'Net growth',
      align: 'right',
      render: (r) => (
        <span className={r.followersGrowth >= 0 ? 'text-success' : 'text-danger'}>
          {r.followersGrowth >= 0 ? '+' : ''}
          {formatNumber(r.followersGrowth)}
        </span>
      ),
    },
    { key: 'impressions', header: 'Impressions', align: 'right', render: (r) => formatNumber(r.impressions) },
    { key: 'engagement', header: 'Engagement', align: 'right', render: (r) => formatNumber(r.engagement) },
    {
      key: 'trend',
      header: 'MoM',
      align: 'right',
      render: (r) =>
        r.hadPrev ? (
          <Badge tone={r.followersDelta >= 0 ? 'success' : 'danger'}>{formatSignedPercent(r.followersDelta)}</Badge>
        ) : (
          <span className="text-ink-muted">—</span>
        ),
    },
  ]

  if (loading) return <div className="p-2 text-body-md text-ink-muted">Loading…</div>

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-headline-lg text-ink">Social Analytics</h1>
        <p className="mt-0.5 text-body-md text-ink-muted">Month-over-month growth per brand profile.</p>
      </div>

      {brands.length === 0 ? (
        <Card>
          <p className="text-body-md text-ink-muted">No brands yet.</p>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="mb-1 block text-body-sm font-semibold text-ink">Brand</label>
              <select className={sel} value={brandId} onChange={(e) => setBrandId(e.target.value)}>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-body-sm font-semibold text-ink">Month</label>
              <input type="month" className={sel} value={month} max={thisMonth()} onChange={(e) => setMonth(e.target.value)} />
            </div>
          </div>

          {t && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <StatCard label="Followers" value={formatNumber(t.followers)} delta={delta(t.followersDelta, t.hadPrev)} caption="vs last month" />
                {data?.targets.followers && <Badge tone={bandTone(data.targets.followers.band)}>{bandLabel(data.targets.followers.band)} · goal {formatNumber(data.targets.followers.max)}</Badge>}
              </div>
              <div className="space-y-2">
                <StatCard label="Impressions" value={formatNumber(t.impressions)} delta={delta(t.impressionsDelta, t.hadPrev)} caption="vs last month" />
                {data?.targets.impressions && <Badge tone={bandTone(data.targets.impressions.band)}>{bandLabel(data.targets.impressions.band)} · goal {formatNumber(data.targets.impressions.max)}</Badge>}
              </div>
              <div className="space-y-2">
                <StatCard label="Engagement" value={formatNumber(t.engagement)} delta={delta(t.engagementDelta, t.hadPrev)} caption="vs last month" />
                {data?.targets.engagement && <Badge tone={bandTone(data.targets.engagement.band)}>{bandLabel(data.targets.engagement.band)} · goal {formatNumber(data.targets.engagement.max)}</Badge>}
              </div>
            </div>
          )}

          {data && (
            <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <Card title="Followers" subtitle="Total, over time">
                <TrendLineChart data={data.trends.followers} showTargetSeries={!!data.targets.followers} />
              </Card>
              <Card title="Engagement" subtitle="Over time">
                <TrendLineChart data={data.trends.engagement} color={CHART.accent} showTargetSeries={!!data.targets.engagement} />
              </Card>
              <Card title="Impressions" subtitle="Over time">
                <TrendLineChart data={data.trends.impressions} color={CHART.success} showTargetSeries={!!data.targets.impressions} />
              </Card>
            </section>
          )}

          <Card title="By platform" subtitle={data ? `${data.month} vs ${data.prevMonth}` : ''} flush>
            <DataTable
              columns={platformColumns}
              rows={data?.platforms ?? []}
              getRowId={(r) => r.platform}
              emptyMessage="No data for this brand/month yet."
            />
          </Card>

          {cross && cross.brands.length > 0 && (
            <Card
              title="Compare brands"
              subtitle={`${cross.month} · by ${MONTHLY_METRICS.find((m) => m.key === crossMetric)?.label}`}
              action={
                <select className={sel} value={crossMetric} onChange={(e) => setCrossMetric(e.target.value as MonthlyMetricKey)}>
                  {MONTHLY_METRICS.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label}
                    </option>
                  ))}
                </select>
              }
            >
              <div className="space-y-3">
                {cross.brands.map((b) => {
                  const max = Math.max(1, ...cross.brands.map((x) => x.value))
                  return (
                    <div key={b.brandId} className="flex items-center gap-3">
                      <span className="w-40 shrink-0 truncate text-body-sm text-ink">{b.name}</span>
                      <div className="h-5 flex-1 overflow-hidden rounded-btn bg-slate-100">
                        <div className="h-full rounded-btn bg-primary/70" style={{ width: `${(b.value / max) * 100}%` }} />
                      </div>
                      <span className="w-20 text-right text-body-sm font-semibold tabular-nums text-ink">{formatNumber(b.value)}</span>
                    </div>
                  )
                })}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
