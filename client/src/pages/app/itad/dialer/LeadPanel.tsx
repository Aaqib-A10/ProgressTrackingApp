import { useEffect, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, Copy, Download, ExternalLink, Pencil, Pin, PinOff, X } from 'lucide-react'
import { Button } from '../../../../components/ui/Button'
import { useToast } from '../../../../components/ui/Toast'
import { cn } from '../../../../lib/cn'
import { dialerApi, type DialerLead, type DialerSettings, type LeadDetail, type LeadEdit } from '../../../../lib/dialerApi'
import { REGIONS, REGION_META, US_STATES, daysInStatus, leadRegion, leadState, regionWindow, shortDate } from '../../../../lib/dialer'
import { LeadActions, NoteFields, RegionBadge, StatusPill, errMsg } from './ui'
import { downloadNotes } from './exports'

/**
 * One lead, in a panel that slides in from the right so the rep keeps their place in the list.
 * Header (name, company, region with the lead's local time and whether it is open, status and
 * stage); collapsible groups: Contact, Company, Status, Added here, Notes, Timeline; actions
 * (Call now, Call later, Snooze, Log note) and arrows to the next lead.
 *
 * Fields from Earthzone (the CRM) are read-only: the next import refreshes them. Fields added
 * here are kept by the dialer and never touched by an import; the state is the one CRM field a
 * rep can correct here.
 */

