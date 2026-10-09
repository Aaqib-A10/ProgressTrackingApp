import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, ChevronDown, ChevronRight, ClipboardCopy, Download, HelpCircle, ListChecks, Loader2, Plus, RefreshCw, Sparkles, Users } from 'lucide-react'
import { callsApi, type CallNotesResponse } from '../../lib/callsApi'
import { errMsg, projectsApi, type ProjectListItem } from '../../lib/projectsApi'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'
import { cn } from '../../lib/cn'

const API = import.meta.env.VITE_API_URL ?? '/api'

function fmtClock(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

const SPEAKER_COLORS = ['text-primary', 'text-teal-600', 'text-amber-600', 'text-rose-600', 'text-violet-600', 'text-sky-600', 'text-emerald-700', 'text-fuchsia-600']

/** Plain-text version for "Copy notes" (paste into email, docs, a task). */
function notesAsText(d: CallNotesResponse): string {
  const n = d.notes
  const out: string[] = [`${d.call.title} · ${new Date(d.call.startedAt).toLocaleString()}`, '']
  if (n) {
    out.push('Summary', n.summary, '')
    if (n.keyPoints.length) out.push('Key points', ...n.keyPoints.map((x) => `- ${x}`), '')
    if (n.decisions.length) out.push('Decisions', ...n.decisions.map((x) => `- ${x}`), '')
    if (n.actionItems.length) out.push('Action items', ...n.actionItems.map((a) => `- ${a.owner ? `${a.owner}: ` : ''}${a.task}${a.due ? ` (due ${a.due})` : ''}`), '')
    if (n.openQuestions.length) out.push('Open questions', ...n.openQuestions.map((x) => `- ${x}`), '')
  }
  out.push('Transcript', d.transcriptText)
  return out.join('\n')
}

/** AI summary, decisions, action items, recordings and the full transcript of one call. */
export function NotesContent({ callId }: { callId: string }) {
  const { addToast } = useToast()
  const [d, setD] = useState<CallNotesResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [showTranscript, setShowTranscript] = useState(false)
  const [view, setView] = useState<'roman' | 'en' | 'said'>('roman') // transcript: Roman Urdu, English, or as written down (Urdu script)
  const [retrying, setRetrying] = useState(false)
  const [makeTask, setMakeTask] = useState<number | null>(null)
  const [makeAll, setMakeAll] = useState(false)

  const load = useCallback(() => callsApi.notes(callId).then((r) => { setD(r); setErr(null) }).catch((e) => setErr(errMsg(e, 'Could not load the notes'))), [callId])
  useEffect(() => { void load() }, [load])
  // Still being written: check again shortly.
  useEffect(() => {
    if (!d || (d.status !== 'pending' && d.status !== 'recording')) return
    const t = window.setTimeout(() => { void load() }, 4000)
    return () => window.clearTimeout(t)
  }, [d, load])

  if (err) return <p className="py-8 text-center text-body-md text-danger">{err}</p>
  if (!d) return <div className="flex justify-center py-10"><Loader2 className="animate-spin text-ink-muted" /></div>
  const n = d.notes
  const speakers = [...new Set(d.transcript.map((l) => l.userId))]
  const rtl = n?.language === 'ur'
  const rewrite = async (lang: 'roman' | 'en' | 'ur') => {
    setRetrying(true)
    try { await callsApi.retryNotes(callId, lang); await load() } catch (e) { addToast({ type: 'error', message: errMsg(e) }) } finally { setRetrying(false) }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-body-sm text-ink-muted">
        <span>{new Date(d.call.startedAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
        {d.call.endedAt && <span>· {Math.max(1, Math.round((new Date(d.call.endedAt).getTime() - new Date(d.call.startedAt).getTime()) / 60000))} min</span>}
        {speakers.length > 0 && <span className="inline-flex items-center gap-1">· <Users size={13} /> {speakers.length} speaking</span>}
        <button type="button" onClick={() => { void navigator.clipboard.writeText(notesAsText(d)).then(() => addToast({ type: 'success', message: 'Notes copied' })) }} className="ml-auto inline-flex items-center gap-1.5 rounded-btn border border-line px-2.5 py-1 font-semibold text-ink hover:bg-slate-50">
          <ClipboardCopy size={14} /> Copy notes
        </button>
        {d.transcript.length > 0 && (
          <button type="button" onClick={() => downloadText(`${d.call.title} transcript ${d.call.startedAt.slice(0, 10)}.txt`, notesAsText(d))} className="inline-flex items-center gap-1.5 rounded-btn border border-line px-2.5 py-1 font-semibold text-ink hover:bg-slate-50">
            <Download size={14} /> Download
          </button>
        )}
      </div>

      {(d.status === 'pending' || d.status === 'recording') && (
        <div className="flex items-center gap-2 rounded-btn bg-primary/5 px-3 py-2 text-body-sm text-primary">
          <Loader2 size={15} className="animate-spin" /> {d.status === 'recording' ? 'The note taker is still listening. Notes are written when it stops or the call ends.' : d.piecesLeft > 0 ? `Turning the last ${d.piecesLeft} piece${d.piecesLeft === 1 ? '' : 's'} of speech into text, then writing the notes…` : 'Writing the notes…'}
        </div>
      )}
      {d.status === 'no-ai' && <div className="rounded-btn bg-slate-50 px-3 py-2 text-body-sm text-ink-muted">The AI summary is not switched on for PulseTrack yet, so here is the full transcript. (Admin: add GROQ_API_KEY on the server.)</div>}
      {d.status === 'failed' && <div className="rounded-btn bg-danger/10 px-3 py-2 text-body-sm text-danger">The summary could not be written{d.error ? `: ${d.error}` : ''}.</div>}
      {d.status === 'empty' && <div className="rounded-btn bg-slate-50 px-3 py-2 text-body-sm text-ink-muted">The note taker did not hear anyone speak.</div>}
      {(d.status === 'failed' || d.status === 'no-ai') && d.transcript.length > 0 && (
        <button type="button" disabled={retrying} onClick={async () => { setRetrying(true); try { await callsApi.retryNotes(callId); await load() } catch (e) { addToast({ type: 'error', message: errMsg(e) }) } finally { setRetrying(false) } }} className="inline-flex items-center gap-1.5 rounded-btn border border-line px-3 py-1.5 text-body-sm font-semibold text-ink hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw size={14} className={cn(retrying && 'animate-spin')} /> Try the summary again
        </button>
      )}

      {n && d.status === 'ready' && (
        <div className="flex flex-wrap items-center gap-2 text-body-sm text-ink-muted">
          <span>Notes in</span>
          <div className="inline-flex overflow-hidden rounded-btn border border-line">
            {(['roman', 'en', 'ur'] as const).map((l) => (
              <button key={l} type="button" disabled={retrying || (n.language ?? 'en') === l} onClick={() => void rewrite(l)} className={cn('px-2.5 py-1 font-semibold', (n.language ?? 'en') === l ? 'bg-primary text-white' : 'text-ink hover:bg-slate-50 disabled:opacity-50')}>
                {l === 'roman' ? 'Roman Urdu' : l === 'en' ? 'English' : 'اردو'}
              </button>
            ))}
          </div>
          {retrying && <span className="inline-flex items-center gap-1"><Loader2 size={13} className="animate-spin" /> Writing again…</span>}
        </div>
      )}

      {n && (
        <>
          <section>
            <h3 className="mb-1.5 flex items-center gap-1.5 text-body-md font-semibold text-ink"><Sparkles size={15} className="text-primary" /> Summary</h3>
            <p dir={rtl ? 'rtl' : 'auto'} className={cn('whitespace-pre-wrap text-body-md text-ink', rtl ? 'leading-loose' : 'leading-relaxed')}>{n.summary}</p>
          </section>
          {n.keyPoints.length > 0 && <Bullets title="Key points" items={n.keyPoints} rtl={rtl} />}
          {n.decisions.length > 0 && <Bullets title="Decisions" items={n.decisions} rtl={rtl} icon={<CheckCircle2 size={15} className="text-success" />} />}
          {n.actionItems.length > 0 && (
            <section>
              <h3 className="mb-1.5 flex items-center gap-1.5 text-body-md font-semibold text-ink">
                <ListChecks size={15} className="text-warning" /> Action items
                {n.actionItems.filter((a) => !a.taskCode).length > 1 && (
                  <button type="button" onClick={() => setMakeAll(true)} className="ml-auto inline-flex items-center gap-1 rounded-btn border border-line px-2 py-0.5 text-[12px] font-semibold text-ink hover:bg-slate-50"><Plus size={12} /> Make all tasks</button>
                )}
              </h3>
              <div className="overflow-hidden rounded-btn border border-line">
                <table className="w-full text-body-sm">
                  <thead className="bg-slate-50 text-left text-ink-muted"><tr><th className="px-3 py-1.5 font-semibold">Who</th><th className="px-3 py-1.5 font-semibold">What</th><th className="px-3 py-1.5 font-semibold">When</th><th className="px-3 py-1.5" /></tr></thead>
                  <tbody>
                    {n.actionItems.map((a, i) => (
                      <tr key={i} className="border-t border-line align-top">
                        <td className="whitespace-nowrap px-3 py-1.5 font-medium text-ink">{a.owner ?? '·'}</td>
                        <td dir="auto" className="px-3 py-1.5 text-ink">{a.task}</td>
                        <td dir="auto" className="whitespace-nowrap px-3 py-1.5 text-ink-muted">{a.due ?? ''}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right">
                          {a.taskCode
                            ? <Link to={`/app/projects/${encodeURIComponent(a.taskCode.replace(/-\d+$/, ''))}?task=${encodeURIComponent(a.taskCode)}`} className="font-mono text-[12px] font-semibold text-primary hover:underline">{a.taskCode}</Link>
                            : <button type="button" onClick={() => setMakeTask(i)} className="inline-flex items-center gap-1 rounded-btn border border-line px-2 py-0.5 text-[12px] font-semibold text-ink hover:bg-slate-50"><Plus size={12} /> Task</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {n.openQuestions.length > 0 && <Bullets title="Open questions" items={n.openQuestions} rtl={rtl} icon={<HelpCircle size={15} className="text-ink-muted" />} />}
        </>
      )}

      {d.recordings.length > 0 && (
        <section>
          <h3 className="mb-1.5 text-body-md font-semibold text-ink">Recording</h3>
          {d.recordings.map((r) => r.url && (
            <video key={r.id} controls preload="metadata" className="mb-2 w-full rounded-btn border border-line bg-black" src={`${API}${r.url.replace(/^\/api/, '')}?inline=1`} />
          ))}
        </section>
      )}

      {makeAll && n && (
        <AllTasksModal callId={callId} items={n.actionItems} meetingTitle={d.call.title} onClose={() => setMakeAll(false)} onDone={() => { setMakeAll(false); void load() }} />
      )}
      {makeTask !== null && n?.actionItems[makeTask] && (
        <TaskFromActionModal callId={callId} index={makeTask} item={n.actionItems[makeTask]} meetingTitle={d.call.title} onClose={() => setMakeTask(null)} onDone={() => { setMakeTask(null); void load() }} />
      )}

      {d.transcript.length > 0 && (
        <section>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setShowTranscript((v) => !v)} className="flex items-center gap-1 text-body-md font-semibold text-ink">
              {showTranscript ? <ChevronDown size={16} /> : <ChevronRight size={16} />} Transcript ({d.transcript.length} lines)
            </button>
            {showTranscript && d.transcript.some((l) => (l.textEn && l.textEn !== l.text) || (l.textRoman && l.textRoman !== l.text)) && (
              <div className="ml-auto inline-flex overflow-hidden rounded-btn border border-line text-body-sm">
                {([['roman', 'Roman Urdu'], ['en', 'English'], ['said', 'اردو']] as const).map(([v, label]) => (
                  <button key={v} type="button" onClick={() => setView(v)} className={cn('px-2.5 py-1 font-semibold', view === v ? 'bg-primary text-white' : 'text-ink hover:bg-slate-50')}>{label}</button>
                ))}
              </div>
            )}
          </div>
          {showTranscript && (
            <div className="mt-2 max-h-96 space-y-1.5 overflow-y-auto rounded-btn border border-line p-3">
              {d.transcript.map((l) => (
                <p key={l.id} className="text-body-sm leading-relaxed">
                  <span className="mr-2 font-mono text-[11px] text-ink-muted">{fmtClock(l.offsetSec)}</span>
                  <b className={cn('mr-1', SPEAKER_COLORS[speakers.indexOf(l.userId) % SPEAKER_COLORS.length])}>{l.speaker}:</b>
                  <span dir="auto" className="text-ink">{view === 'said' ? l.text : view === 'en' ? l.textEn ?? l.textRoman ?? l.text : l.textRoman ?? l.textEn ?? l.text}</span>
                </p>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function Bullets({ title, items, icon, rtl }: { title: string; items: string[]; icon?: React.ReactNode; rtl?: boolean }) {
  return (
    <section>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-body-md font-semibold text-ink">{icon}{title}</h3>
      <ul dir={rtl ? 'rtl' : undefined} className={cn('list-disc space-y-1 text-body-md text-ink', rtl ? 'pr-5 leading-loose' : 'pl-5')}>{items.map((x, i) => <li key={i} dir={rtl ? undefined : 'auto'}>{x}</li>)}</ul>
    </section>
  )
}

export function NotesModal({ callId, title, onClose }: { callId: string; title?: string; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={title ?? 'Meeting notes'} size="lg">
      <NotesContent callId={callId} />
    </Modal>
  )
}

function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name.replace(/[\\/:*?"<>|]/g, ' ')
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** Turn one action item into a task on a project board, assigned to the person named. */
function TaskFromActionModal({ callId, index, item, meetingTitle, onClose, onDone }: { callId: string; index: number; item: { owner: string | null; task: string; due: string | null; dueDate?: string | null }; meetingTitle: string; onClose: () => void; onDone: () => void }) {
  const { addToast } = useToast()
  const [projects, setProjects] = useState<ProjectListItem[]>([])
  const [key, setKey] = useState('')
  const [members, setMembers] = useState<{ userId: string; name: string }[]>([])
  const [assignee, setAssignee] = useState('')
  const [title, setTitle] = useState(item.task)
  const [due, setDue] = useState(item.dueDate ?? (/^\d{4}-\d{2}-\d{2}/.test(item.due ?? '') ? item.due!.slice(0, 10) : ''))
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    projectsApi.list().then((r) => {
      const can = r.projects.filter((p) => p.myRole === 'ADMIN' || p.myRole === 'MEMBER')
      setProjects(can)
      // A project named in the meeting title is the likely home.
      const guess = can.find((p) => meetingTitle.toLowerCase().includes(p.key.toLowerCase()) || meetingTitle.toLowerCase().includes(p.name.toLowerCase())) ?? can[0]
      if (guess) setKey(guess.key)
    }).catch(() => undefined)
  }, [meetingTitle])
  useEffect(() => {
    if (!key) return
    projectsApi.members(key).then((r) => {
      const list = r.members.filter((m) => m.isActive && m.role !== 'VIEWER')
      setMembers(list)
      const owner = (item.owner ?? '').toLowerCase()
      const first = owner.split(' ')[0]
      const hit = owner ? list.find((m) => m.name.toLowerCase() === owner) ?? list.find((m) => first && m.name.toLowerCase().split(' ')[0] === first) : undefined
      setAssignee(hit?.userId ?? '')
    }).catch(() => setMembers([]))
  }, [key, item.owner])

  async function create() {
    if (!key || !title.trim()) return
    setBusy(true)
    try {
      const r = await projectsApi.createTask(key, {
        title: title.trim().slice(0, 200),
        description: `From the meeting notes of "${meetingTitle}".`,
        assigneeIds: assignee ? [assignee] : [],
        dueAt: due ? new Date(`${due}T18:00:00`).toISOString() : null,
      })
      await callsApi.linkActionItem(callId, index, r.task.code)
      addToast({ type: 'success', message: `Task ${r.task.code} created` })
      onDone()
    } catch (e) {
      addToast({ type: 'error', message: errMsg(e, 'Could not create the task') })
    } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title="Make this a task" size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={create} disabled={busy || !key || !title.trim()}>{busy ? 'Creating…' : 'Create task'}</Button></>}>
      <div className="space-y-3 text-body-sm">
        <label className="block"><span className="mb-1 block font-semibold text-ink">Task</span>
          <textarea value={title} onChange={(e) => setTitle(e.target.value)} rows={2} className="w-full rounded-btn border border-line px-2 py-1.5 text-body-md focus:border-primary focus:outline-none" />
        </label>
        <label className="block"><span className="mb-1 block font-semibold text-ink">Project</span>
          <select value={key} onChange={(e) => setKey(e.target.value)} className="h-9 w-full rounded-btn border border-line bg-card px-2">
            {projects.length === 0 && <option value="">No projects you can add tasks to</option>}
            {projects.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
          </select>
        </label>
        <label className="block"><span className="mb-1 block font-semibold text-ink">Assign to {item.owner ? <span className="font-normal text-ink-muted">(notes say: {item.owner})</span> : null}</span>
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="h-9 w-full rounded-btn border border-line bg-card px-2">
            <option value="">Nobody yet</option>
            {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
          </select>
        </label>
        <label className="block"><span className="mb-1 block font-semibold text-ink">Due date {item.due ? <span className="font-normal text-ink-muted">(notes say: {item.due})</span> : null}</span>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="h-9 w-full rounded-btn border border-line px-2" />
        </label>
      </div>
    </Modal>
  )
}

type ActionItem = { owner: string | null; task: string; due: string | null; dueDate?: string | null; taskCode?: string | null }

/** The project member the notes name as owner ("Ali" matches "Ali Raza"). */
function matchOwner(list: { userId: string; name: string }[], ownerName: string | null): string {
  const owner = (ownerName ?? '').toLowerCase().trim()
  if (!owner) return ''
  const first = owner.split(' ')[0]
  const hit = list.find((m) => m.name.toLowerCase() === owner) ?? list.find((m) => first && m.name.toLowerCase().split(' ')[0] === first)
  return hit?.userId ?? ''
}

function dueOf(item: ActionItem): string {
  return item.dueDate ?? (/^\d{4}-\d{2}-\d{2}/.test(item.due ?? '') ? item.due!.slice(0, 10) : '')
}

/** Every action item not yet a task becomes one, in one project, in one go. */
function AllTasksModal({ callId, items, meetingTitle, onClose, onDone }: { callId: string; items: ActionItem[]; meetingTitle: string; onClose: () => void; onDone: () => void }) {
  const { addToast } = useToast()
  const open = items.map((a, i) => ({ a, i })).filter((x) => !x.a.taskCode)
  const [projects, setProjects] = useState<ProjectListItem[]>([])
  const [key, setKey] = useState('')
  const [members, setMembers] = useState<{ userId: string; name: string }[]>([])
  const [rows, setRows] = useState(() => open.map((x) => ({ index: x.i, on: true, title: x.a.task, assignee: '', due: dueOf(x.a), owner: x.a.owner })))
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    projectsApi.list().then((r) => {
      const can = r.projects.filter((p) => p.myRole === 'ADMIN' || p.myRole === 'MEMBER')
      setProjects(can)
      const guess = can.find((p) => meetingTitle.toLowerCase().includes(p.key.toLowerCase()) || meetingTitle.toLowerCase().includes(p.name.toLowerCase())) ?? can[0]
      if (guess) setKey(guess.key)
    }).catch(() => undefined)
  }, [meetingTitle])
  useEffect(() => {
    if (!key) return
    projectsApi.members(key).then((r) => {
      const list = r.members.filter((m) => m.isActive && m.role !== 'VIEWER')
      setMembers(list)
      setRows((rs) => rs.map((row) => ({ ...row, assignee: matchOwner(list, row.owner) })))
    }).catch(() => setMembers([]))
  }, [key])
  const chosen = rows.filter((r) => r.on && r.title.trim())

  async function create() {
    if (!key || !chosen.length || busy) return
    setBusy(true)
    let made = 0
    try {
      for (const row of chosen) {
        const r = await projectsApi.createTask(key, {
          title: row.title.trim().slice(0, 200),
          description: `From the meeting notes of "${meetingTitle}".`,
          assigneeIds: row.assignee ? [row.assignee] : [],
          dueAt: row.due ? new Date(`${row.due}T18:00:00`).toISOString() : null,
        })
        await callsApi.linkActionItem(callId, row.index, r.task.code)
        made++
      }
      addToast({ type: 'success', message: `${made} task${made === 1 ? '' : 's'} created` })
      onDone()
    } catch (e) {
      addToast({ type: 'error', message: `${made ? `${made} made, then: ` : ''}${errMsg(e, 'Could not create the tasks')}` })
      if (made) onDone()
    } finally { setBusy(false) }
  }

  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  return (
    <Modal open onClose={onClose} title="Make the action items tasks" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={create} disabled={busy || !key || !chosen.length}>{busy ? 'Creating…' : `Create ${chosen.length} task${chosen.length === 1 ? '' : 's'}`}</Button></>}>
      <div className="space-y-3 text-body-sm">
        <label className="block"><span className="mb-1 block font-semibold text-ink">Project</span>
          <select value={key} onChange={(e) => setKey(e.target.value)} className="h-9 w-full rounded-btn border border-line bg-card px-2">
            {projects.length === 0 && <option value="">No projects you can add tasks to</option>}
            {projects.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
          </select>
        </label>
        <div className="space-y-2">
          {rows.map((row, i) => (
            <div key={row.index} className={cn('rounded-btn border border-line p-2 transition-opacity', !row.on && 'opacity-50')}>
              <div className="flex items-start gap-2">
                <input type="checkbox" checked={row.on} onChange={(e) => set(i, { on: e.target.checked })} className="mt-1.5 h-4 w-4 accent-primary" aria-label="Include this item" />
                <textarea dir="auto" value={row.title} onChange={(e) => set(i, { title: e.target.value })} rows={1} className="min-h-[34px] flex-1 resize-y rounded-btn border border-line px-2 py-1 text-body-sm focus:border-primary focus:outline-none" />
              </div>
              <div className="mt-1.5 flex flex-wrap gap-2 pl-6">
                <select value={row.assignee} onChange={(e) => set(i, { assignee: e.target.value })} className="h-8 min-w-0 flex-1 rounded-btn border border-line bg-card px-2" aria-label="Assign to">
                  <option value="">{row.owner ? `Nobody yet (notes say: ${row.owner})` : 'Nobody yet'}</option>
                  {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
                </select>
                <input type="date" value={row.due} onChange={(e) => set(i, { due: e.target.value })} className="h-8 rounded-btn border border-line px-2" aria-label="Due date" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}
