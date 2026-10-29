import { useMemo, useState } from 'react'
import { ArrowRight, CalendarDays, CheckSquare, Download, Hash, Lock, SearchX, StickyNote } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { cn } from '../../../lib/cn'
import { parse, periodLabel, todayIso, type WorkPeriod, type WorkSearch, type WorkSearchHit, type WorkStatus } from '../../../lib/workLogApi'

/**
 * Search results on My To-Do: every day, week, month and year a word shows up in (an SKU, an
 * order number, a client, a product), newest first and grouped by date, like an order search in
 * a store's admin. Filter by status, by kind of period and by month; open one to jump to its date.
 */

const PERIOD_LABEL: Record<WorkPeriod, string> = { DAY: 'Day', WEEK: 'Week', MONTH: 'Month', YEAR: 'Year' }
const PERIOD_TONE: Record<WorkPeriod, string> = { DAY: 'bg-slate-100 text-ink-muted', WEEK: 'bg-primary/10 text-primary', MONTH: 'bg-accent/10 text-accent', YEAR: 'bg-warning/10 text-warning' }
const STATUS_LABEL: Record<WorkStatus, string> = { PLANNED: 'To do', IN_PROGRESS: 'In progress', DONE: 'Done' }
const STATUS_DOT: Record<WorkStatus, string> = { PLANNED: 'bg-slate-300', IN_PROGRESS: 'bg-warning', DONE: 'bg-success' }

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** The text with every searched word marked. */
export function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>
  const re = new RegExp(`(${terms.map(escape).sort((a, b) => b.length - a.length).join('|')})`, 'gi')
  return <>{text.split(re).map((p, i) => (i % 2 ? <mark key={i} className="rounded-[3px] bg-yellow-200/80 px-0.5 text-ink dark:bg-yellow-400/30">{p}</mark> : p))}</>
}
const has = (text: string | null | undefined, terms: string[]) => !!text && terms.some((t) => text.toLowerCase().includes(t.toLowerCase()))

/** A few words around the first match, for long details and notes. */
function around(text: string, terms: string[], width = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= width) return flat
  const low = flat.toLowerCase()
  const i = Math.min(...terms.map((t) => low.indexOf(t.toLowerCase())).filter((x) => x >= 0), Infinity)
  if (!Number.isFinite(i)) return flat.slice(0, width) + '…'
  const start = Math.max(0, i - 40)
  return (start > 0 ? '…' : '') + flat.slice(start, start + width) + (start + width < flat.length ? '…' : '')
}

/** "today", "3 days ago", "in 2 weeks"… for a date. */
function when(date: string): string {
  const days = Math.round((parse(date).getTime() - parse(todayIso()).getTime()) / 86400000)
  if (days === 0) return 'today'
  if (days === -1) return 'yesterday'
  if (days === 1) return 'tomorrow'
  const n = Math.abs(days)
  const [v, u] = n < 14 ? [n, 'day'] : n < 60 ? [Math.round(n / 7), 'week'] : n < 730 ? [Math.round(n / 30.4), 'month'] : [Math.round(n / 365), 'year']
  const s = `${v} ${u}${v === 1 ? '' : 's'}`
  return days < 0 ? `${s} ago` : `in ${s}`
}
const monthKey = (d: string) => d.slice(0, 7)
const monthName = (k: string) => parse(`${k}-01`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
const short = (d: string) => parse(d).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })

type StatusF = 'ALL' | WorkStatus
type PeriodF = 'ALL' | WorkPeriod