const KIND_LABEL: Record<string, string> = { CALL_NOW: 'Called', CALL_LATER: 'Call back set', SNOOZE: 'Snoozed', CLEAR: 'Snooze cleared', STATE_FIX: 'State corrected', ZONE: 'Zone set', BACK_TO_LEADGEN: 'Back to lead gen', DUPLICATE: 'Duplicate', EDIT: 'Edited', CRM_DONE: 'Done in Earthzone', BULK_FILL: 'Bulk fill', KEEP: 'Kept (backlog)', DROP: 'Dropped from follow-ups', UNDROP: 'Back in follow-ups' }
const fmt = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export function LeadPanel({ id, ids, lookup, now, settings, meId, onNavigate, onClose, onChanged }: {
  id: string
  ids: string[]
  lookup: (id: string) => DialerLead | undefined
  now: Date
  settings: DialerSettings
  meId: string
  onNavigate: (id: string) => void
  onClose: () => void
  onChanged: () => void
}) {
  const { addToast } = useToast()
  const [d, setD] = useState<LeadDetail | null>(null)
  const [noteFocus, setNoteFocus] = useState(0)
  const load = () => { dialerApi.lead(id).then(setD).catch((e) => addToast({ type: 'error', message: errMsg(e, 'Could not open the lead') })) }
  useEffect(() => { setD(null); load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  const changed = () => { load(); onChanged() }
  const idx = ids.indexOf(id)
  const prev = idx > 0 ? ids[idx - 1] : null
  const next = idx >= 0 && idx < ids.length - 1 ? ids[idx + 1] : null
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select')) return
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowDown' && next) onNavigate(next)
      if (e.key === 'ArrowUp' && prev) onNavigate(prev)
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [next, prev, onClose, onNavigate])

  const fromList = lookup(id)
  const l: DialerLead | null = d ? { ownerName: fromList?.ownerName ?? '', actionCount: d.actions.length, noteCount: d.notes.length, pinnedNote: d.notes.find((n) => n.pinned)?.text ?? null, ...d.lead } as DialerLead : fromList ?? null
  const region = l ? leadRegion(l, now) : null
  const win = region ? regionWindow(region, settings, now) : null

  async function edit(body: LeadEdit, done: string) {
    try { await dialerApi.fix(id, body); addToast({ type: 'success', message: done }); changed() } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not save') }) }
  }

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={l?.company ?? 'Lead'}>
      <div className="absolute inset-0 bg-ink/20" onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-[500px] flex-col bg-card shadow-overlay animate-[slideIn_.18s_ease-out]">
        <style>{'@keyframes slideIn{from{transform:translateX(24px);opacity:.4}to{transform:none;opacity:1}}'}</style>
        {/* Header */}
        <div className="border-b border-line px-5 pb-3 pt-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="truncate text-headline-md font-bold text-ink">{l?.company ?? 'Loading…'}</h2>
              {l?.contactName && <p className="text-body-sm text-ink-muted">{l.contactName}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              {ids.length > 1 && <span className="mr-1 text-[11px] tabular-nums text-ink-muted">{idx + 1} of {ids.length}</span>}
              <button type="button" disabled={!prev} onClick={() => prev && onNavigate(prev)} className="rounded-btn p-1.5 text-ink-muted hover:bg-slate-100 disabled:opacity-30" aria-label="Previous lead" title="Previous lead (↑)"><ChevronLeft size={18} /></button>
              <button type="button" disabled={!next} onClick={() => next && onNavigate(next)} className="rounded-btn p-1.5 text-ink-muted hover:bg-slate-100 disabled:opacity-30" aria-label="Next lead" title="Next lead (↓)"><ChevronRight size={18} /></button>
              <button type="button" onClick={onClose} className="rounded-btn p-1.5 text-ink-muted hover:bg-slate-100" aria-label="Close"><X size={18} /></button>
            </div>
          </div>
          {l && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-body-sm">
              <RegionBadge lead={l} now={now} />
              {win && <span className="text-ink-muted">{win.localTime} there</span>}
              {win && <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', win.open ? (win.closingSoon ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success') : 'bg-slate-100 text-ink-muted')}>{win.open ? (win.prime ? 'Open · prime time' : win.closingSoon ? 'Closing soon' : 'Open now') : 'Closed now'}</span>}
              <StatusPill lead={l} />
              <span className="text-[11px] text-ink-muted">Stage {l.stage}</span>
            </div>
          )}
          {l && <div className="mt-3"><LeadActions lead={l} onDone={changed} onNote={() => setNoteFocus((n) => n + 1)} /></div>}
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {!l || !d ? <div className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-6 animate-pulse rounded bg-slate-100" />)}</div> : (
            <>
              {l.needsCrmUpdate && (
                <div className="flex items-center justify-between gap-3 rounded-btn border border-warning/40 bg-warning/5 px-3 py-2 text-body-sm">
                  <span className="text-ink"><b>Update Earthzone:</b> {l.crmUpdateWhat || 'details added here'}</span>
                  <Button size="sm" variant="secondary" onClick={() => edit({ crmDone: true }, 'Marked as done in Earthzone.')}>Done in Earthzone</Button>
                </div>
              )}

              <Group name="contact" title="Contact" tag="from CRM">
                <Field k="Phone" v={l.phone} copy />
                <Field k="Email" v={l.email} link={l.email ? `mailto:${l.email}` : undefined} />
                <Field k="Website" v={l.website} link={l.website ? (/^https?:/.test(l.website) ? l.website : `https://${l.website}`) : undefined} />
                <Field k="City" v={l.city} />
                <div className="flex items-center gap-2 py-1">
                  <span className="w-28 shrink-0 text-ink-muted">State</span>
                  <span className="text-ink">{leadState(l) ?? 'Unknown'}</span>
                  {l.stateOverride && <Tag tone="here">corrected here</Tag>}
                  <select value="" onChange={(e) => e.target.value && edit({ state: e.target.value }, `State set to ${e.target.value}.`)} className="ml-auto h-7 rounded-btn border border-line bg-card px-1.5 text-[12px] text-ink" aria-label="Correct the state">
                    <option value="">{leadState(l) ? 'Correct…' : 'Set state…'}</option>
                    {l.suggestedState && <option value={l.suggestedState}>{l.suggestedState} (from area code)</option>}
                    {US_STATES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </div>
                {(l.verifyZone || l.zoneOverride) && (
                  <div className="flex items-center gap-2 py-1">
                    <span className="w-28 shrink-0 text-ink-muted">Time zone</span>
                    <div className="flex gap-1">
                      {REGIONS.map((r) => <button key={r} type="button" onClick={() => edit({ zone: l.zoneOverride === r ? null : r }, `${REGION_META[r].name} time.`)} className={cn('rounded px-1.5 py-0.5 text-[11px] font-bold ring-1 ring-line', l.zoneOverride === r ? 'bg-ink text-white ring-ink' : 'text-ink-muted hover:text-ink')}>{r}</button>)}
                    </div>
                  </div>
                )}
                <p className="pt-1 text-[11px] text-ink-muted">Change these in Earthzone; the next import brings them here.</p>
              </Group>

              <Group name="company" title="Company" tag="from CRM" defaultOpen={false}>
                <Field k="Industry" v={l.industry} />
                <Field k="Size" v={l.companySize} />
                <Field k="Source" v={l.source} />
                <Field k="List" v={l.listName === 'CRM' ? 'CRM (SMB leads)' : l.listName} />
                <Field k="CRM lead ID" v={l.externalId} copy />
              </Group>

              <Group name="status" title="Status">
                <div className="flex flex-wrap items-center gap-2 py-1"><StatusPill lead={l} /><span className="text-ink-muted">{daysInStatus(l, now)} days in this status</span></div>
                {(l.snoozeUntil && new Date(l.snoozeUntil) > now) && <p className="py-0.5 text-ink">Snoozed until {shortDate(l.snoozeUntil)}</p>}
                {l.callLaterAt && <p className="py-0.5 text-ink">Call back {new Date(l.callLaterAt).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>}
                {l.followUpDropped && <p className="py-0.5 text-ink-muted">Dropped from follow-ups until the status changes. <button type="button" className="font-semibold text-primary" onClick={() => dialerApi.followUpBulk([l.id], 'UNDROP').then(changed)}>Undo</button></p>}
                {(l.snoozeUntil || l.callLaterAt) && <button type="button" className="text-body-sm font-semibold text-primary" onClick={() => dialerApi.action(l.id, { kind: 'CLEAR' }).then(changed)}>Clear snooze / call back</button>}
                <p className="mb-1 mt-2 text-[11px] font-semibold uppercase text-ink-muted">Status path since Metriq started tracking</p>
                <ol className="flex flex-wrap items-center gap-1.5">
                  {d.changes.map((c, i) => (
                    <li key={c.id} className="flex items-center gap-1.5">
                      {i > 0 && <span className="text-ink-muted">→</span>}
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-ink">{c.toStatus}</span>
                      <span className="text-[11px] text-ink-muted">{shortDate(c.createdAt)}</span>
                    </li>
                  ))}
                </ol>
              </Group>

              <AddedHere lead={l} settings={settings} onSave={edit} />

              <NotesGroup lead={l} notes={d.notes} meId={meId} settings={settings} focusKey={noteFocus} onChanged={changed} />

              <Group name="timeline" title="Timeline" defaultOpen={false}>
                <Timeline d={d} createdAt={l.createdAt} />
              </Group>
            </>
          )}
        </div>
      </aside>
    </div>
  )
}

