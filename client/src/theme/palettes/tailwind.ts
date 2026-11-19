import { hex } from '../color'
import type { Hue, HueRamp } from '../roles'

/**
 * Tailwind CSS's own colour scales (MIT), the ones Metriq's screens used before themes. The Metriq theme takes its
 * named hues from here, so tags, notes and categories keep the colours people know.
 */
const ramp = (r: Record<50 | 100 | 200 | 300 | 400 | 500 | 700, string>): HueRamp =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [k, hex(v)])) as unknown as HueRamp

export const TAILWIND_HUES: Record<Hue, HueRamp> = {
  red: ramp({ 50: '#fff1f2', 100: '#ffe4e6', 200: '#fecdd3', 300: '#fda4af', 400: '#fb7185', 500: '#f43f5e', 700: '#be123c' }), // rose
  orange: ramp({ 50: '#fff7ed', 100: '#ffedd5', 200: '#fed7aa', 300: '#fdba74', 400: '#fb923c', 500: '#f97316', 700: '#c2410c' }),
  yellow: ramp({ 50: '#fffbeb', 100: '#fef3c7', 200: '#fde68a', 300: '#fcd34d', 400: '#fbbf24', 500: '#f59e0b', 700: '#b45309' }), // amber
  green: ramp({ 50: '#ecfdf5', 100: '#d1fae5', 200: '#a7f3d0', 300: '#6ee7b7', 400: '#34d399', 500: '#10b981', 700: '#047857' }), // emerald
  teal: ramp({ 50: '#f0fdfa', 100: '#ccfbf1', 200: '#99f6e4', 300: '#5eead4', 400: '#2dd4bf', 500: '#14b8a6', 700: '#0f766e' }),
  blue: ramp({ 50: '#f0f9ff', 100: '#e0f2fe', 200: '#bae6fd', 300: '#7dd3fc', 400: '#38bdf8', 500: '#0ea5e9', 700: '#0369a1' }), // sky
  purple: ramp({ 50: '#f5f3ff', 100: '#ede9fe', 200: '#ddd6fe', 300: '#c4b5fd', 400: '#a78bfa', 500: '#8b5cf6', 700: '#6d28d9' }), // violet
  pink: ramp({ 50: '#fdf4ff', 100: '#fae8ff', 200: '#f5d0fe', 300: '#f0abfc', 400: '#e879f9', 500: '#d946ef', 700: '#a21caf' }), // fuchsia
}
