import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, Repeat, Search, Sparkles, Users, X } from 'lucide-react'
import { chatApi, type ChatUser } from '../../lib/chatApi'
import { meetingsApi, type Meeting, type RepeatKind } from '../../lib/meetingsApi'
import { projectsApi, errMsg, type ProjectListItem } from '../../lib/projectsApi'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { TextArea, TextField } from '../ui/Input'
import { PersonAvatar } from '../projects/pmUi'
import { useToast } from '../ui/Toast'

const pad = (n: number) => String(n).padStart(2, '0')
const toDateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const toTimeInput = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const fromInputs = (date: string, time: string) => new Date(`${date}T${time}:00`)

/** Next half hour from now (default start). */
function nextSlot(): Date {
  const d = new Date()
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60)
  return d
}

const DURATIONS = [15, 30, 45, 60, 90]

/** Schedule a new meeting, or change one (organizer). */
export function MeetingFormModal({ meeting, initialStart, initialAttendees, onClose, onSaved }: {
  meeting?: Meeting
  initialStart?: Date
  initialAttendees?: string[]
  onClose: () => void
  onSaved: (m: Meeting) => void
}) {
  const { addToast } = useToast()
  const start0 = meeting ? new Date(meeting.startsAt) : initialStart ?? nextSlot()
  const end0 = meeting ? new Date(meeting.endsAt) : new Date(start0.getTime() + 30 * 60_000)
  const [title, setTitle] = useState(meeting?.title ?? '')
  const [agenda, setAgenda] = useState(meeting?.agenda ?? '')
  const [date, setDate] = useState(toDateInput(start0))
  const [startT, setStartT] = useState(toTimeInput(start0))
  const [endT, setEndT] = useState(toTimeInput(end0))
  const [people, setPeople] = useState<string[]>(meeting ? meeting.attendees.map((a) => a.id) : initialAttendees ?? [])
  const [repeat, setRepeat] = useState<RepeatKind>('none')
  const [count, setCount] = useState(4)
  const [projectKey, setProjectKey] = useState<string>(meeting?.project?.key ?? '')
  const [series, setSeries] = useState(false)
  const [autoNotes, setAutoNotes] = useState(meeting?.autoNotes ?? true)
  const [users, setUsers] = useState<ChatUser[]>([])
  const [projects, setProjects] = useState<ProjectListItem[]>([])
  const [q, setQ] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    chatApi.users().then((r) => setUsers(r.users)).catch(() => undefined)
    projectsApi.list().then((r) => setProjects(r.projects)).catch(() => undefined)
  }, [])

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return []
    return users.filter((u) => !people.includes(u.id) && (u.name.toLowerCase().includes(t) || (u.department ?? '').toLowerCase().includes(t) || u.email.toLowerCase().includes(t))).slice(0, 8)
  }, [q, users, people])
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? meeting?.attendees.find((a) => a.id === id)?.name ?? '…'

  const startsAt = fromInputs(date, startT)
  let endsAt = fromInputs(date, endT)
  if (endsAt <= startsAt) endsAt = new Date(endsAt.getTime() + 86400_000) // ends after midnight
  const minutes = Math.round((endsAt.getTime() - startsAt.getTime()) / 60000)

  function setDuration(min: number) {
    setEndT(toTimeInput(new Date(startsAt.getTime() + min * 60_000)))
  }
  function changeStart(v: string) {
    // Keep the same length when the start moves.
    const dur = minutes
    setStartT(v)
    const s = fromInputs(date, v)
    setEndT(toTimeInput(new Date(s.getTime() + dur * 60_000)))
  }

  async function save() {
    setError(null)
    if (!title.trim()) { setError('Give the meeting a title'); return }
    if (Number.isNaN(startsAt.getTime())) { setError('Pick a date and time'); return }
    if (minutes > 12 * 60) { setError('Meetings can be at most 12 hours long'); return }
    setSaving(true)
    try {
      if (meeting) {
        const r = await meetingsApi.update(meeting.id, { title: title.trim(), agenda, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), attendeeIds: people, series, autoNotes })
        addToast({ type: 'success', message: 'Meeting updated. Everyone has been told.' })
        onSaved(r.meeting)
      } else {
        const r = await meetingsApi.create({ title: title.trim(), agenda, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), attendeeIds: people, projectKey: projectKey || null, repeat, repeatCount: repeat === 'none' ? 1 : count, autoNotes })
        addToast({ type: 'success', message: people.length ? `Meeting scheduled. ${people.length} ${people.length === 1 ? 'person has' : 'people have'} been invited.` : 'Meeting scheduled.' })
        onSaved(r.meeting)
      }
    } catch (e) {
      setError(errMsg(e, 'Could not save the meeting'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={meeting ? 'Edit meeting' : 'New meeting'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : meeting ? 'Save and notify' : 'Schedule and invite'}</Button></>}
    >
      <div className="space-y-4">
        <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. RTI weekly sync" maxLength={120} autoFocus />

        <div>
          <span className="mb-1 flex items-center gap-1.5 text-body-sm font-semibold text-ink"><Users size={14} /> People</span>
          <div className="rounded-btn border border-line p-2 focus-within:border-primary">
            <div className="flex flex-wrap gap-1.5">
              {people.map((id) => (
                <span key={id} className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-0.5 pl-0.5 pr-2 text-body-sm text-primary">
                  <PersonAvatar person={{ id, name: nameOf(id) }} size={20} /> {nameOf(id)}
                  <button type="button" onClick={() => setPeople((p) => p.filter((x) => x !== id))} aria-label={`Remove ${nameOf(id)}`}><X size={13} /></button>
                </span>
              ))}
              <label className="flex min-w-[180px] flex-1 items-center gap-1.5 px-1">
                <Search size={14} className="text-ink-muted" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={people.length ? 'Add more people' : 'Search people to invite'} className="min-w-0 flex-1 bg-transparent py-1 text-body-md focus:outline-none" aria-label="Search people to invite" />
              </label>
            </div>
            {matches.length > 0 && (
              <ul className="mt-2 max-h-48 overflow-y-auto border-t border-line pt-1">
                {matches.map((u) => (
                  <li key={u.id}>
                    <button type="button" onClick={() => { setPeople((p) => [...p, u.id]); setQ('') }} className="flex w-full items-center gap-2 rounded-btn px-2 py-1.5 text-left text-body-sm hover:bg-slate-50">
                      <PersonAvatar person={u} size={24} presence={u.presence} />
                      <span className="font-medium text-ink">{u.name}</span>
                      {u.department && <span className="text-ink-muted">· {u.department}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <TextField label="Starts" type="time" value={startT} onChange={(e) => changeStart(e.target.value)} />
          <TextField label="Ends" type="time" value={endT} onChange={(e) => setEndT(e.target.value)} />
        </div>
        <div className="-mt-2 flex flex-wrap items-center gap-1.5 text-body-sm">
          <span className="text-ink-muted">Length:</span>
          {DURATIONS.map((d) => (
            <button key={d} type="button" onClick={() => setDuration(d)} className={`rounded-full border px-2.5 py-0.5 ${minutes === d ? 'border-primary bg-primary/10 font-semibold text-primary' : 'border-line text-ink-muted hover:bg-slate-50'}`}>{d < 60 ? `${d} min` : d === 60 ? '1 hour' : '1.5 hours'}</button>
          ))}
          {!DURATIONS.includes(minutes) && minutes > 0 && <span className="text-ink-muted">({minutes} min)</span>}
        </div>

        {!meeting ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 flex items-center gap-1.5 text-body-sm font-semibold text-ink"><Repeat size={14} /> Repeat</span>
              <div className="flex gap-2">
                <select value={repeat} onChange={(e) => setRepeat(e.target.value as RepeatKind)} className="h-10 flex-1 rounded-btn border border-line bg-card px-2 text-body-md">
                  <option value="none">Does not repeat</option>
                  <option value="daily">Every day</option>
                  <option value="weekdays">Every weekday (Mon to Fri)</option>
                  <option value="weekly">Every week</option>
                </select>
                {repeat !== 'none' && (
                  <select value={count} onChange={(e) => setCount(Number(e.target.value))} className="h-10 w-28 rounded-btn border border-line bg-card px-2 text-body-md" aria-label="How many times">
                    {[2, 3, 4, 5, 6, 8, 10, 12, 20, 26, 52].map((n) => <option key={n} value={n}>{n} times</option>)}
                  </select>
                )}
              </div>
            </label>
            <label className="block">
              <span className="mb-1 flex items-center gap-1.5 text-body-sm font-semibold text-ink"><CalendarDays size={14} /> Project (optional)</span>
              <select value={projectKey} onChange={(e) => setProjectKey(e.target.value)} className="h-10 w-full rounded-btn border border-line bg-card px-2 text-body-md">
                <option value="">No project</option>
                {projects.map((p) => <option key={p.id} value={p.key}>{p.name}</option>)}
              </select>
            </label>
          </div>
        ) : meeting.seriesId ? (
          <div className="rounded-btn bg-slate-50 p-3 text-body-sm">
            <p className="mb-1.5 font-semibold text-ink">This meeting repeats. Change:</p>
            <label className="mr-4 inline-flex items-center gap-1.5"><input type="radio" checked={!series} onChange={() => setSeries(false)} /> Only this one</label>
            <label className="inline-flex items-center gap-1.5"><input type="radio" checked={series} onChange={() => setSeries(true)} /> This and all after it</label>
          </div>
        ) : null}

        <label className="flex items-start gap-2.5 rounded-btn border border-line p-3 text-body-sm">
          <input type="checkbox" checked={autoNotes} onChange={(e) => setAutoNotes(e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
          <span><span className="flex items-center gap-1.5 font-semibold text-ink"><Sparkles size={14} className="text-primary" /> Take AI notes automatically</span><span className="text-ink-muted">When the meeting starts, the note taker turns on by itself. Afterwards everyone gets the summary, decisions and action items in the meeting chat.</span></span>
        </label>

        <TextArea label="Agenda (optional)" value={agenda} onChange={(e) => setAgenda(e.target.value)} rows={4} maxLength={5000} placeholder={'What do you want to cover?\n1. …\n2. …'} />
        {error && <p className="rounded-btn bg-danger/10 px-3 py-2 text-body-sm text-danger">{error}</p>}
      </div>
    </Modal>
  )
}
