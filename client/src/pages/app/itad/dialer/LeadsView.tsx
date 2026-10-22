import { useMemo, useState } from 'react'
import { Download, FileUp, Save, Search, X } from 'lucide-react'
import { Button } from '../../../../components/ui/Button'
import { Modal } from '../../../../components/ui/Modal'
import { useToast } from '../../../../components/ui/Toast'
import { cn } from '../../../../lib/cn'
import { dialerApi, type DialerData, type SavedView } from '../../../../lib/dialerApi'
import { PRESET_VIEWS, REGIONS, filterLeads, fmtPkt, leadState, type LeadFilters } from '../../../../lib/dialer'
import { InfoTip, LeadTable, Pager, errMsg, usePaged } from './ui'
import { BulkFillModal } from './BulkFillModal'
import { downloadCsv, downloadNotes } from './exports'

/**
 * All leads: one search box (name, company, phone, email, city), filters, and saved views as
 * one-click tabs. Ready-made views for everyone; each rep can save their own. Clicking a lead
 * opens the side panel, with arrows to move through this list.
 */
export function LeadsView({ data, now, showOwner, onOpenLead, onChanged }: { data: DialerData; now: Date; showOwner: boolean; onOpenLead: (id: string, ids: string[]) => void; onChanged: () => void }) {
  const { addToast } = useToast()
  const [f, setF] = useState<LeadFilters>({ preset: 'all' })
  const [views, setViews] = useState<SavedView[]>(data.prefs.views)
  const [activeView, setActiveView] = useState<string>('all')
  const [naming, setNaming] = useState(false)
  const [fill, setFill] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const lastImport = useMemo(() => (data.lastImport ? { id: data.lastImport.id, at: new Date(data.lastImport.at) } : null), [data.lastImport])
  const leads = data.leads
  const list = useMemo(() => filterLeads(leads, f, now, lastImport, data.settings), [leads, f, now, lastImport, data.settings])
  const p = usePaged(list)
  const counts = useMemo(() => Object.fromEntries(PRESET_VIEWS.map((v) => [v.id, filterLeads(leads, { preset: v.id }, now, lastImport).length])), [leads, now, lastImport])

  const opts = (fn: (l: (typeof leads)[number]) => string | null, empty: string) => [...new Set(leads.map((l) => fn(l) ?? empty))].sort((a, b) => a.localeCompare(b))
  const lists = [...new Set(leads.map((l) => l.listName))]
  const tags = [...new Set(leads.flatMap((l) => l.tags))].sort()
  const set = (k: keyof LeadFilters, v: string) => { setF((x) => ({ ...x, [k]: v || undefined })); setActiveView('') }
  const pickPreset = (id: string) => { setF({ preset: id, q: f.q }); setActiveView(id) }
  const pickView = (v: SavedView) => { setF({ ...(v.filters as LeadFilters) }); setActiveView(v.id) }
  const extra = Object.entries(f).filter(([k, v]) => v && k !== 'q' && !(k === 'preset' && v === 'all')).length

  async function saveViews(next: SavedView[], msg: string) {
    try { await dialerApi.savePrefs({ views: next }); setViews(next); addToast({ type: 'success', message: msg }) } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not save the view') }) }
  }
  function exportList() {
    downloadCsv(`leads-${new Date().toISOString().slice(0, 10)}.csv`, ['Company', 'Contact', 'Phone', 'Email', 'City', 'State', 'Status', 'Industry', 'List', 'Second phone', 'Second email', 'LinkedIn', 'Decision maker', 'Best time', 'Tags', ...(showOwner ? ['Rep'] : [])],
      list.map((l) => [l.company, l.contactName, l.phone, l.email, l.city, leadState(l), l.status, l.industry, l.listName, l.phone2, l.email2, l.linkedin, l.decisionMaker, l.bestTime, l.tags.join(', '), ...(showOwner ? [l.ownerName] : [])]))
  }
  const sel = (active: boolean) => cn('h-8 rounded-full border px-3 text-body-sm focus:border-primary focus:outline-none', active ? 'border-primary bg-primary/5 font-semibold text-primary' : 'border-line bg-card text-ink')

  return (
    <div className="space-y-3">
      {/* Saved views */}
      <div className="flex flex-wrap items-center gap-1.5">
        {PRESET_VIEWS.map((v) => (
          <button key={v.id} type="button" onClick={() => pickPreset(v.id)} title={v.hint} className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-body-sm font-semibold', activeView === v.id ? 'border-primary bg-primary text-white' : 'border-line bg-card text-ink hover:bg-slate-50')}>
            {v.name}<span className={cn('tabular-nums', activeView === v.id ? 'text-white/80' : 'text-ink-muted')}>{counts[v.id].toLocaleString()}</span>
          </button>
        ))}
        {views.map((v) => (
          <span key={v.id} className={cn('inline-flex items-center rounded-full border text-body-sm font-semibold', activeView === v.id ? 'border-primary bg-primary text-white' : 'border-dashed border-line bg-card text-ink')}>
            <button type="button" onClick={() => pickView(v)} className="py-1 pl-3 pr-1.5">{v.name}</button>
            <button type="button" onClick={() => saveViews(views.filter((x) => x.id !== v.id), `"${v.name}" removed.`)} className="rounded-full p-1 pr-2 opacity-60 hover:opacity-100" aria-label={`Remove ${v.name}`}><X size={12} /></button>
          </span>
        ))}
        <InfoTip side="bottom">Views are filter sets. Pick one, or set filters and press "Save view" to keep it as your own tab. Every list only ever shows your own leads.</InfoTip>
      </div>

      {/* Search and filters */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative">
          <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input value={f.q ?? ''} onChange={(e) => setF((x) => ({ ...x, q: e.target.value || undefined }))} placeholder="Name, company, phone, email or city" className="h-9 w-72 rounded-btn border border-line bg-card pl-8 pr-2 text-body-sm text-ink focus:border-primary focus:outline-none" />
        </label>
        <select value={f.state ?? ''} onChange={(e) => set('state', e.target.value)} className={sel(!!f.state)} aria-label="State"><option value="">State</option>{opts((l) => leadState(l), '(no state)').map((v) => <option key={v}>{v}</option>)}</select>
        <select value={f.region ?? ''} onChange={(e) => set('region', e.target.value)} className={sel(!!f.region)} aria-label="Region"><option value="">Region</option>{REGIONS.map((r) => <option key={r}>{r}</option>)}</select>
        <select value={f.industry ?? ''} onChange={(e) => set('industry', e.target.value)} className={sel(!!f.industry)} aria-label="Industry"><option value="">Industry</option>{opts((l) => l.industry, '(no industry)').map((v) => <option key={v}>{v}</option>)}</select>
        <select value={f.status ?? ''} onChange={(e) => set('status', e.target.value)} className={sel(!!f.status)} aria-label="Status"><option value="">Status</option>{opts((l) => l.status, 'Unknown').map((v) => <option key={v}>{v}</option>)}</select>
        <select value={f.stage ?? ''} onChange={(e) => set('stage', e.target.value)} className={sel(!!f.stage)} aria-label="Stage"><option value="">Stage</option><option value="1">1 New / assigned</option><option value="2">2 Attempted</option><option value="3">3 Connected</option><option value="4">4 Positive</option></select>
        <select value={f.inStatus ?? ''} onChange={(e) => set('inStatus', e.target.value)} className={sel(!!f.inStatus)} aria-label="Days in status"><option value="">Days in status</option>{[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d}+ days</option>)}</select>
        <select value={f.updated ?? ''} onChange={(e) => set('updated', e.target.value)} className={sel(!!f.updated)} aria-label="Last updated"><option value="">Last updated</option>{[1, 7, 30, 90].map((d) => <option key={d} value={d}>In the last {d === 1 ? 'day' : `${d} days`}</option>)}</select>
        <select value={f.callAt ? (/^\d/.test(f.callAt) ? 'time' : f.callAt) : ''} onChange={(e) => set('callAt', e.target.value === 'time' ? nextHour(now) : e.target.value)} className={sel(!!f.callAt)} aria-label="Call time">
          <option value="">Call time</option>
          <option value="now">Can call now</option>
          <option value="prime">Prime time now</option>
          <option value="time">At a time I pick (PKT)</option>
        </select>
        {f.callAt && /^\d/.test(f.callAt) && (
          <label className="inline-flex items-center gap-1.5 text-body-sm text-ink">
            <span className="text-ink-muted">At</span>
            <input type="time" value={f.callAt} onChange={(e) => e.target.value && set('callAt', e.target.value)} className="h-8 rounded-full border border-primary bg-primary/5 px-3 text-body-sm font-semibold text-primary focus:outline-none" aria-label="Pakistan time to call" />
            <span className="text-ink-muted">PKT</span>
          </label>
        )}
        <select value={f.notes ?? ''} onChange={(e) => set('notes', e.target.value)} className={sel(!!f.notes)} aria-label="Notes"><option value="">Notes</option><option value="yes">Has notes</option><option value="no">No notes</option></select>
        {tags.length > 0 && <select value={f.tag ?? ''} onChange={(e) => set('tag', e.target.value)} className={sel(!!f.tag)} aria-label="Tag"><option value="">Tag</option>{tags.map((t) => <option key={t}>{t}</option>)}</select>}
        {lists.length > 1 && <select value={f.list ?? ''} onChange={(e) => set('list', e.target.value)} className={sel(!!f.list)} aria-label="List"><option value="">List</option>{lists.map((t) => <option key={t} value={t}>{t === 'CRM' ? 'CRM (SMB)' : t}</option>)}</select>}
        {showOwner && <select value={f.rep ?? ''} onChange={(e) => set('rep', e.target.value)} className={sel(!!f.rep)} aria-label="Rep"><option value="">Rep</option>{[...new Map(leads.map((l) => [l.ownerId, l.ownerName])).entries()].map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>}
        {(extra > 0 || f.q) && <button type="button" onClick={() => { setF({ preset: 'all' }); setActiveView('all') }} className="inline-flex items-center gap-1 text-body-sm text-ink-muted hover:text-ink"><X size={14} /> Clear</button>}
        {extra > 0 && !activeView && <button type="button" onClick={() => setNaming(true)} className="inline-flex items-center gap-1 text-body-sm font-semibold text-primary"><Save size={14} /> Save view</button>}
      </div>

      <div className="rounded-card border border-line bg-card p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-body-sm text-ink-muted"><b className="text-ink">{list.length.toLocaleString()}</b> leads{f.callAt && /^\d/.test(f.callAt) ? <> you can call at <b className="text-ink">{fmtPkt(f.callAt)} PKT</b> (inside their calling hours then)</> : f.callAt === 'now' ? ' you can call now' : f.callAt === 'prime' ? ' in prime time now' : ''}</span>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" leadingIcon={<FileUp size={14} />} onClick={() => setFill(true)}>Bulk fill extra contacts</Button>
            <Button size="sm" variant="secondary" leadingIcon={<Download size={14} />} onClick={() => setNotesOpen(true)}>Export notes</Button>
            <Button size="sm" variant="secondary" leadingIcon={<Download size={14} />} disabled={!list.length} onClick={exportList}>Export this list</Button>
          </div>
        </div>
        {list.length === 0 ? <p className="py-8 text-center text-body-md text-ink-muted">No leads match.</p> : (
          <>
            <LeadTable leads={p.rows} now={now} showOwner={showOwner} onOpen={(id) => onOpenLead(id, list.map((l) => l.id))} />
            <Pager p={p} />
          </>
        )}
      </div>

      {naming && <NameView onClose={() => setNaming(false)} onSave={(name) => { const v = { id: `v${Date.now().toString(36)}`, name, filters: Object.fromEntries(Object.entries(f).filter(([, x]) => x)) as Record<string, string> }; saveViews([...views, v], `"${name}" saved as your view.`).then(() => { setActiveView(v.id); setNaming(false) }) }} />}
      {fill && <BulkFillModal leads={leads.filter((l) => l.ownerId === data.me.id)} onClose={() => setFill(false)} onDone={onChanged} />}
      {notesOpen && <NotesExportModal data={data} onClose={() => setNotesOpen(false)} />}
    </div>
  )
}

/** The next whole hour on the Pakistan clock, as 'HH:MM' (the time picker's starting value). */
function nextHour(now: Date): string {
  const h = Number(now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Karachi', hour: '2-digit', hourCycle: 'h23' }))
  return `${String((h + 1) % 24).padStart(2, '0')}:00`
}

function NameView({ onClose, onSave }: { onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState('')
  return (
    <Modal open onClose={onClose} title="Save as my view" size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!name.trim()} onClick={() => onSave(name.trim())}>Save</Button></>}>
      <input autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && onSave(name.trim())} placeholder="e.g. Texas manufacturing" className="h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none" />
    </Modal>
  )
}

