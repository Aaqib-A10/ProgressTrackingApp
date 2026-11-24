import { describe, it, expect } from 'vitest'
import { periodAsked, periodIn, resolvePeriod } from './period'
import { aboutMe, ctxOf } from './index'
import { period } from './load'
import type { Asker } from '../access'

// Tuesday 24 Nov 2026 on the company's clock (the night shift of Monday 23 is still going at 2:57 am).
const TODAY = '2026-11-24'
const ZONE = 'Asia/Karachi'
const dates = (q: string, earlier = '', follow = false) => { const p = periodAsked(q, earlier, follow); return p ? (({ from, to }) => `${from}..${to}`)(resolvePeriod(p, TODAY, ZONE)) : null }

describe('the period in the person\'s own words', () => {
  it('reads "last week" as Monday to Sunday of the week before this one (24 Nov 2026: it was read as one day)', () => {
    expect(dates('tell me about my attendance from the last week')).toBe('2026-11-16..2026-11-22')
    expect(dates('pichle hafte meri attendance kaisi thi')).toBe('2026-11-16..2026-11-22')
    expect(dates('previous week')).toBe('2026-11-16..2026-11-22')
  })

  it('reads the follow-up "previous week" after "last week" as the week before last, not the same week again', () => {
    expect(dates('ok what about the previous week ', 'tell me about my attendance from the last week', true)).toBe('2026-11-09..2026-11-15')
    expect(dates('and the week before?', 'my attendance last week', true)).toBe('2026-11-09..2026-11-15')
  })

  it('keeps the earlier period when a follow-up names none', () => {
    expect(dates('and Ali?', 'how many days was the team late last month', true)).toBe('2026-10-01..2026-10-31')
  })

  it('reads this week, this month, yesterday, today and a number of days', () => {
    expect(dates('my attendance this week')).toBe('2026-11-23..2026-11-29')
    expect(resolvePeriod(periodIn('this week')!, TODAY, ZONE).current).toBe(true)
    expect(resolvePeriod(periodIn('last week')!, TODAY, ZONE).current).toBe(false)
    expect(dates('how many leads this month')).toBe('2026-11-01..2026-11-30')
    expect(dates('was I late yesterday')).toBe('2026-11-23..2026-11-23')
    expect(dates('who is late today')).toBe('2026-11-24..2026-11-24')
    expect(dates('hours in the last 7 days')).toBe('2026-11-18..2026-11-24')
    expect(dates('meetings in the next 7 days')).toBe('2026-11-24..2026-11-30')
    expect(dates('the week before last')).toBe('2026-11-09..2026-11-15')
    expect(dates('last month')).toBe('2026-10-01..2026-10-31')
  })

  it('finds no period where none is named', () => {
    expect(periodIn('what is Ali\'s email?')).toBeNull()
    expect(periodIn('who is on my team')).toBeNull()
  })

  it('labels the period with its dates', () => {
    expect(resolvePeriod(periodIn('last week')!, TODAY, ZONE).label).toBe('last week (Mon 16 Nov 2026 to Sun 22 Nov 2026)')
  })
})

describe('a question about the asker themself', () => {
  it('is about me when it says my / I and names no one else', () => {
    expect(aboutMe('tell me about my attendance from the last week')).toBe(true)
    expect(aboutMe('was I late yesterday')).toBe(true)
    expect(aboutMe('meri attendance')).toBe(true)
  })
  it('is not about me when it is about the team or another person', () => {
    expect(aboutMe('show me the team attendance last week')).toBe(false)
    expect(aboutMe('who was late in my team')).toBe(false)
    expect(aboutMe('tell me Ali\'s attendance')).toBe(false)
    expect(aboutMe('my attendance', 'Ali Khan', 'Anees')).toBe(false)
    expect(aboutMe('my attendance', 'me', 'Anees')).toBe(true)
  })
})

describe('the dates a read is sent with', () => {
  const ctx = (ask?: Parameters<typeof ctxOf>[4]) => ({ ...ctxOf({ companyId: 'c', principals: new Set(), sources: new Set() } as unknown as Asker, { id: 'u', role: 'MEMBER', name: 'A' }, new Date(`${TODAY}T05:00:00Z`), undefined, ask), zone: ZONE, today: TODAY })
  it('reads the week of a date sent with range "week", never that one day', () => {
    expect(period({ range: 'week', date: '2026-11-16' }, ctx(), 'month').query).toEqual({ range: 'custom', start: '2026-11-16', end: '2026-11-22' })
    expect(period({ range: 'week', date: '2026-11-23' }, ctx(), 'month').query).toEqual({ range: 'custom', start: '2026-11-23', end: TODAY })
    expect(period({ date: '2026-11-16' }, ctx(), 'month').query).toEqual({ range: 'custom', start: '2026-11-16', end: '2026-11-16' })
  })
  it('counts "this week" up to today', () => {
    const c = ctx(periodIn('this week'))
    expect(period({ from: c.period!.from, to: c.period!.to }, c, 'month').query).toEqual({ range: 'custom', start: '2026-11-23', end: TODAY })
  })
})
