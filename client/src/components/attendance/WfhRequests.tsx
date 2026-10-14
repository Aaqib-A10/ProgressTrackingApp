import { useEffect, useState } from 'react'
import { House, Check, X } from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { Badge, type BadgeTone } from '../ui/Badge'
import { useToast } from '../ui/Toast'
import {
  askWorkFromHome, myWfhRequests, cancelWfhRequest, teamWfhRequests, decideWfhRequest, wfhSpan,
  type WfhRequest, type WfhRequestStatus,
} from '../../lib/attendanceApi'

function errMsg(e: unknown, fallback: string): string {
  const m = (e as { message?: string })?.message
  if (!m) return fallback
  try { return (JSON.parse(m) as { error?: string }).error || fallback } catch { return m }
}

const STATUS: Record<WfhRequestStatus, { tone: BadgeTone; text: string }> = {
  PENDING: { tone: 'warning', text: 'Waiting for approval' },
  APPROVED: { tone: 'success', text: 'Approved' },
  REJECTED: { tone: 'danger', text: 'Not approved' },
  CANCELLED: { tone: 'neutral', text: 'Taken back' },
}

const inputCls = 'h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'

function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The employee's side: "Request work from home" and their recent requests. */
export function MyWfhRequests() {
  const { addToast } = useToast()
  const [rows, setRows] = useState<WfhRequest[] | null>(null)
  const [open, setOpen] = useState(false)
  const [start, setStart] = useState(localToday())
  const [end, setEnd] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const load = () => { myWfhRequests().then((r) => setRows(r.requests)).catch(() => setRows([])) }
  useEffect(load, [])

  async function send() {
    if (reason.trim().length < 3) { addToast({ type: 'error', message: 'Give a short reason.' }); return }
    setSaving(true)
    try {
      await askWorkFromHome({ startDate: start, endDate: end && end !== start ? end : undefined, reason: reason.trim() })
      addToast({ type: 'success', message: 'Request sent to your Team Lead.' })
      setOpen(false); setEnd(''); setReason('')
      load()
    } catch (e) {
      addToast({ type: 'error', message: errMsg(e, 'Could not send the request.') })
    } finally {
      setSaving(false)
    }
  }

  async function takeBack(r: WfhRequest) {
    try {
      await cancelWfhRequest(r.id)
      addToast({ type: 'success', message: 'Request taken back.' })
      load()
    } catch (e) {
      addToast({ type: 'error', message: errMsg(e, 'Could not take it back.') })
    }
  }

  const recent = (rows ?? []).filter((r) => r.status !== 'CANCELLED').slice(0, 5)

  return (
    <>
      <Card
        title="Work from home"
        subtitle="Ask your Team Lead. Once approved, you can check in from home on those days."
        action={<Button size="sm" leadingIcon={<House size={14} />} onClick={() => setOpen(true)}>Request work from home</Button>}
      >
        {rows == null ? (
          <p className="text-body-sm text-ink-muted">Loading…</p>
        ) : recent.length === 0 ? (
          <p className="text-body-sm text-ink-muted">No requests yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {recent.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-body-md font-medium text-ink">{wfhSpan(r)}</span>
                    <Badge tone={STATUS[r.status].tone} dot>{STATUS[r.status].text}</Badge>
                  </div>
                  <p className="text-body-sm text-ink-muted">{r.reason}</p>
                  {r.decidedBy && (
                    <p className="text-body-sm text-ink-muted">{r.status === 'APPROVED' ? 'Approved' : 'Decided'} by {r.decidedBy}{r.decisionNote ? `: ${r.decisionNote}` : ''}</p>
                  )}
                </div>
                {r.status === 'PENDING' && <Button size="sm" variant="ghost" onClick={() => takeBack(r)}>Take back</Button>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Request work from home"
        footer={<>
          <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={send} disabled={saving}>Send to Team Lead</Button>
        </>}
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-body-sm font-semibold text-ink">From</span>
              <input type="date" value={start} min={localToday()} onChange={(e) => setStart(e.target.value)} className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-body-sm font-semibold text-ink">Until (optional)</span>
              <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className={inputCls} />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-body-sm font-semibold text-ink">Reason</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} placeholder="Why do you need to work from home?" className="w-full rounded-btn border border-line bg-card px-3 py-2 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10" />
          </label>
          <p className="text-body-sm text-ink-muted">Only your working days count. Your Team Lead gets a notice and can approve or reject it.</p>
        </div>
      </Modal>
    </>
  )
}

/** The Team Lead's side: waiting requests with Approve / Reject. Hidden when there are none. */
export function TeamWfhInbox({ onDecided, highlight }: { onDecided?: () => void; highlight?: boolean }) {
  const { addToast } = useToast()
  const [rows, setRows] = useState<WfhRequest[]>([])
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const load = () => { teamWfhRequests('PENDING').then((r) => setRows(r.requests)).catch(() => setRows([])) }
  useEffect(load, [])

  async function decide(r: WfhRequest, approve: boolean) {
    setBusy(r.id)
    try {
      await decideWfhRequest(r.id, approve, notes[r.id]?.trim() || undefined)
      addToast({ type: 'success', message: approve ? `Approved: ${r.name} can check in from home on those days.` : `Not approved. ${r.name} has been told.` })
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
      title={<span className="flex items-center gap-2"><House size={16} className="text-accent" />Work from home requests <Badge tone="warning">{rows.length}</Badge></span>}
      subtitle="Approved days let them check in from any network. You see their hours here as usual."
      className={highlight ? 'ring-2 ring-primary/30' : undefined}
    >
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-body-md font-semibold text-ink">{r.name}</p>
              <p className="text-body-sm text-ink">{wfhSpan(r)}</p>
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
