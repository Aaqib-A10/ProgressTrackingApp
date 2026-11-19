import { useCallback, useEffect, useState } from 'react'
import { Check, ClockAlert, X } from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { Badge, type BadgeTone } from '../ui/Badge'
import { useToast } from '../ui/Toast'
import {
  askAttendanceFix, myFixRequests, cancelFixRequest, teamFixRequests, decideFixRequest,
  type AttendanceDayRow, type FixRequest, type WfhRequestStatus,
} from '../../lib/attendanceApi'

/**
 * Forgot to check in (or out): the person asks their Team Lead to put the right times on that day
 * (server attendanceFixController). Their side: a button on the day and their recent requests; the lead's
 * side: waiting requests with Approve / Reject (approved times go on the day like the lead's own correction).
 */

function errMsg(e: unknown, fallback: string): string {
  const m = (e as { message?: string })?.message
  if (!m) return fallback
  try { return (JSON.parse(m) as { error?: string }).error || fallback } catch { return m }
}

const STATUS: Record<WfhRequestStatus, { tone: BadgeTone; text: string }> = {
  PENDING: { tone: 'warning', text: 'Waiting for approval' },
  APPROVED: { tone: 'success', text: 'Fixed' },
  REJECTED: { tone: 'danger', text: 'Not approved' },
  CANCELLED: { tone: 'neutral', text: 'Taken back' },
}

const inputCls = 'h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'
export const fixDay = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const fixTimes = (r: Pick<FixRequest, 'checkIn' | 'checkOut'>) => (r.checkOut ? `${r.checkIn} – ${r.checkOut}` : `in at ${r.checkIn}`)

/** My requests, shared by the day buttons and the card (reload after sending or taking one back). */
export function useMyFixRequests(): { rows: FixRequest[] | null; reload: () => void } {
  const [rows, setRows] = useState<FixRequest[] | null>(null)
  const reload = useCallback(() => { myFixRequests().then((r) => setRows(r.requests)).catch(() => setRows([])) }, [])
  useEffect(reload, [reload])
  return { rows, reload }
}

/** A day that can be asked for: a missed working day, or a past day with a check-in and no check-out. */
export function canAskFix(r: AttendanceDayRow, today: string): boolean {
  if (r.date > today) return false
  if (r.label === 'ABSENT') return true
  return r.label === 'PRESENT' && !!r.checkIn && !r.checkOut && r.date < today
}

/** On one day of my history: "Ask to fix" (opens the form), or where my request for that day stands. */
export function FixDayAction({ row, shift, requests, onSent }: { row: AttendanceDayRow; shift: { startTime: string; endTime: string }; requests: FixRequest[]; onSent: () => void }) {
  const [open, setOpen] = useState(false)
  const mine = requests.filter((q) => q.date === row.date && q.status !== 'CANCELLED')[0]
  if (mine?.status === 'PENDING') return <Badge tone="warning" dot>Fix asked</Badge>
  return (
    <>
      {mine?.status === 'REJECTED' && <Badge tone="danger">Fix not approved</Badge>}
      <button type="button" onClick={() => setOpen(true)} className="inline-flex h-6 items-center gap-1 rounded-md border border-line bg-card px-2 text-[12px] font-semibold text-primary-ink shadow-xs hover:border-line-strong">
        <ClockAlert size={12} /> Ask to fix
      </button>
      {open && <FixRequestModal date={row.date} checkIn={row.checkIn ?? shift.startTime} checkOut={row.checkOut ?? shift.endTime} onClose={() => setOpen(false)} onSent={() => { setOpen(false); onSent() }} />}
    </>
  )
}

