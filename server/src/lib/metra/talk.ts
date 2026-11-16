import { screenAt } from './sources'

/**
 * Conversation quality (docs/metra/ROADMAP.md phase 3), as plain functions so each rule can be tested without a model:
 *
 *   plainWords    Roman Urdu and mixed questions, put into the English words the catalog is written in
 *   followUp      "and last month?", "what about Ali?": said to the model as a follow-up to the question before
 *   pageNote      the screen (and the record on it) the person is looking at while asking: what "this" means
 *   checkNumbers  every number in an answer must be in what Metriq returned, or follow from it by simple arithmetic
 */

// ------------------------------------------------------------------ Roman Urdu

/** Common Roman Urdu words and what they stand for in a work question. Whole words only; several spellings each. */
const ROMAN: [RegExp, string][] = [
  [/\b(kitne|kitni|kitna|kitnay)\b/g, 'how many'], [/\b(kaun|kon|koun|kis ne|kisne|kis nay)\b/g, 'who'], [/\b(kahan|kidhar)\b/g, 'where'], [/\b(kab)\b/g, 'when'], [/\b(kya|kia)\b/g, 'what'], [/\b(kaunsa|konsa|kaun sa|kaun si|kaunsi|konsi)\b/g, 'which'],
  [/\b(mera|meri|mere|meray|apna|apni|apne)\b/g, 'my'], [/\b(mujhe|mujhay|mujh ko)\b/g, 'me'], [/\b(main ne|maine|mene)\b/g, 'i'], [/\b(hamara|hamari|hamare|humara|humari|humare)\b/g, 'our'], [/\b(sab|sabhi|saare|sare|sara|tamam)\b/g, 'all'],
  [/\b(aaj|aj)\b/g, 'today'], [/\b(kal)\b/g, 'tomorrow yesterday'], [/\b(parson|parso)\b/g, 'day after tomorrow'], [/\b(is hafte|is haftay|is week)\b/g, 'this week'], [/\b(pichle hafte|pichlay haftay|guzishta hafte)\b/g, 'last week'], [/\b(agle hafte|aglay haftay)\b/g, 'next week'],
  [/\b(is mahine|is maheenay|is month)\b/g, 'this month'], [/\b(pichle mahine|pichlay maheenay|guzishta mahine)\b/g, 'last month'], [/\b(hafta|hafte|haftay)\b/g, 'week'], [/\b(mahina|mahine|maheena|maheenay)\b/g, 'month'], [/\b(saal|sal)\b/g, 'year'], [/\b(din)\b/g, 'day'],
  [/\b(chutti|chuti|chhutti)\b/g, 'leave'], [/\b(haazri|hazri|haziri)\b/g, 'attendance'], [/\b(der se|late aaya|late aaye|late aya)\b/g, 'late'], [/\b(ghar se kaam)\b/g, 'work from home'],
  [/\b(kaam|kam)\b/g, 'tasks work'], [/\b(baqi|baki|baaqi|pending)\b/g, 'pending open'], [/\b(mukammal|complete|khatam ho gaya|ho gaya|hogaya)\b/g, 'done'], [/\b(khatam)\b/g, 'out of stock finished'], [/\b(maal|samaan|saman)\b/g, 'stock items'],
  [/\b(masla|masle|maslay|masail)\b/g, 'issues problems'], [/\b(mulaqat|meeting kab|baithak)\b/g, 'meeting'], [/\b(yaad dahani|yaad dehani)\b/g, 'reminder'], [/\b(tankhwah|tankhuah)\b/g, 'salary'],
  [/\b(dikhao|dikha do|batao|bata do|btao|bta do|bataiye|dikhaiye)\b/g, 'show'], [/\b(hai|hain|hy|he|tha|thi|the|ka|ki|ke|ko|se|mein|main|par|pe|aur|ya|nahi|nahin|na|bhi|to|wala|wali|wale)\b/g, ' '],
]
const HAS_ROMAN = /\b(kitn[ea]y?|kitni|kaun|kon|kya|kia|mera|meri|mere|mujhe|aaj|kal|hafte|mahine|chutti|kaam|baqi|khatam|masla|dikhao|batao|hai|hain|nahi|kis ne|kisne)\b/

/** A question with its Roman Urdu words also given in English, for matching against the catalog (the model reads the original). */
export function plainWords(question: string): string {
  const q = ` ${question.toLowerCase().replace(/[?!.,;:'"()]/g, ' ').replace(/\s+/g, ' ')} `
  if (!HAS_ROMAN.test(q)) return question
  let out = q
  for (const [re, en] of ROMAN) out = out.replace(re, ` ${en} `)
  return `${question} ${out.replace(/\s+/g, ' ').trim()}`
}

