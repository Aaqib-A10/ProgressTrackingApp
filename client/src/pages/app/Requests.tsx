import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Check, ClipboardCheck, Plus, Trash2, X } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Badge, type BadgeTone } from '../../components/ui/Badge'
import { Modal } from '../../components/ui/Modal'
import { PillFilter } from '../../components/ui/PillFilter'
import { EmptyState } from '../../components/ui/EmptyState'
import { useToast } from '../../components/ui/Toast'
import { areaCls, dayLabel, daysBetween, errMsg, inputCls, labelCls, whenLabel } from '../../lib/biz'

/**
 * Requests: ask for an expense, a purchase, leave or anything else, and see it through. The people the company's
 * rules name approve it in turn. One page for what I asked, what waits on me, and (leads and admins) the team's.
 */

type Kind = 'EXPENSE' | 'PURCHASE' | 'LEAVE' | 'OTHER'
type Box = 'mine' | 'waiting' | 'all'
interface Step { position: number; approver: string; status: string; by: string | null; note: string; decidedAt: string | null }
interface Req {
  id: string; number: number; kind: Kind; title: string; details: string; amount: number | null; currency: string; days: string[]; leaveKind: string | null
  line: string; status: string; requester: { id: string; name: string }; createdAt: string; decidedAt: string | null; steps: Step[]; waitingOn: string[]
  mine: boolean; canDecide: boolean; canCancel: boolean
}
interface InboxItem { key: string; label: string; count: number; link: string }
interface Balance { allowed: number | null; used: number; waiting: number; left: number | null }
interface Rule { kind: Kind; minAmount: number | null; chain: string[] }

const KIND_LABEL: Record<Kind, string> = { EXPENSE: 'Expense', PURCHASE: 'Purchase', LEAVE: 'Leave', OTHER: 'Something else' }
const STATUS: Record<string, { tone: BadgeTone; label: string }> = {
  PENDING: { tone: 'warning', label: 'Waiting' }, APPROVED: { tone: 'success', label: 'Approved' }, REJECTED: { tone: 'danger', label: 'Not approved' }, CANCELLED: { tone: 'neutral', label: 'Taken back' },
}
const STEP_WORD: Record<string, string> = { WAITING: 'Not reached yet', PENDING: 'Waiting now', APPROVED: 'Approved', REJECTED: 'Not approved', SKIPPED: 'Skipped' }
const LEAVE_KINDS = [['ANNUAL', 'Annual leave'], ['SICK', 'Sick leave'], ['CASUAL', 'Casual leave'], ['UNPAID', 'Unpaid leave']] as const

