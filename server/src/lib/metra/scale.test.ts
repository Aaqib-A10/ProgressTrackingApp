import { describe, expect, it } from 'vitest'
import { overCap } from './store'
import { usageOf } from '../../controllers/metraController'
import { wantsAction } from './talk'

// Scale and cost (docs/metra/ROADMAP.md phase 5): how memory is kept under a limit as more companies use Metra, and
// what the admin page says an answer costs and how long it takes.

describe('the indexes of all companies stay under a limit', () => {
  const loaded = [{ id: 'a', count: 300, lastUsed: 100 }, { id: 'b', count: 500, lastUsed: 300 }, { id: 'c', count: 400, lastUsed: 200 }]

  it('nothing is dropped while the total fits', () => {
    expect(overCap(loaded, 1200, 'a')).toEqual([])
  })

  it('past the limit the company nobody asked for the longest goes first, until the total fits', () => {
    expect(overCap(loaded, 1000, 'b')).toEqual(['a'])
    expect(overCap(loaded, 600, 'b')).toEqual(['a', 'c'])
  })

  it('the company being asked right now is never dropped, even when it alone is over the limit', () => {
    expect(overCap(loaded, 700, 'a')).toEqual(['c', 'b'])
    expect(overCap([{ id: 'big', count: 9000, lastUsed: 1 }], 100, 'big')).toEqual([])
  })
})

describe('what an answer costs and how long it takes', () => {
  const rows = [
    { latencyMs: 2000, tokensIn: 5000, tokensOut: 300, tools: [{ name: 'metriq_data', args: {}, ok: true }] },
    { latencyMs: 4000, tokensIn: 7000, tokensOut: 500, tools: [{ name: 'metriq_data', args: {}, ok: true }, { name: 'search_metriq', args: {}, ok: true }, { name: 'answer_check', args: {}, ok: true }] },
    { latencyMs: 9000, tokensIn: 6000, tokensOut: 200, tools: [{ name: 'deal_tracker', args: {}, ok: true }, { name: 'answer_check', args: {}, ok: false }] },
    { latencyMs: null, tokensIn: null, tokensOut: null, tools: null },
  ]

  it('gives the usual and the slow time, tokens and lookups per answer, and what the number check did', () => {
    const u = usageOf(rows, 18000, 1000)
    expect(u.medianSeconds).toBe(4)
    expect(u.slowSeconds).toBe(9)
    expect(u.tokensPerAnswer).toBe(Math.round((5300 + 7500 + 6200) / 3))
    expect(u.lookupsPerAnswer).toBe(1) // 1 + 2 + 1 + 0 over four answers; the check itself is not a lookup
    expect(u.rewritten).toBe(2)
    expect(u.stillUnbacked).toBe(1)
  })

  it('says a cost only when the prices are set', () => {
    delete process.env.METRA_PRICE_IN; delete process.env.METRA_PRICE_OUT
    expect(usageOf(rows, 18000, 1000).cost).toBeNull()
    process.env.METRA_PRICE_IN = '0.5'; process.env.METRA_PRICE_OUT = '2'
    const u = usageOf(rows, 2_000_000, 500_000)
    expect(u.cost).toBe(2) // 2 M x $0.5 + 0.5 M x $2
    expect(u.costPerAnswer).toBe(0.5)
    delete process.env.METRA_PRICE_IN; delete process.env.METRA_PRICE_OUT
  })

  it('no answers yet gives nothing to divide', () => {
    const u = usageOf([], 0, 0)
    expect(u.medianSeconds).toBeNull()
    expect(u.tokensPerAnswer).toBeNull()
    expect(u.rewritten).toBe(0)
  })
})

describe('action cards are offered only when a change is asked for', () => {
  it('a reading question is told apart from a request to change something', () => {
    expect(wantsAction('how many leads were added this month?')).toBe(false)
    expect(wantsAction('add a note to Acme: call back Monday')).toBe(true)
  })
})
