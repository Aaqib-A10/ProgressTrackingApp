import { useTheme } from '../../lib/theme'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'
import { SERIES_COLORS, CHART, tooltipStyle } from './chartTheme'

export interface StackedSeries {
  key: string
  label: string
  color?: string
}

export interface StackedBarChartProps {
  data: Array<Record<string, string | number>>
  xKey: string
  series: StackedSeries[]
  height?: number
}

/** Stacked bars (e.g. Leads-by-Vertical over time, plan §5.3). */
export function StackedBarChart({ data, xKey, series, height = 260 }: StackedBarChartProps) {
  useTheme() // redraw with the new colours when the theme changes
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={xKey} stroke={CHART.axis} fontSize={12} tickLine={false} axisLine={false} />
        <YAxis stroke={CHART.axis} fontSize={12} tickLine={false} axisLine={false} />
        <Tooltip
          {...tooltipStyle()}
        />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            stackId="a"
            fill={s.color ?? SERIES_COLORS[i % SERIES_COLORS.length]}
            radius={i === series.length - 1 ? [2, 2, 0, 0] : undefined}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}
