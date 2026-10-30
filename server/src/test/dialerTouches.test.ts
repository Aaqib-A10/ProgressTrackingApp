import { describe, it, expect } from 'vitest'
import { planImportTouches, type ImportCompare } from '../lib/dialer/touches'
import { overdueLevel, taskBucket, sortFromParam, sortToParam, DEFAULT_FU_SORT, daysQuiet, type DialerLead, type DialerTask } from '../lib/dialer/view'
import { nineOnLeadClock } from '../lib/dialer/tasks'

// ITAD revised spec (30 Oct 2026), section 6.1: touches worked out between two imports.
const d = (s: string) => new Date(`${s}T00:00:00.000Z`)
const at = new Date('2026-10-30T15:00:00Z')
const c = (leadId: string, oldStatus: string, newStatus: string, oldUpdated: string | null, newUpdated: string | null): ImportCompare =>
  ({ leadId, oldStatus, newStatus, oldUpdated: oldUpdated ? d(oldUpdated) : null, newUpdated: newUpdated ? d(newUpdated) : null })

describe('touches between two imports', () => {
  it('follows the table: status change 1, re-attempt 1, both 1, assignment 0, nothing 0', () => {
    const p = planImportTouches([
      c('a', 'Contact Attempted', 'Voicemail Sent', '2026-09-01', '2026-09-01'),
      c('b', 'Voicemail Sent', 'Voicemail Sent', '2026-09-01', '2026-09-03'),
      c('c', 'Connected', 'Interested', '2026-09-01', '2026-09-04'),
      c('d', 'Assigned', 'Assigned', '2026-09-01', '2026-09-05'),
      c('e', 'Connected', 'Connected', '2026-09-01', '2026-09-01'),
    ], 100, at, 20, [])
    expect(p.create.map((t) => [t.leadId, t.kind])).toEqual([['a', 'STATUS_CHANGE'], ['b', 'RE_ATTEMPT'], ['c', 'STATUS_CHANGE']])
    expect(p.create.find((t) => t.leadId === 'b')!.at.toISOString().slice(0, 10)).toBe('2026-09-03')
  })

  it('the same Updated At date (time of day only) is not a re-attempt', () => {
    const p = planImportTouches([{ leadId: 'x', oldStatus: 'Voicemail Sent', newStatus: 'Voicemail Sent', oldUpdated: new Date('2026-09-03T01:00:00Z'), newUpdated: new Date('2026-09-03T20:00:00Z') }], 10, at, 20, [])
    expect(p.create).toHaveLength(0)
  })

  it('a bulk update is not calls: same-status leads on that date count 0, status changes still count', () => {
    const many = Array.from({ length: 30 }, (_, i) => c(`v${i}`, 'Voicemail Sent', 'Voicemail Sent', '2026-08-01', '2026-08-12'))
    const p = planImportTouches([...many, c('s', 'Voicemail Sent', 'Connected', '2026-08-01', '2026-08-12'), c('r', 'Voicemail Sent', 'Voicemail Sent', '2026-08-01', '2026-08-20')], 100, at, 20, [])
    expect(p.bulkDays).toEqual(['2026-08-12'])
    expect(p.create.map((t) => t.leadId).sort()).toEqual(['r', 's'])
  })

  it('an assignment batch (most still Assigned) does not count, but the worked leads on that date do', () => {
    const batch = [
      ...Array.from({ length: 181 }, (_, i) => c(`a${i}`, 'Assigned', 'Assigned', '2026-08-01', '2026-08-12')),
      ...Array.from({ length: 22 }, (_, i) => c(`w${i}`, 'Voicemail Sent', 'Voicemail Sent', '2026-08-01', '2026-08-12')),
    ]
    const p = planImportTouches(batch, 400, at, 20, [])
    expect(p.bulkDays).toEqual(['2026-08-12'])
    expect(p.create).toHaveLength(22)
    expect(p.create.every((t) => t.kind === 'RE_ATTEMPT')).toBe(true)
  })

  it('the threshold is a setting', () => {
    const rows = Array.from({ length: 30 }, (_, i) => c(`v${i}`, 'Voicemail Sent', 'Voicemail Sent', '2026-08-01', '2026-08-12'))
    expect(planImportTouches(rows, 100, at, 20, []).create).toHaveLength(0)
    expect(planImportTouches(rows, 100, at, 40, []).create).toHaveLength(30)
  })

  it('a touch added by hand between the two Updated At dates is the same call: counted once', () => {
    const p = planImportTouches([c('b', 'Voicemail Sent', 'Voicemail Sent', '2026-09-01', '2026-09-05'), c('z', 'Voicemail Sent', 'Voicemail Sent', '2026-09-01', '2026-09-05')], 100, at, 20, [
      { id: 'm1', leadId: 'b', at: d('2026-09-04') },
      { id: 'm2', leadId: 'z', at: d('2026-08-20') }, // before the old Updated At: a different call
    ])
    expect(p.merge).toEqual(['m1'])
    expect(p.create.map((t) => t.leadId)).toEqual(['z'])
  })

  it('re-importing the same file adds nothing', () => {
    const same = [c('a', 'Connected', 'Connected', '2026-09-01', '2026-09-01'), c('b', 'Assigned', 'Assigned', '2026-08-12', '2026-08-12')]
    expect(planImportTouches(same, 2, at, 20, []).create).toHaveLength(0)
  })
})

