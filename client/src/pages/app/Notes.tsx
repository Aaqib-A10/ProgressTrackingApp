import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Archive, ArchiveRestore, Bell, BellOff, Check, CheckSquare, Copy, Hash, ListChecks, Palette, Pin, PinOff, Plus, Search, Share2, StickyNote, Trash2, Type, UserMinus, X,
} from 'lucide-react'
import { notesApi, NOTE_COLORS, type Note, type NoteColor, type NoteInput, type NoteItem, type NotePerson } from '../../lib/notesApi'
import { visiblePoll } from '../../lib/chatApi'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../components/ui/Toast'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { AvatarStack, PersonAvatar, fmtAgo } from '../../components/projects/pmUi'
import { highlightMentions } from '../../components/MentionBox'
import { cn } from '../../lib/cn'

/**
 * Notes (/app/notes): sticky notes for the day's important things, asked for by the E-commerce team. Like Google Keep
 * inside Metriq: write a note or a checklist, give it a colour and tags, pin it, set a reminder, @mention people, share
 * it to read or to edit, archive it when done. Private: only the owner and the people it is shared with see a note.
 * A link with ?note=ID (from a notification) opens that note.
 */

type View = 'all' | 'pinned' | 'shared' | 'reminders' | 'archived'
const VIEWS: { key: View; label: string; icon: ReactNode }[] = [
  { key: 'all', label: 'All notes', icon: <StickyNote size={14} /> },
  { key: 'pinned', label: 'Pinned', icon: <Pin size={14} /> },
  { key: 'shared', label: 'Shared with me', icon: <Share2 size={14} /> },
  { key: 'reminders', label: 'Reminders', icon: <Bell size={14} /> },
  { key: 'archived', label: 'Archive', icon: <Archive size={14} /> },
]

/** The note colours: the theme's named hues, so every theme and dark mode has readable notes. */
const COLOR: Record<NoteColor, { card: string; dot: string; label: string }> = {
  yellow: { card: 'bg-yellow-subtle border-yellow-ring', dot: 'bg-yellow-vivid', label: 'Yellow' },
  orange: { card: 'bg-orange-subtle border-orange-ring', dot: 'bg-orange-vivid', label: 'Orange' },
  green: { card: 'bg-green-subtle border-green-ring', dot: 'bg-green-vivid', label: 'Green' },
  teal: { card: 'bg-teal-subtle border-teal-ring', dot: 'bg-teal-vivid', label: 'Teal' },
  blue: { card: 'bg-blue-subtle border-blue-ring', dot: 'bg-blue-vivid', label: 'Blue' },
  purple: { card: 'bg-purple-subtle border-purple-ring', dot: 'bg-purple-vivid', label: 'Purple' },
  pink: { card: 'bg-pink-subtle border-pink-ring', dot: 'bg-pink-vivid', label: 'Pink' },
  red: { card: 'bg-red-subtle border-red-ring', dot: 'bg-red-vivid', label: 'Red' },
  plain: { card: 'bg-card border-line', dot: 'bg-card ring-1 ring-inset ring-line-strong', label: 'No colour' },
}

const uid = () => Math.random().toString(36).slice(2, 10)
const errText = (e: unknown, fallback: string) => {
  const m = (e as { message?: string })?.message
  if (!m) return fallback
  try { return (JSON.parse(m) as { error?: string }).error || fallback } catch { return m }
}
const noteText = (n: Pick<Note, 'title' | 'body' | 'items'>) => [n.title, n.body, ...(n.items ?? []).map((i) => i.text)].join('\n')
const whenLabel = (iso: string) => {
  const d = new Date(iso)
  const today = new Date()
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (d.toDateString() === today.toDateString()) return `Today, ${time}`
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow, ${time}`
  return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}, ${time}`
}
/** "YYYY-MM-DDTHH:mm" in local time, for a datetime-local field. */
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)

