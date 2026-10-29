import { useEffect, useState } from 'react'
import { Clock, LogIn, AlertTriangle, CalendarCheck, CheckCircle2, MessageSquare, List, CalendarDays, Download, House } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { StatCard } from '../../../components/StatCard'
import { Badge, type BadgeTone } from '../../../components/ui/Badge'
import { DataTable, type Column } from '../../../components/DataTable'
import { useToast } from '../../../components/ui/Toast'
import { MyWfhRequests } from '../../../components/attendance/WfhRequests'
import { PeriodPicker, periodFor, todayIso, parseIso, addDays, STATUS_STYLE, flagsOf, downloadCsv, hm, type Period } from '../../../components/attendance/period'
import { cn } from '../../../lib/cn'
import { getAttendanceHistoryBetween, formatMinutes, type AttendanceDayRow, type HistoryResponse, type HistoryLabel } from '../../../lib/attendanceApi'

const LABEL_META: Record<HistoryLabel, { tone: BadgeTone; text: string }> = {
  PRESENT: { tone: 'success', text: 'Present' },
  ON_LEAVE: { tone: 'primary', text: 'On Leave' },
  OFF: { tone: 'neutral', text: 'Off' },
  HOLIDAY: { tone: 'accent', text: 'Holiday' },
  WFH: { tone: 'accent', text: 'Work From Home' },
  WEEKLY_OFF: { tone: 'neutral', text: 'Weekly Off' },
  ABSENT: { tone: 'danger', text: 'Absent' },
  NOT_YET: { tone: 'neutral', text: 'Not checked in yet' },
}

function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function readView(): 'list' | 'calendar' {
  try { return localStorage.getItem('attendance.view') === 'calendar' ? 'calendar' : 'list' } catch { return 'list' }
}