describe('follow-up rows', () => {
  it('overdue colour follows how far past the rule a lead is', () => {
    expect(overdueLevel(5, 7)).toBe(0)
    expect(overdueLevel(125, 7)).toBe(4) // severe
    expect(overdueLevel(105, 30)).toBe(2) // moderate
    expect(overdueLevel(40, 30)).toBe(1)
  })

  it('days quiet: from the assignment for a lead never worked, else from the last touch', () => {
    const now = new Date('2026-10-30T12:00:00Z')
    const base = { status: 'Assigned', leadDate: '2026-09-25T00:00:00Z', createdAt: '2026-10-01T00:00:00Z', lastActivityAt: '2026-10-28T00:00:00Z', manualTouches: 0 } as unknown as DialerLead
    expect(daysQuiet(base, now)).toBe(35)
    expect(daysQuiet({ ...base, manualTouches: 1, lastTouchedAt: '2026-10-29T00:00:00Z' }, now)).toBe(1)
    expect(daysQuiet({ ...base, status: 'Connected' }, now)).toBe(2)
  })

  it('task strip buckets, and the sort kept in the address bar', () => {
    const now = new Date('2026-10-30T15:00:00Z')
    const dayStart = new Date('2026-10-30T07:00:00Z')
    const t = (x: Partial<DialerTask>) => ({ id: 'x', leadId: 'l', ownerId: 'o', kind: 'CALL', title: '', note: null, dueAt: null, origin: 'MANUAL', reason: null, status: 'OPEN', doneAt: null, outcome: null, reminders: [], ...x }) as DialerTask
    expect(taskBucket(t({ dueAt: '2026-10-29T10:00:00Z' }), now, dayStart)).toBe('overdue')
    expect(taskBucket(t({ dueAt: '2026-10-30T20:00:00Z' }), now, dayStart)).toBe('today')
    expect(taskBucket(t({ dueAt: '2026-11-02T10:00:00Z' }), now, dayStart)).toBe('upcoming')
    expect(taskBucket(t({ status: 'DONE', doneAt: '2026-10-30T09:00:00Z' }), now, dayStart)).toBe('done')
    expect(taskBucket(t({ status: 'DONE', doneAt: '2026-10-29T09:00:00Z' }), now, dayStart)).toBeNull()
    expect(taskBucket(t({ status: 'CANCELLED' }), now, dayStart)).toBeNull()
    expect(sortFromParam(sortToParam(DEFAULT_FU_SORT))).toEqual(DEFAULT_FU_SORT)
    expect(sortFromParam('nope:asc')).toEqual(DEFAULT_FU_SORT)
    expect(sortFromParam('quiet:desc,company:asc')).toEqual([{ key: 'quiet', dir: 'desc' }, { key: 'company', dir: 'asc' }])
  })

  it('an automatic follow-up is due at 9 AM on the lead\'s clock', () => {
    expect(nineOnLeadClock('2026-10-30', 'America/Los_Angeles').toISOString()).toBe('2026-10-30T16:00:00.000Z')
    expect(nineOnLeadClock('2026-12-01', 'America/New_York').toISOString()).toBe('2026-12-01T14:00:00.000Z')
  })
})
