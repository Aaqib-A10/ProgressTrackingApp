import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarPlus, Check, CircleSlash, HelpCircle, Link2, Pencil, Repeat, Sparkles, Users, Video, X, PlayCircle } from 'lucide-react'
import { meetingsApi, fmtRange, fmtDay, fmtTime, type Meeting, type MeetingCall } from '../../../lib/meetingsApi'
import { errMsg } from '../../../lib/projectsApi'
import { useAuth } from '../../../lib/auth'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { useToast } from '../../../components/ui/Toast'
import { PersonAvatar } from '../../../components/projects/pmUi'
import { ChatThread } from '../../../components/chat/ChatThread'
import { useCalls } from '../../../components/calls/CallProvider'
import { NotesModal } from '../../../components/calls/MeetingNotes'
import { MeetingFormModal } from '../../../components/meetings/MeetingFormModal'
import { ResponseChip } from './CalendarPage'
import { cn } from '../../../lib/cn'

const API = import.meta.env.VITE_API_URL ?? '/api'

/** /app/meetings/:id — the meeting link: details, RSVP, join, chat, notes and recordings. */
export default function MeetingPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const calls = useCalls()
  const { addToast } = useToast()
  const [data, setData] = useState<{ meeting: Meeting; isAttendee: boolean; calls: MeetingCall[]; series: { id: string; startsAt: string }[] } | null>(null)
  const [missing, setMissing] = useState(false)
  const [editing, setEditing] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [notesFor, setNotesFor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    meetingsApi.get(id).then((r) => { setData(r); setMissing(false) }).catch((e) => { if (/404|not found/i.test(errMsg(e))) setMissing(true); else addToast({ type: 'error', message: errMsg(e) }) })
  }, [id, addToast])
  useEffect(() => { setData(null); load() }, [load])
  useEffect(() => { const t = window.setInterval(load, 15_000); return () => window.clearInterval(t) }, [load])

  if (missing) return <div className="py-20 text-center text-body-md text-ink-muted">This meeting does not exist or was removed. <Link to="/app/calendar" className="font-semibold text-primary">Open your calendar</Link></div>
  if (!data) return <div className="h-80 animate-pulse rounded-card bg-slate-100" />
  const m = data.meeting
  const now = Date.now()
  const startsIn = new Date(m.startsAt).getTime() - now
  const over = new Date(m.endsAt).getTime() < now
  const inThisCall = !!calls?.call && calls.call.conversationId === m.conversationId

  async function joinCall() {
    if (!calls) return
    setBusy(true)
    try {
      if (!data!.isAttendee) await meetingsApi.join(m.id)
      if (m.live) await calls.joinCall(m.live.callId, m.conversationId, m.live.video)
      else await calls.startCall(m.conversationId, true)
      load()
    } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not join') }) } finally { setBusy(false) }
  }

  async function respond(r: 'ACCEPTED' | 'TENTATIVE' | 'DECLINED', series: boolean) {
    try {
      await meetingsApi.respond(m.id, r, series)
      load()
    } catch (e) { addToast({ type: 'error', message: errMsg(e) }) }
  }

  const copyLink = () => { void navigator.clipboard.writeText(m.link).then(() => addToast({ type: 'success', message: 'Meeting link copied. Paste it in a chat or email.' })) }
  const going = m.attendees.filter((a) => a.response === 'ACCEPTED').length

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <button type="button" onClick={() => navigate('/app/calendar')} className="inline-flex items-center gap-1 text-body-sm font-semibold text-ink-muted hover:text-ink"><ArrowLeft size={15} /> Calendar</button>

      {m.cancelled && <div className="rounded-card bg-danger/10 px-4 py-3 text-body-md font-semibold text-danger">This meeting was cancelled.</div>}

      <div className="rounded-card border border-line bg-card p-5 shadow-card">
        <div className="flex flex-wrap items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-card text-white" style={{ backgroundColor: m.project?.color ?? '#4F46E5' }}><Video size={22} /></span>
          <div className="min-w-0 flex-1">
            <h1 className="text-headline-md text-ink">{m.title}</h1>
            <p className="mt-0.5 text-body-md text-ink">{fmtRange(m.startsAt, m.endsAt)}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-body-sm text-ink-muted">
              <span>Organizer: <b className="text-ink">{m.organizer.name}</b></span>
              {m.seriesId && <span className="inline-flex items-center gap-1"><Repeat size={13} /> Repeats {m.repeat === 'weekly' ? 'weekly' : m.repeat === 'weekdays' ? 'every weekday' : 'daily'}</span>}
              {m.project && <Link to={`/app/projects/${m.project.key}`} className="inline-flex items-center gap-1 font-semibold text-primary"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: m.project.color }} />{m.project.name}</Link>}
              <span className="inline-flex items-center gap-1"><Users size={13} /> {m.attendees.length + 1} invited · {going + 1} going</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!m.cancelled && (
              inThisCall
                ? <Button onClick={() => calls?.setMinimized(false)} leadingIcon={<Video size={16} />}>Back to the meeting</Button>
                : <Button onClick={joinCall} disabled={busy} leadingIcon={<Video size={16} />} className={m.live ? 'bg-success hover:bg-success/90' : undefined}>
                    {busy ? 'Joining…' : m.live ? `Join now (${m.live.participants.length} in the call)` : over ? 'Start a call' : startsIn > 15 * 60_000 ? 'Start early' : 'Start the meeting'}
                  </Button>
            )}
            <Button variant="secondary" onClick={copyLink} leadingIcon={<Link2 size={16} />}>Copy link</Button>
            <a href={meetingsApi.icsUrl(m.id)} className="inline-flex h-10 items-center gap-1.5 rounded-btn border border-line bg-card px-3 text-body-md font-semibold text-ink hover:bg-slate-50" title="Add to Outlook or Google Calendar"><CalendarPlus size={16} /> Add to calendar</a>
            {m.isOrganizer && !m.cancelled && (
              <>
                <Button variant="secondary" onClick={() => setEditing(true)} leadingIcon={<Pencil size={15} />}>Edit</Button>
                <Button variant="secondary" onClick={() => setCancelling(true)} leadingIcon={<CircleSlash size={15} />} className="text-danger">Cancel meeting</Button>
              </>
            )}
          </div>
        </div>

        {!data.isAttendee && !m.cancelled && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-btn bg-primary/5 px-4 py-3 text-body-md">
            <span className="flex-1 text-ink">You were sent a link to this meeting. Join it to get the chat, reminders and notes.</span>
            <Button size="sm" onClick={async () => { try { await meetingsApi.join(m.id); load() } catch (e) { addToast({ type: 'error', message: errMsg(e) }) } }}>Add me to this meeting</Button>
          </div>
        )}

        {data.isAttendee && !m.isOrganizer && !m.cancelled && !over && (
          <Rsvp meeting={m} onRespond={respond} />
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <section className="rounded-card border border-line bg-card p-5">
            <h2 className="mb-2 text-body-lg font-semibold text-ink">Agenda</h2>
            {m.agenda ? <p className="whitespace-pre-wrap text-body-md leading-relaxed text-ink">{m.agenda}</p> : <p className="text-body-md text-ink-muted">No agenda yet.{m.isOrganizer ? ' Use Edit to add one.' : ''}</p>}
          </section>

          {data.isAttendee && (
            <section className="rounded-card border border-line bg-card p-5">
              <h2 className="mb-1 flex items-center gap-1.5 text-body-lg font-semibold text-ink"><Sparkles size={17} className="text-primary" /> Notes and recordings</h2>
              <p className="mb-3 text-body-sm text-ink-muted">{m.autoNotes ? 'AI notes start by themselves when this meeting starts.' : 'Turn on AI notes in the call (sparkle button) to get a summary, decisions and action items here.'}</p>
              {data.calls.length === 0 ? <p className="text-body-md text-ink-muted">Nothing yet. They show up here after the meeting.</p> : (
                <ul className="space-y-3">
                  {data.calls.map((c) => (
                    <li key={c.id} className="rounded-btn border border-line p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-body-md font-semibold text-ink">{fmtDay(new Date(c.startedAt))}, {fmtTime(new Date(c.startedAt))}</span>
                        <span className="text-body-sm text-ink-muted">{c.durationSec != null ? `${Math.max(1, Math.round(c.durationSec / 60))} min · ` : 'In progress · '}{c.joinedCount} joined</span>
                        {c.notes && (
                          <button type="button" onClick={() => setNotesFor(c.id)} className="ml-auto inline-flex items-center gap-1.5 rounded-btn bg-primary/10 px-2.5 py-1 text-body-sm font-semibold text-primary hover:bg-primary/15">
                            <Sparkles size={14} /> {c.notes === 'ready' ? 'Open notes' : c.notes === 'pending' ? 'Notes being written…' : 'Open transcript'}
                          </button>
                        )}
                      </div>
                      {c.recordings.map((r) => r.url && (
                        <div key={r.id} className="mt-2">
                          <video controls preload="metadata" src={`${API}${r.url.replace(/^\/api/, '')}?inline=1`} className="max-h-80 w-full rounded-btn border border-line bg-black object-contain" />
                          <a href={`${API}${r.url.replace(/^\/api/, '')}`} className="mt-1 inline-flex items-center gap-1 text-[12px] text-ink-muted hover:text-ink"><PlayCircle size={12} /> Download recording</a>
                        </div>
                      ))}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {data.series.length > 1 && (
            <section className="rounded-card border border-line bg-card p-5">
              <h2 className="mb-2 text-body-lg font-semibold text-ink">All dates in this series</h2>
              <div className="flex flex-wrap gap-1.5">
                {data.series.map((s) => (
                  <Link key={s.id} to={`/app/meetings/${s.id}`} className={cn('rounded-full border px-2.5 py-1 text-body-sm', s.id === m.id ? 'border-primary bg-primary/10 font-semibold text-primary' : 'border-line text-ink-muted hover:bg-slate-50')}>{fmtDay(new Date(s.startsAt))}</Link>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-5">
          <section className="rounded-card border border-line bg-card p-4">
            <h2 className="mb-2 text-body-lg font-semibold text-ink">People</h2>
            <ul className="space-y-2">
              <li className="flex items-center gap-2 text-body-md"><PersonAvatar person={m.organizer} size={30} presence={m.organizer.presence} /><span className="flex-1 truncate font-medium text-ink">{m.organizer.name}{m.organizer.id === user?.id ? ' (you)' : ''}</span><span className="text-[12px] font-semibold text-primary">Organizer</span></li>
              {m.attendees.map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-body-md">
                  <PersonAvatar person={a} size={30} presence={a.presence} />
                  <span className="flex-1 truncate font-medium text-ink">{a.name}{a.id === user?.id ? ' (you)' : ''}</span>
                  <ResponseChip r={a.response} />
                </li>
              ))}
            </ul>
          </section>
          {data.isAttendee && (
            <section className="h-[520px] overflow-hidden rounded-card border border-line bg-card">
              <ChatThread conversationId={m.conversationId} meId={user?.id ?? ''} compact hideCallButtons />
            </section>
          )}
        </div>
      </div>

      {editing && <MeetingFormModal meeting={m} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load() }} />}
      {cancelling && <CancelModal meeting={m} onClose={() => setCancelling(false)} onDone={() => { setCancelling(false); load() }} />}
      {notesFor && <NotesModal callId={notesFor} title={`Notes: ${m.title}`} onClose={() => setNotesFor(null)} />}
    </div>
  )
}

function Rsvp({ meeting, onRespond }: { meeting: Meeting; onRespond: (r: 'ACCEPTED' | 'TENTATIVE' | 'DECLINED', series: boolean) => void }) {
  const [series, setSeries] = useState(false)
  const r = meeting.myResponse
  const btn = (value: 'ACCEPTED' | 'TENTATIVE' | 'DECLINED', label: string, icon: React.ReactNode, on: string) => (
    <button type="button" onClick={() => onRespond(value, series)} className={cn('inline-flex items-center gap-1.5 rounded-btn border px-3 py-1.5 text-body-sm font-semibold', r === value ? on : 'border-line text-ink hover:bg-slate-50')}>{icon}{label}</button>
  )
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
      <span className="mr-1 text-body-sm font-semibold text-ink">Are you going?</span>
      {btn('ACCEPTED', 'Yes', <Check size={14} />, 'border-success bg-success/10 text-success')}
      {btn('TENTATIVE', 'Maybe', <HelpCircle size={14} />, 'border-warning bg-warning/10 text-amber-700')}
      {btn('DECLINED', 'No', <X size={14} />, 'border-danger bg-danger/10 text-danger')}
      {meeting.seriesId && <label className="ml-2 inline-flex items-center gap-1.5 text-body-sm text-ink-muted"><input type="checkbox" checked={series} onChange={(e) => setSeries(e.target.checked)} /> Answer for all the rest of the series</label>}
    </div>
  )
}

function CancelModal({ meeting, onClose, onDone }: { meeting: Meeting; onClose: () => void; onDone: () => void }) {
  const { addToast } = useToast()
  const [series, setSeries] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <Modal open onClose={onClose} title="Cancel this meeting?" size="sm" footer={<><Button variant="secondary" onClick={onClose}>Keep it</Button><Button className="bg-danger hover:bg-danger/90" disabled={busy} onClick={async () => { setBusy(true); try { const r = await meetingsApi.cancel(meeting.id, series); addToast({ type: 'success', message: `${r.cancelled === 1 ? 'Meeting' : `${r.cancelled} meetings`} cancelled. Everyone has been told.` }); onDone() } catch (e) { addToast({ type: 'error', message: errMsg(e) }) } finally { setBusy(false) } }}>Cancel meeting</Button></>}>
      <p className="text-body-md text-ink">Everyone invited gets a notification and an email.</p>
      {meeting.seriesId && (
        <div className="mt-3 space-y-1 text-body-sm">
          <label className="flex items-center gap-2"><input type="radio" checked={!series} onChange={() => setSeries(false)} /> Only this one ({fmtDay(new Date(meeting.startsAt))})</label>
          <label className="flex items-center gap-2"><input type="radio" checked={series} onChange={() => setSeries(true)} /> This and all after it</label>
        </div>
      )}
    </Modal>
  )
}
