import { useEffect, useState, useCallback } from 'react'
import { UploadCloud } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { useToast } from '../../../components/ui/Toast'
import {
  listBrands,
  getMonthlySocial,
  upsertMonthlySocial,
  SOCIAL_PLATFORMS,
  MONTHLY_METRICS,
  type Brand,
  type SocialPlatform,
  type MonthlyMetricKey,
} from '../../../lib/marketingApi'

const sel =
  'h-10 rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'
const numInput =
  'h-9 w-24 rounded-btn border border-line bg-bg px-2 text-right text-body-sm tabular-nums text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10'

type Grid = Record<SocialPlatform, Record<MonthlyMetricKey, number>>
const emptyGrid = (): Grid =>
  SOCIAL_PLATFORMS.reduce(
    (a, p) => ({ ...a, [p.key]: MONTHLY_METRICS.reduce((m, k) => ({ ...m, [k.key]: 0 }), {}) }),
    {} as Grid,
  )

function thisMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function SocialMonthly() {
  const { addToast } = useToast()
  const [brands, setBrands] = useState<Brand[]>([])
  const [brandId, setBrandId] = useState('')
  const [month, setMonth] = useState(thisMonth())
  const [grid, setGrid] = useState<Grid>(emptyGrid)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    listBrands()
      .then((r) => {
        setBrands(r.brands)
        if (r.brands[0]) setBrandId(r.brands[0].id)
      })
      .catch(() => addToast({ type: 'error', message: 'Could not load brands.' }))
      .finally(() => setLoading(false))
  }, [addToast])

  const loadGrid = useCallback(() => {
    if (!brandId) return
    getMonthlySocial(brandId, month)
      .then((r) => {
        const g = emptyGrid()
        for (const row of r.platforms) {
          g[row.platform] = { followers: row.followers, impressions: row.impressions, engagement: row.engagement, reach: row.reach, posts: row.posts }
        }
        setGrid(g)
      })
      .catch(() => addToast({ type: 'error', message: 'Could not load stats.' }))
  }, [brandId, month, addToast])

  useEffect(() => {
    loadGrid()
  }, [loadGrid])

  function setCell(p: SocialPlatform, k: MonthlyMetricKey, v: number) {
    setGrid((g) => ({ ...g, [p]: { ...g[p], [k]: Math.max(0, Math.floor(v || 0)) } }))
  }

  async function save() {
    if (!brandId) return
    setSaving(true)
    try {
      await upsertMonthlySocial({
        brandId,
        month,
        rows: SOCIAL_PLATFORMS.map((p) => ({ platform: p.key, ...grid[p.key] })),
      })
      addToast({ type: 'success', message: 'Monthly report saved.' })
    } catch {
      addToast({ type: 'error', message: 'Could not save.' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-2 text-body-md text-ink-muted">Loading…</div>

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-headline-lg text-ink">Social Reports</h1>
        <p className="mt-0.5 text-body-md text-ink-muted">Enter each brand's monthly numbers per platform. Saved figures compare month-over-month in Social Analytics.</p>
      </div>

      {brands.length === 0 ? (
        <Card>
          <p className="text-body-md text-ink-muted">No brands yet. Ask a Team Lead to add brands first (Marketing → Brands).</p>
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

          <Card flush>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-body-sm">
                <thead>
                  <tr className="border-b border-line text-left text-ink-muted">
                    <th className="px-4 py-3 font-semibold">Platform</th>
                    {MONTHLY_METRICS.map((m) => (
                      <th key={m.key} className="px-4 py-3 text-right font-semibold">
                        {m.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SOCIAL_PLATFORMS.map((p) => (
                    <tr key={p.key} className="border-b border-line/60 last:border-0">
                      <td className="px-4 py-2.5 font-medium text-ink">{p.label}</td>
                      {MONTHLY_METRICS.map((m) => (
                        <td key={m.key} className="px-4 py-2.5 text-right">
                          <input
                            type="number"
                            min={0}
                            className={numInput}
                            value={grid[p.key][m.key] || ''}
                            onChange={(e) => setCell(p.key, m.key, Number(e.target.value))}
                            placeholder="0"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Button size="lg" onClick={save} disabled={saving} leadingIcon={<UploadCloud size={18} />}>
            {saving ? 'Saving…' : 'Save Monthly Report'}
          </Button>
        </>
      )}
    </div>
  )
}
