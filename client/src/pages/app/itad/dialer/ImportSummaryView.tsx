import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Minus, X } from 'lucide-react'
import { dialerApi, type FunnelNumbers, type ImportActivity, type ImportDrillKind, type ImportDrillRow, type ImportSummary } from '../../../../lib/dialerApi'
import { num, pct } from '../../../../lib/dialer'
import { cn } from '../../../../lib/cn'
import { errMsg } from './ui'

/**
 * What an import changed (plan section 10, revised 4 Nov 2026). Used right after an import and in
 * History. Every number opens the leads behind it, in place: the cards, the status-change rows, the
 * touches, the skipped rows. "Activity this import" shows the day's effort on the leads that were
 * worked, since the lifetime rates barely move for a day of calls.
 */

const FIELD_LABEL: Record<string, string> = {
  status: 'status', contactName: 'contact', company: 'company', email: 'email', phone: 'phone', city: 'city', stateRaw: 'state', state: 'state', industry: 'industry',
  source: 'source', website: 'website', companySize: 'company size', listName: 'list', jobTitle: 'title', assignedTo: 'assigned to', externalId: 'lead ID', lastActivityAt: 'Updated At date', leadDate: 'lead date',
}

type Drill = { title: string; kind: ImportDrillKind; from?: string; to?: string }

