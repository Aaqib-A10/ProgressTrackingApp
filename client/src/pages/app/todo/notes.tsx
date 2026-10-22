import { useEffect, useState } from 'react'
import { Mail, MessageCircle, Pencil, Phone, Plus, StickyNote, Trash2, Users } from 'lucide-react'
import { Modal } from '../../../components/ui/Modal'
import { Button } from '../../../components/ui/Button'
import { useToast } from '../../../components/ui/Toast'
import { cn } from '../../../lib/cn'
import { workLogApi, type WorkEntry, type WorkNote } from '../../../lib/workLogApi'
import { EntryText, errMsg, linkify } from './parts'

/**
 * Notes on a My To-Do item: the WhatsApp message from a manager that asked for it, what a
 * customer said on a call, an email. Each note has where it came from (a source: WhatsApp,
 * Email, Call, or any name the person types, which is then offered next time) and who it came from.
 */

const STARTING_SOURCES = ['WhatsApp', 'Email', 'Call', 'Teams', 'Meeting', 'In person']

export function sourceStyle(source: string | null): { cls: string; Icon: typeof StickyNote } {
  const s = (source ?? '').toLowerCase()
  if (s === 'whatsapp') return { cls: 'bg-[#25D366]/15 text-[#0E7A53]', Icon: MessageCircle }
  if (s === 'email') return { cls: 'bg-primary/10 text-primary', Icon: Mail }
  if (s === 'call') return { cls: 'bg-warning/15 text-[#B45309]', Icon: Phone }
  if (s === 'teams' || s === 'meeting' || s === 'in person') return { cls: 'bg-violet-100 text-violet-700', Icon: Users }
  return { cls: 'bg-sky-100 text-sky-700', Icon: StickyNote }
}

export function SourceChip({ source }: { source: string | null }) {
  const { cls, Icon } = sourceStyle(source)
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', cls)}><Icon size={11} />{source || 'Note'}</span>
}

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/** The notes shown under an item: the first two, then "+N more". Clicking opens all of them. */
export function NoteList({ notes, onOpen, max = 2 }: { notes: WorkNote[]; onOpen?: () => void; max?: number }) {
  if (!notes?.length) return null
  return (
    <div className="mt-1.5 space-y-1">
      {notes.slice(0, max).map((n) => (
        <button key={n.id} type="button" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onOpen?.() }} disabled={!onOpen}
          className="block w-full rounded-btn border border-sky-200 bg-sky-50/70 px-2 py-1.5 text-left hover:border-sky-300 disabled:cursor-default">
          <span className="flex flex-wrap items-center gap-1.5">
            <SourceChip source={n.source} />
            {n.sender && <span className="text-[11px] font-semibold text-ink">from {n.sender}</span>}
            <span className="text-[11px] text-ink-muted">{when(n.createdAt)}</span>
          </span>
          <span className="mt-0.5 line-clamp-2 block whitespace-pre-wrap break-words text-[12px] text-ink">{n.body}</span>
        </button>
      ))}
      {notes.length > max && (
        <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onOpen?.() }} className="text-[12px] font-semibold text-sky-700">+{notes.length - max} more note{notes.length - max === 1 ? '' : 's'}</button>
      )}
    </div>
  )
}

