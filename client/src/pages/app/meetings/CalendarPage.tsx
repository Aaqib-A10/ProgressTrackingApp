import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Repeat, Video } from 'lucide-react'
import { meetingsApi, fmtTime, type Meeting } from '../../../lib/meetingsApi'
import { errMsg } from '../../../lib/projectsApi'
import { Button } from '../../../components/ui/Button'
import { useToast } from '../../../components/ui/Toast'
import { useCalls } from '../../../components/calls/CallProvider'
import { MeetingFormModal } from '../../../components/meetings/MeetingFormModal'
import { cn } from '../../../lib/cn'

type View = 'week' | 'month' | 'list'
const HOUR_PX = 48
const DAY_MS = 86400_000

const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
/** Monday of that week. */
const startOfWeek = (d: Date) => { const x = startOfDay(d); const wd = (x.getDay() + 6) % 7; return addDays(x, -wd) }
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()

function rangeFor(view: View, anchor: Date): [Date, Date] {
  if (view === 'week') { const s = startOfWeek(anchor); return [s, addDays(s, 7)] }
  if (view === 'month') { const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1); const s = startOfWeek(first); return [s, addDays(s, 42)] }
  const s = startOfDay(new Date()); return [s, addDays(s, 60)]
}

function color(m: Meeting): string {
  return m.project?.color ?? '#4F46E5'
}

