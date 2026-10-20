import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import type { FunnelNumbers, ImportSummary } from '../../../../lib/dialerApi'
import { num, pct } from '../../../../lib/dialer'
import { cn } from '../../../../lib/cn'

/** What an import changed (plan section 10). Used right after an import and in History. */
export function ImportSummaryView({ s, onOpenChange }: { s: ImportSummary; onOpenChange?: (from: string, to: string) => void }) {
  const tiles: [string, number, string?][] = [
    ['Added', s.added, 'new leads'],
    ['Changed', s.changed],
    ['Unchanged', s.unchanged],
    ['Moved forward', s.movedForward, 'in the funnel'],
    ['Moved back', s.movedBack],
    ['No state', s.missingState, 'go to Fix data'],
  ]
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map(([k, v, hint]) => (
          <div key={k} className="rounded-btn border border-line bg-card px-3 py-2">
            <p className="text-[11px] font-semibold uppercase text-ink-muted">{k}</p>
            <p className="text-headline-md tabular-nums text-ink">{num(v)}</p>
            {hint && <p className="text-[11px] text-ink-muted">{hint}</p>}
          </div>
        ))}
      </div>

      <FunnelChange before={s.funnelBefore} now={s.funnelNow} />

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-btn border border-line p-3">
          <p className="mb-1.5 text-body-sm font-semibold text-ink">Top status changes</p>
          {s.topChanges.length === 0 ? <p className="text-body-sm text-ink-muted">No status changes.</p> : (
            <ul className="space-y-1 text-body-sm">
              {s.topChanges.map((c) => (
                <li key={c.from + c.to}>
                  {onOpenChange
                    ? <button type="button" onClick={() => onOpenChange(c.from, c.to)} className="flex w-full justify-between gap-2 rounded px-1 text-left hover:bg-slate-50"><span className="text-primary hover:underline">{c.from} → {c.to}</span><b className="tabular-nums text-ink">{c.count}</b></button>
                    : <span className="flex justify-between gap-2"><span className="text-ink">{c.from} → {c.to}</span><b className="tabular-nums text-ink">{c.count}</b></span>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="space-y-2 rounded-btn border border-line p-3 text-body-sm">
          <p className="font-semibold text-ink">Worth knowing</p>
          {s.newIndustries.length > 0 && <p className="text-ink">New industries: {s.newIndustries.map((i) => `${i.name} (${i.count})`).join(', ')}. Each gets its own row in the industry view.</p>}
          {s.unknownStatuses.length > 0 && <p className="text-warning">Statuses the stage list does not know yet: {s.unknownStatuses.map((u) => `${u.status} (${u.count})`).join(', ')}. They count as stage 1 until an admin places them in Settings.</p>}
          {s.duplicates > 0 && <p className="text-danger">{s.duplicates} lead{s.duplicates === 1 ? '' : 's'} already held by another rep{s.duplicateExamples.length ? ` (e.g. ${s.duplicateExamples.slice(0, 3).map((d) => `${d.company}, ${d.heldBy}`).join('; ')})` : ''}. A manager decides who keeps them; until then they are left out of your counts.</p>}
          {s.notInFile > 0 && <p className="text-ink">{s.notInFile} lead{s.notInFile === 1 ? '' : 's'} from the last import {s.notInFile === 1 ? 'is' : 'are'} not in this file, so {s.notInFile === 1 ? 'it is' : 'they are'} hidden (history kept).</p>}
          {s.skipped > 0 && <p className="text-ink-muted">{s.skipped} row{s.skipped === 1 ? '' : 's'} skipped: no name, or nothing to recognise the lead by.</p>}
          {s.repeatedInFile > 0 && <p className="text-ink-muted">{s.repeatedInFile} lead{s.repeatedInFile === 1 ? '' : 's'} appeared twice in the file; the last row was used.</p>}
          {!s.newIndustries.length && !s.unknownStatuses.length && !s.duplicates && !s.notInFile && !s.skipped && !s.repeatedInFile && <p className="text-ink-muted">Nothing unusual in this file.</p>}
        </div>
      </div>
    </div>
  )
}

function FunnelChange({ before, now }: { before: FunnelNumbers | null; now: FunnelNumbers }) {
  const rows: [string, keyof FunnelNumbers, boolean][] = [
    ['Total', 'total', false], ['Attempted+', 'attempted', false], ['Connected+', 'connected', false], ['Positive', 'positive', false],
    ['Attempt rate', 'attemptRate', true], ['Connect rate', 'connectRate', true], ['Win rate', 'winRate', true], ['Positive rate', 'positiveRate', true],
  ]
  return (
    <div className="rounded-btn border border-line p-3">
      <p className="mb-2 text-body-sm font-semibold text-ink">Funnel {before ? 'now vs the previous import' : '(first import, nothing to compare yet)'}</p>
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
