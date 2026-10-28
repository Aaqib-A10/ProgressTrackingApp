import { describe, it, expect } from 'vitest'
import { isLocalDatabase } from '../scripts/demoCompanies'

// Demo companies and the test owner (testuser) are made only on a PC, never on the live server.
describe('local-only scripts', () => {
  it('run only against a database on this computer, never in production', () => {
    expect(isLocalDatabase('postgresql://u:p@localhost:5432/pulsetrack_erp?schema=public', 'development')).toBe(true)
    expect(isLocalDatabase('postgresql://u:p@127.0.0.1/pulsetrack_erp', 'development')).toBe(true)
    expect(isLocalDatabase('postgresql://u:p@localhost:5432/pulsetrack', 'production')).toBe(false)
    expect(isLocalDatabase('postgresql://u:p@db.example.com:5432/pulsetrack', 'development')).toBe(false)
    expect(isLocalDatabase(undefined, 'development')).toBe(false)
  })
})
