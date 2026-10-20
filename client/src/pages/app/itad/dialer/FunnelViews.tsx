import { useMemo, useState } from 'react'
import type { DialerLead, DialerSettings } from '../../../../lib/dialerApi'
import { funnelOf, leadRegion, leadState, num, pct, segments, type Segment } from '../../../../lib/dialer'
import { cn } from '../../../../lib/cn'
import { InfoTip, Pager, Panel, usePaged } from './ui'

/** Funnel full view and the industry funnel (plan 4e and 7). Same filters as the dashboard. */

/** What each number means: shown in the ⓘ beside its label. */
const MEANS: Record<string, string> = {
  Total: 'All the leads on your list.',
  'New / Assigned': 'Stage 1: leads not tried yet (Assigned, New Data, or no status).',
  'Attempted+': 'Stage 2 and up: leads we have tried to reach at least once.',
  'Connected+': 'Stage 3 and up: leads where we spoke to the person.',
  Positive: 'Stage 4: leads that showed interest or moved into the pipeline.',
  'Attempt rate': 'Of all leads, how many we have tried. Attempted+ ÷ Total.',
  'Connect rate': 'Of the leads we tried, how many we reached. Connected+ ÷ Attempted+.',
  'Win rate': 'Of the people we spoke to, how many turned positive. Positive ÷ Connected+.',
  'Positive rate': 'Of all leads, how many turned positive. Positive ÷ Total.',
}
const Label = ({ k }: { k: string }) => <span className="inline-flex items-center gap-1">{k}<InfoTip>{MEANS[k]}</InfoTip></span>

type By = 'state' | 'industry' | 'region' | 'rep' | 'status'

