import type { RangeKey, CustomRange } from '../components/layout/RangeSelector'

/** Builds the `range=…` (plus start/end for custom) query string for API calls. */
export function rangeQuery(range: RangeKey, custom?: CustomRange | null): string {
  if (range === 'custom' && custom) {
    return `range=custom&start=${custom.start}&end=${custom.end}`
  }
  // Custom without applied dates falls back to month.
  return `range=${range === 'custom' ? 'month' : range}`
}