/** /app/calendar — my meetings: week, month or upcoming list; schedule or "Meet now". */
export default function CalendarPage() {
  const navigate = useNavigate()
  const calls = useCalls()
  const { addToast } = useToast()
  const [view, setView] = useState<View>(() => { try { return (localStorage.getItem('pt-cal-view') as View) || 'week' } catch { return 'week' } })
  const [anchor, setAnchor] = useState(() => new Date())
  const [meetings, setMeetings] = useState<Meeting[] | null>(null)
  const [creating, setCreating] = useState<{ start?: Date } | null>(null)
  const [starting, setStarting] = useState(false)
  const [from, to] = rangeFor(view, anchor)

  const load = useCallback(() => {
    meetingsApi.list(from, to).then((r) => setMeetings(r.meetings)).catch((e) => addToast({ type: 'error', message: errMsg(e, 'Could not load your calendar') }))
  }, [from.getTime(), to.getTime()]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setMeetings(null); load() }, [load])
  useEffect(() => { const t = window.setInterval(load, 60_000); return () => window.clearInterval(t) }, [load])
  useEffect(() => { try { localStorage.setItem('pt-cal-view', view) } catch { /* ignore */ } }, [view])

  function step(dir: number) {
    if (view === 'week') setAnchor((a) => addDays(a, 7 * dir))
    else if (view === 'month') setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + dir, 1))
  }

  async function meetNow() {
    if (!calls) return
    setStarting(true)
    try {
      const s = new Date()
      const r = await meetingsApi.create({ title: 'Meet now', agenda: '', startsAt: s.toISOString(), endsAt: new Date(s.getTime() + 60 * 60_000).toISOString(), attendeeIds: [] })
      await calls.startCall(r.meeting.conversationId, true)
      calls.setPanel('people')
      load()
    } catch (e) {
      addToast({ type: 'error', message: errMsg(e, 'Could not start the meeting') })
    } finally { setStarting(false) }
  }

  const label = view === 'week'
    ? `${from.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} to ${addDays(to, -1).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
    : view === 'month' ? anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : 'Next 60 days'

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="flex items-center gap-2 text-headline-lg text-ink"><CalendarDays size={24} className="text-primary" /> Calendar</h1>
          <p className="text-body-md text-ink-muted">Your meetings. Invite people and they get a notification and a reminder 10 minutes before.</p>
        </div>
        <Button variant="secondary" leadingIcon={<Video size={16} />} onClick={meetNow} disabled={starting || !calls}>{starting ? 'Starting…' : 'Meet now'}</Button>
        <Button leadingIcon={<Plus size={16} />} onClick={() => setCreating({})}>New meeting</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {view !== 'list' && (
          <>
            <Button variant="secondary" size="sm" onClick={() => setAnchor(new Date())}>Today</Button>
            <button type="button" onClick={() => step(-1)} className="rounded-btn p-1.5 text-ink-muted hover:bg-slate-100" aria-label="Previous"><ChevronLeft size={18} /></button>
            <button type="button" onClick={() => step(1)} className="rounded-btn p-1.5 text-ink-muted hover:bg-slate-100" aria-label="Next"><ChevronRight size={18} /></button>
          </>
        )}
        <span className="text-body-lg font-semibold text-ink">{label}</span>
        <div className="ml-auto inline-flex rounded-btn border border-line bg-card p-0.5">
          {(['week', 'month', 'list'] as View[]).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)} className={cn('rounded-[6px] px-3 py-1 text-body-sm font-semibold capitalize', view === v ? 'bg-primary text-white' : 'text-ink-muted hover:text-ink')}>{v}</button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {meetings === null ? <div className="h-96 animate-pulse rounded-card bg-slate-100" /> : view === 'week' ? (
          <WeekView start={from} meetings={meetings} onOpen={(m) => navigate(`/app/meetings/${m.id}`)} onSlot={(d) => setCreating({ start: d })} />
        ) : view === 'month' ? (
          <MonthView start={from} month={anchor.getMonth()} meetings={meetings} onOpen={(m) => navigate(`/app/meetings/${m.id}`)} onDay={(d) => { setAnchor(d); setView('week') }} />
        ) : (
          <ListView meetings={meetings} onOpen={(m) => navigate(`/app/meetings/${m.id}`)} />
        )}
      </div>

      {creating && (
        <MeetingFormModal
          initialStart={creating.start}
          onClose={() => setCreating(null)}
          onSaved={(m) => { setCreating(null); navigate(`/app/meetings/${m.id}`) }}
        />
      )}
    </div>
  )
}

// ---------- week ----------

interface Placed { m: Meeting; top: number; height: number; col: number; cols: number }

/** Side-by-side layout for meetings that overlap on the same day. */
function layoutDay(list: Meeting[], dayStart: Date): Placed[] {
  const items = list
    .map((m) => {
      const s = Math.max(new Date(m.startsAt).getTime(), dayStart.getTime())
      const e = Math.min(new Date(m.endsAt).getTime(), dayStart.getTime() + DAY_MS)
      return { m, s, e }
    })
    .filter((x) => x.e > x.s)
    .sort((a, b) => a.s - b.s || b.e - a.e)
  const out: Placed[] = []
  let cluster: { m: Meeting; s: number; e: number; col: number }[] = []
  let clusterEnd = 0
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((c) => c.col + 1))
    for (const c of cluster) out.push({ m: c.m, top: ((c.s - dayStart.getTime()) / 3600_000) * HOUR_PX, height: Math.max(20, ((c.e - c.s) / 3600_000) * HOUR_PX - 2), col: c.col, cols })
    cluster = []
  }
  for (const it of items) {
    if (cluster.length && it.s >= clusterEnd) flush()
    const used = new Set(cluster.filter((c) => c.e > it.s).map((c) => c.col))
    let col = 0
    while (used.has(col)) col++
    cluster.push({ ...it, col })
    clusterEnd = Math.max(clusterEnd, it.e)
  }
  if (cluster.length) flush()
  return out
}

function WeekView({ start, meetings, onOpen, onSlot }: { start: Date; meetings: Meeting[]; onOpen: (m: Meeting) => void; onSlot: (d: Date) => void }) {
  const scroller = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState(new Date())
  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), 60_000); return () => window.clearInterval(t) }, [])
  // Open at 8 AM, or earlier if a meeting this week starts earlier (or it is earlier now).
  useEffect(() => {
    if (!scroller.current) return
    const hours = meetings.map((m) => { const d = new Date(m.startsAt); return d.getHours() + d.getMinutes() / 60 })
    const nowH = days.some((d) => sameDay(d, now)) ? now.getHours() : 24
    const first = Math.min(8, nowH, ...hours)
    scroller.current.scrollTop = Math.max(0, first - 0.5) * HOUR_PX
  }, [start.getTime(), meetings.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  const byDay = useMemo(() => days.map((d) => layoutDay(meetings, d)), [meetings, start.getTime()]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-[calc(100vh-17rem)] min-h-[420px] flex-col overflow-hidden rounded-card border border-line bg-card">
      <div className="grid shrink-0 grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b border-line">
        <div />
        {days.map((d) => (
          <div key={d.toISOString()} className={cn('px-2 py-2 text-center', sameDay(d, now) && 'text-primary')}>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{d.toLocaleDateString(undefined, { weekday: 'short' })}</div>
            <div className={cn('mx-auto mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-body-md font-semibold', sameDay(d, now) ? 'bg-primary text-white' : 'text-ink')}>{d.getDate()}</div>
          </div>
        ))}
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className="relative grid grid-cols-[56px_repeat(7,minmax(0,1fr))]" style={{ height: 24 * HOUR_PX }}>
          <div className="relative">
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="absolute right-2 -translate-y-1/2 text-[11px] text-ink-muted" style={{ top: h * HOUR_PX }}>{h === 0 ? '' : new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' })}</span>
            ))}
          </div>
          {days.map((d, di) => (
            <div key={d.toISOString()} className="relative border-l border-line">
              {Array.from({ length: 24 }, (_, h) => (
                <button
                  key={h}
                  type="button"
                  onClick={(e) => {
                    const half = (e.nativeEvent.offsetY > HOUR_PX / 2 ? 30 : 0)
                    const t = new Date(d); t.setHours(h, half, 0, 0); onSlot(t)
                  }}
                  className="absolute inset-x-0 border-t border-line/70 hover:bg-primary/5"
                  style={{ top: h * HOUR_PX, height: HOUR_PX }}
                  aria-label={`New meeting ${d.toLocaleDateString()} ${h}:00`}
                />
              ))}
              {sameDay(d, now) && <div className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-danger" style={{ top: ((now.getTime() - startOfDay(now).getTime()) / 3600_000) * HOUR_PX }}><span className="absolute -left-1 -top-1 h-2.5 w-2.5 rounded-full bg-danger" /></div>}
              {byDay[di].map((p) => (
                <button
                  key={p.m.id}
                  type="button"
                  onClick={() => onOpen(p.m)}
                  className={cn('absolute z-[5] overflow-hidden rounded-[6px] border-l-[3px] px-1.5 py-0.5 text-left text-[12px] leading-tight shadow-sm hover:z-20 hover:shadow-card', p.m.myResponse === 'DECLINED' && 'opacity-50 line-through', p.m.myResponse === 'PENDING' && 'border-dashed')}
                  style={{ top: p.top, height: p.height, left: `calc(${(p.col / p.cols) * 100}% + 2px)`, width: `calc(${100 / p.cols}% - 4px)`, borderLeftColor: color(p.m), backgroundColor: `${color(p.m)}1A` }}
                  title={`${p.m.title} · ${fmtTime(new Date(p.m.startsAt))} to ${fmtTime(new Date(p.m.endsAt))}`}
                >
                  <span className="block truncate font-semibold text-ink">{p.m.live && <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-success align-middle" />}{p.m.title}</span>
                  {p.height > 34 && <span className="block truncate text-ink-muted">{fmtTime(new Date(p.m.startsAt))} · {p.m.organizer.name.split(' ')[0]}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------- month ----------

function MonthView({ start, month, meetings, onOpen, onDay }: { start: Date; month: number; meetings: Meeting[]; onOpen: (m: Meeting) => void; onDay: (d: Date) => void }) {
  const today = new Date()
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i))
  return (
    <div className="overflow-hidden rounded-card border border-line bg-card">
      <div className="grid grid-cols-7 border-b border-line">
        {days.slice(0, 7).map((d) => <div key={d.toISOString()} className="px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{d.toLocaleDateString(undefined, { weekday: 'short' })}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const list = meetings.filter((m) => sameDay(new Date(m.startsAt), d))
          return (
            <div key={d.toISOString()} className={cn('min-h-[104px] border-b border-r border-line p-1', d.getMonth() !== month && 'bg-slate-50/60')}>
              <button type="button" onClick={() => onDay(d)} className={cn('mb-0.5 flex h-6 w-6 items-center justify-center rounded-full text-body-sm font-semibold', sameDay(d, today) ? 'bg-primary text-white' : d.getMonth() === month ? 'text-ink hover:bg-slate-100' : 'text-ink-muted')}>{d.getDate()}</button>
              {list.slice(0, 3).map((m) => (
                <button key={m.id} type="button" onClick={() => onOpen(m)} className={cn('mb-0.5 flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px] hover:bg-slate-100', m.myResponse === 'DECLINED' && 'line-through opacity-50')}>
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color(m) }} />
                  <span className="text-ink-muted">{fmtTime(new Date(m.startsAt))}</span>
                  <span className="truncate font-medium text-ink">{m.title}</span>
                </button>
              ))}
              {list.length > 3 && <button type="button" onClick={() => onDay(d)} className="px-1 text-[11px] font-semibold text-primary">+{list.length - 3} more</button>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------- list ----------

function ListView({ meetings, onOpen }: { meetings: Meeting[]; onOpen: (m: Meeting) => void }) {
  const upcoming = meetings.filter((m) => new Date(m.endsAt).getTime() > Date.now())
  if (!upcoming.length) return <div className="rounded-card border border-dashed border-line bg-card py-16 text-center text-body-md text-ink-muted">No upcoming meetings. Use New meeting to schedule one.</div>
  const groups = new Map<string, Meeting[]>()
  for (const m of upcoming) { const k = startOfDay(new Date(m.startsAt)).toISOString(); groups.set(k, [...(groups.get(k) ?? []), m]) }
  return (
    <div className="space-y-4">
      {[...groups].map(([k, list]) => (
        <section key={k}>
          <h2 className="mb-1.5 text-body-sm font-semibold uppercase tracking-wide text-ink-muted">{sameDay(new Date(k), new Date()) ? 'Today' : new Date(k).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
          <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-card">
            {list.map((m) => (
              <button key={m.id} type="button" onClick={() => onOpen(m)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
                <span className="h-10 w-1 shrink-0 rounded-full" style={{ backgroundColor: color(m) }} />
                <span className="w-32 shrink-0 text-body-sm text-ink-muted">{fmtTime(new Date(m.startsAt))} to {fmtTime(new Date(m.endsAt))}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 truncate text-body-md font-semibold text-ink">{m.title}{m.seriesId && <Repeat size={13} className="text-ink-muted" />}</span>
                  <span className="block truncate text-body-sm text-ink-muted">{m.organizer.name} · {m.attendees.length + 1} people{m.project ? ` · ${m.project.name}` : ''}</span>
                </span>
                {m.live ? <span className="rounded-full bg-success px-2.5 py-1 text-[12px] font-semibold text-white">Live now</span> : <ResponseChip r={m.myResponse} />}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

export function ResponseChip({ r }: { r: Meeting['myResponse'] }) {
  if (!r || r === 'ORGANIZER') return r === 'ORGANIZER' ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[12px] font-semibold text-primary">Organizer</span> : null
  const map = { PENDING: ['Not answered', 'bg-slate-100 text-ink-muted'], ACCEPTED: ['Going', 'bg-success/15 text-success'], TENTATIVE: ['Maybe', 'bg-warning/15 text-amber-700'], DECLINED: ['Declined', 'bg-danger/10 text-danger'] } as const
  const [t, c] = map[r]
  return <span className={cn('rounded-full px-2 py-0.5 text-[12px] font-semibold', c)}>{t}</span>
}
