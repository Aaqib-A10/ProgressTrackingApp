import { useEffect, useState } from 'react'
import { LogIn, Coffee, LogOut, UserX, Settings2, Pencil } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { Badge, type BadgeTone } from '../../../components/ui/Badge'
import { DataTable, type Column } from '../../../components/DataTable'
import { useRange } from '../../../components/layout/AppShell'
import { useToast } from '../../../components/ui/Toast'
import {
  getAttendanceTeam,
  putAttendanceShift,
  getAttendanceHistory,
  correctAttendanceDay,
  formatMinutes,
  type ClockState,
  type Shift,
  type TeamAttendanceResponse,
  type TeamAttendanceRow,
  type AttendanceDayRow,
} from '../../../lib/attendanceApi'

const STATE_META: Record<ClockState, { tone: BadgeTone; label: string }> = {
  IN: { tone: 'success', label: 'Working' },
  ON_BREAK: { tone: 'warning', label: 'On break' },
  OUT: { tone: 'neutral', label: 'Checked out' },
  NOT_IN: { tone: 'danger', label: 'Not in' },
}

function errMsg(e: unknown, fallback: string): string {
  const m = (e as { message?: string })?.message
  if (!m) return fallback
  try {
    return (JSON.parse(m) as { error?: string }).error || fallback
  } catch {
    return m
  }
}

function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function MiniStat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: string }) {
  return (
    <div className="flex items-center gap-3 rounded-card border border-line bg-card p-4 shadow-card">
      <span className={'flex h-9 w-9 items-center justify-center rounded-btn ' + tone}>{icon}</span>
      <div>
        <div className="text-headline-md font-bold tabular-nums text-ink">{value}</div>
        <div className="text-body-sm text-ink-muted">{label}</div>
      </div>
    </div>
  )
}