export default function Notes() {
  const { user } = useAuth()
  const { addToast } = useToast()
  const [params, setParams] = useSearchParams()
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [people, setPeople] = useState<NotePerson[]>([])
  const [view, setView] = useState<View>('all')
  const [tag, setTag] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const openId = params.get('note')

  const load = useCallback(() => notesApi.list().then((r) => setNotes(r.notes)).catch(() => setNotes((cur) => cur ?? [])), [])
  useEffect(() => { void load() }, [load])
  useEffect(() => visiblePoll(() => void load(), 30_000), [load])
  useEffect(() => { notesApi.people().then((r) => setPeople(r.people)).catch(() => undefined) }, [])

  const put = (n: Note) => setNotes((cur) => (cur ?? []).some((x) => x.id === n.id) ? (cur ?? []).map((x) => (x.id === n.id ? n : x)) : [n, ...(cur ?? [])])
  const drop = (id: string) => setNotes((cur) => (cur ?? []).filter((x) => x.id !== id))
  const open = (id: string | null) => { const next = new URLSearchParams(params); if (id) next.set('note', id); else next.delete('note'); setParams(next, { replace: true }) }

  /** Quick changes from a card (pin, colour, archive, a checklist tick): shown at once, put back if refused. */
  const quick = async (n: Note, patch: NoteInput, done?: string) => {
    put({ ...n, ...patch } as Note)
    try { put((await notesApi.update(n.id, patch)).note); if (done) addToast({ type: 'success', message: done }) } catch (e) { put(n); addToast({ type: 'error', message: errText(e, 'Could not save the note.') }) }
  }
  const remove = async (n: Note) => {
    const mine = n.access === 'owner'
    if (!window.confirm(mine ? 'Delete this note for everyone it is shared with? This cannot be undone.' : 'Take this note off your list? Its owner keeps it.')) return
    try { await notesApi.remove(n.id); drop(n.id); open(null); addToast({ type: 'success', message: mine ? 'Note deleted.' : 'Note taken off your list.' }) } catch (e) { addToast({ type: 'error', message: errText(e, 'Could not delete the note.') }) }
  }

  const all = notes ?? []
  const counts = useMemo(() => ({
    all: all.filter((n) => !n.archived).length,
    pinned: all.filter((n) => !n.archived && n.pinned).length,
    shared: all.filter((n) => !n.archived && n.access !== 'owner').length,
    reminders: all.filter((n) => !n.archived && n.remindAt && !n.reminded).length,
    archived: all.filter((n) => n.archived && n.access === 'owner').length,
  }), [all])
  const tags = useMemo(() => [...new Set(all.filter((n) => !n.archived).flatMap((n) => n.tags))].sort(), [all])
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return all.filter((n) => {
      if (view === 'archived' ? !(n.archived && n.access === 'owner') : n.archived) return false
      if (view === 'pinned' && !n.pinned) return false
      if (view === 'shared' && n.access === 'owner') return false
      if (view === 'reminders' && !n.remindAt) return false
      if (tag && !n.tags.includes(tag)) return false
      if (t && !`${noteText(n)} ${n.tags.join(' ')} ${n.owner.name}`.toLowerCase().includes(t)) return false
      return true
    }).sort((a, b) => (view === 'reminders' ? (a.remindAt ?? '').localeCompare(b.remindAt ?? '') : 0))
  }, [all, view, tag, q])
  const pinned = view === 'all' ? shown.filter((n) => n.pinned) : []
  const others = view === 'all' ? shown.filter((n) => !n.pinned) : shown
  const opened = openId ? all.find((n) => n.id === openId) ?? null : null

  // A link to a note that is not in the list yet (just shared): fetch it once.
  useEffect(() => {
    if (!openId || !notes || opened) return
    notesApi.get(openId).then((r) => put(r.note)).catch(() => { addToast({ type: 'error', message: 'That note is not shared with you any more.' }); open(null) })
  }, [openId, notes, opened]) // eslint-disable-line react-hooks/exhaustive-deps

  const members = useMemo(() => [...people, ...(user ? [{ id: user.id, name: user.name, department: null }] : [])], [people, user])

  return (
    <div className="mx-auto w-full max-w-[1800px] space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">Notes</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">Sticky notes for the day's important things. Only you and the people you share a note with can see it.</p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setQ('') }} placeholder="Search notes" aria-label="Search notes" className="h-9 w-full rounded-btn border border-line bg-card pl-9 pr-3 text-body-md text-ink shadow-xs placeholder:text-ink-faint focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-b border-line pb-3" role="tablist" aria-label="Which notes">
        {VIEWS.map((v) => (
          <button key={v.key} type="button" role="tab" aria-selected={view === v.key} onClick={() => setView(v.key)}
            className={cn('inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-body-sm font-medium transition-colors', view === v.key ? 'border-primary bg-primary-50 text-primary-ink' : 'border-line bg-card text-ink-muted hover:border-line-strong hover:text-ink')}>
            {v.icon}{v.label}{counts[v.key] > 0 && <span className="tabular-nums text-ink-faint">{counts[v.key]}</span>}
          </button>
        ))}
        {tags.length > 0 && <span className="mx-1 h-5 w-px bg-line" aria-hidden />}
        {tags.map((t) => (
          <button key={t} type="button" onClick={() => setTag(tag === t ? null : t)}
            className={cn('inline-flex h-7 items-center gap-0.5 rounded-full px-2.5 text-[12.5px] font-medium transition-colors', tag === t ? 'bg-ink text-card' : 'bg-slate-100 text-ink-muted hover:text-ink')}>
            <Hash size={12} />{t}
          </button>
        ))}
      </div>

      {view !== 'archived' && view !== 'shared' && <Composer people={people} members={members} onCreated={(n) => { put(n); if (view === 'reminders' && !n.remindAt) setView('all') }} />}

      {!notes ? (
        <div className="columns-1 gap-4 sm:columns-2 xl:columns-3 2xl:columns-4">{Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton mb-4 h-32 break-inside-avoid rounded-card" />)}</div>
      ) : shown.length === 0 ? (
        <Empty view={view} filtered={!!(q || tag)} />
      ) : (
        <div className="space-y-6">
          {pinned.length > 0 && <Section title="Pinned" notes={pinned} members={members} onOpen={open} onQuick={quick} onRemove={remove} />}
          {others.length > 0 && <Section title={pinned.length ? 'Others' : null} notes={others} members={members} onOpen={open} onQuick={quick} onRemove={remove} />}
        </div>
      )}

      {opened && (
        <NoteEditor key={opened.id} note={opened} people={people} members={members} onClose={() => open(null)} onSaved={put} onRemove={() => void remove(opened)} />
      )}
    </div>
  )
}

