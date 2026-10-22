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

/** Rotating series colors for multi-series charts (stacked bars, donuts). */
export const SERIES_COLORS = ['#5E6AD2', '#14A39A', '#E0930F', '#D9558C', '#3B9FE0', '#8B6FD6']

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
