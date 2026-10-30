import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, FileSpreadsheet, Upload } from 'lucide-react'
import { Modal } from '../../../../components/ui/Modal'
import { Button } from '../../../../components/ui/Button'
import { useToast } from '../../../../components/ui/Toast'
import { cn } from '../../../../lib/cn'
import { dialerApi, IMPORT_FIELDS, type ImportField, type ImportSummary } from '../../../../lib/dialerApi'
import { errMsg } from './ui'
import { ImportSummaryView } from './ImportSummaryView'

/**
 * Import my CRM export (CSV or Excel). The file is read here in the browser; the rows and
 * the column choices go to the server, which matches each lead (update or add) and returns
 * what changed. Column choices are remembered, and a change in the export's columns is
 * flagged before anything is loaded.
 */

const SYNONYMS: Record<ImportField, string[]> = {
  leadId: ['lead id', 'leadid', 'lead_id', 'id', 'record id', 'crm id', 'lead number'],
  company: ['company', 'company name', 'account', 'account name', 'organization', 'organisation', 'business name', 'business'],
  // A first-name column is the fallback: the server adds the last-name column to it.
  contactName: ['contact', 'contact name', 'full name', 'name', 'lead name', 'contact person', 'contact full name', 'primary contact', 'person name', 'first name', 'firstname', 'contact first name'],
  email: ['email', 'email address', 'e-mail', 'work email'],
  phone: ['phone', 'phone number', 'telephone', 'mobile', 'direct phone', 'work phone', 'contact number'],
  city: ['city', 'town'],
  state: ['state', 'state/province', 'province', 'state name'],
  status: ['lead status', 'status', 'disposition', 'stage', 'lead stage'],
  industry: ['industry', 'industry type', 'company industry', 'primary industry', 'vertical', 'sector', 'business type', 'category', 'sic description', 'naics description'],
  source: ['source', 'lead source'],
  leadDate: ['created', 'created date', 'created at', 'date created', 'created time', 'assigned date', 'date assigned'],
  lastActivity: ['last modified', 'modified', 'modified date', 'last activity', 'last activity date', 'updated', 'last updated', 'updated at', 'modified time', 'last touched'],
  website: ['website', 'web site', 'url', 'company website', 'domain', 'website url', 'web address', 'web', 'company url', 'company domain', 'homepage', 'webpage'],
  companySize: ['company size', 'size', 'employees', 'no. of employees', 'number of employees', 'employee count', 'headcount'],
  title: ['title', 'job title', 'contact title', 'designation', 'position'],
  assignedTo: ['assigned to', 'assignedto', 'lead owner', 'owner', 'assignee'],
}

function autoMap(headers: string[], saved: Record<string, string | null> | null): Record<ImportField, string | null> {
  const out = {} as Record<ImportField, string | null>
  // "First_Name", "First Name" and "first-name" are the same column.
  const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '')
  const low = headers.map(norm)
  for (const f of IMPORT_FIELDS) {
    const s = saved?.[f.key]
    if (s && headers.includes(s)) { out[f.key] = s; continue }
    // Synonyms in order of preference: "Full Name" wins over "First Name".
    const hit = SYNONYMS[f.key].map((syn) => low.indexOf(norm(syn))).find((i) => i >= 0)
    out[f.key] = hit != null ? headers[hit] : null
  }
  return out
}

type Cell = string | number | null
export async function readFile(file: File): Promise<{ headers: string[]; rows: Cell[][] }> {
  const name = file.name.toLowerCase()
  let table: Cell[][]
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const { readSheet } = await import('read-excel-file/browser')
    const data = await readSheet(file)
    table = data.map((r) => r.map((c) => (c == null ? null : c instanceof Date ? c.toISOString() : typeof c === 'number' ? c : String(c))))
  } else {
    const Papa = (await import('papaparse')).default
    const text = await file.text()
    const res = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' })
    table = res.data
  }
  // The header row is the first row with at least two filled cells.
  const hi = table.findIndex((r) => r.filter((c) => c != null && String(c).trim()).length >= 2)
  if (hi < 0) throw new Error('The file looks empty.')
  const headers = table[hi].map((h, i) => (h == null || String(h).trim() === '' ? `Column ${i + 1}` : String(h).trim()))
  const rows = table.slice(hi + 1).filter((r) => r.some((c) => c != null && String(c).trim() !== '')).map((r) => headers.map((_, i) => r[i] ?? null))
  return { headers, rows }
}

