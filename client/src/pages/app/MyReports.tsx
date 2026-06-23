import { useEffect, useState } from 'react'
import { FileBarChart } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { SubmissionBadge, type SubmissionStatus } from '../../components/ui/Badge'
import { DataTable, type Column } from '../../components/DataTable'
import { useRange } from '../../components/layout/AppShell'
import { useToast } from '../../components/ui/Toast'
import { formatNumber } from '../../lib/format'
import { getMyReports, type MyReportsData, type ReportRow } from '../../lib/myReportsApi'

const RANGE_LABEL: Record<string, string> = { today: 'Today', week: 'This Week', month: 'This Month', rolling3m: 'Last 3 Months', custom: 'Custom range' }

function statusOf(s: string): SubmissionStatus {
  return s === 'SUBMITTED' ? 'SUBMITTED' : 'ON_LEAVE'
}

export default function MyReports() {
  const { range, custom } = useRange()
  const { addToast } = useToast()
  const [data, setData] = useState<MyReportsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    getMyReports(range, custom)
      .then((res) => active && setData(res))
      .catch(() => active && addToast({ type: 'error', message: 'Could not load your reports.' }))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [range, custom, addToast])

  const columns: Column<ReportRow>[] = data
    ? [
        { key: 'date', header: 'Date', render: (r) => <span className="font-medium tabular-nums text-ink">{r.date}</span> },
        { key: 'status', header: 'Status', render: (r) => <SubmissionBadge status={statusOf(r.status)} /> },
        ...data.columns.map<Column<ReportRow>>((c) => ({
          key: c.key,
          header: c.label,
          align: 'right',
          render: (r) => formatNumber(r.values[c.key] ?? 0),
        })),
      ]
    : []

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-headline-lg text-ink">My Reports</h1>
        <p className="mt-0.5 text-body-md text-ink-muted">Your submission history · {RANGE_LABEL[range] ?? 'This Month'}</p>
      </div>

      {loading || !data ? (
        <div className="text-body-md text-ink-muted">Loading…</div>
      ) : data.columns.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center py-10 text-center">
            <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary"><FileBarChart size={22} /></span>
            <p className="text-headline-md text-ink">No personal reports</p>
            <p className="mt-1 max-w-sm text-body-md text-ink-muted">Your role doesn’t have a daily entry form. Team dashboards show the data you manage.</p>
          </div>
        </Card>
      ) : (
        <Card flush>
          <DataTable
            columns={columns}
            rows={data.rows}
            getRowId={(r) => r.date}
            emptyMessage="No entries in this period yet."
            totalRow={
              data.rows.length
                ? { cells: { date: 'Totals', status: '', ...Object.fromEntries(data.columns.map((c) => [c.key, formatNumber(data.totals[c.key] ?? 0)])) } }
                : undefined
            }
          />
        </Card>
      )}
    </div>
  )
}