function Empty({ view, filtered }: { view: View; filtered: boolean }) {
  const text = filtered ? 'No notes match.' : {
    all: 'No notes yet. Write one above: the things you must not forget today.',
    pinned: 'Nothing pinned. Pin a note to keep it at the top.',
    shared: 'Nobody has shared a note with you yet.',
    reminders: 'No reminders. Add one to a note and Metriq tells you when it is time.',
    archived: 'The archive is empty. Archive a note when you are done with it.',
  }[view]
  return (
    <div className="flex flex-col items-center rounded-card border border-dashed border-line px-6 py-14 text-center">
      <StickyNote size={26} className="mb-3 text-ink-faint" />
      <p className="max-w-sm text-body-md text-ink-muted">{text}</p>
    </div>
  )
}

function Section({ title, notes, members, onOpen, onQuick, onRemove }: { title: string | null; notes: Note[]; members: NotePerson[]; onOpen: (id: string) => void; onQuick: (n: Note, p: NoteInput, done?: string) => void; onRemove: (n: Note) => void }) {
  return (
    <section>
      {title && <h2 className="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-ink-faint">{title}</h2>}
      <div className="columns-1 gap-4 sm:columns-2 xl:columns-3 2xl:columns-4">
        {notes.map((n) => <NoteCard key={n.id} note={n} members={members} onOpen={() => onOpen(n.id)} onQuick={(p, done) => onQuick(n, p, done)} onRemove={() => onRemove(n)} />)}
      </div>
    </section>
  )
}

function NoteCard({ note: n, members, onOpen, onQuick, onRemove }: { note: Note; members: NotePerson[]; onOpen: () => void; onQuick: (p: NoteInput, done?: string) => void; onRemove: () => void }) {
  const [colors, setColors] = useState(false)
  const owner = n.access === 'owner'
  const canEdit = n.access !== 'view'
  const due = n.remindAt && !n.reminded && new Date(n.remindAt).getTime() < Date.now()
  const items = n.items ?? []
  const open = items.filter((i) => !i.done)
  const doneItems = items.filter((i) => i.done)
  const toggle = (it: NoteItem) => onQuick({ items: items.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)) })
  return (
    <article
      className={cn('group relative mb-4 break-inside-avoid rounded-card border p-3.5 shadow-xs transition-shadow hover:shadow-raised focus-within:shadow-raised', COLOR[n.color].card)}
    >
      <button type="button" onClick={onOpen} className="absolute inset-0 rounded-card focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label={`Open note ${n.title || noteText(n).slice(0, 40)}`} />
      <div className="pointer-events-none relative">
        <div className="flex items-start gap-2">
          {n.title && <h3 className="min-w-0 flex-1 break-words text-[15px] font-semibold leading-6 text-ink">{n.title}</h3>}
          {owner && (
            <button type="button" onClick={() => onQuick({ pinned: !n.pinned })} className={cn('pointer-events-auto -mr-1 -mt-0.5 ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-black/5 hover:text-ink dark:hover:bg-white/10', !n.pinned && 'opacity-0 group-hover:opacity-100 focus:opacity-100')} aria-label={n.pinned ? 'Unpin' : 'Pin to the top'} title={n.pinned ? 'Unpin' : 'Pin to the top'}>
              {n.pinned ? <Pin size={15} className="fill-current" /> : <Pin size={15} />}
            </button>
          )}
        </div>
        {n.body && <p className="mt-1 line-clamp-[14] whitespace-pre-wrap break-words text-body-sm leading-[1.45rem] text-ink">{highlightMentions(n.body, n.mentions, members)}</p>}
        {items.length > 0 && (
          <ul className="mt-1.5 space-y-0.5">
            {[...open.slice(0, 8), ...doneItems.slice(0, Math.max(0, 8 - open.length))].map((it) => (
              <li key={it.id} className="flex items-start gap-2 text-body-sm">
                <button type="button" disabled={!canEdit} onClick={() => toggle(it)} className="pointer-events-auto mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center rounded border border-ink-faint bg-card disabled:cursor-default" aria-label={it.done ? 'Mark not done' : 'Mark done'}>
                  {it.done && <Check size={12} className="text-ink" />}
                </button>
                <span className={cn('break-words', it.done ? 'text-ink-faint line-through' : 'text-ink')}>{it.text}</span>
              </li>
            ))}
            {items.length > 8 && <li className="pl-6 text-[12px] text-ink-muted">+{items.length - 8} more</li>}
          </ul>
        )}
        {(n.tags.length > 0 || n.remindAt) && (
          <div className="mt-2.5 flex flex-wrap gap-1">
            {n.remindAt && (
              <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium', n.reminded ? 'bg-black/5 text-ink-muted line-through dark:bg-white/10' : due ? 'bg-danger-muted text-danger-ink' : 'bg-black/5 text-ink dark:bg-white/10')}>
                <Bell size={11} />{whenLabel(n.remindAt)}
              </span>
            )}
            {n.tags.map((t) => <span key={t} className="inline-flex items-center rounded-full bg-black/5 px-2 py-0.5 text-[11.5px] font-medium text-ink-muted dark:bg-white/10">#{t}</span>)}
          </div>
        )}
        <div className="mt-2.5 flex min-h-[28px] items-center gap-2">
          {!owner ? (
            <span className="inline-flex min-w-0 items-center gap-1.5 text-[12px] text-ink-muted"><PersonAvatar person={n.owner} size={18} /><span className="truncate">From {n.owner.name.split(' ')[0]}{n.access === 'edit' ? ' · you can edit' : ''}</span></span>
          ) : n.shares.length > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-muted"><AvatarStack people={n.shares.map((s) => ({ id: s.userId, name: s.name }))} size={18} max={4} /></span>
          ) : null}
          <span className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100">
            {canEdit && (
              <span className="relative">
                <CardBtn label="Colour" onClick={() => setColors((c) => !c)}><Palette size={14} /></CardBtn>
                {colors && (
                  <span className="pointer-events-auto absolute bottom-8 right-0 z-10 flex gap-1 rounded-full border border-line bg-card p-1.5 shadow-overlay">
                    {NOTE_COLORS.map((c) => <button key={c} type="button" onClick={() => { setColors(false); onQuick({ color: c }) }} className={cn('h-5 w-5 rounded-full', COLOR[c].dot, n.color === c && 'ring-2 ring-primary ring-offset-1 ring-offset-card')} aria-label={COLOR[c].label} title={COLOR[c].label} />)}
                  </span>
                )}
              </span>
            )}
            {owner && <CardBtn label={n.archived ? 'Take out of the archive' : 'Archive'} onClick={() => onQuick({ archived: !n.archived }, n.archived ? 'Back in your notes.' : 'Archived.')}>{n.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}</CardBtn>}
            <CardBtn label={owner ? 'Delete' : 'Take off my list'} onClick={onRemove}>{owner ? <Trash2 size={14} /> : <UserMinus size={14} />}</CardBtn>
          </span>
        </div>
      </div>
    </article>
  )
}

