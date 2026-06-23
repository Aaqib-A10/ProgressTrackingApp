import { useEffect, useMemo, useState } from 'react'
import { Users, Search, Contact, BadgeCheck, Send, UploadCloud, Plus, X, Tags } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { NumberStepper } from '../../../components/ui/NumberStepper'
import { AttachmentsCard } from '../../../components/AttachmentsCard'
import { Toggle } from '../../../components/ui/Toggle'
import { TextField } from '../../../components/ui/Input'
import { useToast } from '../../../components/ui/Toast'
import { ApiError } from '../../../lib/api'
import {
  LEADGEN_METRICS,
  getMyLeadGenEntry,
  upsertLeadGenEntry,
  createLeadGenVertical,
  type LeadGenEntryResponse,
  type LeadGenMetricKey,
  type LeadGenTotals,
  type VerticalTag,
} from '../../../lib/leadgenApi'

const ICONS: Record<LeadGenMetricKey, React.ReactNode> = {
  leadsGenerated: <Users size={14} />,
  accountsResearched: <Search size={14} />,
  contactsFound: <Contact size={14} />,
  qualifiedMql: <BadgeCheck size={14} />,
  handedToSql: <Send size={14} />,
}

function zeroMetrics(): LeadGenTotals {
  return LEADGEN_METRICS.reduce((a, m) => ({ ...a, [m.key]: 0 }), {} as LeadGenTotals)
}

