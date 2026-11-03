import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Building2, CalendarDays, CheckCircle2, ChevronDown, ChevronRight, Clock, Flag, Mail, MapPin, MessageSquare, Package, Pencil, Phone, PhoneCall, PhoneOutgoing, Play, Plus, Send, ShieldCheck, Tag, UserCheck, X } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { Modal } from '../../../components/ui/Modal'
import { TextField, TextArea } from '../../../components/ui/Input'
import { useToast } from '../../../components/ui/Toast'
import { MentionBox, highlightMentions } from '../../../components/MentionBox'
import { apiErrorText } from '../../../lib/api'
import { cn } from '../../../lib/cn'
import { useAuth } from '../../../lib/auth'
import {
  CLOSE_REASON_LABEL, CLOSE_REASONS, DISPOSITION_LABEL, DISPOSITIONS, fmtDate, fmtDur, fmtWhen, FREIGHT, FREIGHT_LABEL, inZone, leadsApi, leadTitle, MATERIAL_FORMS, MATERIAL_LABEL, MATERIALS, MEETING_OUTCOMES, OUTCOME_LABEL, OWNER_LABEL, PAYS_LABEL, PAYS_UNITS, plusBusinessDays, SOURCE_LABEL, TASK_KIND_LABEL, toYmd, YES_NO_LABEL,
  type Disposition, type LeadDetail, type LeadFull, type LeadInput, type Owner, type YesNo,
} from '../../../lib/leadsApi'
import { Avatar, Done, FactsMeter, Label, Select, StatusPill, WarningList } from './shared'

/**
 * One lead: the details (contact, address, product), the five facts and the flow for a CMR
 * business (send info, qualify, Jesse's decision, slots, invite, reconfirm, outcome), calls with
 * recordings, Jesse's comments with @mentions, agent tasks and the timeline.
 */
export default function LeadPage() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const { user } = useAuth()
  const { addToast } = useToast()
  const [d, setD] = useState<LeadDetail | null>(null)
  const [err, setErr] = useState('')
  const [modal, setModal] = useState<'call' | 'close' | 'qualify' | 'decide' | 'invite' | 'slots' | 'reconfirm' | 'outcome' | 'task' | 'info' | 'edit' | null>(null)
  const load = useCallback(() => leadsApi.get(id).then((r) => { setD(r); setErr('') }).catch((e) => setErr(apiErrorText(e, 'Lead not found'))), [id])
  useEffect(() => { void load() }, [load])
  const run = async (fn: () => Promise<unknown>, ok?: string) => { try { await fn(); if (ok) addToast({ type: 'success', message: ok }); await load() } catch (e) { addToast({ type: 'error', message: apiErrorText(e, 'Could not save') }) } }

  if (err) return <div className="mx-auto max-w-xl py-16 text-center"><p className="text-body-md text-ink-muted">{err}</p><Link to="/app/leads" className="mt-3 inline-block text-primary">Back to leads</Link></div>
  if (!d) return <div className="h-64 animate-pulse rounded-card border border-line bg-card" />
  const { lead: l, can, pipeline, head, mentionable } = d
  const cmr = can.cmr
  const title = leadTitle(l)
  const isHead = can.decide

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-4">
      <Link to={`/app/leads?business=${l.businessId}`} className="inline-flex items-center gap-1 text-body-sm text-ink-muted hover:text-ink"><ArrowLeft size={14} />Leads</Link>

      {/* Header */}
      <div className="rounded-card border border-line bg-card p-5 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <Avatar name={title} size={44} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-headline-lg text-ink">{title}</h1>
                <StatusPill status={l.status} pipeline={pipeline} label={l.statusLabel} />
                {l.jesseInputNeeded && <Badge tone="warning" dot>Waiting on Jesse{l.waitingDays != null ? ` · ${l.waitingDays} business day${l.waitingDays === 1 ? '' : 's'}` : ''}</Badge>}
                {l.prohibited && <Badge tone="danger">Prohibited</Badge>}{l.existingCustomer && <Badge>Existing customer</Badge>}{l.belowMin && <Badge tone="accent">Below minimum</Badge>}
              </div>
              <p className="mt-1 text-body-md text-ink-muted">
                {l.organization && l.name ? <>{l.name}{l.contactRole ? `, ${l.contactRole}` : l.jobTitle ? `, ${l.jobTitle}` : ''} · </> : null}
                {[l.industry, l.state, l.city].filter(Boolean).join(' · ')}{l.industry || l.state ? ' · ' : ''}<span className="inline-flex items-center gap-1" style={{ color: l.business.color }}><Building2 size={13} />{l.business.name}</span>
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-body-sm">
                {l.phone && <a href={`tel:${l.phoneE164 ?? l.phone}`} className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"><Phone size={14} />{l.phone}{l.ext ? ` x${l.ext}` : ''}</a>}
                {l.email && <a href={`mailto:${l.email}`} className="inline-flex items-center gap-1.5 text-ink hover:underline"><Mail size={14} />{l.email}</a>}
                {l.website && <a href={/^https?:/.test(l.website) ? l.website : `https://${l.website}`} target="_blank" rel="noreferrer" className="text-ink-muted hover:underline">{l.website}</a>}
                <span className="text-ink-faint">{SOURCE_LABEL[l.source]} · added {fmtDate(l.createdAt)}{l.createdBy ? ` by ${l.createdBy.name}` : ''}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {can.manage ? (
              <Select value={l.assigneeId ?? ''} onChange={(e) => run(() => leadsApi.assign(l.id, e.target.value || null), e.target.value ? 'Assigned' : 'Unassigned')} aria-label="Assigned to">
                <option value="">Unassigned</option>{mentionable.filter((m) => m.role !== 'HEAD' || m.id === l.assigneeId).map((m) => <option key={m.id} value={m.id}>{m.name}{m.role === 'MANAGER' ? ' (manager)' : m.role === 'HEAD' ? ' (head)' : ''}</option>)}{l.assignee && !mentionable.some((m) => m.id === l.assigneeId) && <option value={l.assignee.id}>{l.assignee.name}</option>}
              </Select>
            ) : <span className="inline-flex items-center gap-1.5 text-body-sm text-ink-muted"><UserCheck size={14} />{l.assignee?.name ?? 'Unassigned'}</span>}
            {can.edit && !l.prohibited && <Button size="sm" leadingIcon={<PhoneOutgoing size={15} />} onClick={() => setModal('call')}>Log call</Button>}
            {can.edit && cmr && l.open && !l.prohibited && <Button size="sm" variant="secondary" leadingIcon={<Send size={15} />} onClick={() => setModal('info')} disabled={!l.email} title={l.email ? '' : 'Add an email first'}>Send info</Button>}
            {can.edit && cmr && l.open && !l.jesseInputNeeded && !(l.jesseDecision === 'MEETING' && !l.meetingOutcome) && <Button size="sm" variant="secondary" leadingIcon={<Flag size={15} />} onClick={() => setModal('qualify')}>{l.qualifyRequestedAt && can.approve ? 'Approve for Jesse' : 'Qualify'}</Button>}
            {can.edit && <Button size="sm" variant="ghost" leadingIcon={<Pencil size={15} />} onClick={() => setModal('edit')}>Edit</Button>}
            {can.edit && l.open && <Button size="sm" variant="ghost" onClick={() => setModal('close')}>Close out</Button>}
            {can.manage && !l.open && <Button size="sm" variant="ghost" onClick={() => run(() => leadsApi.reopen(l.id), 'Reopened')}>Reopen</Button>}
          </div>
        </div>
        {(l.warnings.length > 0 || d.listHits.length > 0) && <div className="mt-4"><WarningList warnings={l.warnings} /></div>}
        {l.late && <p className="mt-3 inline-flex items-center gap-1.5 rounded-btn bg-danger/10 px-3 py-1.5 text-body-sm text-danger"><Clock size={14} />{l.late === 'assign' ? 'Not given to anyone in time.' : 'Nobody has got in touch in time.'}</p>}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          {cmr && <JessePanel d={d} isHead={isHead} meId={user?.id ?? ''} onAction={setModal} onDecided={load} />}
          {cmr && <FactsCard l={l} settings={d.settings} canEdit={can.edit} onSaved={load} />}
          <NextStepCard l={l} canEdit={can.edit} onSaved={load} />
          <CallsCard l={l} canEdit={can.edit && !l.prohibited} onLog={() => setModal('call')} />
          <CommentsCard d={d} meId={user?.id ?? ''} onPosted={load} />
        </div>
        <div className="space-y-4">
          <TasksCard l={l} canEdit={can.edit} onAdd={() => setModal('task')} onChanged={load} />
          <DetailsCard l={l} cmr={cmr} onEdit={() => setModal('edit')} />
          <TimelineCard l={l} />
        </div>
      </div>

      {modal === 'call' && <LogCallModal d={d} onClose={() => setModal(null)} onDone={() => { setModal(null); void load() }} />}
      {modal === 'info' && <SendInfoModal l={l} onClose={() => setModal(null)} onDone={() => { setModal(null); void load() }} />}
      {modal === 'qualify' && <QualifyModal d={d} onClose={() => setModal(null)} onDone={() => { setModal(null); void load() }} />}
      {modal === 'close' && <CloseModal d={d} onClose={() => setModal(null)} onDone={() => { setModal(null); void load() }} />}
      {modal === 'decide' && <DecideModal l={l} onClose={() => setModal(null)} onDone={() => { setModal(null); void load() }} />}
      {modal === 'slots' && <SlotsModal l={l} onClose={() => setModal(null)} onDone={() => { setModal(null); void load() }} />}
      {modal === 'invite' && <InviteModal l={l} copyName={d.settings?.copyName ?? 'Aaqib'} head={head} onClose={() => setModal(null)} onDone={() => { setModal(null); void load() }} />}
      {modal === 'reconfirm' && <ReconfirmModal l={l} onClose={() => setModal(null)} onDone={() => { setModal(null); void load() }} />}
      {modal === 'outcome' && <OutcomeModal l={l} onClose={() => setModal(null)} onDone={() => { setModal(null); void load() }} />}
      {modal === 'task' && <TaskModal l={l} people={mentionable} canAssign={can.manage} onClose={() => setModal(null)} onDone={() => { setModal(null); void load() }} />}
      {modal === 'edit' && <EditModal d={d} onClose={() => setModal(null)} onDone={() => { setModal(null); void load() }} />}
      {false && nav}
    </div>
  )
}