export default function Requests() {
  const { user } = useAuth()
  const { addToast } = useToast()
  const [params, setParams] = useSearchParams()
  const admin = user?.role === 'SUPER_ADMIN'
  const lead = admin || user?.role === 'TEAM_LEAD'
  const box = (['mine', 'waiting', 'all'].includes(params.get('box') ?? '') ? params.get('box') : 'mine') as Box
  const openId = params.get('open')
  const [rows, setRows] = useState<Req[] | null>(null)
  const [inbox, setInbox] = useState<InboxItem[]>([])
  const [open, setOpen] = useState<Req | null>(null)
  const [adding, setAdding] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)

  const load = useCallback(() => {
    api.get<{ requests: Req[] }>(`/approvals?box=${box}`).then((r) => setRows(r.requests)).catch(() => setRows([]))
    api.get<{ inbox: InboxItem[] }>('/approvals/inbox').then((r) => setInbox(r.inbox)).catch(() => undefined)
  }, [box])
  useEffect(() => { setRows(null); load() }, [load])
  useEffect(() => {
    if (!openId) { setOpen(null); return }
    api.get<{ request: Req }>(`/approvals/${encodeURIComponent(openId)}`).then((r) => setOpen(r.request)).catch(() => { addToast({ type: 'error', message: 'That request could not be opened.' }); setParams((p) => { const n = new URLSearchParams(p); n.delete('open'); return n }, { replace: true }) })
  }, [openId]) // eslint-disable-line react-hooks/exhaustive-deps
  const show = (id: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (id) n.set('open', id); else n.delete('open'); return n }, { replace: true })
  const waiting = inbox.find((i) => i.key === 'requests')?.count ?? 0

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">Requests</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">Ask for an expense, a purchase or leave, and see who it is waiting on.</p>
        </div>
        <div className="flex gap-2">
          {admin && <Button variant="secondary" onClick={() => setRulesOpen(true)}>Who approves what</Button>}
          <Button leadingIcon={<Plus size={16} />} onClick={() => setAdding(true)}>New request</Button>
        </div>
      </div>

      {inbox.some((i) => i.count > 0) && (
        <Card title="Waiting on you" subtitle="Everything that needs your decision, from every kind of request.">
          <div className="flex flex-wrap gap-2">
            {inbox.filter((i) => i.count > 0).map((i) => (
              <Link key={i.key} to={i.link} className="inline-flex items-center gap-2 rounded-btn border border-line bg-card px-3 py-2 text-body-sm font-medium text-ink hover:border-primary">
                <span className="tabular-nums rounded-full bg-warning-muted px-2 py-0.5 text-warning-ink">{i.count}</span>{i.label}
              </Link>
            ))}
          </div>
        </Card>
      )}

      <PillFilter<Box>
        value={box}
        onChange={(v) => setParams((p) => { const n = new URLSearchParams(p); n.set('box', v); return n }, { replace: true })}
        options={[{ value: 'mine', label: 'My requests' }, { value: 'waiting', label: `Waiting on me${waiting ? ` (${waiting})` : ''}` }, ...(lead ? [{ value: 'all' as Box, label: admin ? 'Everyone' : 'My team' }] : [])]}
      />

      <Card flush>
        {rows === null ? <p className="p-5 text-body-md text-ink-muted">Loading...</p> : rows.length === 0 ? (
          <EmptyState icon={<ClipboardCheck size={22} />} title={box === 'waiting' ? 'Nothing is waiting on you' : 'No requests yet'} hint={box === 'mine' ? 'Ask for an expense, a purchase or leave with "New request".' : undefined} />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => show(r.id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-slate-50">
                  <span className="tabular-nums text-body-sm text-ink-faint">#{r.number}</span>
                  <span className="min-w-0 flex-1 truncate text-body-md font-medium text-ink">{r.line}</span>
                  {!r.mine && <span className="text-body-sm text-ink-muted">{r.requester.name}</span>}
                  {r.status === 'PENDING' && r.waitingOn.length > 0 && <span className="text-body-sm text-ink-muted">with {r.waitingOn.join(', ')}</span>}
                  <Badge tone={STATUS[r.status]?.tone ?? 'neutral'}>{STATUS[r.status]?.label ?? r.status}</Badge>
                  <span className="w-28 text-right text-body-sm text-ink-faint">{whenLabel(r.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {open && <RequestModal r={open} onClose={() => show(null)} onChanged={(r) => { setOpen(r); load() }} />}
      {adding && <NewRequest onClose={() => setAdding(false)} onMade={(r) => { setAdding(false); load(); show(r.id) }} />}
      {rulesOpen && <RulesModal onClose={() => setRulesOpen(false)} />}
    </div>
  )
}

function RequestModal({ r, onClose, onChanged }: { r: Req; onClose: () => void; onChanged: (r: Req) => void }) {
  const { addToast } = useToast()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  async function act(path: string, body: Record<string, unknown>, ok: string) {
    setBusy(true)
    try { onChanged((await api.post<{ request: Req }>(`/approvals/${r.id}/${path}`, body)).request); addToast({ type: 'success', message: ok }) } catch (e) { addToast({ type: 'error', message: errMsg(e, 'That did not work. Try again.') }) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={`Request #${r.number}`} size="lg"
      footer={<>
        {r.canCancel && <Button variant="secondary" disabled={busy} onClick={() => void act('cancel', {}, 'Request taken back.')}>Take it back</Button>}
        {r.canDecide && <Button variant="secondary" disabled={busy} leadingIcon={<X size={15} />} onClick={() => { if (!note.trim()) { addToast({ type: 'error', message: 'Say why, so the person knows.' }); return } void act('decide', { approve: false, note: note.trim() }, 'Marked as not approved.') }}>Do not approve</Button>}
        {r.canDecide && <Button disabled={busy} leadingIcon={<Check size={15} />} onClick={() => void act('decide', { approve: true, note: note.trim() || undefined }, 'Approved.')}>Approve</Button>}
      </>}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 text-body-lg font-semibold text-ink">{r.line}</p>
          <Badge tone={STATUS[r.status]?.tone ?? 'neutral'}>{STATUS[r.status]?.label ?? r.status}</Badge>
        </div>
        <p className="text-body-sm text-ink-muted">Asked by {r.requester.name} on {whenLabel(r.createdAt)}.</p>
        {r.details && <p className="whitespace-pre-wrap rounded-btn border border-line bg-slate-50 p-3 text-body-md text-ink">{r.details}</p>}
        {r.kind === 'LEAVE' && <p className="text-body-sm text-ink-muted">Days: {r.days.map(dayLabel).join(', ')}</p>}
        <div>
          <p className="mb-1.5 text-body-sm font-semibold text-ink">Approval</p>
          <ol className="space-y-1.5">
            {r.steps.map((s) => (
              <li key={s.position} className="flex flex-wrap items-baseline gap-x-2 rounded-btn border border-line px-3 py-2 text-body-sm">
                <span className="font-medium text-ink">{s.position + 1}. {s.approver === 'LEAD' ? 'Team lead' : s.approver === 'ADMIN' ? 'An admin' : 'A named person'}</span>
                <span className={s.status === 'APPROVED' ? 'text-success-ink' : s.status === 'REJECTED' ? 'text-danger-ink' : 'text-ink-muted'}>{STEP_WORD[s.status] ?? s.status}{s.by ? ` by ${s.by}` : ''}{s.status === 'PENDING' && r.waitingOn.length ? `: ${r.waitingOn.join(', ')}` : ''}</span>
                {s.note && <span className="w-full italic text-ink-muted">"{s.note}"</span>}
              </li>
            ))}
          </ol>
        </div>
        {r.canDecide && (
          <div>
            <label className={labelCls} htmlFor="req-note">A note for {r.requester.name} (needed when you do not approve)</label>
            <textarea id="req-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={areaCls} maxLength={500} />
          </div>
        )}
      </div>
    </Modal>
  )
}

function NewRequest({ onClose, onMade }: { onClose: () => void; onMade: (r: Req) => void }) {
  const { addToast } = useToast()
  const [kind, setKind] = useState<Kind>('EXPENSE')
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [leaveKind, setLeaveKind] = useState<string>('ANNUAL')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [balance, setBalance] = useState<Record<string, Balance> | null>(null)
  useEffect(() => { if (kind === 'LEAVE' && !balance) api.get<{ balance: Record<string, Balance> }>('/approvals/leave-balance').then((r) => setBalance(r.balance)).catch(() => undefined) }, [kind, balance])
  const days = kind === 'LEAVE' && from ? daysBetween(from, to || from) : []
  const b = balance?.[leaveKind]

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const body = kind === 'LEAVE'
        ? { kind, leaveKind, days, details: details.trim() || undefined }
        : { kind, title: title.trim(), details: details.trim() || undefined, amount: amount ? Number(amount) : undefined, currency: currency.trim().toUpperCase() || 'USD' }
      onMade((await api.post<{ request: Req }>('/approvals', body)).request)
      addToast({ type: 'success', message: 'Request sent.' })
    } catch (err) { addToast({ type: 'error', message: errMsg(err, 'Could not send the request.') }) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title="New request" size="md" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="new-request" disabled={busy}>Send request</Button></>}>
      <form id="new-request" onSubmit={submit} className="space-y-3">
        <div>
          <label className={labelCls} htmlFor="req-kind">What is it?</label>
          <select id="req-kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)} className={inputCls}>
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </div>
        {kind === 'LEAVE' ? (
          <>
            <div>
              <label className={labelCls} htmlFor="req-leave">Kind of leave</label>
              <select id="req-leave" value={leaveKind} onChange={(e) => setLeaveKind(e.target.value)} className={inputCls}>{LEAVE_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              {b && <p className="mt-1 text-body-sm text-ink-muted">{b.allowed === null ? `${b.used} day${b.used === 1 ? '' : 's'} used this year.` : `${b.left} of ${b.allowed} days left this year${b.waiting ? `, ${b.waiting} waiting on a decision` : ''}.`}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls} htmlFor="req-from">First day</label><input id="req-from" type="date" required value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} /></div>
              <div><label className={labelCls} htmlFor="req-to">Last day</label><input id="req-to" type="date" min={from} value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} /></div>
            </div>
            {days.length > 0 && <p className="text-body-sm text-ink-muted">{days.length} day{days.length === 1 ? '' : 's'}. Weekends and holidays in between are counted: send separate requests to leave them out.</p>}
          </>
        ) : (
          <>
            <div><label className={labelCls} htmlFor="req-title">What is it for?</label><input id="req-title" required maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder={kind === 'EXPENSE' ? 'Taxi to the client meeting' : kind === 'PURCHASE' ? 'Two headsets for the sales team' : 'What you need'} /></div>
            {kind !== 'OTHER' && (
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2"><label className={labelCls} htmlFor="req-amount">Amount</label><input id="req-amount" type="number" inputMode="decimal" min="0.01" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} /></div>
                <div><label className={labelCls} htmlFor="req-cur">Currency</label><input id="req-cur" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} className={inputCls} /></div>
              </div>
            )}
          </>
        )}
        <div><label className={labelCls} htmlFor="req-details">Details (optional)</label><textarea id="req-details" rows={3} maxLength={2000} value={details} onChange={(e) => setDetails(e.target.value)} className={areaCls} /></div>
      </form>
    </Modal>
  )
}

