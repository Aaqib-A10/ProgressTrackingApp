import { DateTime } from 'luxon'

/**
 * "Leads with a stated next step and nothing logged since" (ITAD update 12 Nov, section 5). Reads the next step an
 * agent wrote in a note ("call back Thursday", "follow up next week", "send quote on 14 Nov", "kal call karna")
 * and returns the day it falls on. Pure, tested in nextStep.test.ts. Plain patterns, no AI: a missed sentence is
 * just not offered, never invented.
 */

export interface NextStep { day: string; said: string }

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const WD_SHORT: Record<string, number> = { mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6, sun: 7 }
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 }
/** Words that show the sentence is about something to do next. */
const ACTION = /\b(call\s*back|callback|call\s+(him|her|them|again)|follow[\s-]*up|f\/u|reach\s+out|try\s+again|ring|email|send|meet(ing)?|check\s+back|circle\s+back|reconnect|touch\s+base|demo|quote|visit|pick\s*up|karni|karna|karenge|karunga|dobara)\b/i

function weekdayOf(word: string): number | null {
  const w = word.toLowerCase().replace(/\.$/, '')
  const full = WEEKDAYS.indexOf(w)
  if (full >= 0) return full + 1
  return WD_SHORT[w] ?? null
}

/** The next step in a note, as the day it falls on (in `zone`), from the moment the note was written. */
export function nextStepIn(text: string, writtenAt: Date, zone = 'America/New_York'): NextStep | null {
  const base = DateTime.fromJSDate(writtenAt).setZone(zone).startOf('day')
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    if (!ACTION.test(sentence)) continue
    const s = sentence.toLowerCase()
    let d: DateTime | null = null
    let m: RegExpMatchArray | null
    if (/\b(tomorrow|tmrw|tmr|kal)\b/.test(s)) d = base.plus({ days: 1 })
    else if (/\b(day after tomorrow|parson)\b/.test(s)) d = base.plus({ days: 2 })
    else if ((m = s.match(/\bin\s+(\d{1,2}|a|one|two|three|four|five|six|seven)\s+(day|days|week|weeks)\b/))) {
      const nums: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 }
      const n = Number(m[1]) || nums[m[1]] || 1
      d = base.plus(m[2].startsWith('week') ? { weeks: n } : { days: n })
    } else if (/\bnext\s+week\b/.test(s)) d = base.plus({ weeks: 1 }).startOf('week')
    else if (/\b(end of (the )?week|eow|this friday)\b/.test(s)) d = base.set({ weekday: 5 }) < base ? base.plus({ weeks: 1 }).set({ weekday: 5 }) : base.set({ weekday: 5 })
    else if (/\bnext\s+month\b/.test(s)) d = base.plus({ months: 1 }).startOf('month')
    else if ((m = s.match(/\b(\d{1,2})\s*(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/)) || (m = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(st|nd|rd|th)?\b/))) {
      const [day, mon] = /^\d/.test(m[1]) ? [Number(m[1]), MONTHS[m[3]]] : [Number(m[2]), MONTHS[m[1]]]
      let c = DateTime.fromObject({ year: base.year, month: mon, day }, { zone })
      if (c.isValid && c < base.minus({ days: 1 })) c = c.plus({ years: 1 })
      if (c.isValid) d = c
    } else if ((m = s.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
      // US style (Earth Zone): month/day.
      const mon = Number(m[1]), day = Number(m[2])
      let c = DateTime.fromObject({ year: m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : base.year, month: mon, day }, { zone })
      if (c.isValid && !m[3] && c < base.minus({ days: 1 })) c = c.plus({ years: 1 })
      if (c.isValid) d = c
    } else {
      const w = s.match(/\b(?:on\s+|this\s+|next\s+|by\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|wed|thu(?:rs?)?|fri|sat|sun)\b/)
      if (w) {
        const wd = weekdayOf(w[1])!
        const next = /\bnext\s+/.test(w[0])
        let c = base.set({ weekday: wd as 1 })
        if (c <= base) c = c.plus({ weeks: 1 })
        if (next && c.diff(base, 'days').days < 7 && /\bnext\s+(monday|tuesday|wednesday|thursday|friday)\b/.test(s) && c.weekNumber === base.weekNumber) c = c.plus({ weeks: 1 })
        d = c
      }
    }
    if (d && d.isValid) return { day: d.toISODate()!, said: sentence.trim().slice(0, 200) }
  }
  return null
}