/** A Date as the value of a datetime-local input (local time, no zone shift). */
const toLocalInput = (d: Date) => `${toYmd(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

// ------------------------------------------------------------------ cards

function Card({ title, icon, action, children, className }: { title: ReactNode; icon?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-card border border-line bg-card shadow-xs', className)}>
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5"><h2 className="inline-flex items-center gap-2 text-[14px] font-semibold text-ink">{icon && <span className="text-ink-faint">{icon}</span>}{title}</h2>{action}</header>
      <div className="p-4">{children}</div>
    </section>
  )
}

function JessePanel({ d, isHead, meId, onAction, onDecided }: { d: LeadDetail; isHead: boolean; meId: string; onAction: (m: 'decide' | 'slots' | 'invite' | 'reconfirm' | 'outcome' | 'qualify') => void; onDecided: () => void }) {
  const { lead: l, head, can } = d
  void meId; void onDecided
  const slots = l.meetingSlots ?? []
  const stage = !l.open ? 'closed' : l.meetingOutcome ? 'done' : l.inviteSentAt ? 'invited' : l.meetingAt ? 'approved' : l.jesseInputNeeded ? 'waiting' : l.qualifyRequestedAt ? 'requested' : l.jesseDecision ? 'decided' : 'working'
  const steps = [
    { k: 'facts', label: 'Five facts', done: l.factsDone === 5 },
    { k: 'flag', label: 'Flagged for Jesse', done: !!l.flaggedAt },
    { k: 'decision', label: 'Jesse decided', done: !!l.jesseDecidedAt },
    { k: 'invite', label: 'Invite sent', done: !!l.inviteSentAt },
    { k: 'reconfirm', label: 'Reconfirmed + brief', done: !!l.reconfirmedAt },
    { k: 'outcome', label: 'Outcome logged', done: !!l.meetingOutcome },
  ]
  return (
    <Card title={<>Jesse flow{head ? <span className="font-normal text-ink-muted"> · head: {head.name}</span> : <span className="font-normal text-warning"> · no head set (Lead Settings)</span>}</>} icon={<Flag size={15} />}
      action={<span className="text-body-sm text-ink-muted">Owner: <strong className="text-ink">{OWNER_LABEL[l.owner]}</strong></span>}>
      <ol className="flex flex-wrap gap-x-4 gap-y-1">{steps.map((s) => <li key={s.k}><Done ok={s.done}>{s.label}</Done></li>)}</ol>
      <div className="mt-4 space-y-3">
        {stage === 'requested' && <p className="rounded-btn bg-primary/[0.06] px-3 py-2 text-body-sm text-ink">The SDR asked to qualify this lead. {can.approve ? <button type="button" className="font-semibold text-primary hover:underline" onClick={() => onAction('qualify')}>Approve and flag for Jesse</button> : 'Waiting for the team lead to approve.'}{l.jesseAsk && <span className="block text-ink-muted">For Jesse: {l.jesseAsk}</span>}</p>}
        {(stage === 'waiting') && (
          <div className="rounded-card border border-orange-200 bg-orange-50/60 p-3 dark:border-orange-500/30 dark:bg-orange-500/10">
            <p className="text-body-sm font-semibold text-ink">What Jesse must decide</p>
            <p className="text-body-md text-ink">{l.jesseAsk}</p>
            {slots.length > 0 && <p className="mt-2 text-body-sm text-ink-muted">Slots offered: {slots.map((s) => inZone(s, 'America/Phoenix')).join(' · ')} (Phoenix)</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {isHead && <Button size="sm" onClick={() => onAction('decide')}>Decide</Button>}
              {can.edit && <Button size="sm" variant="secondary" leadingIcon={<CalendarDays size={14} />} onClick={() => onAction('slots')}>{slots.length ? 'Change slots' : 'Offer 2–3 slots'}</Button>}
              {!isHead && <span className="self-center text-body-sm text-ink-muted">Jesse checks flags within 1 business day.</span>}
            </div>
          </div>
        )}
        {l.jesseComment && stage !== 'waiting' && <p className="rounded-btn bg-slate-50 px-3 py-2 text-body-sm text-ink dark:bg-white/[0.03]"><span className="font-semibold">Jesse:</span> {l.jesseComment}</p>}
        {stage === 'approved' && l.meetingAt && (
          <div className="rounded-card border border-success/30 bg-success/5 p-3">
            <p className="text-body-sm font-semibold text-ink">Meeting approved: {inZone(l.meetingAt, l.zone)} · {inZone(l.meetingAt, 'America/Phoenix')} · {inZone(l.meetingAt, 'America/Los_Angeles')}</p>
            <p className="mt-1 text-body-sm text-ink-muted">Send the Teams invite today: to the prospect, Jesse and {d.settings?.copyName || 'Aaqib'}. The times go in the prospect's zone, Phoenix and Pacific.</p>
            {can.edit && <Button size="sm" className="mt-2" leadingIcon={<Send size={14} />} onClick={() => onAction('invite')}>Send the invite</Button>}
          </div>
        )}
        {stage === 'invited' && l.meetingAt && (
          <div className="rounded-card border border-line p-3">
            <p className="text-body-sm font-semibold text-ink">Meeting {new Date(l.meetingAt) > new Date() ? 'on' : 'was on'} {inZone(l.meetingAt, 'America/Phoenix')} (Phoenix){l.meetingLink && <> · <a href={l.meetingLink} target="_blank" rel="noreferrer" className="text-primary hover:underline">Teams link</a></>}</p>
            <p className="mt-1 text-body-sm text-ink-muted">Invite sent {fmtWhen(l.inviteSentAt)}. {l.reconfirmedAt ? `Reconfirmed ${fmtWhen(l.reconfirmedAt)}.` : 'The day before: reconfirm and write the 3-line brief.'}</p>
            {l.meetingBrief && <p className="mt-2 whitespace-pre-wrap rounded-btn bg-slate-50 px-3 py-2 text-body-sm text-ink dark:bg-white/[0.03]">{l.meetingBrief}</p>}
            {can.edit && <div className="mt-2 flex gap-2">{!l.reconfirmedAt && <Button size="sm" variant="secondary" onClick={() => onAction('reconfirm')}>Reconfirm + brief</Button>}<Button size="sm" onClick={() => onAction('outcome')}>Log the outcome</Button><Button size="sm" variant="ghost" onClick={() => onAction('invite')}>Resend invite</Button></div>}
          </div>
        )}
        {stage === 'done' && <p className="text-body-sm text-ink"><CheckCircle2 size={14} className="mr-1 inline text-success" />Outcome: <strong>{OUTCOME_LABEL[l.meetingOutcome as keyof typeof OUTCOME_LABEL] ?? l.meetingOutcome}</strong> ({fmtDate(l.meetingOutcomeAt)})</p>}
        {stage === 'working' && <p className="text-body-sm text-ink-muted">Fill the five facts on the calls, send the info email, follow up; then Qualify with one line on what Jesse must decide.</p>}
      </div>
    </Card>
  )
}

const yesNoSel = (v: YesNo | undefined, on: (v: YesNo) => void) => <Select value={v ?? 'UNKNOWN'} onChange={(e) => on(e.target.value as YesNo)} className="w-full">{(['YES', 'NO', 'UNKNOWN'] as YesNo[]).map((k) => <option key={k} value={k}>{YES_NO_LABEL[k]}</option>)}</Select>

/** The five facts, edited in place. */
function FactsCard({ l, settings, canEdit, onSaved }: { l: LeadFull; settings: LeadDetail['settings']; canEdit: boolean; onSaved: () => void }) {
  const { addToast } = useToast()
  const [edit, setEdit] = useState(false)
  const [f, setF] = useState<LeadInput>({})
  const [busy, setBusy] = useState(false)
  useEffect(() => { setF({ material: l.material ?? [], materialForm: l.materialForm ?? [], lbsPerShipment: l.lbsPerShipment ?? null, lbsPerMonth: l.lbsPerMonth ?? null, currentVendor: l.currentVendor ?? null, paysToday: l.paysToday ?? null, paysUnit: l.paysUnit ?? 'UNKNOWN', usesBatteryNetwork: !!l.usesBatteryNetwork, vendorRelatedParty: !!l.vendorRelatedParty, sortsAlkaline: l.sortsAlkaline ?? 'UNKNOWN', shipsLtl: l.shipsLtl ?? 'UNKNOWN', decisionMakerName: l.decisionMakerName ?? null, contactRole: l.contactRole ?? null, dmAgreed: l.dmAgreed ?? 'UNKNOWN', handlesAlkaline: l.handlesAlkaline ?? 'UNKNOWN', nextShipmentDate: l.nextShipmentDate ? l.nextShipmentDate.slice(0, 10) : null, pickupCity: l.pickupCity ?? null, freight: l.freight ?? 'UNKNOWN' }) }, [l])
  const save = async () => { setBusy(true); try { await leadsApi.update(l.id, f); setEdit(false); addToast({ type: 'success', message: 'Facts saved' }); onSaved() } catch (e) { addToast({ type: 'error', message: apiErrorText(e, 'Could not save') }) } finally { setBusy(false) } }
  const toggle = (k: 'material' | 'materialForm', v: string) => setF({ ...f, [k]: (f[k] ?? []).includes(v) ? (f[k] ?? []).filter((x) => x !== v) : [...(f[k] ?? []), v] })
  const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(/[^0-9.]/g, '')) || 0)
  return (
    <Card title={<>Five facts <FactsMeter facts={l.facts} /></>} icon={<ShieldCheck size={15} />} action={canEdit && (edit ? <span className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => setEdit(false)}>Cancel</Button><Button size="sm" disabled={busy} onClick={save}>Save</Button></span> : <Button size="sm" variant="ghost" leadingIcon={<Pencil size={14} />} onClick={() => setEdit(true)}>Edit</Button>)}>
      {!edit ? (
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {l.facts.map((fact) => (
            <div key={fact.key} className={cn('rounded-card border p-3', fact.done ? 'border-success/30 bg-success/[0.04]' : 'border-line')}>
              <dt className="flex items-center justify-between text-body-sm font-semibold text-ink"><span>{fact.label}</span>{fact.done ? <CheckCircle2 size={15} className="text-success" /> : <span className="text-[11px] font-normal text-ink-faint">missing</span>}</dt>
              <dd className="mt-1 text-body-sm text-ink-muted">
                {fact.key === 'material' && (l.material?.length ? <>{l.material.map((m) => MATERIAL_LABEL[m as keyof typeof MATERIAL_LABEL] ?? m).join(', ')}{l.materialForm?.length ? ` · ${l.materialForm.map((x) => x.toLowerCase()).join(', ')}` : ''} · handles alkaline: {YES_NO_LABEL[l.handlesAlkaline ?? 'UNKNOWN'].toLowerCase()}</> : fact.hint)}
                {fact.key === 'volume' && (l.lbsPerShipment || l.lbsPerMonth ? <>{l.lbsPerShipment ? `${l.lbsPerShipment.toLocaleString()} lb per shipment` : ''}{l.lbsPerShipment && l.lbsPerMonth ? ' · ' : ''}{l.lbsPerMonth ? `${l.lbsPerMonth.toLocaleString()} lb per month` : ''}{l.belowMin && <span className="ml-1 text-purple-600">(below the {settings?.minLoadLbs.toLocaleString()} lb minimum)</span>}</> : fact.hint)}
                {fact.key === 'outlet' && (l.currentVendor ? <>{l.currentVendor} · pays {l.paysUnit === 'NONE' ? 'nothing' : l.paysToday != null ? `$${l.paysToday}${l.paysUnit === 'DRUM' ? ' per drum' : '/lb'}` : 'unknown'}{l.usesBatteryNetwork ? ' · The Battery Network' : ''}{l.vendorRelatedParty ? ' · related party' : ''}</> : fact.hint)}
                {fact.key === 'decisionMaker' && (l.decisionMakerName ? <>{l.decisionMakerName}{l.contactRole ? `, ${l.contactRole}` : ''} · will talk to Jesse: {YES_NO_LABEL[l.dmAgreed ?? 'UNKNOWN'].toLowerCase()}</> : fact.hint)}
                {fact.key === 'timing' && (l.pickupCity || l.nextShipmentDate ? <>{l.nextShipmentDate ? `next shipment ${fmtDate(l.nextShipmentDate)}` : 'no shipment date'} · {l.pickupCity ?? 'pickup city?'} · {FREIGHT_LABEL[(l.freight ?? 'UNKNOWN') as keyof typeof FREIGHT_LABEL].toLowerCase()}</> : fact.hint)}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><Label>1 · Material</Label>
            <div className="flex flex-wrap gap-1.5">{MATERIALS.map((m) => <button key={m} type="button" onClick={() => toggle('material', m)} className={cn('h-8 rounded-full border px-3 text-body-sm', f.material?.includes(m) ? 'border-primary bg-primary/[0.08] text-primary' : 'border-line text-ink-muted')}>{MATERIAL_LABEL[m]}</button>)}</div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5"><span className="mr-1 text-body-sm text-ink-muted">Form:</span>{MATERIAL_FORMS.map((m) => <button key={m} type="button" onClick={() => toggle('materialForm', m)} className={cn('h-7 rounded-full border px-2.5 text-[12px]', f.materialForm?.includes(m) ? 'border-primary bg-primary/[0.08] text-primary' : 'border-line text-ink-muted')}>{m[0] + m.slice(1).toLowerCase()}</button>)}</div>
          </div>
          <label><Label>Handles alkaline</Label>{yesNoSel(f.handlesAlkaline, (v) => setF({ ...f, handlesAlkaline: v }))}</label>
          <div />
          <TextField label="2 · Lbs per shipment" inputMode="decimal" value={f.lbsPerShipment ?? ''} onChange={(e) => setF({ ...f, lbsPerShipment: num(e.target.value) })} placeholder="2500" />
          <TextField label="Lbs per month" inputMode="decimal" value={f.lbsPerMonth ?? ''} onChange={(e) => setF({ ...f, lbsPerMonth: num(e.target.value) })} />
          <TextField label="3 · Current vendor" value={f.currentVendor ?? ''} onChange={(e) => setF({ ...f, currentVendor: e.target.value })} placeholder="Who takes their batteries today" />
          <div className="grid grid-cols-2 gap-2">
            <label><Label>They pay</Label><Select value={f.paysUnit ?? 'UNKNOWN'} onChange={(e) => setF({ ...f, paysUnit: e.target.value })} className="w-full">{PAYS_UNITS.map((u) => <option key={u} value={u}>{PAYS_LABEL[u]}</option>)}</Select></label>
            <TextField label="Amount ($)" inputMode="decimal" disabled={f.paysUnit === 'NONE' || f.paysUnit === 'UNKNOWN'} value={f.paysToday ?? ''} onChange={(e) => setF({ ...f, paysToday: num(e.target.value) })} />
          </div>
          <label className="flex items-center gap-2 text-body-sm text-ink"><input type="checkbox" checked={!!f.usesBatteryNetwork} onChange={(e) => setF({ ...f, usesBatteryNetwork: e.target.checked })} />Uses The Battery Network / Call2Recycle</label>
          <label className="flex items-center gap-2 text-body-sm text-ink"><input type="checkbox" checked={!!f.vendorRelatedParty} onChange={(e) => setF({ ...f, vendorRelatedParty: e.target.checked })} />Vendor is a related party (Integritrade)</label>
          {f.usesBatteryNetwork && <><label><Label>They sort alkaline</Label>{yesNoSel(f.sortsAlkaline, (v) => setF({ ...f, sortsAlkaline: v }))}</label><label><Label>They ship LTL / FTL</Label>{yesNoSel(f.shipsLtl, (v) => setF({ ...f, shipsLtl: v }))}</label></>}
          <TextField label="4 · Decision maker" value={f.decisionMakerName ?? ''} onChange={(e) => setF({ ...f, decisionMakerName: e.target.value })} placeholder="Name" />
          <TextField label="Their role" value={f.contactRole ?? ''} onChange={(e) => setF({ ...f, contactRole: e.target.value })} />
          <label><Label>Will talk to Jesse</Label>{yesNoSel(f.dmAgreed, (v) => setF({ ...f, dmAgreed: v }))}</label>
          <div />
          <TextField label="5 · Next shipment date" type="date" value={f.nextShipmentDate ?? ''} onChange={(e) => setF({ ...f, nextShipmentDate: e.target.value || null })} />
          <TextField label="Pickup city" value={f.pickupCity ?? ''} onChange={(e) => setF({ ...f, pickupCity: e.target.value })} />
          <label><Label>Freight</Label><Select value={f.freight ?? 'UNKNOWN'} onChange={(e) => setF({ ...f, freight: e.target.value })} className="w-full">{FREIGHT.map((x) => <option key={x} value={x}>{FREIGHT_LABEL[x]}</option>)}</Select></label>
        </div>
      )}
    </Card>
  )
}

function NextStepCard({ l, canEdit, onSaved }: { l: LeadFull; canEdit: boolean; onSaved: () => void }) {
  const { addToast } = useToast()
  const [edit, setEdit] = useState(false)
  const [step, setStep] = useState(l.nextStep ?? '')
  const [date, setDate] = useState(l.nextStepDate ? l.nextStepDate.slice(0, 10) : '')
  const [owner, setOwner] = useState<Owner>(l.owner)
  useEffect(() => { setStep(l.nextStep ?? ''); setDate(l.nextStepDate ? l.nextStepDate.slice(0, 10) : ''); setOwner(l.owner) }, [l])
  const save = () => leadsApi.update(l.id, { nextStep: step.trim() || null, nextStepDate: date || null, owner }).then(() => { setEdit(false); onSaved() }).catch((e) => addToast({ type: 'error', message: apiErrorText(e, 'Could not save') }))
  return (
    <Card title="Next step" icon={<Clock size={15} />} action={canEdit && l.open && (edit ? <span className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => setEdit(false)}>Cancel</Button><Button size="sm" onClick={save}>Save</Button></span> : <Button size="sm" variant="ghost" leadingIcon={<Pencil size={14} />} onClick={() => setEdit(true)}>Edit</Button>)}>
      {edit ? (
        <div className="grid gap-3 sm:grid-cols-[1fr_160px_150px]">
          <TextField label="Next step" value={step} onChange={(e) => setStep(e.target.value)} placeholder="Follow up on volume" />
          <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <label><Label>Owner</Label><Select value={owner} onChange={(e) => setOwner(e.target.value as Owner)} className="w-full">{(Object.keys(OWNER_LABEL) as Owner[]).map((k) => <option key={k} value={k}>{OWNER_LABEL[k]}</option>)}</Select></label>
        </div>
      ) : l.nextStep ? (
        <div className="flex flex-wrap items-center gap-3"><span className="text-body-md font-medium text-ink">{l.nextStep}</span>{l.nextStepDate && <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-body-sm font-semibold', l.overdue ? 'bg-danger/10 text-danger' : 'bg-slate-100 text-ink dark:bg-white/10')}>{l.overdue && <AlertTriangle size={12} />}{fmtDate(l.nextStepDate)}{l.overdue ? ' · overdue' : ''}</span>}<span className="text-body-sm text-ink-muted">Owner: {OWNER_LABEL[l.owner]}</span></div>
      ) : <p className="text-body-sm text-ink-muted">{l.open ? 'No next step yet. Every open lead needs one: log a call or set it here.' : 'Closed.'}</p>}
    </Card>
  )
}

function CallsCard({ l, canEdit, onLog }: { l: LeadFull; canEdit: boolean; onLog: () => void }) {
  return (
    <Card title={`Calls (${l.calls.length})`} icon={<PhoneCall size={15} />} action={canEdit && <Button size="sm" variant="secondary" leadingIcon={<Plus size={14} />} onClick={onLog}>Log call</Button>}>
      {l.calls.length ? (
        <ul className="divide-y divide-line">
          {l.calls.map((c) => (
            <li key={c.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
              <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', c.disposition === 'CONNECTED' ? 'bg-success/10 text-success' : 'bg-slate-100 text-ink-muted dark:bg-white/10')}><PhoneOutgoing size={14} /></span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm"><span className="font-semibold text-ink">{DISPOSITION_LABEL[c.disposition]}</span>{c.durationSec > 0 && <span className="text-ink-muted">{fmtDur(c.durationSec)}</span>}<span className="text-ink-faint">{fmtWhen(c.at)} · {c.user?.name ?? 'TalkLoop'}</span>{c.consentGiven === true && <Badge tone="success">Consent</Badge>}{c.consentGiven === false && <Badge tone="warning">No consent</Badge>}</div>
                {c.summary && <p className="mt-1 whitespace-pre-wrap text-body-sm text-ink">{c.summary}</p>}
                {c.hasRecording && (c.recordingUrl ? <audio controls preload="none" src={c.recordingUrl} className="mt-2 h-8 w-full max-w-md" /> : <span className="mt-1 inline-flex items-center gap-1 text-body-sm text-ink-faint"><Play size={12} />Recording (only the SDR and managers can play it)</span>)}
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="text-body-sm text-ink-muted">No calls yet.</p>}
    </Card>
  )
}

function CommentsCard({ d, meId, onPosted }: { d: LeadDetail; meId: string; onPosted: () => void }) {
  const { addToast } = useToast()
  const { lead: l, head, mentionable } = d
  const members = mentionable.map((m) => ({ id: m.id, name: m.name }))
  return (
    <Card title={`Comments (${l.comments.length})`} icon={<MessageSquare size={15} />} className="scroll-mt-20" >
      <div id="comments" />
      {l.comments.length ? (
        <ul className="space-y-3">
          {l.comments.map((c) => (
            <li key={c.id} className={cn('flex gap-2.5', c.userId === meId && 'flex-row-reverse text-right')}>
              <Avatar name={c.user.name} />
              <div className={cn('max-w-[85%] rounded-card px-3 py-2', c.userId === head?.id ? 'border border-orange-200 bg-orange-50/60 dark:border-orange-500/30 dark:bg-orange-500/10' : 'bg-slate-50 dark:bg-white/[0.04]')}>
                <div className="flex items-center gap-2 text-[11.5px] text-ink-muted"><span className="font-semibold text-ink">{c.user.name}{c.userId === head?.id ? ' (Jesse)' : ''}</span>{fmtWhen(c.createdAt)}{c.callId && <span>· on a call{c.atSec != null ? ` at ${fmtDur(c.atSec)}` : ''}</span>}</div>
                <p className="mt-0.5 whitespace-pre-wrap text-left text-body-sm text-ink">{highlightMentions(c.body, c.mentions, members)}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="text-body-sm text-ink-muted">{d.can.cmr ? 'Jesse’s comments and your replies go here. @mention someone to notify them.' : 'No comments yet. @mention someone to notify them.'}</p>}
      <MentionBox members={members} onSubmit={async (body, mentions, reset) => { try { await leadsApi.comment(l.id, { body, mentions }); reset(); onPosted() } catch (e) { addToast({ type: 'error', message: apiErrorText(e, 'Could not post') }) } }} />
    </Card>
  )
}

function TasksCard({ l, canEdit, onAdd, onChanged }: { l: LeadFull; canEdit: boolean; onAdd: () => void; onChanged: () => void }) {
  const { addToast } = useToast()
  const open = l.tasks.filter((t) => !t.doneAt), done = l.tasks.filter((t) => t.doneAt)
  const [showDone, setShowDone] = useState(false)
  const complete = (id: string) => { const outcome = window.prompt('Outcome (optional):') ?? undefined; leadsApi.completeTask(id, { outcome: outcome || undefined }).then(onChanged).catch((e) => addToast({ type: 'error', message: apiErrorText(e, 'Could not complete') })) }
  const now = Date.now()
  return (
    <Card title={`Tasks (${open.length})`} icon={<CheckCircle2 size={15} />} action={canEdit && <Button size="sm" variant="ghost" leadingIcon={<Plus size={14} />} onClick={onAdd}>Add</Button>}>
      {open.length ? (
        <ul className="space-y-2">
          {open.map((t) => { const late = new Date(t.dueAt).getTime() < now; return (
            <li key={t.id} className={cn('rounded-card border p-2.5', late ? 'border-danger/30 bg-danger/[0.04]' : 'border-line')}>
              <div className="flex items-start justify-between gap-2"><span className="text-body-sm font-medium text-ink">{t.title}</span>{canEdit && <button type="button" className="shrink-0 text-body-sm font-semibold text-primary hover:underline" onClick={() => complete(t.id)}>Done</button>}</div>
              <div className={cn('mt-0.5 text-[11.5px]', late ? 'text-danger' : 'text-ink-muted')}>{TASK_KIND_LABEL[t.kind] ?? t.kind} · {late ? 'overdue · ' : 'due '}{fmtWhen(t.dueAt)}{t.assignee ? ` · ${t.assignee.name}` : ''}</div>
              {t.notes && <div className="mt-1 text-[11.5px] text-ink-muted">{t.notes}</div>}
            </li>) })}
        </ul>
      ) : <p className="text-body-sm text-ink-muted">Nothing open.</p>}
      {done.length > 0 && <button type="button" className="mt-3 inline-flex items-center gap-1 text-body-sm text-ink-muted hover:text-ink" onClick={() => setShowDone((v) => !v)}>{showDone ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{done.length} done</button>}
      {showDone && <ul className="mt-2 space-y-1">{done.map((t) => <li key={t.id} className="text-[11.5px] text-ink-muted line-through">{t.title} · {fmtDate(t.doneAt)}{t.outcome ? ` · ${t.outcome}` : ''}</li>)}</ul>}
    </Card>
  )
}

function DetailsCard({ l, cmr, onEdit }: { l: LeadFull; cmr: boolean; onEdit: () => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>({ contact: true, address: false, product: false })
  const Row = ({ k, v }: { k: string; v: ReactNode }) => v ? <div className="flex justify-between gap-3 py-1 text-body-sm"><dt className="text-ink-muted">{k}</dt><dd className="text-right text-ink">{v}</dd></div> : null
  const Sec = ({ id, icon, title, children }: { id: string; icon: ReactNode; title: string; children: ReactNode }) => (
    <div className="border-b border-line last:border-0">
      <button type="button" className="flex w-full items-center justify-between py-2 text-[13px] font-semibold text-ink" onClick={() => setOpen({ ...open, [id]: !open[id] })}><span className="inline-flex items-center gap-2"><span className="text-ink-faint">{icon}</span>{title}</span>{open[id] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
      {open[id] && <dl className="pb-2">{children}</dl>}
    </div>
  )
  return (
    <Card title="Lead details" icon={<Tag size={15} />} action={<Button size="sm" variant="ghost" leadingIcon={<Pencil size={14} />} onClick={onEdit}>Edit</Button>}>
      <Sec id="contact" icon={<UserCheck size={14} />} title="Contact information">
        <Row k="Contact" v={l.name} /><Row k={cmr ? 'Role' : 'Job title'} v={cmr ? l.contactRole : l.jobTitle} /><Row k="No. of employees" v={l.employees} /><Row k={cmr ? 'Segment' : 'Industry'} v={l.industry} />
        <Row k="Phone" v={l.phone} /><Row k="Ext" v={l.ext} /><Row k="Mobile" v={l.mobile} /><Row k="Email" v={l.email} /><Row k="Secondary email" v={l.secondaryEmail} /><Row k="Secondary contact" v={l.secondaryContact} />
        <Row k="Recipient name" v={l.recipientName} /><Row k="Recipient email" v={l.recipientEmail} /><Row k="Tags" v={l.tags.length ? l.tags.join(', ') : null} />
        {cmr && <Row k="Decision maker" v={YES_NO_LABEL[l.decisionMaker ?? 'UNKNOWN']} />}
      </Sec>
      <Sec id="address" icon={<MapPin size={14} />} title="Address information">
        <Row k="Street" v={l.street} /><Row k="City" v={l.city} /><Row k="State" v={l.state} /><Row k="Zip code" v={l.zip} /><Row k="Country" v={l.country} />
        {!l.street && !l.city && !l.zip && !l.country && !l.state && <p className="py-1 text-body-sm text-ink-faint">Not filled in.</p>}
      </Sec>
      <Sec id="product" icon={<Package size={14} />} title="Product information">
        {l.productInfo ? <p className="whitespace-pre-wrap py-1 text-body-sm text-ink">{l.productInfo}</p> : <p className="py-1 text-body-sm text-ink-faint">Product, quantity, anything purchased.</p>}
      </Sec>
      {l.message && <div className="pt-2"><p className="text-[13px] font-semibold text-ink">Notes</p><p className="mt-1 whitespace-pre-wrap text-body-sm text-ink-muted">{l.message}</p></div>}
    </Card>
  )
}

function TimelineCard({ l }: { l: LeadFull }) {
  const [all, setAll] = useState(false)
  const rows = all ? l.events : l.events.slice(0, 12)
  const text = (e: LeadFull['events'][number]) => {
    const data = e.data as { from?: string; to?: string } | null
    switch (e.kind) {
      case 'STATUS': return `Status: ${data?.from ?? ''} → ${data?.to ?? ''}${e.text ? ` · ${e.text}` : ''}`
      case 'ASSIGNED': return e.toName ? `Given to ${e.toName}` : e.text || 'Assigned'
      case 'CALL': return `Call · ${e.text}`
      case 'EMAIL': return `Email · ${e.text}`
      case 'COMMENT': return `Comment · ${e.text}`
      default: return `${e.kind[0] + e.kind.slice(1).toLowerCase()}${e.text ? ` · ${e.text}` : ''}`
    }
  }
  return (
    <Card title="Timeline" icon={<Clock size={15} />}>
      <ul className="space-y-2.5">
        {rows.map((e) => <li key={e.id} className="flex gap-2 text-[12px]"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-line-strong" /><span className="min-w-0"><span className="block text-ink">{text(e)}</span><span className="text-ink-faint">{fmtWhen(e.createdAt)}{e.user ? ` · ${e.user.name}` : ''}</span></span></li>)}
      </ul>
      {l.events.length > 12 && <button type="button" className="mt-3 text-body-sm text-primary hover:underline" onClick={() => setAll((v) => !v)}>{all ? 'Show less' : `Show all ${l.events.length}`}</button>}
    </Card>
  )
}

// ------------------------------------------------------------------ modals

function LogCallModal({ d, onClose, onDone }: { d: LeadDetail; onClose: () => void; onDone: () => void }) {
  const { addToast } = useToast()
  const { lead: l, can } = d
  const cmr = can.cmr
  const twoParty = cmr && !!l.state && (d.settings?.consentStates ?? []).map((s) => s.toUpperCase()).includes(l.state.toUpperCase())
  const [f, setF] = useState({ disposition: 'CONNECTED' as Disposition, minutes: '', outcome: '', summary: '', consent: false, nextStep: l.nextStep ?? '', nextStepDate: l.nextStepDate ? l.nextStepDate.slice(0, 10) : plusBusinessDays(2), owner: l.owner as Owner, handlesAlkaline: (l.handlesAlkaline ?? 'UNKNOWN') as YesNo, lbsPerShipment: l.lbsPerShipment ?? null, lbsPerMonth: l.lbsPerMonth ?? null, currentVendor: l.currentVendor ?? '', paysUnit: l.paysUnit ?? 'UNKNOWN', paysToday: l.paysToday ?? null, decisionMakerName: l.decisionMakerName ?? '', dmAgreed: (l.dmAgreed ?? 'UNKNOWN') as YesNo })
  const [busy, setBusy] = useState(false)
  const connected = f.disposition === 'CONNECTED'
  const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(/[^0-9.]/g, '')) || 0)
  const go = async () => {
    setBusy(true)
    try {
      const facts: LeadInput | undefined = cmr && connected ? { handlesAlkaline: f.handlesAlkaline, lbsPerShipment: f.lbsPerShipment, lbsPerMonth: f.lbsPerMonth, currentVendor: f.currentVendor.trim() || null, paysUnit: f.paysUnit, paysToday: f.paysToday, decisionMakerName: f.decisionMakerName.trim() || null, dmAgreed: f.dmAgreed } : undefined
      await leadsApi.addCall(l.id, { disposition: f.disposition, durationSec: f.minutes ? Math.round(Number(f.minutes) * 60) : undefined, outcome: f.outcome.trim() || undefined, summary: f.summary.trim() || undefined, consentGiven: twoParty ? f.consent : undefined, nextStep: f.nextStep.trim() || null, nextStepDate: f.nextStep.trim() ? f.nextStepDate || null : null, owner: f.owner, facts })
      addToast({ type: 'success', message: 'Call logged' }); onDone()
    } catch (e) { addToast({ type: 'error', message: apiErrorText(e, 'Could not log the call') }) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={`Log a call · ${leadTitle(l)}`} size="lg" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={go}>Save call</Button></>}>
      <div className="space-y-4">
        {twoParty && <p className="rounded-btn bg-primary/[0.06] px-3 py-2 text-body-sm text-ink"><ShieldCheck size={14} className="mr-1 inline text-primary" />{l.state} is a two-party consent state. Say: "This call may be recorded for quality purposes."</p>}
        <div className="flex flex-wrap gap-1.5">{DISPOSITIONS.map((x) => <button key={x} type="button" onClick={() => setF({ ...f, disposition: x })} className={cn('h-8 rounded-full border px-3 text-body-sm font-medium', f.disposition === x ? 'border-ink bg-ink text-card' : 'border-line text-ink-muted hover:text-ink')}>{DISPOSITION_LABEL[x]}</button>)}</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Length (minutes)" inputMode="decimal" value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value })} placeholder="e.g. 8" />
          {twoParty && <label className="flex items-end gap-2 pb-2 text-body-sm text-ink"><input type="checkbox" checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} />Consent to recording given</label>}
        </div>
        {cmr && connected && (
          <div className="rounded-card border border-line p-3">
            <p className="mb-2 text-body-sm font-semibold text-ink">Facts learned on this call <span className="font-normal text-ink-muted">(the rest on the lead's Five facts card)</span></p>
            <div className="grid gap-3 sm:grid-cols-3">
              <label><Label>Handles alkaline</Label>{yesNoSel(f.handlesAlkaline, (v) => setF({ ...f, handlesAlkaline: v }))}</label>
              <TextField label="Lbs per shipment" inputMode="decimal" value={f.lbsPerShipment ?? ''} onChange={(e) => setF({ ...f, lbsPerShipment: num(e.target.value) })} />
              <TextField label="Lbs per month" inputMode="decimal" value={f.lbsPerMonth ?? ''} onChange={(e) => setF({ ...f, lbsPerMonth: num(e.target.value) })} />
              <TextField label="Current vendor" value={f.currentVendor} onChange={(e) => setF({ ...f, currentVendor: e.target.value })} />
              <label><Label>They pay</Label><Select value={f.paysUnit} onChange={(e) => setF({ ...f, paysUnit: e.target.value })} className="w-full">{PAYS_UNITS.map((u) => <option key={u} value={u}>{PAYS_LABEL[u]}</option>)}</Select></label>
              <TextField label="Amount ($)" inputMode="decimal" disabled={f.paysUnit === 'NONE' || f.paysUnit === 'UNKNOWN'} value={f.paysToday ?? ''} onChange={(e) => setF({ ...f, paysToday: num(e.target.value) })} />
              <TextField label="Decision maker" value={f.decisionMakerName} onChange={(e) => setF({ ...f, decisionMakerName: e.target.value })} />
              <label><Label>Will talk to Jesse</Label>{yesNoSel(f.dmAgreed, (v) => setF({ ...f, dmAgreed: v }))}</label>
            </div>
            <p className="mt-2 text-[11.5px] text-ink-muted">Ask: do they use Call2Recycle / The Battery Network? If yes, praise it; never pitch against it.</p>
          </div>
        )}
        <TextArea label={connected ? 'Outcome (one or two sentences, facts only)' : 'Note'} rows={2} value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })} placeholder={connected ? 'Interested; wants the profile; ships about 3,000 lb a month' : 'Left a message about…'} />
        {cmr && connected && <TextArea label="Call summary (optional: Metriq writes it from the facts and the outcome)" rows={2} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} />}
        <div className="grid gap-3 sm:grid-cols-[1fr_150px_150px]">
          <TextField label="Next step" value={f.nextStep} onChange={(e) => setF({ ...f, nextStep: e.target.value })} placeholder="Send info · Follow up · Ask for volume" />
          <TextField label="Date" type="date" value={f.nextStepDate} onChange={(e) => setF({ ...f, nextStepDate: e.target.value })} />
          <label><Label>Owner</Label><Select value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value as Owner })} className="w-full">{(Object.keys(OWNER_LABEL) as Owner[]).map((k) => <option key={k} value={k}>{OWNER_LABEL[k]}</option>)}</Select></label>
        </div>
      </div>
    </Modal>
  )
}

function SendInfoModal({ l, onClose, onDone }: { l: LeadFull; onClose: () => void; onDone: () => void }) {
  const { addToast } = useToast()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const go = async () => { setBusy(true); try { const r = await leadsApi.sendInfo(l.id, note.trim() || undefined); addToast({ type: 'success', message: `Info sent to ${r.sentTo}. Follow-up task made for 2 business days.` }); onDone() } catch (e) { addToast({ type: 'error', message: apiErrorText(e, 'Could not send') }) } finally { setBusy(false) } }
  return (
    <Modal open onClose={onClose} title="Send the CMR profile" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy} leadingIcon={<Send size={14} />} onClick={go}>Send to {l.email}</Button></>}>
      <div className="space-y-3">
        <p className="text-body-sm text-ink-muted">The email comes from the template in Lead Settings, with the published rate. Status becomes Info Sent and the next step date moves two business days out.</p>
        <TextArea label="A personal line (optional)" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Good to talk about your Phoenix program today." />
        <p className="text-[11.5px] text-ink-muted">Never a price, freight or pickup promise: Jesse gives those. Metriq refuses a note that reads like one.</p>
      </div>
    </Modal>
  )
}

function QualifyModal({ d, onClose, onDone }: { d: LeadDetail; onClose: () => void; onDone: () => void }) {
  const { addToast } = useToast()
  const { lead: l, can } = d
  const [ask, setAsk] = useState(l.jesseAsk ?? '')
  const [busy, setBusy] = useState(false)
  const missing = l.facts.filter((f) => !f.done)
  const approving = !!l.qualifyRequestedAt && can.approve
  const go = async () => { setBusy(true); try { const r = approving ? await leadsApi.approve(l.id, ask.trim() || undefined).then(() => ({ flagged: true })) : await leadsApi.qualify(l.id, ask.trim()); addToast({ type: 'success', message: r.flagged ? 'Flagged for Jesse. He has 1 business day.' : 'Sent to the team lead to approve.' }); onDone() } catch (e) { addToast({ type: 'error', message: apiErrorText(e, 'Could not qualify') }) } finally { setBusy(false) } }
  return (
    <Modal open onClose={onClose} title={approving ? 'Approve and flag for Jesse' : 'Qualify this lead'} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || !!missing.length || ask.trim().length < 5} leadingIcon={<Flag size={14} />} onClick={go}>{approving ? 'Flag for Jesse' : can.manage ? 'Qualify and flag' : 'Ask the team lead'}</Button></>}>
      <div className="space-y-3">
        <ul className="grid gap-1 sm:grid-cols-2">{l.facts.map((f) => <li key={f.key}><Done ok={f.done}>{f.label}</Done></li>)}</ul>
        {missing.length > 0 && <p className="rounded-btn bg-warning/10 px-3 py-2 text-body-sm text-amber-800">Fill the missing facts first: {missing.map((f) => f.label).join(', ')}.</p>}
        <TextArea label="One line: what must Jesse decide?" rows={2} value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Approve a meeting? 3,000 lb/month sorted alkaline, pays $0.10/lb today, wants a rate." />
        <p className="text-[11.5px] text-ink-muted">Status becomes Qualified, owner Jesse, flag on. {l.belowMin ? 'This lead is below the load minimum: say so in the line.' : ''}</p>
      </div>
    </Modal>
  )
}

function CloseModal({ d, onClose, onDone }: { d: LeadDetail; onClose: () => void; onDone: () => void }) {
  const { addToast } = useToast()
  const { lead: l, pipeline, can } = d
  const closed = pipeline.filter((s) => !s.open && (s.key !== 'CLOSED_WON' && s.key !== 'WON' || can.manage))
  const [status, setStatus] = useState(closed[0]?.key ?? '')
  const [reason, setReason] = useState<string>(d.can.cmr ? 'OTHER' : '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const go = async () => { setBusy(true); try { await leadsApi.close(l.id, { status, reason: d.can.cmr ? reason : (note.trim() || undefined), note: note.trim() || undefined }); onDone() } catch (e) { addToast({ type: 'error', message: apiErrorText(e, 'Could not close') }) } finally { setBusy(false) } }
  return (
    <Modal open onClose={onClose} title="Close out" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || !status} onClick={go}>Close lead</Button></>}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">{closed.map((s) => <button key={s.key} type="button" onClick={() => setStatus(s.key)} className={cn('h-8 rounded-full border px-3 text-body-sm font-medium', status === s.key ? 'border-ink bg-ink text-card' : 'border-line text-ink-muted hover:text-ink')}>{s.label}</button>)}</div>
        {d.can.cmr && <label><Label>Reason</Label><Select value={reason} onChange={(e) => setReason(e.target.value)} className="w-full">{CLOSE_REASONS.map((r) => <option key={r} value={r}>{CLOSE_REASON_LABEL[r]}</option>)}</Select></label>}
        <TextArea label={d.can.cmr ? 'Note' : 'Reason / note'} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        {d.can.cmr && status === 'EXISTING_CUSTOMER' && !can.decide && <p className="text-body-sm text-ink-muted">Existing Customer is Jesse's call: this goes to him as a flag to confirm.</p>}
      </div>
    </Modal>
  )
}

function DecideModal({ l, onClose, onDone }: { l: LeadFull; onClose: () => void; onDone: () => void }) {
  const { addToast } = useToast()
  const slots = l.meetingSlots ?? []
  const [action, setAction] = useState<'MEETING' | 'DIRECTION' | 'CLOSE'>(slots.length ? 'MEETING' : 'DIRECTION')
  const [slot, setSlot] = useState(slots[0] ?? '')
  const [custom, setCustom] = useState('')
  const [text, setText] = useState('')
  const [status, setStatus] = useState('NOT_A_FIT')
  const [reason, setReason] = useState<string>('OTHER')
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    try {
      if (action === 'MEETING') await leadsApi.decide(l.id, { action, slot: slot || new Date(custom).toISOString(), text: text.trim() || undefined })
      else if (action === 'DIRECTION') await leadsApi.decide(l.id, { action, text: text.trim() })
      else await leadsApi.decide(l.id, { action, status, reason, text: text.trim() || undefined })
      addToast({ type: 'success', message: 'Decided. The SDR has been told.' }); onDone()
    } catch (e) { addToast({ type: 'error', message: apiErrorText(e, 'Could not save') }) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={`Decide · ${leadTitle(l)}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || (action === 'MEETING' && !slot && !custom) || (action === 'DIRECTION' && text.trim().length < 3)} onClick={go}>Confirm</Button></>}>
      <div className="space-y-3">
        <p className="rounded-btn bg-orange-50/60 px-3 py-2 text-body-sm text-ink dark:bg-orange-500/10"><strong>Asked:</strong> {l.jesseAsk}</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {([['MEETING', 'Approve meeting', 'Pick a slot; the SDR sends the invite today'], ['DIRECTION', 'Pricing / freight direction', 'Your answer goes to the SDR to relay'], ['CLOSE', 'Close out', 'With a reason; the flag clears']] as const).map(([k, t, h]) => (
            <button key={k} type="button" onClick={() => setAction(k)} className={cn('rounded-card border p-3 text-left', action === k ? 'border-primary bg-primary/[0.06]' : 'border-line hover:border-line-strong')}><span className="block text-body-sm font-semibold text-ink">{t}</span><span className="block text-[11.5px] text-ink-muted">{h}</span></button>
          ))}
        </div>
        {action === 'MEETING' && (
          <div className="space-y-2">
            {slots.length ? slots.map((s) => <label key={s} className={cn('flex cursor-pointer items-center gap-2 rounded-btn border px-3 py-2 text-body-sm', slot === s ? 'border-primary bg-primary/[0.06]' : 'border-line')}><input type="radio" name="slot" checked={slot === s} onChange={() => { setSlot(s); setCustom('') }} /><span>{inZone(s, l.zone)} <span className="text-ink-muted">· {inZone(s, 'America/Phoenix')} · {inZone(s, 'America/Los_Angeles')}</span></span></label>) : <p className="text-body-sm text-ink-muted">No slots offered yet. Type a time (your local time):</p>}
            <TextField type="datetime-local" value={custom} onChange={(e) => { setCustom(e.target.value); setSlot('') }} aria-label="Another time" />
          </div>
        )}
        {action === 'CLOSE' && (
          <div className="grid gap-2 sm:grid-cols-2">
            <label><Label>Status</Label><Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full"><option value="NOT_A_FIT">Not a Fit</option><option value="EXISTING_CUSTOMER">Existing Customer</option><option value="REFERRAL_PARTNER">Referral Partner</option><option value="CLOSED_LOST">Closed Lost</option></Select></label>
            <label><Label>Reason</Label><Select value={reason} onChange={(e) => setReason(e.target.value)} className="w-full">{CLOSE_REASONS.map((r) => <option key={r} value={r}>{CLOSE_REASON_LABEL[r]}</option>)}</Select></label>
          </div>
        )}
        <TextArea label={action === 'DIRECTION' ? 'Your answer (rate, freight, pickup)' : 'Comment (optional)'} rows={3} value={text} onChange={(e) => setText(e.target.value)} />
        <p className="text-[11.5px] text-ink-muted">Your comment is saved as the Jesse Comment and the SDR gets a task.</p>
      </div>
    </Modal>
  )
}

