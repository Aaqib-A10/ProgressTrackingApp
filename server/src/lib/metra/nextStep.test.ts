import { describe, expect, it } from 'vitest'
import { nextStepIn } from './nextStep'

// Thursday 5 Nov 2026, 3 PM New York.
const wrote = new Date('2026-11-05T20:00:00Z')
const day = (t: string) => nextStepIn(t, wrote)?.day ?? null

describe('the next step an agent wrote in a note', () => {
  it('reads weekdays, tomorrow, next week, in N days', () => {
    expect(day('Left VM. Will call back Friday.')).toBe('2026-11-06')
    // Written on a Thursday, "Thursday" is the next one.
    expect(day('Will call back Thursday.')).toBe('2026-11-12')
    expect(day('Spoke to CFO, follow up Monday')).toBe('2026-11-09')
    expect(day('Call back tomorrow morning')).toBe('2026-11-06')
    expect(day('Follow up next week about the quote')).toBe('2026-11-09')
    expect(day('Send quote in 3 days')).toBe('2026-11-08')
    expect(day('Try again in two weeks')).toBe('2026-11-19')
  })
  it('reads dates written as 14 Nov, Nov 14 or 11/14 (US)', () => {
    expect(day('Meeting on 14 Nov with IT director')).toBe('2026-11-14')
    expect(day('Call back Nov 20th')).toBe('2026-11-20')
    expect(day('Follow up 11/18')).toBe('2026-11-18')
    expect(day('Follow up Jan 5')).toBe('2027-01-05')
  })
  it('reads Roman Urdu', () => {
    expect(day('Client ko kal call karni hai')).toBe('2026-11-06')
  })
  it('keeps what was said, and ignores dates that are not a next step', () => {
    expect(nextStepIn('Company founded in 1998. Will call back Friday.', wrote)?.said).toBe('Will call back Friday.')
    expect(day('They bought servers on 14 Nov last year')).toBeNull()
    expect(day('Not interested, closed.')).toBeNull()
  })
})
