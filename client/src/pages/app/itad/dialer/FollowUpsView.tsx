import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, ListChecks, ListPlus, Plus, Save, Search, SlidersHorizontal, Trash2, X } from 'lucide-react'
import { Button } from '../../../../components/ui/Button'
import { Modal } from '../../../../components/ui/Modal'
import { useToast } from '../../../../components/ui/Toast'
import { dialerApi, type DialerData, type DialerLead, type DialerSettings, type SavedView } from '../../../../lib/dialerApi'
import {
  FU_FILTER_KEYS, FU_SORT_FIELDS, DEFAULT_FU_SORT, REGIONS, filterFollowUps, followUpRows, leadState, lastTouched, daysSince,
  sortFollowUps, sortFromParam, sortToParam, taskBucket, type FollowUpDays, type FuFilters, type FuSort, type TaskBucket,
} from '../../../../lib/dialer'
import { cn } from '../../../../lib/cn'
import { DownloadLeads, InfoTip, MultiFilter, StatusPill, errMsg } from './ui'
import { AddTaskModal, BulkBar, CallNow, LocalTime, OutcomeChips, QuietPill, RowMenu } from './TaskParts'
import { TaskHistoryView } from './TaskHistoryView'

/**
 * Follow-ups (ITAD revised spec, 30 Oct 2026). One list of the leads that need following up:
 * quiet longer than their stage's rule, or with a task. The three stage cards (Pipeline 7 days,
 * Interested 14, Connected 30) and the task strip (Overdue, Due today, Upcoming, Done today)
 * filter it. Default order: Pipeline, Interested, Connected, then the most overdue, who can be
 * called now, region and industry. Filters, sort, "show more" and the scroll position live in
 * the address bar, so opening a lead and coming back finds the list as it was.
 */

const PAGE = 50
// Short names in the address bar.
const URL_KEY: Record<keyof FuFilters, string> = { q: 'fq', stage: 'fst', task: 'ftk', state: 'fs', region: 'fr', industry: 'fi', attempts: 'fa', reattempt: 'fre', tries: 'ftr', callNow: 'fcn', quietOp: 'fqo', quietA: 'fqa', quietB: 'fqb', actFrom: 'faf', actTo: 'fat', dueIn: 'fdi', touchedAgo: 'fta', all: 'fall' }
const STRIP: { key: TaskBucket; label: string; tone: string }[] = [
  { key: 'overdue', label: 'Overdue', tone: 'text-rose-600 dark:text-rose-300' },
  { key: 'today', label: 'Due today', tone: 'text-amber-600 dark:text-amber-300' },
  { key: 'upcoming', label: 'Upcoming', tone: 'text-ink' },
  { key: 'done', label: 'Done today', tone: 'text-success' },
]

/** The element that scrolls the page (the app shell's main area, or the window). */
function scroller(el: HTMLElement | null): HTMLElement {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p
  }
  return (document.scrollingElement as HTMLElement) ?? document.documentElement
}