function SlotsModal({ l, onClose, onDone }: { l: LeadFull; onClose: () => void; onDone: () => void }) {
  const { addToast } = useToast()
  const [slots, setSlots] = useState<string[]>(l.meetingSlots?.map((s) => toLocalInput(new Date(s))) ?? ['', '', ''])
  const [busy, setBusy] = useState(false)
  const go = async () => { setBusy(true); try { await leadsApi.slots(l.id, slots.filter(Boolean).map((s) => new Date(s).toISOString())); onDone() } catch (e) { addToast({ type: 'error', message: apiErrorText(e, 'Could not save') }) } finally { setBusy(false) } }
  return (
    <Modal open onClose={onClose} title="Offer meeting slots" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || !slots.some(Boolean)} onClick={go}>Save slots</Button></>}>
      <div className="space-y-3">
        <p className="text-body-sm text-ink-muted">Two or three times the prospect can do, in <strong>your local time</strong>; Metriq shows each in the prospect's zone ({l.zone.replace('America/', '').replace('_', ' ')}), Phoenix and Pacific.</p>
        {slots.map((s, i) => <div key={i} className="flex items-center gap-2"><TextField type="datetime-local" value={s} onChange={(e) => setSlots(slots.map((x, j) => (j === i ? e.target.value : x)))} className="flex-1" />{s && <span className="text-[11.5px] text-ink-muted">{inZone(new Date(s).toISOString(), l.zone)}</span>}<button type="button" className="text-ink-faint hover:text-danger" onClick={() => setSlots(slots.filter((_, j) => j !== i))} aria-label="Remove"><X size={14} /></button></div>)}
        {slots.length < 5 && <button type="button" className="text-body-sm text-primary hover:underline" onClick={() => setSlots([...slots, ''])}>+ another slot</button>}
      </div>
    </Modal>
  )
}