export function ImportModal({ saved, onClose, onImported, lists, needsCrm }: { saved: { headerSignature: string; mapping: Record<string, string | null> } | null; onClose: () => void; onImported: () => void; lists: string[]; needsCrm: number }) {
  const { addToast } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<{ name: string; headers: string[]; rows: Cell[][] } | null>(null)
  const [mapping, setMapping] = useState<Record<ImportField, string | null> | null>(null)
  const [reading, setReading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportSummary | null>(null)
  const [dragOver, setDragOver] = useState(false)
  // Which list this file is: the CRM export (SMB leads) or another list kept apart (Vendors...).
  const [list, setList] = useState('CRM')
  const [newList, setNewList] = useState('')
  const listName = list === '__new' ? newList.trim() : list

  async function pick(f: File | undefined) {
    if (!f) return
    if (f.size > 20 * 1024 * 1024) { addToast({ type: 'error', message: 'The file is over 20 MB.' }); return }
    setReading(true)
    try {
      const r = await readFile(f)
      setFile({ name: f.name, ...r })
      setMapping(autoMap(r.headers, saved?.mapping ?? null))
    } catch (e) {
      addToast({ type: 'error', message: errMsg(e, 'Could not read the file. Export it as CSV or Excel (.xlsx).') })
    } finally { setReading(false) }
  }

  const columnsChanged = !!(file && saved && saved.headerSignature !== file.headers.join('|'))
  const missing = mapping ? IMPORT_FIELDS.filter((f) => 'required' in f && f.required && !mapping[f.key]).map((f) => f.label) : []
  const noKey = mapping ? !mapping.leadId && !mapping.email && !mapping.phone : false
  const preview = useMemo(() => {
    if (!file || !mapping) return []
    return file.rows.slice(0, 4).map((r) => Object.fromEntries(IMPORT_FIELDS.map((f) => [f.key, mapping[f.key] ? r[file.headers.indexOf(mapping[f.key]!)] : null])))
  }, [file, mapping])

  async function run() {
    if (!file || !mapping) return
    setBusy(true)
    try {
      const r = await dialerApi.importLeads({ fileName: file.name, headers: file.headers, mapping, rows: file.rows, listName: listName || 'CRM' })
      setResult(r.import.summary)
      onImported()
    } catch (e) {
      addToast({ type: 'error', message: errMsg(e, 'Import failed') })
    } finally { setBusy(false) }
  }

  if (result) {
    return (
      <Modal open onClose={onClose} title="Import done" size="xl" footer={<Button onClick={onClose}>Back to dashboard</Button>}>
        {needsCrm > 0 && <p className="mb-3 rounded-btn border border-warning/40 bg-warning/5 px-3 py-2 text-body-sm text-ink">Reminder: <b>{needsCrm}</b> lead{needsCrm === 1 ? '' : 's'} still need{needsCrm === 1 ? 's' : ''} an Earthzone update (see Leads, "Needs Earthzone update").</p>}
        <ImportSummaryView s={result} />
      </Modal>
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Import my leads"
      size="xl"
      footer={file ? <><Button variant="secondary" onClick={() => { setFile(null); setMapping(null) }}>Choose another file</Button><Button disabled={busy || missing.length > 0 || noKey || (list === '__new' && !newList.trim())} onClick={run}>{busy ? 'Importing…' : `Import ${file.rows.length.toLocaleString()} rows`}</Button></> : undefined}
    >
      {!file ? (
        <div className="space-y-4">
          <ol className="list-decimal space-y-1 pl-5 text-body-md text-ink">
            <li>In the CRM, export <b>your own</b> leads (CSV or Excel).</li>
            <li>Drop the file here. Leads already on the dashboard are updated, new ones are added.</li>
            <li>Read the summary: new and changed leads, new industries, who moved forward.</li>
          </ol>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); pick(e.dataTransfer.files[0]) }}
            onClick={() => fileRef.current?.click()}
            className={cn('flex cursor-pointer flex-col items-center gap-2 rounded-card border-2 border-dashed px-6 py-12 text-center transition-colors', dragOver ? 'border-primary bg-primary/5' : 'border-line hover:border-primary/50')}
          >
            <FileSpreadsheet size={32} className="text-primary" />
            <p className="text-body-lg font-semibold text-ink">{reading ? 'Reading the file…' : 'Drop the export here or click to choose'}</p>
            <p className="text-body-sm text-ink-muted">CSV or Excel (.xlsx), up to 20 MB. The file is read on your computer; only the lead rows are sent.</p>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,text/csv" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} />
          </div>
          <p className="text-body-sm text-ink-muted">Snoozes, notes and history are kept by the dashboard and are never erased by an import. Numbers are as fresh as your last import, so import at the start of each shift.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-body-sm text-ink-muted"><Upload size={14} /><b className="text-ink">{file.name}</b> · {file.rows.length.toLocaleString()} rows · {file.headers.length} columns</div>
          <div className="flex flex-wrap items-center gap-2 rounded-btn border border-line bg-slate-50 px-3 py-2 text-body-sm">
            <span className="font-semibold text-ink">This file is</span>
            <select value={list} onChange={(e) => setList(e.target.value)} className="h-8 rounded-btn border border-line bg-card px-2 text-body-sm text-ink">
              <option value="CRM">My CRM export (SMB leads)</option>
              {lists.filter((x) => x !== 'CRM').map((x) => <option key={x} value={x}>{x}</option>)}
              <option value="__new">Another list (vendors…)</option>
            </select>
            {list === '__new' && <input value={newList} onChange={(e) => setNewList(e.target.value)} maxLength={40} placeholder="Name it, e.g. Vendors" className="h-8 w-44 rounded-btn border border-line bg-card px-2 text-body-sm text-ink" />}
            <span className="text-ink-muted">Lists are kept apart: importing one never hides leads from another.</span>
          </div>
          {needsCrm > 0 && <p className="text-body-sm text-warning">{needsCrm} lead{needsCrm === 1 ? '' : 's'} still need{needsCrm === 1 ? 's' : ''} an Earthzone update. Update Earthzone before exporting, so this import brings it back.</p>}
          {columnsChanged && (
            <div className="flex items-start gap-2 rounded-btn border border-warning/40 bg-warning/5 px-3 py-2 text-body-sm text-ink">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" />
              <span><b>The export's columns changed since your last import.</b> Check the choices below before importing, so no wrong data is loaded. Ask the CRM team to keep the export columns fixed.</span>
            </div>
          )}
          <div className="grid gap-x-4 gap-y-2.5 sm:grid-cols-2">
            {IMPORT_FIELDS.map((f) => (
              <label key={f.key} className="block">
                <span className="mb-0.5 flex items-center gap-1 text-body-sm font-semibold text-ink">{f.label}{'required' in f && f.required && <span className="text-danger">*</span>}</span>
                <select
                  value={mapping?.[f.key] ?? ''}
                  onChange={(e) => setMapping((m) => ({ ...(m as Record<ImportField, string | null>), [f.key]: e.target.value || null }))}
                  className={cn('h-9 w-full rounded-btn border bg-card px-2 text-body-sm text-ink focus:border-primary focus:outline-none', mapping?.[f.key] ? 'border-line' : 'border-dashed border-line text-ink-muted')}
                >
                  <option value="">Not in the file</option>
                  {file.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
                {'hint' in f && <span className="text-[11px] text-ink-muted">{f.hint}</span>}
              </label>
            ))}
          </div>
          {(missing.length > 0 || noKey) && (
            <p className="rounded-btn bg-danger/5 px-3 py-2 text-body-sm text-danger">
              {missing.length > 0 ? `Pick a column for: ${missing.join(', ')}. ` : ''}{noKey ? 'Pick the lead ID, email or phone column so leads are recognised between imports.' : ''}
            </p>
          )}
          <div className="overflow-x-auto rounded-btn border border-line">
            <table className="w-full text-left text-[12px]">
              <thead className="bg-slate-50 text-ink-muted"><tr>{IMPORT_FIELDS.filter((f) => mapping?.[f.key]).map((f) => <th key={f.key} className="whitespace-nowrap px-2 py-1.5">{f.label}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {preview.map((r, i) => <tr key={i}>{IMPORT_FIELDS.filter((f) => mapping?.[f.key]).map((f) => <td key={f.key} className="max-w-[160px] truncate whitespace-nowrap px-2 py-1.5 text-ink">{r[f.key] == null ? '' : String(r[f.key])}</td>)}</tr>)}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-ink-muted">First rows as they will be read. States are cleaned (CA and California are the same), blank statuses count as Unknown, extra spaces are removed. Notes columns are not read.</p>
        </div>
      )}
    </Modal>
  )
}
