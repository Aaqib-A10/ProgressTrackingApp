/**
 * Pure KPI math — no DB, no Express — so it is trivially unit-testable.
 * Formulas come from Progress_Tracking_App_Plan.md Appendix A.
 *
 * `rate(n, d)` returns a fraction in [0, ∞); callers format as % at the edge.
 * Division by zero yields 0 (a metric with no denominator is "no signal", not NaN).
 */

/** Safe ratio: numerator / denominator, or 0 when denominator is 0. */
export function rate(numerator: number, denominator: number): number {
  if (!denominator) return 0
  return numerator / denominator
}

/** Format a 0..1 fraction as a percentage string, e.g. 0.075 -> "7.5%". */
export function asPercent(fraction: number, decimals = 1): string {
  return `${(fraction * 100).toFixed(decimals)}%`
}

// --- ITAD (Appendix A) ---
export const connectRate = (connected: number, dialed: number) => rate(connected, dialed)
export const voicemailRate = (voicemail: number, dialed: number) => rate(voicemail, dialed)
export const interestRate = (interested: number, connected: number) => rate(interested, connected)
export const rfqConversion = (rfqs: number, interested: number) => rate(rfqs, interested)
export const closeRate = (closed: number, workingOn: number) => rate(closed, workingOn)

// --- Lead Gen (Appendix A) ---
export const leadToQualified = (qualified: number, leads: number) => rate(qualified, leads)
export const mqlToSql = (handedToSql: number, qualified: number) => rate(handedToSql, qualified)
export const contactDiscovery = (contacts: number, accounts: number) => rate(contacts, accounts)

/**
 * Period-over-period delta as a signed fraction (e.g. +0.06 = up 6%).
 * Returns 0 when the previous value is 0 to avoid divide-by-zero blowups.
 */
export function periodDelta(current: number, previous: number): number {
  if (!previous) return 0
  return (current - previous) / previous
}