// ------------------------------------------------------------------ follow-ups

const LEADS_ON = /^(and|also|what about|how about|and what about|or|but|then|same for|aur|phir|or for|for|only|just)\b/i
const POINTS_BACK = /\b(that|those|these|them|it|this one|the same|the rest|others?|above|previous|earlier|wo|woh|un|unka|unki|us|uska|uski|in mein|in me|is mein)\b/i

/**
 * Is this a follow-up that cannot be understood alone ("and last month?", "what about Ali?", "show me those")?
 * Short questions that lean on the one before are; a full question is not, however short the chat is.
 */
export function isFollowUp(question: string, earlier: string): boolean {
  const q = question.trim()
  if (!earlier.trim() || !q) return false
  const words = q.split(/\s+/).length
  if (words > 12) return false
  if (LEADS_ON.test(q)) return true
  if (words <= 4) return true
  return words <= 8 && POINTS_BACK.test(q)
}

/** The line that tells the model what a follow-up continues. Empty when the question stands alone. */
export function followUp(question: string, history: { role: 'user' | 'assistant'; content: string }[]): string {
  const earlier = [...history].reverse().find((m) => m.role === 'user')?.content ?? ''
  if (!isFollowUp(question, earlier)) return ''
  return `[This continues the person's earlier question: "${earlier.replace(/\s+/g, ' ').trim().slice(0, 300)}". Read "${question.trim().slice(0, 120)}" as that same question with this change (another person, period, status or item), and look it up again with the changed option. Do not answer from memory of the earlier numbers.]`
}

// ------------------------------------------------------------------ does the person want something changed?

const DO = /\b(add|create|make|log|record|request|apply|book|schedule|set|mark|update|change|move|assign|reassign|remind|save|note down|write down|put|send|submit|enter|raise|close|complete|finish|snooze|call back|callback|reschedule|cancel|approve|comment|reply|karo|kar do|kardo|kar dein|kar dijiye|bana do|banao|laga do|lagao|daal do|dal do|likh do|likho|bhej do|bhejo|rakh do)\b/i
const YES = /^\s*(yes|yeah|yep|ok|okay|sure|please do|do it|go ahead|confirm|haan|han|ji|theek hai|kar do|kardo)\b/i

/**
 * Does this message ask Metra to change something (so the action cards are offered), or only to read? A plain
 * question gets no action tools at all: they were about a quarter of every request, and a tool that is not on offer
 * cannot be picked by mistake. "Yes, do it" after Metra offered something counts as asking.
 */
export function wantsAction(question: string, history: { role: 'user' | 'assistant'; content: string }[] = []): boolean {
  return DO.test(question) || (YES.test(question) && history.some((m) => m.role === 'assistant'))
}

// ------------------------------------------------------------------ the page the person is on

export interface Page { path: string; label: string; note: string }

/**
 * What the person has open while asking, from the address the app sent with the question (never from the question's
 * words): the screen, and the record on it when the address names one. So "this task", "this lead", "here" and
 * "on this page" mean something. Only an address inside the app is read; anything else is ignored.
 */
export function pageNote(raw: string | null | undefined): Page | null {
  const s = String(raw ?? '').trim()
  if (!/^\/app\/[A-Za-z0-9/_\-.]*(\?[A-Za-z0-9=&_\-.%:+]*)?$/.test(s) || s.length > 300) return null
  const [path, query = ''] = s.split('?')
  if (path === '/app/metra' || path.startsWith('/app/metra/')) return null // asked from Metra's own page: no screen behind it
  const q = new URLSearchParams(query)
  const screen = screenAt(path)
  const on: string[] = []
  const safe = (v: string | null) => (v && /^[A-Za-z0-9_\-.:]{1,60}$/.test(v) ? v : '')
  const project = /^\/app\/projects\/([A-Za-z0-9]{2,8})$/.exec(path)?.[1]
  if (safe(q.get('task'))) on.push(`the task ${safe(q.get('task')).toUpperCase()} is open on it (read it with get_ticket)`)
  else if (project) on.push(`it is the board of project ${project.toUpperCase()} (its tickets: list_project_tickets)`)
  const meeting = /^\/app\/meetings\/([A-Za-z0-9]{6,40})$/.exec(path)?.[1]
  if (meeting) on.push('one meeting is open on it (their meetings: metriq_data what="calendar.my")')
  const lead = /^\/app\/leads\/([A-Za-z0-9]{6,40})$/.exec(path)?.[1]
  if (lead) on.push(`the lead with id ${lead} is open on it (read it with lead_get)`)
  if (safe(q.get('date'))) on.push(`it shows the day ${safe(q.get('date'))}`)
  if (safe(q.get('from')) && safe(q.get('to'))) on.push(`it shows ${safe(q.get('from'))} to ${safe(q.get('to'))}`)
  const label = screen?.label ?? ''
  if (!label && !on.length) return null
  return { path, label, note: `[The person asked this while looking at ${label ? `the "${label}" screen` : 'a screen'} of Metriq (${path})${on.length ? `: ${on.join('; ')}` : ''}. When they say "this", "here", "this page" or name nothing, they mean what is on that screen. If the question is clearly about something else, ignore this.]` }
}

