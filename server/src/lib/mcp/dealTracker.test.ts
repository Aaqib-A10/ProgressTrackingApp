import { describe, expect, it } from 'vitest'
import { compact, dealTrackerText, type DealTrackerData } from './departmentTools'
import { cutToolText } from '../metra/agent'

// Metra once answered "Active 1, Submitted 0, Won 0, Lost 5" for a Deal Tracker showing 6 / 8 / 15 / 5, because it
// counted the few bids search returned. The deal_tracker tool counts every deal itself, the same way the page does.
const bid = (n: number, status: 'ACTIVE' | 'SUBMITTED' | 'WON' | 'LOST', agentName: string, dueDate: string, extra: Partial<DealTrackerData['bids'][number]> = {}) => ({
  number: n, title: `Deal ${n}`, company: `Company ${n}`, type: 'PO', district: '', agentName, status, dueDate, submissionType: 'EMAIL', priceQuoted: 1000, awardedPrice: status === 'WON' ? 2500.5 : null, bidBond: false, bidBondAmount: null, closedDate: status === 'WON' || status === 'LOST' ? dueDate : null, reminderSet: false, ...extra,
})
const data: DealTrackerData = {
  bids: [
    bid(1, 'ACTIVE', 'Usama Shabir', '2026-11-01T10:00:00Z'), // overdue on 13 Nov
    bid(2, 'ACTIVE', 'Mobeen Zahra', '2026-11-20T10:00:00Z'),
    bid(3, 'SUBMITTED', 'Usama Shabir', '2026-11-05T10:00:00Z'),
    bid(4, 'WON', 'Usama Shabir', '2026-10-10T10:00:00Z', { priceQuoted: 0.125 }),
    bid(5, 'WON', 'Mobeen Zahra', '2026-11-03T10:00:00Z'),
    bid(6, 'LOST', 'Mobeen Zahra', '2026-09-15T10:00:00Z', { bidBond: true, bidBondAmount: 500 }),
  ],
  summary: { active: 2, submitted: 1, won: 2, lost: 1, wonValue: 5001 },
}
const now = new Date('2026-11-13T07:00:00Z')

describe('deal_tracker counts like the page', () => {
  it('leads with the page cards, then per agent, win rate and the deals', () => {
    const t = dealTrackerText(data, {}, now)
    expect(t.split('\n')[0]).toBe('Deal Tracker cards (every deal this person can see, exactly as on the page): Active 2, Submitted 1, Won 2 ($5,001 awarded), Lost 1; 6 deals in all.')
    expect(t).toContain('Win rate (won / (won + lost)): 67% (2 won of 3 decided).')
    // Asking only for won deals once gave "100% (3 of 3)": the rate always counts the lost ones too.
    expect(dealTrackerText(data, { agent: 'mobeen', status: 'won' }, now)).toContain('Win rate (won / (won + lost)) with these filters: 50% (1 won of 2 decided).')
    expect(t).toContain('Usama Shabir 3 (active 1, submitted 1, won 1 $2,500.5, lost 0)')
    expect(t).toContain('#1 Deal 1 | Company 1 | PO | Usama Shabir | Active | due Sun 1 Nov 2026, 3:00 PM (OVERDUE)')
    expect(t).toContain('quoted $0.125') // a per-lb price keeps its decimals
    expect(t).toContain('bid bond $500')
    // "Which is due next" must not pick one that is already overdue.
    expect(t).toContain('Open deals here: 2 overdue (due date passed). Next due (still ahead): #2 Deal 2 (Company 2), due Fri 20 Nov 2026, 3:00 PM.')
    expect(dealTrackerText(data, { agent: 'usama', status: 'open' }, now)).toContain('Next due (still ahead): none, every open deal here is already overdue.')
  })
  it('filters by status, agent, overdue and the page date rule (closed date for decided deals)', () => {
    expect(dealTrackerText(data, { status: 'open' }, now)).toContain('3 deals: Active 2, Submitted 1, Won 0 ($0), Lost 0.')
    expect(dealTrackerText(data, { agent: 'mobeen' }, now)).toContain('3 deals: Active 1, Submitted 0, Won 1 ($2,500.5), Lost 1.')
    expect(dealTrackerText(data, { overdue: true }, now)).toContain('2 deals: Active 1, Submitted 1')
    // The model once sent type "deal": unknown values are ignored instead of hiding every deal.
    expect(dealTrackerText(data, { agent: 'usama', status: 'Won', type: 'deal' }, now)).toContain('1 deals: Active 0, Submitted 0, Won 1 ($2,500.5), Lost 0.')
    // "How many open bids do I have" once came back 0 because the model added from=today: the open total at any date is always given.
    expect(dealTrackerText(data, { status: 'active', agent: 'usama', from: '2026-11-13' }, now)).toContain('All open deals for "usama" at any date: 2 (Active 1, Submitted 1), 2 of them overdue.')
    // "How many deals have I won" with dates the model added (this month) while the wins were closed earlier: the no-date numbers are given too.
    const dated = dealTrackerText(data, { status: 'won', from: '2099-01-01', to: '2099-01-31' }, now)
    const plain = dealTrackerText(data, { status: 'won' }, now)
    const wonLine = /Won (\d+) \((\$[\d,.]+[^)]*)\)/
    expect(dated).toContain('The same filter with NO dates:')
    expect(dated.split('The same filter with NO dates:')[1].match(wonLine)?.slice(1)).toEqual(plain.split('Matching the filter')[1].match(wonLine)?.slice(1))
    // An agent with no deals (the asker's own name, for an admin) plus today's date once gave a summary of all zeros.
    const nobody = dealTrackerText(data, { status: 'all', agent: 'Test Super Admin', from: '2099-01-01' }, now)
    expect(nobody).toContain('No deal here is under an agent called "Test Super Admin", so that filter was left out')
    expect(nobody.split('The same filter with NO dates:')[1]).toContain(`${data.bids.length} deals:`)
    // The model passed today's date with overdue once and got "none"; overdue ignores dates.
    expect(dealTrackerText(data, { overdue: true, from: '2026-11-13', to: '2026-11-13' }, now)).toContain('2 deals: Active 1, Submitted 1')
    expect(dealTrackerText(data, { status: 'won', from: '2026-11-01', to: '2026-11-30' }, now)).toContain('1 deals: Active 0, Submitted 0, Won 1 ($2,500.5), Lost 0.')
  })
})

describe('long tool results never lose their totals', () => {
  it('compact puts single values before lists and says how long each list is', () => {
    const s = compact({ bids: [{ a: 1 }, { a: 2 }], summary: { won: 15 } })
    expect(s.indexOf('"summary"')).toBeLessThan(s.indexOf('"bids (2 items)"'))
  })
  it('a list of people also gets their names in one line (for "who" questions)', () => {
    const s = compact({ groups: [{ label: 'ITAD', members: [{ id: 'x1', name: 'Usama Shabir' }, { id: 'x2', name: 'Mobeen Zahra ' }] }] })
    expect(s).toContain('"members names":"Usama Shabir, Mobeen Zahra"')
    expect(s.indexOf('members names')).toBeLessThan(s.indexOf('members (2 items)'))
  })
  it('a cut result says the lists are incomplete', () => {
    expect(cutToolText('x'.repeat(10_000))).toMatch(/CUT: .*do not count them/)
    expect(cutToolText('short')).toBe('short')
  })
})
