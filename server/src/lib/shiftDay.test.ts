import { describe, it, expect } from 'vitest'
import { DateTime } from 'luxon'
import { isOvernight, shiftDayString, type ShiftWindow } from './shiftDay'

const nightPacific: ShiftWindow = { startTime: '19:00', endTime: '04:00', timeZone: 'America/Los_Angeles' }
const dayPacific: ShiftWindow = { startTime: '09:00', endTime: '18:00', timeZone: 'America/Los_Angeles' }
const dayCompany: ShiftWindow = { startTime: '09:00', endTime: '18:00', timeZone: null }

const at = (iso: string, zone: string) => DateTime.fromISO(iso, { zone }).toJSDate()

describe('isOvernight', () => {
  it('flags shifts whose end is at/before their start', () => {
    expect(isOvernight(nightPacific)).toBe(true)
    expect(isOvernight(dayPacific)).toBe(false)
  })
})

describe('shiftDayString — overnight anchoring', () => {
  it('anchors the evening check-in to the shift start date', () => {
    // 21:00 Pacific on the 10th -> the 10th
    expect(shiftDayString(nightPacific, at('2026-07-10T21:00', 'America/Los_Angeles'))).toBe('2026-07-10')
  })

  it('keeps a post-midnight check-out on the SAME (start) date', () => {
    // 02:00 Pacific on the 11th is still the shift that started the evening of the 10th
    expect(shiftDayString(nightPacific, at('2026-07-11T02:00', 'America/Los_Angeles'))).toBe('2026-07-10')
  })

  it('resolves the boundary in the shift timezone, not company time', () => {
    // 23:00 Pacific on the 10th is already noon on the 11th in Karachi (company tz).
    // A Pacific shift must file this under the 10th; a company-tz shift under the 11th.
    const instant = at('2026-07-10T23:00', 'America/Los_Angeles')
    expect(shiftDayString(dayPacific, instant)).toBe('2026-07-10')
    expect(shiftDayString(dayCompany, instant)).toBe('2026-07-11')
  })
})

describe('shiftDayString — day shift', () => {
  it('is just the local calendar date', () => {
    expect(shiftDayString(dayPacific, at('2026-07-10T14:00', 'America/Los_Angeles'))).toBe('2026-07-10')
    // Early-morning day-shift hours are NOT rolled back (only overnight shifts roll).
    expect(shiftDayString(dayPacific, at('2026-07-10T02:00', 'America/Los_Angeles'))).toBe('2026-07-10')
  })
})
