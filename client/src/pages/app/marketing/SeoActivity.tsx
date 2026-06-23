import { useEffect, useState } from 'react'
import { UploadCloud } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { NumberStepper } from '../../../components/ui/NumberStepper'
import { Toggle } from '../../../components/ui/Toggle'
import { useToast } from '../../../components/ui/Toast'
import { SEO_METRICS, getSeoEntry, upsertSeoEntry, type SeoMetricKey } from '../../../lib/marketingApi'
import { formatNumber } from '../../../lib/format'

type Metrics = Record<SeoMetricKey, number>
const zero = (): Metrics => SEO_METRICS.reduce((a, m) => ({ ...a, [m.key]: 0 }), {} as Metrics)

export default function SeoActivity() {
  const { addToast } = useToast()
  const [metrics, setMetrics] = useState<Metrics>(zero)
  const [notes, setNotes] = useState('')
  const [onLeave, setOnLeave] = useState(false)
  const [avgTraffic, setAvgTraffic] = useState(0)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    getSeoEntry()
      .then((res) => {
        setAvgTraffic(res.stats.avgOrganicTraffic)
        if (res.entry) {
          setOnLeave(res.entry.status !== 'SUBMITTED')
          setNotes(res.entry.notes)
          setMetrics(SEO_METRICS.reduce((a, m) => ({ ...a, [m.key]: res.entry![m.key] }), {} as Metrics))
        }
      })
      .catch(() => addToast({ type: 'error', message: 'Could not load entry.' }))
      .finally(() => setLoading(false))
  }, [addToast])

  async function submit() {
    setSubmitting(true)
    try {
      await upsertSeoEntry({ status: onLeave ? 'ON_LEAVE' : 'SUBMITTED', notes, ...(onLeave ? {} : metrics) })
      addToast({ type: 'success', message: onLeave ? 'Marked as On Leave.' : 'SEO activity submitted.' })
    } catch {
      addToast({ type: 'error', message: 'Could not submit.' })
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <div className="p-2 text-body-md text-ink-muted">Loading…</div>

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-headline-lg text-ink">SEO Activity</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">Avg organic traffic (recent): <span className="font-semibold tabular-nums text-ink">{formatNumber(avgTraffic)}</span></p>
        </div>
        <label className="flex items-center gap-3 rounded-btn border border-line bg-card px-4 py-2">
          <span className="text-body-sm font-medium text-ink-muted">On Leave / Off</span>
          <Toggle checked={onLeave} onChange={setOnLeave} label="On leave today" />
        </label>
      </div>

      <Card title="Today's SEO Work">
        <div className={'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 ' + (onLeave ? 'pointer-events-none opacity-60' : '')}>
          {SEO_METRICS.map((m) => (
            <NumberStepper key={m.key} label={m.label} value={metrics[m.key]} onChange={(v) => setMetrics((p) => ({ ...p, [m.key]: v }))} disabled={onLeave} step={m.key === 'organicTraffic' ? 10 : 1} />
          ))}
        </div>
        <div className="mt-5">
          <label className="mb-1 block text-body-sm font-medium text-ink-muted">Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Tasks worked on, audits, link building…" className="w-full rounded-btn border border-line bg-bg p-3 text-body-md text-ink placeholder:text-ink-muted focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10" />
        </div>
        <Button className="mt-5" size="lg" onClick={submit} disabled={submitting} leadingIcon={<UploadCloud size={18} />}>
          {submitting ? 'Submitting…' : 'Submit'}
        </Button>
      </Card>
    </div>
  )
}