export default function TeamAttendance() {
  const { range, custom } = useRange()
  const { addToast } = useToast()
  const [data, setData] = useState<TeamAttendanceResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [shiftOpen, setShiftOpen] = useState(false)
  const [selected, setSelected] = useState<TeamAttendanceRow | null>(null)

  function reload() {
    setLoading(true)
    getAttendanceTeam(range, custom)
      .then(setData)
      .catch(() => addToast({ type: 'error', message: 'Could not load team attendance.' }))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    let active = true
    setLoading(true)
    getAttendanceTeam(range, custom)
      .then((r) => active && setData(r))
      .catch(() => active && addToast({ type: 'error', message: 'Could not load team attendance.' }))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [range, custom, addToast])

  const columns: Column<TeamAttendanceRow>[] = [
    {
      key: 'name',
      header: 'Member',
      render: (r) => (
        <div>
          <div className="font-medium text-ink">{r.name}</div>
          {data?.scope === 'COMPANY' && <div className="text-body-sm text-ink-muted">{r.department}</div>}
        </div>
      ),
    },
    { key: 'today', header: 'Today', render: (r) => <Badge tone={STATE_META[r.todayState].tone} dot>{STATE_META[r.todayState].label}</Badge> },
    { key: 'present', header: 'Present', align: 'right', render: (r) => r.presentDays },
    { key: 'late', header: 'Late', align: 'right', render: (r) => (r.lateDays ? <span className="font-semibold text-warning">{r.lateDays}</span> : '0') },
    { key: 'leave', header: 'Leave', align: 'right', render: (r) => r.leaveDays },
    { key: 'worked', header: 'Worked', align: 'right', render: (r) => formatMinutes(r.totalWorkedMin) },
    { key: 'break', header: 'Break', align: 'right', render: (r) => formatMinutes(r.totalBreakMin) },
    { key: 'avg', header: 'Avg in', align: 'right', render: (r) => r.avgCheckIn ?? '—' },
    {
      key: 'edit',
      header: '',
      align: 'right',
      render: (r) => (
        <button onClick={(e) => { e.stopPropagation(); setSelected(r) }} className="flex h-8 w-8 items-center justify-center rounded-btn text-ink-muted hover:bg-slate-100 hover:text-primary" title={`Edit ${r.name}'s times`}>
          <Pencil size={15} />
        </button>
      ),
    },
  ]

  const s = data?.summary

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-headline-lg text-ink">Team Attendance</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">
            Who's in now and hours over the period{data ? ` · shift ${data.shift.startTime}–${data.shift.endTime}` : ''}
          </p>
        </div>
        {data?.canEditShift && (
          <Button size="sm" variant="secondary" leadingIcon={<Settings2 size={16} />} onClick={() => setShiftOpen(true)}>
            Shift settings
          </Button>
        )}
      </div>

      {s && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MiniStat icon={<LogIn size={18} />} label="Working now" value={s.inNow} tone="bg-success/10 text-success" />
          <MiniStat icon={<Coffee size={18} />} label="On break" value={s.onBreakNow} tone="bg-warning/10 text-warning" />
          <MiniStat icon={<LogOut size={18} />} label="Checked out" value={s.outNow} tone="bg-slate-100 text-ink-muted" />
          <MiniStat icon={<UserX size={18} />} label="Not in yet" value={s.notInNow} tone="bg-danger/10 text-danger" />
        </div>
      )}

      {data && (
        <Card title="Who's in now" subtitle={`${data.summary.members} people in view`}>
          {data.board.length === 0 ? (
            <p className="py-4 text-center text-body-sm text-ink-muted">No members in scope.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {[...data.board]
                .sort((a, b) => ['IN', 'ON_BREAK', 'OUT', 'NOT_IN'].indexOf(a.state) - ['IN', 'ON_BREAK', 'OUT', 'NOT_IN'].indexOf(b.state))
                .map((b) => (
                  <div key={b.userId} className="flex items-center gap-2 rounded-full border border-line bg-bg py-1 pl-1 pr-3">
                    <span className={'flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold text-ink ' + toneBg(b.state)}>
                      {initials(b.name)}
                    </span>
                    <span className="text-body-sm font-medium text-ink">{b.name.split(' ')[0]}</span>
                    <span className={'h-2 w-2 rounded-full ' + dotColor(b.state)} title={STATE_META[b.state].label} />
                  </div>
                ))}
            </div>
          )}
        </Card>
      )}

      <Card flush>
        {loading ? (
          <div className="p-5 text-body-md text-ink-muted">Loading…</div>
        ) : (
          <DataTable columns={columns} rows={data?.rows ?? []} getRowId={(r) => r.userId} onRowClick={(r) => setSelected(r)} emptyMessage="No members to show." />
        )}
      </Card>

      {shiftOpen && data && (
        <ShiftModal current={data.shift} scope={data.scope} onClose={() => setShiftOpen(false)} onSaved={(shift) => { setData({ ...data, shift }); setShiftOpen(false) }} />
      )}
      {selected && (
        <MemberModal member={selected} range={range} custom={custom} onClose={() => setSelected(null)} onCorrected={reload} />
      )}
    </div>
  )
}

function initials(name: string): string {
  return name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()
}
function toneBg(state: ClockState): string {
  return { IN: 'bg-success/15', ON_BREAK: 'bg-warning/15', OUT: 'bg-slate-200', NOT_IN: 'bg-danger/15' }[state]
}
function dotColor(state: ClockState): string {
  return { IN: 'bg-success', ON_BREAK: 'bg-warning', OUT: 'bg-slate-400', NOT_IN: 'bg-danger' }[state]
}

function ShiftModal({ current, scope, onClose, onSaved }: { current: Shift; scope: 'COMPANY' | 'DEPARTMENT'; onClose: () => void; onSaved: (s: Shift) => void }) {
  const { addToast } = useToast()
  const [startTime, setStartTime] = useState(current.startTime)
  const [endTime, setEndTime] = useState(current.endTime)
  const [graceMin, setGraceMin] = useState(current.graceMin)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      const { shift } = await putAttendanceShift({ startTime, endTime, graceMin })
      addToast({ type: 'success', message: 'Shift updated.' })
      onSaved(shift)
    } catch (e) {
      addToast({ type: 'error', message: errMsg(e, 'Could not save shift.') })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Shift settings" size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>Save</Button></>}>
      <div className="space-y-4">
        <p className="text-body-sm text-ink-muted">
          {scope === 'COMPANY' ? 'Company-wide expected hours.' : 'Expected hours for your department.'} Drives late / early-leave flags.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start time"><input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={inputCls} /></Field>
          <Field label="End time"><input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={inputCls} /></Field>
        </div>
        <Field label="Grace period (minutes)">
          <input type="number" min={0} max={120} value={graceMin} onChange={(e) => setGraceMin(Number(e.target.value))} className={inputCls} />
        </Field>
        <p className="text-body-sm text-ink-muted">Check-ins after {startTime} + {graceMin} min count as late.</p>
      </div>
    </Modal>
  )
}

