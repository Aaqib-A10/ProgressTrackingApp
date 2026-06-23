/** Display formatters. Numbers use en-US grouping; pair with `tabular-nums`. */

export function formatNumber(n: number): string {
  return n.toLocaleString('en-US')
}

/** 0.246 -> "24.6%" */
export function formatPercent(fraction: number, decimals = 1): string {
  return `${(fraction * 100).toFixed(decimals)}%`
}

/** +0.125 -> "+12.5%", -0.04 -> "-4.0%" (for ▲/▼ deltas). */
export function formatSignedPercent(fraction: number, decimals = 1): string {
  const pct = (fraction * 100).toFixed(decimals)
  return `${fraction > 0 ? '+' : ''}${pct}%`
}
