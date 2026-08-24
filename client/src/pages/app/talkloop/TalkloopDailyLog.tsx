import { useEffect, useMemo, useState } from 'react'
import { Phone, PhoneCall, CalendarClock, MonitorPlay, UploadCloud, Plus, X, Globe } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { NumberStepper } from '../../../components/ui/NumberStepper'
import { Toggle } from '../../../components/ui/Toggle'
import { useToast } from '../../../components/ui/Toast'
import { ApiError } from '../../../lib/api'
import {
  TALKLOOP_METRICS,
  getMyTalkloopEntry,
  upsertTalkloopEntry,
  createTalkloopCountry,
  type TalkloopEntryResponse,
  type TalkloopMetricKey,
  type TalkloopTotals,
  type CountryTag,
} from '../../../lib/talkloopApi'

const ICONS: Record<TalkloopMetricKey, React.ReactNode> = {
  callsMade: <Phone size={14} />,
  connects: <PhoneCall size={14} />,
  demosScheduled: <CalendarClock size={14} />,
  demosConducted: <MonitorPlay size={14} />,
}

function zeroMetrics(): TalkloopTotals {
  return TALKLOOP_METRICS.reduce((a, m) => ({ ...a, [m.key]: 0 }), {} as TalkloopTotals)
}
type CD = { calls: number; demos: number }

