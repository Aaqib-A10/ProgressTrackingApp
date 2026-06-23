import { useEffect, useMemo, useState } from 'react'
import { Phone, Heart, CheckCircle2, Target, TrendingUp, Users } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { StatCard } from '../../components/StatCard'
import { Badge, SubmissionBadge, PerfFlagBadge } from '../../components/ui/Badge'
import { DataTable, type Column } from '../../components/DataTable'
import { TrendLineChart, type TrendPoint } from '../../components/charts/TrendLineChart'
import { useRange } from '../../components/layout/AppShell'
import { useToast } from '../../components/ui/Toast'
import { useAuth } from '../../lib/auth'
import { formatNumber, formatPercent } from '../../lib/format'
import { ITAD_METRICS } from '../../lib/itadApi'
import { LEADGEN_METRICS } from '../../lib/leadgenApi'
import { getMemberProfile, type MemberProfileResponse, type MemberEntryRow } from '../../lib/membersApi'

const RANGE_LABEL: Record<string, string> = { today: 'Today', week: 'This Week', month: 'This Month', rolling3m: 'Last 3 Months', custom: 'Custom Range' }

/** A member's own performance analytics — KPIs, trend and daily entries for the selected range. */
export default function MyPerformance() {
  const { user } = useAuth()
  const { range, custom } = useRange()
  const { addToast } = useToast()
  const [data, setData] = useState<MemberProfileResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    let active = true
    setLoading(true)
    getMemberProfile(user.id, range, custom)
      .then((res) => active && setData(res))
      .catch(() => active && addToast({ type: 'error', message: 'Could not load your performance.' }))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [user, range, custom, addToast])

  if (!user) return null

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">My Performance</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">Your own KPIs and trends — {RANGE_LABEL[range] ?? 'This Month'}.</p>
        </div>
        {data?.summary && (
          <div className="flex items-center gap-2">
            <SubmissionBadge status={data.today.status} />
            <PerfFlagBadge flag={data.summary.flag} />
            <Badge tone="neutral">{data.summary.workingDays} working day{data.summary.workingDays === 1 ? '' : 's'}</Badge>
          </div>
        )}
      </div>

      {loading || !data ? (
        <div className="text-body-md text-ink-muted">Loading…</div>
      ) : data.kind === 'NONE' || !data.summary ? (
        <Card>
          <p className="py-10 text-center text-body-md text-ink-muted">
            Your department doesn’t use the daily progress form, so there’s no performance data to chart yet.
          </p>
        </Card>
      ) : data.kind === 'ITAD' ? (
        <ItadView data={data} summary={data.summary} />
      ) : (
        <LeadGenView data={data} summary={data.summary} />
      )}
    </div>
  )
}

type Summary = NonNullable<MemberProfileResponse['summary']>

/** Build a chronological trend series for one metric from the daily entries. */
function trendFor(entries: MemberEntryRow[], metric: string, target?: number): TrendPoint[] {
  return [...entries]
    .reverse() // entries arrive newest-first; charts read left→right oldest→newest
    .map((e) => ({ label: e.date.slice(5), value: Number(e[metric] ?? 0), target }))
}

function ItadView({ data, summary }: { data: MemberProfileResponse; summary: Summary }) {
  const t = summary.totals
  const k = summary.kpis
  const d = data.deltas
  const dailyTarget = summary.target?.dailyDials || undefined
  const trend = useMemo(() => trendFor(data.entries, 'callsDialed', dailyTarget), [data.entries, dailyTarget])
  const columns: Column<MemberEntryRow>[] = [
    { key: 'date', header: 'Date', render: (r) => <span className="font-medium text-ink">{r.date}</span> },
    { key: 'status', header: 'Status', render: (r) => <SubmissionBadge status={r.status === 'SUBMITTED' ? 'SUBMITTED' : 'ON_LEAVE'} /> },
    ...ITAD_METRICS.map((m): Column<MemberEntryRow> => ({ key: m.key, header: m.label, align: 'right', render: (r) => formatNumber(Number(r[m.key] ?? 0)) })),
  ]
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Dials" value={formatNumber(t.callsDialed)} delta={d.callsDialed} caption="vs prev period" icon={<Phone size={16} />} />
        <StatCard label="Connect Rate" value={formatPercent(k.connectRate)} delta={d.connectRate} caption={dailyTarget ? `Target ${dailyTarget}/day` : 'vs prev period'} icon={<TrendingUp size={16} />} />
        <StatCard label="Interested" value={formatNumber(t.interested)} delta={d.interested} caption="vs prev period" icon={<Heart size={16} />} />
        <StatCard label="Closed Deals" value={formatNumber(t.closed)} delta={d.closed} caption="vs prev period" icon={<CheckCircle2 size={16} />} />
      </div>
      <Card title="Dials Trend" subtitle={dailyTarget ? 'Daily dials vs your target' : 'Daily dials over this period'}>
        <TrendLineChart data={trend} targetLine={dailyTarget} />
      </Card>
      <Card title="Daily Entries" subtitle="Each submitted day in this period" flush>
        <DataTable columns={columns} rows={data.entries} getRowId={(r) => r.date} emptyMessage="No entries logged in this period." />
      </Card>
    </>
  )
}

function LeadGenView({ data, summary }: { data: MemberProfileResponse; summary: Summary }) {
  const t = summary.totals
  const k = summary.kpis
  const d = data.deltas
  const dailyTarget = summary.target?.weeklyLeads ? Math.round(summary.target.weeklyLeads / 5) : undefined
  const trend = useMemo(() => trendFor(data.entries, 'leadsGenerated', dailyTarget), [data.entries, dailyTarget])
  const columns: Column<MemberEntryRow>[] = [
    { key: 'date', header: 'Date', render: (r) => <span className="font-medium text-ink">{r.date}</span> },
    { key: 'status', header: 'Status', render: (r) => <SubmissionBadge status={r.status === 'SUBMITTED' ? 'SUBMITTED' : 'ON_LEAVE'} /> },
    ...LEADGEN_METRICS.map((m): Column<MemberEntryRow> => ({ key: m.key, header: m.label, align: 'right', render: (r) => formatNumber(Number(r[m.key] ?? 0)) })),
  ]
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Leads Generated" value={formatNumber(t.leadsGenerated)} delta={d.leadsGenerated} caption="vs prev period" icon={<Target size={16} />} />
        <StatCard label="Qualified (MQL)" value={formatNumber(t.qualifiedMql)} delta={d.qualifiedMql} caption="vs prev period" icon={<Users size={16} />} />
        <StatCard label="MQL → SQL" value={formatPercent(k.mqlToSql)} delta={d.mqlToSql} caption="vs prev period" icon={<TrendingUp size={16} />} />
        <StatCard label="Contacts Found" value={formatNumber(t.contactsFound)} delta={d.contactsFound} caption="vs prev period" icon={<CheckCircle2 size={16} />} />
      </div>
      <Card title="Leads Trend" subtitle={dailyTarget ? 'Daily leads vs your target' : 'Daily leads over this period'}>
        <TrendLineChart data={trend} targetLine={dailyTarget} />
      </Card>
      <Card title="Daily Entries" subtitle="Each submitted day in this period" flush>
        <DataTable columns={columns} rows={data.entries} getRowId={(r) => r.date} emptyMessage="No entries logged in this period." />
      </Card>
    </>
  )
}
