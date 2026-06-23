import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Phone, PhoneCall, Heart, CheckCircle2, Trophy, Download } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { StatCard } from '../../../components/StatCard'
import { Badge, SubmissionBadge, PerfFlagBadge } from '../../../components/ui/Badge'
import { DataTable, type Column } from '../../../components/DataTable'
import { useRange } from '../../../components/layout/AppShell'
import { useToast } from '../../../components/ui/Toast'
import { formatNumber, formatPercent } from '../../../lib/format'
import { downloadTeamCsv } from '../../../lib/reports'
import { getItadTeam, type ItadTeamResponse, type ItadAgentRow } from '../../../lib/itadApi'

const RANGE_LABEL: Record<string, string> = {
  today: 'Today',
  week: 'This Week',
  month: 'This Month',
  rolling3m: 'Last 3 Months',
  custom: 'This Month',
}

export default function ItadTeamView() {
  const { range, custom } = useRange()
  const { addToast } = useToast()
  const navigate = useNavigate()
  const [data, setData] = useState<ItadTeamResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    getItadTeam(range, custom)
      .then((res) => active && setData(res))
      .catch(() => active && addToast({ type: 'error', message: 'Could not load team data.' }))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [range, custom, addToast])

  const columns: Column<ItadAgentRow>[] = [
    {
      key: 'name',
      header: 'Agent',
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
    { key: 'callsDialed', header: 'Dials', align: 'right', render: (r) => formatNumber(r.totals.callsDialed) },
    { key: 'connected', header: 'Conn.', align: 'right', render: (r) => formatNumber(r.totals.connected) },
    { key: 'connectRate', header: 'Conn. %', align: 'right', render: (r) => formatPercent(r.kpis.connectRate) },
    { key: 'voicemail', header: 'VM', align: 'right', render: (r) => formatNumber(r.totals.voicemail) },
    { key: 'emailsSent', header: 'Emails', align: 'right', render: (r) => formatNumber(r.totals.emailsSent) },
    { key: 'interested', header: 'Interested', align: 'right', render: (r) => formatNumber(r.totals.interested) },
    { key: 'workingOn', header: 'Working', align: 'right', render: (r) => formatNumber(r.totals.workingOn) },
    { key: 'closed', header: 'Closed', align: 'right', render: (r) => formatNumber(r.totals.closed) },
    { key: 'rfqs', header: 'RFQs', align: 'right', render: (r) => formatNumber(r.totals.rfqs) },
  ]

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">ITAD Team View</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">
            Real-time performance tracking · {RANGE_LABEL[range] ?? 'This Month'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {data && <Badge tone="success" dot>Live</Badge>}
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={<Download size={16} />}
            onClick={() =>
              downloadTeamCsv(range, 'ITAD', custom).catch(() => addToast({ type: 'error', message: 'Export failed.' }))
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
          {/* KPI cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard to="/app/itad/analytics" label="Total Dials" value={formatNumber(data.team.totals.callsDialed)} delta={data.deltas.callsDialed} caption="vs prev period" icon={<Phone size={16} />} />
            <StatCard
              to="/app/itad/analytics"
              label="Connect Rate"
              value={formatPercent(data.team.kpis.connectRate)}
              delta={data.deltas.connectRate}
              caption={data.target.dailyDials ? `Target ${data.target.dailyDials} dials/day` : 'vs prev period'}
              icon={<PhoneCall size={16} />}
            />
            <StatCard to="/app/itad/analytics" label="Interested" value={formatNumber(data.team.totals.interested)} delta={data.deltas.interested} caption="vs prev period" icon={<Heart size={16} />} />
            <StatCard to="/app/itad/analytics" label="Closed Deals" value={formatNumber(data.team.totals.closed)} delta={data.deltas.closed} caption="vs prev period" icon={<CheckCircle2 size={16} />} />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
            {/* Performance matrix */}
            <div className="lg:col-span-3">
              <Card title="Performance Matrix" subtitle="Per-agent activity with team totals" flush>
                <DataTable
                  columns={columns}
                  rows={data.agents}
                  getRowId={(r) => r.id}
                  onRowClick={(r) => navigate(`/app/members/${r.id}`)}
                  emptyMessage="No agents in this team yet."
                  totalRow={{
                    cells: {
                      name: 'Team Totals',
                      status: '',
                      callsDialed: formatNumber(data.team.totals.callsDialed),
                      connected: formatNumber(data.team.totals.connected),
                      connectRate: formatPercent(data.team.kpis.connectRate),
                      voicemail: formatNumber(data.team.totals.voicemail),
                      emailsSent: formatNumber(data.team.totals.emailsSent),
                      interested: formatNumber(data.team.totals.interested),
                      workingOn: formatNumber(data.team.totals.workingOn),
                      closed: formatNumber(data.team.totals.closed),
                      rfqs: formatNumber(data.team.totals.rfqs),
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

            {/* Top agents */}
            <div>
              <Card title="Top Agents" subtitle="By dials this period">
                <ul className="space-y-3">
                  {data.topAgents.map((a, i) => (
                    <li key={a.id} className="flex items-center gap-3">
                      <span className={'flex h-7 w-7 items-center justify-center rounded-full text-body-sm font-semibold ' + (i === 0 ? 'bg-warning/15 text-warning' : 'bg-slate-100 text-ink-muted')}>
                        {i === 0 ? <Trophy size={14} /> : i + 1}
                      </span>
                      <span className="flex-1 truncate text-body-md text-ink">{a.name}</span>
                      <span className="text-body-md font-semibold tabular-nums text-ink">{formatNumber(a.dials)}</span>
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
