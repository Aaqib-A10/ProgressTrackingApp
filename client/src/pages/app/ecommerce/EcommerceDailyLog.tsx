import { useEffect, useMemo, useState } from 'react'
import { UploadCloud, ShoppingCart } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { Toggle } from '../../../components/ui/Toggle'
import { StatCard } from '../../../components/StatCard'
import { useToast } from '../../../components/ui/Toast'
import { getMyEcommerceEntry, upsertEcommerceEntry, type EcommerceEntryResponse, type WorkType, type TagOption } from '../../../lib/ecommerceApi'

const key = (fieldId: string, mpId: string) => `${fieldId}::${mpId}`

export default function EcommerceDailyLog() {
  const { addToast } = useToast()
  const [data, setData] = useState<EcommerceEntryResponse | null>(null)
  const [cells, setCells] = useState<Record<string, number>>({})
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
          const init: Record<string, number> = {}
          for (const l of res.entry.lines) init[key(l.taskTypeId, l.marketplaceId)] = l.listings
          setCells(init)
        }
      })
      .catch(() => addToast({ type: 'error', message: 'Could not load today’s report.' }))
      .finally(() => setLoading(false))
  }, [addToast])

  const dateLabel = useMemo(() => {
    const d = data?.date ? new Date(`${data.date}T00:00:00`) : new Date()
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  }, [data?.date])

  const grandTotal = useMemo(() => Object.values(cells).reduce((s, v) => s + (Number(v) || 0), 0), [cells])
  const setCell = (fieldId: string, mpId: string, v: number) =>
    setCells((prev) => ({ ...prev, [key(fieldId, mpId)]: Math.max(0, Math.floor(Number(v) || 0)) }))

  async function submit() {
    if (submitting) return
    const lines = Object.entries(cells)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => { const [taskTypeId, marketplaceId] = k.split('::'); return { taskTypeId, marketplaceId, listings: v } })
    if (!onLeave && lines.length === 0) {
      addToast({ type: 'error', message: 'Enter at least one number.' })
      return
    }
    setSubmitting(true)
    try {
      await upsertEcommerceEntry({ status: onLeave ? 'ON_LEAVE' : 'SUBMITTED', notes, lines: onLeave ? [] : lines })
      addToast({ type: 'success', message: onLeave ? 'Marked as On Leave today.' : 'Daily report submitted.' })
    } catch {
      addToast({ type: 'error', message: 'Could not submit. Please try again.' })
    } finally {
      setSubmitting(false)
    }
  }

  if (loading || !data) return <div className="p-2 text-body-md text-ink-muted">Loading…</div>
  const marketplaces = data.marketplaces

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-headline-lg text-ink">Daily Report</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">{dateLabel}</p>
        </div>
        <label className="flex items-center gap-3 rounded-btn border border-line bg-card px-4 py-2">
          <span className="text-body-sm font-medium text-ink-muted">On Leave / Off Today</span>
          <Toggle checked={onLeave} onChange={setOnLeave} label="On leave today" />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_260px]">
        <div className={'space-y-5 ' + (onLeave ? 'pointer-events-none opacity-50' : '')}>
          {data.types.map((type: WorkType) => (
            <TypeGrid key={type.name} type={type} marketplaces={marketplaces} cells={cells} setCell={setCell} disabled={onLeave} />
          ))}

          <Card>
            <label className="mb-1 block text-body-sm font-medium text-ink-muted">Notes / Comments</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Any context for today…" className="w-full rounded-btn border border-line bg-bg p-3 text-body-md text-ink placeholder:text-ink-muted focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10" />
          </Card>
        </div>

        <div className="space-y-4">
          <StatCard label="Total actions today" value={grandTotal.toLocaleString()} icon={<ShoppingCart size={16} />} />
          <Card title="Per type">
            <ul className="space-y-1.5 text-body-sm">
              {data.types.map((t) => {
                const sum = t.fields.reduce((s, f) => s + marketplaces.reduce((m, mp) => m + (cells[key(f.id, mp.id)] || 0), 0), 0)
                return (
                  <li key={t.name} className="flex items-center justify-between">
                    <span className="text-ink-muted">{t.name}</span>
                    <span className="font-semibold tabular-nums text-ink">{sum.toLocaleString()}</span>
                  </li>
                )
              })}
            </ul>
          </Card>
          <Button className="w-full" size="lg" onClick={submit} disabled={submitting} leadingIcon={<UploadCloud size={18} />}>
            {submitting ? 'Submitting…' : onLeave ? 'Submit On-Leave Day' : 'Submit Day'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function TypeGrid({ type, marketplaces, cells, setCell, disabled }: {
  type: WorkType; marketplaces: TagOption[]; cells: Record<string, number>
  setCell: (fieldId: string, mpId: string, v: number) => void; disabled: boolean
}) {
  const colTotal = (mpId: string) => type.fields.reduce((s, f) => s + (cells[key(f.id, mpId)] || 0), 0)
  const rowTotal = (fieldId: string) => marketplaces.reduce((s, mp) => s + (cells[key(fieldId, mp.id)] || 0), 0)
  const sectionTotal = type.fields.reduce((s, f) => s + rowTotal(f.id), 0)

  return (
    <Card title={type.name} subtitle={`by marketplace · ${sectionTotal} total`} flush>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-body-sm">
          <thead>
            <tr className="border-b border-line text-label-md uppercase text-ink-muted">
              <th className="px-4 py-2.5 text-left font-semibold">Field</th>
              {marketplaces.map((m) => <th key={m.id} className="px-2 py-2.5 text-center font-semibold">{m.name}</th>)}
              <th className="px-3 py-2.5 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {type.fields.map((f) => (
              <tr key={f.id} className="hover:bg-slate-50/60">
                <td className="px-4 py-1.5 font-medium text-ink">{f.name}</td>
                {marketplaces.map((m) => (
                  <td key={m.id} className="px-1 py-1.5 text-center">
                    <input
                      type="number" min={0} inputMode="numeric" disabled={disabled}
                      value={cells[key(f.id, m.id)] ?? ''}
                      onChange={(e) => setCell(f.id, m.id, e.target.value === '' ? 0 : Number(e.target.value))}
                      placeholder="0"
                      className="h-8 w-16 rounded-btn border border-line bg-bg text-center text-body-sm tabular-nums text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10 disabled:opacity-50"
                    />
                  </td>
                ))}
                <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-ink">{rowTotal(f.id) || ''}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line text-label-md uppercase text-ink-muted">
              <td className="px-4 py-2 text-left font-semibold">Total</td>
              {marketplaces.map((m) => <td key={m.id} className="px-2 py-2 text-center font-semibold tabular-nums text-ink">{colTotal(m.id) || ''}</td>)}
              <td className="px-3 py-2 text-right font-bold tabular-nums text-ink">{sectionTotal || ''}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  )
}