function InviteModal({ l, copyName, head, onClose, onDone }: { l: LeadFull; copyName: string; head: { name: string } | null; onClose: () => void; onDone: () => void }) {
  const { addToast } = useToast()
  const [link, setLink] = useState(l.meetingLink ?? '')
  const [minutes, setMinutes] = useState('30')
  const [at, setAt] = useState(l.meetingAt ? toLocalInput(new Date(l.meetingAt)) : '')
  const [busy, setBusy] = useState(false)
  const go = async () => { setBusy(true); try { const r = await leadsApi.invite(l.id, { link: link.trim() || null, minutes: Number(minutes) || 30, at: at ? new Date(at).toISOString() : undefined }); addToast({ type: 'success', message: `Invite sent to ${r.sentTo.join(', ')}` }); onDone() } catch (e) { addToast({ type: 'error', message: apiErrorText(e, 'Could not send') }) } finally { setBusy(false) } }
  const when = at ? new Date(at).toISOString() : l.meetingAt
  return (
    <Modal open onClose={onClose} title="Send the meeting invite" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || !l.email} leadingIcon={<Send size={14} />} onClick={go}>Send invite</Button></>}>
      <div className="space-y-3">
        <p className="text-body-sm text-ink-muted">A calendar invite (.ics) goes to <strong>{l.email ?? 'the prospect (add an email first)'}</strong>, {head?.name ?? 'Jesse'}{copyName ? ` and ${copyName}` : ''}. The body lists the time in the prospect's zone, Phoenix and Pacific.</p>
        {when && <p className="rounded-btn bg-slate-50 px-3 py-2 text-body-sm text-ink dark:bg-white/[0.03]">{inZone(when, l.zone)} (prospect) · {inZone(when, 'America/Phoenix')} (Phoenix) · {inZone(when, 'America/Los_Angeles')} (Pacific)</p>}
        <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
          <TextField label="Meeting time (change only if Jesse agreed another)" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
          <TextField label="Minutes" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </div>
        <TextField label="Teams link" placeholder="https://teams.microsoft.com/l/meetup-join/…" value={link} onChange={(e) => setLink(e.target.value)} />
        <p className="text-[11.5px] text-ink-muted">Paste the Teams link from Outlook until the Microsoft keys are on the server. Afterwards: the flag clears, and two tasks are made (reconfirm the day before, outcome within 2 days).</p>
      </div>
    </Modal>
  )
}