/** All the notes of one item; add, edit and delete them (the owner only). */
export function NotesModal({ entry, readOnly, onClose, onChanged }: { entry: WorkEntry; readOnly: boolean; onClose: () => void; onChanged: () => void }) {
  const { addToast } = useToast()
  const [sources, setSources] = useState<string[]>(STARTING_SOURCES)
  const [editing, setEditing] = useState<WorkNote | null>(null)
  const [source, setSource] = useState('WhatsApp')
  const [own, setOwn] = useState(false)
  const [sender, setSender] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)

  useEffect(() => { if (!readOnly) workLogApi.noteSources().then((r) => setSources(r.sources)).catch(() => {}) }, [readOnly])

  function reset() { setEditing(null); setSource('WhatsApp'); setOwn(false); setSender(''); setBody('') }
  function edit(n: WorkNote) {
    setEditing(n); setBody(n.body); setSender(n.sender ?? '')
    setSource(n.source ?? ''); setOwn(!!n.source && !sources.includes(n.source))
  }

  async function save() {
    if (!body.trim()) return
    setBusy(true)
    const input = { body: body.trim(), source: source.trim() || null, sender: sender.trim() || null }
    try {
      if (editing) await workLogApi.updateNote(editing.id, input)
      else await workLogApi.addNote(entry.id, input)
      const typed = input.source
      if (typed && !sources.some((s) => s.toLowerCase() === typed.toLowerCase())) setSources((l) => [...l, typed])
      reset(); onChanged()
    } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not save the note') }) } finally { setBusy(false) }
  }

  async function remove(n: WorkNote) {
    setBusy(true)
    try { await workLogApi.removeNote(n.id); if (editing?.id === n.id) reset(); setConfirmDel(null); onChanged() } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not delete the note') }) } finally { setBusy(false) }
  }

  const field = 'h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'
  return (
    <Modal open onClose={onClose} title="Notes" footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <div className="space-y-4 text-body-sm">
        <div className="rounded-btn bg-slate-50 px-3 py-2"><EntryText text={entry.title} className="text-body-md" lines={3} /></div>

        {entry.notes.length === 0 ? (
          <p className="text-ink-muted">{readOnly ? 'No notes on this item.' : 'No notes yet. Paste a WhatsApp message, an email or what was said on a call, so it stays with this to-do.'}</p>
        ) : (
          <ul className="space-y-2">
            {entry.notes.map((n) => (
              <li key={n.id} className={cn('rounded-btn border px-3 py-2', editing?.id === n.id ? 'border-primary bg-primary/5' : 'border-sky-200 bg-sky-50/60')}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <SourceChip source={n.source} />
                  {n.sender && <span className="text-[12px] font-semibold text-ink">from {n.sender}</span>}
                  <span className="text-[11px] text-ink-muted">{when(n.createdAt)}{n.updatedAt !== n.createdAt ? ' · edited' : ''}</span>
                  {!readOnly && (
                    <span className="ml-auto flex items-center gap-0.5">
                      {confirmDel === n.id ? (
                        <>
                          <button type="button" disabled={busy} onClick={() => remove(n)} className="rounded px-2 py-0.5 text-[12px] font-semibold text-danger hover:bg-danger/10">Delete</button>
                          <button type="button" onClick={() => setConfirmDel(null)} className="rounded px-2 py-0.5 text-[12px] text-ink-muted hover:bg-slate-100">Keep</button>
                        </>
                      ) : (
                        <>
                          <button type="button" onClick={() => edit(n)} className="rounded p-1 text-ink-muted hover:bg-slate-100 hover:text-ink" aria-label="Edit note"><Pencil size={14} /></button>
                          <button type="button" onClick={() => setConfirmDel(n.id)} className="rounded p-1 text-ink-muted hover:bg-danger/10 hover:text-danger" aria-label="Delete note"><Trash2 size={14} /></button>
                        </>
                      )}
                    </span>
                  )}
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-body-md text-ink">{linkify(n.body)}</p>
              </li>
            ))}
          </ul>
        )}

        {!readOnly && (
          <div className="space-y-2 rounded-card border border-line p-3">
            <p className="text-label-md uppercase text-ink-muted">{editing ? 'Edit note' : 'Add a note'}</p>
            <div>
              <span className="mb-1 block font-semibold text-ink">Where it came from</span>
              <div className="flex flex-wrap gap-1.5">
                {sources.map((s) => {
                  const on = !own && source === s
                  const { cls, Icon } = sourceStyle(s)
                  return (
                    <button key={s} type="button" onClick={() => { setOwn(false); setSource(on ? '' : s) }}
                      className={cn('inline-flex h-8 items-center gap-1 rounded-full border px-3 font-semibold', on ? cn('border-transparent', cls) : 'border-line text-ink-muted hover:bg-slate-50')}>
                      <Icon size={13} />{s}
                    </button>
                  )
                })}
                <button type="button" onClick={() => { setOwn(true); setSource('') }} className={cn('inline-flex h-8 items-center gap-1 rounded-full border px-3 font-semibold', own ? 'border-sky-300 bg-sky-100 text-sky-700' : 'border-dashed border-line text-ink-muted hover:bg-slate-50')}><Plus size={13} />Your own</button>
              </div>
              {own && <input autoFocus value={source} onChange={(e) => setSource(e.target.value)} maxLength={40} placeholder="e.g. Amazon messages, Slack, Client portal" className={cn(field, 'mt-2')} />}
            </div>
            <label className="block"><span className="mb-1 block font-semibold text-ink">From (who sent it)</span>
              <input value={sender} onChange={(e) => setSender(e.target.value)} maxLength={80} placeholder="e.g. Nasir" className={field} />
            </label>
            <label className="block"><span className="mb-1 block font-semibold text-ink">Note</span>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} rows={4} placeholder="Paste the message or write the note"
                className="w-full rounded-btn border border-line bg-card px-3 py-2 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10" />
            </label>
            <div className="flex items-center gap-2">
              <Button size="sm" disabled={busy || !body.trim()} onClick={save}>{editing ? 'Save note' : 'Add note'}</Button>
              {editing && <button type="button" onClick={reset} className="text-body-sm font-semibold text-ink-muted hover:text-ink">Cancel</button>}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
