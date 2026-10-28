import { describe, it, expect } from 'vitest'
import { csvCell, csvRow } from '../scripts/exportTalkloop'

// Talkloop is removed (Oct 2026); its data is saved to CSV first. Values with commas, quotes or
// line breaks must survive a round trip into Excel.
describe('Talkloop CSV export', () => {
  it('writes cells Excel reads back as they were', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(42)).toBe('42')
    expect(csvCell(new Date('2026-10-20T00:00:00Z'))).toBe('2026-10-20')
    expect(csvCell('Ali, Khan')).toBe('"Ali, Khan"')
    expect(csvCell('said "yes"')).toBe('"said ""yes"""')
    expect(csvCell('line one\nline two')).toBe('"line one\nline two"')
    expect(csvRow(['2026-10-20', 'Sara', 50, null])).toBe('2026-10-20,Sara,50,')
  })
})
