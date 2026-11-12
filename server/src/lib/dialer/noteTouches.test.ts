import { describe, expect, it } from 'vitest'
import { agentContacts, autoCloseBy, contactDay, noteTouchStats, type ContactNote, type ContactTouch } from './noteTouches'

const AGENT = 'agent', COLLEAGUE = 'colleague'
const at = (s: string) => new Date(s)
const ez = (day: string, userId: string | null = AGENT): ContactNote => ({ userId, at: at(`${day}T00:00:00Z`), source: 'EARTHZONE' })
const mq = (t: string, userId: string | null = AGENT, source = 'METRIQ'): ContactNote => ({ userId, at: at(t), source })

describe('Touch counting with notes (ITAD update 12 Nov, section 4)', () => {
  it('last touched is the date of the agent\'s latest call note', () => {
    const c = agentContacts(AGENT, [ez('2026-11-01'), ez('2026-11-05'), mq('2026-11-03T15:00:00Z', AGENT, 'CLAUDE')], [])
    expect(noteTouchStats(c, 0).lastContactAt?.toISOString()).toBe('2026-11-05T00:00:00.000Z')
  })

  it('only the agent\'s own notes count: a colleague\'s team update does not reset the clock', () => {
    const c = agentContacts(AGENT, [ez('2026-11-01'), ez('2026-11-09', COLLEAGUE), ez('2026-11-10', null)], [])
    const s = noteTouchStats(c, 0)
    expect(s.lastContactAt?.toISOString().slice(0, 10)).toBe('2026-11-01')
    expect(s.days).toBe(1)
  })

  it('two notes by the agent on the same day count as one touch', () => {
    const c = agentContacts(AGENT, [mq('2026-11-04T14:00:00Z'), mq('2026-11-04T18:00:00Z'), ez('2026-11-06')], [])
    expect(noteTouchStats(c, 0)).toMatchObject({ days: 2, tries: 2 })
  })

  it('a night shift is one day: 11 PM and 3 AM Pakistan time are the same touch', () => {
    // 23:00 PKT = 18:00Z, 03:00 PKT next day = 22:00Z
    expect(contactDay(at('2026-11-04T18:00:00Z'), 'METRIQ')).toBe(contactDay(at('2026-11-04T22:00:00Z'), 'METRIQ'))
    const c = agentContacts(AGENT, [mq('2026-11-04T18:00:00Z'), mq('2026-11-04T22:00:00Z')], [])
    expect(noteTouchStats(c, 0).days).toBe(1)
  })

  it('tries, same status counts the agent\'s note days since the status last changed', () => {
    const c = agentContacts(AGENT, [ez('2026-10-20'), ez('2026-11-02'), ez('2026-11-05'), ez('2026-11-05')], [])
    expect(noteTouchStats(c, at('2026-11-01T10:00:00Z').getTime()).tries).toBe(2)
  })

  it('the agent\'s own logged calls count (setting on), a colleague\'s do not, and can be switched off', () => {
    const touches: ContactTouch[] = [{ userId: AGENT, at: at('2026-11-07T15:00:00Z'), source: 'MANUAL', kind: 'TOUCH' }, { userId: COLLEAGUE, at: at('2026-11-08T15:00:00Z'), source: 'MANUAL', kind: 'TOUCH' }, { userId: null, at: at('2026-11-09T00:00:00Z'), source: 'IMPORT', kind: 'RE_ATTEMPT' }]
    expect(noteTouchStats(agentContacts(AGENT, [], touches), 0).lastContactAt?.toISOString()).toBe('2026-11-07T15:00:00.000Z')
    expect(noteTouchStats(agentContacts(AGENT, [], touches, false), 0).lastContactAt).toBeNull()
  })

  it('a lead with no notes has no contacts (Updated At is the fallback, chosen by the caller)', () => {
    expect(noteTouchStats([], 0)).toEqual({ lastContactAt: null, days: 0, tries: 0 })
  })
})

describe('Follow-ups close themselves (section 4)', () => {
  const since = at('2026-11-05T04:00:00Z') // created 9 AM PKT
  const base = { since, leadStatus: 'Connected', statusChanges: [], importTouches: [] }

  it('the agent\'s own note after the follow-up was created closes it', () => {
    const r = autoCloseBy({ ...base, contacts: agentContacts(AGENT, [mq('2026-11-05T16:00:00Z', AGENT, 'CLAUDE')], []) })
    expect(r?.text).toBe('Note on 5 Nov (Claude)')
  })

  it('an Earth Zone note dated the follow-up\'s own day closes it (Earth Zone has no time)', () => {
    expect(autoCloseBy({ ...base, contacts: agentContacts(AGENT, [ez('2026-11-05')], []) })?.text).toBe('Note on 5 Nov (Earth Zone)')
    expect(autoCloseBy({ ...base, contacts: agentContacts(AGENT, [ez('2026-11-04')], []) })).toBeNull()
  })

  it('a colleague\'s note never closes it', () => {
    expect(autoCloseBy({ ...base, contacts: agentContacts(AGENT, [mq('2026-11-06T10:00:00Z', COLLEAGUE)], []) })).toBeNull()
  })

  it('a status change closes it, except for Pipeline and Interested leads, which need the agent\'s note', () => {
    const statusChanges = [{ at: at('2026-11-06T10:00:00Z'), fromStatus: 'Connected', toStatus: 'Voicemail Sent', byOwner: true }]
    expect(autoCloseBy({ ...base, contacts: [], statusChanges })?.text).toBe('Status changed to Voicemail Sent on 6 Nov')
    // The lead was Pipeline / Interested when it changed: the change alone is not enough.
    expect(autoCloseBy({ ...base, contacts: [], statusChanges: [{ ...statusChanges[0], fromStatus: 'Pipeline', toStatus: 'Not Interested' }] })).toBeNull()
    expect(autoCloseBy({ ...base, contacts: [], statusChanges: [{ ...statusChanges[0], fromStatus: 'Interested' }] })).toBeNull()
    // Moving a Connected lead up to Pipeline is the agent's work: it counts.
    expect(autoCloseBy({ ...base, leadStatus: 'Pipeline', contacts: [], statusChanges: [{ ...statusChanges[0], toStatus: 'Pipeline' }] })?.text).toBe('Status changed to Pipeline on 6 Nov')
    // A manager's change is not the agent's contact.
    expect(autoCloseBy({ ...base, contacts: [], statusChanges: [{ ...statusChanges[0], byOwner: false }] })).toBeNull()
  })

  it('for a lead with no notes, new activity in Earth Zone closes it; with notes, it does not', () => {
    const importTouches = [{ at: at('2026-11-07T00:00:00Z'), kind: 'RE_ATTEMPT' }]
    expect(autoCloseBy({ ...base, contacts: [], importTouches })?.text).toBe('New activity in Earth Zone on 7 Nov')
    const withOldNote = agentContacts(AGENT, [ez('2026-10-01')], [])
    expect(autoCloseBy({ ...base, contacts: withOldNote, importTouches })).toBeNull()
  })

  it('only contacts after a reopen close it again, and the earliest contact is the one named', () => {
    const contacts = agentContacts(AGENT, [mq('2026-11-06T10:00:00Z'), mq('2026-11-09T10:00:00Z')], [])
    expect(autoCloseBy({ ...base, since: at('2026-11-08T00:00:00Z'), contacts })?.text).toBe('Note on 9 Nov (Metriq)')
    expect(autoCloseBy({ ...base, contacts })?.text).toBe('Note on 6 Nov (Metriq)')
  })
})