/** A collapsible group; open or closed is remembered per group. */
function Group({ name, title, tag, defaultOpen = true, action, children, open: forced }: { name: string; title: string; tag?: 'from CRM' | 'added here'; defaultOpen?: boolean; action?: ReactNode; children: ReactNode; open?: number }) {
  const key = `dialer.panel.${name}`
  const [open, setOpen] = useState(() => { try { const v = localStorage.getItem(key); return v == null ? defaultOpen : v === '1' } catch { return defaultOpen } })
  useEffect(() => { if (forced) setOpen(true) }, [forced])
  const toggle = () => { const v = !open; setOpen(v); try { localStorage.setItem(key, v ? '1' : '0') } catch { /* ignore */ } }
  return (
    <section className="rounded-btn border border-line">
      <div className="flex items-center gap-2 px-3 py-2">
        <button type="button" onClick={toggle} className="flex flex-1 items-center gap-2 text-left">
          <ChevronDown size={15} className={cn('text-ink-muted transition-transform', !open && '-rotate-90')} />
          <span className="text-body-md font-semibold text-ink">{title}</span>
          {tag && <Tag tone={tag === 'from CRM' ? 'crm' : 'here'}>{tag}</Tag>}
        </button>
        {action}
      </div>
      {open && <div className="border-t border-line px-3 py-2 text-body-sm">{children}</div>}
    </section>
  )
}

function Tag({ tone, children }: { tone: 'crm' | 'here'; children: ReactNode }) {
  return <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase', tone === 'crm' ? 'bg-slate-100 text-ink-muted' : 'bg-primary/10 text-primary')}>{children}</span>
}

function Field({ k, v, copy, link }: { k: string; v: string | null | undefined; copy?: boolean; link?: string }) {
  const { addToast } = useToast()
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="w-28 shrink-0 text-ink-muted">{k}</span>
      {v ? (link ? <a href={link} target="_blank" rel="noreferrer noopener" className="inline-flex min-w-0 items-center gap-1 break-all text-primary hover:underline">{v}<ExternalLink size={11} className="shrink-0" /></a> : <span className="min-w-0 break-words text-ink">{v}</span>) : <span className="text-ink-muted">—</span>}
      {v && copy && <button type="button" onClick={() => navigator.clipboard?.writeText(v).then(() => addToast({ type: 'success', message: `${v} copied.` })).catch(() => {})} className="rounded p-1 text-ink-muted hover:bg-slate-100 hover:text-ink" aria-label={`Copy ${k}`}><Copy size={12} /></button>}
    </div>
  )
}

