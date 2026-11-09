import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, CalendarClock, CheckCircle2, ListChecks, Phone } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { Modal } from '../../../components/ui/Modal'
import { EmptyState } from '../../../components/ui/EmptyState'
import { TextField, TextArea } from '../../../components/ui/Input'
import { useToast } from '../../../components/ui/Toast'
import { apiErrorText } from '../../../lib/api'
import { cn } from '../../../lib/cn'
import { dialHref, fmtWhen, leadsApi, plusBusinessDays, TASK_KIND_LABEL, toYmd, type LeadTask } from '../../../lib/leadsApi'
import { BusinessPicker, PageHeader, Select, StatusPill, useBusiness, useLeadsMeta } from './shared'

const TABS = [['today', 'Today'], ['overdue', 'Overdue'], ['upcoming', 'Upcoming'], ['all', 'All open'], ['done', 'Done']] as const

/** Agent Tasks like LeadWise: lead, company, phone, task, status, when, notes, and Call / Schedule / Complete. Most tasks are made by the flow. */
export default function LeadTasks() {
  const { addToast } = useToast()
  const { meta } = useLeadsMeta()
  const { business, all } = useBusiness()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'today'
  const assignee = params.get('assignee') ?? ''
  const focus = params.get('task')
  const [d, setD] = useState<{ tasks: LeadTask[]; counts: { today: number; overdue: number; upcoming: number } } | null>(null)
  const [act, setAct] = useState<{ kind: 'schedule' | 'complete'; task: LeadTask } | null>(null)
  const canManage = !!meta?.me.admin || (all ? (meta?.me.managerOf.length ?? 0) > 0 : business?.myRole === 'MANAGER')
  const load = useCallback(() => leadsApi.tasks({ tab, assignee: assignee || undefined, business: all ? undefined : business?.id }).then(setD).catch((e) => addToast({ type: 'error', message: apiErrorText(e, 'Could not load') })), [tab, assignee, business, all, addToast])
  useEffect(() => { load() }, [load])
  const setP = (k: string, v: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n })

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-4">
      <PageHeader title="Agent Tasks" hint="Follow-ups, next steps and the flow's own tasks. Due at 10:00 Phoenix unless set otherwise." actions={<>
        {canManage && <Select value={assignee} onChange={(e) => setP('assignee', e.target.value || null)} aria-label="Agent"><option value="">All agents</option><option value="me">Me</option>{(business?.members ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>}
        <BusinessPicker allowAll />
      </>} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex max-w-full flex-wrap rounded-btn border border-line bg-card p-0.5">
          {TABS.map(([k, l]) => <button key={k} type="button" onClick={() => setP('tab', k === 'today' ? null : k)} className={cn('inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-body-sm font-semibold', tab === k ? 'bg-ink text-card' : 'text-ink-muted hover:text-ink')}>{l}{d && k !== 'done' && k !== 'all' && <span className={cn('rounded-full px-1.5 text-[11px] tabular-nums', tab === k ? 'bg-card/20' : k === 'overdue' && d.counts.overdue ? 'bg-danger/10 text-danger' : 'bg-slate-100 dark:bg-white/10')}>{d.counts[k as 'today' | 'overdue' | 'upcoming']}</span>}</button>)}
        </div>
      </div>
      {/* Phones: one card per task. */}
      <div className="space-y-2 md:hidden">
        {d?.tasks.map((t) => (
          <div key={t.id} className={cn('rounded-card border border-line bg-card p-3 shadow-xs', focus === t.id && 'border-primary/50 bg-primary/[0.04]', t.overdue && !t.doneAt && 'border-danger/30')}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Link to={`/app/leads/${t.lead?.id}`} className="block truncate font-semibold text-ink hover:underline">{t.lead?.organization || t.lead?.name || 'Lead'}</Link>
                <div className="truncate text-[11.5px] text-ink-muted">{[t.lead?.organization ? t.lead?.name : null, t.lead?.phone].filter(Boolean).join(' · ') || t.lead?.business.name}</div>
              </div>
              {t.doneAt ? <Badge tone="success">Done</Badge> : t.overdue ? <Badge tone="danger" dot>Overdue</Badge> : t.today ? <Badge tone="warning" dot>Due today</Badge> : <Badge>Upcoming</Badge>}
            </div>
            <div className="mt-2 font-medium text-ink">{t.title}</div>
            <div className="text-[11.5px] text-ink-muted">{TASK_KIND_LABEL[t.kind] ?? t.kind} · {fmtWhen(t.dueAt)}{t.assignee && canManage ? ` · ${t.assignee.name}` : ''}</div>
            {(t.notes || t.outcome) && <p className="mt-1 line-clamp-2 text-body-sm text-ink-muted">{t.notes || t.outcome}</p>}
            {!t.doneAt && (
              <div className="mt-2.5 flex gap-1.5">
                {t.lead?.phone && <a href={dialHref(t.lead.phone, meta?.dial) ?? '#'} className="flex-1"><Button size="sm" variant="secondary" className="w-full" leadingIcon={<Phone size={13} />}>Call</Button></a>}
                <Button size="sm" variant="ghost" className="flex-1" leadingIcon={<CalendarClock size={13} />} onClick={() => setAct({ kind: 'schedule', task: t })}>Schedule</Button>
                <Button size="sm" className="flex-1" leadingIcon={<CheckCircle2 size={13} />} onClick={() => setAct({ kind: 'complete', task: t })}>Complete</Button>
              </div>
            )}
          </div>
        ))}
        {d && !d.tasks.length && <div className="rounded-card border border-line bg-card px-3 py-10"><EmptyState compact icon={<ListChecks />} title={tab === 'overdue' ? 'Nothing overdue' : tab === 'done' ? 'Nothing done yet' : 'No tasks here'} hint={tab === 'today' ? 'Tasks come from calls, next steps and the flow.' : undefined} /></div>}
      </div>
      <div className="overflow-hidden rounded-card border border-line bg-card shadow-xs max-md:hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-body-sm">
            <thead className="bg-slate-50 text-[11.5px] uppercase tracking-wide text-ink-muted dark:bg-white/[0.03]"><tr>{['Lead', 'Company', 'Phone', 'Task', 'Status', 'Scheduled', 'Notes', 'For', 'Actions'].map((h) => <th key={h} className={cn('px-3 py-2.5 font-semibold', h === 'Actions' && 'text-right')}>{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">
              {d?.tasks.map((t) => (
                <tr key={t.id} className={cn('transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.03]', focus === t.id && 'bg-primary/[0.06]', t.overdue && 'bg-danger/[0.03]')}>
                  <td className="px-3 py-2.5"><Link to={`/app/leads/${t.lead?.id}`} className="font-semibold text-ink hover:underline">{t.lead?.name || t.lead?.organization || 'Lead'}</Link><div className="text-[11.5px] text-ink-muted">{t.lead?.business.name}</div></td>
                  <td className="px-3 py-2.5 text-ink">{t.lead?.organization ?? '—'}{t.lead && <div className="mt-0.5"><StatusPill status={t.lead.status} label={t.lead.statusLabel} size="sm" /></div>}</td>
                  <td className="px-3 py-2.5 text-ink">{t.lead?.phone ?? '—'}</td>
                  <td className="px-3 py-2.5"><div className="font-medium text-ink">{t.title}</div><div className="text-[11.5px] text-ink-muted">{TASK_KIND_LABEL[t.kind] ?? t.kind}</div></td>
                  <td className="px-3 py-2.5">{t.doneAt ? <Badge tone="success">Done</Badge> : t.overdue ? <Badge tone="danger" dot>Overdue</Badge> : t.today ? <Badge tone="warning" dot>Due today</Badge> : <Badge>Upcoming</Badge>}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-ink">{fmtWhen(t.dueAt)}</td>
                  <td className="max-w-[260px] px-3 py-2.5 text-ink-muted"><span className="line-clamp-2">{t.notes || t.outcome || '—'}</span></td>
                  <td className="px-3 py-2.5 text-ink">{t.assignee?.name ?? '—'}</td>
                  <td className="px-3 py-2.5 text-right">
                    {!t.doneAt && <span className="inline-flex gap-1">
                      {t.lead?.phone && <a href={dialHref(t.lead.phone, meta?.dial) ?? '#'}><Button size="sm" variant="secondary" leadingIcon={<Phone size={13} />}>Call</Button></a>}
                      <Button size="sm" variant="ghost" leadingIcon={<CalendarClock size={13} />} onClick={() => setAct({ kind: 'schedule', task: t })}>Schedule</Button>
                      <Button size="sm" leadingIcon={<CheckCircle2 size={13} />} onClick={() => setAct({ kind: 'complete', task: t })}>Complete</Button>
                    </span>}
                  </td>
                </tr>
              ))}
              {d && !d.tasks.length && <tr><td colSpan={9} className="px-3 py-12"><EmptyState compact icon={<ListChecks />} title={tab === 'overdue' ? 'Nothing overdue' : tab === 'done' ? 'Nothing done yet' : 'No tasks here'} hint={tab === 'today' ? 'Tasks come from calls, next steps and the flow.' : undefined} /></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {act?.kind === 'schedule' && <ScheduleModal task={act.task} onClose={() => setAct(null)} onDone={() => { setAct(null); load() }} />}
      {act?.kind === 'complete' && <CompleteModal task={act.task} onClose={() => setAct(null)} onDone={() => { setAct(null); load() }} />}
    </div>
  )
}

function ScheduleModal({ task, onClose, onDone }: { task: LeadTask; onClose: () => void; onDone: () => void }) {
  const { addToast } = useToast()
  const due = new Date(task.dueAt)
  const [date, setDate] = useState(toYmd(due))
  const [time, setTime] = useState(`${String(due.getHours()).padStart(2, '0')}:${String(due.getMinutes()).padStart(2, '0')}`)
  const [notes, setNotes] = useState(task.notes)
  const go = () => leadsApi.updateTask(task.id, { dueAt: new Date(`${date}T${time}`).toISOString(), notes }).then(onDone).catch((e) => addToast({ type: 'error', message: apiErrorText(e, 'Could not save') }))
  return (
    <Modal open onClose={onClose} title="Schedule" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={go}>Save</Button></>}>
      <div className="space-y-3"><p className="text-body-md font-medium text-ink">{task.title}</p>
        <div className="grid grid-cols-2 gap-3"><TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /><TextField label="Time" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
        <div className="flex gap-1.5">{[['Tomorrow', plusBusinessDays(1)], ['+2 business days', plusBusinessDays(2)], ['Next week', plusBusinessDays(5)]].map(([l, v]) => <button key={l} type="button" onClick={() => setDate(v)} className="h-7 rounded-full border border-line px-2.5 text-[12px] text-ink-muted hover:text-ink">{l}</button>)}</div>
        <TextArea label="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
    </Modal>
  )
}

function CompleteModal({ task, onClose, onDone }: { task: LeadTask; onClose: () => void; onDone: () => void }) {
  const { addToast } = useToast()
  const [outcome, setOutcome] = useState('')
  const [next, setNext] = useState('')
  const [date, setDate] = useState(plusBusinessDays(2))
  const go = () => leadsApi.completeTask(task.id, { outcome: outcome.trim() || undefined, nextStep: next.trim() || undefined, nextStepDate: next.trim() ? date : undefined }).then(onDone).catch((e) => addToast({ type: 'error', message: apiErrorText(e, 'Could not complete') }))
  return (
    <Modal open onClose={onClose} title="Complete task" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={go}>Mark done</Button></>}>
      <div className="space-y-3"><p className="text-body-md font-medium text-ink">{task.title}</p>
        <TextArea label="Outcome" rows={2} value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="What happened" />
        <div className="grid gap-3 sm:grid-cols-[1fr_150px]"><TextField label="Next step (optional)" value={next} onChange={(e) => setNext(e.target.value)} placeholder="Leave empty if nothing follows" /><TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={!next.trim()} /></div>
        <p className="inline-flex items-center gap-1 text-[11.5px] text-ink-muted"><AlertTriangle size={12} />A next step makes a new task on the lead.</p></div>
    </Modal>
  )
}
