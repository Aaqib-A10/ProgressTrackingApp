import { useEffect, useState } from 'react'
import { LogIn, Coffee, LogOut, UserX, Settings2, Pencil, CalendarOff, Trash2 } from 'lucide-react'
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
  getUserShift,
  putUserShift,
  clearUserShift,
  markLeave,
  removeLeave,
  formatMinutes,
  type LeaveMarkType,
  type ClockState,
  type Shift,
  type TeamAttendanceResponse,
  type TeamAttendanceRow,
  type AttendanceDayRow,
} from '../../../lib/attendanceApi'

/** Minutes → decimal hours string for inputs, e.g. 480 → "8", 510 → "8.5". */
const minToHours = (min: number) => String(Math.round((min / 60) * 100) / 100)
const hoursToMin = (h: string) => Math.round((parseFloat(h) || 0) * 60)

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
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-ink">{r.name}</span>
            {r.hasOverride && <Badge tone="primary">Custom hours</Badge>}
          </div>
          {data?.scope === 'COMPANY' && <div className="text-body-sm text-ink-muted">{r.department}</div>}
        </div>
      ),
    },
    { key: 'today', header: 'Today', render: (r) => <Badge tone={STATE_META[r.todayState].tone} dot>{STATE_META[r.todayState].label}</Badge> },
    { key: 'present', header: 'Present', align: 'right', render: (r) => r.presentDays },
    {
      key: 'shifts',
      header: 'Shifts done',
      align: 'right',
      render: (r) => (
        <span className={r.presentDays > 0 && r.completedShifts === r.presentDays ? 'font-semibold text-success' : r.completedShifts < r.presentDays ? 'text-warning' : ''}>
          {r.completedShifts}/{r.presentDays}
        </span>
      ),
    },
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

/** Shared start/end/grace/required-hours editor used by the shift + per-account modals. */
function ShiftFields({ value, onChange }: { value: Shift; onChange: (s: Shift) => void }) {
  const set = (patch: Partial<Shift>) => onChange({ ...value, ...patch })
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start time"><input type="time" value={value.startTime} onChange={(e) => set({ startTime: e.target.value })} className={inputCls} /></Field>
        <Field label="End time"><input type="time" value={value.endTime} onChange={(e) => set({ endTime: e.target.value })} className={inputCls} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Grace (minutes)">
          <input type="number" min={0} max={120} value={value.graceMin} onChange={(e) => set({ graceMin: Number(e.target.value) })} className={inputCls} />
        </Field>
        <Field label="Required hours">
          <input type="number" min={0} max={24} step={0.5} value={minToHours(value.requiredMinutes)} onChange={(e) => set({ requiredMinutes: hoursToMin(e.target.value) })} className={inputCls} />
        </Field>
      </div>
      <p className="text-body-sm text-ink-muted">
        Late after {value.startTime} + {value.graceMin} min · a day counts as a completed shift once {formatMinutes(value.requiredMinutes)} are worked.
      </p>
    </div>
  )
}

function ShiftModal({ current, scope, onClose, onSaved }: { current: Shift; scope: 'COMPANY' | 'DEPARTMENT'; onClose: () => void; onSaved: (s: Shift) => void }) {
  const { addToast } = useToast()
  const [draft, setDraft] = useState<Shift>(current)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      const { shift } = await putAttendanceShift(draft)
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
      <p className="mb-3 text-body-sm text-ink-muted">
        {scope === 'COMPANY' ? 'Company-wide default hours (applies to everyone without their own department or personal hours).' : 'Default hours for your department.'}
      </p>
      <ShiftFields value={draft} onChange={setDraft} />
    </Modal>
  )
}