function CardBtn({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} aria-label={label} title={label} className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-full text-ink-muted hover:bg-black/5 hover:text-ink dark:hover:bg-white/10">{children}</button>
}

// ------------------------------------------------------------------ writing a note

interface Draft { title: string; body: string; items: NoteItem[] | null; color: NoteColor; tags: string[]; mentions: string[]; remindAt: string | null }
const emptyDraft = (): Draft => ({ title: '', body: '', items: null, color: 'yellow', tags: [], mentions: [], remindAt: null })
const fromNote = (n: Note): Draft => ({ title: n.title, body: n.body, items: n.items, color: n.color, tags: n.tags, mentions: n.mentions, remindAt: n.remindAt })
const hasWords = (d: Draft) => !!(d.title.trim() || d.body.trim() || d.items?.some((i) => i.text.trim()))
/** Only the mentions still written in the text count. */
const liveMentions = (d: Draft, members: NotePerson[]) => d.mentions.filter((id) => { const p = members.find((m) => m.id === id); return !!p && d.body.includes(`@${p.name}`) })

/** The quick "Take a note" box at the top: one line until clicked. */
function Composer({ people, members, onCreated }: { people: NotePerson[]; members: NotePerson[]; onCreated: (n: Note) => void }) {
  const { addToast } = useToast()
  const [open, setOpen] = useState(false)
  const [d, setD] = useState<Draft>(emptyDraft)
  const [shares, setShares] = useState<{ userId: string; canEdit: boolean }[]>([])
  const [saving, setSaving] = useState(false)
  const reset = () => { setD(emptyDraft()); setShares([]); setOpen(false) }
  async function save() {
    if (!hasWords(d)) { reset(); return }
    setSaving(true)
    try {
      const r = await notesApi.create({ ...d, items: d.items?.filter((i) => i.text.trim()) ?? null, mentions: liveMentions(d, members), shares })
      onCreated(r.note)
      addToast({ type: 'success', message: shares.length ? `Note saved and shared with ${shares.length} ${shares.length === 1 ? 'person' : 'people'}.` : 'Note saved.' })
      reset()
    } catch (e) { addToast({ type: 'error', message: errText(e, 'Could not save the note.') }) } finally { setSaving(false) }
  }
  if (!open) {
    return (
      <div className="mx-auto flex max-w-2xl items-center gap-1 rounded-card border border-line bg-card px-2 shadow-raised">
        <button type="button" onClick={() => setOpen(true)} className="flex h-12 flex-1 items-center px-2 text-left text-body-md text-ink-faint">Take a note…</button>
        <button type="button" onClick={() => { setD({ ...emptyDraft(), items: [{ id: uid(), text: '', done: false }] }); setOpen(true) }} className="flex h-9 w-9 items-center justify-center rounded-full text-ink-muted hover:bg-slate-100 hover:text-ink" aria-label="New checklist" title="New checklist"><CheckSquare size={18} /></button>
      </div>
    )
  }
  return (
    <div className={cn('mx-auto max-w-2xl rounded-card border p-3 shadow-overlay', COLOR[d.color].card)} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); void save() } }}>
      <NoteFields d={d} setD={setD} people={people} members={members} canEdit autoFocus onSubmit={() => void save()} />
      <Toolbar d={d} setD={setD} people={people} shares={shares} setShares={setShares} owner />
      <div className="mt-2 flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={reset}>Discard</Button>
        <Button size="sm" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save note'}</Button>
      </div>
    </div>
  )
}

