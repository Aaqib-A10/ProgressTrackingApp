import { useEffect, useMemo, useRef, useState } from 'react'
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
  const [pricingNotes, setPricingNotes] = useState('')
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
          setPricingNotes(res.entry.pricingNotes)
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
    if (!onLeave && lines.length === 0 && !pricingNotes.trim()) {
      addToast({ type: 'error', message: 'Enter at least one number or a pricing note.' })
      return
    }
    setSubmitting(true)
    try {
      await upsertEcommerceEntry({ status: onLeave ? 'ON_LEAVE' : 'SUBMITTED', notes, pricingNotes, lines: onLeave ? [] : lines })
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

          <Card title="Pricing" subtitle="Notes only">
            <textarea
              value={pricingNotes}
              onChange={(e) => setPricingNotes(e.target.value)}
              rows={3}
              disabled={onLeave}
              placeholder="Pricing work today — reprices, corrections, price updates, context…"
              className="w-full rounded-btn border border-line bg-bg p-3 text-body-md text-ink placeholder:text-ink-muted focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10"
            />
          </Card>

          <Card>
            <label className="mb-1 block text-body-sm font-medium text-ink-muted">Notes / Comments</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Any context for today…" className="w-full rounded-btn border border-line bg-bg p-3 text-body-md text-ink placeholder:text-ink-muted focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10" />
          </Card>
        </div>

        <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
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

/** Accessible numeric grid cell: white field, strong focus, no spinner,
 *  select-on-focus, Enter/↑/↓ to move down a column, ←/→ across. Navigation is
 *  scoped to its own grid via onNav so multiple sections don't collide. */
function NumberCell({ label, value, disabled, onChange, onNav, r, c }: {
  label: string; value: number; disabled: boolean
  onChange: (v: number) => void; onNav: (dr: number, dc: number) => void
  r: number; c: number
}) {
  return (
    <input
      data-r={r}
      data-c={c}
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      disabled={disabled}
      aria-label={label}
      value={value || ''}
      placeholder="—"
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value.replace(/\D/g, '')) || 0)))}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); onNav(1, 0) }
        else if (e.key === 'ArrowUp') { e.preventDefault(); onNav(-1, 0) }
      }}
      className="h-9 w-20 rounded-btn border border-line bg-white px-2 text-right text-body-md tabular-nums text-ink placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:bg-slate-50 disabled:text-slate-400"
    />
  )
}

function TypeGrid({ type, marketplaces, cells, setCell, disabled }: {
  type: WorkType; marketplaces: TagOption[]; cells: Record<string, number>
  setCell: (fieldId: string, mpId: string, v: number) => void; disabled: boolean
}) {
  const tableRef = useRef<HTMLTableElement>(null)
  const colTotal = (mpId: string) => type.fields.reduce((s, f) => s + (cells[key(f.id, mpId)] || 0), 0)
  const rowTotal = (fieldId: string) => marketplaces.reduce((s, mp) => s + (cells[key(fieldId, mp.id)] || 0), 0)
  const sectionTotal = type.fields.reduce((s, f) => s + rowTotal(f.id), 0)

  // Move focus within this grid only (scoped to tableRef).
  const nav = (r: number, c: number) => (dr: number, dc: number) => {
    const next = tableRef.current?.querySelector<HTMLInputElement>(`input[data-r="${r + dr}"][data-c="${c + dc}"]`)
    next?.focus()
  }

  return (
    <Card flush>
      {/* Distinct, high-contrast section header */}
      <div className="flex items-baseline justify-between border-b border-line px-4 py-3">
        <h2 className="text-headline-md font-semibold text-ink">{type.name}</h2>
        <span className="text-body-sm text-slate-600">{sectionTotal.toLocaleString()} total · by marketplace</span>
      </div>

      <div className="overflow-x-auto">
        <table ref={tableRef} className="w-full min-w-[560px] border-collapse">
          {/* Shared column widths keep the TOTAL row aligned under the data cells */}
          <colgroup>
            <col className="w-[34%]" />
            {marketplaces.map((m) => <col key={m.id} />)}
            <col className="w-24" />
          </colgroup>
          <thead>
            <tr className="bg-slate-50 text-label-md uppercase tracking-wide text-slate-600">
              <th scope="col" className="px-4 py-2.5 text-left font-semibold">Field</th>
              {marketplaces.map((m) => <th key={m.id} scope="col" className="px-3 py-2.5 text-right font-semibold text-ink">{m.name}</th>)}
              <th scope="col" className="px-4 py-2.5 text-right font-semibold text-ink">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {type.fields.map((f, r) => (
              <tr key={f.id} className="hover:bg-slate-50/60">
                <th scope="row" className="px-4 py-2 text-left text-body-md font-medium text-ink">{f.name}</th>
                {marketplaces.map((m, c) => (
                  <td key={m.id} className="px-3 py-2 text-right">
                    <NumberCell
                      label={`${f.name} — ${m.name}`}
                      value={cells[key(f.id, m.id)] || 0}
                      disabled={disabled}
                      onChange={(v) => setCell(f.id, m.id, v)}
                      onNav={nav(r, c)}
                      r={r}
                      c={c}
                    />
                  </td>
                ))}
                <td className="px-4 py-2 text-right text-body-md font-semibold tabular-nums text-ink">{rowTotal(f.id) || '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line bg-slate-50">
              <th scope="row" className="px-4 py-2.5 text-left text-body-md font-bold text-ink">Total</th>
              {marketplaces.map((m) => <td key={m.id} className="px-3 py-2.5 text-right text-body-md font-semibold tabular-nums text-ink">{colTotal(m.id) || '—'}</td>)}
              <td className="px-4 py-2.5 text-right text-body-md font-bold tabular-nums text-primary">{sectionTotal.toLocaleString()}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  )
}
