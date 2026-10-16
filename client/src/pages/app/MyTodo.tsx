import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CalendarDays, ChevronLeft, ChevronRight, Columns3, Copy, Download, List, MoreHorizontal, Users } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { TodoList } from '../../components/TodoList'
import { useToast } from '../../components/ui/Toast'
import { useAuth } from '../../lib/auth'
import { cn } from '../../lib/cn'
import {
  TAG_IDEAS, addDays, copyText, endOf, entriesToText, iso, parse, periodLabel, shift, splitLines, startOf, todayIso, workLogApi,
  type WorkEntry, type WorkEntryInput, type WorkPeriod, type WorkReview, type WorkStatus,
} from '../../lib/workLogApi'
import { Chips, DoneCheck, EntryText, NOUN, ReviewBox, ReviewNote, RowActions, errMsg, type EntryActions } from './todo/parts'
import { TodoBoard } from './todo/TodoBoard'
import { TeamTodo } from './todo/TeamTodo'

/**
 * My To-Do (/app/todo). Plan ahead or log what was already done, for any day, week, month or
 * year, past or future. List or board (To do / In progress / Done). Copy everything at once to
 * paste into a report. Team Leads also get a Team view: who logged, who needs help, and a review
 * with a rating and comment for each person.
 */

const TABS: { key: WorkPeriod; label: string }[] = [
  { key: 'DAY', label: 'Day' }, { key: 'WEEK', label: 'Week' }, { key: 'MONTH', label: 'Month' }, { key: 'YEAR', label: 'Year' },
]
const PERIOD_KEYS = TABS.map((t) => t.key)
const STATUS_LABEL: Record<WorkStatus, string> = { PLANNED: 'To do', IN_PROGRESS: 'In progress', DONE: 'Done' }

function readLayout(): 'list' | 'board' {
  try { return localStorage.getItem('todo.layout') === 'board' ? 'board' : 'list' } catch { return 'list' }
}