export function FollowUpsView({ data, leads, settings, now, onOpenLead, onChanged, showOwner, followUpDays }: { data: DialerData; leads: DialerLead[]; settings: DialerSettings; now: Date; onOpenLead: (id: string, ids: string[]) => void; onChanged: () => void; showOwner: boolean; followUpDays: FollowUpDays }) {
  const { addToast } = useToast()
  const [params, setParams] = useSearchParams()
  const f: FuFilters = Object.fromEntries(FU_FILTER_KEYS.map((k) => [k, params.get(URL_KEY[k]) ?? undefined]).filter(([, v]) => v)) as FuFilters
  const sort = sortFromParam(params.get('fsort'))
  const shown = Number(params.get('fn')) || PAGE
  const mode = params.get('fmode') === 'history' ? 'history' : 'list'
  const update = (patch: Record<string, string | null>, resetPage = true) => {
    const n = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k) }
    if (resetPage) n.delete('fn')
    setParams(n, { replace: true })
  }
  const setF = (k: keyof FuFilters, v: string | undefined) => update({ [URL_KEY[k]]: v || null })
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)
  const [sorting, setSorting] = useState(false)
  const [naming, setNaming] = useState(false)
  const [called, setCalled] = useState<Set<string>>(new Set())
  const [views, setViews] = useState<SavedView[]>(data.prefs.fuViews ?? [])
  const dayStart = useMemo(() => new Date(data.dayStart), [data.dayStart])
  const chipStatuses = settings.outcomeChipStatuses ?? ['Pipeline', 'Interested']

  const all = useMemo(() => followUpRows(leads, data.tasks, settings, now, followUpDays, f.all === '1'), [leads, data.tasks, settings, now, followUpDays, f.all])
  // The strip and the stage cards count what the other filters leave.
  const noTask = useMemo(() => filterFollowUps(all, { ...f, task: undefined, stage: undefined }, now, dayStart, true), [all, f, now, dayStart]) // eslint-disable-line react-hooks/exhaustive-deps
  const withStage = useMemo(() => filterFollowUps(all, { ...f, task: undefined }, now, dayStart, true), [all, f, now, dayStart]) // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => sortFollowUps(filterFollowUps(all, f, now, dayStart), sort, now), [all, f, sort, now, dayStart]) // eslint-disable-line react-hooks/exhaustive-deps
  const ids = rows.map((r) => r.lead.id)
  const page = rows.slice(0, shown)

  const stages = Object.keys(settings.followUp).sort((a, b) => (settings.followUp[a] ?? 0) - (settings.followUp[b] ?? 0))
  const stageCount = (st: string) => noTask.filter((r) => r.lead.status === st && r.ruleDue).length
  const stripCount = (k: TaskBucket) => withStage.reduce((n, r) => n + [...r.tasks, ...r.done].filter((t) => taskBucket(t, now, dayStart) === k).length, 0)
  const activeTask = f.task ?? ''
  const extra = FU_FILTER_KEYS.filter((k) => f[k] && k !== 'stage' && k !== 'task').length

  // Scroll position: kept per list (address), and put back when the list comes back.
  const anchor = useRef<HTMLDivElement>(null)
  const scrollKey = `dialer.fu.scroll:${params.toString().replace(/(^|&)lead=[^&]*/g, '')}`
  useLayoutEffect(() => {
    const el = scroller(anchor.current)
    const y = Number(sessionStorage.getItem(scrollKey) ?? 0)
    if (y > 0) requestAnimationFrame(() => el.scrollTo({ top: y }))
    let t = 0
    const on = () => { window.clearTimeout(t); t = window.setTimeout(() => { try { sessionStorage.setItem(scrollKey, String(el.scrollTop)) } catch { /* full */ } }, 120) }
    const target: HTMLElement | Window = el === document.scrollingElement ? window : el
    target.addEventListener('scroll', on, { passive: true })
    return () => { target.removeEventListener('scroll', on); window.clearTimeout(t) }
  }, [scrollKey])

  useEffect(() => { setPicked(new Set()) }, [mode])
  const mine = (l: DialerLead) => l.ownerId === data.me.id
  const pageMine = page.filter((r) => mine(r.lead)).map((r) => r.lead.id)
  const allPicked = pageMine.length > 0 && pageMine.every((id) => picked.has(id))

  async function saveViews(next: SavedView[], msg: string) {
    try { await dialerApi.savePrefs({ fuViews: next }); setViews(next); addToast({ type: 'success', message: msg }) } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not save the view') }) }
  }
  const viewFilters = () => Object.fromEntries([...params.entries()].filter(([k]) => k.startsWith('f') && k !== 'fn' && k !== 'fmode'))
  const applyView = (v: SavedView) => {
    const n = new URLSearchParams(params)
    for (const k of [...n.keys()]) if (k.startsWith('f') && k !== 'fmode') n.delete(k)
    for (const [k, v2] of Object.entries(v.filters)) n.set(k, v2)
    setParams(n, { replace: true })
  }
  const activeView = views.find((v) => JSON.stringify(v.filters) === JSON.stringify(viewFilters()))?.id
  const opts = (fn: (l: DialerLead) => string | null, empty: string) => [...new Set(all.map((r) => fn(r.lead) ?? empty))].sort((a, b) => a.localeCompare(b))
  const sel = (on: boolean) => cn('h-8 rounded-full border px-3 text-body-sm focus:border-primary focus:outline-none', on ? 'border-primary bg-primary/5 font-semibold text-primary' : 'border-line bg-card text-ink')

  return (
    <div ref={anchor} className="space-y-4">
      {/* Lead list / Task history, and saved views */}
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" className="inline-flex rounded-btn border border-line bg-card p-1">
          {([['list', 'Lead list'], ['history', 'Task history']] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={mode === k} type="button" onClick={() => update({ fmode: k === 'list' ? null : k }, false)} className={cn('rounded-md px-3 py-1.5 text-body-sm font-semibold', mode === k ? 'bg-primary text-white' : 'text-ink-muted hover:text-ink')}>{l}</button>
          ))}
        </div>
        {mode === 'list' && views.map((v) => (
          <span key={v.id} className={cn('inline-flex items-center rounded-full border text-body-sm font-semibold', activeView === v.id ? 'border-primary bg-primary text-white' : 'border-dashed border-line bg-card text-ink')}>
            <button type="button" onClick={() => applyView(v)} className="py-1 pl-3 pr-1.5">{v.name}</button>
            <button type="button" onClick={() => saveViews(views.filter((x) => x.id !== v.id), `"${v.name}" removed.`)} className="rounded-full p-1 pr-2 opacity-60 hover:opacity-100" aria-label={`Remove ${v.name}`}><X size={12} /></button>
          </span>
        ))}
        {mode === 'list' && Object.keys(viewFilters()).length > 0 && !activeView && <button type="button" onClick={() => setNaming(true)} className="inline-flex items-center gap-1 text-body-sm font-semibold text-primary"><Save size={14} /> Save view</button>}
        <div className="ml-auto flex items-center gap-2">
          <InfoTip side="bottom">
            A touch is one try at reaching a lead: a status change or a re-attempt seen between two imports, or one you log (an outcome, or Add touch). Call now only copies the number.
            Limits: a call Earthzone does not show changes nothing until you log it; several calls between two imports count once (import at the start of each shift); a re-assignment can look like a re-attempt, so you can dismiss a touch on the lead.
          </InfoTip>
          <Button size="sm" leadingIcon={<Plus size={14} />} onClick={() => setAdding(true)}>Add task</Button>
        </div>
      </div>

      {mode === 'history' ? <TaskHistoryView data={data} showOwner={showOwner} onOpenLead={(id) => onOpenLead(id, [id])} /> : (
        <>
          {/* Stage cards */}
          <div className="grid gap-3 sm:grid-cols-3">
            {stages.map((st) => {
              const on = f.stage === st
              return (
                <button key={st} type="button" onClick={() => setF('stage', on ? undefined : st)} aria-pressed={on}
                  className={cn('group rounded-card border bg-card p-4 text-left transition-all', on ? 'border-primary ring-2 ring-primary/20' : 'border-line hover:border-primary/40')}>
                  <span className="flex items-center justify-between"><StatusPill lead={{ status: st, stage: settings.stageMap[st] ?? 3 }} /><span className="text-[11.5px] text-ink-muted">{settings.followUp[st]}-day rule</span></span>
                  <span className="mt-3 block text-[28px] font-semibold leading-none tracking-tight text-ink tabular-nums">{stageCount(st)}</span>
                  <span className="mt-1 block text-body-sm text-ink-muted">due for follow-up{on ? ' · showing' : ''}</span>
                </button>
              )
            })}
          </div>

          {/* Task strip */}
          <div className="flex flex-wrap items-stretch gap-2">
            {STRIP.map((s) => {
              const on = activeTask === s.key
              return (
                <button key={s.key} type="button" onClick={() => setF('task', on ? undefined : s.key)} aria-pressed={on}
                  className={cn('flex min-w-[120px] flex-1 items-center justify-between gap-3 rounded-card border bg-card px-3.5 py-2.5 text-left transition-colors sm:flex-none', on ? 'border-primary ring-2 ring-primary/20' : 'border-line hover:border-primary/40')}>
                  <span className="text-body-sm font-medium text-ink-muted">{s.label}</span>
                  <span className={cn('text-[20px] font-semibold tabular-nums', s.tone)}>{stripCount(s.key)}</span>
                </button>
              )
            })}
            <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 rounded-card border border-dashed border-line px-3.5 text-body-sm font-semibold text-primary hover:border-primary"><ListPlus size={15} />Add task</button>
            <InfoTip>Overdue is one number: leads quiet longer than their rule, call backs and tasks past their time. Each row says why.</InfoTip>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative">
              <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted" />
              <input value={f.q ?? ''} onChange={(e) => setF('q', e.target.value)} placeholder="Search" className="h-8 w-48 rounded-full border border-line bg-card pl-8 pr-2 text-body-sm text-ink focus:border-primary focus:outline-none" />
            </label>
            <MultiFilter label="State" value={f.state} onChange={(v) => setF('state', v)} options={opts((l) => leadState(l), '(no state)').map((v) => ({ value: v }))} />
            <MultiFilter label="Region" value={f.region} onChange={(v) => setF('region', v)} options={REGIONS.map((r) => ({ value: r }))} />
            <MultiFilter label="Industry" value={f.industry} onChange={(v) => setF('industry', v)} options={opts((l) => l.industry, '(no industry)').map((v) => ({ value: v }))} />
            <MultiFilter label="Attempts" value={f.attempts} onChange={(v) => setF('attempts', v)} options={['0', '1', '2', '3+'].map((v) => ({ value: v }))} />
            <select value={f.tries ?? ''} onChange={(e) => setF('tries', e.target.value)} className={sel(!!f.tries)} aria-label="Tries with no status change"><option value="">Tries, same status</option>{[2, 3, 4, 5, 8].map((n) => <option key={n} value={n}>{n} or more</option>)}</select>
            <button type="button" onClick={() => setF('reattempt', f.reattempt ? undefined : 'yes')} className={sel(!!f.reattempt)}>Re-attempted</button>
            <button type="button" onClick={() => setF('callNow', f.callNow ? undefined : '1')} className={sel(!!f.callNow)}>Can call now</button>
            <QuietFilter f={f} set={(patch) => update(Object.fromEntries(Object.entries(patch).map(([k, v]) => [URL_KEY[k as keyof FuFilters], v ?? null])))} />
            <label className={cn('inline-flex h-8 items-center gap-1 rounded-full border px-2 text-body-sm', f.actFrom || f.actTo ? 'border-primary bg-primary/5 text-primary' : 'border-line bg-card text-ink')}>
              <span className="pl-1 text-ink-muted">Last activity</span>
              <input type="date" value={f.actFrom ?? ''} onChange={(e) => setF('actFrom', e.target.value)} className="bg-transparent text-body-sm outline-none" aria-label="Last activity from" />
              <span className="text-ink-faint">–</span>
              <input type="date" value={f.actTo ?? ''} onChange={(e) => setF('actTo', e.target.value)} className="bg-transparent text-body-sm outline-none" aria-label="Last activity to" />
            </label>
            <select value={f.dueIn ?? ''} onChange={(e) => setF('dueIn', e.target.value)} className={sel(!!f.dueIn)} aria-label="Task due within"><option value="">Task due within</option>{[1, 3, 7, 14, 30].map((n) => <option key={n} value={n}>Next {n === 1 ? 'day' : `${n} days`}</option>)}</select>
            <select value={f.touchedAgo ?? ''} onChange={(e) => setF('touchedAgo', e.target.value)} className={sel(!!f.touchedAgo)} aria-label="Last touched"><option value="">Last touched</option>{[7, 14, 30, 60, 90].map((n) => <option key={n} value={n}>More than {n} days ago</option>)}</select>
            <label className="inline-flex items-center gap-1.5 text-body-sm text-ink"><input type="checkbox" checked={f.all === '1'} onChange={(e) => setF('all', e.target.checked ? '1' : undefined)} className="h-4 w-4 accent-primary" />Include not due yet</label>
            {(extra > 0 || f.stage || f.task) && <button type="button" onClick={() => update(Object.fromEntries(FU_FILTER_KEYS.map((k) => [URL_KEY[k], null])))} className="inline-flex items-center gap-1 text-body-sm text-ink-muted hover:text-ink"><X size={14} /> Clear</button>}
          </div>

          {/* The list */}
          <section className="rounded-card border border-line bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
              <span className="text-body-sm text-ink-muted"><b className="text-ink tabular-nums">{rows.length.toLocaleString()}</b> lead{rows.length === 1 ? '' : 's'}</span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setSorting(true)} className="inline-flex h-8 items-center gap-1.5 rounded-btn border border-line px-2.5 text-body-sm font-semibold text-ink hover:bg-slate-50">
                  <SlidersHorizontal size={14} />Sort: {sort.map((s) => FU_SORT_FIELDS.find((x) => x.key === s.key)!.label).slice(0, 2).join(', ')}{sort.length > 2 ? ` +${sort.length - 2}` : ''}
                </button>
                <DownloadLeads title="follow-ups" leads={rows.map((r) => r.lead)} now={now} showOwner={showOwner} />
              </div>
            </div>
            {rows.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
                <ListChecks size={28} className="text-success" />
                <p className="text-body-lg font-semibold text-ink">Nothing to follow up here</p>
                <p className="text-body-sm text-ink-muted">{extra || f.stage || f.task ? 'No lead matches these filters.' : 'Every lead is inside its follow-up rule and has no task due.'}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1080px] text-left text-body-sm">
                  <thead className="text-[11px] uppercase tracking-wide text-ink-muted">
                    <tr className="border-b border-line">
                      <th className="w-9 py-2 pl-4"><input type="checkbox" checked={allPicked} onChange={(e) => setPicked((s) => { const n = new Set(s); pageMine.forEach((id) => (e.target.checked ? n.add(id) : n.delete(id))); return n })} className="h-4 w-4 accent-primary" aria-label="Pick the shown rows" /></th>
                      <th className="px-2 py-2">Company</th><th className="px-2">Contact</th><th className="px-2">Phone · their time</th><th className="px-2">Stage</th>
                      <th className="px-2">Last touched</th><th className="px-2">Tries</th><th className="px-2">Days quiet</th>{showOwner && <th className="px-2">Rep</th>}<th className="px-2 pr-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {page.map((r) => {
                      const l = r.lead
                      const chips = called.has(l.id) && chipStatuses.includes(l.status) && mine(l)
                      return (
                        <tr key={l.id} className={cn('align-top hover:bg-slate-50/70', picked.has(l.id) && 'bg-primary/[0.04]')}>
                          <td className="py-3 pl-4"><input type="checkbox" disabled={!mine(l)} checked={picked.has(l.id)} onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(l.id); else n.delete(l.id); return n })} className="h-4 w-4 accent-primary" aria-label={`Pick ${l.company}`} /></td>
                          <td className="max-w-[220px] px-2 py-3">
                            <button type="button" onClick={() => onOpenLead(l.id, ids)} className="block max-w-full truncate text-left font-semibold text-ink hover:underline">{l.company}</button>
                            <span className="block truncate text-[11.5px] text-ink-muted">{[leadState(l), l.industry].filter(Boolean).join(' · ') || ' '}</span>
                          </td>
                          <td className="max-w-[160px] px-2 py-3"><span className="block truncate text-ink">{l.contactName ?? '—'}</span>{l.jobTitle && <span className="block truncate text-[11.5px] text-ink-muted">{l.jobTitle}</span>}</td>
                          <td className="whitespace-nowrap px-2 py-3"><span className="block tabular-nums text-ink">{l.phone ?? '—'}</span><LocalTime lead={l} now={now} open={r.callNow} /></td>
                          <td className="px-2 py-3"><StatusPill lead={l} /></td>
                          <td className="whitespace-nowrap px-2 py-3 text-ink">{relDay(lastTouched(l), now)}</td>
                          <td className="whitespace-nowrap px-2 py-3 text-ink-muted">{l.tries ? `${l.tries} ${l.tries === 1 ? 'try' : 'tries'}, same status` : ''}</td>
                          <td className="max-w-[220px] px-2 py-3"><QuietPill row={r} /></td>
                          {showOwner && <td className="px-2 py-3 text-ink-muted">{l.ownerName}</td>}
                          <td className="px-2 py-3 pr-4">
                            <div className="flex items-center justify-end gap-1.5">
                              {mine(l) && <CallNow lead={l} compact onCalled={() => setCalled((s) => new Set(s).add(l.id))} />}
                              {mine(l) && <RowMenu lead={l} leads={leads.filter(mine)} onDone={onChanged} />}
                            </div>
                            {chips && <div className="mt-1.5 flex justify-end"><OutcomeChips lead={l} onDone={() => { setCalled((s) => { const n = new Set(s); n.delete(l.id); return n }); onChanged() }} onClose={() => setCalled((s) => { const n = new Set(s); n.delete(l.id); return n })} /></div>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {rows.length > shown && (
                  <div className="flex items-center justify-center gap-3 border-t border-line py-3 text-body-sm">
                    <span className="text-ink-muted">Showing {shown} of {rows.length.toLocaleString()}</span>
                    <Button size="sm" variant="secondary" onClick={() => update({ fn: String(shown + PAGE) }, false)}>Show {Math.min(PAGE, rows.length - shown)} more</Button>
                  </div>
                )}
              </div>
            )}
          </section>
          <BulkBar ids={[...picked]} count={picked.size} onClear={() => setPicked(new Set())} onDone={onChanged} />
        </>
      )}

      {adding && <AddTaskModal leads={leads.filter(mine)} onClose={() => setAdding(false)} onDone={() => { setAdding(false); onChanged() }} />}
      {sorting && <SortModal sort={sort} onClose={() => setSorting(false)} onSave={(s) => { update({ fsort: sortToParam(s) === sortToParam(DEFAULT_FU_SORT) ? null : sortToParam(s) }); setSorting(false) }} />}
      {naming && <NameModal onClose={() => setNaming(false)} onSave={(name) => { const v = { id: `f${Date.now().toString(36)}`, name, filters: viewFilters() }; saveViews([...views, v], `"${name}" saved.`).then(() => setNaming(false)) }} />}
    </div>
  )
}

