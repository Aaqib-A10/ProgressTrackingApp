import { useEffect, useState } from 'react'
import { Trophy } from 'lucide-react'
import { Card } from './ui/Card'
import { getEmployeeOfMonth, type EmployeeOfMonth } from '../lib/qaApi'

/** Top Achiever per department (by avg QA score, must clear the benchmark). Visible to everyone. */
export function EmployeeOfMonthCard() {
  const [data, setData] = useState<EmployeeOfMonth | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    getEmployeeOfMonth().then(setData).catch(() => setFailed(true))
  }, [])

  if (failed) return null

  const monthLabel = data ? new Date(data.month + '-01T00:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : ''

  return (
    <Card className="border-warning/30 bg-gradient-to-br from-warning/10 to-card">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-btn bg-warning/20 text-warning"><Trophy size={20} /></span>
        <div>
          <p className="text-label-md uppercase tracking-wide text-warning">Top Achiever</p>
          <p className="text-body-sm text-ink-muted">{monthLabel} · by QA score{data ? ` · ${data.minScore}%+ benchmark` : ''}</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(data?.winners ?? [{ department: 'ITAD', winner: null }, { department: 'CSR', winner: null }]).map((w) => (
          <div key={w.department} className="rounded-card border border-line bg-card p-3">
            <p className="text-body-sm font-semibold uppercase text-ink-muted">{w.department}</p>
            {w.winner ? (
              <div className="mt-1 flex items-center justify-between">
                <span className="text-headline-md text-ink">{w.winner.name}</span>
                <span className="text-headline-md font-bold tabular-nums text-warning">{w.winner.avg}%</span>
              </div>
            ) : w.topScore != null ? (
              <p className="mt-1 text-body-md text-ink-muted">
                No top achiever — best was <span className="font-semibold tabular-nums text-ink">{w.topScore}%</span>, below the {data?.minScore ?? 80}% benchmark
              </p>
            ) : (
              <p className="mt-1 text-body-md text-ink-muted">Not enough evaluations yet</p>
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}
