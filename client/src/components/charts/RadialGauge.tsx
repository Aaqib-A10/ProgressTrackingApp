import { CHART } from './chartTheme'

export interface RadialGaugeProps {
  /** 0..1 fraction. Values over 1 are clamped to a full ring. */
  value: number
  label: string
  color?: string
  size?: number
}

/** Small circular progress gauge (e.g. "Calls Goal 72%"). */
export function RadialGauge({ value, label, color = CHART.primary, size = 96 }: RadialGaugeProps) {
  const pct = Math.max(0, Math.min(1, value))
  const stroke = 8
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const offset = c * (1 - pct)

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={CHART.grid} strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-headline-md tabular-nums text-ink">
          {Math.round(pct * 100)}%
        </div>
      </div>
      <span className="mt-1.5 text-body-sm text-ink-muted">{label}</span>
    </div>
  )
}
