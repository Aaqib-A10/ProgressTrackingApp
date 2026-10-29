import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock, LogIn, LogOut, Coffee, Play, CheckCircle2, CalendarOff, ChevronRight, House, TriangleAlert, Timer, Laptop, AlarmClockPlus } from 'lucide-react'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../lib/auth'
import { isMobileOrTablet } from '../../lib/device'
import {
  getAttendanceMe,
  clockCheckIn,
  clockCheckOut,
  clockStartBreak,
  clockEndBreak,
  clockStartOvertime,
  formatMinutes,
  type MeResponse,
  type ClockState,
} from '../../lib/attendanceApi'

/** The browser could not reach the server at all (no answer came back). */
function isNetworkError(e: unknown): boolean {
  return e instanceof TypeError || /failed to fetch|networkerror|load failed/i.test((e as { message?: string })?.message ?? '')
}

function errMsg(e: unknown, fallback: string): string {
  if (isNetworkError(e)) return 'Could not reach PulseTrack. Check your internet connection and try again.'
  const m = (e as { message?: string })?.message
  if (!m) return fallback
  try {
    return (JSON.parse(m) as { error?: string }).error || fallback
  } catch {
    return m
  }
}

/** "Now" on the server's clock: the computer's clock may be wrong (a day off shows 24 hours worked). */
type Synced = MeResponse & { skewMs: number }
const serverNow = (me: Synced) => Date.now() + me.skewMs
const sync = (r: MeResponse): Synced => ({ ...r, skewMs: Date.parse(r.serverNow) - Date.now() })

/** Live worked minutes — grows in real time while checked in (not on break). */
function liveWorkedMin(me: Synced): number {
  const t = me.today
  if (t.state === 'IN' && t.checkInAt) {
    const ms = serverNow(me) - Date.parse(t.checkInAt)
    return Math.max(0, Math.round(ms / 60000) - t.breakMin)
  }
  return t.workedMin ?? 0
}

/** Live overtime minutes (grows while working after the shift hours). */
function liveOvertimeMin(me: Synced): number {
  const t = me.today
  if (!t.overtime || !t.checkInAt || t.shiftHoursMin == null) return t.overtimeMin
  if (t.state !== 'IN') return t.overtimeMin
  const since = Date.parse(t.checkInAt) + t.shiftHoursMin * 60000
  const extra = Math.round((serverNow(me) - Math.max(since, Date.parse(me.serverNow))) / 60000)
  return t.overtimeMin + Math.max(0, extra)
}

/** Minutes until PulseTrack checks this session out by itself (null when it won't). */
function minutesToAutoCheckout(me: Synced): number | null {
  const at = me.today.autoCheckoutAt
  if (!at || me.today.state === 'OUT' || me.today.state === 'NOT_IN') return null
  return Math.ceil((Date.parse(at) - serverNow(me)) / 60000)
}

const STATE_META: Record<ClockState, { label: string; dot: string }> = {
  NOT_IN: { label: 'Check in', dot: 'bg-slate-300' },
  IN: { label: 'Working', dot: 'bg-success' },
  ON_BREAK: { label: 'On break', dot: 'bg-warning' },
  OUT: { label: 'Done', dot: 'bg-slate-400' },
}

