import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronRight, ClipboardCopy, HelpCircle, ListChecks, Loader2, RefreshCw, Sparkles, Users } from 'lucide-react'
import { callsApi, type CallNotesResponse } from '../../lib/callsApi'
import { errMsg } from '../../lib/projectsApi'
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
  const [retrying, setRetrying] = useState(false)

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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-body-sm text-ink-muted">
        <span>{new Date(d.call.startedAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
        {d.call.endedAt && <span>· {Math.max(1, Math.round((new Date(d.call.endedAt).getTime() - new Date(d.call.startedAt).getTime()) / 60000))} min</span>}
        {speakers.length > 0 && <span className="inline-flex items-center gap-1">· <Users size={13} /> {speakers.length} speaking</span>}
        <button type="button" onClick={() => { void navigator.clipboard.writeText(notesAsText(d)).then(() => addToast({ type: 'success', message: 'Notes copied' })) }} className="ml-auto inline-flex items-center gap-1.5 rounded-btn border border-line px-2.5 py-1 font-semibold text-ink hover:bg-slate-50">
          <ClipboardCopy size={14} /> Copy notes
        </button>
      </div>

      {(d.status === 'pending' || d.status === 'recording') && (
        <div className="flex items-center gap-2 rounded-btn bg-primary/5 px-3 py-2 text-body-sm text-primary">
          <Loader2 size={15} className="animate-spin" /> {d.status === 'recording' ? 'The note taker is still listening. Notes are written when it stops or the call ends.' : 'Writing the notes…'}
        </div>
      )}
      {d.status === 'no-ai' && <div className="rounded-btn bg-slate-50 px-3 py-2 text-body-sm text-ink-muted">The AI summary is not switched on for PulseTrack yet, so here is the full transcript. (Admin: add ANTHROPIC_API_KEY on the server.)</div>}
      {d.status === 'failed' && <div className="rounded-btn bg-danger/10 px-3 py-2 text-body-sm text-danger">The summary could not be written{d.error ? `: ${d.error}` : ''}.</div>}
      {d.status === 'empty' && <div className="rounded-btn bg-slate-50 px-3 py-2 text-body-sm text-ink-muted">The note taker did not hear anyone speak.</div>}
      {(d.status === 'failed' || d.status === 'no-ai') && d.transcript.length > 0 && (
        <button type="button" disabled={retrying} onClick={async () => { setRetrying(true); try { await callsApi.retryNotes(callId); await load() } catch (e) { addToast({ type: 'error', message: errMsg(e) }) } finally { setRetrying(false) } }} className="inline-flex items-center gap-1.5 rounded-btn border border-line px-3 py-1.5 text-body-sm font-semibold text-ink hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw size={14} className={cn(retrying && 'animate-spin')} /> Try the summary again
        </button>
      )}

      {n && (
        <>
          <section>
            <h3 className="mb-1.5 flex items-center gap-1.5 text-body-md font-semibold text-ink"><Sparkles size={15} className="text-primary" /> Summary</h3>
            <p className="whitespace-pre-wrap text-body-md leading-relaxed text-ink">{n.summary}</p>
          </section>
          {n.keyPoints.length > 0 && <Bullets title="Key points" items={n.keyPoints} />}
          {n.decisions.length > 0 && <Bullets title="Decisions" items={n.decisions} icon={<CheckCircle2 size={15} className="text-success" />} />}
          {n.actionItems.length > 0 && (
            <section>
              <h3 className="mb-1.5 flex items-center gap-1.5 text-body-md font-semibold text-ink"><ListChecks size={15} className="text-warning" /> Action items</h3>
              <div className="overflow-hidden rounded-btn border border-line">
                <table className="w-full text-body-sm">
                  <thead className="bg-slate-50 text-left text-ink-muted"><tr><th className="px-3 py-1.5 font-semibold">Who</th><th className="px-3 py-1.5 font-semibold">What</th><th className="px-3 py-1.5 font-semibold">When</th></tr></thead>
                  <tbody>
                    {n.actionItems.map((a, i) => (
                      <tr key={i} className="border-t border-line align-top">
                        <td className="whitespace-nowrap px-3 py-1.5 font-medium text-ink">{a.owner ?? '·'}</td>
                        <td className="px-3 py-1.5 text-ink">{a.task}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-ink-muted">{a.due ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {n.openQuestions.length > 0 && <Bullets title="Open questions" items={n.openQuestions} icon={<HelpCircle size={15} className="text-ink-muted" />} />}
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

      {d.transcript.length > 0 && (
        <section>
          <button type="button" onClick={() => setShowTranscript((v) => !v)} className="flex items-center gap-1 text-body-md font-semibold text-ink">
            {showTranscript ? <ChevronDown size={16} /> : <ChevronRight size={16} />} Transcript ({d.transcript.length} lines)
          </button>
          {showTranscript && (
            <div className="mt-2 max-h-96 space-y-1.5 overflow-y-auto rounded-btn border border-line p-3">
              {d.transcript.map((l) => (
                <p key={l.id} className="text-body-sm leading-relaxed">
                  <span className="mr-2 font-mono text-[11px] text-ink-muted">{fmtClock(l.offsetSec)}</span>
                  <b className={cn('mr-1', SPEAKER_COLORS[speakers.indexOf(l.userId) % SPEAKER_COLORS.length])}>{l.speaker}:</b>
                  <span className="text-ink">{l.text}</span>
                </p>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function Bullets({ title, items, icon }: { title: string; items: string[]; icon?: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-body-md font-semibold text-ink">{icon}{title}</h3>
      <ul className="list-disc space-y-1 pl-5 text-body-md text-ink">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
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
