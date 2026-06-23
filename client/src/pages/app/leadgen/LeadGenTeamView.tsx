import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, BadgeCheck, Send, Contact, Trophy, Download } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { StatCard } from '../../../components/StatCard'
import { Badge, SubmissionBadge, PerfFlagBadge } from '../../../components/ui/Badge'
import { DataTable, type Column } from '../../../components/DataTable'
import { StackedBarChart } from '../../../components/charts/StackedBarChart'
import { FunnelChart } from '../../../components/charts/FunnelChart'
import { useRange } from '../../../components/layout/AppShell'
import { useToast } from '../../../components/ui/Toast'
import { formatNumber, formatPercent } from '../../../lib/format'
import { downloadTeamCsv } from '../../../lib/reports'
import { getLeadGenTeam, type LeadGenTeamResponse, type LeadGenAgentRow } from '../../../lib/leadgenApi'

const RANGE_LABEL: Record<string, string> = {
  today: 'Today',
  week: 'This Week',
  month: 'This Month',
  rolling3m: 'Last 3 Months',
  custom: 'This Month',
}

export default function LeadGenTeamView() {
  const { range, custom } = useRange()
  const { addToast } = useToast()
  const navigate = useNavigate()
  const [data, setData] = useState<LeadGenTeamResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    getLeadGenTeam(range, custom)
      .then((res) => active && setData(res))
      .catch(() => active && addToast({ type: 'error', message: 'Could not load team data.' }))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [range, custom, addToast])

  const columns: Column<LeadGenAgentRow>[] = [
    {
      key: 'name',
      header: 'Member',
      render: (r) => (
        <div className="flex flex-col">
          <span className="font-medium text-ink">{r.name}</span>
          <span className="mt-0.5">
            <PerfFlagBadge flag={r.flag} />
          </span>
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (r) => <SubmissionBadge status={r.status} /> },
    { key: 'leadsGenerated', header: 'Leads', align: 'right', render: (r) => formatNumber(r.totals.leadsGenerated) },
    { key: 'accountsResearched', header: 'Researched', align: 'right', render: (r) => formatNumber(r.totals.accountsResearched) },
    { key: 'contactsFound', header: 'Contacts', align: 'right', render: (r) => formatNumber(r.totals.contactsFound) },
    { key: 'qualifiedMql', header: 'Qualified', align: 'right', render: (r) => formatNumber(r.totals.qualifiedMql) },
    { key: 'handedToSql', header: 'Handed', align: 'right', render: (r) => formatNumber(r.totals.handedToSql) },
    { key: 'leadToQualified', header: 'L→Q %', align: 'right', render: (r) => formatPercent(r.kpis.leadToQualified) },
    { key: 'mqlToSql', header: 'MQL→SQL %', align: 'right', render: (r) => formatPercent(r.kpis.mqlToSql) },
  ]

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">Lead Gen Team View</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">Pipeline & vertical performance · {RANGE_LABEL[range] ?? 'This Month'}</p>
        </div>
        <div className="flex items-center gap-3">
          {data && <Badge tone="success" dot>Live</Badge>}
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={<Download size={16} />}
            onClick={() =>
              downloadTeamCsv(range, 'LEAD_GEN', custom).catch(() => addToast({ type: 'error', message: 'Export failed.' }))
            }
          >
            Export CSV
          </Button>
        </div>
      </div>

      {loading || !data ? (
        <div className="text-body-md text-ink-muted">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard to="/app/leadgen/analytics" label="Total Leads" value={formatNumber(data.team.totals.leadsGenerated)} delta={data.deltas.leadsGenerated} caption={data.target.weeklyLeads ? `Target ${data.target.weeklyLeads}/wk` : 'vs prev period'} icon={<Users size={16} />} />
            <StatCard to="/app/leadgen/analytics" label="Qualified (MQL)" value={formatNumber(data.team.totals.qualifiedMql)} delta={data.deltas.qualifiedMql} caption="vs prev period" icon={<BadgeCheck size={16} />} />
            <StatCard to="/app/leadgen/analytics" label="MQL → SQL" value={formatPercent(data.team.kpis.mqlToSql)} delta={data.deltas.mqlToSql} caption="vs prev period" icon={<Send size={16} />} />
            <StatCard to="/app/leadgen/analytics" label="Contacts Found" value={formatNumber(data.team.totals.contactsFound)} delta={data.deltas.contactsFound} caption="vs prev period" icon={<Contact size={16} />} />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card title="Leads by Vertical" subtitle="Volume over time">
              {data.byVertical.data.length ? (
                <StackedBarChart data={data.byVertical.data} xKey="label" series={data.byVertical.series} />
              ) : (
                <p className="py-10 text-center text-body-sm text-ink-muted">No vertical data in this period.</p>
              )}
            </Card>
            <Card title="Lead Pipeline" subtitle="Researched → Handed to Sales">
              <FunnelChart stages={data.funnel} />
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
            <div className="lg:col-span-3">
              <Card title="Team Performance Matrix" subtitle="Per-member pipeline with team totals" flush>
                <DataTable
                  columns={columns}
                  rows={data.agents}
                  getRowId={(r) => r.id}
                  onRowClick={(r) => navigate(`/app/members/${r.id}`)}
                  emptyMessage="No members in this team yet."
                  totalRow={{
                    cells: {
                      name: 'Team Totals',
                      status: '',
                      leadsGenerated: formatNumber(data.team.totals.leadsGenerated),
                      accountsResearched: formatNumber(data.team.totals.accountsResearched),
                      contactsFound: formatNumber(data.team.totals.contactsFound),
                      qualifiedMql: formatNumber(data.team.totals.qualifiedMql),
                      handedToSql: formatNumber(data.team.totals.handedToSql),
                      leadToQualified: formatPercent(data.team.kpis.leadToQualified),
                      mqlToSql: formatPercent(data.team.kpis.mqlToSql),
                    },
                  }}
                  renderRowBanner={(r) =>
                    r.onLeaveToday ? (
                      <div className="flex items-center gap-2 rounded-btn bg-warning/10 px-3 py-1.5 text-body-sm font-medium text-warning">
                        <Badge tone="warning">On Leave</Badge>
                        {r.name} is On Leave / Off today — excluded from averages.
                      </div>
                    ) : null
                  }
                />
              </Card>
            </div>
            <div>
              <Card title="Top Performers" subtitle="By leads this period">
                <ul className="space-y-3">
                  {data.topAgents.map((a, i) => (
                    <li key={a.id} className="flex items-center gap-3">
                      <span className={'flex h-7 w-7 items-center justify-center rounded-full text-body-sm font-semibold ' + (i === 0 ? 'bg-warning/15 text-warning' : 'bg-slate-100 text-ink-muted')}>
                        {i === 0 ? <Trophy size={14} /> : i + 1}
                      </span>
                      <span className="flex-1 truncate text-body-md text-ink">{a.name}</span>
                      <span className="text-body-md font-semibold tabular-nums text-ink">{formatNumber(a.leads)}</span>
                    </li>
                  ))}
                  {data.topAgents.length === 0 && <li className="text-body-sm text-ink-muted">No activity yet.</li>}
                </ul>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