export function ClockWidget() {
  const { addToast } = useToast()
  const { user } = useAuth()
  // Laptop-only rule: phones/tablets can't record attendance (Super Admin exempt).
  const deviceBlocked = isMobileOrTablet() && user?.role !== 'SUPER_ADMIN'
  const [me, setMeRaw] = useState<Synced | null>(null)
  const setMe = (r: MeResponse) => setMeRaw(sync(r))
  const warned = useRef<string | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  // Guard against an accidental check-out: first click asks to confirm.
  const [confirmOut, setConfirmOut] = useState(false)
  const [, force] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  // Load, and keep in step with the server: every minute while the tab is in front and
  // whenever it comes back, so an automatic check-out (or one from another tab) shows at
  // once instead of a clock that keeps running on an old state.
  useEffect(() => {
    let active = true
    const load = () => { getAttendanceMe().then((r) => active && setMeRaw(sync(r))).catch(() => undefined) }
    load()
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') load() }, 60000)
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)
    return () => {
      active = false
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onVis)
    }
  }, [])

  // Tick every 30s so the "Working · 2h 15m" minute display stays fresh.
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 30000)
    return () => clearInterval(t)
  }, [])

  // Ten minutes before the automatic check-out: say so once, with the way to keep working.
  const left = me ? minutesToAutoCheckout(me) : null
  useEffect(() => {
    if (!me || me.today.overtime || left == null || left > 10 || left < 0) return
    const key = me.today.autoCheckoutAt
    if (warned.current === key) return
    warned.current = key
    addToast({ type: 'info', message: `Your shift hours finish at ${me.today.autoCheckoutLabel} and you will be checked out. Open the clock and press "Start overtime" to keep working.` })
  }, [me, left, addToast])
  // Once that moment passes, fetch the new state (it shows "Done").
  useEffect(() => {
    if (left == null || left > 0) return
    const t = window.setTimeout(() => { getAttendanceMe().then((r) => setMeRaw(sync(r))).catch(() => undefined) }, 70000)
    return () => window.clearTimeout(t)
  }, [left])

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
      let r: MeResponse
      try {
        r = await fn()
      } catch (e) {
        // No answer at all (connection dropped for a moment): try once more.
        if (!isNetworkError(e)) throw e
        await new Promise((ok) => setTimeout(ok, 1500))
        r = await fn()
      }
      setMe(r)
      addToast({ type: 'success', message: okMsg })
    } catch (e) {
      addToast({ type: 'error', message: errMsg(e, 'Something went wrong.') })
      // Show the real state (for example: already checked out automatically).
      getAttendanceMe().then((r) => setMe(r)).catch(() => undefined)
    } finally {
      setBusy(false)
    }
  }

  // Drop the confirm prompt whenever the menu closes.
  useEffect(() => {
    if (!open) setConfirmOut(false)
  }, [open])

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
        : today.overtime
          ? `Overtime · ${formatMinutes(worked)}`
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
        {workMode && (
          <span className="hidden items-center gap-1 rounded-full bg-accent/10 px-1.5 py-0.5 text-[11px] font-semibold text-accent sm:inline-flex" title={workMode === 'REMOTE' ? 'You work from home: check in from anywhere' : 'Work from home today: check in from anywhere'}>
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
              <div className="mt-1.5 flex justify-center gap-3 text-[11px]">
                <span className={today.brbMin > today.brbAllowanceMin ? 'font-semibold text-danger' : 'text-ink-muted'}>
                  BRB {today.brbMin}/{today.brbAllowanceMin}m
                </span>
                <span className={today.regularBreakMin > today.breakAllowanceMin ? 'font-semibold text-danger' : 'text-ink-muted'}>
                  Break {today.regularBreakMin}/{today.breakAllowanceMin}m
                </span>
              </div>
            )}
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
                {today.overtime && (
                  <p className="text-[11px] font-medium text-primary">
                    Overtime {formatMinutes(liveOvertimeMin(me))}{today.state !== 'OUT' && today.autoCheckoutLabel ? ` · check out yourself (automatic at ${today.autoCheckoutLabel})` : ''}
                  </p>
                )}
                {!today.overtime && today.autoCheckoutLabel && (today.state === 'IN' || today.state === 'ON_BREAK') && (
                  <p className={'text-[11px] ' + (left != null && left <= 10 ? 'font-semibold text-warning' : 'text-ink-muted')}>
                    Automatic check-out at {today.autoCheckoutLabel} (end of your {formatMinutes(today.shiftHoursMin)} shift)
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="space-y-1 p-2">
            {deviceBlocked && today.state !== 'OUT' ? (
              <div className="flex items-start gap-2 rounded-btn bg-warning/5 px-3 py-2.5 text-body-sm text-ink">
                <Laptop size={16} className="mt-0.5 shrink-0 text-warning" />
                <span>Attendance can only be recorded on a laptop or desktop — not a phone or tablet.</span>
              </div>
            ) : confirmOut ? (
              <div className="rounded-btn bg-danger/5 p-2">
                <div className="flex items-start gap-2 px-1 py-1 text-body-sm text-ink">
                  <TriangleAlert size={16} className="mt-0.5 shrink-0 text-danger" />
                  <span>Check out for the day? This stops your clock — you can’t undo it yourself.</span>
                </div>
                <div className="mt-1 flex gap-2">
                  <button
                    onClick={() => { setConfirmOut(false); run(clockCheckOut, 'Checked out.') }}
                    disabled={busy}
                    className="flex-1 rounded-btn bg-danger px-3 py-2 text-body-sm font-semibold text-white transition-colors hover:bg-danger/90 disabled:opacity-50"
                  >
                    Yes, check out
                  </button>
                  <button
                    onClick={() => setConfirmOut(false)}
                    className="flex-1 rounded-btn border border-line px-3 py-2 text-body-sm font-medium text-ink hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                {today.state === 'NOT_IN' && (
                  <Action icon={<LogIn size={16} />} label="Check in" onClick={() => run(clockCheckIn, 'Checked in.')} disabled={busy} tone="primary" />
                )}
                {today.state === 'IN' && (
                  <>
                    <Action icon={<Coffee size={16} />} label="Start break" onClick={() => run(() => clockStartBreak('BREAK'), 'Break started.')} disabled={busy} />
                    <Action icon={<Timer size={16} />} label="BRB" onClick={() => run(() => clockStartBreak('BRB'), 'BRB started.')} disabled={busy} />
                    {!today.overtime && (
                      <Action icon={<AlarmClockPlus size={16} />} label="Start overtime" hint="Keep working after your shift hours" onClick={() => run(clockStartOvertime, 'Overtime started. Check out yourself when you finish.')} disabled={busy} />
                    )}
                    <Action icon={<LogOut size={16} />} label="Check out" onClick={() => setConfirmOut(true)} disabled={busy} tone="danger" />
                  </>
                )}
                {today.state === 'ON_BREAK' && (
                  <>
                    <Action icon={<Play size={16} />} label={today.openBreakType === 'BRB' ? 'End BRB' : 'End break'} onClick={() => run(clockEndBreak, 'Back to work.')} disabled={busy} tone="primary" />
                    {!today.overtime && (
                      <Action icon={<AlarmClockPlus size={16} />} label="Start overtime" hint="Keep working after your shift hours" onClick={() => run(clockStartOvertime, 'Overtime started. Check out yourself when you finish.')} disabled={busy} />
                    )}
                    <Action icon={<LogOut size={16} />} label="Check out" onClick={() => setConfirmOut(true)} disabled={busy} tone="danger" />
                  </>
                )}
                {today.state === 'OUT' && (today.canStartOvertime ? (
                  <>
                    <div className="px-3 pb-1 pt-2 text-body-sm text-ink-muted">Your shift hours were complete, so you were checked out at {today.checkOutLabel}. Still working?</div>
                    <Action icon={<AlarmClockPlus size={16} />} label="Start overtime" hint="Keep working: the time from now counts as overtime" onClick={() => run(clockStartOvertime, 'Overtime started. Check out yourself when you finish.')} disabled={busy} tone="primary" />
                  </>
                ) : (
                  <div className="flex items-center gap-2 px-3 py-2 text-body-sm text-success">
                    <CheckCircle2 size={16} /> Checked out for the day.
                  </div>
                ))}
              </>
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

function Action({ icon, label, hint, onClick, disabled, tone = 'default' }: { icon: React.ReactNode; label: string; hint?: string; onClick: () => void; disabled?: boolean; tone?: 'default' | 'primary' | 'danger' }) {
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
      <span className="flex flex-col items-start leading-tight">
        {label}
        {hint && <span className="text-[11px] font-normal text-ink-muted">{hint}</span>}
      </span>
    </button>
  )
}
