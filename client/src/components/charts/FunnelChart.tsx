import { SERIES_COLORS } from './chartTheme'
import { formatNumber, formatPercent } from '../../lib/format'

export interface FunnelStage {
  stage: string
  value: number
}

/** Horizontal pipeline funnel with stage-to-stage conversion (plan §5.3). */
export function FunnelChart({ stages }: { stages: FunnelStage[] }) {
  const max = Math.max(1, ...stages.map((s) => s.value))
  return (
    <div className="space-y-2">
      {stages.map((s, i) => {
        const widthPct = Math.max(6, (s.value / max) * 100)
        const conv = i === 0 ? null : s.value / (stages[i - 1].value || 1)
        const color = SERIES_COLORS[i % SERIES_COLORS.length]
        return (
          <div key={s.stage} className="flex items-center gap-3">
            <div className="w-32 shrink-0 text-body-sm text-ink-muted">{s.stage}</div>
            <div className="flex flex-1 items-center gap-2">
              <div className="h-7 rounded-btn transition-all" style={{ width: `${widthPct}%`, backgroundColor: color }} />
              <span className="text-body-sm font-semibold tabular-nums text-ink">{formatNumber(s.value)}</span>
            </div>
            <div className="w-14 shrink-0 text-right text-body-sm tabular-nums text-ink-muted">
              {conv !== null ? formatPercent(conv, 0) : ''}
            </div>
          </div>
        )
      })}
    </div>
  )
}
