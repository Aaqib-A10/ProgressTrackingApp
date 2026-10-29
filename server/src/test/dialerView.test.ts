import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// The connectors use a copy of the Lead Dialer screen logic. If the screens change, copy again:
// the AI must see the same follow-ups and calling hours as the people do.
describe('server copy of the Lead Dialer logic', () => {
  it('matches client/src/lib/dialer.ts', () => {
    const root = path.resolve(__dirname, '../../..')
    const client = fs.readFileSync(path.join(root, 'client/src/lib/dialer.ts'), 'utf8')
    const server = fs.readFileSync(path.join(root, 'server/src/lib/dialer/view.ts'), 'utf8')
    const body = client.slice(client.indexOf('\n') + 1)
    expect(server.endsWith(body)).toBe(true)
  })
})

import { NO_FILTERS, anyOf, applyFilters, filterLeads, joinMulti, multiLabel, multiOf, toggleMulti, type DialerLead } from '../lib/dialer/view'

// Filters take several values (Industry: Real Estate and Healthcare): any of them matches.
describe('Lead Dialer filters with several values', () => {
  const lead = (id: string, industry: string | null, state: string, status: string): DialerLead =>
    ({ id, industry, state, stateOverride: null, region: 'ET', zoneOverride: null, status, stage: 2, ownerId: 'rep-1', listName: 'CRM', tags: [], duplicate: false, createdAt: '2026-10-01T00:00:00Z', leadDate: null } as unknown as DialerLead)
  const leads = [lead('a', 'Real Estate', 'NY', 'Contact Attempted'), lead('b', 'Healthcare', 'TX', 'Contact Attempted'), lead('c', 'Banking', 'NY', 'Voicemail Sent'), lead('d', null, 'FL', 'Connected')]
  const now = new Date('2026-10-29T15:00:00Z')

  it('keeps several values in one string; one value works as before', () => {
    expect(multiOf(joinMulti(['Real Estate', 'Healthcare', 'Real Estate']))).toEqual(['Real Estate', 'Healthcare'])
    expect(multiOf('Real Estate')).toEqual(['Real Estate'])
    expect(multiOf('')).toEqual([])
    expect(anyOf('', 'x')).toBe(true)
    expect(toggleMulti(toggleMulti('', 'A'), 'B')).toBe(joinMulti(['A', 'B']))
    expect(toggleMulti(joinMulti(['A', 'B']), 'A')).toBe('B')
    expect(multiLabel(joinMulti(['A', 'B']))).toBe('A, B')
  })

  it('dashboard filters: any of the picked industries, states and statuses', () => {
    const ids = (f: Partial<typeof NO_FILTERS>) => applyFilters(leads, { ...NO_FILTERS, ...f }, now).map((l) => l.id)
    expect(ids({ industry: 'Real Estate' })).toEqual(['a'])
    expect(ids({ industry: joinMulti(['Real Estate', 'Healthcare']) })).toEqual(['a', 'b'])
    expect(ids({ industry: joinMulti(['Real Estate', '(no industry)']) })).toEqual(['a', 'd'])
    expect(ids({ industry: joinMulti(['Real Estate', 'Healthcare', 'Banking']), state: 'NY' })).toEqual(['a', 'c'])
    expect(ids({ status: joinMulti(['Voicemail Sent', 'Connected']) })).toEqual(['c', 'd'])
  })

  it('leads list filters too (including stage)', () => {
    const ids = filterLeads(leads, { preset: 'all', state: joinMulti(['TX', 'FL']), stage: joinMulti(['2', '3']) }, now, null).map((l) => l.id)
    expect(ids).toEqual(['b', 'd'])
  })
})
