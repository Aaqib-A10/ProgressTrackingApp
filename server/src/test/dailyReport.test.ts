import { describe, it, expect } from 'vitest'
import { checkAnswers, csvCell, sumNumbers, targetTone, type FieldDef } from '../lib/dailyReport'

// Phase 1, step 5: the Daily Report builder's answer checks and sums.

const f = (id: string, type: FieldDef['type'], extra: Partial<FieldDef> = {}): FieldDef => ({ id, label: id, type, options: [], required: false, target: null, targetDir: 'MIN', archived: false, ...extra })
const FIELDS = [
  f('calls', 'NUMBER', { required: true, target: 50 }),
  f('notes', 'TEXT'),
  f('mood', 'CHOICE', { options: ['Good', 'Okay', 'Bad'] }),
  f('tools', 'MULTI_CHOICE', { options: ['Email', 'Phone', 'Chat'] }),
  f('done', 'YES_NO'),
  f('rating', 'RATING'),
  f('link', 'LINK'),
  f('old', 'NUMBER', { archived: true }),
]

describe('checking answers', () => {
  it('takes good answers, trims text and drops unknown or archived questions', () => {
    const r = checkAnswers(FIELDS, { calls: '42', notes: '  hi  ', mood: 'Good', tools: ['Email', 'Email', 'Chat'], done: true, rating: 4, link: 'https://x.example/a', old: 3, junk: 1 })
    expect(r).toEqual({ ok: true, values: { calls: 42, notes: 'hi', mood: 'Good', tools: ['Email', 'Chat'], done: true, rating: 4, link: 'https://x.example/a' } })
  })
  it('says what is wrong, in words', () => {
    expect(checkAnswers(FIELDS, {})).toEqual({ ok: false, error: '"calls" is needed' })
    expect(checkAnswers(FIELDS, { calls: 'ten' })).toMatchObject({ ok: false, error: '"calls" must be a number' })
    expect(checkAnswers(FIELDS, { calls: 1, mood: 'Great' })).toMatchObject({ ok: false })
    expect(checkAnswers(FIELDS, { calls: 1, tools: ['Fax'] })).toMatchObject({ ok: false })
    expect(checkAnswers(FIELDS, { calls: 1, done: 'yes' })).toMatchObject({ ok: false })
    expect(checkAnswers(FIELDS, { calls: 1, rating: 6 })).toMatchObject({ ok: false })
    expect(checkAnswers(FIELDS, { calls: 1, link: 'javascript:alert(1)' })).toMatchObject({ ok: false })
    expect(checkAnswers(FIELDS, { calls: 1, notes: 'x'.repeat(501) })).toMatchObject({ ok: false })
    expect(checkAnswers(FIELDS, 'nope')).toMatchObject({ ok: false })
  })
})

describe('targets and sums', () => {
  it('green on target, amber within 20%, red below; the other way round when less is better', () => {
    expect(targetTone(50, 50, 'MIN')).toBe('success')
    expect(targetTone(41, 50, 'MIN')).toBe('warning')
    expect(targetTone(39, 50, 'MIN')).toBe('danger')
    expect(targetTone(5, null, 'MIN')).toBe('neutral')
    expect(targetTone(10, 10, 'MAX')).toBe('success')
    expect(targetTone(12, 10, 'MAX')).toBe('warning')
    expect(targetTone(20, 10, 'MAX')).toBe('danger')
  })
  it('adds numbers and ratings across reports', () => {
    const s = sumNumbers(FIELDS, [{ values: { calls: 10, rating: 4 } }, { values: { calls: 30 } }, { values: null }])
    expect(s.calls).toEqual({ total: 40, count: 2, average: 20 })
    expect(s.rating).toEqual({ total: 4, count: 1, average: 4 })
    expect(s.notes).toBeUndefined()
  })
  it('CSV cells are safe in a spreadsheet', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell(-5)).toBe('-5')
    expect(csvCell(['a', 'b'])).toBe('a; b')
    expect(csvCell(true)).toBe('Yes')
  })
})
