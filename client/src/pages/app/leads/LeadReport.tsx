import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardPen, Users } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { EmptyState } from '../../../components/ui/EmptyState'
import { TextField, TextArea } from '../../../components/ui/Input'
import { useToast } from '../../../components/ui/Toast'
import { apiErrorText } from '../../../lib/api'
import { cn } from '../../../lib/cn'
import { fmtDate, fmtWhen, leadsApi, leadTitle, toYmd, type DayCounts, type DailyReport } from '../../../lib/leadsApi'
import { BusinessPicker, PageHeader, useBusiness, useLeadsMeta } from './shared'

const FIELDS: { key: keyof Omit<DayCounts, 'shortConnected'>; label: string; hint: string }[] = [
  { key: 'dials', label: 'Dials', hint: 'Calls placed' }, { key: 'connected', label: 'Connected', hint: 'Answered, long enough to count' }, { key: 'voicemails', label: 'Voicemails', hint: 'Messages left' },
  { key: 'emails', label: 'Emails', hint: 'Info and follow-up emails' }, { key: 'interested', label: 'Interested', hint: 'Moved to Info Sent, Follow Up or Qualified' },
]

/** The CMR daily report: the five numbers counted from the day's calls, corrected and submitted; managers see every rep and the review list. */
export default function LeadReport() {
  const { addToast } = useToast()
  const { meta } = useLeadsMeta()
  const { business, businesses } = useBusiness()
  const cmrBiz = businesses.filter((b) => b.kind === 'CMR')
  const biz = business?.kind === 'CMR' ? business : cmrBiz[0] ?? null
  const canManage = !!meta?.me.admin || biz?.myRole === 'MANAGER'
  const [date, setDate] = useState(toYmd(new Date()))
  const [tab, setTab] = useState<'mine' | 'team'>('mine')
  const [mine, setMine] = useState<{ counted: DayCounts; report: DailyReport | null; connectedSecs: number } | null>(null)
  const [f, setF] = useState<Record<string, number>>({})
  const [note, setNote] = useState('')
  const [team, setTeam] = useState<Awaited<ReturnType<typeof leadsApi.teamReport>> | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    if (!biz) return
    leadsApi.report({ business: biz.id, date }).then((r) => { setMine(r); const src = r.report ?? r.counted; setF({ dials: src.dials, connected: src.connected, voicemails: src.voicemails, emails: src.emails, interested: src.interested }); setNote(r.report?.note ?? '') }).catch((e) => addToast({ type: 'error', message: apiErrorText(e, 'Could not load') }))
    if (canManage) leadsApi.teamReport({ business: biz.id, date }).then(setTeam).catch(() => setTeam(null))
  }, [biz, date, canManage, addToast])
  useEffect(() => { load() }, [load])

  if (!cmrBiz.length) return <div className="mx-auto max-w-xl py-16"><EmptyState icon={<ClipboardPen />} title="No CMR business yet" hint="The daily report belongs to a CMR-kind business. Make one under Lead Settings." /></div>

  const submit = async () => {
    if (!biz) return
    setBusy(true)
    try { await leadsApi.submitReport({ business: biz.id, date, dials: f.dials ?? 0, connected: f.connected ?? 0, voicemails: f.voicemails ?? 0, emails: f.emails ?? 0, interested: f.interested ?? 0, note: note.trim() || undefined }); addToast({ type: 'success', message: 'Report submitted' }); load() } catch (e) { addToast({ type: 'error', message: apiErrorText(e, 'Could not submit') }) } finally { setBusy(false) }
  }

  return (
    <div className="mx-auto w-full max-w-[1300px] space-y-4">
      <PageHeader title="Daily Report" hint={`${biz?.name ?? ''} · counted from the calls; correct a number if it is wrong and say why.`} actions={<><TextField type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" aria-label="Date" />{cmrBiz.length > 1 && <BusinessPicker />}</>} />
      {canManage && <div className="inline-flex rounded-btn border border-line bg-card p-0.5">{(['mine', 'team'] as const).map((k) => <button key={k} type="button" onClick={() => setTab(k)} className={cn('h-8 rounded-md px-3 text-body-sm font-semibold', tab === k ? 'bg-ink text-card' : 'text-ink-muted')}>{k === 'mine' ? 'My report' : 'Team and review'}</button>)}</div>}

      {tab === 'mine' && mine && (
        <section className="rounded-card border border-line bg-card p-5 shadow-xs">
          <div className="grid gap-3 sm:grid-cols-5">
            {FIELDS.map((x) => (
              <div key={x.key} className="rounded-card border border-line p-3">
                <div className="text-body-sm font-medium text-ink">{x.label}</div>
                <input type="number" min={0} value={f[x.key] ?? 0} onChange={(e) => setF({ ...f, [x.key]: Math.max(0, Number(e.target.value) || 0) })} className="mt-1 w-full bg-transparent text-[26px] font-bold tabular-nums text-ink focus:outline-none" aria-label={x.label} />
                <div className="text-[11px] text-ink-faint">{x.hint}</div>
                <div className={cn('mt-1 text-[11.5px]', (f[x.key] ?? 0) !== mine.counted[x.key] ? 'font-semibold text-warning' : 'text-ink-muted')}>Metriq counted {mine.counted[x.key]}</div>
              </div>
            ))}
          </div>
          {mine.counted.shortConnected > 0 && <p className="mt-3 text-body-sm text-ink-muted">{mine.counted.shortConnected} connected call{mine.counted.shortConnected === 1 ? '' : 's'} under {mine.connectedSecs} s not counted as connected.</p>}
          <TextArea label="Note (needed when you change a number)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} className="mt-3" />
          <div className="mt-4 flex items-center justify-between">
            <span className="text-body-sm text-ink-muted">{mine.report ? `Submitted ${fmtWhen(mine.report.submittedAt)} · re-submitting updates it` : 'Not submitted yet for this day'}</span>
            <Button disabled={busy || (FIELDS.some((x) => (f[x.key] ?? 0) !== mine.counted[x.key]) && !note.trim())} onClick={submit}>{mine.report ? 'Update report' : 'Submit report'}</Button>
          </div>
        </section>
      )}

      {tab === 'team' && team && (
        <div className="space-y-4">
          <section className="overflow-hidden rounded-card border border-line bg-card shadow-xs">
            <header className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-[14px] font-semibold text-ink"><Users size={15} className="text-ink-faint" />Team · {fmtDate(team.date)}</header>
            <table className="w-full text-left text-body-sm">
              <thead className="bg-slate-50 text-[11.5px] uppercase tracking-wide text-ink-muted dark:bg-white/[0.03]"><tr><th className="px-3 py-2 font-semibold">SDR</th>{FIELDS.map((x) => <th key={x.key} className="px-3 py-2 text-right font-semibold">{x.label}</th>)}<th className="px-3 py-2 font-semibold">Submitted</th></tr></thead>
              <tbody className="divide-y divide-line">
                {team.rows.map((r) => <tr key={r.sdr.id}><td className="px-3 py-2 font-medium text-ink">{r.sdr.name}</td>{FIELDS.map((x) => { const v = r.report ? r.report[x.key] : r.counted[x.key]; const diff = r.report && r.report[x.key] !== r.counted[x.key]; return <td key={x.key} className="px-3 py-2 text-right tabular-nums text-ink">{v}{diff && <span className="ml-1 text-[11px] text-warning" title={`Metriq counted ${r.counted[x.key]}`}>({r.counted[x.key]})</span>}</td> })}<td className="px-3 py-2">{r.report ? <Badge tone="success">{fmtWhen(r.report.submittedAt)}</Badge> : <Badge tone="warning">Not yet</Badge>}</td></tr>)}
                {!team.rows.length && <tr><td colSpan={7} className="px-3 py-6 text-center text-ink-muted">No reps in this business yet.</td></tr>}
              </tbody>
            </table>
          </section>
          <section className="grid gap-4 lg:grid-cols-2">
            <Review title="Qualified leads to approve" rows={team.review.toApprove.map((l) => ({ id: l.id, text: leadTitle(l), sub: l.jesseAsk ?? '' }))} empty="None waiting." />
            <Review title="Overdue next steps" rows={team.review.overdue.map((l) => ({ id: l.id, text: leadTitle(l), sub: `${l.nextStep ?? ''} · ${fmtDate(l.nextStepDate)} · ${l.assignee?.name ?? 'unassigned'}` }))} empty="Nothing overdue." tone="danger" />
            <Review title="Meetings without an outcome" rows={team.review.outcomeDue.map((l) => ({ id: l.id, text: leadTitle(l), sub: `met ${fmtWhen(l.meetingAt)} · ${l.assignee?.name ?? ''}` }))} empty="All outcomes logged." />
            <Review title={`Connected calls under ${mine?.connectedSecs ?? 30} s, or with no summary`} rows={[...team.review.shortConnected.map((c) => ({ id: c.lead.id, text: c.lead.organization || c.lead.name, sub: `${c.user?.name ?? ''} · ${c.durationSec} s · ${fmtWhen(c.at)}` })), ...team.review.noSummary.map((c) => ({ id: c.lead.id, text: c.lead.organization || c.lead.name, sub: `${c.user?.name ?? ''} · no summary · ${fmtWhen(c.at)}` }))]} empty="Every connected call has a summary and a real length." />
          </section>
        </div>
      )}
    </div>
  )
}

function Review({ title, rows, empty, tone }: { title: string; rows: { id: string; text: string; sub: string }[]; empty: string; tone?: 'danger' }) {
  return (
    <section className="rounded-card border border-line bg-card shadow-xs">
      <header className="flex items-center justify-between border-b border-line px-4 py-2.5 text-[14px] font-semibold text-ink">{title}<span className={cn('rounded-full px-2 text-[11px]', rows.length && tone === 'danger' ? 'bg-danger/10 text-danger' : 'bg-slate-100 text-ink-muted dark:bg-white/10')}>{rows.length}</span></header>
      {rows.length ? <ul className="divide-y divide-line">{rows.slice(0, 20).map((r, i) => <li key={`${r.id}-${i}`} className="px-4 py-2 text-body-sm"><Link to={`/app/leads/${r.id}`} className="font-medium text-ink hover:underline">{r.text}</Link><div className="text-[11.5px] text-ink-muted">{r.sub}</div></li>)}</ul> : <p className="px-4 py-4 text-body-sm text-ink-muted">{empty}</p>}
    </section>
  )
}