export function TodoSearch({ data, busy, team, onOpen, onOpenDay }: {
  data: WorkSearch | null
  busy: boolean
  /** Results come from several people: show whose each one is. */
  team: boolean
  onOpen: (e: WorkSearchHit) => void
  onOpenDay: (date: string) => void
}) {
  const [status, setStatus] = useState<StatusF>('ALL')
  const [period, setPeriod] = useState<PeriodF>('ALL')
  const [month, setMonth] = useState<string | null>(null)
  const [oldest, setOldest] = useState(false)

  const terms = data?.terms ?? []
  const all = data?.results ?? []
  // Counts on each chip follow the other filters, so a chip never promises what is not there.
  const pass = (e: WorkSearchHit, skip?: 'status' | 'period' | 'month') =>
    (skip === 'status' || status === 'ALL' || e.status === status)
    && (skip === 'period' || period === 'ALL' || e.period === period)
    && (skip === 'month' || !month || monthKey(e.periodStart) === month)
  const shown = useMemo(() => {
    const rows = all.filter((e) => pass(e))
    return oldest ? [...rows].reverse() : rows
  }, [all, status, period, month, oldest]) // eslint-disable-line react-hooks/exhaustive-deps

  const months = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of all) if (pass(e, 'month')) m.set(monthKey(e.periodStart), (m.get(monthKey(e.periodStart)) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))
  }, [all, status, period]) // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    const out: { key: string; period: WorkPeriod; start: string; rows: WorkSearchHit[] }[] = []
    for (const e of shown) {
      const key = `${e.period}:${e.periodStart}`
      const g = out[out.length - 1]
      if (g && g.key === key) g.rows.push(e)
      else out.push({ key, period: e.period, start: e.periodStart, rows: [e] })
    }
    return out
  }, [shown])

  const dates = new Set(shown.map((e) => e.periodStart)).size
  const sorted = [...shown].sort((a, b) => (a.periodStart < b.periodStart ? -1 : 1))
  const first = sorted[0]?.periodStart
  const last = sorted[sorted.length - 1]?.periodStart

  function downloadCsv() {
    const head = ['Date', 'Period', ...(team ? ['Person'] : []), 'What', 'Status', 'Tag', 'Hours', 'How many', 'Details', 'Notes']
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const csv = [head.join(','), ...shown.map((e) => [e.periodStart, PERIOD_LABEL[e.period], ...(team ? [e.userName] : []), e.title, STATUS_LABEL[e.status], e.tag ?? '', e.hours ?? '', e.quantity ?? '', e.details ?? '', e.notes.map((n) => [n.source, n.sender, n.body].filter(Boolean).join(': ')).join(' | ')].map(q).join(','))].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `to-do-search-${(data?.q ?? 'results').replace(/[^\w-]+/g, '-').slice(0, 40)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const chip = (on: boolean) => cn('inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-body-sm font-semibold transition-colors', on ? 'border-primary bg-primary text-white' : 'border-line bg-card text-ink-muted hover:text-ink')
  const count = (n: number, on: boolean) => <span className={cn('text-[11px] font-bold', on ? 'text-white/80' : 'text-ink-faint')}>{n}</span>

  if (!data) return <Card><p className="py-10 text-center text-body-md text-ink-muted">Searching…</p></Card>

  const nothing = all.length === 0 && data.checklist.length === 0
  return (
    <div className={cn('space-y-4', busy && 'opacity-60')} aria-busy={busy} data-testid="todo-search">
      <Card>
        {nothing ? (
          <div className="flex flex-col items-center py-10 text-center">
            <SearchX size={28} className="text-ink-faint" />
            <p className="mt-3 text-body-lg font-semibold text-ink">Nothing found for “{data.q}”</p>
            <p className="mt-1 max-w-md text-body-sm text-ink-muted">Every word has to be somewhere in an item, its details, its tag or its notes. Try fewer words, or part of a word (for example “ZX-1” for “ZX-100”).</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-body-lg font-semibold text-ink">
                  {shown.length} result{shown.length === 1 ? '' : 's'} for “{data.q}”{data.more ? ' (the newest 500)' : ''}
                </p>
                {shown.length > 0 && (
                  <p className="mt-0.5 text-body-sm text-ink-muted">
                    <CalendarDays size={14} className="mr-1 inline-block -translate-y-px align-middle" />on {dates} date{dates === 1 ? '' : 's'}
                    {first && last && (first === last ? <> · {short(first)} ({when(first)})</> : <> · first {short(first)} ({when(first)}) · latest {short(last)} ({when(last)})</>)}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setOldest((o) => !o)} className="inline-flex h-8 items-center rounded-btn border border-line bg-card px-2.5 text-body-sm text-ink hover:bg-slate-50">{oldest ? 'Oldest first' : 'Newest first'}</button>
                <button type="button" onClick={downloadCsv} disabled={!shown.length} className="inline-flex h-8 items-center gap-1.5 rounded-btn border border-line bg-card px-2.5 text-body-sm text-ink hover:bg-slate-50 disabled:opacity-50"><Download size={14} /> CSV</button>
              </div>
            </div>

            {all.length > 0 && (
              <div className="mt-4 space-y-2.5">
                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Status">
                  {(['ALL', 'PLANNED', 'IN_PROGRESS', 'DONE'] as StatusF[]).map((s) => {
                    const n = all.filter((e) => pass(e, 'status') && (s === 'ALL' || e.status === s)).length
                    if (s !== 'ALL' && n === 0 && status !== s) return null
                    return <button key={s} type="button" onClick={() => setStatus(s)} className={chip(status === s)} aria-pressed={status === s}>{s === 'ALL' ? 'Any status' : STATUS_LABEL[s]} {count(n, status === s)}</button>
                  })}
                  <span className="mx-1 h-5 w-px bg-line" />
                  {(['ALL', 'DAY', 'WEEK', 'MONTH', 'YEAR'] as PeriodF[]).map((p) => {
                    const n = all.filter((e) => pass(e, 'period') && (p === 'ALL' || e.period === p)).length
                    if (p !== 'ALL' && n === 0 && period !== p) return null
                    return <button key={p} type="button" onClick={() => setPeriod(p)} className={chip(period === p)} aria-pressed={period === p}>{p === 'ALL' ? 'Days, weeks, months, years' : `${PERIOD_LABEL[p]}s`} {count(n, period === p)}</button>
                  })}
                </div>
                {months.length > 1 && (
                  <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Month">
                    <span className="mr-1 text-label-md uppercase text-ink-muted">By month</span>
                    {month && <button type="button" onClick={() => setMonth(null)} className={chip(false)}>All months</button>}
                    {months.map(([k, n]) => (
                      <button key={k} type="button" onClick={() => setMonth(month === k ? null : k)} className={chip(month === k)} aria-pressed={month === k}>{monthName(k)} {count(n, month === k)}</button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </Card>

      {groups.map((g) => (
        <section key={g.key} className="rounded-card border border-line bg-card shadow-sm" aria-label={periodLabel(g.period, g.start)}>
          <header className="flex flex-wrap items-center gap-2 border-b border-line bg-slate-50/70 px-4 py-2.5">
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide', PERIOD_TONE[g.period])}>{PERIOD_LABEL[g.period]}</span>
            <span className="text-body-md font-semibold text-ink">{periodLabel(g.period, g.start)}</span>
            <span className="text-body-sm text-ink-muted">· {when(g.start)}</span>
            <button type="button" onClick={() => onOpen(g.rows[0])} className="ml-auto inline-flex items-center gap-1 text-body-sm font-semibold text-primary hover:underline">
              Open this {g.period === 'DAY' ? 'day' : PERIOD_LABEL[g.period].toLowerCase()} <ArrowRight size={14} />
            </button>
          </header>
          <ul className="divide-y divide-line">
            {g.rows.map((e) => {
              const notes = e.notes.filter((n) => has(n.body, terms) || has(n.source, terms) || has(n.sender, terms))
              return (
                <li key={e.id}>
                  <button type="button" onClick={() => onOpen(e)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-primary/5 focus:bg-primary/5 focus:outline-none" data-search-hit={e.id}>
                    <span className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', STATUS_DOT[e.status])} title={STATUS_LABEL[e.status]} />
                    <span className="min-w-0 flex-1">
                      <span className={cn('line-clamp-3 whitespace-pre-wrap break-words text-body-md', e.status === 'DONE' ? 'text-ink-muted' : 'font-medium text-ink')}><Highlight text={e.title} terms={terms} /></span>
                      {e.details && has(e.details, terms) && <span className="mt-0.5 block text-body-sm text-ink-muted"><Highlight text={around(e.details, terms)} terms={terms} /></span>}
                      {notes.slice(0, 2).map((n) => (
                        <span key={n.id} className="mt-1 flex items-start gap-1.5 rounded-btn bg-sky-50 px-2 py-1 text-body-sm text-sky-900 dark:bg-sky-500/10 dark:text-sky-200">
                          <StickyNote size={13} className="mt-0.5 shrink-0" />
                          <span className="min-w-0">
                            {(n.source || n.sender) && <span className="font-semibold"><Highlight text={[n.source, n.sender && `from ${n.sender}`].filter(Boolean).join(' ')} terms={terms} />: </span>}
                            <Highlight text={around(n.body, terms)} terms={terms} />
                          </span>
                        </span>
                      ))}
                      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className={cn('rounded-full px-2 py-0.5 font-semibold', e.status === 'DONE' ? 'bg-success/10 text-success' : e.status === 'IN_PROGRESS' ? 'bg-warning/10 text-warning' : 'bg-slate-100 text-ink-muted')}>{STATUS_LABEL[e.status]}</span>
                        {team && <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-ink">{e.userName}</span>}
                        {e.tag && <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary"><Hash size={10} /><Highlight text={e.tag} terms={terms} /></span>}
                        {e.quantity != null && <span className="rounded-full bg-accent/10 px-2 py-0.5 font-semibold text-accent">{e.quantity.toLocaleString()} items</span>}
                        {e.hours != null && <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-ink-muted">{e.hours} h</span>}
                        {e.private && <span className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-ink-muted"><Lock size={10} />private</span>}
                        {e.notes.length > 0 && notes.length === 0 && <span className="inline-flex items-center gap-0.5 rounded-full bg-sky-100 px-2 py-0.5 font-semibold text-sky-700"><StickyNote size={10} />{e.notes.length} note{e.notes.length === 1 ? '' : 's'}</span>}
                      </span>
                    </span>
                    <ArrowRight size={16} className="mt-1 shrink-0 text-ink-faint" />
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      {data.checklist.length > 0 && status === 'ALL' && period === 'ALL' && !month && (
        <section className="rounded-card border border-line bg-card shadow-sm" aria-label="Quick checklist">
          <header className="flex items-center gap-2 border-b border-line bg-slate-50/70 px-4 py-2.5">
            <CheckSquare size={15} className="text-ink-muted" />
            <span className="text-body-md font-semibold text-ink">Quick checklist</span>
            <span className="text-body-sm text-ink-muted">· {data.checklist.length}</span>
          </header>
          <ul className="divide-y divide-line">
            {data.checklist.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => onOpenDay(c.dueDate ?? todayIso())} className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-primary/5">
                  <span className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-sm', c.done ? 'bg-success' : 'border border-slate-300')} />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block break-words text-body-md', c.done ? 'text-ink-muted line-through' : 'text-ink')}><Highlight text={c.title} terms={terms} /></span>
                    <span className="text-[11px] text-ink-muted">{c.done ? 'Done' : 'Open'}{c.dueDate ? ` · due ${short(c.dueDate)}` : ` · added ${short(c.createdAt.slice(0, 10))}`}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
