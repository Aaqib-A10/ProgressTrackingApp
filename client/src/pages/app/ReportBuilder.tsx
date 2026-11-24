import { useCallback, useEffect, useState } from 'react'
import { BarChart3, Download, Save, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { PillFilter } from '../../components/ui/PillFilter'
import { useToast } from '../../components/ui/Toast'
import { StackedBarChart } from '../../components/charts/StackedBarChart'
import { TrendLineChart } from '../../components/charts/TrendLineChart'
import { DonutChart } from '../../components/charts/DonutChart'
import { dayLabel, downloadText, errMsg, inputCls, labelCls } from '../../lib/biz'

/**
 * The report builder: pick what the report is about, what to count, how to split it and the dates. The answer is a
 * chart and a table that can be saved as a CSV file. A report worth keeping is saved, for yourself or for everyone.
 * Team leads get their own team's numbers; admins get the company's.
 */

interface Source { key: string; label: string; measures: { key: string; label: string; money?: boolean }[]; groups: { key: string; label: string }[] }
interface Spec { source: string; measure: string; groupBy: string; range: string; chart?: Chart }
interface Result { rows: { label: string; value: number }[]; total: number; money: boolean; from: string; to: string; capped: boolean }
interface Saved { id: string; name: string; shared: boolean; mine: boolean; owner: string; spec: Spec }
type Chart = 'bar' | 'line' | 'pie' | 'table'

const RANGE_LABEL: Record<string, string> = { '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', month: 'This month', year: 'This year' }
const num = (n: number, money: boolean) => n.toLocaleString('en-US', money ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 2 })