export function ImportSummaryView({ s, importId, onOpenLead }: { s: ImportSummary; importId?: string; onOpenLead?: (id: string) => void }) {
  const [drill, setDrill] = useState<Drill | null>(null)
  const [skippedOpen, setSkippedOpen] = useState(false)
  const can = !!importId
  const open = (d: Drill) => setDrill((cur) => (cur && cur.kind === d.kind && cur.from === d.from && cur.to === d.to ? null : d))
  const movedBack = s.movedBack
  const reassigned = s.reassignedFromLeadGen ?? 0
  const tiles: { k: string; v: number; hint?: string; drill?: Drill }[] = [
    { k: 'Added', v: s.added, hint: 'new leads', drill: { title: 'Added', kind: 'added' } },
    { k: 'Changed', v: s.changed, hint: s.changedFields?.length ? `mostly ${s.changedFields.slice(0, 2).map((f) => FIELD_LABEL[f.field] ?? f.field).join(', ')}` : undefined, drill: s.changedFields ? { title: 'Changed', kind: 'changed' } : undefined },
    { k: 'Unchanged', v: s.unchanged },
    { k: 'Moved forward', v: s.movedForward, hint: 'in the funnel', drill: { title: 'Moved forward', kind: 'forward' } },
    { k: 'Moved back', v: movedBack, hint: reassigned ? 'hand-backs not counted' : undefined, drill: { title: 'Moved back', kind: 'back' } },
    { k: 'No state', v: s.missingState, hint: 'go to Fix data', drill: { title: 'No state', kind: 'nostate' } },
  ]
  const active = (d?: Drill) => !!drill && !!d && drill.kind === d.kind && drill.from === d.from && drill.to === d.to
  const total = s.added + s.changed + s.unchanged
  const counted = s.counted
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => {
          const clickable = can && !!t.drill && t.v > 0
          const Tag = clickable ? 'button' : 'div'
          return (
            <Tag key={t.k} type={clickable ? 'button' : undefined} onClick={clickable ? () => open(t.drill!) : undefined} className={cn('rounded-btn border px-3 py-2 text-left', active(t.drill) ? 'border-primary bg-primary/[0.06]' : 'border-line bg-card', clickable && 'hover:border-primary/60')}>
              <p className="text-[11px] font-semibold uppercase text-ink-muted">{t.k}</p>
              <p className={cn('text-headline-md tabular-nums', clickable ? 'text-primary' : 'text-ink')}>{num(t.v)}</p>
              {t.hint && <p className="truncate text-[11px] text-ink-muted">{t.hint}</p>}
            </Tag>
          )
        })}
      </div>

      {/* Does it add up */}
      {counted != null && (
        <p className="text-[12px] text-ink-muted">
          {num(s.added)} added + {num(s.changed)} changed + {num(s.unchanged)} unchanged = <b className="text-ink">{num(total)}</b> leads in the file
          {s.heldAsDuplicate ? <>; {num(s.heldAsDuplicate)} held as duplicate{s.heldAsDuplicate === 1 ? '' : 's'} for a manager, so your count is <b className="text-ink">{num(counted)}</b></> : total === counted ? <>, your count.</> : <>; your count is <b className="text-ink">{num(counted)}</b> ({num(Math.abs(total - counted))} {total > counted ? 'of them hidden' : 'from older imports still counted'}).</>}
          {s.repeatedInFile > 0 && <> {num(s.repeatedInFile)} row{s.repeatedInFile === 1 ? '' : 's'} appeared twice; the last one was used.</>}
        </p>
      )}

      {s.activity && <ActivityBlock a={s.activity} before={s.activityBefore ?? null} previousAt={s.previousImportAt} can={can} open={open} active={active} />}

      <FunnelChange before={s.funnelBefore} now={s.funnelNow} />

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-btn border border-line p-3">
          <p className="mb-1.5 text-body-sm font-semibold text-ink">Top status changes</p>
          {s.topChanges.length === 0 ? <p className="text-body-sm text-ink-muted">No status changes.</p> : (
            <ul className="space-y-1 text-body-sm">
              {s.topChanges.map((c) => {
                const d: Drill = { title: `${c.from} → ${c.to}`, kind: 'change', from: c.from, to: c.to }
                return (
                  <li key={c.from + c.to}>
                    {can
                      ? <button type="button" onClick={() => open(d)} className={cn('flex w-full justify-between gap-2 rounded px-1 text-left hover:bg-slate-50', active(d) && 'bg-primary/[0.06]')}><span className="text-primary hover:underline">{c.from} → {c.to}</span><b className="tabular-nums text-ink">{c.count}</b></button>
                      : <span className="flex justify-between gap-2"><span className="text-ink">{c.from} → {c.to}</span><b className="tabular-nums text-ink">{c.count}</b></span>}
                  </li>
                )
              })}
              {reassigned > 0 && (
                <li className="mt-1 border-t border-line pt-1.5">
                  {can
                    ? <button type="button" onClick={() => open({ title: 'Reassigned from Lead Gen', kind: 'reassigned' })} className={cn('flex w-full justify-between gap-2 rounded px-1 text-left hover:bg-slate-50', active({ title: '', kind: 'reassigned' }) && 'bg-primary/[0.06]')}><span className="text-primary hover:underline">Reassigned from Lead Gen (back to you, not a regression)</span><b className="tabular-nums text-ink">{reassigned}</b></button>
                    : <span className="flex justify-between gap-2"><span className="text-ink">Reassigned from Lead Gen</span><b className="tabular-nums text-ink">{reassigned}</b></span>}
                </li>
              )}
            </ul>
          )}
        </div>
        <div className="space-y-2 rounded-btn border border-line p-3 text-body-sm">
          <p className="font-semibold text-ink">Worth knowing</p>
          {s.newIndustries.length > 0 && <p className="text-ink">New industries: {s.newIndustries.map((i) => `${i.name} (${i.count})`).join(', ')}. Each gets its own row in the industry view.</p>}
          {s.unknownStatuses.length > 0 && <p className="text-warning">Statuses the stage list does not know yet: {s.unknownStatuses.map((u) => `${u.status} (${u.count})`).join(', ')}. They count as stage 1 until an admin places them in Settings.</p>}
          {s.duplicates > 0 && <p className="text-danger">{s.duplicates} lead{s.duplicates === 1 ? '' : 's'} already held by another rep{s.duplicateExamples.length ? ` (e.g. ${s.duplicateExamples.slice(0, 3).map((d) => `${d.company}, ${d.heldBy}`).join('; ')})` : ''}. A manager decides who keeps them; until then they are left out of your counts.</p>}
          {s.touches != null && (
            <p className="text-ink">
              {can && s.touches > 0 ? <button type="button" onClick={() => open({ title: 'Touches found', kind: 'touches' })} className="font-semibold text-primary hover:underline">{s.touches} touch{s.touches === 1 ? '' : 'es'} found</button> : <b>{s.touches} touch{s.touches === 1 ? '' : 'es'} found</b>}
              {' '}against your last import (status changes and re-attempts){s.bulkUpdateDays?.length ? `; ${s.bulkUpdateDays.length} bulk-update date${s.bulkUpdateDays.length === 1 ? '' : 's'} not counted as calls` : ''}.
            </p>
          )}
          {s.changedFields && s.changedFields.length > 0 && s.changed > 0 && s.changed >= Math.max(50, total * 0.8) && (
            <p className="text-warning">Nearly every lead counts as changed. What differed: {s.changedFields.slice(0, 4).map((f) => `${FIELD_LABEL[f.field] ?? f.field} (${num(f.count)})`).join(', ')}. If one field explains it, the export changed its format for that column.</p>
          )}
          {!!s.keptChangedHere && <p className="text-ink">{s.keptChangedHere} lead{s.keptChangedHere === 1 ? '' : 's'} kept the status set in Metriq, because Earthzone still shows the old one. Update {s.keptChangedHere === 1 ? 'it' : 'them'} in Earthzone (Leads, Needs Earthzone update).</p>}
          {s.notInFile > 0 && <p className="text-ink">{s.notInFile} lead{s.notInFile === 1 ? '' : 's'} from the last import {s.notInFile === 1 ? 'is' : 'are'} not in this file, so {s.notInFile === 1 ? 'it is' : 'they are'} hidden (history kept).</p>}
          {s.skipped > 0 && (
            <div className="text-ink-muted">
              {s.skippedRows?.length
                ? <button type="button" onClick={() => setSkippedOpen((v) => !v)} className="inline-flex items-center gap-1 text-primary hover:underline">{skippedOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{s.skipped} row{s.skipped === 1 ? '' : 's'} skipped</button>
                : <>{s.skipped} row{s.skipped === 1 ? '' : 's'} skipped: no name, or nothing to recognise the lead by.</>}
              {skippedOpen && s.skippedRows && (
                <ul className="mt-1 max-h-40 space-y-0.5 overflow-auto rounded border border-line bg-slate-50 p-2 text-[12px] dark:bg-white/[0.03]">
                  {s.skippedRows.map((r) => <li key={r.row}><b className="tabular-nums text-ink">Row {r.row}</b>: {r.reason}</li>)}
                  {s.skippedRows.length < s.skipped && <li>… and {s.skipped - s.skippedRows.length} more</li>}
                </ul>
              )}
            </div>
          )}
          {!s.newIndustries.length && !s.unknownStatuses.length && !s.duplicates && !s.notInFile && !s.skipped && !s.repeatedInFile && !s.touches && <p className="text-ink-muted">Nothing unusual in this file.</p>}
        </div>
      </div>

      {drill && importId && <DrillTable importId={importId} drill={drill} onClose={() => setDrill(null)} onOpenLead={onOpenLead} />}
    </div>
  )
}

