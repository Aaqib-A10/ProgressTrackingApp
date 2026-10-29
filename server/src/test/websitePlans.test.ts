import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { PLANS } from '../lib/plans'

// The public website (Phase 2) shows the same prices and limits as billing.
describe('website prices', () => {
  it('match the plans billing charges', async () => {
    const site = await import(path.resolve(__dirname, '../../../client/src/pages/marketing/content.ts'))
    for (const p of site.PLANS as { key: keyof typeof PLANS; monthly: number; yearly: number; people: number; storageGb: number; aiHours: number }[]) {
      expect(p, p.key).toMatchObject({ monthly: PLANS[p.key].priceMonthly, yearly: PLANS[p.key].priceYearly, people: PLANS[p.key].people, storageGb: PLANS[p.key].storageGb, aiHours: PLANS[p.key].aiHours })
    }
    expect((site.PLANS as { key: string }[]).map((p) => p.key)).toEqual(['personal', 'starter', 'business'])
  })
})