/** The form: the day's real times and a reason, sent to the Team Lead. */
export function FixRequestModal({ date, checkIn, checkOut, onClose, onSent }: { date: string; checkIn: string; checkOut: string; onClose: () => void; onSent: () => void }) {
  const { addToast } = useToast()
  const [inAt, setIn] = useState(checkIn)
  const [outAt, setOut] = useState(checkOut)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  async function send() {
    if (reason.trim().length < 3) { addToast({ type: 'error', message: 'Give a short reason.' }); return }
    setSaving(true)
    try {
      await askAttendanceFix({ date, checkIn: inAt, checkOut: outAt || undefined, reason: reason.trim() })
      addToast({ type: 'success', message: 'Sent to your Team Lead. You will be told when it is decided.' })
      onSent()
    } catch (e) {
      addToast({ type: 'error', message: errMsg(e, 'Could not send the request.') })
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal open onClose={onClose} title={`Fix ${fixDay(date)}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={send} disabled={saving || !inAt}>Send to Team Lead</Button></>}>
      <div className="space-y-3">
        <p className="text-body-sm text-ink-muted">Forgot to check in or out? Put the times you really worked. Your Team Lead gets a notice and approves or rejects it.</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-body-sm font-semibold text-ink">Checked in at</span>
            <input type="time" value={inAt} onChange={(e) => setIn(e.target.value)} className={inputCls} required />
          </label>
          <label className="block">
            <span className="mb-1 block text-body-sm font-semibold text-ink">Checked out at</span>
            <input type="time" value={outAt} onChange={(e) => setOut(e.target.value)} className={inputCls} />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-body-sm font-semibold text-ink">Reason</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} placeholder="For example: I was in the office but forgot to press Check in." className="w-full rounded-btn border border-line bg-card px-3 py-2 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10" />
        </label>
      </div>
    </Modal>
  )
}

/** My recent requests (hidden until there is one). */
export function MyFixRequests({ rows, reload }: { rows: FixRequest[] | null; reload: () => void }) {
  const { addToast } = useToast()
  const recent = (rows ?? []).filter((r) => r.status !== 'CANCELLED').slice(0, 5)
  if (!recent.length) return null
  async function takeBack(r: FixRequest) {
    try { await cancelFixRequest(r.id); addToast({ type: 'success', message: 'Request taken back.' }); reload() } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not take it back.') }) }
  }
  return (
    <Card title="Attendance fixes" subtitle="Days you asked your Team Lead to fix. Use “Ask to fix” on a day below to ask for another.">
      <ul className="divide-y divide-line">
        {recent.map((r) => (
          <li key={r.id} className="flex flex-wrap items-start gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-body-md font-medium text-ink">{fixDay(r.date)}</span>
                <span className="text-body-sm tabular-nums text-ink-muted">{fixTimes(r)}</span>
                <Badge tone={STATUS[r.status].tone} dot>{STATUS[r.status].text}</Badge>
              </div>
              <p className="text-body-sm text-ink-muted">{r.reason}</p>
              {r.decidedBy && <p className="text-body-sm text-ink-muted">{r.status === 'APPROVED' ? 'Fixed' : 'Decided'} by {r.decidedBy}{r.decisionNote ? `: ${r.decisionNote}` : ''}</p>}
            </div>
            {r.status === 'PENDING' && <Button size="sm" variant="ghost" onClick={() => takeBack(r)}>Take back</Button>}
          </li>
        ))}
      </ul>
    </Card>
  )
}

/** The Team Lead's side: waiting requests with Approve / Reject. Hidden when there are none. */
export function TeamFixInbox({ onDecided, highlight }: { onDecided?: () => void; highlight?: boolean }) {
  const { addToast } = useToast()
  const [rows, setRows] = useState<FixRequest[]>([])
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const load = () => { teamFixRequests('PENDING').then((r) => setRows(r.requests)).catch(() => setRows([])) }
  useEffect(load, [])

  async function decide(r: FixRequest, approve: boolean) {
    setBusy(r.id)
    try {
      await decideFixRequest(r.id, approve, notes[r.id]?.trim() || undefined)
      addToast({ type: 'success', message: approve ? `Fixed: ${r.name}'s ${fixDay(r.date)} now shows ${fixTimes(r)}.` : `Not approved. ${r.name} has been told.` })
      load()
      onDecided?.()
    } catch (e) {
      addToast({ type: 'error', message: errMsg(e, 'Could not save the decision.') })
    } finally {
      setBusy(null)
    }
  }

  if (rows.length === 0) return null
  return (
    <Card
      title={<span className="flex items-center gap-2"><ClockAlert size={16} className="text-warning-ink" />Forgot to check in <Badge tone="warning">{rows.length}</Badge></span>}
      subtitle="People asking you to put in the times of a day they forgot to check in or out. Approving puts the times on that day."
      className={highlight ? 'ring-2 ring-primary/30' : undefined}
    >
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-body-md font-semibold text-ink">{r.name}</p>
              <p className="text-body-sm text-ink"><span className="font-medium">{fixDay(r.date)}</span> · <span className="tabular-nums">{fixTimes(r)}</span></p>
              <p className="text-body-sm text-ink-muted">{r.reason}</p>
            </div>
            <input
              value={notes[r.id] ?? ''}
              onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
              placeholder="Note (optional)"
              className="h-9 w-48 rounded-btn border border-line bg-card px-3 text-body-sm text-ink focus:border-primary focus:outline-none"
            />
            <Button size="sm" leadingIcon={<Check size={14} />} disabled={busy === r.id} onClick={() => decide(r, true)}>Approve</Button>
            <Button size="sm" variant="secondary" leadingIcon={<X size={14} />} disabled={busy === r.id} onClick={() => decide(r, false)}>Reject</Button>
          </li>
        ))}
      </ul>
    </Card>
  )
}