function ReconfirmModal({ l, onClose, onDone }: { l: LeadFull; onClose: () => void; onDone: () => void }) {
  const { addToast } = useToast()
  const [brief, setBrief] = useState(`Who: ${l.decisionMakerName || l.name}${l.contactRole ? ` (${l.contactRole})` : ''}, ${l.organization ?? ''}.\nWhat: ${l.material?.length ? l.material.map((m) => MATERIAL_LABEL[m as keyof typeof MATERIAL_LABEL] ?? m).join(', ') : 'material?'}, ${l.lbsPerShipment ? `${l.lbsPerShipment.toLocaleString()} lb/load` : ''}${l.lbsPerMonth ? `, ${l.lbsPerMonth.toLocaleString()} lb/month` : ''}; vendor ${l.currentVendor ?? '?'} pays ${l.paysUnit === 'NONE' ? 'nothing' : l.paysToday != null ? `$${l.paysToday}/lb` : '?'}.\nAsk: ${l.jesseAsk ?? ''}`)
  const [busy, setBusy] = useState(false)
  const go = async () => { setBusy(true); try { await leadsApi.reconfirm(l.id, brief.trim()); addToast({ type: 'success', message: 'Reconfirmed. The brief went to Jesse.' }); onDone() } catch (e) { addToast({ type: 'error', message: apiErrorText(e, 'Could not save') }) } finally { setBusy(false) } }
  return (
    <Modal open onClose={onClose} title="Reconfirm and brief Jesse" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || brief.trim().length < 10} onClick={go}>Reconfirmed · send brief</Button></>}>
      <div className="space-y-3"><p className="text-body-sm text-ink-muted">You reconfirmed with the prospect. The 3-line brief below goes into the Jesse Comment and his notifications.</p><TextArea label="3-line brief" rows={5} value={brief} onChange={(e) => setBrief(e.target.value)} /></div>
    </Modal>
  )
}

