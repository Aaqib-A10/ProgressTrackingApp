import { useEffect, useMemo, useRef, useState } from 'react'
import { Phone, PhoneCall, Voicemail, Mail, Heart, Briefcase, CheckCircle2, FileText, UploadCloud, RotateCcw } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { NumberStepper } from '../../../components/ui/NumberStepper'
import { AttachmentsCard } from '../../../components/AttachmentsCard'
import { Toggle } from '../../../components/ui/Toggle'
import { RadialGauge } from '../../../components/charts/RadialGauge'
import { CHART } from '../../../components/charts/chartTheme'
import { useToast } from '../../../components/ui/Toast'
import { useAuth } from '../../../lib/auth'
import {
  ITAD_METRICS,
  getMyItadEntry,
  upsertItadEntry,
  type ItadEntryResponse,
  type ItadMetricKey,
  type ItadTotals,
} from '../../../lib/itadApi'

const ICONS: Record<ItadMetricKey, React.ReactNode> = {
  callsDialed: <Phone size={14} />,
  connected: <PhoneCall size={14} />,
  voicemail: <Voicemail size={14} />,
  emailsSent: <Mail size={14} />,
  interested: <Heart size={14} />,
  workingOn: <Briefcase size={14} />,
  closed: <CheckCircle2 size={14} />,
  rfqs: <FileText size={14} />,
}

function zeroTotals(): ItadTotals {
  return ITAD_METRICS.reduce((acc, m) => ({ ...acc, [m.key]: 0 }), {} as ItadTotals)
}