function ActivityBlock({ a, before, previousAt, can, open, active }: { a: ImportActivity; before: ImportActivity | null; previousAt: string | null; can: boolean; open: (d: Drill) => void; active: (d?: Drill) => boolean }) {
  const items: { label: string; v: number; kind?: ImportDrillKind; b?: number | null }[] = [
    { label: 'Touches', v: a.touches, kind: 'touches', b: before?.touches },
    { label: 'Connects', v: a.connects, kind: 'connects', b: before?.connects },
    { label: 'Voicemails', v: a.voicemails, kind: 'voicemails', b: before?.voicemails },
    { label: 'Positives gained', v: a.positives, kind: 'positives', b: before?.positives },
    { label: 'To Lead Gen', v: a.toLeadGen, kind: 'toLeadGen', b: before?.toLeadGen },
  ]
  const rate = a.connectRateTouched, bRate = before?.connectRateTouched ?? null
  const dRate = rate != null && bRate != null ? rate - bRate : null
  return (
    <div className="rounded-btn border border-primary/30 bg-primary/[0.03] p-3">
      <p className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-body-sm"><span className="font-semibold text-ink">Activity this import</span><span className="text-[11.5px] text-ink-muted">{before ? `vs the previous import${previousAt ? ` (${new Date(previousAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })})` : ''}` : 'first import with activity: nothing to compare yet'}</span></p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {items.map((it) => {
          const d: Drill | undefined = it.kind ? { title: it.label, kind: it.kind } : undefined
          const clickable = can && !!d && it.v > 0
          const diff = it.b != null ? it.v - it.b : null
          const Tag = clickable ? 'button' : 'div'
          return (
            <Tag key={it.label} type={clickable ? 'button' : undefined} onClick={clickable ? () => open(d!) : undefined} className={cn('rounded-btn px-2 py-1.5 text-left', active(d) ? 'bg-primary/10' : clickable ? 'hover:bg-primary/[0.06]' : '')}>
              <p className="text-[11px] text-ink-muted">{it.label}</p>
              <p className="flex items-baseline gap-1 text-body-lg font-bold tabular-nums"><span className={clickable ? 'text-primary' : 'text-ink'}>{num(it.v)}</span>{diff != null && diff !== 0 && <span className={cn('text-[11px] font-semibold', diff > 0 ? 'text-success' : 'text-danger')}>{diff > 0 ? '+' : ''}{num(diff)}</span>}</p>
            </Tag>
          )
        })}
        <div className="rounded-btn px-2 py-1.5">
          <p className="text-[11px] text-ink-muted">Connect rate, touched leads</p>
          <p className="flex items-baseline gap-1 text-body-lg font-bold tabular-nums text-ink">{pct(rate, 0)}{dRate != null && Math.abs(dRate) >= 0.005 && <span className={cn('text-[11px] font-semibold', dRate > 0 ? 'text-success' : 'text-danger')}>{dRate > 0 ? '+' : ''}{(dRate * 100).toFixed(0)} pts</span>}</p>
        </div>
      </div>
      <p className="mt-1.5 text-[11px] text-ink-muted">Connects ÷ touches: the rate that moves with a day's work. The lifetime funnel below is the long view.</p>
    </div>
  )
}

