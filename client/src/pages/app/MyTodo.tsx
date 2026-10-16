import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock, Download, Hash, Lock, MoreHorizontal, Pencil, Redo2, Trash2 } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { TodoList } from '../../components/TodoList'
import { useToast } from '../../components/ui/Toast'
import { useAuth } from '../../lib/auth'
import { cn } from '../../lib/cn'
import {
  TAG_IDEAS, addDays, endOf, iso, parse, periodLabel, shift, startOf, todayIso, workLogApi,
  type WorkEntry, type WorkEntryInput, type WorkPeriod,
} from '../../lib/workLogApi'

/**
 * My To-Do (/app/todo). Plan ahead or log what was already done, for any day, week, month or
 * year, past or future (a "done list" as well as a to-do list). The quick checklist stays on
 * the Day view. The person's Team Lead can read entries that are not private.
 */

const TABS: { key: WorkPeriod; label: string }[] = [
  { key: 'DAY', label: 'Day' }, { key: 'WEEK', label: 'Week' }, { key: 'MONTH', label: 'Month' }, { key: 'YEAR', label: 'Year' },
]
const NOUN: Record<WorkPeriod, string> = { DAY: 'day', WEEK: 'week', MONTH: 'month', YEAR: 'year' }

function errMsg(e: unknown, fallback: string): string {
  const m = (e as { message?: string })?.message
  if (!m) return fallback
  try { return (JSON.parse(m) as { error?: string }).error || fallback } catch { return m }
}

