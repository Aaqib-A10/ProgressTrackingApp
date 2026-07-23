import { useEffect, useMemo, useState } from 'react'
import { Trophy, Send, FileDown } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { StatCard } from '../../components/StatCard'
import { Button } from '../../components/ui/Button'
import { Badge, type BadgeTone } from '../../components/ui/Badge'
import { useToast } from '../../components/ui/Toast'
import { useAuth } from '../../lib/auth'
import { getMonthlyReport, sendMonthlyReport, monthlyPreviewUrl, type MonthlyReport, type ItadReport, type LeadGenReport } from '../../lib/reportsApi'

type Dept = 'ITAD' | 'LEAD_GEN'
const DEPT_LABEL: Record<Dept, string> = { ITAD: 'ITAD', LEAD_GEN: 'Lead Generation' }

function prevMonth(): string {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function qaTone(v: number | null): BadgeTone {
  if (v === null) return 'neutral'
  if (v >= 82) return 'success'
  if (v >= 64) return 'primary'
  if (v >= 50) return 'warning'
  return 'danger'
}
const pctTxt = (v: number | null) => (v === null ? '—' : `${v}%`)

export default function ReportsMonthly() {
  const { user } = useAuth()
  const { addToast } = useToast()
  const isAdmin = user?.role === 'SUPER_ADMIN'
  const lockedDept = (user?.department as Dept | undefined) // Team Lead is fixed to their dept

  const [dept, setDept] = useState<Dept>(isAdmin ? 'ITAD' : (lockedDept ?? 'ITAD'))
  const [month, setMonth] = useState(prevMonth())
  const [report, setReport] = useState<MonthlyReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)

  async function sendNow() {
    if (sending) return
    setSending(true)
    try {
      const r = await sendMonthlyReport(dept, month)
      addToast({ type: 'success', message: `Report emailed to ${r.recipients.join(', ')}.` })
    } catch (e) {
      const msg = (e as { message?: string })?.message
      addToast({ type: 'error', message: msg || 'Could not send the report.' })
    } finally {
      setSending(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    getMonthlyReport(dept, month)
      .then((r) => setReport(r.report))
      .catch(() => { setReport(null); addToast({ type: 'error', message: 'Could not load the report.' }) })
      .finally(() => setLoading(false))
  }, [dept, month, addToast])

  const maxMonth = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }, [])

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">Monthly Reports</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">Team progress summary — the same report that emails to management each month.</p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <div className="inline-flex gap-1.5">
              {(['ITAD', 'LEAD_GEN'] as Dept[]).map((d) => (
                <button key={d} onClick={() => setDept(d)} className={'rounded-full px-3.5 py-1.5 text-body-md font-medium transition-colors ' + (dept === d ? 'bg-primary text-white' : 'bg-slate-100 text-ink-muted hover:bg-slate-200')}>{DEPT_LABEL[d]}</button>
              ))}
            </div>
          )}
          <input type="month" value={month} max={maxMonth} onChange={(e) => setMonth(e.target.value || prevMonth())} className="h-9 rounded-btn border border-line bg-card px-2.5 text-body-sm text-ink" />
          <Button size="sm" variant="secondary" leadingIcon={<FileDown size={15} />} onClick={() => window.open(monthlyPreviewUrl(dept, month), '_blank', 'noopener')} disabled={loading || !report}>
            Save as PDF
          </Button>
          <Button size="sm" variant="secondary" leadingIcon={<Send size={15} />} onClick={sendNow} disabled={sending || loading || !report}>
            {sending ? 'Sending…' : 'Email to management'}
          </Button>
        </div>
      </div>

      {loading ? (
        <Card><p className="py-10 text-center text-body-md text-ink-muted">Loading…</p></Card>
      ) : !report ? (
        <Card><p className="py-10 text-center text-body-md text-ink-muted">No report available.</p></Card>
      ) : report.department === 'ITAD' ? (
        <ItadView r={report} />
      ) : (
        <LeadGenView r={report} />
      )}
    </div>
  )
}

