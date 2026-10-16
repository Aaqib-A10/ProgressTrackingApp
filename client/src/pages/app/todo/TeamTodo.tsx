import { useCallback, useEffect, useState } from 'react'
import { Copy, Download, LifeBuoy, Plane } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { useToast } from '../../../components/ui/Toast'
import { cn } from '../../../lib/cn'
import { DEPARTMENTS } from '../../../lib/departments'
import { copyText, entriesToText, parse, periodLabel, workLogApi, type TeamMember, type TeamWorkLog, type WorkPeriod, type WorkRating } from '../../../lib/workLogApi'
import { Chips, EntryText, NOUN, RATING_STYLE, ReviewBox, errMsg, ratingKey } from './parts'

/**
 * Team view of My To-Do for Team Leads (their department) and Super Admins (everyone, or one
 * department). One page shows who logged, who did not, who is on leave, who needs help, and lets
 * the lead review each person with a rating and a comment (they get a notification).
 */

type Filter = 'ALL' | 'HELP' | 'UNREVIEWED' | 'MISSING'

export function TeamTodo({ period, start, isSuperAdmin, onOpenPerson }: { period: WorkPeriod; start: string; isSuperAdmin: boolean; onOpenPerson: (id: string) => void }) {
  const { addToast } = useToast()
  const [data, setData] = useState<TeamWorkLog | null>(null)
  const [dept, setDept] = useState('')
  const [filter, setFilter] = useState<Filter>('ALL')
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    workLogApi.team(period, start, dept || undefined).then(setData).catch((e) => addToast({ type: 'error', message: errMsg(e, 'Could not load the team') }))
  }, [period, start, dept, addToast])
  useEffect(() => { setData(null); load() }, [load])

  if (!data) return <Card><p className="py-10 text-center text-body-md text-ink-muted">Loading the team…</p></Card>

  const isDay = period === 'DAY'
  const holiday = isDay ? data.holidays.find((h) => h.date === start) : undefined
  const onLeave = (m: TeamMember) => isDay && m.leaveDays.includes(start)
  const logged = data.members.filter((m) => m.entries.length > 0)
  const missing = data.members.filter((m) => m.entries.length === 0)
  const help = data.members.flatMap((m) => m.entries.filter((e) => e.blocked && e.status !== 'DONE').map((e) => ({ m, e })))
  const reviewed = data.members.filter((m) => m.review).length
  const totals = { done: logged.reduce((t, m) => t + m.done, 0), hours: logged.reduce((t, m) => t + m.hours, 0), qty: logged.reduce((t, m) => t + m.quantity, 0) }

  const shown = (filter === 'HELP' ? logged.filter((m) => m.blocked > 0) : filter === 'UNREVIEWED' ? logged.filter((m) => !m.review) : filter === 'MISSING' ? [] : logged)
  const showMissing = filter === 'ALL' || filter === 'MISSING'

  async function review(m: TeamMember, rating: WorkRating | null, comment: string, clear = false) {
    setBusy(m.id)
    try {
      await workLogApi.review({ userId: m.id, period, date: start, rating, comment: comment || null, clear })
      addToast({ type: 'success', message: clear ? 'Review removed.' : `Review sent to ${m.name.split(' ')[0]}.` })
      load()
    } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not save the review') }) } finally { setBusy(null) }
  }

  async function copyReport() {
    const label = periodLabel(period, start)
    const parts = [`Team to-dos, ${label}`, `${logged.length} of ${data!.members.length} logged, ${totals.done} done${totals.hours ? `, ${+totals.hours.toFixed(2)} h` : ''}${totals.qty ? `, ${totals.qty} items` : ''}`]
    for (const m of logged) parts.push('', '────────', entriesToText(`*${m.name}*`, m.entries))
    if (missing.length) parts.push('', '────────', `Not logged: ${missing.map((m) => m.name + (onLeave(m) ? ' (on leave)' : '')).join(', ')}`)
    await copyText(parts.join('\n'))
    addToast({ type: 'success', message: 'Team report copied. Paste it anywhere.' })
  }

  function downloadCsv() {
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const status = { DONE: 'Done', IN_PROGRESS: 'In progress', PLANNED: 'To do' } as const
    const rows = data!.members.flatMap((m) => m.entries.map((e) => [m.name, m.department, e.period, e.periodStart, e.title, status[e.status], e.blocked ? 'Yes' : '', e.hours ?? '', e.quantity ?? '', e.tag ?? '', e.details ?? '', m.review ? RATING_STYLE[ratingKey(m.review)].label : '', m.review?.comment ?? '']))
    const csv = [['Person', 'Department', 'Period', 'Starts', 'What', 'Status', 'Needs help', 'Hours', 'How many', 'Tag', 'Details', 'Review', 'Review comment'].join(','), ...rows.map((r) => r.map(q).join(','))].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `team-to-dos-${data!.start}-to-${data!.end}.csv`
    a.click(); URL.revokeObjectURL(a.href)
  }

  const chip = (f: Filter, label: string, n: number, tone: string) => (
    <button type="button" onClick={() => setFilter(filter === f ? 'ALL' : f)} className={cn('rounded-card border bg-card px-4 py-3 text-left', filter === f ? 'border-primary ring-2 ring-primary/20' : 'border-line')}>
      <p className="text-body-sm text-ink-muted">{label}</p>
      <p className={cn('text-[26px] font-bold leading-tight tabular-nums', tone)}>{n}</p>
    </button>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {isSuperAdmin && (
          <select value={dept} onChange={(e) => setDept(e.target.value)} className="h-8 rounded-btn border border-line bg-card px-2 text-body-sm text-ink" aria-label="Department">
            <option value="">All departments</option>
            {DEPARTMENTS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        )}
        <span className="text-body-sm text-ink-muted">{logged.length} of {data.members.length} people logged this {NOUN[period]} · {totals.done} done{totals.hours ? ` · ${+totals.hours.toFixed(2)} h` : ''}{totals.qty ? ` · ${totals.qty.toLocaleString()} items` : ''}</span>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={copyReport} className="inline-flex h-8 items-center gap-1.5 rounded-btn border border-line bg-card px-2.5 text-body-sm text-ink hover:bg-slate-50"><Copy size={14} /> Copy team report</button>
          <button type="button" onClick={downloadCsv} className="inline-flex h-8 items-center gap-1.5 rounded-btn border border-line bg-card px-2.5 text-body-sm text-ink hover:bg-slate-50"><Download size={14} /> CSV</button>
        </div>
      </div>

      {holiday && <p className="rounded-btn bg-primary/5 px-3 py-2 text-body-sm text-primary">{holiday.name} is a holiday.</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {chip('ALL', 'Logged', logged.length, 'text-ink')}
        {chip('MISSING', 'Not logged yet', missing.length, missing.length ? 'text-warning' : 'text-ink')}
        {chip('HELP', 'Need help', help.length, help.length ? 'text-danger' : 'text-ink')}
        {chip('UNREVIEWED', 'Not reviewed', logged.length - logged.filter((m) => m.review).length, 'text-ink')}
      </div>
      <p className="-mt-2 text-[11px] text-ink-muted">{reviewed} reviewed. Green: good work. Red: needs work. Amber: seen. Grey: not reviewed yet. Private entries are never shown.</p>

      {help.length > 0 && filter !== 'MISSING' && (
        <Card className="border-danger/30">
          <h3 className="mb-2 flex items-center gap-1.5 text-label-md uppercase text-danger"><LifeBuoy size={14} /> Needs your help</h3>
          <ul className="divide-y divide-line">
            {help.map(({ m, e }) => (
              <li key={e.id} className="flex items-start gap-3 py-2 text-body-sm">
                <button type="button" onClick={() => onOpenPerson(m.id)} className="w-36 shrink-0 truncate text-left font-semibold text-ink hover:underline">{m.name}</button>
                <EntryText text={e.title} className="min-w-0 flex-1" lines={3} />
                {period !== 'DAY' && <span className="shrink-0 text-ink-muted">{parse(e.periodStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {shown.map((m) => <PersonCard key={m.id} m={m} period={period} busy={busy === m.id} onOpen={() => onOpenPerson(m.id)} onReview={(r, c) => review(m, r, c)} onClear={() => review(m, null, '', true)} />)}
      </div>
      {shown.length === 0 && filter !== 'MISSING' && <Card><p className="py-6 text-center text-body-md text-ink-muted">{filter === 'ALL' ? `Nobody has logged anything for this ${NOUN[period]} yet.` : 'Nobody here.'}</p></Card>}

      {showMissing && missing.length > 0 && (
        <Card>
          <h3 className="mb-2 text-label-md uppercase text-ink-muted">Not logged yet · {missing.length}</h3>
          <div className="flex flex-wrap gap-2">
            {missing.map((m) => (
              <button key={m.id} type="button" onClick={() => onOpenPerson(m.id)} className={cn('inline-flex items-center gap-1 rounded-full border px-3 py-1 text-body-sm', onLeave(m) ? 'border-line text-ink-muted' : 'border-warning/40 bg-warning/5 text-ink')}>
                {m.name}{onLeave(m) && <><Plane size={12} /> on leave</>}
              </button>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

function PersonCard({ m, period, busy, onOpen, onReview, onClear }: { m: TeamMember; period: WorkPeriod; busy: boolean; onOpen: () => void; onReview: (r: WorkRating | null, c: string) => void; onClear: () => void }) {
  const [all, setAll] = useState(false)
  const order = { IN_PROGRESS: 0, PLANNED: 1, DONE: 2 } as const
  const rows = [...m.entries].sort((a, b) => Number(b.blocked) - Number(a.blocked) || order[a.status] - order[b.status])
  const st = RATING_STYLE[ratingKey(m.review)]
  return (
    <Card className={cn('border-l-4', st.bar)}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={onOpen} className="text-body-lg font-semibold text-ink hover:underline">{m.name}</button>
        {m.department && <span className="text-body-sm text-ink-muted">{m.department}</span>}
        <span className={cn('ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold', st.chip)}>{st.label}</span>
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5 text-[11px] font-semibold">
        <span className="rounded-full bg-success/10 px-2 py-0.5 text-success">{m.done} done</span>
        {m.inProgress > 0 && <span className="rounded-full bg-warning/10 px-2 py-0.5 text-warning">{m.inProgress} in progress</span>}
        {m.planned - m.inProgress > 0 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-ink-muted">{m.planned - m.inProgress} to do</span>}
        {m.blocked > 0 && <span className="rounded-full bg-danger/10 px-2 py-0.5 text-danger">{m.blocked} need help</span>}
        {m.hours > 0 && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">{m.hours} h</span>}
        {m.quantity > 0 && <span className="rounded-full bg-accent/10 px-2 py-0.5 text-accent">{m.quantity.toLocaleString()} items</span>}
      </div>
      <ul className="mb-3 space-y-2">
        {(all ? rows : rows.slice(0, 6)).map((e) => (
          <li key={e.id} className="flex items-start gap-2 text-body-sm">
            <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', e.status === 'DONE' ? 'bg-success' : e.status === 'IN_PROGRESS' ? 'bg-warning' : 'bg-slate-300')} />
            <div className="min-w-0 flex-1">
              <EntryText text={e.title} done={e.status === 'DONE'} lines={3} />
              <Chips e={e} />
            </div>
            {period !== 'DAY' && <span className="shrink-0 text-[11px] text-ink-muted">{e.period === 'DAY' ? parse(e.periodStart).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' }) : `${NOUN[e.period]} goal`}</span>}
          </li>
        ))}
      </ul>
      {rows.length > 6 && <button type="button" onClick={() => setAll((a) => !a)} className="mb-3 text-body-sm font-semibold text-primary">{all ? 'Show less' : `Show all ${rows.length}`}</button>}
      <div className="border-t border-line pt-3">
        <ReviewBox key={m.review?.updatedAt ?? 'none'} review={m.review} busy={busy} onSave={onReview} onClear={onClear} />
      </div>
    </Card>
  )
}
