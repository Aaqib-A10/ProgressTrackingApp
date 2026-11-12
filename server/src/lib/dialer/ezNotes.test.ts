import { describe, expect, it } from 'vitest'
import { findContacts, parseHiddenDescription, parseNotesCell, splitPhones } from './ezNotes'

describe('Earth Zone notes cell (ITAD update 12 Nov, section 2)', () => {
  it('splits a cell into dated entries on the date bracket, whatever the divider', () => {
    const cell = '[2026-10-15] Danyal  Ahmed: Called, left VM with the receptionist. ---- [2026/10/20] Sara   Malik: Spoke with the CFO, wants a quote || [2026.11.02] Danyal Ahmed: Sent quote'
    const { entries, unparsed } = parseNotesCell(cell)
    expect(unparsed).toBeNull()
    expect(entries.map((e) => [e.day, e.author, e.text])).toEqual([
      ['2026-10-15', 'Danyal Ahmed', 'Called, left VM with the receptionist.'],
      ['2026-10-20', 'Sara Malik', 'Spoke with the CFO, wants a quote'],
      ['2026-11-02', 'Danyal Ahmed', 'Sent quote'],
    ])
    expect(entries[0].at.toISOString()).toBe('2026-10-15T00:00:00.000Z')
  })

  it('reads an author written inside the bracket, with or without a time', () => {
    const { entries } = parseNotesCell('[2026-10-15 3:22 PM Danyal Ahmed]: Called back\n\n[2026-10-16 Sara Malik] - No answer')
    expect(entries.map((e) => [e.author, e.text])).toEqual([['Danyal Ahmed', 'Called back'], ['Sara Malik', 'No answer']])
  })

  it('keeps a colon inside the text and a note with no author', () => {
    const { entries } = parseNotesCell('[2026-10-15] Called: no answer, try at 3:30 PM their time. This sentence is long enough to not be a name, really')
    expect(entries[0].author).toBe('Called')
    const long = parseNotesCell('[2026-10-15] This is a very long note without any author name before the colon here: details')
    expect(long.entries[0].author).toBe('')
    expect(long.entries[0].text).toContain('details')
  })

  it('gives the same entry the same key (re-sync adds nothing) and ignores spacing and case', () => {
    const a = parseNotesCell('[2026-10-15] Danyal Ahmed: Called back').entries[0]
    const b = parseNotesCell('[2026-10-15]   danyal   ahmed :  Called   back  ').entries[0]
    expect(a.key).toBe(b.key)
    expect(parseNotesCell('[2026-10-16] Danyal Ahmed: Called back').entries[0].key).not.toBe(a.key)
  })

  it('returns text before the first date apart, skips impossible dates, empty cells give nothing', () => {
    const r = parseNotesCell('Imported from old CRM. [2026-13-40] bad [2026-10-15] A B: ok')
    // "[2026-13-40]" is not a date, so it is part of the text before the first entry.
    expect(r.unparsed).toBe('Imported from old CRM. [2026-13-40] bad')
    expect(r.entries).toHaveLength(1)
    expect(r.entries[0].text).toContain('ok')
    expect(parseNotesCell('').entries).toEqual([])
    expect(parseNotesCell(null).entries).toEqual([])
  })
})

describe('Alternative Numbers', () => {
  it('splits numbers, drops duplicates and the numbers the lead already has', () => {
    expect(splitPhones('(555) 222-3333, 555.222.3333; +1 555 444 5555 ext 12 / Cell: 555-777-8888', ['555-777-8888']))
      .toEqual(['(555) 222-3333', '+1 555 444 5555 ext 12'])
    expect(splitPhones('n/a')).toEqual([])
    expect(splitPhones(null)).toEqual([])
  })
})

describe('Hidden Description', () => {
  it('makes LinkedIn and CFO links clickable and keeps the rest as a description', () => {
    const r = parseHiddenDescription('CFO: linkedin.com/in/john-doe-123 | Company page https://www.linkedin.com/company/acme\nHas 400 laptops to retire in Q1.')
    expect(r.links).toEqual([
      { label: 'CFO LinkedIn', url: 'https://linkedin.com/in/john-doe-123' },
      { label: 'LinkedIn', url: 'https://www.linkedin.com/company/acme' },
    ])
    expect(r.description).toContain('Has 400 laptops to retire in Q1.')
    expect(r.description).not.toMatch(/linkedin/i)
  })
  it('is empty for an empty cell', () => {
    expect(parseHiddenDescription('  ')).toEqual({ links: [], description: null })
  })
})

describe('A new person named in a note', () => {
  it('offers a purchasing manager a colleague added, but not the lead\'s own details', () => {
    const c = findContacts('Spoke with Sara Khan (sara.khan@acme.com), purchasing manager, direct 555-222-3333. Main line 555-111-0000.', ['555-111-0000', 'info@acme.com'])
    expect(c).toHaveLength(1)
    expect(c[0]).toMatchObject({ name: 'Sara Khan', email: 'sara.khan@acme.com', title: 'purchasing manager' })
  })
  it('finds a LinkedIn link with a role and name', () => {
    const c = findContacts('New contact: Mike Brown, CFO linkedin.com/in/mike-brown')
    expect(c[0]).toMatchObject({ name: 'Mike Brown', linkedin: 'https://linkedin.com/in/mike-brown' })
  })
  it('offers nothing when the note has no way to reach anyone new', () => {
    expect(findContacts('Left voicemail, will call back Thursday.')).toEqual([])
    expect(findContacts('Emailed info@acme.com again', ['info@acme.com'])).toEqual([])
  })
})