export default function MyTodo() {
  const { user } = useAuth()
  const { addToast } = useToast()
  const [period, setPeriod] = useState<WorkPeriod>('DAY')
  const [anchor, setAnchor] = useState(todayIso())
  const [entries, setEntries] = useState<WorkEntry[] | null>(null)
  const [readOnly, setReadOnly] = useState(false)
  const [people, setPeople] = useState<{ id: string; name: string; department: string | null }[]>([])
  const [who, setWho] = useState('')
  const [editing, setEditing] = useState<WorkEntry | null>(null)

  const start = startOf(period, anchor)
  const end = endOf(period, start)
  // Load the whole year around the view (plus the week that may start in December), so moving
  // between days and months is instant.
  const year = parse(anchor).getFullYear()
  const from = iso(new Date(year - 1, 11, 25))
  const to = iso(new Date(year, 11, 31))

  const load = useCallback(() => {
    workLogApi.list(from, to, who || undefined)
      .then((r) => { setEntries(r.entries); setReadOnly(r.readOnly) })
      .catch((e) => { setEntries([]); addToast({ type: 'error', message: errMsg(e, 'Could not load your to-dos') }) })
  }, [from, to, who, addToast])
  useEffect(load, [load])
  useEffect(() => { workLogApi.people().then((r) => setPeople(r.people)).catch(() => {}) }, [])

  const all = entries ?? []
  const of = (p: WorkPeriod, s: string) => all.filter((e) => e.period === p && e.periodStart === s)
  const here = of(period, start)
  const done = here.filter((e) => e.status === 'DONE')
  const sum = (k: 'hours' | 'quantity') => here.reduce((t, e) => t + (e[k] ?? 0), 0)
  const today = todayIso()
  const isPast = end < today

  async function mutate(fn: () => Promise<unknown>, ok?: string) {
    try { await fn(); if (ok) addToast({ type: 'success', message: ok }); load() } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not save') }) }
  }

  function downloadCsv() {
    const rows = all.filter((e) => e.periodStart >= start && e.periodStart <= end)
    const head = ['Period', 'Starts', 'Title', 'Status', 'Hours', 'Quantity', 'Tag', 'Details']
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const csv = [head.join(','), ...rows.map((e) => [e.period, e.periodStart, e.title, e.status === 'DONE' ? 'Done' : 'To do', e.hours ?? '', e.quantity ?? '', e.tag ?? '', e.details ?? ''].map(q).join(','))].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `work-log-${start}-to-${end}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const tagIdeas = useMemo(() => {
    const dept = (user?.department as string | undefined) ?? ''
    return [...new Set([...(TAG_IDEAS[dept] ?? []), ...all.map((e) => e.tag).filter(Boolean) as string[], ...TAG_IDEAS['']])]
  }, [user, all])
  const whoName = who ? people.find((p) => p.id === who)?.name : null

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">{whoName ? `${whoName}'s To-Do` : 'My To-Do'}</h1>
          <p className="mt-1 text-body-md text-ink-muted">
            {readOnly ? 'Read only. Private entries are not shown.' : 'Plan ahead, or log what you already did, for any day, week, month or year. Your Team Lead can see entries that are not private.'}
          </p>
        </div>
        {people.length > 0 && (
          <select value={who} onChange={(e) => setWho(e.target.value)} className="h-9 rounded-btn border border-line bg-card px-2 text-body-sm font-semibold text-ink" aria-label="Whose to-dos">
            <option value="">My to-dos</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.department ? ` · ${p.department}` : ''}</option>)}
          </select>
        )}
      </div>

      {/* Period tabs and navigator */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-btn border border-line bg-card p-0.5" role="tablist">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={period === t.key} onClick={() => setPeriod(t.key)} className={cn('h-8 rounded-md px-4 text-body-sm font-semibold', period === t.key ? 'bg-primary text-white' : 'text-ink-muted hover:text-ink')}>{t.label}</button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setAnchor(shift(period, start, -1))} className="rounded-btn p-1.5 text-ink-muted hover:bg-slate-100 hover:text-ink" aria-label={`Previous ${NOUN[period]}`}><ChevronLeft size={18} /></button>
          <span className="min-w-[200px] text-center text-body-lg font-semibold text-ink">{periodLabel(period, start)}</span>
          <button type="button" onClick={() => setAnchor(shift(period, start, 1))} className="rounded-btn p-1.5 text-ink-muted hover:bg-slate-100 hover:text-ink" aria-label={`Next ${NOUN[period]}`}><ChevronRight size={18} /></button>
        </div>
        <label className="relative inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-btn border border-line bg-card px-2.5 text-body-sm text-ink hover:bg-slate-50" title="Jump to a date">
          <CalendarDays size={14} /> Pick a date
          <input type="date" value={anchor} onChange={(e) => e.target.value && setAnchor(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
        </label>
        {start !== startOf(period, today) && <button type="button" onClick={() => setAnchor(today)} className="h-8 rounded-btn px-2.5 text-body-sm font-semibold text-primary hover:bg-primary/5">Today</button>}
        <button type="button" onClick={downloadCsv} className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-btn border border-line bg-card px-2.5 text-body-sm text-ink hover:bg-slate-50" title={`Download this ${NOUN[period]} as a spreadsheet`}><Download size={14} /> CSV</button>
      </div>

      <div className={cn('grid gap-5', period === 'DAY' ? 'lg:grid-cols-[minmax(0,1fr)_340px]' : '')}>
        <div className="space-y-5">
          <Card>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-body-sm">
              <span className="rounded-full bg-success/10 px-2.5 py-0.5 font-semibold text-success">{done.length} done</span>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 font-semibold text-ink-muted">{here.length - done.length} to do</span>
              {sum('hours') > 0 && <span className="rounded-full bg-primary/10 px-2.5 py-0.5 font-semibold text-primary">{+sum('hours').toFixed(2)} h</span>}
              {sum('quantity') > 0 && <span className="rounded-full bg-accent/10 px-2.5 py-0.5 font-semibold text-accent">{sum('quantity').toLocaleString()} items</span>}
              <span className="text-ink-muted">{period === 'DAY' ? 'for this day' : `goals and work for this ${NOUN[period]}`}</span>
            </div>
            {!readOnly && <AddEntry key={`${period}-${start}`} period={period} date={start} pastPeriod={isPast} tagIdeas={tagIdeas} onAdded={load} />}
            <EntryList entries={here} readOnly={readOnly} empty={readOnly ? 'Nothing here.' : isPast ? `Nothing logged for this ${NOUN[period]} yet. Add what was done above.` : `Nothing planned for this ${NOUN[period]} yet.`}
              onToggle={(e) => mutate(() => workLogApi.update(e.id, { status: e.status === 'DONE' ? 'PLANNED' : 'DONE' }))}
              onCarry={(e) => mutate(() => workLogApi.carry(e.id), `Moved to the next ${NOUN[e.period]}.`)}
              onEdit={setEditing}
              onDelete={(e) => mutate(() => workLogApi.remove(e.id), 'Deleted.')} />
          </Card>

          {/* Below: the days of the week, the days of the month, or the months of the year. */}
          {period === 'WEEK' && <WeekDays start={start} entries={all} today={today} onOpenDay={(d) => { setPeriod('DAY'); setAnchor(d) }} />}
          {period === 'MONTH' && <MonthCalendar start={start} entries={all} today={today} onOpenDay={(d) => { setPeriod('DAY'); setAnchor(d) }} />}
          {period === 'YEAR' && <YearMonths start={start} entries={all} onOpenMonth={(d) => { setPeriod('MONTH'); setAnchor(d) }} />}
        </div>

        {period === 'DAY' && (
          <div className="space-y-5">
            <Bigger title="This week" period="WEEK" entries={of('WEEK', startOf('WEEK', start))} onOpen={() => setPeriod('WEEK')} />
            <Bigger title="This month" period="MONTH" entries={of('MONTH', startOf('MONTH', start))} onOpen={() => setPeriod('MONTH')} />
            <MiniMonth anchor={anchor} entries={all} today={today} onPick={setAnchor} />
            {!who && (
              <Card>
                <h3 className="mb-2 text-label-md uppercase text-ink-muted">Quick checklist</h3>
                <TodoList limit={8} />
              </Card>
            )}
          </div>
        )}
      </div>

      {editing && <EditEntry entry={editing} tagIdeas={tagIdeas} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
    </div>
  )
}

// ------------------------------------------------------------------ add / edit

function AddEntry({ period, date, pastPeriod, tagIdeas, onAdded }: { period: WorkPeriod; date: string; pastPeriod: boolean; tagIdeas: string[]; onAdded: () => void }) {
  const { addToast } = useToast()
  const [title, setTitle] = useState('')
  const [doneNow, setDoneNow] = useState(pastPeriod)
  const [more, setMore] = useState(false)
  const [details, setDetails] = useState('')
  const [hours, setHours] = useState('')
  const [qty, setQty] = useState('')
  const [tag, setTag] = useState('')
  const [priv, setPriv] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  // Logging a past day defaults to "done"; today and the future default to "to do".
  useEffect(() => { setDoneNow(pastPeriod) }, [pastPeriod, date, period])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setBusy(true)
    try {
      await workLogApi.create({
        period, date, title: title.trim(), status: doneNow ? 'DONE' : 'PLANNED',
        details: details.trim() || null, hours: hours ? Number(hours) : null, quantity: qty ? Math.round(Number(qty)) : null, tag: tag.trim() || null, private: priv,
      })
      setTitle(''); setDetails(''); setHours(''); setQty(''); setTag(''); setPriv(false)
      onAdded()
      ref.current?.focus()
    } catch (err) { addToast({ type: 'error', message: errMsg(err, 'Could not add') }) } finally { setBusy(false) }
  }
  const field = 'h-9 rounded-btn border border-line bg-card px-2.5 text-body-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10'
  return (
    <form onSubmit={add} className="mb-4 space-y-2 rounded-card border border-line bg-slate-50/70 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input ref={ref} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} placeholder={doneNow ? `What did you get done this ${NOUN[period]}?` : `What do you plan for this ${NOUN[period]}?`} className={cn(field, 'h-10 min-w-0 flex-1 text-body-md')} />
        <div className="inline-flex rounded-btn border border-line bg-card p-0.5 text-body-sm">
          <button type="button" onClick={() => setDoneNow(false)} className={cn('h-8 rounded-md px-3 font-semibold', !doneNow ? 'bg-ink text-white' : 'text-ink-muted')}>To do</button>
          <button type="button" onClick={() => setDoneNow(true)} className={cn('h-8 rounded-md px-3 font-semibold', doneNow ? 'bg-success text-white' : 'text-ink-muted')}>Done</button>
        </div>
        <button type="button" onClick={() => setMore((m) => !m)} className="rounded-btn p-2 text-ink-muted hover:bg-slate-100 hover:text-ink" title="Details, time, how many, tag" aria-label="More options"><MoreHorizontal size={16} /></button>
        <Button type="submit" size="sm" disabled={busy || !title.trim()}>Add</Button>
      </div>
      {more && (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_110px_110px_160px]">
          <input value={details} onChange={(e) => setDetails(e.target.value)} maxLength={4000} placeholder="Details or link (optional)" className={field} />
          <input value={hours} onChange={(e) => setHours(e.target.value)} type="number" min={0} step={0.25} placeholder="Hours" className={field} />
          <input value={qty} onChange={(e) => setQty(e.target.value)} type="number" min={0} step={1} placeholder="How many" className={field} title="e.g. 25 listings, 40 orders" />
          <input value={tag} onChange={(e) => setTag(e.target.value)} list="worklog-tags" maxLength={40} placeholder="Tag" className={field} />
          <datalist id="worklog-tags">{tagIdeas.map((t) => <option key={t} value={t} />)}</datalist>
          <label className="flex items-center gap-2 text-body-sm text-ink-muted sm:col-span-4"><input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} className="h-4 w-4 accent-primary" /> Private (only you can see it)</label>
        </div>
      )}
    </form>
  )
}