function OutcomeModal({ l, onClose, onDone }: { l: LeadFull; onClose: () => void; onDone: () => void }) {
  const { addToast } = useToast()
  const [outcome, setOutcome] = useState<string>('QUOTE_SENT')
  const [note, setNote] = useState('')
  const [date, setDate] = useState('')
  const [busy, setBusy] = useState(false)
  const go = async () => { setBusy(true); try { await leadsApi.outcome(l.id, { outcome, note: note.trim() || undefined, nextStepDate: date || null }); onDone() } catch (e) { addToast({ type: 'error', message: apiErrorText(e, 'Could not save') }) } finally { setBusy(false) } }
  return (
    <Modal open onClose={onClose} title="Meeting outcome" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={go}>Save outcome</Button></>}>
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">{MEETING_OUTCOMES.map((o) => <button key={o} type="button" onClick={() => setOutcome(o)} className={cn('rounded-card border p-3 text-left text-body-sm font-semibold', outcome === o ? 'border-primary bg-primary/[0.06] text-ink' : 'border-line text-ink-muted')}>{OUTCOME_LABEL[o]}</button>)}</div>
        {(outcome === 'QUOTE_SENT' || outcome === 'NURTURE') && <TextField label="Next step date (blank = Metriq picks one)" type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
        <TextArea label="Note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Modal>
  )
}

