import { useEffect, useMemo, useRef, useState } from 'react'
import { BellOff, CalendarClock, Check, Clock3, ListPlus, MessageSquarePlus, MoreHorizontal, Phone, PhoneCall, X } from 'lucide-react'
import { Modal } from '../../../../components/ui/Modal'
import { Button } from '../../../../components/ui/Button'
import { useToast } from '../../../../components/ui/Toast'
import { cn } from '../../../../lib/cn'
import { dialerApi, type BulkAction, type DialerLead, type DialerTask, type Outcome } from '../../../../lib/dialerApi'
import { OUTCOMES, TASK_KINDS, leadRegion, matchesSearch, REGION_META, type FollowUpRow } from '../../../../lib/dialer'
import { ActionModal, NoteModal, errMsg, toLocalInput } from './ui'

/**
 * Follow-ups pieces (ITAD revised spec, 30 Oct 2026): the overdue pill, Call now (copies the
 * number), the five one-tap outcome chips, the "..." menu (Call later, Snooze, Add touch, Log
 * note, Add task), the Add touch and Add task panels, and the bulk bar.
 */

const inputCls = 'h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'
const today = () => new Date().toISOString().slice(0, 10)

/** Overdue: softer colours that scale with how far past its rule a lead is, never the whole row in red. */
const LEVEL: Record<number, string> = {
  0: 'bg-slate-100 text-ink-muted',
  1: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  2: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200 dark:bg-orange-400/10 dark:text-orange-300 dark:ring-orange-400/30',
  3: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200 dark:bg-rose-400/10 dark:text-rose-300 dark:ring-rose-400/30',
  4: 'bg-rose-100 text-rose-700 ring-1 ring-rose-300 dark:bg-rose-500/20 dark:text-rose-200 dark:ring-rose-400/40',
}
export function QuietPill({ row }: { row: FollowUpRow }) {
  const over = row.rule != null && row.ruleDue ? row.days - row.rule : null
  return (
    <div className="min-w-0">
      <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-semibold tabular-nums', LEVEL[row.level])} title={over != null ? `${over} days past the ${row.rule}-day rule` : undefined}>
        {row.days}d quiet
      </span>
      {row.why && <p className="mt-0.5 truncate text-[11.5px] text-ink-muted">{row.why}</p>}
    </div>
  )
}

/** The lead's own clock, e.g. "10:42 AM", and whether it is inside calling hours. */
export function LocalTime({ lead, now, open }: { lead: DialerLead; now: Date; open?: boolean }) {
  const r = leadRegion(lead, now)
  if (!r) return <span className="text-[11.5px] text-ink-faint">time zone unknown</span>
  const t = now.toLocaleTimeString('en-US', { timeZone: REGION_META[r].zone, hour: 'numeric', minute: '2-digit' })
  return (
    <span className="inline-flex items-center gap-1 text-[11.5px] text-ink-muted">
      <span className={cn('h-1.5 w-1.5 rounded-full', open ? 'bg-success' : 'bg-slate-300')} />{t} {r}
      {lead.verifyZone && !lead.zoneOverride && <span className="rounded bg-warning/15 px-1 text-[10px] font-bold text-warning" title="The state has two time zones: check the city or area code">verify zone</span>}
    </span>
  )
}

/** Call now: copies the number for the rep to dial in their phone. It is not a touch by itself. */
export function CallNow({ lead, onCalled, compact }: { lead: DialerLead; onCalled: () => void; compact?: boolean }) {
  const { addToast } = useToast()
  async function go() {
    if (!lead.phone) { addToast({ type: 'error', message: 'No phone number on this lead.' }); return }
    try { await navigator.clipboard?.writeText(lead.phone) } catch { /* clipboard blocked */ }
    dialerApi.action(lead.id, { kind: 'CALL_NOW' }).catch(() => undefined) // in the lead's activity, not a touch
    addToast({ type: 'success', message: `${lead.phone} copied. After the call, tap what happened.` })
    onCalled()
  }
  return (
    <button type="button" onClick={go} className={cn('inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-btn bg-primary px-2.5 font-semibold text-white shadow-xs hover:bg-primary-700', compact ? 'h-7 text-[12px]' : 'h-8 text-body-sm')}>
      <Phone size={13} />Call now
    </button>
  )
}