function EditEntry({ entry, tagIdeas, onClose, onSaved }: { entry: WorkEntry; tagIdeas: string[]; onClose: () => void; onSaved: () => void }) {
  const { addToast } = useToast()
  const [v, setV] = useState({ title: entry.title, details: entry.details ?? '', hours: entry.hours?.toString() ?? '', qty: entry.quantity?.toString() ?? '', tag: entry.tag ?? '', priv: entry.private, period: entry.period, date: entry.periodStart, done: entry.status === 'DONE' })
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    const body: WorkEntryInput = {
      title: v.title.trim(), details: v.details.trim() || null, hours: v.hours ? Number(v.hours) : null, quantity: v.qty ? Math.round(Number(v.qty)) : null,
      tag: v.tag.trim() || null, private: v.priv, status: v.done ? 'DONE' : 'PLANNED',
      ...(v.period !== entry.period || v.date !== entry.periodStart ? { period: v.period, date: v.date } : {}),
    }
    try { await workLogApi.update(entry.id, body); onSaved() } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not save') }) } finally { setBusy(false) }
  }
  const field = 'h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'
  return (
    <Modal open onClose={onClose} title="Edit" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy || !v.title.trim()} onClick={save}>Save</Button></>}>
      <div className="space-y-3 text-body-sm">
        <label className="block"><span className="mb-1 block font-semibold text-ink">What</span><input value={v.title} maxLength={300} onChange={(e) => setV({ ...v, title: e.target.value })} className={field} /></label>
        <label className="block"><span className="mb-1 block font-semibold text-ink">Details or link</span><textarea value={v.details} maxLength={4000} rows={3} onChange={(e) => setV({ ...v, details: e.target.value })} className="w-full rounded-btn border border-line bg-card px-3 py-2 text-body-md text-ink focus:border-primary focus:outline-none" /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="mb-1 block font-semibold text-ink">For a</span>
            <select value={v.period} onChange={(e) => setV({ ...v, period: e.target.value as WorkPeriod })} className={field}>{TABS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
          </label>
          <label className="block"><span className="mb-1 block font-semibold text-ink">Date (any day in it)</span><input type="date" value={v.date} onChange={(e) => e.target.value && setV({ ...v, date: e.target.value })} className={field} /></label>
          <label className="block"><span className="mb-1 block font-semibold text-ink">Hours</span><input type="number" min={0} step={0.25} value={v.hours} onChange={(e) => setV({ ...v, hours: e.target.value })} className={field} /></label>
          <label className="block"><span className="mb-1 block font-semibold text-ink">How many</span><input type="number" min={0} step={1} value={v.qty} onChange={(e) => setV({ ...v, qty: e.target.value })} className={field} /></label>
          <label className="col-span-2 block"><span className="mb-1 block font-semibold text-ink">Tag</span><input value={v.tag} list="worklog-tags-edit" maxLength={40} onChange={(e) => setV({ ...v, tag: e.target.value })} className={field} /><datalist id="worklog-tags-edit">{tagIdeas.map((t) => <option key={t} value={t} />)}</datalist></label>
        </div>
        <label className="flex items-center gap-2 text-ink"><input type="checkbox" checked={v.done} onChange={(e) => setV({ ...v, done: e.target.checked })} className="h-4 w-4 accent-success" /> Done</label>
        <label className="flex items-center gap-2 text-ink"><input type="checkbox" checked={v.priv} onChange={(e) => setV({ ...v, priv: e.target.checked })} className="h-4 w-4 accent-primary" /> Private (only you can see it)</label>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ lists

function EntryList({ entries, readOnly, empty, onToggle, onCarry, onEdit, onDelete }: { entries: WorkEntry[]; readOnly: boolean; empty: string; onToggle: (e: WorkEntry) => void; onCarry: (e: WorkEntry) => void; onEdit: (e: WorkEntry) => void; onDelete: (e: WorkEntry) => void }) {
  if (entries.length === 0) return <p className="py-6 text-center text-body-md text-ink-muted">{empty}</p>
  const todo = entries.filter((e) => e.status !== 'DONE')
  const done = entries.filter((e) => e.status === 'DONE')
  return (
    <div className="space-y-4">
      {[{ label: 'To do', rows: todo }, { label: 'Done', rows: done }].filter((g) => g.rows.length).map((g) => (
        <div key={g.label}>
          <p className="mb-1 text-label-md uppercase text-ink-muted">{g.label} · {g.rows.length}</p>
          <ul className="divide-y divide-line rounded-btn border border-line">
            {g.rows.map((e) => (
              <li key={e.id} className="group flex items-start gap-3 px-3 py-2.5">
                <button type="button" disabled={readOnly} onClick={() => onToggle(e)} aria-label={e.status === 'DONE' ? 'Mark as to do' : 'Mark as done'} className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2', e.status === 'DONE' ? 'border-success bg-success text-white' : 'border-line hover:border-success', readOnly && 'cursor-default')}>
                  {e.status === 'DONE' && <Check size={12} strokeWidth={3} />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={cn('break-words text-body-md', e.status === 'DONE' ? 'text-ink-muted' : 'font-medium text-ink')}>{e.title}</p>
                  {e.details && <p className="mt-0.5 whitespace-pre-wrap break-words text-body-sm text-ink-muted">{linkify(e.details)}</p>}
                  {(e.tag || e.hours != null || e.quantity != null || e.private) && (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                      {e.tag && <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary"><Hash size={10} />{e.tag}</span>}
                      {e.quantity != null && <span className="rounded-full bg-accent/10 px-2 py-0.5 font-semibold text-accent">{e.quantity.toLocaleString()} items</span>}
                      {e.hours != null && <span className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-ink-muted"><Clock size={10} />{e.hours} h</span>}
                      {e.private && <span className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-ink-muted"><Lock size={10} />private</span>}
                    </div>
                  )}
                </div>
                {!readOnly && (
                  <div className="flex shrink-0 items-center gap-0.5 opacity-60 group-hover:opacity-100">
                    {e.status !== 'DONE' && <IconBtn label={`Move to next ${NOUN[e.period]}`} onClick={() => onCarry(e)}><Redo2 size={15} /></IconBtn>}
                    <IconBtn label="Edit" onClick={() => onEdit(e)}><Pencil size={15} /></IconBtn>
                    <IconBtn label="Delete" onClick={() => onDelete(e)} danger><Trash2 size={15} /></IconBtn>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function IconBtn({ label, onClick, children, danger }: { label: string; onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return <button type="button" onClick={onClick} title={label} aria-label={label} className={cn('rounded-btn p-1.5 text-ink-muted hover:bg-slate-100', danger ? 'hover:text-danger' : 'hover:text-ink')}>{children}</button>
}

function linkify(text: string): React.ReactNode[] {
  return text.split(/(https?:\/\/[^\s)]+)/g).map((p, i) => (/^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noreferrer noopener" className="text-primary underline">{p}</a> : p))
}

/** The week's or month's goals, shown beside a day. */
function Bigger({ title, period, entries, onOpen }: { title: string; period: WorkPeriod; entries: WorkEntry[]; onOpen: () => void }) {
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-label-md uppercase text-ink-muted">{title}</h3>
        <button type="button" onClick={onOpen} className="text-body-sm font-semibold text-primary">Open</button>
      </div>
      {entries.length === 0 ? <p className="text-body-sm text-ink-muted">No {NOUN[period]} goals yet.</p> : (
        <ul className="space-y-1.5 text-body-sm">
          {entries.slice(0, 6).map((e) => (
            <li key={e.id} className="flex items-start gap-2">
              <span className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', e.status === 'DONE' ? 'bg-success' : 'bg-slate-300')} />
              <span className={cn('break-words', e.status === 'DONE' ? 'text-ink-muted line-through' : 'text-ink')}>{e.title}</span>
            </li>
          ))}
          {entries.length > 6 && <li className="text-ink-muted">+{entries.length - 6} more</li>}
        </ul>
      )}
    </Card>
  )
}

const dayStats = (entries: WorkEntry[], d: string) => {
  const es = entries.filter((e) => e.period === 'DAY' && e.periodStart === d)
  return { total: es.length, done: es.filter((e) => e.status === 'DONE').length, es }
}

/** A small month calendar beside the day view: dots on days with entries, click to jump (fill in past days). */
function MiniMonth({ anchor, entries, today, onPick }: { anchor: string; entries: WorkEntry[]; today: string; onPick: (d: string) => void }) {
  const [month, setMonth] = useState(startOf('MONTH', anchor))
  useEffect(() => { setMonth(startOf('MONTH', anchor)) }, [anchor])
  const first = parse(month)
  const lead = (first.getDay() + 6) % 7
  const days = Number(endOf('MONTH', month).slice(8))
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={() => setMonth(shift('MONTH', month, -1))} className="rounded p-1 text-ink-muted hover:bg-slate-100" aria-label="Previous month"><ChevronLeft size={15} /></button>
        <span className="text-body-sm font-semibold text-ink">{periodLabel('MONTH', month)}</span>
        <button type="button" onClick={() => setMonth(shift('MONTH', month, 1))} className="rounded p-1 text-ink-muted hover:bg-slate-100" aria-label="Next month"><ChevronRight size={15} /></button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px]">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="font-semibold text-ink-muted">{d}</span>)}
        {Array.from({ length: lead }, (_, i) => <span key={`x${i}`} />)}
        {Array.from({ length: days }, (_, i) => {
          const d = addDays(month, i)
          const s = dayStats(entries, d)
          return (
            <button key={d} type="button" onClick={() => onPick(d)} className={cn('relative flex h-8 flex-col items-center justify-center rounded-md text-body-sm', d === anchor ? 'bg-primary text-white' : d === today ? 'font-bold text-primary ring-1 ring-primary/40' : 'text-ink hover:bg-slate-100')}>
              {i + 1}
              {s.total > 0 && <span className={cn('absolute bottom-1 h-1 w-1 rounded-full', d === anchor ? 'bg-white' : s.done === s.total ? 'bg-success' : 'bg-warning')} />}
            </button>
          )
        })}
      </div>
      <p className="mt-2 text-[11px] text-ink-muted">Green dot: all done. Amber: some still to do. Click any past day to log what was done.</p>
    </Card>
  )
}

function WeekDays({ start, entries, today, onOpenDay }: { start: string; entries: WorkEntry[]; today: string; onOpenDay: (d: string) => void }) {
  return (
    <Card>
      <h3 className="mb-3 text-label-md uppercase text-ink-muted">Day by day</h3>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
        {Array.from({ length: 7 }, (_, i) => {
          const d = addDays(start, i)
          const s = dayStats(entries, d)
          return (
            <button key={d} type="button" onClick={() => onOpenDay(d)} className={cn('flex min-h-[110px] flex-col rounded-btn border p-2 text-left hover:border-primary/50', d === today ? 'border-primary/50 bg-primary/5' : 'border-line')}>
              <span className="text-body-sm font-semibold text-ink">{parse(d).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })}</span>
              <span className="text-[11px] text-ink-muted">{s.total ? `${s.done}/${s.total} done` : 'Nothing yet'}</span>
              <ul className="mt-1 space-y-0.5">
                {s.es.slice(0, 4).map((e) => <li key={e.id} className={cn('truncate text-[11px]', e.status === 'DONE' ? 'text-ink-muted line-through' : 'text-ink')}>{e.title}</li>)}
                {s.es.length > 4 && <li className="text-[11px] text-ink-muted">+{s.es.length - 4} more</li>}
              </ul>
            </button>
          )
        })}
      </div>
    </Card>
  )
}

function MonthCalendar({ start, entries, today, onOpenDay }: { start: string; entries: WorkEntry[]; today: string; onOpenDay: (d: string) => void }) {
  const lead = (parse(start).getDay() + 6) % 7
  const days = Number(endOf('MONTH', start).slice(8))
  return (
    <Card>
      <h3 className="mb-3 text-label-md uppercase text-ink-muted">Days of the month · click a day to plan or log it</h3>
      <div className="grid grid-cols-7 gap-1.5">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d} className="text-center text-[11px] font-semibold uppercase text-ink-muted">{d}</span>)}
        {Array.from({ length: lead }, (_, i) => <span key={`x${i}`} />)}
        {Array.from({ length: days }, (_, i) => {
          const d = addDays(start, i)
          const s = dayStats(entries, d)
          return (
            <button key={d} type="button" onClick={() => onOpenDay(d)} className={cn('flex h-20 flex-col rounded-btn border p-1.5 text-left hover:border-primary/50', d === today ? 'border-primary/50 bg-primary/5' : 'border-line')}>
              <span className="text-body-sm font-semibold text-ink">{i + 1}</span>
              {s.total > 0 && <span className={cn('mt-auto self-start rounded-full px-1.5 text-[10px] font-bold', s.done === s.total ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning')}>{s.done}/{s.total}</span>}
            </button>
          )
        })}
      </div>
    </Card>
  )
}

function YearMonths({ start, entries, onOpenMonth }: { start: string; entries: WorkEntry[]; onOpenMonth: (d: string) => void }) {
  const y = parse(start).getFullYear()
  return (
    <Card>
      <h3 className="mb-3 text-label-md uppercase text-ink-muted">Months</h3>
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 12 }, (_, m) => {
          const ms = iso(new Date(y, m, 1))
          const me = endOf('MONTH', ms)
          const inMonth = entries.filter((e) => e.periodStart >= ms && e.periodStart <= me && e.period !== 'YEAR' && e.period !== 'WEEK')
          const goals = entries.filter((e) => e.period === 'MONTH' && e.periodStart === ms)
          const doneN = inMonth.filter((e) => e.status === 'DONE').length
          return (
            <button key={m} type="button" onClick={() => onOpenMonth(ms)} className="rounded-btn border border-line p-3 text-left hover:border-primary/50">
              <p className="text-body-md font-semibold text-ink">{parse(ms).toLocaleDateString('en-US', { month: 'long' })}</p>
              <p className="text-body-sm text-ink-muted">{goals.length ? `${goals.filter((g) => g.status === 'DONE').length}/${goals.length} month goals` : 'No month goals'}</p>
              <p className="text-body-sm text-ink-muted">{doneN} done in total</p>
            </button>
          )
        })}
      </div>
    </Card>
  )
}
