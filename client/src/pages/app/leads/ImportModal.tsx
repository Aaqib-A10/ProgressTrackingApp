import { useEffect, useMemo, useState } from 'react'
import { FileSpreadsheet, Upload } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { useToast } from '../../../components/ui/Toast'
import { apiErrorText } from '../../../lib/api'
import { cn } from '../../../lib/cn'
import { LEAD_IMPORT_FIELDS, leadsApi, type MetaBusiness } from '../../../lib/leadsApi'
import { readFile } from '../itad/dialer/ImportModal'
import { Label, Select } from './shared'

type Cell = string | number | null

/**
 * Import a spreadsheet. A CMR business takes the CMR_Lead_Tracker sheet (one lead per company,
 * each row a call under it, the Lists tab's words); other businesses take a plain sheet of leads.
 * The browser reads the file and shows a preview; the columns come mapped by name.
 */
export function ImportModal({ business, onClose, onDone }: { business: MetaBusiness; onClose: () => void; onDone: () => void }) {
  const { addToast } = useToast()
  const cmr = business.kind === 'CMR'
  const [file, setFile] = useState<{ name: string; headers: string[]; rows: Cell[][] } | null>(null)
  const [mode, setMode] = useState<'sheet' | 'plain'>(cmr ? 'sheet' : 'plain')
  const [columns, setColumns] = useState<{ field: string; label: string }[]>([])
  const [mapping, setMapping] = useState<Record<string, string | null>>({})
  const [assignee, setAssignee] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ text: string; problems: string[] } | null>(null)

  useEffect(() => { if (mode === 'sheet') leadsApi.sheetColumns().then((r) => setColumns(r.columns)).catch(() => setColumns([])) }, [mode])
  const fields = mode === 'sheet' ? columns : LEAD_IMPORT_FIELDS.map((f) => ({ field: f.key, label: f.label }))

  useEffect(() => {
    if (!file) return
    const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '')
    const low = file.headers.map(norm)
    const out: Record<string, string | null> = {}
    if (mode === 'plain') {
      for (const f of LEAD_IMPORT_FIELDS) { const hit = f.synonyms.map((s) => low.indexOf(norm(s))).find((i) => i >= 0); out[f.key] = hit != null ? file.headers[hit] : null }
    } else {
      const guess: Record<string, string[]> = { date: ['date'], sdr: ['sdr', 'assignedto', 'agent'], organization: ['company', 'companyname'], industry: ['segment', 'industry'], state: ['state'], name: ['contact', 'contactname', 'name'], contactRole: ['role', 'title'], decisionMaker: ['decisionmaker'], phone: ['phone', 'phonenumber'], email: ['email'], website: ['website', 'url'], handlesAlkaline: ['handlesalkaline', 'alkaline'], lbsPerMonth: ['estvolumelbsmonth', 'volume', 'estvolume'], currentVendor: ['currentvendor', 'vendor'], paysToday: ['paystoday', 'pays'], status: ['status'], summary: ['callsummary', 'summary', 'notes'], nextStep: ['nextstep'], nextStepDate: ['nextstepdate'], owner: ['owner'], jesseInputNeeded: ['jesseinputneeded'], jesseComment: ['jessecomment'], city: ['city'], tags: ['tags', 'tag'] }
      for (const c of columns) { const hit = (guess[c.field] ?? [norm(c.label)]).map((s) => low.indexOf(s)).find((i) => i >= 0); out[c.field] = hit != null ? file.headers[hit] : null }
    }
    setMapping(out)
  }, [file, mode, columns])

  const pick = async (f: File) => {
    try { const r = await readFile(f); setFile({ name: f.name, headers: r.headers, rows: r.rows }); setResult(null) } catch (e) { addToast({ type: 'error', message: apiErrorText(e, 'Could not read the file') }) }
  }
  const go = async () => {
    if (!file) return
    setBusy(true)
    try {
      if (mode === 'sheet') {
        const r = await leadsApi.importSheet({ businessId: business.id, fileName: file.name, headers: file.headers, mapping, rows: file.rows, source: 'SHEET' })
        setResult({ text: `${r.companies} new compan${r.companies === 1 ? 'y' : 'ies'}, ${r.calls} call${r.calls === 1 ? '' : 's'} added under them${r.alreadyThere ? `, ${r.alreadyThere} row${r.alreadyThere === 1 ? '' : 's'} already here (nothing added, the SDR filled in where it was missing)` : ''}, ${r.skipped} empty row${r.skipped === 1 ? '' : 's'} skipped. ${business.name} now has ${r.totalCompanies} companies.`, problems: r.problems })
      } else {
        const r = await leadsApi.import({ businessId: business.id, fileName: file.name, headers: file.headers, mapping, rows: file.rows, assigneeId: assignee || null })
        setResult({ text: `${r.added} added, ${r.already} already here (skipped), ${r.skipped} empty rows skipped.`, problems: [] })
      }
      onDone()
    } catch (e) { addToast({ type: 'error', message: apiErrorText(e, 'Import failed') }) } finally { setBusy(false) }
  }
  const preview = useMemo(() => file?.rows.slice(0, 5) ?? [], [file])

  return (
    <Modal open onClose={onClose} title={cmr ? 'Import the CMR Lead Tracker sheet' : 'Import leads from a sheet'} size="lg" footer={<><Button variant="ghost" onClick={onClose}>{result ? 'Close' : 'Cancel'}</Button>{!result && <Button disabled={!file || busy} onClick={go}>{busy ? 'Importing…' : `Import ${file?.rows.length ?? 0} rows`}</Button>}</>}>
      {result ? (
        <div className="space-y-3">
          <p className="rounded-btn bg-success/10 px-3 py-2 text-body-md text-success">{result.text}</p>
          {result.problems.length > 0 && <div><p className="mb-1 text-body-sm font-semibold text-ink">Checked by hand, not guessed:</p><ul className="max-h-60 list-disc space-y-0.5 overflow-auto pl-5 text-body-sm text-ink-muted">{result.problems.map((p, i) => <li key={i}>{p}</li>)}</ul></div>}
          {cmr && <p className="text-body-sm text-ink-muted">Compare the Jesse Summary page with the sheet's Jesse Summary tab before switching the sheet off.</p>}
        </div>
      ) : (
        <div className="space-y-4">
          {cmr && (
            <div className="inline-flex rounded-btn border border-line bg-card p-0.5">
              {([['sheet', 'CMR tracker sheet (one row per call)'], ['plain', 'Plain list of companies']] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setMode(k)} className={cn('h-8 rounded-md px-3 text-body-sm font-semibold', mode === k ? 'bg-ink text-card' : 'text-ink-muted')}>{l}</button>)}
            </div>
          )}
          <label className={cn('flex cursor-pointer flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed px-4 py-8 text-center', file ? 'border-success/50 bg-success/5' : 'border-line hover:border-primary/50')} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void pick(f) }}>
            <input type="file" accept=".csv,.xlsx,.xls,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f) }} />
            {file ? <FileSpreadsheet className="text-success" /> : <Upload className="text-ink-faint" />}
            <span className="text-body-md font-medium text-ink">{file ? `${file.name} · ${file.rows.length} rows` : 'Drop a CSV or Excel file here, or click to choose'}</span>
            <span className="text-body-sm text-ink-muted">{cmr ? 'Google Sheets: File → Download → CSV (the Leads tab).' : 'The first row must be the column names.'}</span>
          </label>
          {file && (
            <>
              <div>
                <Label hint="matched by name; change any">Columns</Label>
                <div className="grid max-h-56 gap-2 overflow-auto sm:grid-cols-2">
                  {fields.map((f) => (
                    <label key={f.field} className="flex items-center justify-between gap-2 text-body-sm"><span className="text-ink">{f.label}</span>
                      <Select value={mapping[f.field] ?? ''} onChange={(e) => setMapping({ ...mapping, [f.field]: e.target.value || null })} className="h-8 w-44 text-body-sm"><option value="">— skip —</option>{file.headers.map((h) => <option key={h} value={h}>{h}</option>)}</Select>
                    </label>
                  ))}
                </div>
              </div>
              {mode === 'plain' && business.myRole === 'MANAGER' && (
                <label><Label>Give every lead to</Label><Select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="w-full"><option value="">Nobody yet (managers assign)</option>{business.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></label>
              )}
              {business.myRole !== 'MANAGER' && <p className="rounded-btn bg-primary/[0.06] px-3 py-2 text-body-sm text-ink">Every lead in this file becomes <b>yours</b>; your team lead sees them too. A company that already belongs to someone else is left as it is.</p>}
              <div className="overflow-x-auto rounded-card border border-line">
                <table className="w-full text-left text-[11.5px]"><thead className="bg-slate-50 dark:bg-white/[0.03]"><tr>{file.headers.map((h) => <th key={h} className="whitespace-nowrap px-2 py-1.5 font-semibold text-ink-muted">{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-line">{preview.map((r, i) => <tr key={i}>{file.headers.map((_, j) => <td key={j} className="max-w-[180px] truncate px-2 py-1 text-ink">{String(r[j] ?? '')}</td>)}</tr>)}</tbody></table>
              </div>
              {mode === 'sheet' && <p className="text-body-sm text-ink-muted">Rows with the same company become one lead with each row as a call under it. Phones become 000-000-0000, "Pays Today" $/lb, SDR names are matched to people of this business; anything that does not match is listed afterwards, never guessed.</p>}
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
