import { useEffect, useState } from 'react'
import { UploadCloud } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { NumberStepper } from '../../../components/ui/NumberStepper'
import { Toggle } from '../../../components/ui/Toggle'
import { useToast } from '../../../components/ui/Toast'
import { SOCIAL_METRICS, getSocialEntry, upsertSocialEntry, type SocialMetricKey } from '../../../lib/marketingApi'

type Metrics = Record<SocialMetricKey, number>
const zero = (): Metrics => SOCIAL_METRICS.reduce((a, m) => ({ ...a, [m.key]: 0 }), {} as Metrics)

export default function SocialActivity() {
  const { addToast } = useToast()
  const [metrics, setMetrics] = useState<Metrics>(zero)
  const [platforms, setPlatforms] = useState<{ id: string; name: string }[]>([])
  const [pCounts, setPCounts] = useState<Record<string, number>>({})
  const [notes, setNotes] = useState('')
  const [onLeave, setOnLeave] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    getSocialEntry()
      .then((res) => {
        setPlatforms(res.platforms)
        if (res.entry) {
          setOnLeave(res.entry.status !== 'SUBMITTED')
          setNotes(res.entry.notes)
          setMetrics(SOCIAL_METRICS.reduce((a, m) => ({ ...a, [m.key]: res.entry![m.key] }), {} as Metrics))
          setPCounts(Object.fromEntries(res.entry.platformCounts.map((p) => [p.tagId, p.posts])))
        }
      })
      .catch(() => addToast({ type: 'error', message: 'Could not load entry.' }))
      .finally(() => setLoading(false))
  }, [addToast])

  async function submit() {
    setSubmitting(true)
    try {
      await upsertSocialEntry({
        status: onLeave ? 'ON_LEAVE' : 'SUBMITTED',
        notes,
        ...(onLeave ? {} : metrics),
        platformCounts: onLeave ? [] : Object.entries(pCounts).map(([tagId, posts]) => ({ tagId, posts })),
      })
      addToast({ type: 'success', message: onLeave ? 'Marked as On Leave.' : 'Social activity submitted.' })
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
        <h1 className="text-headline-lg text-ink">Social Media Activity</h1>
        <label className="flex items-center gap-3 rounded-btn border border-line bg-card px-4 py-2">
          <span className="text-body-sm font-medium text-ink-muted">On Leave / Off</span>
          <Toggle checked={onLeave} onChange={setOnLeave} label="On leave today" />
        </label>
      </div>

      <div className={onLeave ? 'pointer-events-none opacity-60' : ''}>
        <Card title="Engagement & Reach">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SOCIAL_METRICS.map((m) => (
              <NumberStepper key={m.key} label={m.label} value={metrics[m.key]} onChange={(v) => setMetrics((p) => ({ ...p, [m.key]: v }))} disabled={onLeave} step={m.key === 'reach' || m.key === 'engagement' ? 50 : 1} />
            ))}
          </div>
        </Card>

        <Card title="Posts by Platform" className="mt-6">
          {platforms.length === 0 ? (
            <p className="text-body-sm text-ink-muted">No platforms configured.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {platforms.map((p) => (
                <NumberStepper key={p.id} label={p.name} value={pCounts[p.id] ?? 0} onChange={(n) => setPCounts((c) => ({ ...c, [p.id]: n }))} disabled={onLeave} />
              ))}
            </div>
          )}
        </Card>

        <Card title="Notes" className="mt-6">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Campaigns, standout posts…" className="w-full rounded-btn border border-line bg-bg p-3 text-body-md text-ink placeholder:text-ink-muted focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10" />
        </Card>
      </div>

      <Button className="mt-6" size="lg" onClick={submit} disabled={submitting} leadingIcon={<UploadCloud size={18} />}>
        {submitting ? 'Submitting…' : 'Submit'}
      </Button>
    </div>
  )
}