export default function MyAttendance() {
  const { addToast } = useToast()
  const [data, setData] = useState<HistoryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  // Its own period (not the top bar): this month by default, so the whole history shows.
  const [period, setPeriod] = useState<Period>(() => periodFor('MONTH', todayIso()))
  const [view, setViewState] = useState<'list' | 'calendar'>(readView)
  function setView(v: 'list' | 'calendar') { setViewState(v); try { localStorage.setItem('attendance.view', v) } catch { /* ignore */ } }

  useEffect(() => {
    let active = true
    setLoading(true)
    getAttendanceHistoryBetween(period.start, period.end, { all: true })
      .then((r) => active && setData(r))
      .catch(() => active && addToast({ type: 'error', message: 'Could not load attendance.' }))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [period, addToast])

  function exportCsv() {
    const rows = [...(data?.rows ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1))
    downloadCsv(`my-attendance-${period.start}-to-${period.end}.csv`, ['Date', 'Day', 'Status', 'Check in', 'Check out', 'Worked (h:mm)', 'Break (h:mm)', 'Overtime (h:mm)', 'Flags', 'Team Lead note'],
      rows.map((r) => [r.date, parseIso(r.date).toLocaleDateString('en-US', { weekday: 'short' }), r.label === 'HOLIDAY' && r.offName ? r.offName : STATUS_STYLE[r.label].text, r.checkIn, r.checkOut, hm(r.workedMin), r.breakMin ? hm(r.breakMin) : '', r.overtimeMin ? hm(r.overtimeMin) : '', flagsOf(r).join(', '), r.note]))
  }

  const columns: Column<AttendanceDayRow>[] = [
    { key: 'date', header: 'Date', render: (r) => <span className="font-medium text-ink">{fmtDate(r.date)}</span> },
    {
      key: 'label',
      header: 'Status',
      render: (r) => (
        <div className="flex flex-wrap items-center gap-1">
          <Badge tone={LABEL_META[r.label].tone} dot>{r.label === 'HOLIDAY' && r.offName ? r.offName : LABEL_META[r.label].text}</Badge>
          {r.wfh && r.label !== 'WFH' && <Badge tone="accent">WFH</Badge>}
        </div>
      ),
    },
    { key: 'checkIn', header: 'Check in', align: 'right', render: (r) => (r.checkIn ? <span className={r.late ? 'font-semibold text-warning' : ''}>{r.checkIn}</span> : '—') },
    { key: 'checkOut', header: 'Check out', align: 'right', render: (r) => (r.checkOut ? <span className={r.earlyLeave ? 'font-semibold text-warning' : ''}>{r.checkOut}</span> : '—') },
    { key: 'worked', header: 'Worked', align: 'right', render: (r) => formatMinutes(r.workedMin) },
    { key: 'break', header: 'Break', align: 'right', render: (r) => (r.breakMin ? formatMinutes(r.breakMin) : '—') },
    { key: 'overtime', header: 'Overtime', align: 'right', render: (r) => (r.overtimeMin ? <span className="font-medium text-primary">{formatMinutes(r.overtimeMin)}</span> : '—') },
    {
      key: 'flags',
      header: 'Flags',
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          {r.late && <Badge tone="warning">Late</Badge>}
          {r.earlyLeave && <Badge tone="warning">Left early</Badge>}
          {r.label === 'PRESENT' && r.completed && <Badge tone="success">Full shift</Badge>}
          {r.label === 'PRESENT' && !r.completed && r.shortMin != null && r.shortMin > 0 && <Badge tone="neutral">Short {formatMinutes(r.shortMin)}</Badge>}
          {r.label === 'PRESENT' && r.checkIn && !r.checkOut && <Badge tone="primary">Working</Badge>}
          {!r.late && !r.earlyLeave && !r.completed && r.label === 'PRESENT' && r.checkOut && (r.shortMin == null || r.shortMin === 0) && <span className="text-body-sm text-ink-muted">On time</span>}
          {r.label === 'NOT_YET' && data && <span className="text-body-sm text-ink-muted">Shift starts {data.shift.startTime}</span>}
        </div>
      ),
    },
  ]

  const s = data?.summary
  const absent = (data?.rows ?? []).filter((r) => r.label === 'ABSENT').length

  return (
    <div className="mx-auto w-full max-w-[1800px] space-y-6">
      <div>
        <h1 className="text-headline-lg text-ink">My Attendance</h1>
        <p className="mt-0.5 text-body-md text-ink-muted">
          Your check-in history and hours{data ? ` · shift ${data.shift.startTime}–${data.shift.endTime}${data.shift.dayTimes && Object.keys(data.shift.dayTimes).length > 0 ? ' (varies by day)' : ''}` : ''}
        </p>
      </div>

      {s && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <StatCard label="Hours worked" value={formatMinutes(s.totalWorkedMin)} caption={`${s.presentDays} days · ${absent} absent`} icon={<Clock size={16} />} />
          <StatCard label="Shifts completed" value={`${s.completedShifts}/${s.presentDays}`} caption={data ? `Full shift = ${formatMinutes(data.shift.requiredMinutes)}` : ''} icon={<CheckCircle2 size={16} />} />
          <StatCard label="Avg check-in" value={s.avgCheckIn ?? '—'} caption={data ? `Shift starts ${data.shift.startTime}` : ''} icon={<LogIn size={16} />} />
          <StatCard label="Late days" value={s.lateDays} caption={`of ${s.presentDays} present`} icon={<AlertTriangle size={16} />} />
          <StatCard label="Days present" value={s.presentDays} caption={`${s.leaveDays} leave · ${s.weeklyOffDays} off · ${s.holidayDays} holiday`} icon={<CalendarCheck size={16} />} />
        </div>
      )}

      <MyWfhRequests />

      <div className="flex flex-wrap items-center gap-3">
        <PeriodPicker value={period} onChange={setPeriod} modes={['WEEK', 'MONTH', 'RANGE']} maxDays={92} />
        <div className="ml-auto flex items-center gap-2">
          <div className="inline-flex rounded-btn border border-line bg-card p-0.5" aria-label="View">
            <button type="button" onClick={() => setView('list')} className={cn('inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-body-sm font-semibold', view === 'list' ? 'bg-slate-100 text-ink' : 'text-ink-muted')}><List size={14} /> List</button>
            <button type="button" onClick={() => setView('calendar')} className={cn('inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-body-sm font-semibold', view === 'calendar' ? 'bg-slate-100 text-ink' : 'text-ink-muted')}><CalendarDays size={14} /> Calendar</button>
          </div>
          <button type="button" onClick={exportCsv} disabled={!data?.rows.length} className="inline-flex h-8 items-center gap-1.5 rounded-btn border border-line bg-card px-2.5 text-body-sm text-ink hover:bg-slate-50 disabled:opacity-50"><Download size={14} /> CSV</button>
        </div>
      </div>

      {view === 'calendar' ? (
        <Card>
          {loading || !data ? <div className="text-body-md text-ink-muted">Loading…</div> : <AttendanceCalendar start={period.start} end={period.end} rows={data.rows} />}
        </Card>
      ) : (
      <Card flush>
        {loading ? (
          <div className="p-5 text-body-md text-ink-muted">Loading…</div>
        ) : (
          <DataTable
            columns={columns}
            rows={data?.rows ?? []}
            getRowId={(r) => r.date}
            emptyMessage="No attendance in this period." 
            renderRowBanner={(r) =>
              r.note ? (
                <div className="flex items-start gap-1.5 rounded-btn bg-primary/5 px-3 py-1.5 text-body-sm">
                  <MessageSquare size={13} className="mt-0.5 shrink-0 text-primary" />
                  <span className="text-ink"><span className="font-medium text-ink-muted">Team Lead: </span>{r.note}</span>
                </div>
              ) : null
            }
          />
        )}
      </Card>
      )}
    </div>
  )
}