/** "today", "2 days ago", "3 weeks ago". */
function relDay(iso: string, now: Date): string {
  const d = daysSince(iso, now)
  if (d === 0) return 'today'
  if (d === 1) return 'yesterday'
  if (d < 14) return `${d} days ago`
  if (d < 60) return `${Math.round(d / 7)} weeks ago`
  return `${Math.round(d / 30)} months ago`
}

/** Quiet for: more than / less than / between X and Y days, with presets. */
function QuietFilter({ f, set }: { f: FuFilters; set: (p: Partial<Record<keyof FuFilters, string | undefined>>) => void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', off)
    return () => window.removeEventListener('mousedown', off)
  }, [open])
  const op = f.quietOp ?? 'gt'
  const label = !f.quietA ? 'Quiet for' : op === 'between' ? `Quiet ${f.quietA}–${f.quietB ?? '?'} days` : `Quiet ${op === 'gt' ? 'over' : 'under'} ${f.quietA} days`
  const num = 'h-8 w-16 rounded-btn border border-line bg-card px-2 text-body-sm text-ink focus:border-primary focus:outline-none'
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className={cn('h-8 rounded-full border px-3 text-body-sm', f.quietA ? 'border-primary bg-primary/5 font-semibold text-primary' : 'border-line bg-card text-ink')}>{label}</button>
      {open && (
        <div className="absolute left-0 top-9 z-30 w-72 rounded-card border border-line bg-card p-3 shadow-overlay">
          <div className="inline-flex rounded-btn border border-line p-0.5">
            {([['gt', 'More than'], ['lt', 'Less than'], ['between', 'Between']] as const).map(([k, l]) => <button key={k} type="button" onClick={() => set({ quietOp: k === 'gt' ? undefined : k })} className={cn('rounded-md px-2 py-1 text-[12px] font-semibold', op === k ? 'bg-primary text-white' : 'text-ink-muted')}>{l}</button>)}
          </div>
          <div className="mt-2.5 flex items-center gap-2 text-body-sm text-ink">
            <input type="number" min={0} value={f.quietA ?? ''} onChange={(e) => set({ quietA: e.target.value || undefined })} className={num} aria-label="Days" />
            {op === 'between' && <><span>and</span><input type="number" min={0} value={f.quietB ?? ''} onChange={(e) => set({ quietB: e.target.value || undefined })} className={num} aria-label="Up to days" /></>}
            <span className="text-ink-muted">days</span>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {[7, 14, 30, 60, 90].map((n) => <button key={n} type="button" onClick={() => set({ quietA: String(n) })} className={cn('rounded-full border px-2.5 py-0.5 text-[12px] font-semibold', f.quietA === String(n) ? 'border-primary text-primary' : 'border-line text-ink-muted hover:text-ink')}>{n}</button>)}
          </div>
          {f.quietA && <button type="button" onClick={() => set({ quietOp: undefined, quietA: undefined, quietB: undefined })} className="mt-2 text-[12px] font-semibold text-ink-muted hover:text-ink">Clear</button>}
        </div>
      )}
    </div>
  )
}

