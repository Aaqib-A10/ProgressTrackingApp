import { useEffect, useMemo, useState } from 'react'
import { Plus, CalendarDays, Clock, Pencil, Trash2, StickyNote } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { Modal } from '../../../components/ui/Modal'
import { ListToolbar } from '../../../components/ListToolbar'
import { useToast } from '../../../components/ui/Toast'
import {
  listMeetingNotes,
  createMeetingNote,
  updateMeetingNote,
  deleteMeetingNote,
  type MeetingNote,
  type MeetingNoteInput,
} from '../../../lib/ecommerceApi'
import { fromNow } from '../../../lib/datetime'

function errMsg(e: unknown, fallback: string): string {
  return e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : fallback
}
function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Ecommerce meeting notes — shared across the team. /app/ecommerce/notes */
export default function MeetingNotes() {
  const { addToast } = useToast()
  const [notes, setNotes] = useState<MeetingNote[] | null>(null)
  const [editing, setEditing] = useState<MeetingNote | 'new' | null>(null)
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return !q ? notes ?? [] : (notes ?? []).filter((n) => [n.title, n.body, n.author.name].some((f) => f.toLowerCase().includes(q)))
  }, [notes, query])

  function load() {
    listMeetingNotes()
      .then((r) => setNotes(r.notes))
      .catch(() => setNotes([]))
  }
  useEffect(load, [])

  async function remove(n: MeetingNote) {
    if (!confirm('Delete this note?')) return
    try {
      await deleteMeetingNote(n.id)
      setNotes((prev) => (prev ?? []).filter((x) => x.id !== n.id))
      addToast({ type: 'success', message: 'Note deleted.' })
    } catch (e) {
      addToast({ type: 'error', message: errMsg(e, 'Could not delete.') })
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">Meeting Notes</h1>
          <p className="mt-1 text-body-md text-ink-muted">Shared notes for the Ecommerce team — decisions, action items and deadlines.</p>
        </div>
        <Button leadingIcon={<Plus size={16} />} onClick={() => setEditing('new')}>
          Add note
        </Button>
      </div>

      {!notes ? (
        <p className="text-body-md text-ink-muted">Loading…</p>
      ) : notes.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <StickyNote size={28} className="text-ink-muted" />
            <p className="text-body-md text-ink-muted">No meeting notes yet. Add the first one.</p>
          </div>
        </Card>
      ) : (
        <>
          <ListToolbar query={query} onQuery={setQuery} placeholder="Search notes by title, content or author…" />
          {filtered.length === 0 ? (
            <p className="py-6 text-center text-body-md text-ink-muted">No notes match your search.</p>
          ) : (
            <div className="space-y-3">
              {filtered.map((n) => (
                <NoteCard key={n.id} note={n} onEdit={() => setEditing(n)} onDelete={() => remove(n)} />
              ))}
            </div>
          )}
        </>
      )}

      {editing && (
        <NoteModal
          note={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setNotes((prev) => {
              const list = prev ?? []
              const exists = list.some((x) => x.id === saved.id)
              const next = exists ? list.map((x) => (x.id === saved.id ? saved : x)) : [saved, ...list]
              return next.sort((a, b) => (a.meetingDate < b.meetingDate ? 1 : -1))
            })
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function NoteCard({ note, onEdit, onDelete }: { note: MeetingNote; onEdit: () => void; onDelete: () => void }) {
  const overdue = note.deadline && note.deadline < todayISO()
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-headline-md text-ink">{note.title}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-body-sm text-ink-muted">
            <span className="flex items-center gap-1"><CalendarDays size={13} /> {note.meetingDate}</span>
            {note.deadline && (
              <Badge tone={overdue ? 'danger' : 'warning'}>
                <Clock size={11} className="mr-1 inline" /> Deadline {note.deadline}
              </Badge>
            )}
            <span>· {note.author.name}</span>
            <span>· {fromNow(note.createdAt)}</span>
          </div>
        </div>
        {note.canEdit && (
          <div className="flex shrink-0 gap-1">
            <button onClick={onEdit} className="rounded p-1.5 text-ink-muted hover:bg-slate-100 hover:text-ink" aria-label="Edit">
              <Pencil size={15} />
            </button>
            <button onClick={onDelete} className="rounded p-1.5 text-ink-muted hover:bg-danger/10 hover:text-danger" aria-label="Delete">
              <Trash2 size={15} />
            </button>
          </div>
        )}
      </div>
      <p className="mt-3 whitespace-pre-wrap text-body-md text-ink">{note.body}</p>
    </Card>
  )
}

const inputCls =
  'h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink placeholder:text-ink-muted focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'

function NoteModal({ note, onClose, onSaved }: { note: MeetingNote | null; onClose: () => void; onSaved: (n: MeetingNote) => void }) {
  const { addToast } = useToast()
  const [title, setTitle] = useState(note?.title ?? '')
  const [body, setBody] = useState(note?.body ?? '')
  const [meetingDate, setMeetingDate] = useState(note?.meetingDate ?? todayISO())
  const [deadline, setDeadline] = useState(note?.deadline ?? '')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!title.trim() || !body.trim()) {
      addToast({ type: 'error', message: 'Title and note are required.' })
      return
    }
    setSaving(true)
    const input: MeetingNoteInput = { title: title.trim(), body: body.trim(), meetingDate, deadline: deadline || null }
    try {
      const res = note ? await updateMeetingNote(note.id, input) : await createMeetingNote(input)
      addToast({ type: 'success', message: note ? 'Note updated.' : 'Note added.' })
      onSaved(res.note)
    } catch (e) {
      addToast({ type: 'error', message: errMsg(e, 'Could not save note.') })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={note ? 'Edit note' : 'Add meeting note'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{note ? 'Save' : 'Add note'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-body-sm font-medium text-ink">Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Weekly sync — pricing" className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1 block text-body-sm font-medium text-ink">Note</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            placeholder="Key points, decisions, action items…"
            className="w-full rounded-btn border border-line bg-card px-3 py-2 text-body-md text-ink placeholder:text-ink-muted focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-body-sm font-medium text-ink">Meeting date</span>
            <input type="date" value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1 block text-body-sm font-medium text-ink">Deadline (optional)</span>
            <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className={inputCls} />
          </label>
        </div>
      </div>
    </Modal>
  )
}
