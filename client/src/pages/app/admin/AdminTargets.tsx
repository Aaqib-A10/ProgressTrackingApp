import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { DataTable, type Column } from '../../../components/DataTable'
import { useToast } from '../../../components/ui/Toast'
import type { Department } from '../../../lib/types'
import { listTargets, upsertTarget, deleteTarget, type AdminTarget } from '../../../lib/adminApi'
import { listBrands, type Brand } from '../../../lib/marketingApi'

const DEPARTMENTS: { value: Department; label: string }[] = [
  { value: 'ITAD', label: 'ITAD' },
  { value: 'LEAD_GEN', label: 'Lead Generation' },
  { value: 'MARKETING', label: 'Marketing' },
]
const METRICS: Record<string, { key: string; label: string }[]> = {
  ITAD: [
    { key: 'callsDialed', label: 'Calls Dialed' },
    { key: 'connected', label: 'Connected' },
    { key: 'closed', label: 'Closed Deals' },
  ],
  LEAD_GEN: [
    { key: 'leadsGenerated', label: 'Leads Generated' },
    { key: 'qualifiedMql', label: 'Qualified (MQL)' },
  ],
  MARKETING: [
    { key: 'social.followers', label: 'Followers (Social)' },
    { key: 'social.impressions', label: 'Impressions (Social)' },
    { key: 'social.engagement', label: 'Engagement (Social)' },
    { key: 'content.blogs', label: 'Blogs / month' },
  ],
}
const sel = 'h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'

export default function AdminTargets() {
  const { addToast } = useToast()
  const [targets, setTargets] = useState<AdminTarget[]>([])
  const [department, setDepartment] = useState<Department>('ITAD')
  const [metricKey, setMetricKey] = useState('callsDialed')
  const [period, setPeriod] = useState<'DAILY' | 'WEEKLY' | 'MONTHLY'>('DAILY')
  const [minValue, setMinValue] = useState(80)
  const [maxValue, setMaxValue] = useState(100)
  const [brands, setBrands] = useState<Brand[]>([])
  const [brandId, setBrandId] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listTargets()
      .then((r) => setTargets(r.targets))
      .catch(() => addToast({ type: 'error', message: 'Could not load targets.' }))
      .finally(() => setLoading(false))
    listBrands().then((r) => setBrands(r.brands)).catch(() => undefined)
  }, [addToast])

  const metricOptions = useMemo(() => METRICS[department] ?? [], [department])

  async function save(e: FormEvent) {
    e.preventDefault()
    if (maxValue < minValue) {
      addToast({ type: 'error', message: 'Max value must be greater than or equal to min value.' })
      return
    }
    try {
      const useBrand = department === 'MARKETING' && brandId
      const { target } = await upsertTarget({ department, metricKey, period, minValue, maxValue, ...(useBrand ? { brandId } : {}) })
      setTargets((ts) => {
        const idx = ts.findIndex(
          (t) => t.department === target.department && t.metricKey === target.metricKey && t.period === target.period && (t.brand?.id ?? null) === (target.brand?.id ?? null),
        )
        if (idx >= 0) return ts.map((t, i) => (i === idx ? target : t))
        return [...ts, target]
      })
      addToast({ type: 'success', message: 'Target saved.' })
    } catch {
      addToast({ type: 'error', message: 'Could not save (TLs can only set their own department).' })
    }
  }

  async function remove(t: AdminTarget) {
    const prev = targets
    setTargets((ts) => ts.filter((x) => x.id !== t.id))
    try {
      await deleteTarget(t.id)
      addToast({ type: 'success', message: 'Target deleted.' })
    } catch {
      setTargets(prev)
      addToast({ type: 'error', message: 'Could not delete target.' })
    }
  }

  const columns: Column<AdminTarget>[] = [
    { key: 'department', header: 'Department', render: (t) => (t.department ? t.department.replace('_', ' ') : '—') },
    { key: 'brand', header: 'Brand', render: (t) => t.brand?.name ?? '—' },
    { key: 'metricKey', header: 'Metric', render: (t) => t.metricKey },
    { key: 'period', header: 'Period', render: (t) => t.period.toLowerCase() },
    { key: 'min', header: 'Min', align: 'right', render: (t) => t.minValue ?? '—' },
    { key: 'max', header: 'Max', align: 'right', render: (t) => t.maxValue ?? t.value },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (t) => (
        <button
          onClick={() => remove(t)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-btn text-ink-muted hover:bg-danger/10 hover:text-danger"
          aria-label="Delete target"
          title="Delete target"
        >
          <Trash2 size={16} />
        </button>
      ),
    },
  ]

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h1 className="text-headline-lg text-ink">Target Setting</h1>

      <Card title="Set / Update Target">
        <form onSubmit={save} className="grid grid-cols-1 items-end gap-4 sm:grid-cols-6">
          <div>
            <label className="mb-1 block text-body-sm font-semibold text-ink">Department</label>
            <select className={sel} value={department} onChange={(e) => { const d = e.target.value as Department; setDepartment(d); setMetricKey((METRICS[d] ?? [])[0]?.key ?? ''); if (d === 'MARKETING') setPeriod('MONTHLY') }}>
              {DEPARTMENTS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </div>
          {department === 'MARKETING' && (
            <div>
              <label className="mb-1 block text-body-sm font-semibold text-ink">Brand</label>
              <select className={sel} value={brandId} onChange={(e) => setBrandId(e.target.value)}>
                <option value="">All (department)</option>
                {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="mb-1 block text-body-sm font-semibold text-ink">Metric</label>
            <select className={sel} value={metricKey} onChange={(e) => setMetricKey(e.target.value)}>
              {metricOptions.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-body-sm font-semibold text-ink">Period</label>
            <select className={sel} value={period} onChange={(e) => setPeriod(e.target.value as 'DAILY' | 'WEEKLY' | 'MONTHLY')}>
              <option value="DAILY">Daily</option>
              <option value="WEEKLY">Weekly</option>
              <option value="MONTHLY">Monthly</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-body-sm font-semibold text-ink">Min value</label>
            <input type="number" min={0} className={sel} value={minValue} onChange={(e) => setMinValue(parseInt(e.target.value, 10) || 0)} />
          </div>
          <div>
            <label className="mb-1 block text-body-sm font-semibold text-ink">Max value</label>
            <input type="number" min={0} className={sel} value={maxValue} onChange={(e) => setMaxValue(parseInt(e.target.value, 10) || 0)} />
          </div>
          <Button type="submit">Save</Button>
        </form>
      </Card>

      <Card title="Current Targets" flush>
        {loading ? <div className="p-5 text-body-md text-ink-muted">Loading…</div> : <DataTable columns={columns} rows={targets} getRowId={(t) => t.id} emptyMessage="No targets set yet." />}
      </Card>
    </div>
  )
}