const ADDED: { k: keyof Pick<DialerLead, 'phone2' | 'email2' | 'linkedin' | 'decisionMaker' | 'bestTime'>; label: string; placeholder: string }[] = [
  { k: 'phone2', label: 'Second phone', placeholder: '(555) 123-4567' },
  { k: 'email2', label: 'Second email', placeholder: 'name@company.com' },
  { k: 'linkedin', label: 'LinkedIn', placeholder: 'linkedin.com/in/…' },
  { k: 'decisionMaker', label: 'Decision maker', placeholder: 'Name and title' },
  { k: 'bestTime', label: 'Best time to call', placeholder: 'e.g. Tue to Thu mornings' },
]

function AddedHere({ lead, settings, onSave }: { lead: DialerLead; settings: DialerSettings; onSave: (b: LeadEdit, done: string) => Promise<void> }) {
  const init = () => ({ phone2: lead.phone2 ?? '', email2: lead.email2 ?? '', linkedin: lead.linkedin ?? '', decisionMaker: lead.decisionMaker ?? '', bestTime: lead.bestTime ?? '', tags: lead.tags.join(', ') })
  const [v, setV] = useState(init)
  const [crm, setCrm] = useState(true)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setV(init()) }, [lead.id, lead.phone2, lead.email2, lead.linkedin, lead.decisionMaker, lead.bestTime, lead.tags.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(v) !== JSON.stringify(init())
  const filled = ADDED.filter((a) => lead[a.k]).length + (lead.tags.length ? 1 : 0)
  async function save() {
    setBusy(true)
    await onSave({ ...Object.fromEntries(ADDED.map((a) => [a.k, v[a.k].trim() || null])), tags: v.tags.split(',').map((t) => t.trim()).filter(Boolean), needsCrm: settings.earthzoneTick ? crm : false }, 'Saved. Imports never change these.')
    setBusy(false)
  }
  return (
    <Group name="added" title={`Added here${filled ? ` · ${filled}` : ''}`} tag="added here" defaultOpen={false}>
      <div className="space-y-1.5 py-1">
        {ADDED.map((a) => (
          <label key={a.k} className="flex items-center gap-2">
            <span className="w-28 shrink-0 text-ink-muted">{a.label}</span>
            <input value={v[a.k]} onChange={(e) => setV({ ...v, [a.k]: e.target.value })} placeholder={a.placeholder} maxLength={a.k === 'linkedin' ? 300 : 120} className="h-8 min-w-0 flex-1 rounded-btn border border-line bg-card px-2 text-body-sm text-ink focus:border-primary focus:outline-none" />
          </label>
        ))}
        <label className="flex items-center gap-2">
          <span className="w-28 shrink-0 text-ink-muted">Tags</span>
          <input value={v.tags} onChange={(e) => setV({ ...v, tags: e.target.value })} placeholder="hot, quote sent" className="h-8 min-w-0 flex-1 rounded-btn border border-line bg-card px-2 text-body-sm text-ink focus:border-primary focus:outline-none" />
        </label>
        {dirty && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            {settings.earthzoneTick ? <label className="flex items-center gap-2 text-ink"><input type="checkbox" checked={crm} onChange={(e) => setCrm(e.target.checked)} className="h-4 w-4 accent-primary" /> Also needs adding in Earthzone</label> : <span />}
            <Button size="sm" disabled={busy} onClick={save}>Save</Button>
          </div>
        )}
        <p className="text-[11px] text-ink-muted">Kept by the dialer and never overwritten by an import.</p>
      </div>
    </Group>
  )
}

