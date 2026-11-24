import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Download, FileUp, XCircle } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { PillFilter } from '../../components/ui/PillFilter'
import { useToast } from '../../components/ui/Toast'
import { downloadText, errMsg, inputCls, labelCls } from '../../lib/biz'

/**
 * Import: bring people and tasks in from a spreadsheet saved as CSV. The file is checked first and every row says
 * what will happen or what is wrong; nothing is saved until "Import" is pressed. Contacts come in through Lead
 * Management's own import.
 */

type What = 'people' | 'tasks'
interface RowResult { line: number; ok: boolean; text: string }
interface Outcome { dryRun: boolean; made: number; willMake: number; rows: RowResult[] }

const COLUMNS: Record<What, { name: string; note: string }[]> = {
  people: [{ name: 'name', note: 'needed' }, { name: 'email', note: 'needed' }, { name: 'role', note: 'member, team lead or admin (empty: member)' }, { name: 'team', note: 'the name of a team you already made' }, { name: 'job title', note: 'optional' }],
  tasks: [{ name: 'title', note: 'needed' }, { name: 'description', note: 'optional' }, { name: 'assignee', note: 'the email of someone in the project' }, { name: 'due', note: 'like 2026-12-31' }, { name: 'priority', note: 'low, medium, high or urgent' }],
}
const TEMPLATE: Record<What, string> = {
  people: 'name,email,role,team,job title\nSara Khan,sara@example.com,member,,Sales executive\nOmar Ali,omar@example.com,team lead,,Sales manager\n',
  tasks: 'title,description,assignee,due,priority\nCall the supplier,Ask for the new price list,sara@example.com,2026-12-15,high\nUpdate the price sheet,,,,medium\n',
}

export default function ImportData() {
  const { user } = useAuth()
  const { addToast } = useToast()
  const admin = user?.role === 'SUPER_ADMIN'
  const [what, setWhat] = useState<What>(admin ? 'people' : 'tasks')
  const [csv, setCsv] = useState('')
  const [fileName, setFileName] = useState('')
  const [projects, setProjects] = useState<{ key: string; name: string }[]>([])
  const [projectKey, setProjectKey] = useState('')
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { api.get<{ projects: { key: string; name: string; status?: string }[] }>('/projects').then((r) => { const open = r.projects.filter((p) => !p.status || p.status === 'ACTIVE'); setProjects(open); setProjectKey((k) => k || open[0]?.key || '') }).catch(() => undefined) }, [])
  useEffect(() => { setOutcome(null) }, [what, csv, projectKey])

  async function pick(file: File | undefined) {
    if (!file) return
    if (file.size > 2_000_000) { addToast({ type: 'error', message: 'The file is too big (2 MB at most).' }); return }
    setCsv(await file.text())
    setFileName(file.name)
  }
  async function send(dryRun: boolean) {
    if (!csv.trim()) { addToast({ type: 'error', message: 'Choose a file first.' }); return }
    setBusy(true)
    try {
      const r = await api.post<Outcome>(`/import/${what}`, { csv, dryRun, ...(what === 'tasks' ? { projectKey } : {}) })
      setOutcome(r)
      if (!dryRun && r.made) { addToast({ type: 'success', message: `${r.made} ${what === 'people' ? (r.made === 1 ? 'person' : 'people') : r.made === 1 ? 'task' : 'tasks'} added.` }); setCsv(''); setFileName(''); if (fileRef.current) fileRef.current.value = '' }
    } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not read the file.') }) } finally { setBusy(false) }
  }
  const good = outcome?.rows.filter((r) => r.ok).length ?? 0
  const bad = outcome ? outcome.rows.length - good : 0

  return (
    <div className="mx-auto w-full max-w-[1000px] space-y-5">
      <div>
        <h1 className="text-headline-lg text-ink">Import</h1>
        <p className="mt-0.5 text-body-md text-ink-muted">Bring your people and tasks in from a spreadsheet. Save it as CSV, choose it here, check it, then import.</p>
      </div>

      <PillFilter<What> value={what} onChange={setWhat} options={[...(admin ? [{ value: 'people' as What, label: 'People' }] : []), { value: 'tasks', label: 'Tasks' }]} />

      <Card title="1. The file" subtitle="The first line holds the column names. Capitals and the order do not matter.">
        <div className="space-y-3">
          <ul className="grid gap-1 text-body-sm text-ink-muted sm:grid-cols-2">
            {COLUMNS[what].map((c) => <li key={c.name}><span className="font-mono text-ink">{c.name}</span>: {c.note}</li>)}
          </ul>
          {what === 'tasks' && (
            <div className="max-w-sm"><label className={labelCls} htmlFor="imp-project">Project the tasks go into</label>
              <select id="imp-project" value={projectKey} onChange={(e) => setProjectKey(e.target.value)} className={inputCls}>{projects.length === 0 && <option value="">You are in no project yet</option>}{projects.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</select>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
            <Button variant="secondary" leadingIcon={<FileUp size={15} />} onClick={() => fileRef.current?.click()}>Choose a CSV file</Button>
            <Button variant="ghost" leadingIcon={<Download size={15} />} onClick={() => downloadText(`metriq-${what}.csv`, TEMPLATE[what])}>Download an example</Button>
            {fileName && <span className="text-body-sm text-ink-muted">{fileName}</span>}
          </div>
          {what === 'people' && <p className="text-body-sm text-ink-muted">Each new person gets an email with a link to choose their own password.</p>}
          <p className="text-body-sm text-ink-muted">Contacts and leads come in through <Link to="/app/leads" className="font-medium text-primary-ink hover:underline">Lead Management</Link>, which has its own import.</p>
        </div>
      </Card>

      <Card title="2. Check, then import" action={<div className="flex gap-2"><Button variant="secondary" disabled={busy || !csv} onClick={() => void send(true)}>Check the file</Button><Button disabled={busy || !outcome?.dryRun || !outcome.willMake} onClick={() => void send(false)}>Import {outcome?.dryRun && outcome.willMake ? outcome.willMake : ''}</Button></div>}>
        {!outcome ? <p className="text-body-md text-ink-muted">Nothing is saved until you press Import. Check the file first to see what each row will do.</p> : (
          <div className="space-y-3">
            <p className="text-body-md text-ink" role="status">
              {outcome.dryRun ? `${good} row${good === 1 ? '' : 's'} ready to import${bad ? `, ${bad} with a problem (they will be left out)` : ''}.` : `${outcome.made} added${bad ? `, ${bad} left out` : ''}.`}
            </p>
            <ul className="max-h-[420px] divide-y divide-line overflow-auto rounded-btn border border-line">
              {outcome.rows.map((r) => (
                <li key={r.line} className="flex items-start gap-2 px-3 py-2 text-body-sm">
                  {r.ok ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-success-ink" /> : <XCircle size={15} className="mt-0.5 shrink-0 text-danger-ink" />}
                  <span className="w-14 shrink-0 tabular-nums text-ink-faint">Line {r.line}</span>
                  <span className={r.ok ? 'text-ink' : 'text-danger-ink'}>{r.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  )
}