/** Sort by several fields, in order (e.g. Stage, then Days overdue, then Region). */
function SortModal({ sort, onClose, onSave }: { sort: FuSort[]; onClose: () => void; onSave: (s: FuSort[]) => void }) {
  const [s, setS] = useState<FuSort[]>(sort)
  const free = FU_SORT_FIELDS.filter((x) => !s.some((y) => y.key === x.key))
  const move = (i: number, d: number) => setS((x) => { const n = [...x]; const [it] = n.splice(i, 1); n.splice(i + d, 0, it); return n })
  return (
    <Modal open onClose={onClose} title="Sort the list" size="sm" footer={<><Button variant="secondary" onClick={() => setS(DEFAULT_FU_SORT)}>Default</Button><Button onClick={() => onSave(s.length ? s : DEFAULT_FU_SORT)}>Apply</Button></>}>
      <ol className="space-y-1.5">
        {s.map((x, i) => (
          <li key={x.key} className="flex items-center gap-2 rounded-btn border border-line px-2.5 py-1.5 text-body-sm">
            <span className="w-5 text-[11px] font-semibold text-ink-faint">{i === 0 ? 'By' : 'then'}</span>
            <span className="flex-1 font-semibold text-ink">{FU_SORT_FIELDS.find((f) => f.key === x.key)!.label}</span>
            <button type="button" onClick={() => setS((y) => y.map((z, j) => (j === i ? { ...z, dir: z.dir === 'asc' ? 'desc' : 'asc' } : z)))} className="rounded-full border border-line px-2 py-0.5 text-[11.5px] font-semibold text-ink-muted hover:text-ink">{x.dir === 'asc' ? 'A→Z / low first' : 'Z→A / high first'}</button>
            <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="rounded p-0.5 text-ink-muted disabled:opacity-30" aria-label="Up"><ArrowUp size={14} /></button>
            <button type="button" disabled={i === s.length - 1} onClick={() => move(i, 1)} className="rounded p-0.5 text-ink-muted disabled:opacity-30" aria-label="Down"><ArrowDown size={14} /></button>
            <button type="button" onClick={() => setS((y) => y.filter((_, j) => j !== i))} className="rounded p-0.5 text-ink-muted hover:text-danger" aria-label="Remove"><Trash2 size={14} /></button>
          </li>
        ))}
      </ol>
      {free.length > 0 && (
        <select value="" onChange={(e) => e.target.value && setS((y) => [...y, { key: e.target.value as FuSort['key'], dir: 'asc' }])} className="mt-3 h-9 w-full rounded-btn border border-line bg-card px-2 text-body-sm text-ink">
          <option value="">+ Then by…</option>
          {free.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
        </select>
      )}
    </Modal>
  )
}

function NameModal({ onClose, onSave }: { onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState('')
  return (
    <Modal open onClose={onClose} title="Save this view" size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!name.trim()} onClick={() => onSave(name.trim())}>Save</Button></>}>
      <input autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && onSave(name.trim())} placeholder="e.g. Pipeline, Pacific, quiet 60+ days" className="h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none" />
      <p className="mt-2 text-[12px] text-ink-muted">Keeps the filters and the sort.</p>
    </Modal>
  )
}

