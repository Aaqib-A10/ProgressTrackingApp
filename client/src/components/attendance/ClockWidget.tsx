import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock, LogIn, LogOut, Coffee, Play, CheckCircle2, CalendarOff, ChevronRight, House } from 'lucide-react'
import { useToast } from '../ui/Toast'
import {
  getAttendanceMe,
  clockCheckIn,
  clockCheckOut,
  clockStartBreak,
  clockEndBreak,
  formatMinutes,
  type MeResponse,
  type ClockState,
} from '../../lib/attendanceApi'

function errMsg(e: unknown, fallback: string): string {
  const m = (e as { message?: string })?.message
  if (!m) return fallback
  try {
    return (JSON.parse(m) as { error?: string }).error || fallback
  } catch {
    return m
  }
}

/** Live worked minutes — grows in real time while checked in (not on break). */
function liveWorkedMin(me: MeResponse): number {
  const t = me.today
  if (t.state === 'IN' && t.checkInAt) {
    const ms = Date.now() - Date.parse(t.checkInAt)
    return Math.max(0, Math.round(ms / 60000) - t.breakMin)
  }
  return t.workedMin ?? 0
}

const STATE_META: Record<ClockState, { label: string; dot: string }> = {
  NOT_IN: { label: 'Check in', dot: 'bg-slate-300' },
  IN: { label: 'Working', dot: 'bg-success' },
  ON_BREAK: { label: 'On break', dot: 'bg-warning' },
  OUT: { label: 'Done', dot: 'bg-slate-400' },
}

export function ClockWidget() {
  const { addToast } = useToast()
  const [me, setMe] = useState<MeResponse | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [, force] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let active = true
    getAttendanceMe()
      .then((r) => active && setMe(r))
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  // Tick every 30s so the "Working · 2h 15m" minute display stays fresh.
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 30000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  async function run(fn: () => Promise<MeResponse>, okMsg: string) {
    if (busy) return
    setBusy(true)
    try {
      const r = await fn()
      setMe(r)
      addToast({ type: 'success', message: okMsg })
    } catch (e) {
      addToast({ type: 'error', message: errMsg(e, 'Something went wrong.') })
    } finally {
      setBusy(false)
    }
  }

  if (!me) return null

  const { today, offLabel, offName, workMode } = me
  const worked = liveWorkedMin(me)

  // Off day (leave / holiday) — no clocking.
  if (offLabel) {
    const label = offLabel === 'HOLIDAY' ? offName || 'Holiday' : offLabel === 'ON_LEAVE' ? 'On leave' : 'Day off'
    return (
      <div className="flex items-center gap-2 rounded-btn border border-line bg-bg px-3 py-1.5" title="No clock-in on off days">
        <CalendarOff size={16} className="text-ink-muted" />
        <span className="text-body-sm font-medium text-ink-muted">{label}</span>
      </div>
    )
  }

  const meta = STATE_META[today.state]
  const pillText =
    today.state === 'NOT_IN'
      ? 'Check in'
      : today.state === 'OUT'
        ? `Done · ${formatMinutes(worked)}`
        : `${meta.label} · ${formatMinutes(worked)}`

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-btn border border-line bg-card px-3 py-1.5 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Attendance clock"
      >
        <span className={'h-2 w-2 rounded-full ' + meta.dot + (today.state === 'IN' ? ' animate-pulse' : '')} />
        <span className="hidden text-body-sm font-semibold text-ink sm:inline">{pillText}</span>
        {workMode === 'WFH' && (
          <span className="hidden items-center gap-1 rounded-full bg-accent/10 px-1.5 py-0.5 text-[11px] font-semibold text-accent sm:inline-flex" title="Working from home">
            <House size={11} /> WFH
          </span>
        )}
        <Clock size={16} className="text-ink-muted sm:hidden" />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-72 animate-scale-in overflow-hidden rounded-card border border-line bg-card shadow-overlay">
          <div className="border-b border-line px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-body-md font-semibold text-ink">Attendance</span>
              <span className="inline-flex items-center gap-1.5 text-body-sm text-ink-muted">
                <span className={'h-2 w-2 rounded-full ' + meta.dot} /> {meta.label}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center">
              <Stat label="Worked" value={formatMinutes(worked)} />
              <Stat label="Break" value={formatMinutes(today.breakMin)} />
              <Stat label="In at" value={today.checkInLabel ?? '—'} />
            </div>
            {today.state !== 'NOT_IN' && (
              <div className="mt-2 space-y-1">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={'h-full rounded-full ' + (today.completed ? 'bg-success' : 'bg-primary')}
                    style={{ width: `${Math.min(100, Math.round((worked / Math.max(1, today.requiredMin)) * 100))}%` }}
                  />
                </div>
                <p className="text-[11px] text-ink-muted">
                  {today.completed ? (
                    <span className="font-medium text-success">Full shift complete ✓</span>
                  ) : (
                    <>{formatMinutes(worked)} of {formatMinutes(today.requiredMin)} shift</>
                  )}
                  {today.late && <span className="ml-1 text-warning">· late</span>}
                </p>
              </div>
            )}
          </div>

          <div className="space-y-1 p-2">
            {today.state === 'NOT_IN' && (
              <Action icon={<LogIn size={16} />} label="Check in" onClick={() => run(clockCheckIn, 'Checked in.')} disabled={busy} tone="primary" />
            )}
            {today.state === 'IN' && (
              <>
                <Action icon={<Coffee size={16} />} label="Start break" onClick={() => run(clockStartBreak, 'Break started.')} disabled={busy} />
                <Action icon={<LogOut size={16} />} label="Check out" onClick={() => run(clockCheckOut, 'Checked out.')} disabled={busy} tone="danger" />
              </>
            )}
            {today.state === 'ON_BREAK' && (
              <>
                <Action icon={<Play size={16} />} label="End break" onClick={() => run(clockEndBreak, 'Back to work.')} disabled={busy} tone="primary" />
                <Action icon={<LogOut size={16} />} label="Check out" onClick={() => run(clockCheckOut, 'Checked out.')} disabled={busy} tone="danger" />
              </>
            )}
            {today.state === 'OUT' && (
              <div className="flex items-center gap-2 px-3 py-2 text-body-sm text-success">
                <CheckCircle2 size={16} /> Checked out for the day.
              </div>
            )}
          </div>

          <Link
            to="/app/attendance/me"
            onClick={() => setOpen(false)}
            className="flex items-center justify-between border-t border-line px-4 py-2.5 text-body-sm font-medium text-primary hover:bg-slate-50"
          >
            View my attendance <ChevronRight size={16} />
          </Link>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-btn bg-bg py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="text-body-sm font-semibold tabular-nums text-ink">{value}</div>
    </div>
  )
}

function Action({ icon, label, onClick, disabled, tone = 'default' }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; tone?: 'default' | 'primary' | 'danger' }) {
  const toneClass =
    tone === 'primary' ? 'text-primary hover:bg-primary/10' : tone === 'danger' ? 'text-danger hover:bg-danger/10' : 'text-ink hover:bg-slate-100'
  return (
    <button
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={'flex w-full items-center gap-2.5 rounded-btn px-3 py-2 text-body-md font-medium transition-colors disabled:opacity-50 ' + toneClass}
    >
      {icon}
      {label}
    </button>
  )
}
