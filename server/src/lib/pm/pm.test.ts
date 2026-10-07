import { describe, it, expect } from 'vitest'
import { rankBetween, needsRebalance, evenRanks, RANK_STEP } from './rank'
import { computeMetrics } from './metrics'
import { fmtDuration } from './pmNotify'
import { TASK_CODE_RE, PROJECT_KEY_RE } from './access'

describe('rank', () => {
  it('midpoint between neighbours, step past the ends', () => {
    expect(rankBetween(1024, 2048)).toBe(1536)
    expect(rankBetween(1024, null)).toBe(1024 + RANK_STEP)
    expect(rankBetween(null, 1024)).toBe(1024 - RANK_STEP)
    expect(rankBetween(null, null)).toBe(RANK_STEP)
  })
  it('flags gaps too small to split', () => {
    expect(needsRebalance(1, 1 + 1e-7)).toBe(true)
    expect(needsRebalance(1, 2)).toBe(false)
    expect(evenRanks(3)).toEqual([1024, 2048, 3072])
  })
})

describe('metrics', () => {
  const d = (s: string) => new Date(s)
  it('on time rate and average days late', () => {
    const rows = [
      { projectId: 'p', dueAt: d('2026-10-05T12:00:00Z'), completedAt: d('2026-10-05T10:00:00Z'), category: 'DONE' as const, assigneeIds: ['u'] },
      { projectId: 'p', dueAt: d('2026-10-05T12:00:00Z'), completedAt: d('2026-10-07T12:00:00Z'), category: 'DONE' as const, assigneeIds: ['u'] },
      { projectId: 'p', dueAt: d('2026-10-01T12:00:00Z'), completedAt: null, category: 'IN_PROGRESS' as const, assigneeIds: ['u'] },
      { projectId: 'p', dueAt: null, completedAt: null, category: 'TODO' as const, assigneeIds: ['u'] },
    ]
    const { summarize } = computeMetrics(rows, d('2026-10-01T00:00:00Z'), d('2026-10-31T00:00:00Z'), d('2026-10-08T00:00:00Z'))
    const s = summarize(rows)
    expect(s).toMatchObject({ open: 2, overdue: 1, completed: 2, completedWithDue: 2, completedOnTime: 1, onTimeRate: 50, avgDaysLate: 2 })
  })
})

describe('helpers', () => {
  it('durations read naturally', () => {
    expect(fmtDuration(30 * 60000)).toBe('30 minutes')
    expect(fmtDuration(2 * 3600000)).toBe('2 hours')
    expect(fmtDuration(3 * 86400000)).toBe('3 days')
  })
  it('task code + key patterns', () => {
    expect('please check RTI-142 today'.match(TASK_CODE_RE)?.[0]).toBe('RTI-142')
    expect(PROJECT_KEY_RE.test('NNT')).toBe(true)
    expect(PROJECT_KEY_RE.test('9AB')).toBe(false)
  })
})