function WorkingHoursCard({ userId, onChanged }: { userId: string; onChanged: () => void }) {
  const { addToast } = useToast()
  const [info, setInfo] = useState<import('../../../lib/attendanceApi').UserShiftResponse | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Shift | null>(null)
  const [saving, setSaving] = useState(false)

  function load() {
    getUserShift(userId).then(setInfo).catch(() => setInfo(null))
  }
  useEffect(load, [userId])

  async function save() {
    if (!draft) return
    setSaving(true)
    try {
      await putUserShift(userId, draft)
      addToast({ type: 'success', message: 'Personal hours saved.' })
      setEditing(false)
      load()
      onChanged()
    } catch (e) {
      addToast({ type: 'error', message: errMsg(e, 'Could not save.') })
    } finally {
      setSaving(false)
    }
  }

  async function clear() {
    setSaving(true)
    try {
      await clearUserShift(userId)
      addToast({ type: 'success', message: 'Reverted to department hours.' })
      setEditing(false)
      load()
      onChanged()
    } catch (e) {
      addToast({ type: 'error', message: errMsg(e, 'Could not clear.') })
    } finally {
      setSaving(false)
    }
  }

  if (!info) return null
  const eff = info.effective

  return (
    <div className="mb-4 rounded-card border border-line bg-bg p-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-body-md font-semibold text-ink">Working hours</span>
            <Badge tone={info.override ? 'primary' : 'neutral'}>{info.override ? 'Personal' : 'Department/company'}</Badge>
          </div>
          <p className="mt-0.5 text-body-sm text-ink-muted">
            {eff.startTime}–{eff.endTime} · required {formatMinutes(eff.requiredMinutes)} · {eff.graceMin}m grace
          </p>
        </div>
        {!editing && (
          <Button size="sm" variant="secondary" onClick={() => { setDraft(info.override ?? info.fallback); setEditing(true) }}>
            {info.override ? 'Edit hours' : 'Set personal hours'}
          </Button>
        )}
      </div>
      {editing && draft && (
        <div className="mt-3 border-t border-line pt-3">
          <ShiftFields value={draft} onChange={setDraft} />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={save} disabled={saving}>Save personal hours</Button>
            {info.override && <Button size="sm" variant="secondary" onClick={clear} disabled={saving}>Use department hours</Button>}
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  )
}

function todayISO(): string {
  // Local calendar date (company users are single-tz); good enough for a date picker default.
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function LeaveCard({ userId, onChanged }: { userId: string; onChanged: () => void }) {
  const { addToast } = useToast()
  const [date, setDate] = useState(todayISO())
  const [type, setType] = useState<LeaveMarkType>('ON_LEAVE')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  async function mark() {
    if (!date) return
    setSaving(true)
    try {
      await markLeave(userId, date, { type, note: note.trim() || undefined })
      addToast({ type: 'success', message: `Marked ${type === 'ON_LEAVE' ? 'On Leave' : 'Off'} for ${date}.` })
      setNote('')
      onChanged()
    } catch (e) {
      addToast({ type: 'error', message: errMsg(e, 'Could not mark leave.') })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mb-4 rounded-card border border-line bg-bg p-3">
      <div className="mb-2 flex items-center gap-2">
        <CalendarOff size={16} className="text-ink-muted" />
        <span className="text-body-md font-semibold text-ink">Mark leave / off</span>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} /></Field>
        <Field label="Type">
          <select value={type} onChange={(e) => setType(e.target.value as LeaveMarkType)} className={inputCls}>
            <option value="ON_LEAVE">On Leave</option>
            <option value="OFF">Off</option>
          </select>
        </Field>
        <label className="block flex-1">
          <span className="mb-1 block text-body-sm font-semibold text-ink">Note (optional)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason…" className={inputCls} />
        </label>
        <Button size="sm" onClick={mark} disabled={saving}>Mark</Button>
      </div>
      <p className="mt-2 text-body-sm text-ink-muted">They can't clock in on a leave/off day, and it's excluded from worked-hours averages.</p>
    </div>
  )
}

function MemberModal({ member, range, custom, onClose, onCorrected }: { member: TeamAttendanceRow; range: import('../../../components/layout/RangeSelector').RangeKey; custom: import('../../../components/layout/RangeSelector').CustomRange | null; onClose: () => void; onCorrected: () => void }) {
  const { addToast } = useToast()
  const [rows, setRows] = useState<AttendanceDayRow[] | null>(null)
  const [editDate, setEditDate] = useState<string | null>(null)
  const [checkIn, setCheckIn] = useState('')
  const [checkOut, setCheckOut] = useState('')
  const [saving, setSaving] = useState(false)

  function loadRows() {
    getAttendanceHistory(range, custom, member.userId)
      .then((r) => setRows(r.rows))
      .catch(() => setRows([]))
  }
  useEffect(loadRows, [member.userId, range, custom])

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

  async function unmarkLeave(date: string) {
    try {
      await removeLeave(member.userId, date)
      addToast({ type: 'success', message: 'Leave removed.' })
      loadRows()
      onCorrected()
    } catch (e) {
      addToast({ type: 'error', message: errMsg(e, 'Could not remove leave.') })
    }
  }

  return (
    <Modal open onClose={onClose} title={member.name} size="lg">
      <WorkingHoursCard userId={member.userId} onChanged={() => { loadRows(); onCorrected() }} />
      <LeaveCard userId={member.userId} onChanged={() => { loadRows(); onCorrected() }} />
      <p className="mb-3 text-body-sm text-ink-muted">Attendance history — click a day to correct times, or remove a leave day.</p>
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
                  {r.label === 'PRESENT' && r.completed && <span className="ml-2 text-success">Full shift</span>}
                  {r.label === 'PRESENT' && !r.completed && r.shortMin != null && r.shortMin > 0 && <span className="ml-2 text-warning">Short {formatMinutes(r.shortMin)}</span>}
                </div>
                {r.label === 'ON_LEAVE' || r.label === 'OFF' ? (
                  <button onClick={() => unmarkLeave(r.date)} className="flex h-8 w-8 items-center justify-center rounded-btn text-ink-muted hover:bg-danger/10 hover:text-danger" title="Remove leave">
                    <Trash2 size={14} />
                  </button>
                ) : r.label === 'HOLIDAY' ? null : (
                  <button onClick={() => startEdit(r)} className="flex h-8 w-8 items-center justify-center rounded-btn text-ink-muted hover:bg-slate-100 hover:text-primary" title="Edit times">
                    <Pencil size={14} />
                  </button>
                )}
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
