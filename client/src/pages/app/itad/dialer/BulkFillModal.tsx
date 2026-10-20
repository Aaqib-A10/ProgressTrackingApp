import { useRef, useState } from 'react'
import { Download, FileSpreadsheet } from 'lucide-react'
import { Modal } from '../../../../components/ui/Modal'
import { Button } from '../../../../components/ui/Button'
import { useToast } from '../../../../components/ui/Toast'
import { cn } from '../../../../lib/cn'
import { dialerApi, type DialerLead, type FillPreview, type FillRow } from '../../../../lib/dialerApi'
import { readFile } from './ImportModal'
import { downloadCsv } from './exports'
import { errMsg } from './ui'

/**
 * Bulk fill: for reps who keep extra numbers or emails in their own sheets.
 *  1. Download a template already filled with their leads (the columns used to recognise a lead).
 *  2. Fill in second phone, second email, LinkedIn, decision maker, best time or a note.
 *  3. Upload and see a preview: how many matched, which did not, and any clash with a value
 *     already saved. 4. Nothing is saved until they confirm, and nothing already there is
 *     replaced unless they say so. Matching uses the same key as the main import, and only
 *     against the rep's own leads.
 */

type Target = keyof FillRow
const TARGETS: { k: Target; label: string; syn: string[]; key?: boolean }[] = [
  { k: 'crmId', label: 'CRM lead ID', syn: ['crm lead id', 'lead id', 'leadid', 'id', 'crm id', 'record id'], key: true },
  { k: 'company', label: 'Company', syn: ['company', 'company name', 'account', 'business'], key: true },
  { k: 'contactName', label: 'Contact', syn: ['contact', 'contact name', 'name', 'full name'], key: true },
  { k: 'phone', label: 'Phone (main)', syn: ['phone', 'phone number', 'main phone', 'primary phone'], key: true },
  { k: 'email', label: 'Email (main)', syn: ['email', 'email address', 'main email', 'primary email'], key: true },
  { k: 'phone2', label: 'Second phone', syn: ['second phone', 'phone 2', 'phone2', 'alt phone', 'other phone', 'mobile', 'cell', 'direct line'] },
  { k: 'email2', label: 'Second email', syn: ['second email', 'email 2', 'email2', 'alt email', 'other email'] },
  { k: 'linkedin', label: 'LinkedIn', syn: ['linkedin', 'linkedin url', 'linked in'] },
  { k: 'decisionMaker', label: 'Decision maker', syn: ['decision maker', 'decision-maker', 'dm', 'owner name'] },
  { k: 'bestTime', label: 'Best time to call', syn: ['best time', 'best time to call', 'call time'] },
  { k: 'note', label: 'Note', syn: ['note', 'notes', 'comment', 'comments'] },
]

