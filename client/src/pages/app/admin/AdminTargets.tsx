import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { DataTable, type Column } from '../../../components/DataTable'
import { useToast } from '../../../components/ui/Toast'
import type { Department } from '../../../lib/types'
import { listTargets, upsertTarget, type AdminTarget } from '../../../lib/adminApi'

const DEPARTMENTS: { value: Department; label: string }[] = [
  { value: 'ITAD', label: 'ITAD' },
  { value: 'LEAD_GEN', label: 'Lead Generation' },
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
}
const sel = 'h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'

export default function AdminTargets() {
  const { addToast } = useToast()
  const [targets, setTargets] = useState<AdminTarget[]>([])
  const [department, setDepartment] = useState<Department>('ITAD')
  const [metricKey, setMetricKey] = useState('callsDialed')
  const [period, setPeriod] = useState<'DAILY' | 'WEEKLY' | 'MONTHLY'>('DAILY')
  const [value, setValue] = useState(100)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listTargets()
      .then((r) => setTargets(r.targets))
      .catch(() => addToast({ type: 'error', message: 'Could not load targets.' }))
      .finally(() => setLoading(false))
  }, [addToast])

  const metricOptions = useMemo(() => METRICS[department] ?? [], [department])

  async function save(e: FormEvent) {
    e.preventDefault()
    try {
      const { target } = await upsertTarget({ department, metricKey, period, value })
      setTargets((ts) => {
        const idx = ts.findIndex((t) => t.department === target.department && t.metricKey === target.metricKey && t.period === target.period)
        if (idx >= 0) return ts.map((t, i) => (i === idx ? target : t))
        return [...ts, target]
      })
      addToast({ type: 'success', message: 'Target saved.' })
    } catch {
      addToast({ type: 'error', message: 'Could not save (TLs can only set their own department).' })
    }
  }

  const columns: Column<AdminTarget>[] = [
    { key: 'department', header: 'Department', render: (t) => (t.department ? t.department.replace('_', ' ') : '—') },
    { key: 'metricKey', header: 'Metric', render: (t) => t.metricKey },
    { key: 'period', header: 'Period', render: (t) => t.period.toLowerCase() },
    { key: 'value', header: 'Target', align: 'right', render: (t) => t.value },
  ]

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h1 className="text-headline-lg text-ink">Target Setting</h1>

      <Card title="Set / Update Target">
        <form onSubmit={save} className="grid grid-cols-1 items-end gap-4 sm:grid-cols-5">
          <div>
            <label className="mb-1 block text-body-sm font-semibold text-ink">Department</label>
            <select className={sel} value={department} onChange={(e) => { const d = e.target.value as Department; setDepartment(d); setMetricKey((METRICS[d] ?? [])[0]?.key ?? '') }}>
              {DEPARTMENTS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </div>
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
            <label className="mb-1 block text-body-sm font-semibold text-ink">Value</label>
            <input type="number" min={0} className={sel} value={value} onChange={(e) => setValue(parseInt(e.target.value, 10) || 0)} />
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
