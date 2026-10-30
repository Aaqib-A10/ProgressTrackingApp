import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Circle, Clock3 } from 'lucide-react'
import { useToast } from '../../../../components/ui/Toast'
import { cn } from '../../../../lib/cn'
import { dialerApi, type DialerData, type TaskHistory, type TaskHistoryRow } from '../../../../lib/dialerApi'
import { TASK_KINDS, taskBucket } from '../../../../lib/dialer'
import { errMsg } from './ui'

/**
 * Task history (inside Follow-ups): three columns, Overdue, Due today / upcoming, Completed
 * (newest first, with the date, the outcome, and whether it was done on time). Filters: date
 * range, task type, and rep for managers. Summary: completed this week, % done on time, average
 * days late. Clicking a task opens its lead. Ticking a task here marks it done.
 */
export function TaskHistoryView({ data, showOwner, onOpenLead }: { data: DialerData; showOwner: boolean; onOpenLead: (id: string) => void }) {
  const { addToast } = useToast()
  const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
  const [from, setFrom] = useState(day(-30))
  const [to, setTo] = useState(day(0))
  const [kind, setKind] = useState('')
  const [h, setH] = useState<TaskHistory | null>(null)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    dialerApi.taskHistory({ from, to, kind, rep: data.scope === 'me' ? undefined : data.scope }).then(setH).catch((e) => addToast({ type: 'error', message: errMsg(e, 'Could not load the task history') }))
  }, [from, to, kind, data.scope, reload, addToast])
  const now = new Date()
  const dayStart = new Date(data.dayStart)
  const cols = useMemo(() => {
    const t = h?.tasks ?? []
    return {
      overdue: t.filter((x) => x.status === 'OPEN' && taskBucket(x, now, dayStart) === 'overdue'),
      next: t.filter((x) => x.status === 'OPEN' && taskBucket(x, now, dayStart) !== 'overdue'),
      done: t.filter((x) => x.status === 'DONE').sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? '')),
    }
  }, [h]) // eslint-disable-line react-hooks/exhaustive-deps

  async function tick(t: TaskHistoryRow) {
    try { await dialerApi.updateTask(t.id, { done: true }); setReload((r) => r + 1) } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not save') }) }
  }
  const field = 'h-8 rounded-full border border-line bg-card px-3 text-body-sm text-ink focus:border-primary focus:outline-none'
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Completed this week" value={h ? String(h.summary.completedThisWeek) : '…'} />
        <Stat label="Done on time" value={h ? (h.summary.onTimePct == null ? '—' : `${h.summary.onTimePct}%`) : '…'} />
        <Stat label="Average days late" value={h ? (h.summary.avgDaysLate == null ? '—' : String(h.summary.avgDaysLate)) : '…'} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-body-sm">
        <label className="inline-flex items-center gap-1.5 text-ink-muted">Completed from <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={field} /></label>
        <label className="inline-flex items-center gap-1.5 text-ink-muted">to <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={field} /></label>
        <select value={kind} onChange={(e) => setKind(e.target.value)} className={field} aria-label="Task type"><option value="">Every type</option>{TASK_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select>
        {showOwner && <span className="text-ink-muted">Rep: pick one at the top of the page.</span>}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Column title="Overdue" tone="text-rose-600 dark:text-rose-300" rows={cols.overdue} showOwner={showOwner} onOpen={onOpenLead} onTick={tick} me={data.me.id} />
        <Column title="Due today / upcoming" tone="text-ink" rows={cols.next} showOwner={showOwner} onOpen={onOpenLead} onTick={tick} me={data.me.id} />
        <Column title="Completed" tone="text-success" rows={cols.done} showOwner={showOwner} onOpen={onOpenLead} me={data.me.id} />
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-card border border-line bg-card p-4"><p className="text-body-sm text-ink-muted">{label}</p><p className="mt-1 text-[26px] font-semibold tabular-nums tracking-tight text-ink">{value}</p></div>
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'no date')

function Column({ title, tone, rows, showOwner, onOpen, onTick, me }: { title: string; tone: string; rows: TaskHistoryRow[]; showOwner: boolean; onOpen: (id: string) => void; onTick?: (t: TaskHistoryRow) => void; me: string }) {
  const [n, setN] = useState(30)
  return (
    <section className="flex min-h-[200px] flex-col rounded-card border border-line bg-slate-50/60 dark:bg-white/[0.02]">
      <header className="flex items-center justify-between border-b border-line px-3.5 py-2.5"><h3 className={cn('text-body-md font-semibold', tone)}>{title}</h3><span className="rounded-full bg-card px-2 text-[12px] font-semibold tabular-nums text-ink-muted ring-1 ring-line">{rows.length}</span></header>
      <ul className="flex-1 space-y-2 p-2.5">
        {rows.length === 0 && <li className="py-8 text-center text-body-sm text-ink-muted">Nothing here.</li>}
        {rows.slice(0, n).map((t) => (
          <li key={t.id} className="rounded-btn border border-line bg-card p-2.5 shadow-xs">
            <div className="flex items-start gap-2">
              {onTick && t.ownerId === me
                ? <button type="button" onClick={() => onTick(t)} className="mt-0.5 text-ink-faint hover:text-success" aria-label="Mark done"><Circle size={16} /></button>
                : t.status === 'DONE' ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" /> : <Clock3 size={16} className="mt-0.5 shrink-0 text-ink-faint" />}
              <button type="button" onClick={() => onOpen(t.leadId)} className="min-w-0 flex-1 text-left">
                <span className="block truncate text-body-sm font-semibold text-ink hover:underline">{t.company}</span>
                <span className="block text-[12px] text-ink-muted">{TASK_KINDS.find((k) => k.key === t.kind)?.label ?? t.kind}{t.reason === 'CALL_LATER' ? ' · call back' : t.reason === 'FOLLOW_UP_RULE' ? ' · follow-up rule' : ''}{showOwner ? ` · ${t.owner}` : ''}</span>
                {t.status === 'DONE'
                  ? <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px]"><span className="text-ink">{when(t.doneAt)}</span>{t.outcome && <span className="rounded-full bg-slate-100 px-1.5 text-ink">{t.outcome}</span>}{t.onTime != null && <span className={cn('rounded-full px-1.5 font-semibold', t.onTime ? 'bg-success/10 text-success' : 'bg-warning/15 text-warning')}>{t.onTime ? 'on time' : 'late'}</span>}</span>
                  : <span className="mt-1 block text-[12px] text-ink">Due {when(t.dueAt)}</span>}
                {t.note && <span className="mt-0.5 block truncate text-[12px] text-ink-muted">{t.note}</span>}
              </button>
            </div>
          </li>
        ))}
        {rows.length > n && <li><button type="button" onClick={() => setN(n + 30)} className="w-full py-1.5 text-center text-body-sm font-semibold text-primary">Show more</button></li>}
      </ul>
    </section>
  )
}
