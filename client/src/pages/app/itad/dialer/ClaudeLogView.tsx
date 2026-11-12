import { useEffect, useMemo, useState } from 'react'
import { Pencil, Search, Sparkles, Trash2 } from 'lucide-react'
import { Button } from '../../../../components/ui/Button'
import { useToast } from '../../../../components/ui/Toast'
import { cn } from '../../../../lib/cn'
import { dialerApi, type ClaudeLogItem, type DialerLead, type LogSource } from '../../../../lib/dialerApi'
import { Pager, Panel, errMsg, usePaged } from './ui'
import { SourceChip } from './LeadPanel'

/**
 * Claude log (ITAD update 12 Nov, section 3): everything the Claude connector wrote to leads (notes, and the
 * alternative numbers and other values it set), with the lead and the date. Filters: lead, dates, source
 * (Claude by default; Earth Zone or Metriq notes too) and kind. Each entry can be corrected or removed here:
 * a note through the notes, a value on the lead itself.
 */
export function ClaudeLogView({ rep, leads, showOwner, refreshKey, onOpenLead, onChanged }: { rep: string; leads: DialerLead[]; showOwner: boolean; refreshKey: number; onOpenLead: (id: string) => void; onChanged: () => void }) {
  const { addToast } = useToast()
  const [source, setSource] = useState<LogSource>('CLAUDE')
  const [kind, setKind] = useState<'all' | 'notes' | 'values'>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [q, setQ] = useState('')
  const [items, setItems] = useState<ClaudeLogItem[] | null>(null)
  const [reload, setReload] = useState(0)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setItems(null)
    dialerApi.claudeLog({ rep: rep === 'me' ? undefined : rep, source, kind, from: from || undefined, to: to || undefined })
      .then((r) => setItems(r.items))
      .catch((e) => { setItems([]); addToast({ type: 'error', message: errMsg(e, 'Could not load the Claude log') }) })
  }, [rep, source, kind, from, to, reload, refreshKey, addToast])

  const owner = useMemo(() => new Map(leads.map((l) => [l.id, l.ownerName])), [leads])
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (items ?? []).filter((i) => !t || i.company.toLowerCase().includes(t) || (i.contactName ?? '').toLowerCase().includes(t))
  }, [items, q])
  const p = usePaged(shown, 25)

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true)
    try { await fn(); addToast({ type: 'success', message: ok }); setEditing(null); setDeleting(null); setReload((n) => n + 1); onChanged() } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not save') }) } finally { setBusy(false) }
  }
  const save = (i: ClaudeLogItem, text: string) => run(() => (i.kind === 'NOTE' ? dialerApi.updateNote(i.id, { text }) : dialerApi.editClaudeValue(i.id, text)), 'Saved.')
  const remove = (i: ClaudeLogItem) => run(() => (i.kind === 'NOTE' ? dialerApi.deleteNote(i.id) : dialerApi.deleteClaudeValue(i.id)), i.kind === 'NOTE' ? 'Note deleted.' : 'Removed from the lead.')

  const field = 'h-8 rounded-full border border-line bg-card px-3 text-body-sm text-ink focus:border-primary focus:outline-none'
  const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-body-sm">
        <label className="relative"><Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Lead" aria-label="Lead" className={cn(field, 'w-44 pl-8')} /></label>
        <select value={source} onChange={(e) => setSource(e.target.value as LogSource)} className={field} aria-label="Source">
          <option value="CLAUDE">Claude</option><option value="EARTHZONE">Earth Zone</option><option value="METRIQ">Metriq</option><option value="ALL">Every source</option>
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={field} aria-label="Kind">
          <option value="all">Notes and values</option><option value="notes">Notes only</option><option value="values">Values only</option>
        </select>
        <label className="inline-flex items-center gap-1.5 text-ink-muted">From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={field} /></label>
        <label className="inline-flex items-center gap-1.5 text-ink-muted">to <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={field} /></label>
        {(q || from || to || source !== 'CLAUDE' || kind !== 'all') && <button type="button" onClick={() => { setQ(''); setFrom(''); setTo(''); setSource('CLAUDE'); setKind('all') }} className="font-semibold text-ink-muted hover:text-ink">Reset</button>}
      </div>

      <Panel title={items ? `${shown.length.toLocaleString()} entr${shown.length === 1 ? 'y' : 'ies'}` : 'Claude log'} info="What Claude (the connector) wrote to your leads: notes, and numbers or other values it added. Correct or remove anything that is wrong; a removed value also leaves the lead.">
        {!items ? <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded bg-slate-100" />)}</div>
          : shown.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center"><Sparkles size={24} className="text-ink-muted" /><p className="text-body-md text-ink-muted">{source === 'CLAUDE' ? 'Nothing written by Claude here yet.' : 'Nothing matches these filters.'}</p></div>
          ) : (
            <ul className="divide-y divide-line">
              {p.rows.map((i) => (
                <li key={`${i.kind}-${i.id}`} className="py-2.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm">
                    <button type="button" onClick={() => onOpenLead(i.leadId)} className="max-w-full truncate font-semibold text-ink hover:underline">{i.company}</button>
                    {i.contactName && <span className="text-ink-muted">{i.contactName}</span>}
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-ink">{i.label}</span>
                    <SourceChip source={i.source} />
                    {showOwner && owner.get(i.leadId) && <span className="text-[12px] text-ink-muted">{owner.get(i.leadId)}</span>}
                    <span className="ml-auto text-[12px] text-ink-muted" title={i.editedAt ? `Edited ${when(i.editedAt)}` : undefined}>{when(i.at)}{i.editedAt ? ' · edited' : ''}{i.kind === 'NOTE' && i.author ? ` · ${i.author}` : ''}</span>
                  </div>
                  {editing?.id === i.id ? (
                    <div className="mt-1.5 space-y-1.5">
                      {i.kind === 'NOTE'
                        ? <textarea autoFocus value={editing.text} onChange={(e) => setEditing({ id: i.id, text: e.target.value })} rows={3} maxLength={4000} className="w-full rounded-btn border border-line bg-card px-2 py-1.5 text-body-sm text-ink focus:border-primary focus:outline-none" />
                        : <input autoFocus value={editing.text} onChange={(e) => setEditing({ id: i.id, text: e.target.value })} maxLength={300} className="h-8 w-full max-w-sm rounded-btn border border-line bg-card px-2 text-body-sm text-ink focus:border-primary focus:outline-none" />}
                      <div className="flex gap-2"><Button size="sm" disabled={busy || !editing.text.trim()} onClick={() => save(i, editing.text.trim())}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button></div>
                    </div>
                  ) : (
                    <div className="mt-1 flex items-start gap-2">
                      <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-body-sm text-ink">{i.text}</p>
                      {i.canEdit && (deleting === i.id ? (
                        <span className="flex shrink-0 items-center gap-2 text-[12px]">
                          <span className="text-ink-muted">{i.kind === 'NOTE' ? 'Delete this note?' : 'Remove from the lead?'}</span>
                          <button type="button" disabled={busy} onClick={() => remove(i)} className="font-semibold text-danger">Yes</button>
                          <button type="button" onClick={() => setDeleting(null)} className="font-semibold text-ink-muted">No</button>
                        </span>
                      ) : (
                        <span className="flex shrink-0 gap-1">
                          <button type="button" onClick={() => setEditing({ id: i.id, text: i.text })} className="rounded p-1.5 text-ink-muted hover:bg-slate-100 hover:text-ink" aria-label="Edit" title="Edit"><Pencil size={14} /></button>
                          <button type="button" onClick={() => setDeleting(i.id)} className="rounded p-1.5 text-ink-muted hover:bg-slate-100 hover:text-danger" aria-label="Delete" title="Delete"><Trash2 size={14} /></button>
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        <Pager p={p} />
      </Panel>
    </div>
  )
}
