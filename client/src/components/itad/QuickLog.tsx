import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronUp, CloudOff, ExternalLink, Loader2, Minus, Plus, RefreshCw, X } from 'lucide-react'
import { cn } from '../../lib/cn'
import { useAuth } from '../../lib/auth'
import { apiErrorText } from '../../lib/api'
import { ITAD_METRICS, getMyItadEntry, upsertItadEntry, type ItadEntryResponse, type ItadMetricKey, type ItadTotals } from '../../lib/itadApi'

/**
 * Quick Log: today's ITAD Daily Activity Log in a small panel, reachable from any Metriq page
 * (the floating button) or in its own little window (Detach). Both are this one component and
 * both write to the same daily entry: every + and − is sent to the server as "add 1" / "add −1",
 * so two windows never overwrite each other and the full Daily Log page keeps working as before.
 *
 * Taps are kept locally and sent together a moment later (or at once with Save). If the send
 * fails, nothing is lost: the pending taps stay (and survive a reload) until a later save works.
 */

const CHANNEL = 'pt-quicklog'
const zero = (): ItadTotals => ITAD_METRICS.reduce((acc, m) => ({ ...acc, [m.key]: 0 }), {} as ItadTotals)
const pendingKey = (userId: string, date: string) => `itad-quick:${userId}:${date}`

type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved'; at: Date } | { kind: 'failed'; error: string }

/** Tell the other windows (and the full Daily Log page) that today's entry changed. */
export function announceQuickLogSave(date: string): void {
  try { new BroadcastChannel(CHANNEL).postMessage({ type: 'saved', date }) } catch { /* no BroadcastChannel: the storage event below still fires */ }
  try { localStorage.setItem('pt-quicklog-saved', `${date}:${Date.now()}`) } catch { /* fine */ }
}
/** Hear about saves made in other windows (BroadcastChannel, with the storage event as a second wire). */
export function onQuickLogSaved(fn: (date: string) => void): () => void {
  let ch: BroadcastChannel | null = null
  try { ch = new BroadcastChannel(CHANNEL); ch.onmessage = (e) => { if (e.data?.type === 'saved') fn(String(e.data.date)) } } catch { ch = null }
  const onStorage = (e: StorageEvent) => { if (e.key === 'pt-quicklog-saved' && e.newValue) fn(e.newValue.split(':')[0]) }
  window.addEventListener('storage', onStorage)
  return () => { ch?.close(); window.removeEventListener('storage', onStorage) }
}