function TaskModal({ l, people, canAssign, onClose, onDone }: { l: LeadFull; people: { id: string; name: string }[]; canAssign: boolean; onClose: () => void; onDone: () => void }) {
  const { addToast } = useToast()
  const [f, setF] = useState({ title: '', notes: '', date: toYmd(new Date()), time: '10:00', assigneeId: l.assigneeId ?? '', kind: 'CUSTOM' as 'CALL' | 'CUSTOM' })
  const [busy, setBusy] = useState(false)
  const go = async () => { setBusy(true); try { await leadsApi.addTask({ leadId: l.id, title: f.title.trim(), notes: f.notes.trim() || undefined, dueAt: new Date(`${f.date}T${f.time}`).toISOString(), assigneeId: canAssign ? f.assigneeId || null : undefined, kind: f.kind }); onDone() } catch (e) { addToast({ type: 'error', message: apiErrorText(e, 'Could not add') }) } finally { setBusy(false) } }
  return (
    <Modal open onClose={onClose} title="New task" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || !f.title.trim()} onClick={go}>Add task</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><TextField label="Task" autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Call back about the pickup city" /></div>
        <TextField label="Date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        <TextField label="Time" type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} />
        <label><Label>Kind</Label><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as 'CALL' | 'CUSTOM' })} className="w-full"><option value="CUSTOM">Task</option><option value="CALL">Call</option></Select></label>
        {canAssign && <label><Label>For</Label><Select value={f.assigneeId} onChange={(e) => setF({ ...f, assigneeId: e.target.value })} className="w-full"><option value="">Me</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></label>}
        <div className="sm:col-span-2"><TextArea label="Notes" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
      </div>
    </Modal>
  )
}

