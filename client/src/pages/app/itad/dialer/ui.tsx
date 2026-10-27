import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BellOff, ChevronDown, ChevronLeft, ChevronRight, Clock3, Download, FileSpreadsheet, FileText, Info, MessageSquarePlus, Phone, Pin } from 'lucide-react'
import { Modal } from '../../../../components/ui/Modal'
import { Button } from '../../../../components/ui/Button'
import { useToast } from '../../../../components/ui/Toast'
import { cn } from '../../../../lib/cn'
import { dialerApi, type DialerLead, type RegionCode } from '../../../../lib/dialerApi'
import { REGION_META, leadRegion, leadState, lastActivity, shortDate, daysSince } from '../../../../lib/dialer'
import { downloadLeads } from './exports'

/**
 * Small pieces shared by the Lead Dialer screens. Colour rules (ITAD, Oct 2026): red means act
 * now or overdue, amber means watch, green means open or good; everything else is neutral grey,
 * and the brand colour is only for buttons and the active tab.
 */

export function errMsg(e: unknown, fallback: string): string {
  const m = (e as { message?: string })?.message
  if (!m) return fallback
  try { return (JSON.parse(m) as { error?: string }).error || fallback } catch { return m }
}

/** ⓘ with the explanation on hover (or tap). The first view shows only numbers, labels and colour. */
export function InfoTip({ children, className, side = 'top' }: { children: ReactNode; className?: string; side?: 'top' | 'bottom' }) {
  const [open, setOpen] = useState(false)
  return (
    <span className={cn('relative inline-flex align-middle', className)} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" aria-label="What this means" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }} onBlur={() => setOpen(false)} className="rounded-full text-ink-muted/70 hover:text-ink focus:text-ink focus:outline-none">
        <Info size={13} />
      </button>
      {open && (
        <span role="tooltip" className={cn('absolute left-1/2 z-50 w-64 -translate-x-1/2 rounded-btn border border-line bg-card px-3 py-2 text-left text-[12px] font-normal normal-case leading-snug tracking-normal text-ink shadow-overlay', side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5')}>
          {children}
        </span>
      )}
    </span>
  )
}

export function RegionBadge({ lead, region, now }: { lead?: DialerLead; region?: RegionCode | null; now?: Date }) {
  const r = region ?? (lead ? leadRegion(lead, now ?? new Date()) : null)
  if (!r) return <span className="rounded px-1.5 py-0.5 text-[11px] font-bold text-ink-muted ring-1 ring-line" title="No state yet">?</span>
  const verify = lead?.verifyZone && !lead.zoneOverride
  const az = lead?.region === 'AZ' && !lead.zoneOverride
  return (
    <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-ink" title={verify ? 'This state sits in two time zones: check the city' : az ? 'Arizona: Pacific hours in US summer, Mountain in winter' : REGION_META[r].name}>
      {r}{verify ? '?' : az ? '*' : ''}
    </span>
  )
}

/** Status pill: neutral, except positive (green). */
export function StatusPill({ lead }: { lead: Pick<DialerLead, 'status' | 'stage'> }) {
  return <span className={cn('inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold', lead.stage >= 4 ? 'bg-success/10 text-success' : 'bg-slate-100 text-ink-muted')}>{lead.status}</span>
}

export function Panel({ title, info, action, children, className }: { title?: ReactNode; info?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-card border border-line bg-card p-4 sm:p-5', className)}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="flex items-center gap-1.5 text-label-md uppercase tracking-wide text-ink-muted">{title}{info && <InfoTip>{info}</InfoTip>}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

// ------------------------------------------------------------------ numbered pages

export function usePaged<T>(items: T[], initialSize = 25) {
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(initialSize)
  const pages = Math.max(1, Math.ceil(items.length / size))
  useEffect(() => { if (page > pages) setPage(pages) }, [page, pages])
  const cur = Math.min(page, pages)
  return { rows: items.slice((cur - 1) * size, cur * size), page: cur, pages, size, setPage, setSize: (n: number) => { setSize(n); setPage(1) }, total: items.length }
}

/** 1 2 3 … pages with a 25 / 50 / 100 choice, used on every list. */
export function Pager({ p, className }: { p: ReturnType<typeof usePaged<unknown>>; className?: string }) {
  if (p.total <= 25) return null
  const nums: (number | '…')[] = []
  for (let i = 1; i <= p.pages; i++) {
    if (i === 1 || i === p.pages || Math.abs(i - p.page) <= 1) nums.push(i)
    else if (nums[nums.length - 1] !== '…') nums.push('…')
  }
  const from = (p.page - 1) * p.size + 1
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-2 pt-3 text-body-sm', className)}>
      <span className="text-ink-muted">{from.toLocaleString()} to {Math.min(p.total, p.page * p.size).toLocaleString()} of {p.total.toLocaleString()}</span>
      <div className="flex items-center gap-1">
        <button type="button" disabled={p.page === 1} onClick={() => p.setPage(p.page - 1)} className="rounded-btn p-1.5 text-ink-muted hover:bg-slate-100 disabled:opacity-40" aria-label="Previous page"><ChevronLeft size={15} /></button>
        {nums.map((n, i) => n === '…' ? <span key={`e${i}`} className="px-1 text-ink-muted">…</span> : (
          <button key={n} type="button" onClick={() => p.setPage(n)} className={cn('min-w-[30px] rounded-btn px-2 py-1 font-semibold tabular-nums', n === p.page ? 'bg-primary text-white' : 'text-ink hover:bg-slate-100')}>{n}</button>
        ))}
        <button type="button" disabled={p.page === p.pages} onClick={() => p.setPage(p.page + 1)} className="rounded-btn p-1.5 text-ink-muted hover:bg-slate-100 disabled:opacity-40" aria-label="Next page"><ChevronRight size={15} /></button>
        <select value={p.size} onChange={(e) => p.setSize(Number(e.target.value))} className="ml-2 h-8 rounded-btn border border-line bg-card px-1.5 text-body-sm text-ink" aria-label="Rows per page">
          {[25, 50, 100].map((n) => <option key={n} value={n}>{n} per page</option>)}
        </select>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ actions

const inputCls = 'h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'
export const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)

type ActionKind = 'CALL_LATER' | 'SNOOZE'
/** Call now · Call later · Snooze · Log note. Snoozes and notes survive new imports. */
export function LeadActions({ lead, onDone, compact, onNote }: { lead: Pick<DialerLead, 'id' | 'company' | 'phone'>; onDone: () => void; compact?: boolean; onNote?: () => void }) {
  const { addToast } = useToast()
  const [open, setOpen] = useState<ActionKind | 'NOTE' | null>(null)
  const [busy, setBusy] = useState(false)
  async function callNow() {
    setBusy(true)
    try {
      await dialerApi.action(lead.id, { kind: 'CALL_NOW' })
      if (lead.phone) { try { await navigator.clipboard?.writeText(lead.phone) } catch { /* clipboard blocked */ } }
      addToast({ type: 'success', message: lead.phone ? `Logged. ${lead.phone} copied. It comes back tomorrow if the CRM still shows no update.` : 'Logged. It comes back tomorrow if the CRM still shows no update.' })
      onDone()
    } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not log the call') }) } finally { setBusy(false) }
  }
  const btn = cn('inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-btn border px-2.5 text-body-sm font-semibold transition-colors', compact && 'h-7 px-2')
  return (
    <div className={cn('flex items-center gap-1.5', compact ? 'flex-nowrap' : 'flex-wrap')} onClick={(e) => e.stopPropagation()}>
      <button type="button" disabled={busy} onClick={callNow} className={cn(btn, 'border-primary bg-primary text-white hover:bg-primary/90')}><Phone size={13} />Call now</button>
      <button type="button" onClick={() => setOpen('CALL_LATER')} className={cn(btn, 'border-line bg-card text-ink hover:bg-slate-50')}><Clock3 size={13} />Call later</button>
      <button type="button" onClick={() => setOpen('SNOOZE')} className={cn(btn, 'border-line bg-card text-ink hover:bg-slate-50')}><BellOff size={13} />Snooze</button>
      <button type="button" onClick={() => (onNote ? onNote() : setOpen('NOTE'))} className={cn(btn, 'border-line bg-card text-ink hover:bg-slate-50')}><MessageSquarePlus size={13} />Log note</button>
      {open === 'NOTE' && <NoteModal lead={lead} onClose={() => setOpen(null)} onDone={() => { setOpen(null); onDone() }} />}
      {open && open !== 'NOTE' && <ActionModal lead={lead} kind={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); onDone() }} />}
    </div>
  )
}

function ActionModal({ lead, kind, onClose, onDone }: { lead: Pick<DialerLead, 'id' | 'company'>; kind: ActionKind; onClose: () => void; onDone: () => void }) {
  const { addToast } = useToast()
  const now = new Date()
  const [when, setWhen] = useState(toLocalInput(new Date(now.getTime() + (kind === 'SNOOZE' ? 3 * 86400000 : 2 * 3600000))))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const title = kind === 'CALL_LATER' ? 'Call later' : 'Snooze'
  async function save(at?: Date) {
    setBusy(true)
    try {
      const t = at ?? new Date(when)
      await dialerApi.action(lead.id, { kind, at: t.toISOString(), note: note.trim() || undefined })
      addToast({ type: 'success', message: kind === 'CALL_LATER' ? `Call back set for ${t.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.` : `Snoozed until ${t.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}.` })
      onDone()
    } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not save') }) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={`${title} · ${lead.company}`} size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={() => save()}>Save</Button></>}>
      <div className="space-y-3">
        {kind === 'SNOOZE' && (
          <div className="flex flex-wrap gap-1.5">
            {[1, 3, 7, 14, 30].map((d) => (
              <button key={d} type="button" disabled={busy} onClick={() => save(new Date(now.getTime() + d * 86400000))} className="rounded-full border border-line px-3 py-1 text-body-sm font-medium text-ink hover:border-primary hover:text-primary">{d === 1 ? '1 day' : d === 7 ? '1 week' : d === 14 ? '2 weeks' : `${d} days`}</button>
            ))}
          </div>
        )}
        <label className="block">
          <span className="mb-1 block text-body-sm font-semibold text-ink">{kind === 'CALL_LATER' ? 'Call back at (your time)' : 'Hide until'}</span>
          <input type="datetime-local" value={when} min={toLocalInput(now)} onChange={(e) => setWhen(e.target.value)} className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1 block text-body-sm font-semibold text-ink">Reason (optional)</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} className="w-full rounded-btn border border-line bg-card px-3 py-2 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10" />
        </label>
      </div>
    </Modal>
  )
}

/** A note with an optional next-action date and pin, from a list (the side panel has its own box). */
export function NoteModal({ lead, onClose, onDone }: { lead: Pick<DialerLead, 'id' | 'company'>; onClose: () => void; onDone: () => void }) {
  const { addToast } = useToast()
  const [text, setText] = useState('')
  const [next, setNext] = useState('')
  const [pinned, setPinned] = useState(false)
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    try {
      await dialerApi.addNote(lead.id, { text: text.trim(), pinned, nextActionAt: next ? new Date(next).toISOString() : null })
      addToast({ type: 'success', message: next ? 'Note saved. The lead comes back in follow-ups on that date.' : 'Note saved.' })
      onDone()
    } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not save the note') }) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={`Log note · ${lead.company}`} size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy || !text.trim()} onClick={save}>Save note</Button></>}>
      <NoteFields text={text} setText={setText} next={next} setNext={setNext} pinned={pinned} setPinned={setPinned} autoFocus />
    </Modal>
  )
}

export function NoteFields({ text, setText, next, setNext, pinned, setPinned, autoFocus }: { text: string; setText: (v: string) => void; next: string; setNext: (v: string) => void; pinned: boolean; setPinned: (v: boolean) => void; autoFocus?: boolean }) {
  const quick = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(19, 0, 0, 0); setNext(toLocalInput(d)) }
  return (
    <div className="space-y-2.5">
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={4000} autoFocus={autoFocus} placeholder="What happened, what was agreed…" className="w-full rounded-btn border border-line bg-card px-3 py-2 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10" />
      <div className="flex flex-wrap items-center gap-1.5 text-body-sm">
        <span className="text-ink-muted">Next action</span>
        {[1, 3, 7].map((d) => <button key={d} type="button" onClick={() => quick(d)} className="rounded-full border border-line px-2.5 py-0.5 text-ink hover:border-primary hover:text-primary">in {d} day{d > 1 ? 's' : ''}</button>)}
        <input type="datetime-local" value={next} onChange={(e) => setNext(e.target.value)} className="h-8 rounded-btn border border-line bg-card px-2 text-body-sm text-ink" aria-label="Next action date" />
        {next && <button type="button" onClick={() => setNext('')} className="text-ink-muted hover:text-ink">clear</button>}
      </div>
      <label className="flex items-center gap-2 text-body-sm text-ink"><input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="h-4 w-4 accent-primary" /><Pin size={13} /> Pin to the top of the lead</label>
    </div>
  )
}

