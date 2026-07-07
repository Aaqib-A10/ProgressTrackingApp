import { useEffect, useState } from 'react'
import { Clock, LogIn, AlertTriangle, CalendarCheck, CheckCircle2 } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { StatCard } from '../../../components/StatCard'
import { Badge, type BadgeTone } from '../../../components/ui/Badge'
import { DataTable, type Column } from '../../../components/DataTable'
import { useRange } from '../../../components/layout/AppShell'
import { useToast } from '../../../components/ui/Toast'
import { getAttendanceHistory, formatMinutes, type AttendanceDayRow, type HistoryResponse, type HistoryLabel } from '../../../lib/attendanceApi'

const LABEL_META: Record<HistoryLabel, { tone: BadgeTone; text: string }> = {
  PRESENT: { tone: 'success', text: 'Present' },
  ON_LEAVE: { tone: 'primary', text: 'On Leave' },
  OFF: { tone: 'neutral', text: 'Off' },
  HOLIDAY: { tone: 'accent', text: 'Holiday' },
  ABSENT: { tone: 'danger', text: 'Absent' },
}

function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function MyAttendance() {
  const { range, custom } = useRange()
  const { addToast } = useToast()
  const [data, setData] = useState<HistoryResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    getAttendanceHistory(range, custom)
      .then((r) => active && setData(r))
      .catch(() => active && addToast({ type: 'error', message: 'Could not load attendance.' }))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [range, custom, addToast])

  const columns: Column<AttendanceDayRow>[] = [
    { key: 'date', header: 'Date', render: (r) => <span className="font-medium text-ink">{fmtDate(r.date)}</span> },
    { key: 'label', header: 'Status', render: (r) => <Badge tone={LABEL_META[r.label].tone} dot>{r.label === 'HOLIDAY' && r.offName ? r.offName : LABEL_META[r.label].text}</Badge> },
    { key: 'checkIn', header: 'Check in', align: 'right', render: (r) => (r.checkIn ? <span className={r.late ? 'font-semibold text-warning' : ''}>{r.checkIn}</span> : '—') },
    { key: 'checkOut', header: 'Check out', align: 'right', render: (r) => (r.checkOut ? <span className={r.earlyLeave ? 'font-semibold text-warning' : ''}>{r.checkOut}</span> : '—') },
    { key: 'worked', header: 'Worked', align: 'right', render: (r) => formatMinutes(r.workedMin) },
    { key: 'break', header: 'Break', align: 'right', render: (r) => (r.breakMin ? formatMinutes(r.breakMin) : '—') },
    {
      key: 'flags',
      header: 'Flags',
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          {r.late && <Badge tone="warning">Late</Badge>}
          {r.earlyLeave && <Badge tone="warning">Left early</Badge>}
          {r.label === 'PRESENT' && r.completed && <Badge tone="success">Full shift</Badge>}
          {r.label === 'PRESENT' && !r.completed && r.shortMin != null && r.shortMin > 0 && <Badge tone="neutral">Short {formatMinutes(r.shortMin)}</Badge>}
          {!r.late && !r.earlyLeave && !r.completed && r.label === 'PRESENT' && (r.shortMin == null || r.shortMin === 0) && <span className="text-body-sm text-ink-muted">On time</span>}
        </div>
      ),
    },
  ]

  const s = data?.summary

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-headline-lg text-ink">My Attendance</h1>
        <p className="mt-0.5 text-body-md text-ink-muted">
          Your check-in history and hours{data ? ` · shift ${data.shift.startTime}–${data.shift.endTime}` : ''}
        </p>
      </div>

      {s && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <StatCard label="Hours worked" value={formatMinutes(s.totalWorkedMin)} caption="This period" icon={<Clock size={16} />} />
          <StatCard label="Shifts completed" value={`${s.completedShifts}/${s.presentDays}`} caption={data ? `Full shift = ${formatMinutes(data.shift.requiredMinutes)}` : ''} icon={<CheckCircle2 size={16} />} />
          <StatCard label="Avg check-in" value={s.avgCheckIn ?? '—'} caption={data ? `Shift starts ${data.shift.startTime}` : ''} icon={<LogIn size={16} />} />
          <StatCard label="Late days" value={s.lateDays} caption={`of ${s.presentDays} present`} icon={<AlertTriangle size={16} />} />
          <StatCard label="Days present" value={s.presentDays} caption={`${s.leaveDays} leave · ${s.holidayDays} holiday`} icon={<CalendarCheck size={16} />} />
        </div>
      )}

      <Card flush>
        {loading ? (
          <div className="p-5 text-body-md text-ink-muted">Loading…</div>
        ) : (
          <DataTable columns={columns} rows={data?.rows ?? []} getRowId={(r) => r.date} emptyMessage="No attendance records in this period yet." />
        )}
      </Card>
    </div>
  )
}
