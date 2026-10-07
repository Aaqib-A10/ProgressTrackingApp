/**
 * Midpoint ranking for drag and drop ordering.
 *
 * Each task stores a float `position` inside its column. Dropping a card between
 * two neighbours gives it the midpoint of their positions, so a move rewrites one
 * row instead of renumbering the whole column. When the gap between neighbours
 * gets too small to split, the caller rebalances the column (see needsRebalance).
 */

export const RANK_STEP = 1024
const MIN_GAP = 1e-6

export function rankBetween(before: number | null | undefined, after: number | null | undefined): number {
  const hasBefore = typeof before === 'number' && Number.isFinite(before)
  const hasAfter = typeof after === 'number' && Number.isFinite(after)
  if (hasBefore && hasAfter) return (before! + after!) / 2
  if (hasBefore) return before! + RANK_STEP
  if (hasAfter) return after! - RANK_STEP
  return RANK_STEP
}

/** True when two neighbouring ranks are too close together to keep splitting. */
export function needsRebalance(before: number | null | undefined, after: number | null | undefined): boolean {
  if (typeof before !== 'number' || typeof after !== 'number') return false
  return Math.abs(after - before) < MIN_GAP * 2
}

/** Evenly spaced positions for n items (used by rebalance + seeding). */
export function evenRanks(n: number): number[] {
  return Array.from({ length: n }, (_, i) => (i + 1) * RANK_STEP)
}
