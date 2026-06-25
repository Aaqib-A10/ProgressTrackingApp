// Pure, testable QA scorecard scoring — FLAT POINTS model (matches the
// Call Quality Monitoring Form): total = Σ earned ÷ Σ max possible.
//  - Yes/No: Yes = 1 (max 1), No = 0 (max 1), N/A = 0 / 0 (excluded).
//  - Rating: score = value (max = maxScore, default 10), N/A = 0 / 0 (excluded).

export type QaQuestionType = 'RATING' | 'YES_NO'
export type QaBand = 'Unacceptable' | 'Acceptable' | 'Good' | 'Excellent'

export interface ScoredQuestion {
  type: QaQuestionType
  maxScore: number
  criticalFail: boolean
  score: number | null // null when N/A
  isNA: boolean
}
export interface ScoredCategory {
  questions: ScoredQuestion[]
}
export interface Bands {
  passThreshold: number // "Acceptable" line; below = Unacceptable
  bandGood: number
  bandExcellent: number
}
export interface CategoryResult {
  earned: number
  maxPossible: number
  scorePct: number // 0..100
}
export interface QaResult {
  totalScore: number // 0..100, 1dp
  band: QaBand
  passed: boolean
  criticalFailTriggered: boolean
  categories: CategoryResult[]
}

const round1 = (n: number) => Math.round(n * 10) / 10

function earnedOf(q: ScoredQuestion): number {
  if (q.isNA) return 0
  if (q.type === 'YES_NO') return q.score != null && q.score >= 1 ? 1 : 0
  return Math.max(0, Math.min(q.maxScore || 10, q.score ?? 0))
}
function maxOf(q: ScoredQuestion): number {
  if (q.isNA) return 0
  return q.type === 'YES_NO' ? 1 : q.maxScore || 10
}

export function bandFor(total: number, b: Bands): QaBand {
  if (total >= b.bandExcellent) return 'Excellent'
  if (total >= b.bandGood) return 'Good'
  if (total >= b.passThreshold) return 'Acceptable'
  return 'Unacceptable'
}

export function scoreEvaluation(categories: ScoredCategory[], b: Bands): QaResult {
  let criticalFailTriggered = false
  let totalEarned = 0
  let totalMax = 0
  const categoryResults: CategoryResult[] = categories.map((c) => {
    let earned = 0
    let max = 0
    for (const q of c.questions) {
      if (!q.isNA && q.criticalFail && earnedOf(q) <= 0) criticalFailTriggered = true
      earned += earnedOf(q)
      max += maxOf(q)
    }
    totalEarned += earned
    totalMax += max
    return { earned: round1(earned), maxPossible: round1(max), scorePct: max > 0 ? round1((earned / max) * 100) : 0 }
  })

  let total = totalMax > 0 ? (totalEarned / totalMax) * 100 : 0
  if (criticalFailTriggered) total = 0
  total = round1(total)

  return {
    totalScore: total,
    band: bandFor(total, b),
    passed: !criticalFailTriggered && total >= b.passThreshold,
    criticalFailTriggered,
    categories: categoryResults,
  }
}

/** Default-band classifier for cross-scorecard analytics (50 / 64 / 82). */
export function qualityBand(total: number): QaBand {
  return bandFor(total, { passThreshold: 50, bandGood: 64, bandExcellent: 82 })
}