/** The five outcomes, one tap each: logs a touch without opening the lead. */
export function OutcomeChips({ lead, onDone, onClose }: { lead: DialerLead; onDone: () => void; onClose?: () => void }) {
  const { addToast } = useToast()
  const [busy, setBusy] = useState(false)
  async function log(o: Outcome) {
    setBusy(true)
    try { await dialerApi.addTouch(lead.id, { outcome: o }); addToast({ type: 'success', message: `${OUTCOMES.find((x) => x.key === o)!.label} logged for ${lead.company}.` }); onDone() } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not log it') }) } finally { setBusy(false) }
  }
  return (
    <div className="flex flex-wrap items-center gap-1" onClick={(e) => e.stopPropagation()}>
      {OUTCOMES.map((o) => (
        <button key={o.key} type="button" disabled={busy} onClick={() => log(o.key)} className={cn('h-7 rounded-full border px-2.5 text-[12px] font-semibold transition-colors disabled:opacity-50',
          o.key === 'CONNECTED' ? 'border-success/40 text-success hover:bg-success/10' : o.key === 'WRONG_NUMBER' ? 'border-danger/30 text-danger hover:bg-danger/10' : 'border-line text-ink hover:border-primary hover:text-primary')}>{o.label}</button>
      ))}
      {onClose && <button type="button" onClick={onClose} className="rounded-full p-1 text-ink-faint hover:text-ink" aria-label="Hide the outcomes"><X size={13} /></button>}
    </div>
  )
}

/** "...": Call later, Snooze, Add touch, Log note, Add task. */
export function RowMenu({ lead, onDone, leads }: { lead: DialerLead; onDone: () => void; leads: DialerLead[] }) {
  const [open, setOpen] = useState(false)
  const [modal, setModal] = useState<null | 'CALL_LATER' | 'SNOOZE' | 'TOUCH' | 'NOTE' | 'TASK'>(null)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', off)
    return () => window.removeEventListener('mousedown', off)
  }, [open])
  const item = (k: NonNullable<typeof modal>, label: string, Icon: typeof Clock3) => (
    <button type="button" onClick={() => { setModal(k); setOpen(false) }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-body-sm text-ink hover:bg-slate-50"><Icon size={14} className="text-ink-muted" />{label}</button>
  )
  const done = () => { setModal(null); onDone() }
  return (
    <div ref={box} className="relative" onClick={(e) => e.stopPropagation()}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex h-7 w-7 items-center justify-center rounded-btn border border-line text-ink-muted hover:bg-slate-50 hover:text-ink" aria-label="More actions" aria-expanded={open}><MoreHorizontal size={15} /></button>
      {open && (
        <div className="absolute right-0 top-8 z-30 w-44 overflow-hidden rounded-card border border-line bg-card py-1 shadow-overlay">
          {item('CALL_LATER', 'Call later', Clock3)}
          {item('SNOOZE', 'Snooze', BellOff)}
          {item('TOUCH', 'Add touch', PhoneCall)}
          {item('NOTE', 'Log note', MessageSquarePlus)}
          {item('TASK', 'Add task', ListPlus)}
        </div>
      )}
      {(modal === 'CALL_LATER' || modal === 'SNOOZE') && <ActionModal lead={lead} kind={modal} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'NOTE' && <NoteModal lead={lead} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'TOUCH' && <AddTouchModal lead={lead} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'TASK' && <AddTaskModal leads={leads} leadId={lead.id} onClose={() => setModal(null)} onDone={done} />}
    </div>
  )
}

/** Add touch: a call that happened (backdating allowed), with what happened if you like. */
export function AddTouchModal({ lead, onClose, onDone }: { lead: Pick<DialerLead, 'id' | 'company'>; onClose: () => void; onDone: () => void }) {
  const { addToast } = useToast()
  const [day, setDay] = useState(today())
  const [outcome, setOutcome] = useState<Outcome | ''>('')
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    try { await dialerApi.addTouch(lead.id, { at: day, outcome: outcome || null }); addToast({ type: 'success', message: 'Touch logged.' }); onDone() } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not log it') }) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={`Add touch · ${lead.company}`} size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy || !day} onClick={save}>Log touch</Button></>}>
      <div className="space-y-3">
        <label className="block"><span className="mb-1 block text-body-sm font-semibold text-ink">When</span><input type="date" value={day} max={today()} onChange={(e) => setDay(e.target.value)} className={inputCls} /></label>
        <div>
          <span className="mb-1.5 block text-body-sm font-semibold text-ink">What happened (optional)</span>
          <div className="flex flex-wrap gap-1.5">
            {OUTCOMES.map((o) => <button key={o.key} type="button" onClick={() => setOutcome(outcome === o.key ? '' : o.key)} className={cn('rounded-full border px-3 py-1 text-body-sm font-medium', outcome === o.key ? 'border-primary bg-primary text-white' : 'border-line text-ink hover:border-primary')}>{o.label}</button>)}
          </div>
        </div>
        <p className="text-[12px] leading-relaxed text-ink-muted">A touch is one try at reaching the lead. Several calls between two imports count once, so import at the start of each shift. A call already in the next import is not counted twice.</p>
      </div>
    </Modal>
  )
}