/** A list of leads (e.g. one state's leads in one status), each opening the side panel. */
/**
 * Download a list of leads (exactly the leads shown, after every filter) as an Excel sheet or a
 * CSV, phone first, to upload to the predictive dialer.
 */
export function DownloadLeads({ title, leads, now, showOwner, label = 'Download' }: { title: string; leads: DialerLead[]; now: Date; showOwner?: boolean; label?: string }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc, true)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc, true) }
  }, [open])
  const pick = (format: 'xlsx' | 'csv') => { setOpen(false); downloadLeads(title, leads, now, !!showOwner, format) }
  const item = 'flex w-full items-center gap-2 px-3 py-2 text-left text-body-sm text-ink hover:bg-slate-50'
  return (
    <div ref={box} className="relative">
      <Button size="sm" variant="secondary" leadingIcon={<Download size={14} />} trailingIcon={<ChevronDown size={14} />} disabled={!leads.length} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        {label}
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-60 overflow-hidden rounded-card border border-line bg-card py-1 shadow-overlay">
          <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase text-ink-muted">{leads.length.toLocaleString()} lead{leads.length === 1 ? '' : 's'}</p>
          <button type="button" role="menuitem" className={item} onClick={() => pick('xlsx')}><FileSpreadsheet size={15} className="text-success" />Excel (.xlsx)</button>
          <button type="button" role="menuitem" className={item} onClick={() => pick('csv')}><FileText size={15} className="text-ink-muted" />CSV (.csv)</button>
        </div>
      )}
    </div>
  )
}