export default function TalkloopDailyLog() {
  const { addToast } = useToast()
  const [data, setData] = useState<TalkloopEntryResponse | null>(null)
  const [countries, setCountries] = useState<CountryTag[]>([])
  const [metrics, setMetrics] = useState<TalkloopTotals>(zeroMetrics)
  const [cCounts, setCCounts] = useState<Record<string, CD>>({})
  const [selected, setSelected] = useState<string[]>([])
  const [showNew, setShowNew] = useState(false)
  const [newCountry, setNewCountry] = useState('')
  const [adding, setAdding] = useState(false)
  const [notes, setNotes] = useState('')
  const [onLeave, setOnLeave] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    getMyTalkloopEntry()
      .then((res) => {
        setData(res)
        setCountries(res.countries)
        if (res.entry) {
          setOnLeave(res.entry.status !== 'SUBMITTED')
          setNotes(res.entry.notes)
          setMetrics(TALKLOOP_METRICS.reduce((a, m) => ({ ...a, [m.key]: res.entry![m.key] }), {} as TalkloopTotals))
          const cc: Record<string, CD> = {}
          for (const c of res.entry.countryCounts) cc[c.tagId] = { calls: c.calls, demos: c.demos }
          setCCounts(cc)
          setSelected(Object.keys(cc))
        }
      })
      .catch(() => addToast({ type: 'error', message: 'Could not load today’s entry.' }))
      .finally(() => setLoading(false))
  }, [addToast])

  const allocatedCalls = useMemo(
    () => selected.reduce((a, id) => a + (cCounts[id]?.calls || 0), 0),
    [selected, cCounts],
  )
  const availableCountries = useMemo(() => countries.filter((c) => !selected.includes(c.id)), [countries, selected])

  function addCountry(id: string) {
    if (!id || selected.includes(id)) return
    setSelected((p) => [...p, id])
    setCCounts((p) => ({ ...p, [id]: p[id] ?? { calls: 0, demos: 0 } }))
  }
  function removeCountry(id: string) {
    setSelected((p) => p.filter((x) => x !== id))
    setCCounts((p) => {
      const next = { ...p }
      delete next[id]
      return next
    })
  }
  function setCD(id: string, patch: Partial<CD>) {
    setCCounts((p) => ({ ...p, [id]: { ...(p[id] ?? { calls: 0, demos: 0 }), ...patch } }))
  }

  async function createCountry() {
    const name = newCountry.trim()
    if (!name || adding) return
    setAdding(true)
    try {
      const { country } = await createTalkloopCountry(name)
      setCountries((p) => (p.some((c) => c.id === country.id) ? p : [...p, country].sort((a, b) => a.name.localeCompare(b.name))))
      addCountry(country.id)
      setNewCountry('')
      setShowNew(false)
    } catch (err) {
      addToast({ type: 'error', message: err instanceof ApiError ? err.message : 'Could not add country.' })
    } finally {
      setAdding(false)
    }
  }

  const dateLabel = useMemo(() => {
    const d = data?.date ? new Date(`${data.date}T00:00:00`) : new Date()
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  }, [data?.date])

  async function submit() {
    setSubmitting(true)
    try {
      await upsertTalkloopEntry({
        status: onLeave ? 'ON_LEAVE' : 'SUBMITTED',
        notes,
        ...(onLeave ? {} : metrics),
        countryCounts: onLeave ? [] : selected.map((tagId) => ({ tagId, calls: cCounts[tagId]?.calls ?? 0, demos: cCounts[tagId]?.demos ?? 0 })),
      })
      addToast({ type: 'success', message: onLeave ? 'Marked as On Leave today.' : 'Daily entry submitted.' })
    } catch {
      addToast({ type: 'error', message: 'Could not submit. Please try again.' })
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <div className="p-2 text-body-md text-ink-muted">Loading…</div>

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-headline-lg text-ink">Talkloop Daily Log</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">{dateLabel}</p>
        </div>
        <label className="flex items-center gap-3 rounded-btn border border-line bg-card px-4 py-2">
          <span className="text-body-sm font-medium text-ink-muted">On Leave / Off Today</span>
          <Toggle checked={onLeave} onChange={setOnLeave} label="On leave today" />
        </label>
      </div>

      <div className={onLeave ? 'pointer-events-none opacity-60' : ''}>
        <Card title="Core Metrics">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {TALKLOOP_METRICS.map((m) => (
              <NumberStepper
                key={m.key}
                label={m.label}
                icon={ICONS[m.key]}
                value={metrics[m.key]}
                onChange={(v) => setMetrics((p) => ({ ...p, [m.key]: v }))}
                disabled={onLeave}
              />
            ))}
          </div>
        </Card>

        <Card
          title="By Country"
          subtitle={`Calls & demos per country · ${allocatedCalls} of ${metrics.callsMade} calls allocated`}
          className="mt-6"
        >
          {selected.length === 0 ? (
            <p className="text-body-sm text-ink-muted">No countries added yet — use “Add country” below to pick one.</p>
          ) : (
            <div className="space-y-3">
              {selected.map((id) => {
                const c = countries.find((x) => x.id === id)
                if (!c) return null
                return (
                  <div key={id} className="rounded-card border border-line bg-bg p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-body-md font-semibold text-ink"><Globe size={14} className="text-ink-muted" />{c.name}</span>
                      <button
                        type="button"
                        onClick={() => removeCountry(id)}
                        disabled={onLeave}
                        className="flex h-6 w-6 items-center justify-center rounded-full text-ink-muted hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                        aria-label={`Remove ${c.name}`}
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <NumberStepper label="Calls" value={cCounts[id]?.calls ?? 0} onChange={(n) => setCD(id, { calls: n })} disabled={onLeave} />
                      <NumberStepper label="Demos" value={cCounts[id]?.demos ?? 0} onChange={(n) => setCD(id, { demos: n })} disabled={onLeave} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <div className="mt-4">
            {showNew ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  placeholder="New country name"
                  value={newCountry}
                  autoFocus
                  onChange={(e) => setNewCountry(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); createCountry() } }}
                  disabled={onLeave || adding}
                  className="h-10 w-56 rounded-btn border border-line bg-card px-3 text-body-md text-ink placeholder:text-ink-muted focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10 disabled:opacity-50"
                />
                <Button size="sm" onClick={createCountry} disabled={onLeave || adding || !newCountry.trim()}>{adding ? 'Adding…' : 'Add'}</Button>
                <Button size="sm" variant="ghost" onClick={() => { setShowNew(false); setNewCountry('') }}>Cancel</Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value=""
                  disabled={onLeave || availableCountries.length === 0}
                  onChange={(e) => { addCountry(e.target.value); e.currentTarget.value = '' }}
                  className="h-10 w-56 rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10 disabled:opacity-50"
                >
                  <option value="">{availableCountries.length ? '+ Add country…' : 'All countries added'}</option>
                  {availableCountries.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <Button size="sm" variant="secondary" leadingIcon={<Plus size={16} />} onClick={() => setShowNew(true)} disabled={onLeave}>New country</Button>
              </div>
            )}
          </div>
        </Card>

        <Card title="Notes" className="mt-6">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="e.g. strong interest from UK SMBs, follow-ups booked…"
            className="w-full rounded-btn border border-line bg-bg p-3 text-body-md text-ink placeholder:text-ink-muted focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10"
          />
        </Card>
      </div>

      <Button className="mt-6 w-full sm:w-auto" size="lg" onClick={submit} disabled={submitting} leadingIcon={<UploadCloud size={18} />}>
        {submitting ? 'Submitting…' : onLeave ? 'Submit On-Leave Day' : 'Submit Day'}
      </Button>
    </div>
  )
}