export default function LeadGenDailyForm() {
  const { addToast } = useToast()
  const [data, setData] = useState<LeadGenEntryResponse | null>(null)
  const [verticals, setVerticals] = useState<VerticalTag[]>([])
  const [leadTypes, setLeadTypes] = useState<VerticalTag[]>([])
  const [metrics, setMetrics] = useState<LeadGenTotals>(zeroMetrics)
  const [vCounts, setVCounts] = useState<Record<string, number>>({})
  const [ltCounts, setLtCounts] = useState<Record<string, number>>({})
  const [selectedVerticals, setSelectedVerticals] = useState<string[]>([])
  const [showNewIndustry, setShowNewIndustry] = useState(false)
  const [newIndustry, setNewIndustry] = useState('')
  const [addingIndustry, setAddingIndustry] = useState(false)
  const [dataSource, setDataSource] = useState('')
  const [notes, setNotes] = useState('')
  const [onLeave, setOnLeave] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    getMyLeadGenEntry()
      .then((res) => {
        setData(res)
        setVerticals(res.verticals)
        setLeadTypes(res.leadTypes)
        if (res.entry) {
          setOnLeave(res.entry.status !== 'SUBMITTED')
          setNotes(res.entry.notes)
          setDataSource(res.entry.dataSource)
          setMetrics(LEADGEN_METRICS.reduce((a, m) => ({ ...a, [m.key]: res.entry![m.key] }), {} as LeadGenTotals))
          // The breakdown table mixes industry + lead-type counts; split by which list each id belongs to.
          const verticalIds = new Set(res.verticals.map((v) => v.id))
          const leadTypeIds = new Set(res.leadTypes.map((v) => v.id))
          const v: Record<string, number> = {}
          const lt: Record<string, number> = {}
          for (const c of res.entry.verticalCounts) {
            if (leadTypeIds.has(c.tagId)) lt[c.tagId] = c.count
            else if (verticalIds.has(c.tagId)) v[c.tagId] = c.count
          }
          setVCounts(v)
          setLtCounts(lt)
          setSelectedVerticals(Object.keys(v))
        }
      })
      .catch(() => addToast({ type: 'error', message: 'Could not load today’s entry.' }))
      .finally(() => setLoading(false))
  }, [addToast])

  const allocated = useMemo(
    () => selectedVerticals.reduce((a, id) => a + (vCounts[id] || 0), 0),
    [selectedVerticals, vCounts],
  )
  const availableVerticals = useMemo(
    () => verticals.filter((v) => !selectedVerticals.includes(v.id)),
    [verticals, selectedVerticals],
  )

  function addIndustry(id: string) {
    if (!id || selectedVerticals.includes(id)) return
    setSelectedVerticals((p) => [...p, id])
    setVCounts((p) => ({ ...p, [id]: p[id] ?? 0 }))
  }

  function removeIndustry(id: string) {
    setSelectedVerticals((p) => p.filter((x) => x !== id))
    setVCounts((p) => {
      const next = { ...p }
      delete next[id]
      return next
    })
  }

  async function createIndustry() {
    const name = newIndustry.trim()
    if (!name || addingIndustry) return
    setAddingIndustry(true)
    try {
      const { vertical } = await createLeadGenVertical(name)
      setVerticals((p) => (p.some((v) => v.id === vertical.id) ? p : [...p, vertical].sort((a, b) => a.name.localeCompare(b.name))))
      addIndustry(vertical.id)
      setNewIndustry('')
      setShowNewIndustry(false)
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Could not add industry.'
      addToast({ type: 'error', message: msg })
    } finally {
      setAddingIndustry(false)
    }
  }
  const dateLabel = useMemo(() => {
    const d = data?.date ? new Date(`${data.date}T00:00:00`) : new Date()
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  }, [data?.date])

  async function submit() {
    setSubmitting(true)
    try {
      await upsertLeadGenEntry({
        status: onLeave ? 'ON_LEAVE' : 'SUBMITTED',
        notes,
        dataSource,
        ...(onLeave ? {} : metrics),
        verticalCounts: onLeave ? [] : selectedVerticals.map((tagId) => ({ tagId, count: vCounts[tagId] ?? 0 })),
        leadTypeCounts: onLeave ? [] : Object.entries(ltCounts).map(([tagId, count]) => ({ tagId, count })),
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
          <h1 className="text-headline-lg text-ink">Lead Gen Daily Log</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">{dateLabel}</p>
        </div>
        <label className="flex items-center gap-3 rounded-btn border border-line bg-card px-4 py-2">
          <span className="text-body-sm font-medium text-ink-muted">On Leave / Off Today</span>
          <Toggle checked={onLeave} onChange={setOnLeave} label="On leave today" />
        </label>
      </div>

      <div className={onLeave ? 'pointer-events-none opacity-60' : ''}>
        <Card title="Core Metrics">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {LEADGEN_METRICS.map((m) => (
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
          title="Industry Breakdown"
          subtitle={`${allocated} of ${metrics.leadsGenerated} leads allocated by industry`}
          className="mt-6"
        >
          {selectedVerticals.length === 0 ? (
            <p className="text-body-sm text-ink-muted">No industries added yet — use “Add industry” below to pick one.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {selectedVerticals.map((id) => {
                const v = verticals.find((x) => x.id === id)
                if (!v) return null
                return (
                  <div key={id} className="relative">
                    <NumberStepper
                      label={v.name}
                      value={vCounts[id] ?? 0}
                      onChange={(n) => setVCounts((p) => ({ ...p, [id]: n }))}
                      disabled={onLeave}
                    />
                    <button
                      type="button"
                      onClick={() => removeIndustry(id)}
                      disabled={onLeave}
                      className="absolute right-0 top-0 flex h-5 w-5 items-center justify-center rounded-full text-ink-muted hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                      aria-label={`Remove ${v.name}`}
                    >
                      <X size={14} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Add industry: pick an existing one, or create a new one inline. */}
          <div className="mt-4">
            {showNewIndustry ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  placeholder="New industry name"
                  value={newIndustry}
                  autoFocus
                  onChange={(e) => setNewIndustry(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); createIndustry() } }}
                  disabled={onLeave || addingIndustry}
                  className="h-10 w-56 rounded-btn border border-line bg-card px-3 text-body-md text-ink placeholder:text-ink-muted focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10 disabled:opacity-50"
                />
                <Button size="sm" onClick={createIndustry} disabled={onLeave || addingIndustry || !newIndustry.trim()}>
                  {addingIndustry ? 'Adding…' : 'Add'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setShowNewIndustry(false); setNewIndustry('') }}>Cancel</Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value=""
                  disabled={onLeave || availableVerticals.length === 0}
                  onChange={(e) => { addIndustry(e.target.value); e.currentTarget.value = '' }}
                  className="h-10 w-56 rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10 disabled:opacity-50"
                >
                  <option value="">{availableVerticals.length ? '+ Add industry…' : 'All industries added'}</option>
                  {availableVerticals.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
                <Button size="sm" variant="secondary" leadingIcon={<Plus size={16} />} onClick={() => setShowNewIndustry(true)} disabled={onLeave}>
                  New industry
                </Button>
              </div>
            )}
          </div>
        </Card>

        <Card title="Lead Types" subtitle="How many of today’s leads fall into each type" className="mt-6">
          {leadTypes.length === 0 ? (
            <p className="text-body-sm text-ink-muted">No lead types configured.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {leadTypes.map((t) => (
                <NumberStepper
                  key={t.id}
                  label={t.name}
                  icon={<Tags size={14} />}
                  value={ltCounts[t.id] ?? 0}
                  onChange={(n) => setLtCounts((p) => ({ ...p, [t.id]: n }))}
                  disabled={onLeave}
                />
              ))}
            </div>
          )}
        </Card>

        <Card title="Details" className="mt-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField label="Data source / campaign" placeholder="e.g. LinkedIn, List X" value={dataSource} onChange={(e) => setDataSource(e.target.value)} />
          </div>
          <div className="mt-4">
            <label className="mb-1 block text-body-sm font-medium text-ink-muted">Notes / Comments</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="e.g. finishing School District list…"
              className="w-full rounded-btn border border-line bg-bg p-3 text-body-md text-ink placeholder:text-ink-muted focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10"
            />
          </div>
        </Card>

        <div className="mt-6">
          <AttachmentsCard kind="LEAD_GEN" date={data?.date} disabled={onLeave} />
        </div>
      </div>

      <Button className="mt-6 w-full sm:w-auto" size="lg" onClick={submit} disabled={submitting} leadingIcon={<UploadCloud size={18} />}>
        {submitting ? 'Submitting…' : onLeave ? 'Submit On-Leave Day' : 'Submit Day'}
      </Button>
    </div>
  )
}