/** + Add task: lead, type, due date and time, note, reminders. */
export function AddTaskModal({ leads, leadId, onClose, onDone }: { leads: DialerLead[]; leadId?: string; onClose: () => void; onDone: () => void }) {
  const { addToast } = useToast()
  const [pick, setPick] = useState(leadId ?? '')
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<DialerTask['kind']>('CALL')
  const [due, setDue] = useState(toLocalInput(new Date(Date.now() + 3600000)))
  const [note, setNote] = useState('')
  const [before, setBefore] = useState(true)
  const [atDue, setAtDue] = useState(true)
  const [busy, setBusy] = useState(false)
  const lead = leads.find((l) => l.id === pick)
  const found = useMemo(() => (q.trim().length >= 2 ? leads.filter((l) => matchesSearch(l, q)).slice(0, 8) : []), [leads, q])
  async function save() {
    if (!pick) return
    setBusy(true)
    try {
      await dialerApi.addTask({ leadId: pick, kind, dueAt: new Date(due).toISOString(), note: note.trim() || undefined, reminders: [...(before ? [15] : []), ...(atDue ? [0] : [])] })
      addToast({ type: 'success', message: `Task added${lead ? ` for ${lead.company}` : ''}.` })
      onDone()
    } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not add the task') }) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title="Add task" size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy || !pick || !due} onClick={save}>Add task</Button></>}>
      <div className="space-y-3">
        <div>
          <span className="mb-1 block text-body-sm font-semibold text-ink">Lead</span>
          {lead ? (
            <div className="flex items-center justify-between rounded-btn border border-line bg-slate-50 px-3 py-2 text-body-sm">
              <span className="min-w-0 truncate"><b className="text-ink">{lead.company}</b>{lead.contactName ? <span className="text-ink-muted"> · {lead.contactName}</span> : null}</span>
              {!leadId && <button type="button" onClick={() => setPick('')} className="text-[12px] font-semibold text-primary">Change</button>}
            </div>
          ) : (
            <div>
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Company, name, phone or email" className={inputCls} />
              {found.length > 0 && (
                <ul className="mt-1 max-h-48 overflow-y-auto rounded-btn border border-line">
                  {found.map((l) => <li key={l.id}><button type="button" onClick={() => setPick(l.id)} className="block w-full px-3 py-1.5 text-left text-body-sm hover:bg-slate-50"><b className="text-ink">{l.company}</b><span className="text-ink-muted">{l.contactName ? ` · ${l.contactName}` : ''} · {l.status}</span></button></li>)}
                </ul>
              )}
            </div>
          )}
        </div>
        <div>
          <span className="mb-1 block text-body-sm font-semibold text-ink">Type</span>
          <div className="inline-flex rounded-btn border border-line p-0.5">
            {TASK_KINDS.map((k) => <button key={k.key} type="button" onClick={() => setKind(k.key)} className={cn('rounded-md px-3 py-1 text-body-sm font-semibold', kind === k.key ? 'bg-primary text-white' : 'text-ink-muted hover:text-ink')}>{k.label}</button>)}
          </div>
        </div>
        <label className="block"><span className="mb-1 block text-body-sm font-semibold text-ink">Due (your time)</span><input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className={inputCls} /></label>
        <label className="block"><span className="mb-1 block text-body-sm font-semibold text-ink">Note (optional)</span><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} className="w-full rounded-btn border border-line bg-card px-3 py-2 text-body-md text-ink focus:border-primary focus:outline-none" /></label>
        <div className="space-y-1.5 text-body-sm text-ink">
          <span className="block font-semibold">Remind me in Metriq</span>
          <label className="flex items-center gap-2"><input type="checkbox" checked={before} onChange={(e) => setBefore(e.target.checked)} className="h-4 w-4 accent-primary" />15 minutes before</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={atDue} onChange={(e) => setAtDue(e.target.checked)} className="h-4 w-4 accent-primary" />At the due time</label>
          <p className="text-[12px] text-ink-muted">The reminder says whether the lead can be called then (9 AM to 5 PM on their clock).</p>
        </div>
      </div>
    </Modal>
  )
}

