import { DateTime } from 'luxon'

/**
 * The period a person named in their own words ("last week", "pichle hafte", "this month", "last 7 days"), worked out
 * here and not left to the model. On 24 Nov 2026 "my attendance from the last week" was read as one day (the model
 * sent today's date with range "week") and called "last week, 23 to 29 Nov": the numbers and the period were both
 * wrong. When the words name a period, these dates replace whatever dates the model sent.
 *
 * Weeks run Monday to Sunday (as the attendance screens show them).
 */

export interface PeriodAsk {
  unit: 'day' | 'week' | 'month' | 'year' | 'days'
  /** 0 = this one, -1 = the one before, +1 = the next one. For `days`: -1 = the n days up to today, +1 = from today. */
  offset: number
  /** For `days`: how many. */
  n?: number
}

export interface AskedPeriod { from: string; to: string; label: string; /** It includes today (this week, this month, today). */ current: boolean }

const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fourteen: 14, fifteen: 15, thirty: 30, ninety: 90 }
const count = (w: string) => (/^\d+$/.test(w) ? Number(w) : NUM[w] ?? 0)

const WEEK = '(?:week|weeks|hafte|hafta|haftay)'
const MONTH = '(?:month|mahine|mahina|mahinay)'
const BACK = '(?:last|previous|prior|pichle|pichhle|pichla|pichhla|guzre|guzishta)'
const THIS = '(?:this|current|is|iss)'
const NEXT = '(?:next|coming|upcoming|agle|agla|aglay|aane wale)'
const NUMS = `\\d+|${Object.keys(NUM).join('|')}`

/** Read the period named in one message, or null when it names none. */
export function periodIn(text: string): PeriodAsk | null {
  const q = ` ${text.toLowerCase().replace(/[?!.,;:'"()’]/g, ' ').replace(/\s+/g, ' ')} `
  const has = (re: string) => new RegExp(re, 'i').exec(q)
  let m: RegExpExecArray | null
  if (has('\\b(?:the )?week before (?:last|that)\\b|\\b(?:2|two) weeks ago\\b')) return { unit: 'week', offset: -2 }
  if (has('\\b(?:the )?month before (?:last|that)\\b|\\b(?:2|two) months ago\\b')) return { unit: 'month', offset: -2 }
  if ((m = has(`\\b(?:last|past|previous|pichle|pichhle) (${NUMS}) (?:days?|din)\\b`))) return { unit: 'days', offset: -1, n: count(m[1]) }
  if ((m = has(`\\b(?:last|past|previous|pichle) (\\d+|two|three|four) ${WEEK}\\b`))) return { unit: 'days', offset: -1, n: count(m[1]) * 7 }
  if ((m = has(`\\b(?:next|coming|agle) (${NUMS}) (?:days?|din)\\b`))) return { unit: 'days', offset: 1, n: count(m[1]) }
  if (has(`\\bpast ${WEEK}\\b`)) return { unit: 'days', offset: -1, n: 7 }
  if (has(`\\b${BACK} ${WEEK}\\b|\\bweek before\\b`)) return { unit: 'week', offset: -1 }
  if (has(`\\b${THIS} ${WEEK}\\b|\\bso far this week\\b`)) return { unit: 'week', offset: 0 }
  if (has(`\\b${NEXT} ${WEEK}\\b`)) return { unit: 'week', offset: 1 }
  if (has(`\\b${BACK} ${MONTH}\\b|\\bmonth before\\b`)) return { unit: 'month', offset: -1 }
  if (has(`\\b${THIS} ${MONTH}\\b|\\bso far this month\\b`)) return { unit: 'month', offset: 0 }
  if (has(`\\b${NEXT} ${MONTH}\\b`)) return { unit: 'month', offset: 1 }
  if (has('\\b(?:last|previous|pichle) (?:year|saal)\\b')) return { unit: 'year', offset: -1 }
  if (has('\\b(?:this|is) (?:year|saal)\\b')) return { unit: 'year', offset: 0 }
  if (has('\\byesterday\\b')) return { unit: 'day', offset: -1 }
  if (has('\\b(?:today|aaj)\\b')) return { unit: 'day', offset: 0 }
  return null
}

const ONE_BACK = /\b(previous|before that|the one before|before|earlier one|pehle|us se pehle|is se pehle)\b/i

/**
 * The period of this question. A follow-up continues the earlier question's period: "and the week before?" or "ok
 * what about the previous week" after "last week" is the week before last; a follow-up that names no period ("and
 * Ali?") keeps the earlier one.
 */
export function periodAsked(question: string, earlier = '', followUp = false): PeriodAsk | null {
  const now = periodIn(question)
  if (!followUp) return now
  const before = periodIn(earlier)
  if (!before) return now
  if (!now) return before
  // "previous week" after "last week": one more back from the earlier one, not the same week again.
  if (ONE_BACK.test(question) && now.unit === before.unit && now.unit !== 'days' && now.offset >= before.offset && now.offset < 0) return { unit: now.unit, offset: before.offset - 1 }
  return now
}

const fmt = (d: DateTime) => d.toFormat('ccc d LLL yyyy')

/** The dates of a period on the company's clock. */
export function resolvePeriod(p: PeriodAsk, today: string, zone: string): AskedPeriod {
  const t = DateTime.fromISO(today, { zone })
  let from: DateTime, to: DateTime, label: string
  if (p.unit === 'days') {
    const n = Math.max(1, Math.min(366, p.n ?? 7))
    if (p.offset < 0) { from = t.minus({ days: n - 1 }); to = t; label = `the last ${n} days` }
    else { from = t; to = t.plus({ days: n - 1 }); label = `the next ${n} days` }
  } else if (p.unit === 'day') {
    from = to = t.plus({ days: p.offset })
    label = p.offset === 0 ? 'today' : p.offset === -1 ? 'yesterday' : p.offset === 1 ? 'tomorrow' : fmt(from)
  } else {
    const start = t.startOf(p.unit).plus({ [`${p.unit}s`]: p.offset })
    from = start; to = start.endOf(p.unit).startOf('day')
    const name = p.unit
    label = p.offset === 0 ? `this ${name}` : p.offset === -1 ? `last ${name}` : p.offset === 1 ? `next ${name}` : p.offset === -2 ? `the ${name} before last` : `${Math.abs(p.offset)} ${name}s ${p.offset < 0 ? 'ago' : 'from now'}`
  }
  const f = from.toISODate()!, e = to.toISODate()!
  return { from: f, to: e, label: `${label} (${fmt(from)} to ${fmt(to)})`, current: f <= today && today <= e }
}