export function FunnelView({ leads, settings, now, showReps, onPick }: { leads: DialerLead[]; settings: DialerSettings; now: Date; showReps: boolean; onPick: (by: By, key: string) => void }) {
  const [ever, setEver] = useState(false)
  const [by, setBy] = useState<By>('state')
  const live = useMemo(() => leads.filter((l) => !l.duplicate), [leads])
  const f = funnelOf(live, ever)
  const keyOf = (l: DialerLead): string => {
    switch (by) {
      case 'state': return leadState(l) ?? 'Unknown state'
      case 'industry': return l.industry ?? '(no industry)'
      case 'region': return leadRegion(l, now) ?? 'No region'
      case 'rep': return l.ownerName || 'Unknown'
      case 'status': return l.status
    }
  }
  const segs = segments(live, keyOf, ever)
  const pg = usePaged(segs)
  const stage1 = live.filter((l) => (ever ? Math.max(l.maxStage, l.stage) : l.stage) <= 1).length
  const bar = (n: number) => `${f.total ? (n / f.total) * 100 : 0}%`
  const top = (fn: (l: DialerLead) => string | null) => segments(live.filter((l) => fn(l)), (l) => fn(l)!).slice(0, 10)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-body-sm">
        <span className="text-ink-muted">Count by</span>
        {([[false, 'Current status'], [true, 'Ever reached stage']] as const).map(([v, label]) => (
          <button key={label} type="button" onClick={() => setEver(v)} className={cn('rounded-full border px-3 py-1 font-semibold', ever === v ? 'border-primary bg-primary text-white' : 'border-line bg-card text-ink hover:bg-slate-50')}>{label}</button>
        ))}
        {ever && <span className="text-[11px] text-ink-muted">Uses the highest stage seen at any import (history starts with the first import).</span>}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Stages">
          <ul className="space-y-3">
            {([['Total', f.total], ['New / Assigned', stage1], ['Attempted+', f.attempted], ['Connected+', f.connected], ['Positive', f.positive]] as const).map(([label, n], i) => (
              <li key={label}>
                <div className="mb-1 flex justify-between text-body-sm"><span className="font-semibold text-ink"><Label k={label} /></span><span className="tabular-nums text-ink">{num(n)}{i > 0 && <span className="text-ink-muted"> · {pct(f.total ? n / f.total : null)}</span>}</span></div>
                <div className="h-3 overflow-hidden rounded-full bg-slate-100"><div className={cn('h-full rounded-full', label === 'Positive' ? 'bg-success' : 'bg-slate-400')} style={{ width: bar(n) }} /></div>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Rates" info="Percentages beside the stages are the share of total leads. The rates below divide each stage by the one before it.">
          <table className="w-full text-body-sm">
            <thead className="text-[11px] uppercase text-ink-muted"><tr><th className="py-1 text-left">Rate</th><th className="text-left">Formula</th><th className="text-right">Value</th></tr></thead>
            <tbody className="divide-y divide-line">
              {([['Attempt rate', 'Attempted+ ÷ Total', f.attemptRate], ['Connect rate', 'Connected+ ÷ Attempted+', f.connectRate], ['Win rate', 'Positive ÷ Connected+', f.winRate], ['Positive rate', 'Positive ÷ Total', f.positiveRate]] as const).map(([k, form, v]) => (
                <tr key={k}><td className="py-2 font-semibold text-ink"><Label k={k} /></td><td className="text-ink-muted">{form}</td><td className="text-right font-bold tabular-nums text-ink">{pct(v)}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 flex items-center gap-1 text-[11px] text-ink-muted">Which statuses are in each stage
            <InfoTip>Stage 1 New / Assigned: {stagesOf(settings, 1).join(', ')}. Stage 2 Attempted: {stagesOf(settings, 2).join(', ')}. Stage 3 Connected: {stagesOf(settings, 3).join(', ')}. Stage 4 Positive: {stagesOf(settings, 4).join(', ')}. An admin sets this in Settings.</InfoTip>
          </p>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <TopList title="Top industries by leads" segs={top((l) => l.industry)} onPick={(k) => onPick('industry', k)} />
        <TopList title="Top states by leads" segs={top((l) => leadState(l))} onPick={(k) => onPick('state', k)} />
        <TopList title="Status distribution (top 8)" segs={top((l) => l.status).slice(0, 8)} onPick={(k) => onPick('status', k)} />
      </div>

      <Panel
        title={`By ${by}`}
        info={`Rates for groups under ${settings.minSegment} leads show n/a, so small samples don't mislead. Click a row to filter the dashboard by it.`}
        action={
          <div className="flex flex-wrap gap-1">
            {(['state', 'industry', 'region', ...(showReps ? ['rep'] : []), 'status'] as By[]).map((b) => (
              <button key={b} type="button" onClick={() => { setBy(b); pg.setPage(1) }} className={cn('rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize', by === b ? 'bg-primary text-white' : 'bg-slate-100 text-ink-muted hover:text-ink')}>{b}</button>
            ))}
          </div>
        }
      >
        <SegmentTable segs={pg.rows} totals={f} min={settings.minSegment} onPick={by === 'rep' || by === 'region' ? undefined : (k) => onPick(by, k)} />
        <Pager p={pg} />
      </Panel>
    </div>
  )
}

const stagesOf = (s: DialerSettings, stage: number) => Object.entries(s.stageMap).filter(([, v]) => v === stage).map(([k]) => k)

function TopList({ title, segs, onPick }: { title: string; segs: Segment[]; onPick: (k: string) => void }) {
  const max = Math.max(1, ...segs.map((s) => s.leads.length))
  return (
    <Panel title={title}>
      <ul className="space-y-1.5">
        {segs.map((s) => (
          <li key={s.key}>
            <button type="button" onClick={() => onPick(s.key)} className="relative flex w-full items-center justify-between overflow-hidden rounded px-2 py-1 text-left text-body-sm hover:bg-slate-50">
              <span className="absolute inset-y-0 left-0 bg-slate-200/70" style={{ width: `${(s.leads.length / max) * 100}%` }} />
              <span className="relative truncate text-ink">{s.key}</span>
              <span className="relative font-semibold tabular-nums text-ink">{num(s.leads.length)}</span>
            </button>
          </li>
        ))}
        {segs.length === 0 && <li className="text-body-sm text-ink-muted">No data.</li>}
      </ul>
    </Panel>
  )
}

function SegmentTable({ segs, totals, min, onPick, stuck }: { segs: Segment[]; totals?: ReturnType<typeof funnelOf>; min: number; onPick?: (k: string) => void; stuck?: boolean }) {
  const r = (v: number | null, n: number) => (n < min ? 'n/a' : pct(v))
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-body-sm">
        <thead className="text-[11px] uppercase text-ink-muted">
          <tr><th className="px-2 py-2">Name</th><th className="px-2 text-right">Total</th><th className="px-2 text-right">Attempted+</th><th className="px-2 text-right">Connected+</th><th className="px-2 text-right">Positive</th><th className="px-2 text-right">Attempt</th><th className="px-2 text-right">Connect</th><th className="px-2 text-right">Win</th><th className="px-2 text-right">Positive rate</th>{stuck && <th className="px-2 text-right">Stuck</th>}</tr>
        </thead>
        <tbody className="divide-y divide-line">
          {segs.map((s) => {
            const n = s.leads.length
            const cr = s.funnel.connectRate
            return (
              <tr key={s.key} onClick={onPick ? () => onPick(s.key) : undefined} className={cn(onPick && 'cursor-pointer hover:bg-slate-50')}>
                <td className="px-2 py-2 font-semibold text-ink">{s.key}</td>
                <td className="px-2 text-right tabular-nums text-ink">{num(n)}</td>
                <td className="px-2 text-right tabular-nums text-ink">{num(s.funnel.attempted)}</td>
                <td className="px-2 text-right tabular-nums text-ink">{num(s.funnel.connected)}</td>
                <td className="px-2 text-right tabular-nums text-ink">{num(s.funnel.positive)}</td>
                <td className="px-2 text-right tabular-nums text-ink-muted">{r(s.funnel.attemptRate, n)}</td>
                <td className={cn('px-2 text-right tabular-nums', n >= min && cr != null ? (cr >= 0.5 ? 'font-semibold text-success' : cr < 0.4 ? 'font-semibold text-warning' : 'text-ink') : 'text-ink-muted')}>{r(cr, n)}</td>
                <td className="px-2 text-right tabular-nums text-ink-muted">{r(s.funnel.winRate, n)}</td>
                <td className="px-2 text-right tabular-nums text-ink-muted">{r(s.funnel.positiveRate, n)}</td>
                {stuck && <td className={cn('px-2 text-right tabular-nums', s.stuckShare >= 0.5 ? 'font-bold text-danger' : s.stuckShare >= 0.3 ? 'font-semibold text-warning' : 'text-ink-muted')}>{n < min ? 'n/a' : `${Math.round(s.stuckShare * 100)}%`}</td>}
              </tr>
            )
          })}
          {totals && (
            <tr className="bg-slate-50 font-bold">
              <td className="px-2 py-2 text-ink">All leads</td>
              <td className="px-2 text-right tabular-nums text-ink">{num(totals.total)}</td>
              <td className="px-2 text-right tabular-nums text-ink">{num(totals.attempted)}</td>
              <td className="px-2 text-right tabular-nums text-ink">{num(totals.connected)}</td>
              <td className="px-2 text-right tabular-nums text-ink">{num(totals.positive)}</td>
              <td className="px-2 text-right tabular-nums text-ink">{pct(totals.attemptRate)}</td>
              <td className="px-2 text-right tabular-nums text-ink">{pct(totals.connectRate)}</td>
              <td className="px-2 text-right tabular-nums text-ink">{pct(totals.winRate)}</td>
              <td className="px-2 text-right tabular-nums text-ink">{pct(totals.positiveRate)}</td>
              {stuck && <td />}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

/** Industry funnel: every industry with its funnel and how many leads are stuck (tried, not converted). */
export function IndustriesView({ leads, settings, now, showReps, picked, onPickIndustry }: { leads: DialerLead[]; settings: DialerSettings; now: Date; showReps: boolean; picked: string; onPickIndustry: (k: string) => void }) {
  const [min, setMin] = useState(settings.minSegment)
  const live = useMemo(() => leads.filter((l) => !l.duplicate), [leads])
  const all = segments(live, (l) => l.industry ?? '(no industry)')
  const big = all.filter((s) => s.leads.length >= min)
  const small = all.filter((s) => s.leads.length < min)
  const otherLeads = small.flatMap((s) => s.leads)
  const rows = small.length ? [...big, { key: `All other industries (${small.length})`, leads: otherLeads, funnel: funnelOf(otherLeads), stuckShare: otherLeads.length ? otherLeads.filter((l) => l.status === 'Contact Attempted' || l.status === 'Voicemail Sent').length / otherLeads.length : 0 }] : big
  const pickedLeads = picked ? live.filter((l) => (l.industry ?? '(no industry)') === picked) : []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-body-sm">
        <span className="text-ink-muted">Group industries under</span>
        <select value={min} onChange={(e) => setMin(Number(e.target.value))} className="h-8 rounded-full border border-line bg-card px-3 text-body-sm text-ink">
          {[1, 5, 10, 20, 50].map((n) => <option key={n} value={n}>{n === 1 ? 'Show every industry' : `${n} leads`}</option>)}
        </select>
        <span className="text-[11px] text-ink-muted">into "All other", so small samples don't mislead.</span>
      </div>
      <Panel title="Industry funnel" info="Connect rate is green at 50% or more and amber under 40%. Stuck (Contact Attempted + Voicemail Sent) turns amber at 30% and red at 50%: those leads were tried but not converted. Click an industry to see its states and statuses.">
        <SegmentTable segs={rows} totals={funnelOf(live)} min={settings.minSegment} stuck onPick={(k) => { if (!k.startsWith('All other')) onPickIndustry(k) }} />
      </Panel>
      {picked && pickedLeads.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-3">
          <TopList title={`${picked} · states`} segs={segments(pickedLeads.filter((l) => leadState(l)), (l) => leadState(l)!).slice(0, 10)} onPick={() => {}} />
          <TopList title={`${picked} · statuses`} segs={segments(pickedLeads, (l) => l.status).slice(0, 10)} onPick={() => {}} />
          {showReps
            ? <TopList title={`${picked} · reps`} segs={segments(pickedLeads, (l) => l.ownerName || 'Unknown').slice(0, 10)} onPick={() => {}} />
            : <TopList title={`${picked} · regions`} segs={segments(pickedLeads, (l) => leadRegion(l, now) ?? 'No region')} onPick={() => {}} />}
        </div>
      )}
    </div>
  )
}
