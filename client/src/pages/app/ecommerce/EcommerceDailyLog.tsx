import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, UploadCloud, ShoppingCart } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { NumberStepper } from '../../../components/ui/NumberStepper'
import { Toggle } from '../../../components/ui/Toggle'
import { StatCard } from '../../../components/StatCard'
import { useToast } from '../../../components/ui/Toast'
import {
  getMyEcommerceEntry,
  upsertEcommerceEntry,
  type EcommerceEntryResponse,
  type TagOption,
} from '../../../lib/ecommerceApi'

interface EditLine {
  _id: number
  taskTypeId: string
  marketplaceId: string
  listings: number
}
let nextId = 1
const newLine = (taskTypeId = '', marketplaceId = ''): EditLine => ({ _id: nextId++, taskTypeId, marketplaceId, listings: 0 })

export default function EcommerceDailyLog() {
  const { addToast } = useToast()
  const [data, setData] = useState<EcommerceEntryResponse | null>(null)
  const [lines, setLines] = useState<EditLine[]>([])
  const [notes, setNotes] = useState('')
  const [onLeave, setOnLeave] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    getMyEcommerceEntry()
      .then((res) => {
        setData(res)
        if (res.entry) {
          setOnLeave(res.entry.status !== 'SUBMITTED')
          setNotes(res.entry.notes)
          setLines(res.entry.lines.length ? res.entry.lines.map((l) => ({ ...newLine(l.taskTypeId, l.marketplaceId), listings: l.listings })) : [newLine()])
        } else {
          setLines([newLine()])
        }
      })
      .catch(() => addToast({ type: 'error', message: 'Could not load today’s report.' }))
      .finally(() => setLoading(false))
  }, [addToast])

  const dateLabel = useMemo(() => {
    const d = data?.date ? new Date(`${data.date}T00:00:00`) : new Date()
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  }, [data?.date])

  const total = lines.reduce((s, l) => s + (Number(l.listings) || 0), 0)

  function update(id: number, patch: Partial<EditLine>) {
    setLines((prev) => prev.map((l) => (l._id === id ? { ...l, ...patch } : l)))
  }

  async function submit() {
    if (submitting) return
    const validLines = lines
      .filter((l) => l.taskTypeId && l.marketplaceId && l.listings > 0)
      .map((l) => ({ taskTypeId: l.taskTypeId, marketplaceId: l.marketplaceId, listings: Math.floor(Number(l.listings) || 0) }))
    if (!onLeave && validLines.length === 0) {
      addToast({ type: 'error', message: 'Add at least one line (task, marketplace & listings).' })
      return
    }
    setSubmitting(true)
    try {
      await upsertEcommerceEntry({ status: onLeave ? 'ON_LEAVE' : 'SUBMITTED', notes, lines: onLeave ? [] : validLines })
      addToast({ type: 'success', message: onLeave ? 'Marked as On Leave today.' : 'Daily report submitted.' })
    } catch {
      addToast({ type: 'error', message: 'Could not submit. Please try again.' })
    } finally {
      setSubmitting(false)
    }
  }

  if (loading || !data) return <div className="p-2 text-body-md text-ink-muted">Loading…</div>

  const selectCls = 'h-9 w-full rounded-btn border border-line bg-bg px-2.5 text-body-sm text-ink focus:border-primary focus:outline-none disabled:opacity-50'

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-headline-lg text-ink">Daily Listings Report</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">{dateLabel}</p>
        </div>
        <label className="flex items-center gap-3 rounded-btn border border-line bg-card px-4 py-2">
          <span className="text-body-sm font-medium text-ink-muted">On Leave / Off Today</span>
          <Toggle checked={onLeave} onChange={setOnLeave} label="On leave today" />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Listings published" subtitle="One line per task type & marketplace">
            <div className={onLeave ? 'pointer-events-none opacity-50' : ''}>
              {/* header */}
              <div className="mb-1 hidden gap-2 px-1 text-label-md uppercase text-ink-muted sm:grid sm:grid-cols-[1fr_1fr_140px_36px]">
                <span>Task type</span><span>Marketplace</span><span className="text-right">Listings</span><span />
              </div>
              <div className="space-y-2">
                {lines.map((l) => (
                  <div key={l._id} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[1fr_1fr_140px_36px]">
                    <select className={selectCls} value={l.taskTypeId} onChange={(e) => update(l._id, { taskTypeId: e.target.value })} disabled={onLeave}>
                      <option value="">Select task…</option>
                      {data.taskTypes.map((t: TagOption) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    <select className={selectCls} value={l.marketplaceId} onChange={(e) => update(l._id, { marketplaceId: e.target.value })} disabled={onLeave}>
                      <option value="">Select marketplace…</option>
                      {data.marketplaces.map((m: TagOption) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                    <NumberStepper label="" value={l.listings} onChange={(v) => update(l._id, { listings: v })} disabled={onLeave} min={0} />
                    <button onClick={() => setLines((prev) => (prev.length > 1 ? prev.filter((x) => x._id !== l._id) : prev))} className="flex h-9 w-9 items-center justify-center rounded-btn text-ink-muted hover:bg-danger/10 hover:text-danger" aria-label="Remove line" disabled={onLeave}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
              <Button variant="ghost" size="sm" leadingIcon={<Plus size={15} />} onClick={() => setLines((prev) => [...prev, newLine()])} disabled={onLeave} className="mt-2">
                Add line
              </Button>
            </div>

            <div className="mt-5">
              <label className="mb-1 block text-body-sm font-medium text-ink-muted">Notes / Comments</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Any context for today…" className="w-full rounded-btn border border-line bg-bg p-3 text-body-md text-ink placeholder:text-ink-muted focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10" />
            </div>
          </Card>

          <Button className="mt-6 w-full" size="lg" onClick={submit} disabled={submitting} leadingIcon={<UploadCloud size={18} />}>
            {submitting ? 'Submitting…' : onLeave ? 'Submit On-Leave Day' : 'Submit Day'}
          </Button>
        </div>

        <div className="space-y-4">
          <StatCard label="Total listings today" value={total.toLocaleString()} icon={<ShoppingCart size={16} />} />
          <Card title="Recent">
            <div className="space-y-2 text-body-sm">
              <Row label="Avg listings / day" value={`${data.stats.avgListings}`} />
              <Row label="Days logged (last 14)" value={`${data.stats.daysLogged}`} />
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
