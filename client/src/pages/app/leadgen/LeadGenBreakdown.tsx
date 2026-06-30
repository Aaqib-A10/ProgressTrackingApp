import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, Save, Megaphone, Building2 } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { StatCard } from '../../../components/StatCard'
import { useToast } from '../../../components/ui/Toast'
import { formatNumber } from '../../../lib/format'
import { getLeadGenBreakdown, saveLeadGenBreakdown, type BreakdownKind, type BreakdownRow } from '../../../lib/leadgenBreakdownApi'

function thisMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

interface EditRow extends BreakdownRow {
  _id: number
}
let nextId = 1
const mk = (r: BreakdownRow): EditRow => ({ ...r, _id: nextId++ })

export default function LeadGenBreakdown() {
  const { addToast } = useToast()
  const [month, setMonth] = useState(thisMonth())
  const [rows, setRows] = useState<EditRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setLoading(true)
    getLeadGenBreakdown(month)
      .then((r) => setRows(r.rows.map(mk)))
      .catch(() => { setRows([]); addToast({ type: 'error', message: 'Could not load the breakdown.' }) })
      .finally(() => setLoading(false))
  }, [month, addToast])

  const maxMonth = useMemo(() => thisMonth(), [])

  // Live preview of the derived cards (mirrors the backend summarize()).
  const sum = (xs: EditRow[]) => xs.reduce((s, r) => s + (Number(r.count) || 0), 0)
  const campaigns = rows.filter((r) => r.kind === 'CAMPAIGN')
  const industries = rows.filter((r) => r.kind === 'INDUSTRY')
  const bbr = sum(campaigns.filter((c) => /bbr/i.test(c.category)))
  const rtlg = sum(campaigns.filter((c) => /rtlg/i.test(c.category)))
  const topIndustry = [...industries].sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0))[0]

  function update(id: number, patch: Partial<BreakdownRow>) {
    setRows((prev) => prev.map((r) => (r._id === id ? { ...r, ...patch } : r)))
  }
  function addRow(kind: BreakdownKind) {
    setRows((prev) => [...prev, mk({ category: '', kind, count: 0 })])
  }
  function removeRow(id: number) {
    setRows((prev) => prev.filter((r) => r._id !== id))
  }

  async function save() {
    if (saving) return
    const items: BreakdownRow[] = rows
      .map((r) => ({ category: r.category.trim(), kind: r.kind, count: Math.max(0, Math.floor(Number(r.count) || 0)) }))
      .filter((r) => r.category.length > 0)
    setSaving(true)
    try {
      await saveLeadGenBreakdown(month, items)
      addToast({ type: 'success', message: 'Breakdown saved.' })
    } catch (e) {
      addToast({ type: 'error', message: (e as { message?: string })?.message || 'Could not save.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">Monthly Breakdown</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">Lead Gen leads by campaign (BBR, RTLG) and industry — powers the Team View cards.</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="month" value={month} max={maxMonth} onChange={(e) => setMonth(e.target.value || thisMonth())} className="h-9 rounded-btn border border-line bg-card px-2.5 text-body-sm text-ink" />
          <Button size="sm" leadingIcon={<Save size={15} />} onClick={save} disabled={saving || loading}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="BBR" value={formatNumber(bbr)} icon={<Megaphone size={16} />} />
        <StatCard label="RTLG" value={formatNumber(rtlg)} icon={<Megaphone size={16} />} />
        <StatCard label="Top Industry" value={topIndustry?.category || '—'} caption={topIndustry ? `${formatNumber(Number(topIndustry.count) || 0)} leads` : 'no data'} icon={<Building2 size={16} />} />
        <StatCard label="Industries Total" value={formatNumber(sum(industries))} icon={<Building2 size={16} />} />
      </div>

      {loading ? (
        <Card><p className="py-10 text-center text-body-md text-ink-muted">Loading…</p></Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <RowEditor title="Campaigns" hint="e.g. BBR Mix Industries, Waqas RTLG, JD RTLG" rows={campaigns} onUpdate={update} onRemove={removeRow} onAdd={() => addRow('CAMPAIGN')} />
          <RowEditor title="Industries" hint="e.g. IT Services, Health Care, Education" rows={industries} onUpdate={update} onRemove={removeRow} onAdd={() => addRow('INDUSTRY')} />
        </div>
      )}
    </div>
  )
}

function RowEditor({
  title, hint, rows, onUpdate, onRemove, onAdd,
}: {
  title: string
  hint: string
  rows: EditRow[]
  onUpdate: (id: number, patch: Partial<BreakdownRow>) => void
  onRemove: (id: number) => void
  onAdd: () => void
}) {
  return (
    <Card title={title} subtitle={hint}>
      <div className="space-y-2">
        {rows.length === 0 && <p className="py-4 text-center text-body-sm text-ink-muted">No rows yet.</p>}
        {rows.map((r) => (
          <div key={r._id} className="flex items-center gap-2">
            <input
              value={r.category}
              onChange={(e) => onUpdate(r._id, { category: e.target.value })}
              placeholder="Name"
              className="h-9 flex-1 rounded-btn border border-line bg-bg px-3 text-body-sm text-ink focus:border-primary focus:outline-none"
            />
            <input
              type="number"
              min={0}
              value={r.count}
              onChange={(e) => onUpdate(r._id, { count: Number(e.target.value) })}
              className="h-9 w-24 rounded-btn border border-line bg-bg px-3 text-right text-body-sm tabular-nums text-ink focus:border-primary focus:outline-none"
            />
            <button onClick={() => onRemove(r._id)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-btn text-ink-muted hover:bg-danger/10 hover:text-danger" aria-label="Remove row">
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        <Button variant="ghost" size="sm" leadingIcon={<Plus size={15} />} onClick={onAdd}>Add {title.slice(0, -1).toLowerCase()}</Button>
      </div>
    </Card>
  )
}