/** Admins: who approves each kind of request, and from what amount a second person is needed. */
function RulesModal({ onClose }: { onClose: () => void }) {
  const { addToast } = useToast()
  const [rules, setRules] = useState<Rule[] | null>(null)
  const [people, setPeople] = useState<{ id: string; name: string }[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api.get<{ rules: Rule[] }>('/approvals/rules').then((r) => setRules(r.rules)).catch(() => setRules([]))
    api.get<{ people: { id: string; name: string }[] }>('/people').then((r) => setPeople(r.people)).catch(() => undefined)
  }, [])
  const change = (i: number, patch: Partial<Rule>) => setRules((rs) => rs!.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  async function save() {
    setBusy(true)
    try { setRules((await api.put<{ rules: Rule[] }>('/approvals/rules', { rules: rules ?? [] })).rules); addToast({ type: 'success', message: 'Saved.' }); onClose() } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not save the rules.') }) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title="Who approves what" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy || !rules} onClick={() => void save()}>Save</Button></>}>
      <div className="space-y-3">
        <p className="text-body-sm text-ink-muted">With no rule, a request goes to the person's team lead (an admin when there is no lead). Add a rule to change that for a kind of request, or to add a second approver from an amount up.</p>
        {rules?.map((r, i) => (
          <div key={i} className="space-y-2 rounded-btn border border-line p-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-40"><label className={labelCls}>Kind</label><select value={r.kind} onChange={(e) => change(i, { kind: e.target.value as Kind })} className={inputCls}>{(Object.keys(KIND_LABEL) as Kind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></div>
              <div className="w-40"><label className={labelCls}>From amount</label><input type="number" min="0" placeholder="Any" value={r.minAmount ?? ''} onChange={(e) => change(i, { minAmount: e.target.value === '' ? null : Number(e.target.value) })} className={inputCls} /></div>
              <button type="button" onClick={() => setRules((rs) => rs!.filter((_, j) => j !== i))} className="ml-auto rounded-btn p-2 text-ink-faint hover:bg-slate-100 hover:text-danger" aria-label="Remove the rule"><Trash2 size={16} /></button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-body-sm text-ink-muted">Approved by, in order:</span>
              {r.chain.map((c, k) => (
                <span key={k} className="inline-flex items-center gap-1">
                  <select value={c} onChange={(e) => change(i, { chain: r.chain.map((x, y) => (y === k ? e.target.value : x)) })} className="h-9 rounded-btn border border-line bg-card px-2 text-body-sm text-ink">
                    <option value="LEAD">Their team lead</option>
                    <option value="ADMIN">An admin</option>
                    {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  {r.chain.length > 1 && <button type="button" onClick={() => change(i, { chain: r.chain.filter((_, y) => y !== k) })} className="rounded p-1 text-ink-faint hover:text-danger" aria-label="Remove this approver"><X size={14} /></button>}
                </span>
              ))}
              {r.chain.length < 5 && <Button size="sm" variant="ghost" onClick={() => change(i, { chain: [...r.chain, 'ADMIN'] })}>Add approver</Button>}
            </div>
          </div>
        ))}
        <Button size="sm" variant="secondary" leadingIcon={<Plus size={14} />} onClick={() => setRules((rs) => [...(rs ?? []), { kind: 'EXPENSE', minAmount: null, chain: ['LEAD'] }])}>Add a rule</Button>
      </div>
    </Modal>
  )
}