/** The leads behind one line of the summary, in place. */
function DrillTable({ importId, drill, onClose, onOpenLead }: { importId: string; drill: Drill; onClose: () => void; onOpenLead?: (id: string) => void }) {
  const [rows, setRows] = useState<ImportDrillRow[] | null>(null)
  const [err, setErr] = useState('')
  const [shown, setShown] = useState(50)
  useEffect(() => {
    let on = true
    setRows(null); setErr(''); setShown(50)
    dialerApi.importChanges(importId, drill.kind === 'change' ? { from: drill.from, to: drill.to } : { kind: drill.kind }).then((r) => { if (on) setRows(r.leads) }).catch((e) => { if (on) setErr(errMsg(e, 'Could not open those leads')) })
    return () => { on = false }
  }, [importId, drill])
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '')
  return (
    <section className="rounded-btn border border-primary/40 bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <p className="text-body-sm font-semibold text-ink">{drill.title}{rows ? <span className="ml-1.5 font-normal text-ink-muted">· {num(rows.length)} lead{rows.length === 1 ? '' : 's'}</span> : null}</p>
        <button type="button" onClick={onClose} className="rounded p-1 text-ink-muted hover:text-ink" aria-label="Close the list"><X size={15} /></button>
      </div>
      {err ? <p className="px-3 py-3 text-body-sm text-danger">{err}</p> : !rows ? <div className="m-3 h-16 animate-pulse rounded bg-slate-100" /> : rows.length === 0 ? <p className="px-3 py-3 text-body-sm text-ink-muted">No leads here.</p> : (
        <div className="max-h-80 overflow-auto">
          <table className="w-full min-w-[640px] text-left text-body-sm">
            <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase text-ink-muted dark:bg-white/[0.03]"><tr><th className="px-3 py-1.5">Company</th><th className="px-2">Contact</th><th className="px-2">Phone</th><th className="px-2">Status</th><th className="px-2">Date</th><th className="px-2">What</th></tr></thead>
            <tbody className="divide-y divide-line">
              {rows.slice(0, shown).map((r) => (
                <tr key={r.leadId + (r.at ?? '')} className="hover:bg-slate-50/70">
                  <td className="max-w-[220px] px-3 py-1.5">{onOpenLead ? <button type="button" onClick={() => onOpenLead(r.leadId)} className="block max-w-full truncate text-left font-semibold text-ink hover:underline">{r.company}</button> : <span className="block truncate font-semibold text-ink">{r.company}</span>}{r.state && <span className="block text-[11px] text-ink-muted">{r.state}</span>}</td>
                  <td className="max-w-[160px] truncate px-2 py-1.5 text-ink">{r.contactName ?? '—'}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-ink">{r.phone ?? '—'}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-ink">{r.from && r.to && r.from !== r.to ? <><span className="text-ink-muted">{r.from}</span> → {r.to}</> : r.to ?? r.status}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-ink-muted">{when(r.at)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-ink-muted">{r.kind}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > shown && <div className="border-t border-line py-2 text-center"><button type="button" onClick={() => setShown((n) => n + 100)} className="text-body-sm font-semibold text-primary">Show more ({num(rows.length - shown)} left)</button></div>}
        </div>
      )}
    </section>
  )
}

function FunnelChange({ before, now }: { before: FunnelNumbers | null; now: FunnelNumbers }) {
  const rows: [string, keyof FunnelNumbers, boolean][] = [
    ['Total', 'total', false], ['Attempted+', 'attempted', false], ['Connected+', 'connected', false], ['Positive', 'positive', false],
    ['Attempt rate', 'attemptRate', true], ['Connect rate', 'connectRate', true], ['Win rate', 'winRate', true], ['Positive rate', 'positiveRate', true],
  ]
  return (
    <div className="rounded-btn border border-line p-3">
      <p className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-body-sm"><span className="font-semibold text-ink">Lifetime funnel {before ? 'now vs the previous import' : '(first import, nothing to compare yet)'}</span><span className="text-[11px] text-ink-muted">Rates over every lead you hold: a day's calls move them by a fraction of a point.</span></p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-4">
        {rows.map(([label, k, isRate]) => {
          const n = now[k] as number | null
          const b = before ? (before[k] as number | null) : null
          const d = n != null && b != null ? n - b : null
          return (
            <div key={k} className="flex items-baseline justify-between gap-2 text-body-sm">
              <span className="text-ink-muted">{label}</span>
              <span className="flex items-center gap-1 tabular-nums">
                <b className="text-ink">{isRate ? pct(n) : num(n ?? 0)}</b>
                {d != null && d !== 0 && <span className={cn('inline-flex items-center text-[11px]', d > 0 ? 'text-success' : 'text-danger')}>{d > 0 ? <ArrowUp size={11} /> : <ArrowDown size={11} />}{isRate ? `${Math.abs(d * 100).toFixed(1)} pts` : num(Math.abs(d))}</span>}
                {d === 0 && before && <Minus size={11} className="text-ink-muted" />}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
