import { useTheme } from '../../lib/theme'
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts'
import { SERIES_COLORS, tooltipStyle } from './chartTheme'

export interface DonutSlice {
  name: string
  value: number
  color?: string
}

export interface DonutChartProps {
  data: DonutSlice[]
  height?: number
  /** Big number shown in the center. */
  centerValue?: string
  centerLabel?: string
}

/** Donut/breakdown chart (e.g. ITAD Activity Breakdown). */
export function DonutChart({ data, height = 200, centerValue, centerLabel }: DonutChartProps) {
  useTheme() // redraw with the new colours when the theme changes
  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="64%" outerRadius="92%" paddingAngle={2} stroke="none">
            {data.map((slice, i) => (
              <Cell key={slice.name} fill={slice.color ?? SERIES_COLORS[i % SERIES_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            {...tooltipStyle()}
          />
        </PieChart>
      </ResponsiveContainer>
      {(centerValue || centerLabel) && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          {centerValue && <span className="text-headline-lg tabular-nums text-ink">{centerValue}</span>}
          {centerLabel && <span className="text-body-sm text-ink-muted">{centerLabel}</span>}
        </div>
      )}
    </div>
  )
}
