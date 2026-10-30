import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Columns3, Download, FileUp, Save, Search, X } from 'lucide-react'
import { Button } from '../../../../components/ui/Button'
import { Modal } from '../../../../components/ui/Modal'
import { useToast } from '../../../../components/ui/Toast'
import { cn } from '../../../../lib/cn'
import { dialerApi, type DialerData, type SavedView } from '../../../../lib/dialerApi'
import { PRESET_VIEWS, REGIONS, filterLeads, fmtPkt, leadState, type LeadFilters } from '../../../../lib/dialer'
import { DownloadLeads, InfoTip, MultiFilter, Pager, errMsg, usePaged } from './ui'
import { ColumnPicker, LeadsTable } from './LeadColumns'
import { BulkBar } from './TaskParts'
import { BulkFillModal } from './BulkFillModal'
import { downloadNotes } from './exports'

/**
 * All leads: one search box (name, company, phone, email, city), filters, and saved views as
 * one-click tabs. Ready-made views for everyone; each rep can save their own. Clicking a lead
 * opens the side panel, with arrows to move through this list.
 */
export function LeadsView({ data, now, showOwner, onOpenLead, onChanged }: { data: DialerData; now: Date; showOwner: boolean; onOpenLead: (id: string, ids: string[]) => void; onChanged: () => void }) {
  const { addToast } = useToast()
  // Filters and the active view live in the address bar: opening a lead and coming back keeps them.
  const [params, setParams] = useSearchParams()
  const f: LeadFilters = useMemo(() => { try { return JSON.parse(params.get('lf') ?? '') as LeadFilters } catch { return { preset: 'all' } } }, [params])
  const activeView = params.get('lv') ?? (params.get('lf') ? '' : 'all')
  const write = (nf: LeadFilters, view: string) => { const n = new URLSearchParams(params); n.set('lf', JSON.stringify(nf)); if (view) n.set('lv', view); else n.delete('lv'); setParams(n, { replace: true }) }
  const setF = (fn: (x: LeadFilters) => LeadFilters) => write(fn(f), activeView)
  const setActiveView = (v: string) => write(f, v)
  const [views, setViews] = useState<SavedView[]>(data.prefs.views)
  const [columns, setColumns] = useState<string[]>(data.prefs.columns ?? [])
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
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
  const set = (k: keyof LeadFilters, v: string) => write({ ...f, [k]: v || undefined }, '')
  const pickPreset = (id: string) => write({ preset: id, q: f.q }, id)
  const pickView = (v: SavedView) => write({ ...(v.filters as LeadFilters) }, v.id)
  const extra = Object.entries(f).filter(([k, v]) => v && k !== 'q' && !(k === 'preset' && v === 'all')).length

  async function saveViews(next: SavedView[], msg: string) {
    try { await dialerApi.savePrefs({ views: next }); setViews(next); addToast({ type: 'success', message: msg }) } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not save the view') }) }
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
        <MultiFilter label="State" value={f.state} onChange={(v) => set('state', v)} options={opts((l) => leadState(l), '(no state)').map((v) => ({ value: v }))} />
        <MultiFilter label="Region" value={f.region} onChange={(v) => set('region', v)} options={REGIONS.map((r) => ({ value: r }))} />
        <MultiFilter label="Industry" value={f.industry} onChange={(v) => set('industry', v)} options={opts((l) => l.industry, '(no industry)').map((v) => ({ value: v }))} />
        <MultiFilter label="Status" allLabel="Any" value={f.status} onChange={(v) => set('status', v)} options={opts((l) => l.status, 'Unknown').map((v) => ({ value: v }))} />
        <MultiFilter label="Stage" value={f.stage} onChange={(v) => set('stage', v)} options={[{ value: '1', label: '1 New / assigned' }, { value: '2', label: '2 Attempted' }, { value: '3', label: '3 Connected' }, { value: '4', label: '4 Positive' }]} />
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
        {tags.length > 0 && <MultiFilter label="Tag" value={f.tag} onChange={(v) => set('tag', v)} options={tags.map((t) => ({ value: t }))} />}
        {lists.length > 1 && <MultiFilter label="List" value={f.list} onChange={(v) => set('list', v)} options={lists.map((t) => ({ value: t, label: t === 'CRM' ? 'CRM (SMB)' : t }))} />}
        {showOwner && <MultiFilter label="Rep" value={f.rep} onChange={(v) => set('rep', v)} options={[...new Map(leads.map((l) => [l.ownerId, l.ownerName])).entries()].map(([id, n]) => ({ value: id, label: n || 'Unknown' }))} />}
        {(extra > 0 || f.q) && <button type="button" onClick={() => write({ preset: 'all' }, 'all')} className="inline-flex items-center gap-1 text-body-sm text-ink-muted hover:text-ink"><X size={14} /> Clear</button>}
        {extra > 0 && !activeView && <button type="button" onClick={() => setNaming(true)} className="inline-flex items-center gap-1 text-body-sm font-semibold text-primary"><Save size={14} /> Save view</button>}
      </div>

      <div className="rounded-card border border-line bg-card p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-body-sm text-ink-muted"><b className="text-ink">{list.length.toLocaleString()}</b> leads{f.callAt && /^\d/.test(f.callAt) ? <> you can call at <b className="text-ink">{fmtPkt(f.callAt)} PKT</b> (inside their calling hours then)</> : f.callAt === 'now' ? ' you can call now' : f.callAt === 'prime' ? ' in prime time now' : ''}</span>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" leadingIcon={<Columns3 size={14} />} onClick={() => setPicking(true)}>Columns</Button>
            <Button size="sm" variant="secondary" leadingIcon={<FileUp size={14} />} onClick={() => setFill(true)}>Bulk fill extra contacts</Button>
            <Button size="sm" variant="secondary" leadingIcon={<Download size={14} />} onClick={() => setNotesOpen(true)}>Export notes</Button>
            <DownloadLeads title={activeView ? `leads ${views.find((v) => v.id === activeView)?.name ?? PRESET_VIEWS.find((v) => v.id === activeView)?.name ?? ''}` : 'leads filtered'} leads={list} now={now} showOwner={showOwner} label="Download this list" />
          </div>
        </div>
        {list.length === 0 ? <p className="py-8 text-center text-body-md text-ink-muted">No leads match.</p> : (
          <>
            <LeadsTable leads={p.rows} now={now} columns={columns} showOwner={showOwner} onOpen={(id) => onOpenLead(id, list.map((l) => l.id))}
              picked={picked} canPick={(l) => l.ownerId === data.me.id}
              onPick={(ids, on) => setPicked((s) => { const n = new Set(s); ids.forEach((id) => (on ? n.add(id) : n.delete(id))); return n })} />
            <Pager p={p} />
          </>
        )}
      </div>

      <BulkBar ids={[...picked]} count={picked.size} onClear={() => setPicked(new Set())} onDone={onChanged} />
      {picking && <ColumnPicker columns={columns} onClose={() => setPicking(false)} onSave={async (cols) => {
        try { await dialerApi.savePrefs({ columns: cols }); setColumns(cols); setPicking(false); addToast({ type: 'success', message: 'Columns saved.' }) } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not save') }) }
      }} />}
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

