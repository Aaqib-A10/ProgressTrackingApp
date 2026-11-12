import { useRef, useState } from 'react'
import { CheckCircle2, FileSpreadsheet } from 'lucide-react'
import { Modal } from '../../../../components/ui/Modal'
import { Button } from '../../../../components/ui/Button'
import { Toggle } from '../../../../components/ui/Toggle'
import { useToast } from '../../../../components/ui/Toast'
import { cn } from '../../../../lib/cn'
import { dialerApi, type EzRow, type EzSyncDone, type EzSyncPreview } from '../../../../lib/dialerApi'
import { readFile } from './ImportModal'
import { errMsg } from './ui'

/**
 * Earth Zone sync (ITAD update 12 Nov, section 1): a one-time fill from the agent's Earth Zone pull.
 *  1. Pick the file (CSV or Excel, read here in the browser); the columns are found by name and can be fixed.
 *  2. Preview: matched, not matched, unclear rows, what will be filled, the notes, who wrote them, and values
 *     that differ from what the lead has (kept unless "Replace different values" is on). Nothing is saved yet.
 *  3. Apply, then a short summary. Only the agent's own leads change; Metriq never writes to Earth Zone.
 */

type Key = keyof EzRow
const TARGETS: { k: Key; label: string; syn: string[]; match?: boolean }[] = [
  { k: 'ezId', label: 'Lead ID', syn: ['leadid', 'ezleadid', 'earthzoneleadid', 'id'], match: true },
  { k: 'firstName', label: 'First Name', syn: ['firstname'] },
  { k: 'lastName', label: 'Last Name', syn: ['lastname'], match: true },
  { k: 'company', label: 'Company Name', syn: ['companyname', 'company'], match: true },
  { k: 'phone', label: 'Primary Phone', syn: ['primaryphone', 'phone', 'phonenumber'], match: true },
  { k: 'altPhones', label: 'Alternative Numbers (Secondary)', syn: ['alternativenumberssecondary', 'alternativenumbers', 'alternativenumber', 'alternatenumbers', 'secondaryphone'] },
  { k: 'email', label: 'Primary Email', syn: ['primaryemail', 'email'], match: true },
  { k: 'email2', label: 'Secondary Email', syn: ['secondaryemail'] },
  { k: 'jobTitle', label: 'Job Title', syn: ['jobtitle', 'title'] },
  { k: 'hiddenDescription', label: 'Hidden Description', syn: ['hiddendescription'] },
  { k: 'notes', label: 'Logged Interaction Notes Timeline', syn: ['loggedinteractionnotestimeline', 'loggedinteractionnotes', 'interactionnotestimeline', 'notestimeline', 'notes'] },
]
const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '')
const FIELD_LABEL: Record<string, string> = { email2: 'Secondary Email', jobTitle: 'Job Title', description: 'Description' }
const BY_LABEL: Record<string, string> = { ezId: 'Lead ID', email: 'email', phone: 'phone', companyLastName: 'company + last name' }
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`

export function EzSyncModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { addToast } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<{ name: string; headers: string[]; rows: (string | number | null)[][] } | null>(null)
  const [map, setMap] = useState<Partial<Record<Key, string>>>({})
  const [preview, setPreview] = useState<EzSyncPreview | null>(null)
  const [done, setDone] = useState<EzSyncDone | null>(null)
  const [replace, setReplace] = useState(false)
  const [busy, setBusy] = useState(false)

  async function pick(f: File | undefined) {
    if (!f) return
    try {
      const r = await readFile(f)
      const low = r.headers.map(norm)
      const m: Partial<Record<Key, string>> = {}
      const used = new Set<number>()
      // Most specific names first (so "Secondary Email" never lands on Primary Email).
      for (const t of TARGETS) {
        for (const syn of t.syn) {
          const i = low.findIndex((h, j) => h === syn && !used.has(j))
          if (i >= 0) { m[t.k] = r.headers[i]; used.add(i); break }
        }
      }
      setFile({ name: f.name, ...r }); setMap(m); setPreview(null); setDone(null)
    } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not read the file.') }) }
  }

  const rows = (): EzRow[] => file!.rows.map((r) => Object.fromEntries(TARGETS.filter((t) => map[t.k]).map((t) => {
    const v = r[file!.headers.indexOf(map[t.k]!)]
    return [t.k, v == null ? null : String(v)]
  })) as EzRow)
  const canMatch = TARGETS.some((t) => t.match && t.k !== 'lastName' && map[t.k])

  async function check() {
    setBusy(true)
    try { setPreview(await dialerApi.ezSync({ rows: rows(), apply: false, fileName: file!.name }) as EzSyncPreview) } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not check the file') }) } finally { setBusy(false) }
  }
  async function apply() {
    setBusy(true)
    try {
      const r = await dialerApi.ezSync({ rows: rows(), apply: true, replace, fileName: file!.name }) as EzSyncDone
      setDone(r); onDone()
    } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not save') }) } finally { setBusy(false) }
  }

  const footer = done ? <Button onClick={onClose}>Close</Button>
    : preview ? <><Button variant="secondary" onClick={() => setPreview(null)}>Back</Button><Button disabled={busy || !preview.leadsToUpdate} onClick={apply}>{busy ? 'Saving…' : `Update ${plural(preview.leadsToUpdate, 'lead')}`}</Button></>
      : file ? <><Button variant="secondary" onClick={() => setFile(null)}>Choose another file</Button><Button disabled={busy || !canMatch} onClick={check}>{busy ? 'Checking…' : 'Preview'}</Button></> : undefined

  return (
    <Modal open onClose={onClose} title="Earth Zone sync" size="xl" footer={footer}>
      {done ? (
        <div className="space-y-3 text-body-md">
          <p className="flex items-center gap-2 font-semibold text-ink"><CheckCircle2 size={18} className="text-success" />Done. {plural(done.updated, 'lead')} updated.</p>
          <ul className="space-y-1 text-body-sm text-ink">
            {done.fields.altPhones > 0 && <li>{plural(done.fields.altPhones, 'alternative number')} added</li>}
            {done.fields.email2 > 0 && <li>{plural(done.fields.email2, 'secondary email')} filled</li>}
            {done.fields.jobTitle > 0 && <li>{plural(done.fields.jobTitle, 'job title')} filled</li>}
            {(done.fields.description > 0 || done.fields.links > 0) && <li>{plural(done.fields.description, 'description')}, {plural(done.fields.links, 'link')}</li>}
            <li>{plural(done.notesAdded, 'note')} added{done.notesAlreadyHere ? ` (${done.notesAlreadyHere.toLocaleString()} already here, left as they are)` : ''}</li>
            {done.contactsOffered > 0 && <li>{plural(done.contactsOffered, 'possible second contact')} found in the notes: open the lead to accept or ignore</li>}
            {(done.unmatchedCount > 0 || done.ambiguousCount > 0) && <li className="text-ink-muted">{plural(done.unmatchedCount, 'row')} not matched, {plural(done.ambiguousCount, 'unclear row')} left out</li>}
          </ul>
          <p className="text-body-sm text-ink-muted">Running the sync again adds nothing twice. Notes you edit or delete here stay that way.</p>
        </div>
      ) : !file ? (
        <div className="space-y-4 text-body-md">
          <ol className="list-decimal space-y-1 pl-5 text-ink">
            <li>Pull your leads from Earth Zone with the notes timeline (CSV or Excel).</li>
            <li>Upload it here and check the preview. Nothing is saved until you confirm.</li>
          </ol>
          <div onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]) }} className="flex cursor-pointer flex-col items-center gap-2 rounded-card border-2 border-dashed border-line px-6 py-10 text-center hover:border-primary/50">
            <FileSpreadsheet size={28} className="text-primary" />
            <p className="font-semibold text-ink">Drop the Earth Zone file here or click to choose</p>
            <p className="text-body-sm text-ink-muted">Fills alternative numbers, secondary email, job title, description and links, and the notes timeline. Nothing else on the lead changes.</p>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,text/csv" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} />
          </div>
          <p className="text-body-sm text-ink-muted">Only your own leads are updated. Metriq never writes to Earth Zone.</p>
        </div>
      ) : !preview ? (
        <div className="space-y-3 text-body-sm">
          <p className="text-ink"><b>{file.name}</b> · {plural(file.rows.length, 'row')}. Check which column is which:</p>
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
            {TARGETS.map((t) => (
              <label key={t.k} className="flex items-center gap-2">
                <span className={cn('w-40 shrink-0', t.match ? 'text-ink-muted' : 'font-semibold text-ink')}>{t.label}</span>
                <select value={map[t.k] ?? ''} onChange={(e) => setMap({ ...map, [t.k]: e.target.value || undefined })} className="h-8 min-w-0 flex-1 rounded-btn border border-line bg-card px-2 text-body-sm text-ink">
                  <option value="">Not in the file</option>
                  {file.headers.map((h) => <option key={h}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>
          {!canMatch && <p className="rounded-btn bg-danger/5 px-3 py-2 text-danger">Pick the Lead ID, Primary Email, Primary Phone or Company Name column, so each row can find its lead.</p>}
        </div>
      ) : (
        <PreviewView p={preview} replace={replace} setReplace={setReplace} />
      )}
    </Modal>
  )
}

function PreviewView({ p, replace, setReplace }: { p: EzSyncPreview; replace: boolean; setReplace: (v: boolean) => void }) {
  const fields: [string, number][] = [
    ['Alternative numbers', p.fields.altPhones], ['Secondary emails', p.fields.email2], ['Job titles', p.fields.jobTitle],
    ['Descriptions', p.fields.description], ['Links', p.fields.links], ['Notes', p.fields.notes], ['Lead IDs saved', p.fields.ezLeadId],
  ]
  return (
    <div className="space-y-4 text-body-sm">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {([['Matched', p.matched, ''], ['Leads to update', p.leadsToUpdate, ''], ['Not matched', p.unmatchedCount, p.unmatchedCount ? 'text-warning' : ''], ['Unclear', p.ambiguousCount, p.ambiguousCount ? 'text-warning' : '']] as const).map(([k, v, tone]) => (
          <div key={k} className="rounded-btn border border-line px-3 py-2"><p className="text-[11px] font-semibold uppercase text-ink-muted">{k}</p><p className={cn('text-headline-md tabular-nums text-ink', tone)}>{v.toLocaleString()}</p></div>
        ))}
      </div>
      <div className="rounded-btn border border-line p-3">
        <p className="mb-2 font-semibold text-ink">What will be filled</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
          {fields.map(([k, v]) => <p key={k} className="flex justify-between gap-2"><span className="text-ink-muted">{k}</span><b className="tabular-nums text-ink">{v.toLocaleString()}</b></p>)}
        </div>
        <p className="mt-2 text-ink-muted">Notes in the file: {p.notesInFile.toLocaleString()}, already here: {p.notesAlreadyHere.toLocaleString()}. Matched by {p.matchOrder.map((k) => BY_LABEL[k] ?? k).join(', then ')}.</p>
      </div>
      {p.authors.length > 0 && (
        <div className="rounded-btn border border-line p-3">
          <p className="mb-2 font-semibold text-ink">Who wrote the notes</p>
          <div className="flex flex-wrap gap-1.5">
            {p.authors.map((a) => (
              <span key={a.name} className={cn('rounded-full px-2.5 py-0.5', a.matched ? 'bg-primary/10 text-ink' : 'bg-slate-100 text-ink-muted')} title={a.matched ? 'Matched to a Metriq person' : 'No Metriq person with this name: the name is kept as written'}>
                {a.name}{a.isMe && <b className="ml-1 text-primary">(you)</b>} · {a.notes}
              </span>
            ))}
          </div>
          <p className="mt-2 text-ink-muted">Your own notes count as contacts on the lead (Last touched, follow-ups). Names not found in Metriq are kept as written.</p>
        </div>
      )}
      {p.conflictCount > 0 && (
        <div className="rounded-btn border border-line p-3">
          <p className="mb-2 font-semibold text-ink">Different from what the lead has · {p.conflictCount}</p>
          <div className="max-h-48 overflow-auto">
            <table className="w-full min-w-[480px] text-left"><thead className="text-[11px] uppercase text-ink-muted"><tr><th className="py-1">Lead</th><th>Field</th><th>Now</th><th>In the file</th></tr></thead>
              <tbody className="divide-y divide-line">{p.conflicts.map((c, i) => <tr key={i}><td className="py-1 text-ink">{c.company}</td><td className="text-ink-muted">{FIELD_LABEL[c.field] ?? c.field}</td><td className="max-w-[180px] truncate text-ink" title={c.current}>{c.current}</td><td className="max-w-[180px] truncate font-semibold text-ink" title={c.incoming}>{c.incoming}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="mt-2 flex items-center gap-2 text-ink"><Toggle checked={replace} onChange={setReplace} label="Replace different values" /><span>Replace different values</span></div>
          {!replace && <p className="mt-1 text-ink-muted">Off: the lead keeps what it has; only empty fields are filled.</p>}
        </div>
      )}
      {p.unmatchedCount > 0 && (
        <details className="rounded-btn border border-line p-3">
          <summary className="cursor-pointer font-semibold text-ink">{plural(p.unmatchedCount, 'row')} not matched</summary>
          <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto text-ink-muted">{p.unmatched.map((u) => <li key={u.row}>Row {u.row}{u.company ? ` · ${u.company}` : ''}: {u.reason}</li>)}</ul>
        </details>
      )}
      {p.ambiguousCount > 0 && (
        <details className="rounded-btn border border-line p-3">
          <summary className="cursor-pointer font-semibold text-ink">{plural(p.ambiguousCount, 'unclear row')} (match more than one lead, left out)</summary>
          <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto text-ink-muted">{p.ambiguous.map((a) => <li key={a.row}>Row {a.row}{a.company ? ` · ${a.company}` : ''}: same {BY_LABEL[a.by] ?? a.by} as {a.leads.join(', ')}</li>)}</ul>
        </details>
      )}
    </div>
  )
}