/** Month-style calendar: each day shows its status, check in and check out, and hours. */
function AttendanceCalendar({ start, end, rows }: { start: string; end: string; rows: AttendanceDayRow[] }) {
  const byDate = new Map(rows.map((r) => [r.date, r]))
  const today = todayIso()
  const lead = (parseIso(start).getDay() + 6) % 7
  const days: string[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d)
  return (
    <div>
      <div className="grid grid-cols-7 gap-1.5">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d} className="pb-1 text-center text-[11px] font-semibold uppercase text-ink-muted">{d}</span>)}
        {Array.from({ length: lead }, (_, i) => <span key={`x${i}`} />)}
        {days.map((d) => {
          const r = byDate.get(d)
          const st = r ? STATUS_STYLE[r.label] : null
          const flags = r ? flagsOf(r) : []
          return (
            <div key={d} title={r ? [STATUS_STYLE[r.label].text, r.checkIn && `In ${r.checkIn}`, r.checkOut && `Out ${r.checkOut}`, r.workedMin != null && `Worked ${formatMinutes(r.workedMin)}`, ...flags, r.note && `Note: ${r.note}`].filter(Boolean).join(' · ') : ''}
              className={cn('flex min-h-[92px] flex-col rounded-btn border p-1.5 text-[11px] sm:p-2', st ? st.cell : 'border-line bg-card', d === today && 'ring-2 ring-primary/40')}>
              <div className="flex items-center justify-between">
                <span className={cn('text-body-sm font-semibold', d === today ? 'text-primary' : 'text-ink')}>{parseIso(d).getDate()}</span>
                {r?.wfh && <House size={11} className="text-accent" />}
              </div>
              {r?.label === 'PRESENT' ? (
                <div className="mt-auto space-y-0.5 tabular-nums">
                  <div className={cn(r.late ? 'font-semibold text-warning' : 'text-ink')}>In {r.checkIn}</div>
                  <div className={cn(r.earlyLeave ? 'font-semibold text-warning' : 'text-ink')}>{r.checkOut ? `Out ${r.checkOut}` : 'Working…'}</div>
                  {r.workedMin != null && <div className={cn('font-semibold', r.completed ? 'text-success' : 'text-ink-muted')}>{formatMinutes(r.workedMin)}</div>}
                </div>
              ) : r ? (
                <div className="mt-auto font-semibold">{r.label === 'HOLIDAY' && r.offName ? r.offName : st!.text}</div>
              ) : null}
            </div>
          )
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-ink-muted">
        {(['PRESENT', 'ABSENT', 'ON_LEAVE', 'WEEKLY_OFF', 'HOLIDAY'] as const).map((k) => <span key={k} className="inline-flex items-center gap-1"><span className={cn('h-2 w-2 rounded-full', STATUS_STYLE[k].dot)} />{STATUS_STYLE[k].text}</span>)}
        <span>Amber time: late in or left early. Green hours: full shift.</span>
      </div>
    </div>
  )
}