function MemberModal({ member, range, custom, onClose, onCorrected }: { member: TeamAttendanceRow; range: import('../../../components/layout/RangeSelector').RangeKey; custom: import('../../../components/layout/RangeSelector').CustomRange | null; onClose: () => void; onCorrected: () => void }) {
  const { addToast } = useToast()
  const [rows, setRows] = useState<AttendanceDayRow[] | null>(null)
  const [editDate, setEditDate] = useState<string | null>(null)
  const [checkIn, setCheckIn] = useState('')
  const [checkOut, setCheckOut] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getAttendanceHistory(range, custom, member.userId)
      .then((r) => setRows(r.rows))
      .catch(() => setRows([]))
  }, [member.userId, range, custom])

  function startEdit(r: AttendanceDayRow) {
    setEditDate(r.date)
    setCheckIn(r.checkIn ?? '')
    setCheckOut(r.checkOut ?? '')
  }

  async function save() {
    if (!editDate) return
    setSaving(true)
    try {
      await correctAttendanceDay(member.userId, editDate, { checkIn: checkIn || null, checkOut: checkOut || null })
      addToast({ type: 'success', message: 'Times updated.' })
      const r = await getAttendanceHistory(range, custom, member.userId)
      setRows(r.rows)
      setEditDate(null)
      onCorrected()
    } catch (e) {
      addToast({ type: 'error', message: errMsg(e, 'Could not save.') })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={member.name} size="lg">
      <p className="mb-3 text-body-sm text-ink-muted">Attendance history — click a day to correct times.</p>
      {rows == null ? (
        <div className="py-6 text-center text-body-sm text-ink-muted">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="py-6 text-center text-body-sm text-ink-muted">No records in this period.</div>
      ) : (
        <div className="max-h-[60vh] space-y-1.5 overflow-y-auto">
          {rows.map((r) => (
            <div key={r.date} className="rounded-card border border-line">
              <div className="flex items-center gap-3 px-3 py-2.5">
                <div className="w-28 shrink-0 text-body-sm font-medium text-ink">{fmtDate(r.date)}</div>
                <Badge tone={r.label === 'PRESENT' ? 'success' : r.label === 'ABSENT' ? 'danger' : 'neutral'}>{r.label === 'PRESENT' ? 'Present' : r.label === 'ABSENT' ? 'Absent' : r.label === 'HOLIDAY' ? 'Holiday' : r.label === 'ON_LEAVE' ? 'Leave' : 'Off'}</Badge>
                <div className="flex-1 text-body-sm tabular-nums text-ink-muted">
                  {r.checkIn ?? '—'} → {r.checkOut ?? '—'} · {formatMinutes(r.workedMin)}
                  {r.late && <span className="ml-2 text-warning">Late</span>}
                </div>
                <button onClick={() => startEdit(r)} className="flex h-8 w-8 items-center justify-center rounded-btn text-ink-muted hover:bg-slate-100 hover:text-primary" title="Edit times">
                  <Pencil size={14} />
                </button>
              </div>
              {editDate === r.date && (
                <div className="flex flex-wrap items-end gap-3 border-t border-line bg-bg px-3 py-3">
                  <Field label="Check in"><input type="time" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} className={inputCls} /></Field>
                  <Field label="Check out"><input type="time" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} className={inputCls} /></Field>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={save} disabled={saving}>Save</Button>
                    <Button size="sm" variant="secondary" onClick={() => setEditDate(null)}>Cancel</Button>
                  </div>
                  <p className="w-full text-[11px] text-ink-muted">Leave a field empty to clear it. Times are in company time.</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

const inputCls = 'h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-body-sm font-semibold text-ink">{label}</span>
      {children}
    </label>
  )
}