export default function ItadDailyLog() {
  const { addToast } = useToast()
  const { user } = useAuth()
  const [data, setData] = useState<ItadEntryResponse | null>(null)
  const [metrics, setMetrics] = useState<ItadTotals>(zeroTotals)
  const [onLeave, setOnLeave] = useState(false)
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // Local draft memory: agents tally numbers across the day, so in-progress (unsubmitted)
  // values survive a page refresh. Keyed per user + day; cleared on submit.
  const draftKeyRef = useRef<string | null>(null)
  function saveDraft(m: ItadTotals, n: string, leave: boolean) {
    const key = draftKeyRef.current
    if (!key) return
    try {
      localStorage.setItem(key, JSON.stringify({ metrics: m, notes: n, onLeave: leave }))
    } catch {
      /* storage unavailable (private mode / quota) — drafts just won't persist */
    }
  }

  useEffect(() => {
    getMyItadEntry()
      .then((res) => {
        setData(res)
        const key = `itad-draft:${user?.id ?? 'me'}:${res.date}`
        draftKeyRef.current = key
        // Base values from any saved entry, then overlay the local draft (latest edits win).
        let baseMetrics = res.entry
          ? (ITAD_METRICS.reduce((acc, m) => ({ ...acc, [m.key]: res.entry![m.key] }), {} as ItadTotals))
          : zeroTotals()
        let baseNotes = res.entry?.notes ?? ''
        let baseLeave = res.entry ? res.entry.status !== 'SUBMITTED' : false
        try {
          const raw = localStorage.getItem(key)
          if (raw) {
            const d = JSON.parse(raw) as { metrics?: Partial<ItadTotals>; notes?: string; onLeave?: boolean }
            if (d.metrics) baseMetrics = { ...baseMetrics, ...d.metrics }
            if (typeof d.notes === 'string') baseNotes = d.notes
            if (typeof d.onLeave === 'boolean') baseLeave = d.onLeave
          }
        } catch {
          /* ignore malformed draft */
        }
        setMetrics(baseMetrics)
        setNotes(baseNotes)
        setOnLeave(baseLeave)
      })
      .catch(() => addToast({ type: 'error', message: 'Could not load today’s entry.' }))
      .finally(() => setLoading(false))
  }, [addToast, user?.id])

  function clearEntry() {
    const zeros = zeroTotals()
    setMetrics(zeros)
    saveDraft(zeros, notes, onLeave)
  }

  const target = data?.stats.dailyDialTarget ?? 0
  const callsGoal = target ? metrics.callsDialed / target : 0
  const connectRate = metrics.callsDialed ? metrics.connected / metrics.callsDialed : 0

  const dateLabel = useMemo(() => {
    const d = data?.date ? new Date(`${data.date}T00:00:00`) : new Date()
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  }, [data?.date])

  async function submit() {
    setSubmitting(true)
    try {
      await upsertItadEntry({
        status: onLeave ? 'ON_LEAVE' : 'SUBMITTED',
        notes,
        ...(onLeave ? {} : metrics),
      })
      // Saved server-side now — drop the local draft so it can't override the saved values.
      if (draftKeyRef.current) localStorage.removeItem(draftKeyRef.current)
      addToast({ type: 'success', message: onLeave ? 'Marked as On Leave today.' : 'Daily entry submitted.' })
    } catch {
      addToast({ type: 'error', message: 'Could not submit. Please try again.' })
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <div className="p-2 text-body-md text-ink-muted">Loading…</div>

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-headline-lg text-ink">Daily Activity Log</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">{dateLabel}</p>
        </div>
        <label className="flex items-center gap-3 rounded-btn border border-line bg-card px-4 py-2">
          <span className="text-body-sm font-medium text-ink-muted">On Leave / Off Today</span>
          <Toggle
            checked={onLeave}
            onChange={(v) => {
              setOnLeave(v)
              saveDraft(metrics, notes, v)
            }}
            label="On leave today"
          />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Form */}
        <div className="lg:col-span-2">
          <Card>
            <div className={'grid grid-cols-1 gap-4 sm:grid-cols-2 ' + (onLeave ? 'pointer-events-none' : '')}>
              {ITAD_METRICS.map((m) => (
                <NumberStepper
                  key={m.key}
                  label={m.label}
                  icon={ICONS[m.key]}
                  value={metrics[m.key]}
                  onChange={(v) =>
                    setMetrics((prev) => {
                      const next = { ...prev, [m.key]: v }
                      saveDraft(next, notes, onLeave)
                      return next
                    })
                  }
                  disabled={onLeave}
                />
              ))}
            </div>

            <div className="mt-5">
              <label className="mb-1 block text-body-sm font-medium text-ink-muted">Notes / Comments</label>
              <textarea
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value)
                  saveDraft(metrics, e.target.value, onLeave)
                }}
                rows={3}
                placeholder="Add any specific context for today's activity…"
                className="w-full rounded-btn border border-line bg-bg p-3 text-body-md text-ink placeholder:text-ink-muted focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10"
              />
            </div>

          </Card>

          <div className="mt-6">
            <AttachmentsCard kind="ITAD" date={data?.date} disabled={onLeave} />
          </div>

          <div className="mt-6 flex gap-3">
            <Button variant="secondary" size="lg" onClick={clearEntry} disabled={submitting || onLeave} leadingIcon={<RotateCcw size={16} />}>
              Clear
            </Button>
            <Button className="flex-1" size="lg" onClick={submit} disabled={submitting} leadingIcon={<UploadCloud size={18} />}>
              {submitting ? 'Submitting…' : onLeave ? 'Submit On-Leave Day' : 'Submit Day'}
            </Button>
          </div>
        </div>

        {/* Today vs Avg */}
        <div>
          <Card title="Today vs Avg">
            <div className="flex items-center justify-around">
              <RadialGauge value={callsGoal} label="Calls Goal" color={CHART.primary} />
              <RadialGauge value={connectRate} label="Connect Rate" color={CHART.accent} />
            </div>
            <div className="mt-5 space-y-2 border-t border-line pt-4 text-body-sm">
              <Row label="Daily dial target" value={target ? `${target}` : '—'} />
              <Row label="Avg daily connected" value={`${data?.stats.avgConnected ?? 0}`} />
              <Row label="Avg connect rate" value={`${Math.round((data?.stats.avgConnectRate ?? 0) * 100)}%`} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-muted">{label}</span>
      <span className="font-semibold tabular-nums text-ink">{value}</span>
    </div>
  )
}
