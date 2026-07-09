import { useEffect, useState, type FormEvent } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { TextField } from '../../../components/ui/Input'
import { useToast } from '../../../components/ui/Toast'
import {
  listHolidays, createHoliday, deleteHoliday,
  listLeave, listLeaveMembers, createLeave, deleteLeave,
  type Holiday, type LeaveRow,
} from '../../../lib/adminApi'

const sel = 'h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'
const LEAVE_TONE = { ON_LEAVE: 'primary', HOLIDAY: 'accent', OFF: 'neutral', WFH: 'success' } as const

export default function AdminLeave() {
  const { addToast } = useToast()
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [leave, setLeave] = useState<LeaveRow[]>([])
  const [members, setMembers] = useState<{ id: string; name: string }[]>([])

  // holiday form
  const [hDate, setHDate] = useState('')
  const [hName, setHName] = useState('')
  // leave form
  const [lUser, setLUser] = useState('')
  const [lDate, setLDate] = useState('')
  const [lType, setLType] = useState<LeaveRow['type']>('ON_LEAVE')

  useEffect(() => {
    Promise.all([listHolidays(), listLeave(), listLeaveMembers()])
      .then(([h, l, m]) => {
        setHolidays(h.holidays)
        setLeave(l.leave)
        setMembers(m.members)
        if (m.members[0]) setLUser(m.members[0].id)
      })
      .catch(() => addToast({ type: 'error', message: 'Could not load leave data.' }))
  }, [addToast])

  async function addHoliday(e: FormEvent) {
    e.preventDefault()
    if (!hDate || !hName.trim()) return
    try {
      const { holiday } = await createHoliday({ date: hDate, name: hName })
      setHolidays((hs) => [...hs.filter((x) => x.date !== holiday.date), holiday].sort((a, b) => a.date.localeCompare(b.date)))
      setHName(''); setHDate('')
      addToast({ type: 'success', message: 'Holiday added.' })
    } catch {
      addToast({ type: 'error', message: 'Could not add holiday.' })
    }
  }

  async function removeHoliday(id: string) {
    setHolidays((hs) => hs.filter((h) => h.id !== id))
    await deleteHoliday(id).catch(() => addToast({ type: 'error', message: 'Delete failed.' }))
  }

  async function addLeave(e: FormEvent) {
    e.preventDefault()
    if (!lUser || !lDate) return
    try {
      const { leave: row } = await createLeave({ userId: lUser, date: lDate, type: lType })
      setLeave((ls) => [row, ...ls.filter((x) => x.id !== row.id)])
      setLDate('')
      addToast({ type: 'success', message: 'Leave recorded.' })
    } catch {
      addToast({ type: 'error', message: 'Could not record leave.' })
    }
  }

  async function removeLeave(id: string) {
    setLeave((ls) => ls.filter((l) => l.id !== id))
    await deleteLeave(id).catch(() => addToast({ type: 'error', message: 'Delete failed.' }))
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <h1 className="text-headline-lg text-ink">Holidays & Leave</h1>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Holidays */}
        <Card title="Company Holidays" subtitle="Excluded from averages for everyone">
          <form onSubmit={addHoliday} className="mb-4 flex items-end gap-2">
            <div className="flex-1">
              <label className="mb-1 block text-body-sm font-semibold text-ink">Date</label>
              <input type="date" className={sel} value={hDate} onChange={(e) => setHDate(e.target.value)} />
            </div>
            <div className="flex-1">
              <TextField label="Name" value={hName} onChange={(e) => setHName(e.target.value)} placeholder="e.g. Eid" />
            </div>
            <Button type="submit" leadingIcon={<Plus size={16} />}>Add</Button>
          </form>
          <ul className="divide-y divide-line">
            {holidays.map((h) => (
              <li key={h.id} className="flex items-center justify-between py-2">
                <span className="text-body-md text-ink"><span className="tabular-nums text-ink-muted">{h.date}</span> · {h.name}</span>
                <button onClick={() => removeHoliday(h.id)} className="rounded p-1 text-ink-muted hover:bg-danger/10 hover:text-danger"><Trash2 size={15} /></button>
              </li>
            ))}
            {holidays.length === 0 && <li className="py-3 text-body-sm text-ink-muted">No holidays yet.</li>}
          </ul>
        </Card>

        {/* Leave */}
        <Card title="Member Leave" subtitle="Per-person leave/off days">
          <form onSubmit={addLeave} className="mb-4 grid grid-cols-2 items-end gap-2">
            <div className="col-span-2">
              <label className="mb-1 block text-body-sm font-semibold text-ink">Member</label>
              <select className={sel} value={lUser} onChange={(e) => setLUser(e.target.value)}>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-body-sm font-semibold text-ink">Date</label>
              <input type="date" className={sel} value={lDate} onChange={(e) => setLDate(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-body-sm font-semibold text-ink">Type</label>
              <select className={sel} value={lType} onChange={(e) => setLType(e.target.value as LeaveRow['type'])}>
                <option value="ON_LEAVE">On Leave</option>
                <option value="OFF">Off</option>
                <option value="HOLIDAY">Holiday</option>
                <option value="WFH">Work From Home</option>
              </select>
            </div>
            <Button type="submit" className="col-span-2" leadingIcon={<Plus size={16} />}>Record Leave</Button>
          </form>
          <ul className="divide-y divide-line">
            {leave.map((l) => (
              <li key={l.id} className="flex items-center justify-between py-2">
                <span className="flex items-center gap-2 text-body-md text-ink">
                  <span className="tabular-nums text-ink-muted">{l.date}</span> · {l.userName}
                  <Badge tone={LEAVE_TONE[l.type]}>{l.type.replace('_', ' ').toLowerCase()}</Badge>
                </span>
                <button onClick={() => removeLeave(l.id)} className="rounded p-1 text-ink-muted hover:bg-danger/10 hover:text-danger"><Trash2 size={15} /></button>
              </li>
            ))}
            {leave.length === 0 && <li className="py-3 text-body-sm text-ink-muted">No leave recorded.</li>}
          </ul>
        </Card>
      </div>
    </div>
  )
}
