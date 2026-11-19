import { themeColor } from '../../lib/theme'

/**
 * Chart colours from the theme, read when a chart draws, so light and dark both look right.
 * Series colours are mid tones that read on white and on near black.
 */
export const CHART = {
  get primary() { return themeColor('primary') },
  get accent() { return themeColor('accent') },
  get success() { return themeColor('success') },
  get warning() { return themeColor('warning') },
  get danger() { return themeColor('danger') },
  get grid() { return themeColor('line') },
  get axis() { return themeColor('ink-faint') },
  get target() { return themeColor('slate-400') },
  get card() { return themeColor('card') },
  get ink() { return themeColor('ink') },
}

/**
 * Rotating series colors for multi-series charts (stacked bars, donuts): the theme's chart colours (--c-chart-1..6),
 * read when a chart draws, so they follow the theme and dark mode. Indexed like an array: SERIES_COLORS[i % length].
 */
const SERIES_COUNT = 6
export const SERIES_COLORS: readonly string[] = new Proxy(Array.from({ length: SERIES_COUNT }, () => ''), {
  get(target, key, receiver) {
    if (typeof key === 'string' && /^\d+$/.test(key)) return themeColor(`c-chart-${(Number(key) % SERIES_COUNT) + 1}`)
    return Reflect.get(target, key, receiver)
  },
})

/** Recharts tooltip look: a small raised card in the theme colours. */
export const tooltipStyle = () => ({
  contentStyle: {
    background: themeColor('card'),
    border: `1px solid ${themeColor('line')}`,
    borderRadius: 8,
    boxShadow: `0 8px 24px ${themeColor('shadow', 0.12)}`,
    color: themeColor('ink'),
    fontSize: 12,
    padding: '6px 10px',
  },
  labelStyle: { color: themeColor('ink-muted'), marginBottom: 2 },
  itemStyle: { color: themeColor('ink'), padding: 0 },
  cursor: { fill: themeColor('slate-100', 0.6) },
})