/** Title, words (with @mention suggestions) or a checklist. */
function NoteFields({ d, setD, people, members, canEdit, autoFocus, onSubmit }: { d: Draft; setD: (f: (d: Draft) => Draft) => void; people: NotePerson[]; members: NotePerson[]; canEdit: boolean; autoFocus?: boolean; onSubmit: () => void }) {
  const body = useRef<HTMLTextAreaElement>(null)
  const [suggest, setSuggest] = useState<{ q: string; at: number } | null>(null)
  const grow = () => { const el = body.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 420)}px` } }
  useEffect(grow, [d.body])
  const matches = suggest ? people.filter((p) => p.name.toLowerCase().includes(suggest.q.toLowerCase())).slice(0, 6) : []
  const onBody = (v: string, caret: number) => {
    setD((x) => ({ ...x, body: v }))
    // "@Ali", or "@Ali Kh" (names have a space): up to two words after the @.
    const m = /(^|\s)@([^\s@]{0,30}(?: [^\s@]{0,30})?)$/.exec(v.slice(0, caret))
    setSuggest(m ? { q: m[2], at: caret - m[2].length - 1 } : null)
  }
  const pick = (p: NotePerson) => {
    if (!suggest) return
    const caret = suggest.at + 1 + suggest.q.length
    const v = `${d.body.slice(0, suggest.at)}@${p.name} ${d.body.slice(caret)}`
    setD((x) => ({ ...x, body: v, mentions: [...new Set([...x.mentions, p.id])] }))
    setSuggest(null)
    window.setTimeout(() => { const el = body.current; if (el) { el.focus(); const at = suggest.at + p.name.length + 2; el.setSelectionRange(at, at) } }, 0)
  }
  const keys = (e: KeyboardEvent) => {
    if (suggest && matches.length && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); pick(matches[0]); return }
    if (e.key === 'Escape' && suggest) { e.stopPropagation(); setSuggest(null); return }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSubmit() }
  }
  const items = d.items
  const setItem = (id: string, patch: Partial<NoteItem>) => setD((x) => ({ ...x, items: (x.items ?? []).map((i) => (i.id === id ? { ...i, ...patch } : i)) }))
  return (
    <div>
      <input
        value={d.title}
        onChange={(e) => setD((x) => ({ ...x, title: e.target.value }))}
        onKeyDown={keys}
        readOnly={!canEdit}
        maxLength={200}
        placeholder="Title"
        aria-label="Title"
        className="w-full border-0 bg-transparent px-1 py-1 text-[16px] font-semibold text-ink placeholder:text-ink-faint focus:outline-none"
      />
      {items ? (
        <ul className="mt-1 space-y-1">
          {items.map((it, i) => (
            <li key={it.id} className="group/item flex items-center gap-2">
              <button type="button" disabled={!canEdit} onClick={() => setItem(it.id, { done: !it.done })} className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-ink-faint bg-card" aria-label={it.done ? 'Mark not done' : 'Mark done'}>{it.done && <Check size={12} className="text-ink" />}</button>
              <input
                value={it.text}
                readOnly={!canEdit}
                autoFocus={autoFocus && i === items.length - 1 && !it.text}
                onChange={(e) => setItem(it.id, { text: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !(e.ctrlKey || e.metaKey)) { e.preventDefault(); setD((x) => { const list = [...(x.items ?? [])]; list.splice(i + 1, 0, { id: uid(), text: '', done: false }); return { ...x, items: list } }) }
                  else if (e.key === 'Backspace' && !it.text && items.length > 1) { e.preventDefault(); setD((x) => ({ ...x, items: (x.items ?? []).filter((y) => y.id !== it.id) })) }
                  else keys(e)
                }}
                maxLength={500}
                placeholder="List item"
                className={cn('min-w-0 flex-1 border-0 bg-transparent px-1 py-0.5 text-body-md placeholder:text-ink-faint focus:outline-none', it.done ? 'text-ink-faint line-through' : 'text-ink')}
              />
              {canEdit && <button type="button" onClick={() => setD((x) => ({ ...x, items: (x.items ?? []).filter((y) => y.id !== it.id) }))} className="flex h-6 w-6 items-center justify-center rounded-full text-ink-faint opacity-0 hover:bg-black/5 hover:text-ink group-hover/item:opacity-100 focus:opacity-100" aria-label="Remove item"><X size={13} /></button>}
            </li>
          ))}
          {canEdit && <li><button type="button" onClick={() => setD((x) => ({ ...x, items: [...(x.items ?? []), { id: uid(), text: '', done: false }] }))} className="ml-0.5 inline-flex items-center gap-1.5 px-1 py-1 text-body-sm text-ink-muted hover:text-ink"><Plus size={14} />Add an item</button></li>}
        </ul>
      ) : (
        <div className="relative">
          <textarea
            ref={body}
            value={d.body}
            readOnly={!canEdit}
            autoFocus={autoFocus}
            onChange={(e) => onBody(e.target.value, e.target.selectionStart ?? e.target.value.length)}
            onKeyDown={keys}
            rows={3}
            maxLength={20000}
            placeholder="Take a note… Type @ to mention someone."
            aria-label="Note"
            className="w-full resize-none border-0 bg-transparent px-1 py-1 text-body-md leading-6 text-ink placeholder:text-ink-faint focus:outline-none"
          />
          {suggest && matches.length > 0 && (
            <ul className="absolute left-0 top-full z-20 w-64 overflow-hidden rounded-lg border border-line bg-card p-1 shadow-overlay">
              {matches.map((p, i) => (
                <li key={p.id}><button type="button" onMouseDown={(e) => { e.preventDefault(); pick(p) }} className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body-sm text-ink hover:bg-slate-100', i === 0 && 'bg-slate-100')}><PersonAvatar person={p} size={20} /><span className="min-w-0 flex-1 truncate">{p.name}</span>{p.department && <span className="truncate text-[11px] text-ink-faint">{p.department}</span>}</button></li>
              ))}
            </ul>
          )}
        </div>
      )}
      {d.mentions.length > 0 && !items && (
        <p className="mt-1 px-1 text-[12px] text-ink-muted">Mentioned people can read this note and are told: {liveMentions(d, members).map((id) => members.find((m) => m.id === id)?.name.split(' ')[0]).filter(Boolean).join(', ') || 'nobody yet'}.</p>
      )}
    </div>
  )
}

/** Colour, checklist or text, tags, reminder and (for a new note) sharing. */
function Toolbar({ d, setD, people, shares, setShares, owner, canEdit = true }: { d: Draft; setD: (f: (d: Draft) => Draft) => void; people: NotePerson[]; shares?: { userId: string; canEdit: boolean }[]; setShares?: (s: { userId: string; canEdit: boolean }[]) => void; owner: boolean; canEdit?: boolean }) {
  const [panel, setPanel] = useState<null | 'color' | 'tags' | 'remind' | 'share'>(null)
  const [tag, setTag] = useState('')
  const toggle = (p: typeof panel) => setPanel((cur) => (cur === p ? null : p))
  const addTag = () => {
    const t = tag.trim().toLowerCase().replace(/^#+/, '').replace(/\s+/g, '-').slice(0, 30)
    if (t && !d.tags.includes(t) && d.tags.length < 20) setD((x) => ({ ...x, tags: [...x.tags, t] }))
    setTag('')
  }
  const toChecklist = () => setD((x) => (x.items
    ? { ...x, body: x.items.map((i) => i.text).filter(Boolean).join('\n'), items: null }
    : { ...x, items: (x.body.split('\n').map((t) => t.trim()).filter(Boolean).length ? x.body.split('\n').map((t) => t.trim()).filter(Boolean) : ['']).map((text) => ({ id: uid(), text, done: false })), body: '' }))
  const at = (h: number, m: number, plusDays: number) => { const t = new Date(); t.setDate(t.getDate() + plusDays); t.setHours(h, m, 0, 0); return t }
  const nextMonday = () => { const t = new Date(); t.setDate(t.getDate() + ((8 - t.getDay()) % 7 || 7)); t.setHours(9, 0, 0, 0); return t }
  const later = () => { const t = new Date(); t.setHours(t.getHours() < 17 ? 18 : t.getHours() + 2, 0, 0, 0); return t }
  if (!canEdit) return null
  return (
    <div className="mt-2 border-t border-black/5 pt-2 dark:border-white/10">
      {(d.tags.length > 0 || d.remindAt || (shares && shares.length > 0)) && (
        <div className="mb-2 flex flex-wrap gap-1 px-1">
          {d.remindAt && <Chip onRemove={owner ? () => setD((x) => ({ ...x, remindAt: null })) : undefined}><Bell size={11} />{whenLabel(d.remindAt)}</Chip>}
          {d.tags.map((t) => <Chip key={t} onRemove={() => setD((x) => ({ ...x, tags: x.tags.filter((y) => y !== t) }))}>#{t}</Chip>)}
          {shares?.map((s) => <Chip key={s.userId} onRemove={() => setShares?.(shares.filter((x) => x.userId !== s.userId))}><Share2 size={11} />{people.find((p) => p.id === s.userId)?.name.split(' ')[0]}{s.canEdit ? ' (edit)' : ''}</Chip>)}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-0.5">
        <ToolBtn on={panel === 'color'} label="Colour" onClick={() => toggle('color')}><Palette size={16} /></ToolBtn>
        <ToolBtn label={d.items ? 'Make it plain text' : 'Make it a checklist'} onClick={toChecklist}>{d.items ? <Type size={16} /> : <ListChecks size={16} />}</ToolBtn>
        <ToolBtn on={panel === 'tags'} label="Tags" onClick={() => toggle('tags')}><Hash size={16} /></ToolBtn>
        {owner && <ToolBtn on={panel === 'remind'} label="Remind me" onClick={() => toggle('remind')}><Bell size={16} /></ToolBtn>}
        {owner && setShares && <ToolBtn on={panel === 'share'} label="Share" onClick={() => toggle('share')}><Share2 size={16} /></ToolBtn>}
      </div>
      {panel === 'color' && (
        <div className="mt-2 flex flex-wrap gap-1.5 px-1">
          {NOTE_COLORS.map((c) => <button key={c} type="button" onClick={() => setD((x) => ({ ...x, color: c }))} className={cn('h-7 w-7 rounded-full', COLOR[c].dot, d.color === c && 'ring-2 ring-primary ring-offset-2 ring-offset-card')} aria-label={COLOR[c].label} title={COLOR[c].label} />)}
        </div>
      )}
      {panel === 'tags' && (
        <div className="mt-2 flex items-center gap-2 px-1">
          <input value={tag} onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag() } }} placeholder="Add a tag, e.g. amazon" maxLength={30} className="h-8 w-56 rounded-btn border border-line bg-card px-2.5 text-body-sm text-ink focus:border-primary focus:outline-none" autoFocus />
          <Button size="sm" variant="secondary" onClick={addTag} disabled={!tag.trim()}>Add</Button>
        </div>
      )}
      {panel === 'remind' && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 px-1">
          {[['Later today', later()], ['Tomorrow 9 AM', at(9, 0, 1)], ['Next Monday 9 AM', nextMonday()]].map(([label, t]) => (
            <button key={label as string} type="button" onClick={() => { setD((x) => ({ ...x, remindAt: (t as Date).toISOString() })); setPanel(null) }} className="h-8 rounded-full border border-line bg-card px-3 text-body-sm text-ink hover:border-line-strong">{label as string}</button>
          ))}
          <input type="datetime-local" value={d.remindAt ? localInput(new Date(d.remindAt)) : ''} min={localInput(new Date())} onChange={(e) => setD((x) => ({ ...x, remindAt: e.target.value ? new Date(e.target.value).toISOString() : null }))} className="h-8 rounded-btn border border-line bg-card px-2 text-body-sm text-ink focus:border-primary focus:outline-none" aria-label="Pick a date and time" />
          {d.remindAt && <button type="button" onClick={() => setD((x) => ({ ...x, remindAt: null }))} className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-body-sm text-ink-muted hover:text-ink"><BellOff size={13} />No reminder</button>}
        </div>
      )}
      {panel === 'share' && shares && setShares && <SharePicker people={people} shares={shares} onChange={setShares} />}
    </div>
  )
}

function ToolBtn({ label, onClick, on, children }: { label: string; onClick: () => void; on?: boolean; children: ReactNode }) {
  return <button type="button" onClick={onClick} aria-label={label} title={label} aria-pressed={on} className={cn('flex h-8 w-8 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-black/5 hover:text-ink dark:hover:bg-white/10', on && 'bg-black/5 text-ink dark:bg-white/10')}>{children}</button>
}

function Chip({ children, onRemove }: { children: ReactNode; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-black/5 py-0.5 pl-2 pr-1 text-[12px] font-medium text-ink dark:bg-white/10">
      {children}
      {onRemove ? <button type="button" onClick={onRemove} className="flex h-4 w-4 items-center justify-center rounded-full text-ink-muted hover:bg-black/10 hover:text-ink" aria-label="Remove"><X size={11} /></button> : <span className="w-1" />}
    </span>
  )
}

/** Who a note is shared with: add people, read or edit, take them off. */
function SharePicker({ people, shares, onChange, busy }: { people: NotePerson[]; shares: { userId: string; canEdit: boolean }[]; onChange: (s: { userId: string; canEdit: boolean }[]) => void; busy?: boolean }) {
  const [q, setQ] = useState('')
  const found = q.trim() ? people.filter((p) => !shares.some((s) => s.userId === p.id) && `${p.name} ${p.department ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6) : []
  return (
    <div className="mt-2 space-y-2 px-1">
      <div className="relative">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Share with… (type a name)" className="h-9 w-full rounded-btn border border-line bg-card px-3 text-body-sm text-ink focus:border-primary focus:outline-none" disabled={busy} />
        {found.length > 0 && (
          <ul className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-line bg-card p-1 shadow-overlay">
            {found.map((p) => (
              <li key={p.id}><button type="button" onClick={() => { onChange([...shares, { userId: p.id, canEdit: false }]); setQ('') }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body-sm text-ink hover:bg-slate-100"><PersonAvatar person={p} size={20} /><span className="min-w-0 flex-1 truncate">{p.name}</span>{p.department && <span className="truncate text-[11px] text-ink-faint">{p.department}</span>}</button></li>
            ))}
          </ul>
        )}
      </div>
      {shares.length > 0 && (
        <ul className="divide-y divide-black/5 rounded-lg border border-line bg-card dark:divide-white/10">
          {shares.map((s) => {
            const p = people.find((x) => x.id === s.userId)
            return (
              <li key={s.userId} className="flex items-center gap-2 px-2.5 py-1.5">
                <PersonAvatar person={p ?? { id: s.userId, name: '?' }} size={22} />
                <span className="min-w-0 flex-1 truncate text-body-sm text-ink">{p?.name ?? 'Someone'}</span>
                <select value={s.canEdit ? 'edit' : 'view'} disabled={busy} onChange={(e) => onChange(shares.map((x) => (x.userId === s.userId ? { ...x, canEdit: e.target.value === 'edit' } : x)))} className="h-7 rounded-md border border-line bg-card px-1.5 text-[12.5px] text-ink">
                  <option value="view">Can read</option>
                  <option value="edit">Can edit</option>
                </select>
                <button type="button" disabled={busy} onClick={() => onChange(shares.filter((x) => x.userId !== s.userId))} className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted hover:bg-slate-100 hover:text-ink" aria-label="Stop sharing"><X size={14} /></button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** A note opened on its own: edit (if allowed), share (the owner), pin, archive, delete. */
function NoteEditor({ note, people, members, onClose, onSaved, onRemove }: { note: Note; people: NotePerson[]; members: NotePerson[]; onClose: () => void; onSaved: (n: Note) => void; onRemove: () => void }) {
  const { addToast } = useToast()
  const [d, setD] = useState<Draft>(() => fromNote(note))
  const [saving, setSaving] = useState(false)
  const [sharing, setSharing] = useState(false)
  const owner = note.access === 'owner'
  const canEdit = note.access !== 'view'
  const changed = JSON.stringify(fromNote(note)) !== JSON.stringify(d)

  async function save(close: boolean) {
    if (!changed || !canEdit) { if (close) onClose(); return }
    if (!hasWords(d)) { addToast({ type: 'error', message: 'A note needs some words. Delete it instead?' }); return }
    setSaving(true)
    try {
      const patch: NoteInput = { title: d.title, body: d.body, items: d.items?.filter((i) => i.text.trim()) ?? null, color: d.color, tags: d.tags, mentions: liveMentions(d, members) }
      if (owner) patch.remindAt = d.remindAt
      const r = await notesApi.update(note.id, patch)
      onSaved(r.note)
      if (close) onClose()
      else addToast({ type: 'success', message: 'Saved.' })
    } catch (e) { addToast({ type: 'error', message: errText(e, 'Could not save the note.') }) } finally { setSaving(false) }
  }
  async function share(next: { userId: string; canEdit: boolean }[]) {
    setSharing(true)
    try { const r = await notesApi.share(note.id, next); onSaved(r.note) } catch (e) { addToast({ type: 'error', message: errText(e, 'Could not change who it is shared with.') }) } finally { setSharing(false) }
  }
  async function quick(patch: NoteInput, msg: string) {
    try { const r = await notesApi.update(note.id, patch); onSaved(r.note); addToast({ type: 'success', message: msg }) } catch (e) { addToast({ type: 'error', message: errText(e, 'Could not save the note.') }) }
  }
  const copy = () => { void navigator.clipboard?.writeText(noteText({ ...note, ...d }).trim()).then(() => addToast({ type: 'success', message: 'Copied.' })).catch(() => undefined) }

  return (
    <Modal
      open
      onClose={() => void save(true)}
      size="lg"
      title={owner ? (note.archived ? 'Archived note' : 'Note') : `Note from ${note.owner.name}`}
      footer={
        <>
          <span className="mr-auto text-[12px] text-ink-muted">
            {note.editedBy ? `Edited by ${note.editedBy.name.split(' ')[0]} ${fmtAgo(note.updatedAt)}` : `Written ${fmtAgo(note.createdAt)}`}
            {!canEdit && ' · you can read it'}
          </span>
          <Button variant="secondary" onClick={onClose}>{canEdit && changed ? 'Discard' : 'Close'}</Button>
          {canEdit && <Button onClick={() => void save(true)} disabled={saving || !changed}>{saving ? 'Saving…' : 'Save'}</Button>}
        </>
      }
    >
      <div className={cn('-m-1 rounded-card border p-3', COLOR[d.color].card)}>
        <NoteFields d={d} setD={setD} people={people} members={members} canEdit={canEdit} onSubmit={() => void save(true)} />
        {!canEdit && d.tags.length > 0 && <div className="mt-2 flex flex-wrap gap-1 px-1">{d.tags.map((t) => <Chip key={t}>#{t}</Chip>)}</div>}
        <Toolbar d={d} setD={setD} people={people} owner={owner} canEdit={canEdit} />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {owner && <Button size="sm" variant="secondary" leadingIcon={note.pinned ? <PinOff size={14} /> : <Pin size={14} />} onClick={() => void quick({ pinned: !note.pinned }, note.pinned ? 'Unpinned.' : 'Pinned to the top.')}>{note.pinned ? 'Unpin' : 'Pin'}</Button>}
        {owner && <Button size="sm" variant="secondary" leadingIcon={note.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />} onClick={() => void quick({ archived: !note.archived }, note.archived ? 'Back in your notes.' : 'Archived.').then(onClose)}>{note.archived ? 'Take out of the archive' : 'Archive'}</Button>}
        <Button size="sm" variant="secondary" leadingIcon={<Copy size={14} />} onClick={copy}>Copy text</Button>
        <Button size="sm" variant="ghost" leadingIcon={owner ? <Trash2 size={14} /> : <UserMinus size={14} />} onClick={onRemove}>{owner ? 'Delete' : 'Take off my list'}</Button>
      </div>
      {owner ? (
        <div className="mt-4">
          <p className="text-body-sm font-semibold text-ink">Shared with</p>
          <p className="text-[12px] text-ink-muted">They see it under “Shared with me”. People who can edit change the words, the list, the colour and the tags.</p>
          <SharePicker people={people} shares={note.shares.map((s) => ({ userId: s.userId, canEdit: s.canEdit }))} onChange={(s) => void share(s)} busy={sharing} />
        </div>
      ) : note.shares.length > 0 && (
        <p className="mt-4 text-[12px] text-ink-muted">Also shared with {note.shares.map((s) => s.name.split(' ')[0]).join(', ')}.</p>
      )}
    </Modal>
  )
}