export function BulkFillModal({ leads, onClose, onDone }: { leads: DialerLead[]; onClose: () => void; onDone: () => void }) {
  const { addToast } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<{ name: string; headers: string[]; rows: (string | number | null)[][] } | null>(null)
  const [map, setMap] = useState<Partial<Record<Target, string>>>({})
  const [preview, setPreview] = useState<FillPreview | null>(null)
  const [overwrite, setOverwrite] = useState(false)
  const [needsCrm, setNeedsCrm] = useState(true)
  const [busy, setBusy] = useState(false)

  function template() {
    downloadCsv('bulk-fill-template.csv', ['CRM lead ID', 'Company', 'Contact', 'Phone', 'Email', 'List', 'Second phone', 'Second email', 'LinkedIn', 'Decision maker', 'Best time to call', 'Note'],
      leads.map((l) => [l.externalId, l.company, l.contactName, l.phone, l.email, l.listName, l.phone2, l.email2, l.linkedin, l.decisionMaker, l.bestTime, '']))
  }

  async function pick(f: File | undefined) {
    if (!f) return
    try {
      const r = await readFile(f)
      const low = r.headers.map((h) => h.trim().toLowerCase())
      const m: Partial<Record<Target, string>> = {}
      for (const t of TARGETS) { const i = low.findIndex((h) => t.syn.includes(h)); if (i >= 0) m[t.k] = r.headers[i] }
      setFile({ name: f.name, ...r }); setMap(m); setPreview(null)
    } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not read the file.') }) }
  }

  const rows = (): FillRow[] => file!.rows.map((r) => Object.fromEntries(TARGETS.filter((t) => map[t.k]).map((t) => { const v = r[file!.headers.indexOf(map[t.k]!)]; return [t.k, v == null ? null : String(v)] })) as FillRow)
  const hasKey = TARGETS.some((t) => t.key && map[t.k])
  const hasData = TARGETS.some((t) => !t.key && map[t.k])

  async function check() {
    setBusy(true)
    try { setPreview(await dialerApi.bulkFill({ rows: rows(), apply: false })) } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not check the file') }) } finally { setBusy(false) }
  }
  async function apply() {
    setBusy(true)
    try {
      const r = await dialerApi.bulkFill({ rows: rows(), apply: true, overwrite, needsCrm })
      addToast({ type: 'success', message: `${r.updated} lead${r.updated === 1 ? '' : 's'} updated.${!overwrite && preview?.conflictCount ? ` ${preview.conflictCount} existing value${preview.conflictCount === 1 ? '' : 's'} kept.` : ''}` })
      onDone(); onClose()
    } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not save') }) } finally { setBusy(false) }
  }

  const FIELD_LABEL: Record<string, string> = { phone2: 'Second phone', email2: 'Second email', linkedin: 'LinkedIn', decisionMaker: 'Decision maker', bestTime: 'Best time' }
  return (
    <Modal open onClose={onClose} title="Bulk fill extra contacts" size="xl"
      footer={preview ? <><Button variant="secondary" onClick={() => setPreview(null)}>Back</Button><Button disabled={busy || !preview.willUpdate} onClick={apply}>{busy ? 'Saving…' : `Save ${preview.willUpdate} lead${preview.willUpdate === 1 ? '' : 's'}`}</Button></>
        : file ? <><Button variant="secondary" onClick={() => setFile(null)}>Choose another file</Button><Button disabled={busy || !hasKey || !hasData} onClick={check}>{busy ? 'Checking…' : 'Check the file'}</Button></> : undefined}>
      {!file ? (
        <div className="space-y-4 text-body-md">
          <ol className="list-decimal space-y-1 pl-5 text-ink">
            <li>Download the template. It already lists your {leads.length.toLocaleString()} leads with the columns used to recognise them.</li>
            <li>Fill in second phone, second email, LinkedIn, decision maker, best time or a note. Delete rows you have nothing for.</li>
            <li>Upload it here. You see a preview first; nothing is saved until you confirm.</li>
          </ol>
          <Button variant="secondary" leadingIcon={<Download size={15} />} onClick={template}>Download template</Button>
          <div onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]) }} className="flex cursor-pointer flex-col items-center gap-2 rounded-card border-2 border-dashed border-line px-6 py-10 text-center hover:border-primary/50">
            <FileSpreadsheet size={28} className="text-primary" />
            <p className="font-semibold text-ink">Drop your filled sheet here or click to choose</p>
            <p className="text-body-sm text-ink-muted">CSV or Excel. Your own sheet works too if it has a CRM lead ID, email, or company and phone column.</p>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,text/csv" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} />
          </div>
          <p className="text-body-sm text-ink-muted">Rows that are not your CRM leads (a vendor list, or another rep's lead) are reported as not matched and nothing is attached to them.</p>
        </div>
      ) : !preview ? (
        <div className="space-y-3 text-body-sm">
          <p className="text-ink"><b>{file.name}</b> · {file.rows.length.toLocaleString()} rows. Check which column is which:</p>
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
            {TARGETS.map((t) => (
              <label key={t.k} className="flex items-center gap-2">
                <span className={cn('w-36 shrink-0', t.key ? 'text-ink-muted' : 'font-semibold text-ink')}>{t.label}</span>
                <select value={map[t.k] ?? ''} onChange={(e) => setMap({ ...map, [t.k]: e.target.value || undefined })} className="h-8 min-w-0 flex-1 rounded-btn border border-line bg-card px-2 text-body-sm text-ink">
                  <option value="">Not in the file</option>
                  {file.headers.map((h) => <option key={h}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>
          {!hasKey && <p className="rounded-btn bg-danger/5 px-3 py-2 text-danger">Pick the CRM lead ID, email, or company and phone column, so each row can be matched to a lead.</p>}
          {hasKey && !hasData && <p className="rounded-btn bg-warning/5 px-3 py-2 text-ink">Pick at least one column to fill (second phone, second email, LinkedIn…).</p>}
        </div>
      ) : (
        <div className="space-y-4 text-body-sm">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {([['Matched', preview.matched, ''], ['Will be updated', preview.willUpdate, ''], ['Not matched', preview.unmatchedCount, preview.unmatchedCount ? 'text-warning' : ''], ['Clash with a saved value', preview.conflictCount, preview.conflictCount ? 'text-danger' : '']] as const).map(([k, v, tone]) => (
              <div key={k} className="rounded-btn border border-line px-3 py-2"><p className="text-[11px] font-semibold uppercase text-ink-muted">{k}</p><p className={cn('text-headline-md tabular-nums text-ink', tone)}>{v.toLocaleString()}</p></div>
            ))}
          </div>
          {preview.notes > 0 && <p className="text-ink">{preview.notes} note{preview.notes === 1 ? '' : 's'} will be added (with you as the author).</p>}
          {preview.conflictCount > 0 && (
            <div className="rounded-btn border border-line p-3">
              <p className="mb-2 font-semibold text-ink">Already saved, and different in your sheet</p>
              <div className="max-h-48 overflow-y-auto">
                <table className="w-full text-left"><thead className="text-[11px] uppercase text-ink-muted"><tr><th className="py-1">Lead</th><th>Field</th><th>Saved now</th><th>In your sheet</th></tr></thead>
                  <tbody className="divide-y divide-line">{preview.conflicts.map((c, i) => <tr key={i}><td className="py-1 text-ink">{c.company}</td><td className="text-ink-muted">{FIELD_LABEL[c.field] ?? c.field}</td><td className="text-ink">{c.current}</td><td className="font-semibold text-ink">{c.incoming}</td></tr>)}</tbody>
                </table>
              </div>
              <label className="mt-2 flex items-center gap-2 text-ink"><input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} className="h-4 w-4 accent-primary" /> Replace the saved values with the ones in my sheet</label>
              {!overwrite && <p className="mt-1 text-ink-muted">Left unticked, the saved values stay and only empty fields are filled.</p>}
            </div>
          )}
          {preview.unmatchedCount > 0 && (
            <details className="rounded-btn border border-line p-3">
              <summary className="cursor-pointer font-semibold text-ink">{preview.unmatchedCount} row{preview.unmatchedCount === 1 ? '' : 's'} not matched</summary>
              <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto text-ink-muted">{preview.unmatched.map((u) => <li key={u.row}>Row {u.row}{u.company ? ` · ${u.company}` : ''}: {u.reason}</li>)}</ul>
            </details>
          )}
          <label className="flex items-center gap-2 text-ink"><input type="checkbox" checked={needsCrm} onChange={(e) => setNeedsCrm(e.target.checked)} className="h-4 w-4 accent-primary" /> Mark these leads "needs Earthzone update"</label>
        </div>
      )}
    </Modal>
  )
}