/** The bar over picked rows: Snooze, Reassign due date, Add task, Log touch (your own leads only). */
export function BulkBar({ ids, count, onClear, onDone }: { ids: string[]; count: number; onClear: () => void; onDone: () => void }) {
  const { addToast } = useToast()
  const [open, setOpen] = useState<BulkAction | null>(null)
  const [when, setWhen] = useState('')
  const [kind, setKind] = useState<DialerTask['kind']>('CALL')
  const [outcome, setOutcome] = useState<Outcome | ''>('')
  const [busy, setBusy] = useState(false)
  const start = (a: BulkAction) => {
    setOpen(a); setOutcome('')
    setWhen(a === 'LOG_TOUCH' ? today() : a === 'SNOOZE' ? toLocalInput(new Date(Date.now() + 3 * 86400000)) : toLocalInput(new Date(Date.now() + 86400000)))
  }
  async function run() {
    if (!open) return
    setBusy(true)
    try {
      const at = open === 'LOG_TOUCH' ? when : new Date(when).toISOString()
      const r = await dialerApi.bulk({ leadIds: ids, action: open, at, kind, outcome: outcome || null })
      addToast({ type: 'success', message: `${r.updated} ${open === 'RESCHEDULE' ? 'task' : 'lead'}${r.updated === 1 ? '' : 's'} done${r.skipped ? ` (${r.skipped} not yours, left as they were)` : ''}.` })
      setOpen(null); onClear(); onDone()
    } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not do that') }) } finally { setBusy(false) }
  }
  if (!count) return null
  const btn = 'inline-flex h-8 items-center gap-1.5 rounded-btn border border-white/15 bg-white/10 px-3 text-body-sm font-semibold text-white hover:bg-white/20'
  const title = open === 'SNOOZE' ? 'Snooze until' : open === 'RESCHEDULE' ? 'Move their open tasks to' : open === 'ADD_TASK' ? 'Add a task to each' : 'Log a touch on each'
  return (
    <>
      <div className="sticky bottom-3 z-20 mx-auto flex w-fit max-w-full flex-wrap items-center gap-2 rounded-card bg-ink px-3 py-2 text-white shadow-overlay dark:bg-slate-800">
        <span className="px-1 text-body-sm"><b className="tabular-nums">{count}</b> picked</span>
        <button type="button" className={btn} onClick={() => start('SNOOZE')}><BellOff size={14} />Snooze</button>
        <button type="button" className={btn} onClick={() => start('RESCHEDULE')}><CalendarClock size={14} />Reassign due date</button>
        <button type="button" className={btn} onClick={() => start('ADD_TASK')}><ListPlus size={14} />Add task</button>
        <button type="button" className={btn} onClick={() => start('LOG_TOUCH')}><Check size={14} />Log touch</button>
        <button type="button" onClick={onClear} className="rounded-full p-1.5 text-white/70 hover:bg-white/10 hover:text-white" aria-label="Clear the picked rows"><X size={15} /></button>
      </div>
      {open && (
        <Modal open onClose={() => setOpen(null)} title={`${title} · ${count} lead${count === 1 ? '' : 's'}`} size="sm" footer={<><Button variant="secondary" onClick={() => setOpen(null)}>Cancel</Button><Button disabled={busy || !when} onClick={run}>Apply</Button></>}>
          <div className="space-y-3">
            {open === 'ADD_TASK' && (
              <div className="inline-flex rounded-btn border border-line p-0.5">
                {TASK_KINDS.map((k) => <button key={k.key} type="button" onClick={() => setKind(k.key)} className={cn('rounded-md px-3 py-1 text-body-sm font-semibold', kind === k.key ? 'bg-primary text-white' : 'text-ink-muted')}>{k.label}</button>)}
              </div>
            )}
            {open === 'LOG_TOUCH'
              ? <input type="date" value={when} max={today()} onChange={(e) => setWhen(e.target.value)} className={inputCls} />
              : <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={inputCls} />}
            {open === 'LOG_TOUCH' && (
              <div className="flex flex-wrap gap-1.5">
                {OUTCOMES.map((o) => <button key={o.key} type="button" onClick={() => setOutcome(outcome === o.key ? '' : o.key)} className={cn('rounded-full border px-3 py-1 text-body-sm font-medium', outcome === o.key ? 'border-primary bg-primary text-white' : 'border-line text-ink')}>{o.label}</button>)}
              </div>
            )}
            {open === 'RESCHEDULE' && <p className="text-[12px] text-ink-muted">Moves the open call backs and tasks you added on these leads. Automatic follow-ups move by themselves once you log a touch.</p>}
            <p className="text-[12px] text-ink-muted">Only your own leads and tasks change.</p>
          </div>
        </Modal>
      )}
    </>
  )
}
