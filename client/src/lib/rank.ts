// Mirrors server/src/lib/pm/rank.ts so optimistic drops land where the server will put them.
export const RANK_STEP = 1024

export function rankBetween(before: number | null | undefined, after: number | null | undefined): number {
  const hasBefore = typeof before === 'number' && Number.isFinite(before)
  const hasAfter = typeof after === 'number' && Number.isFinite(after)
  if (hasBefore && hasAfter) return (before! + after!) / 2
  if (hasBefore) return before! + RANK_STEP
  if (hasAfter) return after! - RANK_STEP
  return RANK_STEP
}
