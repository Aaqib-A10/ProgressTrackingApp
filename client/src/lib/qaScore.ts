// Client-side mirror of server/src/lib/qa.ts — FLAT POINTS model for live preview.
import type { ScorecardCategory } from './qaApi'

export interface AnswerState {
  score: number | null
  isNA: boolean
}
export type QaBand = 'Unacceptable' | 'Acceptable' | 'Good' | 'Excellent'

function earnedOf(type: 'RATING' | 'YES_NO', maxScore: number, a: AnswerState): number {
  if (a.isNA || a.score === null) return 0
  if (type === 'YES_NO') return a.score >= 1 ? 1 : 0
  return Math.max(0, Math.min(maxScore || 10, a.score))
}
function maxOf(type: 'RATING' | 'YES_NO', maxScore: number, a: AnswerState): number {
  if (a.isNA || a.score === null) return 0
  return type === 'YES_NO' ? 1 : maxScore || 10
}

export interface LiveBands { passThreshold: number; bandGood: number; bandExcellent: number }

export function bandFor(total: number, b: LiveBands): QaBand {
  if (total >= b.bandExcellent) return 'Excellent'
  if (total >= b.bandGood) return 'Good'
  if (total >= b.passThreshold) return 'Acceptable'
  return 'Unacceptable'
}

export interface LiveResult {
  totalScore: number
  band: QaBand
  passed: boolean
  criticalFailTriggered: boolean
  categoryPct: Record<string, number> // categoryId -> 0..100
  categoryPoints: Record<string, { earned: number; max: number }>
  totalEarned: number
  totalMax: number
}

export function computeLiveScore(categories: ScorecardCategory[], answers: Record<string, AnswerState>, bands: LiveBands): LiveResult {
  let criticalFailTriggered = false
  let totalEarned = 0
  let totalMax = 0
  const categoryPct: Record<string, number> = {}
  const categoryPoints: Record<string, { earned: number; max: number }> = {}

  for (const cat of categories) {
    let earned = 0
    let max = 0
    for (const q of cat.questions) {
      const a = answers[q.id] ?? { score: null, isNA: false }
      if (!a.isNA && a.score !== null && q.criticalFail && earnedOf(q.type, q.maxScore, a) <= 0) criticalFailTriggered = true
      earned += earnedOf(q.type, q.maxScore, a)
      max += maxOf(q.type, q.maxScore, a)
    }
    categoryPoints[cat.id] = { earned, max }
    categoryPct[cat.id] = max > 0 ? Math.round((earned / max) * 1000) / 10 : 0
    totalEarned += earned
    totalMax += max
  }

  let total = totalMax > 0 ? (totalEarned / totalMax) * 100 : 0
  if (criticalFailTriggered) total = 0
  total = Math.round(total * 10) / 10

  return { totalScore: total, band: bandFor(total, bands), passed: !criticalFailTriggered && total >= bands.passThreshold, criticalFailTriggered, categoryPct, categoryPoints, totalEarned, totalMax }
}