export default function ReportBuilder() {
  const { addToast } = useToast()
  const [sources, setSources] = useState<Source[] | null>(null)
  const [denied, setDenied] = useState(false)
  const [spec, setSpec] = useState<Spec>({ source: 'tasks', measure: 'count', groupBy: 'person', range: '30d' })
  const [chart, setChart] = useState<Chart>('bar')
  const [result, setResult] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<Saved[]>([])
  const [name, setName] = useState('')
  const [shared, setShared] = useState(false)

  const loadSaved = useCallback(() => { api.get<{ reports: Saved[] }>('/report-builder/saved').then((r) => setSaved(r.reports)).catch(() => undefined) }, [])
  useEffect(() => {
    api.get<{ sources: Source[] }>('/report-builder/sources').then((r) => setSources(r.sources)).catch(() => setDenied(true))
    loadSaved()
  }, [loadSaved])

  const src = sources?.find((s) => s.key === spec.source)
  const run = useCallback((s: Spec) => {
    setBusy(true)
    api.post<{ result: Result }>('/report-builder/run', s).then((r) => setResult(r.result)).catch((e) => { setResult(null); addToast({ type: 'error', message: errMsg(e, 'Could not run the report.') }) }).finally(() => setBusy(false))
  }, [addToast])
  // Run whenever a choice changes: there is no "Run" button to forget.
  useEffect(() => { if (sources) run(spec) }, [sources, spec, run])

  function pickSource(key: string) {
    const s = sources!.find((x) => x.key === key)!
    setSpec((p) => ({ ...p, source: key, measure: s.measures[0].key, groupBy: s.groups[0].key }))
  }
  function pickGroup(key: string) {
    setSpec((p) => ({ ...p, groupBy: key }))
    if (['day', 'week', 'month'].includes(key)) setChart('line')
    else if (chart === 'line') setChart('bar')
  }
  async function save() {
    if (!name.trim()) { addToast({ type: 'error', message: 'Give the report a name.' }); return }
    try { await api.post('/report-builder/saved', { name: name.trim(), shared, spec: { ...spec, chart } }); setName(''); loadSaved(); addToast({ type: 'success', message: 'Report saved.' }) } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not save the report.') }) }
  }
  function exportCsv() {
    if (!result || !src) return
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`
    const head = [src.groups.find((g) => g.key === spec.groupBy)?.label ?? 'Group', src.measures.find((m) => m.key === spec.measure)?.label ?? 'Value']
    downloadText(`metriq-report-${spec.source}-${result.to}.csv`, [head.map(q).join(','), ...result.rows.map((r) => `${q(r.label)},${r.value}`), `${q('Total')},${result.total}`].join('\n'))
  }

  if (denied) return <div className="mx-auto max-w-xl pt-10"><EmptyState icon={<BarChart3 size={22} />} title="Reports are built by team leads and admins" hint="Ask your team lead for the report you need." /></div>
  const measure = src?.measures.find((m) => m.key === spec.measure)

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-5">
      <div>
        <h1 className="text-headline-lg text-ink">Report builder</h1>
        <p className="mt-0.5 text-body-md text-ink-muted">Pick what to count and how to split it. The report runs as you choose.</p>
      </div>

      {saved.length > 0 && (
        <Card title="Saved reports">
          <div className="flex flex-wrap gap-2">
            {saved.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1 rounded-btn border border-line bg-card pl-3 pr-1 text-body-sm">
                <button type="button" className="py-1.5 font-medium text-ink hover:text-primary-ink" onClick={() => { setSpec({ source: s.spec.source, measure: s.spec.measure, groupBy: s.spec.groupBy, range: s.spec.range }); if (s.spec.chart) setChart(s.spec.chart) }}>{s.name}</button>
                {!s.mine && <span className="text-ink-faint">by {s.owner}</span>}
                {s.mine && <button type="button" aria-label={`Delete the saved report ${s.name}`} className="rounded p-1 text-ink-faint hover:text-danger-ink" onClick={() => { if (window.confirm(`Delete the saved report "${s.name}"?`)) api.del(`/report-builder/saved/${s.id}`).then(loadSaved).catch(() => addToast({ type: 'error', message: 'Could not delete it.' })) }}><Trash2 size={13} /></button>}
              </span>
            ))}
          </div>
        </Card>
      )}

      <Card>
        {!sources || !src ? <p className="text-body-md text-ink-muted">Loading...</p> : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div><label className={labelCls} htmlFor="rb-source">About</label><select id="rb-source" value={spec.source} onChange={(e) => pickSource(e.target.value)} className={inputCls}>{sources.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></div>
            <div><label className={labelCls} htmlFor="rb-measure">Count</label><select id="rb-measure" value={spec.measure} onChange={(e) => setSpec((p) => ({ ...p, measure: e.target.value }))} className={inputCls}>{src.measures.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select></div>
            <div><label className={labelCls} htmlFor="rb-group">Split by</label><select id="rb-group" value={spec.groupBy} onChange={(e) => pickGroup(e.target.value)} className={inputCls}>{src.groups.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}</select></div>
            <div><label className={labelCls} htmlFor="rb-range">Dates</label><select id="rb-range" value={spec.range} onChange={(e) => setSpec((p) => ({ ...p, range: e.target.value }))} className={inputCls}>{Object.entries(RANGE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          </div>
        )}
      </Card>

      <Card
        title={measure ? `${measure.label} by ${src?.groups.find((g) => g.key === spec.groupBy)?.label.toLowerCase()}` : 'Report'}
        subtitle={result ? `${dayLabel(result.from)} to ${dayLabel(result.to)}. Total: ${num(result.total, result.money)}${result.capped ? '. Very large: only the first 20,000 records were read.' : ''}` : undefined}
        action={<div className="flex flex-wrap items-center gap-2"><PillFilter<Chart> size="sm" value={chart} onChange={setChart} options={[{ value: 'bar', label: 'Bars' }, { value: 'line', label: 'Line' }, { value: 'pie', label: 'Pie' }, { value: 'table', label: 'Table' }]} /><Button size="sm" variant="secondary" leadingIcon={<Download size={14} />} disabled={!result?.rows.length} onClick={exportCsv}>CSV</Button></div>}
      >
        {busy && !result ? <p className="text-body-md text-ink-muted">Working it out...</p> : !result?.rows.length ? <EmptyState compact icon={<BarChart3 size={20} />} title="Nothing to show for these choices" hint="Try a longer stretch of dates." /> : (
          <div className="space-y-4">
            {chart === 'bar' && <StackedBarChart data={result.rows.slice(0, 30).map((r) => ({ label: r.label, value: r.value }))} xKey="label" series={[{ key: 'value', label: measure?.label ?? 'Value' }]} height={300} />}
            {chart === 'line' && <TrendLineChart data={result.rows.map((r) => ({ label: r.label, value: r.value }))} height={300} />}
            {chart === 'pie' && <DonutChart data={result.rows.slice(0, 12).map((r) => ({ name: r.label, value: r.value }))} height={280} centerValue={num(result.total, result.money)} centerLabel="Total" />}
            <div className="max-h-[420px] overflow-auto rounded-btn border border-line">
              <table className="w-full text-left text-body-md">
                <thead className="sticky top-0 border-b border-line bg-card text-body-sm text-ink-muted"><tr><th className="px-3 py-2 font-medium">{src?.groups.find((g) => g.key === spec.groupBy)?.label}</th><th className="px-3 py-2 text-right font-medium">{measure?.label}</th><th className="px-3 py-2 text-right font-medium">Share</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {result.rows.map((r) => (<tr key={r.label}><td className="px-3 py-1.5 text-ink">{r.label}</td><td className="px-3 py-1.5 text-right tabular-nums text-ink">{num(r.value, result.money)}</td><td className="px-3 py-1.5 text-right tabular-nums text-ink-muted">{result.total ? `${Math.round((r.value / result.total) * 100)}%` : ''}</td></tr>))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>

      <Card title="Keep this report">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1 sm:max-w-sm"><label className={labelCls} htmlFor="rb-name">Name</label><input id="rb-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Tasks finished by person, last 30 days" className={inputCls} /></div>
          <label className="flex h-10 items-center gap-2 text-body-md text-ink"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} className="h-4 w-4 rounded border-line" />Show it to other leads and admins</label>
          <Button leadingIcon={<Save size={15} />} onClick={() => void save()}>Save</Button>
        </div>
      </Card>
    </div>
  )
}
