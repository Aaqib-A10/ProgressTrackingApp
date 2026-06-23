import { useState } from 'react'
import { Phone, PhoneCall, Heart, CheckCircle2, Download, Plus } from 'lucide-react'
import { AppShell } from '../components/layout/AppShell'
import { StatCard } from '../components/StatCard'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Badge, SubmissionBadge, PerfFlagBadge, type PerfFlag, type SubmissionStatus } from '../components/ui/Badge'
import { PillFilter } from '../components/ui/PillFilter'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { DataTable, type Column } from '../components/DataTable'
import { TrendLineChart } from '../components/charts/TrendLineChart'
import { DonutChart } from '../components/charts/DonutChart'
import { formatNumber } from '../lib/format'
import type { CurrentUser } from '../lib/types'

const MOCK_USER: CurrentUser = {
  id: 'u1',
  name: 'Alex Rivera',
  email: 'alex@pulsetrack.app',
  role: 'TEAM_LEAD',
  department: 'ITAD',
}

const TREND = [
  { label: 'Mon', value: 980, target: 1000 },
  { label: 'Tue', value: 1120, target: 1000 },
  { label: 'Wed', value: 1040, target: 1000 },
  { label: 'Thu', value: 1180, target: 1000 },
  { label: 'Fri', value: 1284, target: 1000 },
]

const BREAKDOWN = [
  { name: 'Dials', value: 49, color: '#4F46E5' },
  { name: 'LinkedIn', value: 28, color: '#14B8A6' },
  { name: 'Emails', value: 23, color: '#F59E0B' },
]

interface AgentRow {
  id: string
  name: string
  flag: PerfFlag
  status: SubmissionStatus
  dials: number
  connected: number
  interested: number
  closed: number
  onLeave?: boolean
}

const AGENTS: AgentRow[] = [
  { id: 'a1', name: 'Sarah Jenkins', flag: 'EXCEEDING', status: 'SUBMITTED', dials: 124, connected: 52, interested: 32, closed: 8 },
  { id: 'a2', name: 'David Chen', flag: 'OPTIMAL', status: 'SUBMITTED', dials: 168, connected: 32, interested: 24, closed: 6 },
  { id: 'a3', name: 'Jordan Michaels', flag: 'ATTENTION', status: 'ON_LEAVE', dials: 0, connected: 0, interested: 0, closed: 0, onLeave: true },
  { id: 'a4', name: 'Mark Thompson', flag: 'BELOW', status: 'FLAGGED', dials: 45, connected: 9, interested: 4, closed: 0 },
]

export default function ComponentsPreview() {
  const { addToast } = useToast()
  const [modalOpen, setModalOpen] = useState(false)
  const [filter, setFilter] = useState<'all' | 'high' | 'attention'>('all')

  const columns: Column<AgentRow>[] = [
    {
      key: 'name',
      header: 'Agent',
      render: (r) => (
        <div className="flex flex-col">
          <span className="font-medium text-ink">{r.name}</span>
          <span className="mt-0.5"><PerfFlagBadge flag={r.flag} /></span>
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (r) => <SubmissionBadge status={r.status} /> },
    { key: 'dials', header: 'Dials', align: 'right', render: (r) => formatNumber(r.dials) },
    { key: 'connected', header: 'Connected', align: 'right', render: (r) => formatNumber(r.connected) },
    { key: 'interested', header: 'Interested', align: 'right', render: (r) => formatNumber(r.interested) },
    { key: 'closed', header: 'Closed', align: 'right', render: (r) => formatNumber(r.closed) },
  ]

  return (
    <AppShell user={MOCK_USER}>
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <h1 className="text-headline-lg text-ink">ITAD Team View</h1>
          <p className="text-body-md text-ink-muted">Foundation components preview — shell, cards, table, charts.</p>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total Dials" value="1,284" delta={0.125} caption="vs last week" icon={<Phone size={16} />} />
          <StatCard label="Connect Rate" value="32.8%" delta={0.043} caption="Target 30%" icon={<PhoneCall size={16} />} />
          <StatCard label="Interested" value="422" delta={-0.021} caption="vs last week" icon={<Heart size={16} />} />
          <StatCard label="Closed Deals" value="94" delta={0.08} caption="vs last week" icon={<CheckCircle2 size={16} />} />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card title="Dial Velocity" subtitle="Actual vs target" className="lg:col-span-2">
            <TrendLineChart data={TREND} showTargetSeries />
          </Card>
          <Card title="Activity Breakdown">
            <DonutChart data={BREAKDOWN} centerValue="2.4k" centerLabel="Total" />
          </Card>
        </div>

        {/* Improvement summary callout */}
        <Card className="border-primary/20 bg-primary/5">
          <div className="flex items-center justify-between gap-4">
            <p className="text-body-md text-ink">
              <span className="font-semibold">Improvement Summary:</span> Connect rate up 4.3% vs last week. Top performer: Sarah Jenkins, exceeding target by 22%.
            </p>
            <Button variant="ghost" size="sm">View Insight Report</Button>
          </div>
        </Card>

        {/* Data table */}
        <Card
          title="Performance Matrix"
          action={
            <PillFilter
              value={filter}
              onChange={setFilter}
              size="sm"
              options={[
                { value: 'all', label: 'All' },
                { value: 'high', label: 'High Activity' },
                { value: 'attention', label: 'Attention' },
              ]}
            />
          }
          flush
        >
          <DataTable
            columns={columns}
            rows={AGENTS}
            getRowId={(r) => r.id}
            totalRow={{
              cells: { name: 'Team Totals', status: '', dials: '1,284', connected: '421', interested: '422', closed: '94' },
            }}
            renderRowBanner={(r) =>
              r.onLeave ? (
                <div className="flex items-center gap-2 rounded-btn bg-warning/10 px-3 py-1.5 text-body-sm font-medium text-warning">
                  <Badge tone="warning">On Leave</Badge> {r.name} is On Leave / Off today — excluded from averages. Returning Monday.
                </div>
              ) : null
            }
          />
        </Card>

        {/* Buttons + overlays */}
        <Card title="Primitives">
          <div className="flex flex-wrap items-center gap-3">
            <Button leadingIcon={<Plus size={16} />}>Primary</Button>
            <Button variant="secondary" leadingIcon={<Download size={16} />}>Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="secondary" onClick={() => setModalOpen(true)}>Open Modal</Button>
            <Button variant="secondary" onClick={() => addToast({ type: 'success', message: 'Daily entry submitted.' })}>
              Show Toast
            </Button>
            <div className="mx-2 h-6 w-px bg-line" />
            <Badge tone="success" dot>Submitted</Badge>
            <Badge tone="warning" dot>Pending</Badge>
            <Badge tone="danger" dot>Flagged</Badge>
            <Badge tone="primary">Optimal</Badge>
          </div>
        </Card>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Set Daily Target"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={() => { setModalOpen(false); addToast({ type: 'success', message: 'Target saved.' }) }}>Save</Button>
          </>
        }
      >
        <p className="text-body-md text-ink-muted">
          This is a sample modal built from the foundation <code>Modal</code> component (portal, backdrop, escape-to-close).
        </p>
      </Modal>
    </AppShell>
  )
}