function ItadView({ r }: { r: ItadReport }) {
  return (
    <div className="space-y-5">
      <p className="text-body-sm font-semibold uppercase tracking-wide text-ink-muted">{DEPT_LABEL.ITAD} · {r.monthLabel}</p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Team avg QA" value={pctTxt(r.team.qaAvg)} delta={r.prev ? r.deltas.qaAvg : undefined} caption={r.prev ? 'vs last month' : `${r.team.qaCount} evals`} />
        <StatCard label="Connect rate" value={`${(r.team.connectRate * 100).toFixed(1)}%`} delta={r.prev ? r.deltas.connectRate : undefined} caption={r.prev ? 'vs last month' : undefined} />
        <StatCard label="Calls dialed" value={r.team.callsDialed.toLocaleString()} delta={r.prev ? r.deltas.callsDialed : undefined} caption={r.prev ? 'vs last month' : undefined} />
        <StatCard label="Closed deals" value={r.team.closed} delta={r.prev ? r.deltas.closed : undefined} caption={r.prev ? 'vs last month' : `${r.team.rfqs} RFQs`} />
      </div>

      {r.topAgent && (
        <Card>
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-warning/10 text-warning"><Trophy size={20} /></span>
            <div>
              <p className="text-label-md uppercase text-ink-muted">Top QA performer</p>
              <p className="text-headline-md text-ink">{r.topAgent.name} · <span className="tabular-nums">{r.topAgent.avg}%</span></p>
            </div>
          </div>
        </Card>
      )}

      <Card title="Per-agent — weekly QA scores & call activity" flush>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-body-sm">
            <thead>
              <tr className="border-b border-line text-left text-label-md uppercase text-ink-muted">
                <th className="px-4 py-2.5 font-semibold">Agent</th>
                {Array.from({ length: r.weeks }, (_, i) => <th key={i} className="px-3 py-2.5 text-right font-semibold">Wk {i + 1}</th>)}
                <th className="px-3 py-2.5 text-right font-semibold">Month QA</th>
                <th className="px-3 py-2.5 text-right font-semibold">Dials</th>
                <th className="px-3 py-2.5 text-right font-semibold">Conn.</th>
                <th className="px-3 py-2.5 text-right font-semibold">Closed</th>
                <th className="px-3 py-2.5 text-right font-semibold">RFQs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {r.agents.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium text-ink">{a.name}</td>
                  {a.weeklyQa.map((w) => (
                    <td key={w.week} className="px-3 py-2.5 text-right tabular-nums text-ink-muted">{w.avg === null ? '·' : `${w.avg}%`}</td>
                  ))}
                  <td className="px-3 py-2.5 text-right"><Badge tone={qaTone(a.monthQaAvg)}>{pctTxt(a.monthQaAvg)}</Badge></td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink">{a.callsDialed.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink">{a.connected.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink">{a.closed}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink">{a.rfqs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function LeadGenView({ r }: { r: LeadGenReport }) {
  return (
    <div className="space-y-5">
      <p className="text-body-sm font-semibold uppercase tracking-wide text-ink-muted">{DEPT_LABEL.LEAD_GEN} · {r.monthLabel}</p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total leads" value={r.team.leads.toLocaleString()} />
        <StatCard label="Qualified (MQL)" value={r.team.mql.toLocaleString()} />
        <StatCard label="Handed (SQL)" value={r.team.sql.toLocaleString()} />
        <StatCard label="MQL → SQL" value={pctTxt(r.team.mqlToSqlRate)} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {r.topAgent && (
          <Card>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-warning/10 text-warning"><Trophy size={20} /></span>
              <div>
                <p className="text-label-md uppercase text-ink-muted">Top by leads</p>
                <p className="text-headline-md text-ink">{r.topAgent.name} · <span className="tabular-nums">{r.topAgent.leads.toLocaleString()}</span></p>
              </div>
            </div>
          </Card>
        )}
        <Card title="Leads by industry">
          {r.topVerticals.length === 0 ? (
            <p className="text-body-sm text-ink-muted">No industry breakdown logged.</p>
          ) : (
            <ul className="space-y-1.5">
              {r.topVerticals.map((v) => (
                <li key={v.name} className="flex items-center justify-between">
                  <span className="text-body-md text-ink">{v.name}</span>
                  <span className="text-body-md font-semibold tabular-nums text-ink">{v.count.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Per-agent — leads & funnel" flush>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-body-sm">
            <thead>
              <tr className="border-b border-line text-left text-label-md uppercase text-ink-muted">
                <th className="px-4 py-2.5 font-semibold">Member</th>
                <th className="px-3 py-2.5 text-right font-semibold">Leads</th>
                <th className="px-3 py-2.5 text-right font-semibold">Researched</th>
                <th className="px-3 py-2.5 text-right font-semibold">Contacts</th>
                <th className="px-3 py-2.5 text-right font-semibold">MQL</th>
                <th className="px-3 py-2.5 text-right font-semibold">SQL</th>
                <th className="px-4 py-2.5 text-left font-semibold">Top industries</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {r.agents.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium text-ink">{a.name}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink">{a.leads.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">{a.accountsResearched.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">{a.contactsFound.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink">{a.mql.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink">{a.sql.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-body-sm text-ink-muted">{a.verticals.slice(0, 3).map((v) => v.name).join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