function NotesGroup({ lead, notes, meId, settings, focusKey, onChanged }: { lead: DialerLead; notes: LeadDetail['notes']; meId: string; settings: DialerSettings; focusKey: number; onChanged: () => void }) {
  const { addToast } = useToast()
  const [text, setText] = useState('')
  const [next, setNext] = useState('')
  const [pinned, setPinned] = useState(false)
  const [crm, setCrm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  async function add() {
    setBusy(true)
    try {
      await dialerApi.addNote(lead.id, { text: text.trim(), pinned, nextActionAt: next ? new Date(next).toISOString() : null, needsCrm: crm })
      setText(''); setNext(''); setPinned(false); setCrm(false)
      addToast({ type: 'success', message: next ? 'Note saved. The lead comes back in follow-ups on that date.' : 'Note saved.' })
      onChanged()
    } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not save the note') }) } finally { setBusy(false) }
  }
  async function update(id: string, body: { text?: string; pinned?: boolean }) {
    try { await dialerApi.updateNote(id, body); setEditing(null); onChanged() } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not save') }) }
  }
  async function exportLead() {
    try { const r = await dialerApi.notes({ leadId: lead.id }); downloadNotes(`notes-${lead.company.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`, r.notes) } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not export') }) }
  }
  return (
    <Group name="notes" title={`Notes${notes.length ? ` · ${notes.length}` : ''}`} open={focusKey} action={notes.length ? <button type="button" onClick={exportLead} className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink-muted hover:text-ink" title="Export this lead's notes"><Download size={12} /> Export</button> : undefined}>
      <div className="space-y-2 py-1">
        <NoteFields key={focusKey} text={text} setText={setText} next={next} setNext={setNext} pinned={pinned} setPinned={setPinned} autoFocus={focusKey > 0} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          {settings.earthzoneTick ? <label className="flex items-center gap-2 text-ink"><input type="checkbox" checked={crm} onChange={(e) => setCrm(e.target.checked)} className="h-4 w-4 accent-primary" /> Also needs adding in Earthzone</label> : <span />}
          <Button size="sm" disabled={busy || !text.trim()} onClick={add}>Save note</Button>
        </div>
        <ul className="space-y-2 pt-1">
          {notes.map((n) => (
            <li key={n.id} className={cn('rounded-btn border px-3 py-2', n.pinned ? 'border-primary/30 bg-primary/[0.03]' : 'border-line')}>
              {editing?.id === n.id ? (
                <div className="space-y-1.5">
                  <textarea value={editing.text} onChange={(e) => setEditing({ id: n.id, text: e.target.value })} rows={3} maxLength={4000} className="w-full rounded-btn border border-line bg-card px-2 py-1.5 text-body-sm text-ink focus:border-primary focus:outline-none" />
                  <div className="flex justify-end gap-2"><button type="button" onClick={() => setEditing(null)} className="text-ink-muted">Cancel</button><Button size="sm" disabled={!editing.text.trim()} onClick={() => update(n.id, { text: editing.text.trim() })}>Save</Button></div>
                </div>
              ) : (
                <>
                  <p className="whitespace-pre-wrap break-words text-ink">{n.text}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-muted">
                    {n.pinned && <span className="inline-flex items-center gap-0.5 font-semibold text-primary"><Pin size={10} />Pinned</span>}
                    <span>{n.author} · {fmt(n.createdAt)}</span>
                    {n.editedAt && <span title={`Edited ${fmt(n.editedAt)}`}>edited</span>}
                    {n.nextActionAt && <span className="font-semibold text-ink">Next action {fmt(n.nextActionAt)}</span>}
                    <span className="ml-auto flex gap-1">
                      <button type="button" onClick={() => update(n.id, { pinned: !n.pinned })} className="rounded p-0.5 hover:text-ink" title={n.pinned ? 'Unpin' : 'Pin to the top'}>{n.pinned ? <PinOff size={12} /> : <Pin size={12} />}</button>
                      {n.authorId === meId && <button type="button" onClick={() => setEditing({ id: n.id, text: n.text })} className="rounded p-0.5 hover:text-ink" title="Edit (shows as edited)"><Pencil size={12} /></button>}
                    </span>
                  </div>
                </>
              )}
            </li>
          ))}
          {notes.length === 0 && <li className="text-ink-muted">No notes yet.</li>}
        </ul>
      </div>
    </Group>
  )
}

/** Imports, status changes, notes, follow-ups and snoozes in one list, newest first. */
function Timeline({ d, createdAt }: { d: LeadDetail; createdAt: string }) {
  type Item = { at: string; what: string; detail?: string | null; who?: string }
  const items: Item[] = [
    ...d.changes.map((c) => ({ at: c.createdAt, what: c.fromStatus ? `Status ${c.fromStatus} → ${c.toStatus}` : `First imported as ${c.toStatus}`, who: 'Import' })),
    ...d.actions.map((a) => ({ at: a.createdAt, what: KIND_LABEL[a.kind] ?? a.kind, detail: [a.at ? `for ${fmt(a.at)}` : null, a.note].filter(Boolean).join(' · ') || null, who: a.user.name })),
    ...d.notes.map((n) => ({ at: n.createdAt, what: 'Note', detail: n.text.length > 140 ? `${n.text.slice(0, 139)}…` : n.text, who: n.author })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1))
  if (!d.changes.length) items.push({ at: createdAt, what: 'First imported', who: 'Import' })
  return (
    <ol className="space-y-2 py-1">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
          <div className="min-w-0">
            <p className="text-ink"><b>{it.what}</b>{it.detail && <span className="text-ink-muted"> · {it.detail}</span>}</p>
            <p className="text-[11px] text-ink-muted">{fmt(it.at)}{it.who ? ` · ${it.who}` : ''}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}
