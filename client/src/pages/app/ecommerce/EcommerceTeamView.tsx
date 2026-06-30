import { useEffect, useState } from 'react'
import { ShoppingCart, Store, Boxes, Users } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { StatCard } from '../../../components/StatCard'
import { Badge, SubmissionBadge } from '../../../components/ui/Badge'
import { DataTable, type Column } from '../../../components/DataTable'
import { useRange } from '../../../components/layout/AppShell'
import { useToast } from '../../../components/ui/Toast'
import { formatNumber } from '../../../lib/format'
import { getEcommerceTeam, type EcommerceTeamResponse, type EcommerceAgentRow } from '../../../lib/ecommerceApi'

const RANGE_LABEL: Record<string, string> = { today: 'Today', week: 'This Week', month: 'This Month', rolling3m: 'Last 3 Months', custom: 'This Month' }

export default function EcommerceTeamView() {
  const { range, custom } = useRange()
  const { addToast } = useToast()
  const [data, setData] = useState<EcommerceTeamResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    getEcommerceTeam(range, custom)
      .then((r) => active && setData(r))
      .catch(() => active && addToast({ type: 'error', message: 'Could not load team data.' }))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [range, custom, addToast])

  const columns: Column<EcommerceAgentRow>[] = [
    { key: 'name', header: 'Agent', render: (r) => <span className="font-medium text-ink">{r.name}</span> },
    { key: 'status', header: 'Status', render: (r) => <SubmissionBadge status={r.status} /> },
    { key: 'daysLogged', header: 'Days', align: 'right', render: (r) => r.daysLogged },
    { key: 'totalListings', header: 'Listings', align: 'right', render: (r) => formatNumber(r.totalListings) },
  ]

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">Ecommerce Team View</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">Listings output & stock overview · {RANGE_LABEL[range] ?? 'This Month'}</p>
        </div>
        {data && <Badge tone="success" dot>Live</Badge>}
      </div>

      {loading || !data ? (
        <Card><p className="py-10 text-center text-body-md text-ink-muted">Loading…</p></Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total listings" value={formatNumber(data.team.totalListings)} icon={<ShoppingCart size={16} />} />
            <StatCard label="Top marketplace" value={data.team.topMarketplace ?? '—'} icon={<Store size={16} />} />
            <StatCard label="Team members" value={data.team.agents} icon={<Users size={16} />} />
            <StatCard to="/app/ecommerce/stock" label="Open stock requests" value={data.team.openStockRequests} icon={<Boxes size={16} />} />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Card title="Per-agent listings" subtitle="Output across the period" flush>
                <DataTable
                  columns={columns}
                  rows={data.agents}
                  getRowId={(r) => r.id}
                  emptyMessage="No team members yet."
                  totalRow={{ cells: { name: 'Team Totals', status: '', daysLogged: '', totalListings: formatNumber(data.team.totalListings) } }}
                  renderRowBanner={(r) => r.onLeaveToday ? (
                    <div className="flex items-center gap-2 rounded-btn bg-warning/10 px-3 py-1.5 text-body-sm font-medium text-warning">
                      <Badge tone="warning">On Leave</Badge>{r.name} is On Leave / Off today.
                    </div>
                  ) : null}
                />
              </Card>
            </div>
            <Card title="Listings by marketplace" subtitle="This period">
              {data.byMarketplace.length === 0 ? (
                <p className="py-8 text-center text-body-sm text-ink-muted">No listings logged.</p>
              ) : (
                <ul className="space-y-2">
                  {data.byMarketplace.map((m) => (
                    <li key={m.name} className="flex items-center justify-between">
                      <span className="text-body-md text-ink">{m.name}</span>
                      <span className="text-body-md font-semibold tabular-nums text-ink">{formatNumber(m.listings)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