export function QuickLogPanel({ standalone, onClose, onDetach, onMinimize }: { standalone?: boolean; onClose?: () => void; onDetach?: () => void; onMinimize?: () => void }) {
  const { user } = useAuth()
  const [data, setData] = useState<ItadEntryResponse | null>(null)
  const [loadError, setLoadError] = useState('')
  const [pending, setPending] = useState<ItadTotals>(zero)
  const [notes, setNotes] = useState('')
  const [notesDirty, setNotesDirty] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const [save, setSave] = useState<SaveState>({ kind: 'idle' })
  const timer = useRef<number>()
  const inFlight = useRef(false)
  const again = useRef(false)
  const notesRef = useRef(notes); notesRef.current = notes
  const flushRef = useRef<() => Promise<void>>(async () => undefined)
  const key = user && data ? pendingKey(user.id, data.date) : null

  const load = useCallback(async () => {
    try {
      const r = await getMyItadEntry()
      setData(r)
      setLoadError('')
      setNotes((cur) => (notesDirty ? cur : r.entry?.notes ?? ''))
      // Taps that never reached the server (closed window, lost connection) come back.
      if (user) {
        try { const raw = localStorage.getItem(pendingKey(user.id, r.date)); if (raw) setPending({ ...zero(), ...(JSON.parse(raw) as Partial<ItadTotals>) }) } catch { /* fine */ }
      }
    } catch (e) { setLoadError(apiErrorText(e, 'Could not load today’s log')) }
  }, [user, notesDirty])

  useEffect(() => { void load() }, [load])
  // Other windows saving, coming back to this window, and a slow heartbeat all refresh the numbers.
  useEffect(() => {
    const off = onQuickLogSaved(() => { if (!inFlight.current) void load() })
    const onVis = () => { if (document.visibilityState === 'visible' && !inFlight.current) void load() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)
    const t = window.setInterval(onVis, 20_000)
    return () => { off(); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onVis); window.clearInterval(t) }
  }, [load])

  const hasPending = useMemo(() => ITAD_METRICS.some((m) => pending[m.key] !== 0) || notesDirty, [pending, notesDirty])

  const flush = useCallback(async () => {
    if (!key) return
    if (inFlight.current) { again.current = true; return }
    const add = { ...pending }
    const sendNotes = notesDirty ? notes : undefined
    const anyAdd = ITAD_METRICS.some((m) => add[m.key] !== 0)
    if (!anyAdd && sendNotes === undefined) return
    inFlight.current = true
    setSave({ kind: 'saving' })
    try {
      const r = await upsertItadEntry({ status: 'SUBMITTED', add, ...(sendNotes !== undefined ? { notes: sendNotes } : {}) })
      // Only what was sent is cleared; taps made while saving stay pending.
      setPending((cur) => ITAD_METRICS.reduce((acc, m) => ({ ...acc, [m.key]: cur[m.key] - add[m.key] }), {} as ItadTotals))
      if (sendNotes !== undefined) setNotesDirty(notesRef.current !== sendNotes) // typed more meanwhile: still dirty
      setData((d) => (d ? { ...d, entry: r.entry } : d))
      setSave({ kind: 'saved', at: new Date() })
      announceQuickLogSave(r.entry.date)
    } catch (e) {
      setSave({ kind: 'failed', error: apiErrorText(e, 'Could not save') })
    } finally {
      inFlight.current = false
      if (again.current) { again.current = false; timer.current = window.setTimeout(() => void flushRef.current(), 300) }
    }
  }, [key, pending, notes, notesDirty])
  flushRef.current = flush

  // Pending taps are kept on disk and sent a moment after the last tap.
  useEffect(() => {
    if (!key) return
    try { if (ITAD_METRICS.some((m) => pending[m.key] !== 0)) localStorage.setItem(key, JSON.stringify(pending)); else localStorage.removeItem(key) } catch { /* fine */ }
    if (!hasPending) return
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void flushRef.current(), 1200)
    return () => window.clearTimeout(timer.current)
  }, [pending, notes, hasPending, key])

  // Leaving with taps still pending: send them now (keepalive-less best effort; they are on disk anyway).
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden' && hasPending && !inFlight.current) void flushRef.current() }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [hasPending])

  const bump = (k: ItadMetricKey, d: number) => {
    const shown = (data?.entry?.[k] ?? 0) + pending[k]
    if (shown + d < 0) return
    setPending((p) => ({ ...p, [k]: p[k] + d }))
  }
  // Typing a number sets the shown total; what is sent is still the difference from the saved value.
  const setTyped = (k: ItadMetricKey, raw: string) => {
    const base = data?.entry?.[k] ?? 0
    const n = raw === '' ? 0 : Math.max(0, Math.min(100000, Math.floor(Number(raw) || 0)))
    setPending((p) => ({ ...p, [k]: n - base }))
  }

  const dateLabel = data?.date ? new Date(`${data.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : ''
  const onLeave = !!data?.entry && data.entry.status !== 'SUBMITTED'
  const target = data?.stats.dailyDialTarget ?? 0
  const dials = (data?.entry?.callsDialed ?? 0) + pending.callsDialed

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col bg-card text-ink', standalone && 'h-dvh')}>
      {/* The header stays put; only the counters scroll. */}
      <header className="flex shrink-0 items-center gap-1 border-b border-line px-2.5 py-1.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[13px] font-semibold leading-tight"><span>Quick Log</span><span className="rounded-full bg-slate-100 px-1.5 py-px text-[10.5px] font-medium text-ink-muted dark:bg-white/10">{dateLabel || 'Today'}</span></div>
          <div className="truncate text-[11px] leading-tight text-ink-muted"><SaveLine save={save} hasPending={hasPending} /></div>
        </div>
        <button type="button" onClick={() => void load()} className="rounded-btn p-1 text-ink-muted hover:bg-slate-100 hover:text-ink" aria-label="Refresh" title="Refresh from the server"><RefreshCw size={14} /></button>
        {onDetach && <button type="button" onClick={onDetach} className="rounded-btn p-1 text-ink-muted hover:bg-slate-100 hover:text-ink max-md:hidden" aria-label="Open in its own window" title="Open in its own window"><ExternalLink size={14} /></button>}
        {onMinimize && <button type="button" onClick={onMinimize} className="rounded-btn p-1 text-ink-muted hover:bg-slate-100 hover:text-ink" aria-label="Minimize" title="Minimize (keeps what you typed)"><ChevronDown size={15} /></button>}
        {onClose && <button type="button" onClick={onClose} className="rounded-btn p-1 text-ink-muted hover:bg-slate-100 hover:text-ink" aria-label="Close" title="Close"><X size={15} /></button>}
      </header>

      {loadError && <p className="m-3 rounded-btn bg-danger/10 px-3 py-2 text-body-sm text-danger">{loadError} <button type="button" className="font-semibold underline" onClick={() => void load()}>Try again</button></p>}
      {!data && !loadError && <div className="flex flex-1 items-center justify-center p-8 text-ink-muted"><Loader2 size={20} className="animate-spin" /></div>}

      {data && onLeave && (
        <div className="m-2.5 rounded-btn border border-warning/40 bg-warning/10 px-3 py-2 text-body-sm text-ink">Today is marked <b>{data.entry!.status === 'ON_LEAVE' ? 'On Leave' : data.entry!.status === 'HOLIDAY' ? 'Holiday' : 'Off'}</b>. Open the <a href="/app/itad/log" target={standalone ? '_blank' : undefined} className="font-semibold text-primary underline">Daily Log</a> to change that; the counters are off until then.</div>
      )}

      {data && (
        <div className={cn('min-h-0 flex-1 overflow-y-auto px-2.5 py-1.5', onLeave && 'pointer-events-none opacity-50')}>
          {target > 0 && (
            <div className="mb-1 flex items-center gap-2 text-[11px] text-ink-muted">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10"><div className={cn('h-full rounded-full transition-[width]', dials >= target ? 'bg-success' : 'bg-primary')} style={{ width: `${Math.min(100, (dials / target) * 100)}%` }} /></div>
              <span className="tabular-nums">{dials}/{target} dials</span>
            </div>
          )}
          <ul className="divide-y divide-line/70">
            {ITAD_METRICS.map((m) => {
              const base = data.entry?.[m.key] ?? 0
              const shown = base + pending[m.key]
              const p = pending[m.key]
              return (
                <li key={m.key} className="flex items-center gap-2 py-[3px]">
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{m.label}</span>
                  {p !== 0 && <span className={cn('rounded-full px-1.5 text-[10px] font-semibold tabular-nums', p > 0 ? 'bg-primary/10 text-primary' : 'bg-warning/15 text-amber-700')}>{p > 0 ? `+${p}` : p}</span>}
                  <div className="inline-flex items-center rounded-btn border border-line">
                    <button type="button" onClick={() => bump(m.key, -1)} disabled={shown <= 0} className="flex h-8 w-8 items-center justify-center rounded-l-btn text-ink-muted hover:bg-slate-100 hover:text-ink disabled:opacity-30 active:bg-slate-200" aria-label={`${m.label}: one less`}><Minus size={14} /></button>
                    <input type="number" inputMode="numeric" min={0} max={100000} value={shown} onChange={(e) => setTyped(m.key, e.target.value)} onFocus={(e) => e.currentTarget.select()} className="h-8 w-11 border-x border-line bg-transparent text-center text-[14px] font-semibold tabular-nums text-ink focus:bg-primary/[0.06] focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" aria-label={`${m.label}: type the number`} />
                    <button type="button" onClick={() => bump(m.key, 1)} className="flex h-8 w-8 items-center justify-center rounded-r-btn text-primary hover:bg-primary/10 active:bg-primary/20" aria-label={`${m.label}: one more`}><Plus size={15} /></button>
                  </div>
                </li>
              )
            })}
          </ul>
          <div className="mt-1.5 border-t border-line pt-1.5">
            <button type="button" onClick={() => setNotesOpen((o) => !o)} className="flex w-full items-center gap-1.5 text-[12px] font-semibold text-ink-muted hover:text-ink">{notesOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}Notes / Comments{!notesOpen && notes.trim() && <span className="truncate font-normal text-ink-faint">· {notes.trim().slice(0, 40)}</span>}</button>
            {notesOpen && <textarea value={notes} onChange={(e) => { setNotes(e.target.value); setNotesDirty(true) }} rows={2} maxLength={2000} placeholder="What happened today, anything the lead should know…" className="mt-2 w-full resize-y rounded-btn border border-line bg-card px-2.5 py-2 text-[13px] text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10" />}
          </div>
        </div>
      )}

      {data && (
        <footer className="flex shrink-0 items-center gap-2 border-t border-line px-2.5 py-1.5">
          <a href="/app/itad/log" target={standalone ? '_blank' : undefined} onClick={!standalone ? onClose : undefined} className="text-[11.5px] font-medium text-ink-muted hover:text-ink">Full Daily Log</a>
          <button type="button" onClick={() => { window.clearTimeout(timer.current); void flushRef.current() }} disabled={!hasPending || save.kind === 'saving' || onLeave} className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-btn bg-primary px-2.5 text-[12.5px] font-semibold text-white hover:bg-primary/90 disabled:opacity-50">
            {save.kind === 'saving' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}{hasPending ? 'Save now' : 'Saved'}
          </button>
        </footer>
      )}
    </div>
  )
}

function SaveLine({ save, hasPending }: { save: SaveState; hasPending: boolean }) {
  if (save.kind === 'saving') return <span className="inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Saving…</span>
  if (save.kind === 'failed') return <span className="inline-flex items-center gap-1 text-danger"><CloudOff size={11} /> Not saved: {save.error}. Your taps are kept; it retries on Save now.</span>
  if (hasPending) return <span>Unsaved changes — saving in a moment</span>
  if (save.kind === 'saved') return <span className="inline-flex items-center gap-1 text-success"><Check size={11} /> Saved {save.at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
  return <span>Counts go straight into today’s Daily Log</span>
}