/** Notes for a rep and a date range, as a CSV that opens in Excel. Nothing stays trapped in the dialer. */
function NotesExportModal({ data, onClose }: { data: DialerData; onClose: () => void }) {
  const { addToast } = useToast()
  const [rep, setRep] = useState(data.scope === 'me' ? 'me' : data.scope)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  async function go() {
    setBusy(true)
    try {
      const r = await dialerApi.notes({ rep, from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined, to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined })
      if (!r.notes.length) { addToast({ type: 'info', message: 'No notes in that range.' }); return }
      downloadNotes(`dialer-notes${from ? `-${from}` : ''}${to ? `-to-${to}` : ''}.csv`, r.notes)
      onClose()
    } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not export') }) } finally { setBusy(false) }
  }
  const inp = 'h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink'
  return (
    <Modal open onClose={onClose} title="Export notes" size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={go}>{busy ? 'Preparing…' : 'Download'}</Button></>}>
      <div className="space-y-3 text-body-sm">
        {data.me.isManager && (
          <label className="block"><span className="mb-1 block font-semibold text-ink">Whose notes</span>
            <select value={rep} onChange={(e) => setRep(e.target.value)} className={inp}><option value="me">Mine</option><option value="all">Everyone in ITAD</option>{data.reps.filter((r) => r.id !== data.me.id).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
          </label>
        )}
        <div className="grid grid-cols-2 gap-2">
          <label><span className="mb-1 block font-semibold text-ink">From</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inp} /></label>
          <label><span className="mb-1 block font-semibold text-ink">To</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inp} /></label>
        </div>
        <p className="text-ink-muted">Leave the dates empty for every note. A CSV file that opens in Excel, with author, time, company, phone and CRM lead ID. One lead's notes can be exported from its panel.</p>
      </div>
    </Modal>
  )
}

