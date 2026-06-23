import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts'
import { CHART } from './chartTheme'

export interface TrendPoint {
  label: string
  value: number
  target?: number
}

export interface TrendLineChartProps {
  data: TrendPoint[]
  height?: number
  color?: string
  /** Draw a horizontal target reference line at this value. */
  targetLine?: number
  /** Draw a per-point dashed target series instead of a flat line. */
  showTargetSeries?: boolean
}

/** KPI trend over time with optional target reference (plan §7.2). */
export function TrendLineChart({
  data,
  height = 240,
  color = CHART.primary,
  targetLine,
  showTargetSeries,
}: TrendLineChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" stroke={CHART.axis} fontSize={12} tickLine={false} axisLine={false} />
        <YAxis stroke={CHART.axis} fontSize={12} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{
            borderRadius: 12,
            border: `1px solid ${CHART.grid}`,
            fontSize: 12,
            boxShadow: '0 10px 15px -3px rgba(15,23,42,0.08)',
          }}
        />
        {targetLine !== undefined && (
          <ReferenceLine y={targetLine} stroke={CHART.target} strokeDasharray="4 4" />
        )}
        {showTargetSeries && (
          <Line
            type="monotone"
            dataKey="target"
            stroke={CHART.target}
            strokeDasharray="4 4"
            strokeWidth={2}
            dot={false}
          />
        )}
        <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}