export function LeadsListModal({ title, leads, now, onClose, onOpen, showOwner }: { title: string; leads: DialerLead[]; now: Date; onClose: () => void; onOpen: (id: string, ids: string[]) => void; showOwner?: boolean }) {
  const p = usePaged(leads)
  const ids = leads.map((l) => l.id)
  return (
    <Modal open onClose={onClose} title={`${title} · ${leads.length}`} size="xl">
      {leads.length === 0 ? <p className="py-6 text-center text-body-md text-ink-muted">No leads here.</p> : (
        <div className="max-h-[65vh] overflow-y-auto">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-body-sm text-ink-muted">Download these {leads.length.toLocaleString()} leads to upload to the predictive dialer.</span>
            <DownloadLeads title={title} leads={leads} now={now} showOwner={showOwner} />
          </div>
          <LeadTable leads={p.rows} now={now} showOwner={showOwner} onOpen={(id) => onOpen(id, ids)} />
          <Pager p={p} />
        </div>
      )}
    </Modal>
  )
}

/** The standard lead rows: name, phone, place, region, status, last activity; a pinned note shows on hover. */
export function LeadTable({ leads, now, showOwner, onOpen, extra }: { leads: DialerLead[]; now: Date; showOwner?: boolean; onOpen: (id: string) => void; extra?: { header: string; cell: (l: DialerLead) => ReactNode } }) {
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-body-sm">
        <thead className="sticky top-0 bg-card text-[11px] uppercase text-ink-muted">
          <tr><th className="px-2 py-2">Lead</th><th className="px-2">Phone</th><th className="px-2">City / State</th><th className="px-2">Region</th><th className="px-2">Status</th><th className="px-2">Last activity</th>{showOwner && <th className="px-2">Rep</th>}{extra && <th className="px-2">{extra.header}</th>}</tr>
        </thead>
        <tbody className="divide-y divide-line">
          {leads.map((l) => (
            <tr key={l.id} onClick={() => onOpen(l.id)} className="cursor-pointer hover:bg-slate-50" title={l.pinnedNote ? `Pinned note: ${l.pinnedNote}` : undefined}>
              <td className="px-2 py-2">
                <p className="flex items-center gap-1 font-semibold text-ink">{l.company}{l.pinnedNote && <Pin size={11} className="shrink-0 text-ink-muted" />}{l.needsCrmUpdate && <span className="rounded bg-warning/10 px-1 text-[10px] font-bold text-warning" title={`Update Earthzone: ${l.crmUpdateWhat ?? ''}`}>EZ</span>}</p>
                {l.contactName && <p className="text-ink-muted">{l.contactName}</p>}
              </td>
              <td className="whitespace-nowrap px-2 tabular-nums text-ink">{l.phone ?? '—'}</td>
              <td className="px-2 text-ink">{[l.city, leadState(l)].filter(Boolean).join(', ') || '—'}</td>
              <td className="px-2"><RegionBadge lead={l} now={now} /></td>
              <td className="px-2"><StatusPill lead={l} /></td>
              <td className="whitespace-nowrap px-2 text-ink-muted">{shortDate(lastActivity(l))} · {daysSince(lastActivity(l), now)}d</td>
              {showOwner && <td className="px-2 text-ink-muted">{l.ownerName}</td>}
              {extra && <td className="px-2" onClick={(e) => e.stopPropagation()}>{extra.cell(l)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