export default function MyTodo() {
  const { user } = useAuth()
  const { addToast } = useToast()
  const [params] = useSearchParams()
  const isLead = user?.role === 'TEAM_LEAD' || user?.role === 'SUPER_ADMIN'
  const [period, setPeriod] = useState<WorkPeriod>(() => (PERIOD_KEYS.includes(params.get('period') as WorkPeriod) ? (params.get('period') as WorkPeriod) : 'DAY'))
  const [anchor, setAnchor] = useState(() => (/^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date')! : todayIso()))
  const [mode, setMode] = useState<'mine' | 'team'>(() => (params.get('view') === 'team' ? 'team' : 'mine'))
  const [layout, setLayoutState] = useState<'list' | 'board'>(readLayout)
  const [entries, setEntries] = useState<WorkEntry[] | null>(null)
  const [reviews, setReviews] = useState<WorkReview[]>([])
  const [readOnly, setReadOnly] = useState(false)
  const [canReview, setCanReview] = useState(false)
  const [people, setPeople] = useState<{ id: string; name: string; department: string | null }[]>([])
  const [who, setWho] = useState('')
  const [editing, setEditing] = useState<WorkEntry | null>(null)
  const [reviewBusy, setReviewBusy] = useState(false)

  function setLayout(l: 'list' | 'board') { setLayoutState(l); try { localStorage.setItem('todo.layout', l) } catch { /* ignore */ } }

  const start = startOf(period, anchor)
  const end = endOf(period, start)
  // Load the whole year around the view (plus the week that may start in December), so moving
  // between days and months is instant.
  const year = parse(anchor).getFullYear()
  const from = iso(new Date(year - 1, 11, 25))
  const to = iso(new Date(year, 11, 31))

  const load = useCallback(() => {
    if (mode === 'team') return
    workLogApi.list(from, to, who || undefined)
      .then((r) => { setEntries(r.entries); setReviews(r.reviews ?? []); setReadOnly(r.readOnly); setCanReview(!!r.canReview) })
      .catch((e) => { setEntries([]); addToast({ type: 'error', message: errMsg(e, 'Could not load your to-dos') }) })
  }, [from, to, who, mode, addToast])
  useEffect(load, [load])
  useEffect(() => { workLogApi.people().then((r) => setPeople(r.people)).catch(() => {}) }, [])

  const all = entries ?? []
  const of = (p: WorkPeriod, s: string) => all.filter((e) => e.period === p && e.periodStart === s)
  const here = of(period, start)
  const done = here.filter((e) => e.status === 'DONE')
  const inProgress = here.filter((e) => e.status === 'IN_PROGRESS')
  const sum = (k: 'hours' | 'quantity') => here.reduce((t, e) => t + (e[k] ?? 0), 0)
  const today = todayIso()
  const isPast = end < today
  const review = reviews.find((r) => r.period === period && r.periodStart === start) ?? null
  const whoName = who ? people.find((p) => p.id === who)?.name : null

  async function mutate(fn: () => Promise<unknown>, ok?: string) {
    try { await fn(); if (ok) addToast({ type: 'success', message: ok }); load() } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not save') }) }
  }
  const actions: EntryActions = {
    onStatus: (e, status) => {
      // Show the move straight away; the reload confirms it.
      setEntries((list) => list?.map((x) => (x.id === e.id ? { ...x, status, blocked: status === 'DONE' ? false : x.blocked } : x)) ?? list)
      mutate(() => workLogApi.update(e.id, { status }))
    },
    onBlocked: (e) => mutate(() => workLogApi.update(e.id, { blocked: !e.blocked }), e.blocked ? undefined : 'Flagged. Your Team Lead sees it at the top of their team view.'),
    onCarry: (e) => mutate(() => workLogApi.carry(e.id), `Moved to the next ${NOUN[e.period]}.`),
    onEdit: setEditing,
    onDelete: (e) => mutate(() => workLogApi.remove(e.id), 'Deleted.'),
  }

  async function copyAll() {
    const name = whoName ?? user?.name ?? ''
    await copyText(entriesToText(`${name ? `${name}, ` : ''}${periodLabel(period, start)}`, here))
    addToast({ type: 'success', message: `Copied ${here.length} item${here.length === 1 ? '' : 's'}. Paste it anywhere.` })
  }

  function downloadCsv() {
    const rows = all.filter((e) => e.periodStart >= start && e.periodStart <= end)
    const head = ['Period', 'Starts', 'What', 'Status', 'Needs help', 'Hours', 'How many', 'Tag', 'Details']
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const csv = [head.join(','), ...rows.map((e) => [e.period, e.periodStart, e.title, STATUS_LABEL[e.status], e.blocked ? 'Yes' : '', e.hours ?? '', e.quantity ?? '', e.tag ?? '', e.details ?? ''].map(q).join(','))].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `to-dos-${start}-to-${end}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function saveReview(rating: WorkReview['rating'], comment: string, clear = false) {
    if (!who) return
    setReviewBusy(true)
    try { await workLogApi.review({ userId: who, period, date: start, rating, comment: comment || null, clear }); addToast({ type: 'success', message: clear ? 'Review removed.' : 'Review sent.' }); load() } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not save the review') }) } finally { setReviewBusy(false) }
  }

  const tagIdeas = useMemo(() => {
    const dept = (user?.department as string | undefined) ?? ''
    return [...new Set([...(TAG_IDEAS[dept] ?? []), ...all.map((e) => e.tag).filter(Boolean) as string[], ...TAG_IDEAS['']])]
  }, [user, all])

  const toolBtn = 'inline-flex h-8 items-center gap-1.5 rounded-btn border border-line bg-card px-2.5 text-body-sm text-ink hover:bg-slate-50'

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">{mode === 'team' ? 'Team To-Do' : whoName ? `${whoName}'s To-Do` : 'My To-Do'}</h1>
          <p className="mt-1 text-body-md text-ink-muted">
            {mode === 'team' ? 'Everyone in your team for this period: what they did, who needs help, and your review.'
              : readOnly ? 'Read only. Private entries are not shown.'
                : 'Plan ahead, or log what you already did, for any day, week, month or year. Your Team Lead can see entries that are not private.'}
          </p>
        </div>
        {isLead && (
          <div className="flex flex-wrap items-center gap-2">
            {mode === 'mine' && people.length > 0 && (
              <select value={who} onChange={(e) => setWho(e.target.value)} className="h-9 rounded-btn border border-line bg-card px-2 text-body-sm font-semibold text-ink" aria-label="Whose to-dos">
                <option value="">My to-dos</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.department ? ` · ${p.department}` : ''}</option>)}
              </select>
            )}
            <div className="inline-flex rounded-btn border border-line bg-card p-0.5">
              <button type="button" onClick={() => setMode('mine')} className={cn('h-8 rounded-md px-3 text-body-sm font-semibold', mode === 'mine' ? 'bg-ink text-white' : 'text-ink-muted hover:text-ink')}>{who ? 'Person' : 'Mine'}</button>
              <button type="button" onClick={() => setMode('team')} className={cn('inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-body-sm font-semibold', mode === 'team' ? 'bg-ink text-white' : 'text-ink-muted hover:text-ink')}><Users size={14} /> Team</button>
            </div>
          </div>
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
        {mode === 'mine' && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-btn border border-line bg-card p-0.5" aria-label="Layout">
              <button type="button" onClick={() => setLayout('list')} className={cn('inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-body-sm font-semibold', layout === 'list' ? 'bg-slate-100 text-ink' : 'text-ink-muted')}><List size={14} /> List</button>
              <button type="button" onClick={() => setLayout('board')} className={cn('inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-body-sm font-semibold', layout === 'board' ? 'bg-slate-100 text-ink' : 'text-ink-muted')}><Columns3 size={14} /> Board</button>
            </div>
            <button type="button" onClick={copyAll} disabled={!here.length} className={cn(toolBtn, 'disabled:opacity-50')} title={`Copy everything for this ${NOUN[period]} to paste in WhatsApp, email or a report`}><Copy size={14} /> Copy all</button>
            <button type="button" onClick={downloadCsv} className={toolBtn} title={`Download this ${NOUN[period]} as a spreadsheet`}><Download size={14} /> CSV</button>
          </div>
        )}
      </div>

      {mode === 'team' ? (
        <TeamTodo period={period} start={start} isSuperAdmin={user?.role === 'SUPER_ADMIN'} onOpenPerson={(id) => { setWho(id); setMode('mine') }} />
      ) : (
        <div className={cn('grid gap-5', period === 'DAY' && layout === 'list' ? 'lg:grid-cols-[minmax(0,1fr)_340px]' : '')}>
          <div className="min-w-0 space-y-5">
            <Card>
              <div className="mb-3 flex flex-wrap items-center gap-2 text-body-sm">
                <span className="rounded-full bg-success/10 px-2.5 py-0.5 font-semibold text-success">{done.length} done</span>
                {inProgress.length > 0 && <span className="rounded-full bg-warning/10 px-2.5 py-0.5 font-semibold text-warning">{inProgress.length} in progress</span>}
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 font-semibold text-ink-muted">{here.length - done.length - inProgress.length} to do</span>
                {sum('hours') > 0 && <span className="rounded-full bg-primary/10 px-2.5 py-0.5 font-semibold text-primary">{+sum('hours').toFixed(2)} h</span>}
                {sum('quantity') > 0 && <span className="rounded-full bg-accent/10 px-2.5 py-0.5 font-semibold text-accent">{sum('quantity').toLocaleString()} items</span>}
                <span className="text-ink-muted">{period === 'DAY' ? 'for this day' : `goals and work for this ${NOUN[period]}`}</span>
              </div>
              {review && !(readOnly && canReview) && <ReviewNote review={review} />}
              {readOnly && canReview && (
                <div className="mb-4 rounded-btn border border-line bg-slate-50/70 p-3">
                  <p className="mb-2 text-label-md uppercase text-ink-muted">Your review of this {NOUN[period]}</p>
                  <ReviewBox key={review?.updatedAt ?? 'none'} review={review} busy={reviewBusy} onSave={(r, c) => saveReview(r, c)} onClear={() => saveReview(null, '', true)} />
                </div>
              )}
              {!readOnly && <AddEntry key={`${period}-${start}`} period={period} date={start} pastPeriod={isPast} tagIdeas={tagIdeas} onAdded={load} />}
              {entries === null ? <p className="py-6 text-center text-body-md text-ink-muted">Loading…</p>
                : layout === 'board' ? <TodoBoard entries={here} readOnly={readOnly} actions={actions} />
                  : <EntryList entries={here} readOnly={readOnly} actions={actions}
                    empty={readOnly ? 'Nothing here.' : isPast ? `Nothing logged for this ${NOUN[period]} yet. Add what was done above.` : `Nothing planned for this ${NOUN[period]} yet.`} />}
            </Card>

            {/* Below: the days of the week, the days of the month, or the months of the year. */}
            {period === 'WEEK' && <WeekDays start={start} entries={all} today={today} onOpenDay={(d) => { setPeriod('DAY'); setAnchor(d) }} />}
            {period === 'MONTH' && <MonthCalendar start={start} entries={all} today={today} onOpenDay={(d) => { setPeriod('DAY'); setAnchor(d) }} />}
            {period === 'YEAR' && <YearMonths start={start} entries={all} onOpenMonth={(d) => { setPeriod('MONTH'); setAnchor(d) }} />}
          </div>

          {period === 'DAY' && layout === 'list' && (
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
      )}

      {editing && <EditEntry entry={editing} tagIdeas={tagIdeas} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
    </div>
  )
}

// ------------------------------------------------------------------ add / edit

/** Grows with the text, up to about eight lines. */
function useAutoGrow(ref: React.RefObject<HTMLTextAreaElement | null>, value: string, max = 200) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, max)}px`
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
  }, [ref, value, max])
}

function AddEntry({ period, date, pastPeriod, tagIdeas, onAdded }: { period: WorkPeriod; date: string; pastPeriod: boolean; tagIdeas: string[]; onAdded: () => void }) {
  const { addToast } = useToast()
  const [title, setTitle] = useState('')
  const [status, setStatus] = useState<WorkStatus>(pastPeriod ? 'DONE' : 'PLANNED')
  const [more, setMore] = useState(false)
  const [details, setDetails] = useState('')
  const [hours, setHours] = useState('')
  const [qty, setQty] = useState('')
  const [tag, setTag] = useState('')
  const [priv, setPriv] = useState(false)
  const [help, setHelp] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  useAutoGrow(ref, title)
  const lines = splitLines(title)
  const multi = lines.length > 1

  function reset() { setTitle(''); setDetails(''); setHours(''); setQty(''); setTag(''); setPriv(false); setHelp(false); ref.current?.focus() }

  async function addOne() {
    if (!title.trim()) return
    setBusy(true)
    try {
      await workLogApi.create({
        period, date, title: title.trim(), status,
        details: details.trim() || null, hours: hours ? Number(hours) : null, quantity: qty ? Math.round(Number(qty)) : null, tag: tag.trim() || null, private: priv, blocked: help && status !== 'DONE',
      })
      reset(); onAdded()
    } catch (err) { addToast({ type: 'error', message: errMsg(err, 'Could not add') }) } finally { setBusy(false) }
  }

  /** Each line becomes its own item (bullets and numbers removed). */
  async function addEach() {
    setBusy(true)
    let made = 0
    try {
      for (const l of lines) {
        await workLogApi.create({ period, date, title: l, status, tag: tag.trim() || null, private: priv, blocked: help && status !== 'DONE' })
        made++
      }
      addToast({ type: 'success', message: `Added ${made} items.` })
      reset(); onAdded()
    } catch (err) { addToast({ type: 'error', message: `${made ? `Added ${made}, then: ` : ''}${errMsg(err, 'Could not add')}` }); if (made) onAdded() } finally { setBusy(false) }
  }

  const field = 'h-9 rounded-btn border border-line bg-card px-2.5 text-body-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10'
  const prompt = status === 'DONE' ? `What did you get done this ${NOUN[period]}?` : `What do you plan for this ${NOUN[period]}?`
  return (
    <form onSubmit={(e) => { e.preventDefault(); addOne() }} className="mb-4 space-y-2 rounded-card border border-line bg-slate-50/70 p-3">
      <div className="flex flex-wrap items-start gap-2">
        <textarea ref={ref} rows={1} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={3000}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); addOne() } }}
          placeholder={prompt} title="Enter adds it. Shift+Enter starts a new line. Paste a list to add each line as its own item."
          className="min-h-[40px] min-w-0 flex-1 resize-none rounded-btn border border-line bg-card px-2.5 py-2 text-body-md leading-snug text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10" />
        <div className="inline-flex rounded-btn border border-line bg-card p-0.5 text-body-sm">
          {(['PLANNED', 'IN_PROGRESS', 'DONE'] as WorkStatus[]).map((s) => (
            <button key={s} type="button" onClick={() => setStatus(s)} className={cn('h-8 rounded-md px-2.5 font-semibold', status === s ? (s === 'DONE' ? 'bg-success text-white' : s === 'IN_PROGRESS' ? 'bg-warning text-white' : 'bg-ink text-white') : 'text-ink-muted')}>{STATUS_LABEL[s]}</button>
          ))}
        </div>
        <button type="button" onClick={() => setMore((m) => !m)} className="rounded-btn p-2 text-ink-muted hover:bg-slate-100 hover:text-ink" title="Details, time, how many, tag" aria-label="More options"><MoreHorizontal size={16} /></button>
        <Button type="submit" size="sm" disabled={busy || !title.trim()}>{multi ? 'Add as one' : 'Add'}</Button>
      </div>
      {multi && (
        <div className="flex flex-wrap items-center gap-2 rounded-btn bg-primary/5 px-3 py-2 text-body-sm text-ink">
          <span>This has {lines.length} lines.</span>
          <button type="button" disabled={busy} onClick={addEach} className="rounded-full bg-primary px-3 py-1 font-semibold text-white disabled:opacity-50">Add as {lines.length} separate items</button>
          <span className="text-ink-muted">or press Add as one to keep it as a single entry.</span>
        </div>
      )}
      {more && (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_110px_110px_160px]">
          <input value={details} onChange={(e) => setDetails(e.target.value)} maxLength={4000} placeholder="Details or link (optional)" className={field} />
          <input value={hours} onChange={(e) => setHours(e.target.value)} type="number" min={0} step={0.25} placeholder="Hours" className={field} />
          <input value={qty} onChange={(e) => setQty(e.target.value)} type="number" min={0} step={1} placeholder="How many" className={field} title="e.g. 25 listings, 40 orders" />
          <input value={tag} onChange={(e) => setTag(e.target.value)} list="worklog-tags" maxLength={40} placeholder="Tag" className={field} />
          <datalist id="worklog-tags">{tagIdeas.map((t) => <option key={t} value={t} />)}</datalist>
          <div className="flex flex-wrap gap-4 sm:col-span-4">
            <label className="flex items-center gap-2 text-body-sm text-ink-muted"><input type="checkbox" checked={help} onChange={(e) => setHelp(e.target.checked)} className="h-4 w-4 accent-danger" /> I need help with this</label>
            <label className="flex items-center gap-2 text-body-sm text-ink-muted"><input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} className="h-4 w-4 accent-primary" /> Private (only you can see it)</label>
          </div>
        </div>
      )}
    </form>
  )
}

function EditEntry({ entry, tagIdeas, onClose, onSaved }: { entry: WorkEntry; tagIdeas: string[]; onClose: () => void; onSaved: () => void }) {
  const { addToast } = useToast()
  const [v, setV] = useState({ title: entry.title, details: entry.details ?? '', hours: entry.hours?.toString() ?? '', qty: entry.quantity?.toString() ?? '', tag: entry.tag ?? '', priv: entry.private, help: entry.blocked, period: entry.period, date: entry.periodStart, status: entry.status })
  const [busy, setBusy] = useState(false)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  useAutoGrow(titleRef, v.title, 260)
  async function save() {
    setBusy(true)
    const body: WorkEntryInput = {
      title: v.title.trim(), details: v.details.trim() || null, hours: v.hours ? Number(v.hours) : null, quantity: v.qty ? Math.round(Number(v.qty)) : null,
      tag: v.tag.trim() || null, private: v.priv, blocked: v.status !== 'DONE' && v.help, status: v.status,
      ...(v.period !== entry.period || v.date !== entry.periodStart ? { period: v.period, date: v.date } : {}),
    }
    try { await workLogApi.update(entry.id, body); onSaved() } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not save') }) } finally { setBusy(false) }
  }
  const field = 'h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'
  return (
    <Modal open onClose={onClose} title="Edit" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy || !v.title.trim()} onClick={save}>Save</Button></>}>
      <div className="space-y-3 text-body-sm">
        <label className="block"><span className="mb-1 block font-semibold text-ink">What</span><textarea ref={titleRef} value={v.title} maxLength={3000} rows={2} onChange={(e) => setV({ ...v, title: e.target.value })} className="w-full resize-none rounded-btn border border-line bg-card px-3 py-2 text-body-md text-ink focus:border-primary focus:outline-none" /></label>
        <label className="block"><span className="mb-1 block font-semibold text-ink">Details or link</span><textarea value={v.details} maxLength={4000} rows={3} onChange={(e) => setV({ ...v, details: e.target.value })} className="w-full rounded-btn border border-line bg-card px-3 py-2 text-body-md text-ink focus:border-primary focus:outline-none" /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="mb-1 block font-semibold text-ink">Status</span>
            <select value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as WorkStatus })} className={field}>{(['PLANNED', 'IN_PROGRESS', 'DONE'] as WorkStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
          </label>
          <label className="block"><span className="mb-1 block font-semibold text-ink">For a</span>
            <select value={v.period} onChange={(e) => setV({ ...v, period: e.target.value as WorkPeriod })} className={field}>{TABS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
          </label>
          <label className="block"><span className="mb-1 block font-semibold text-ink">Date (any day in it)</span><input type="date" value={v.date} onChange={(e) => e.target.value && setV({ ...v, date: e.target.value })} className={field} /></label>
          <label className="block"><span className="mb-1 block font-semibold text-ink">Tag</span><input value={v.tag} list="worklog-tags-edit" maxLength={40} onChange={(e) => setV({ ...v, tag: e.target.value })} className={field} /><datalist id="worklog-tags-edit">{tagIdeas.map((t) => <option key={t} value={t} />)}</datalist></label>
          <label className="block"><span className="mb-1 block font-semibold text-ink">Hours</span><input type="number" min={0} step={0.25} value={v.hours} onChange={(e) => setV({ ...v, hours: e.target.value })} className={field} /></label>
          <label className="block"><span className="mb-1 block font-semibold text-ink">How many</span><input type="number" min={0} step={1} value={v.qty} onChange={(e) => setV({ ...v, qty: e.target.value })} className={field} /></label>
        </div>
        {v.status !== 'DONE' && <label className="flex items-center gap-2 text-ink"><input type="checkbox" checked={v.help} onChange={(e) => setV({ ...v, help: e.target.checked })} className="h-4 w-4 accent-danger" /> I need help with this</label>}
        <label className="flex items-center gap-2 text-ink"><input type="checkbox" checked={v.priv} onChange={(e) => setV({ ...v, priv: e.target.checked })} className="h-4 w-4 accent-primary" /> Private (only you can see it)</label>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ list

function EntryList({ entries, readOnly, empty, actions }: { entries: WorkEntry[]; readOnly: boolean; empty: string; actions: EntryActions }) {
  if (entries.length === 0) return <p className="py-6 text-center text-body-md text-ink-muted">{empty}</p>
  const groups: { label: string; status: WorkStatus }[] = [{ label: 'In progress', status: 'IN_PROGRESS' }, { label: 'To do', status: 'PLANNED' }, { label: 'Done', status: 'DONE' }]
  return (
    <div className="space-y-4">
      {groups.map((g) => ({ ...g, rows: entries.filter((e) => e.status === g.status).sort((a, b) => Number(b.blocked) - Number(a.blocked)) })).filter((g) => g.rows.length).map((g) => (
        <div key={g.label}>
          <p className="mb-1 text-label-md uppercase text-ink-muted">{g.label} · {g.rows.length}</p>
          <ul className="divide-y divide-line rounded-btn border border-line">
            {g.rows.map((e) => (
              <li key={e.id} className={cn('group flex items-start gap-3 px-3 py-2.5', e.blocked && e.status !== 'DONE' && 'bg-danger/5')}>
                <DoneCheck e={e} readOnly={readOnly} onToggle={() => actions.onStatus(e, e.status === 'DONE' ? 'PLANNED' : 'DONE')} />
                <div className="min-w-0 flex-1 text-body-md">
                  <EntryText text={e.title} done={e.status === 'DONE'} />
                  {e.details && <EntryText text={e.details} done className="mt-0.5 text-body-sm" lines={3} />}
                  <Chips e={{ ...e, status: e.status === 'IN_PROGRESS' ? 'PLANNED' : e.status }} />
                </div>
                {!readOnly && <RowActions e={e} a={actions} />}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
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
              <span className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', e.status === 'DONE' ? 'bg-success' : e.status === 'IN_PROGRESS' ? 'bg-warning' : 'bg-slate-300')} />
              <span className={cn('line-clamp-2 break-words', e.status === 'DONE' ? 'text-ink-muted line-through' : 'text-ink')}>{e.title}</span>
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
      <p className="mt-2 text-[11px] text-ink-muted">Green dot: all done. Amber: some still open. Click any past day to log what was done.</p>
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
          const inMonth = entries.filter((e) => e.periodStart >= ms && e.periodStart <= me && (e.period === 'DAY' || e.period === 'MONTH'))
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