function EditModal({ d, onClose, onDone }: { d: LeadDetail; onClose: () => void; onDone: () => void }) {
  const { addToast } = useToast()
  const { lead: l, can } = d
  const cmr = can.cmr
  const keys = ['organization', 'name', 'contactRole', 'jobTitle', 'employees', 'industry', 'phone', 'ext', 'mobile', 'email', 'secondaryEmail', 'secondaryContact', 'website', 'recipientName', 'recipientEmail', 'street', 'city', 'state', 'zip', 'country', 'productInfo', 'message'] as const
  const [f, setF] = useState<Record<string, string>>(() => Object.fromEntries(keys.map((k) => [k, String((l as unknown as Record<string, unknown>)[k] ?? '')])))
  const [tags, setTags] = useState(l.tags.join(', '))
  const [decisionMaker, setDecisionMaker] = useState<YesNo>(l.decisionMaker ?? 'UNKNOWN')
  const [busy, setBusy] = useState(false)
  const settings = useMemo(() => d.settings, [d.settings])
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value })
  const go = async () => {
    setBusy(true)
    try {
      const body: LeadInput = { tags: tags.split(/[,;]/).map((t) => t.trim()).filter(Boolean) }
      for (const k of keys) { if (k === 'contactRole' && !cmr) continue; (body as Record<string, unknown>)[k] = k === 'name' ? f[k] : f[k].trim() || null }
      if (cmr) body.decisionMaker = decisionMaker
      await leadsApi.update(l.id, body); onDone()
    } catch (e) { addToast({ type: 'error', message: apiErrorText(e, 'Could not save') }) } finally { setBusy(false) }
  }
  const T = (k: typeof keys[number], label: string, extra: Record<string, unknown> = {}) => <TextField label={label} value={f[k]} onChange={set(k)} {...extra} />
  return (
    <Modal open onClose={onClose} title="Edit lead" size="lg" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={go}>Save</Button></>}>
      <div className="space-y-4">
        <div><p className="mb-2 text-body-sm font-semibold text-ink">Contact information</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {T('organization', 'Company')}{T('name', 'Contact name')}{cmr ? T('contactRole', 'Role') : T('jobTitle', 'Job title')}{T('employees', 'No. of employees')}
            <label><Label>{cmr ? 'Segment' : 'Industry'}</Label><Select value={f.industry} onChange={set('industry')} className="w-full"><option value="">—</option>{(settings?.segments ?? (f.industry ? [f.industry] : [])).map((s) => <option key={s} value={s}>{s}</option>)}{!settings && <option value={f.industry}>{f.industry}</option>}</Select></label>
            {T('phone', 'Phone')}{T('ext', 'Ext')}{T('mobile', 'Mobile')}{T('email', 'Email', { type: 'email' })}{T('secondaryEmail', 'Secondary email', { type: 'email' })}{T('secondaryContact', 'Secondary contact')}{T('website', 'Website')}{T('recipientName', 'Recipient name')}{T('recipientEmail', 'Recipient email', { type: 'email' })}
            <TextField label="Tags (comma separated)" value={tags} onChange={(e) => setTags(e.target.value)} />
            {cmr && <label><Label>Decision maker</Label>{yesNoSel(decisionMaker, setDecisionMaker)}</label>}
          </div></div>
        <div><p className="mb-2 text-body-sm font-semibold text-ink">Address information</p>
          <div className="grid gap-3 sm:grid-cols-3">{T('street', 'Street')}{T('city', 'City')}
            <label><Label>State</Label><Select value={f.state} onChange={set('state')} className="w-full"><option value="">—</option>{(settings?.states ?? []).map((s) => <option key={s} value={s}>{s}</option>)}{f.state && !(settings?.states ?? []).includes(f.state) && <option value={f.state}>{f.state}</option>}</Select></label>
            {T('zip', 'Zip code')}{T('country', 'Country')}</div></div>
        <div><p className="mb-2 text-body-sm font-semibold text-ink">Product information</p><TextArea rows={2} value={f.productInfo} onChange={set('productInfo')} placeholder="Product name, description, quantity purchased…" /></div>
        <TextArea label="Notes" rows={2} value={f.message} onChange={set('message')} />
      </div>
    </Modal>
  )
}
