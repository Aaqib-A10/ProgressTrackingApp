import { useEffect, useState } from 'react'
import { Trophy } from 'lucide-react'
import { Card } from './ui/Card'
import { cn } from '../lib/cn'
import { getTopAchievers, type TopAchiever } from '../lib/dashboardApi'

/**
 * Top Achiever of the month for YOUR department only (the Super Admin sees every department).
 * Each department is judged on its own work: QA score for ITAD and CSR, leads for Lead
 * Generation, demos for Talkloop, listings for Ecommerce, tasks published for Marketing,
 * requests completed for Inventory.
 */
export function EmployeeOfMonthCard() {
  const [data, setData] = useState<{ month: string; winners: TopAchiever[] } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    getTopAchievers().then(setData).catch(() => setFailed(true))
  }, [])

  if (failed || (data && data.winners.length === 0)) return null

  const monthLabel = data ? new Date(data.month + '-01T00:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : ''
  const winners = data?.winners ?? []
  const one = winners.length === 1 ? winners[0] : null

  return (
    <Card className="border-warning/30 bg-gradient-to-br from-warning/10 to-card">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-btn bg-warning/20 text-warning"><Trophy size={20} /></span>
        <div>
          <p className="text-label-md uppercase tracking-wide text-warning">Top Achiever</p>
          <p className="text-body-sm text-ink-muted">{monthLabel}{one ? ` · ${one.label} · ${one.basis}` : ''}</p>
        </div>
      </div>
      {!data ? (
        <p className="mt-4 text-body-sm text-ink-muted">Loading…</p>
      ) : (
        <div className={cn('mt-4 grid grid-cols-1 gap-3', winners.length > 1 && 'sm:grid-cols-2', winners.length > 2 && 'lg:grid-cols-3')}>
          {winners.map((w) => (
            <div key={w.department} className="rounded-card border border-line bg-card p-3">
              {!one && (
                <>
                  <p className="text-body-sm font-semibold uppercase text-ink-muted">{w.label}</p>
                  <p className="text-[11px] text-ink-muted">{w.basis}</p>
                </>
              )}
              {w.winner ? (
                <div className="mt-1 flex items-center justify-between gap-3">
                  <span className="truncate text-headline-md text-ink">{w.winner.name}</span>
                  <span className="shrink-0 text-headline-md font-bold tabular-nums text-warning">{w.winner.display}</span>
                </div>
              ) : (
                <p className="mt-1 text-body-md text-ink-muted">{w.note ?? 'Nobody yet this month'}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