// ------------------------------------------------------------------ the answer's numbers

/** Things that look like numbers but are not claims: dates, times, codes, addresses, citations, list markers. */
function withoutNonClaims(text: string): string {
  const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
  return text
    .replace(/https?:\/\/\S+|\/(?:app|api)\/\S*/gi, ' ')
    .replace(/\[\d+(?:\s*,\s*\d+)*\]|【\d+】/g, ' ') // citations
    .replace(/\b\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?\b/g, ' ')
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?\b/gi, ' ')
    .replace(/\b\d{1,2}\s*(?:am|pm)\b/gi, ' ')
    .replace(new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}\\b\\.?(?:,?\\s+\\d{4})?`, 'gi'), ' ')
    .replace(new RegExp(`\\b${MONTH}\\b\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?`, 'gi'), ' ')
    .replace(new RegExp(`\\b${MONTH}\\b\\.?,?\\s+\\d{4}`, 'gi'), ' ')
    .replace(/\b(?:19|20)\d{2}\b/g, ' ') // years
    .replace(/\b[A-Z][A-Z0-9]{1,7}-\d+\b/g, ' ') // ticket and item codes: MCHK-2
    .replace(/#\d+\b/g, ' ') // deal and row numbers
    .replace(/^\s*\d{1,3}[.)]\s/gm, ' ') // list markers
    .replace(/\b\d+(?:st|nd|rd|th)\b/gi, ' ')
    .replace(/\b(?:top|first|last|next|past|every)\s+\d+\b/gi, ' ')
}

/** The numbers in a text: "$4,502", "34.37", "14.8%", "1 250". */
export function numbersIn(text: string): { raw: string; value: number; decimals: number; pct: boolean }[] {
  const out: { raw: string; value: number; decimals: number; pct: boolean }[] = []
  for (const m of text.matchAll(/(?<![A-Za-z\d.,])[$€£]?\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s?(%)?(?![\d])/g)) {
    const whole = m[1].replace(/,/g, '')
    const value = Number(`${whole}${m[2] ?? ''}`)
    if (Number.isFinite(value)) out.push({ raw: m[0].trim(), value, decimals: m[2] ? m[2].length - 1 : 0, pct: !!m[3] })
  }
  return out
}

/**
 * The numbers of an answer that are not in what Metriq returned and not in the person's own words. A number counts as
 * given when it is there as written, rounded ("34.37" for 34.3664), or as a share said as a percentage (0.148 as
 * 14.8%). A number the model worked out itself (a sum, a difference) is NOT given: it is listed here, and the answer
 * is written once more with the instruction to show such a step or leave the number out. Small whole numbers (under
 * 10) are not checked: they are everywhere. An empty list means every number has a source.
 *
 * It is deliberately strict and deliberately cheap: a false alarm costs one more model turn, a missed invention
 * ("due 20 November" on a task with no due date, 14 Nov 2026) costs the person's trust.
 */
export function checkNumbers(answer: string, evidence: string[]): string[] {
  const claims = numbersIn(withoutNonClaims(answer)).filter((n) => n.value >= 10 || n.decimals > 0 || n.pct)
  if (!claims.length) return []
  // How many lines a lookup listed is a fact too ("you have 12 to-dos" from twelve listed lines), with and without a heading row.
  const listed = evidence.flatMap((e) => { const lines = e.split('\n'); const dash = lines.filter((l) => /^\s*[-•*]\s/.test(l)).length, bar = lines.filter((l) => l.includes(' | ')).length, hits = lines.filter((l) => /^\[\d+\]\s/.test(l)).length; return [dash, bar, bar - 1, hits].filter((n) => n > 0) })
  const facts = [...new Set([...evidence.flatMap((e) => numbersIn(e).map((n) => n.value)), ...listed])]
  const near = (a: number, b: number, d: number) => Math.abs(a - b) <= 0.5 * 10 ** -d + 1e-9
  const bad: string[] = []
  for (const c of claims) if (!facts.some((f) => near(f, c.value, c.decimals) || (c.pct && near(f * 100, c.value, c.decimals)))) bad.push(c.raw)
  return [...new Set(bad)]
}
