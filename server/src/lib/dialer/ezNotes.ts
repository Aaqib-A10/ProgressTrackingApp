import { createHash } from 'node:crypto'

/**
 * Earth Zone export cells (ITAD update 12 Nov 2026, sections 1 and 2). Pure functions, no database:
 * tested in ezNotes.test.ts.
 *
 *  - Logged Interaction Notes Timeline: one cell holds many entries. Each entry starts with a bracketed date
 *    (year, month, day) and the author, then a colon and the text: "[2026-10-15] Danyal Ahmed: Called, left VM".
 *    The author may also sit inside the bracket ("[2026-10-15 Danyal Ahmed]: ..."). Entries are split on the date
 *    bracket itself, so whatever divider Earth Zone puts between them (---, |, ||, blank lines...) is dropped.
 *  - Alternative Numbers: several numbers in one cell.
 *  - Hidden Description: CFO and LinkedIn links mixed with free text.
 *  - A note that names a new person with an email, phone or LinkedIn link: offered as a second contact.
 */

export interface EzNoteEntry {
  /** The Earth Zone date, as midnight UTC of that day. */
  at: Date
  /** YYYY-MM-DD */
  day: string
  author: string
  text: string
  /** Earth Zone's identity for this entry: the same entry in a later sync is recognised (and never added twice). */
  key: string
}

export const cleanName = (s: string): string => s.replace(/\s+/g, ' ').trim()
const cleanText = (s: string): string => s.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()
const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim()

const ENTRY = /\[\s*(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})([^\]\n]{0,80})\]/g
/** What Earth Zone (or a person) put between entries. */
const DIVIDER = /^[\s\-=_|•·*~;,.]+$|[\s\-=_|•·*~;]+$/

export function ezEntryKey(day: string, author: string, text: string): string {
  return createHash('sha1').update(`${day}\u0000${norm(author)}\u0000${norm(text)}`).digest('hex').slice(0, 24)
}

/** One notes cell → its dated entries, oldest first as written. Text before the first date is returned apart. */
export function parseNotesCell(cell: string | null | undefined): { entries: EzNoteEntry[]; unparsed: string | null } {
  const s = String(cell ?? '')
  if (!s.trim()) return { entries: [], unparsed: null }
  const starts: { index: number; end: number; y: number; m: number; d: number; inBracket: string }[] = []
  for (const m of s.matchAll(ENTRY)) {
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue
    starts.push({ index: m.index!, end: m.index! + m[0].length, y, m: mo, d, inBracket: m[4] })
  }
  const lead = (starts.length ? s.slice(0, starts[0].index) : s).replace(DIVIDER, '').trim()
  const entries: EzNoteEntry[] = []
  starts.forEach((st, i) => {
    let body = s.slice(st.end, i + 1 < starts.length ? starts[i + 1].index : s.length)
    body = body.replace(DIVIDER, '')
    // The time or the author may follow the date inside the bracket: "[2026-10-15 3:22 PM Danyal Ahmed]".
    const extra = cleanName(st.inBracket.replace(/^[\sT,]*\d{1,2}:\d{2}(:\d{2})?\s*([AaPp][Mm])?/, '').replace(/^[\s,\-|]+/, ''))
    let author = ''
    let text = ''
    if (extra) {
      author = extra
      text = body.replace(/^\s*[:\-–]\s*/, '')
    } else {
      const colon = body.indexOf(':')
      // An author is a short name before the first colon ("Danyal  Ahmed: ..."); otherwise the whole body is text.
      if (colon > 0 && colon <= 60 && !/\n/.test(body.slice(0, colon))) {
        author = body.slice(0, colon)
        text = body.slice(colon + 1)
      } else text = body
    }
    author = cleanName(author)
    text = cleanText(text)
    if (!text && !author) return
    const day = `${st.y}-${String(st.m).padStart(2, '0')}-${String(st.d).padStart(2, '0')}`
    entries.push({ at: new Date(`${day}T00:00:00.000Z`), day, author, text, key: ezEntryKey(day, author, text) })
  })
  return { entries, unparsed: lead || null }
}

// ------------------------------------------------------------------ numbers

/** Digits that identify a number (a US leading 1 is dropped), for comparing. */
export const phoneDigits = (p: string | null | undefined): string => (p ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')

/** "555-1234, (555) 222-3333 / +1 555 444 5555 ext 12" → each number on its own, as written, duplicates dropped. */
export function splitPhones(cell: string | null | undefined, skip: (string | null | undefined)[] = []): string[] {
  const seen = new Set(skip.map(phoneDigits).filter(Boolean))
  const out: string[] = []
  for (const raw of String(cell ?? '').split(/[,;/|\n]+|\s+or\s+|\s{3,}/i)) {
    const p = raw.replace(/^[\s\-:.]+|[\s\-:.]+$/g, '').replace(/^(alt|alternate|alternative|cell|mobile|direct|office|work|home|phone|tel|ph)\b\s*[:#.]?\s*/i, '')
    const d = phoneDigits(p.replace(/\s*(ext|x|extension)\.?\s*\d+$/i, ''))
    if (d.length < 7 || d.length > 15 || seen.has(d)) continue
    seen.add(d)
    out.push(p)
  }
  return out
}

// ------------------------------------------------------------------ hidden description

export interface EzLink { label: string; url: string }

const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>"',;)]+|(?:[a-z]{2,3}\.)?linkedin\.com\/[^\s<>"',;)]+)/gi
const ROLE_RE = /\b(CFO|CEO|COO|CTO|CIO|CISO|IT Director|IT Manager|Director of IT|VP(?: of)? (?:IT|Finance|Operations)|Controller|Purchasing(?: Manager)?|Procurement(?: Manager)?|Owner|President|Founder|Office Manager|Facilities(?: Manager)?)\b/i

export function normaliseUrl(u: string): string {
  const t = u.replace(/[.)\]]+$/, '')
  return /^https?:\/\//i.test(t) ? t : `https://${t}`
}

/** Hidden Description → clickable links (LinkedIn, CFO...) and the remaining text. */
export function parseHiddenDescription(cell: string | null | undefined): { links: EzLink[]; description: string | null } {
  const s = String(cell ?? '')
  if (!s.trim()) return { links: [], description: null }
  const links: EzLink[] = []
  const seen = new Set<string>()
  let lastEnd = 0
  for (const m of s.matchAll(URL_RE)) {
    const url = normaliseUrl(m[1])
    const k = url.toLowerCase().replace(/\/+$/, '')
    // A role written just before the link (and after the previous one) names it ("CFO: linkedin.com/in/...").
    const before = s.slice(Math.max(lastEnd, m.index! - 50), m.index!)
    lastEnd = m.index! + m[0].length
    if (seen.has(k)) continue
    seen.add(k)
    const role = [...before.matchAll(new RegExp(ROLE_RE.source, 'gi'))].pop()?.[1]
    const isLinkedIn = /linkedin\.com/i.test(url)
    const host = (() => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return 'Link' } })()
    links.push({ label: [role, isLinkedIn ? 'LinkedIn' : host].filter(Boolean).join(' '), url })
  }
  let rest = s.replace(URL_RE, ' ')
  // Labels left alone once their link is gone ("CFO LinkedIn:", "LinkedIn -").
  rest = rest.replace(new RegExp(`(?:${ROLE_RE.source})?\\s*(?:linked\\s*in|profile|link|url)?\\s*[:\\-–]\\s*(?=\\s|$)`, 'gi'), ' ')
  rest = rest.split('\n').map((l) => l.replace(/\s+/g, ' ').replace(/^[\s,;|\-–:]+|[\s,;|\-–:]+$/g, '')).filter(Boolean).join('\n')
  return { links, description: rest || null }
}

// ------------------------------------------------------------------ a new person in a note

export interface ContactCandidate { name: string | null; title: string | null; email: string | null; phone: string | null; linkedin: string | null; key: string }

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b(?:\s*(?:ext|x)\.?\s*\d{1,6})?/gi
const NAME = '([A-Z][a-z]+(?:[\' -][A-Z][a-z]+){1,2})'
/** "spoke with Sara Khan", "Sara Khan (purchasing manager)", "purchasing manager Sara Khan", "contact: Sara Khan". */
// Case is spelled out (no `i` flag) so a name still has to start with capitals.
const NAME_PATTERNS = [
  new RegExp(`\\b(?:[Ss]poke|[Tt]alked|[Ss]peak|[Tt]alk|[Mm]et|[Ee]mailed|[Cc]alled|[Rr]eached)\\s+(?:to\\s+|with\\s+)?${NAME}`),
  new RegExp(`\\b(?:[Nn]ew [Cc]ontact|[Cc]ontact|POC|[Pp]oint of [Cc]ontact|[Aa]dded|[Nn]ame)\\s*(?:is|:|-)?\\s*${NAME}`),
  new RegExp(`${NAME}\\s*[(<]\\s*[A-Za-z0-9._%+-]+@`),
  new RegExp(`${NAME}\\s*[,(]\\s*(?:the\\s+)?(?:${ROLE_RE.source})`, 'i'),
  new RegExp(`(?:${ROLE_RE.source})\\s*(?:is|:|-|,)?\\s*${NAME}`),
]
const STOP_NAMES = /^(Left Voicemail|Called Back|Follow Up|Next Week|Not Interested|Thank You|Good Morning|Earth Zone)$/i

/**
 * People a note names with a way to reach them. The lead's own contact details (`known`) are left out, so only
 * someone new is offered. One candidate per sentence that holds an email, phone or LinkedIn link.
 */
export function findContacts(text: string, known: (string | null | undefined)[] = []): ContactCandidate[] {
  const knownSet = new Set(known.filter(Boolean).map((k) => (/@/.test(k!) ? k!.toLowerCase() : phoneDigits(k!) || k!.toLowerCase())))
  const out: ContactCandidate[] = []
  const seen = new Set<string>()
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const email = sentence.match(EMAIL_RE)?.find((e) => !knownSet.has(e.toLowerCase()))?.toLowerCase() ?? null
    const phoneRaw = sentence.replace(EMAIL_RE, ' ').match(PHONE_RE)?.find((p) => !knownSet.has(phoneDigits(p))) ?? null
    const li = [...sentence.matchAll(URL_RE)].map((m) => normaliseUrl(m[1])).find((u) => /linkedin\.com\/in\//i.test(u)) ?? null
    if (!email && !phoneRaw && !li) continue
    let name: string | null = null
    for (const re of NAME_PATTERNS) {
      const m = sentence.match(re)
      const n = m ? m.slice(1).find((g) => g && /^[A-Z][a-z]+[' -][A-Z]/.test(g)) : undefined
      if (n && !STOP_NAMES.test(n)) { name = cleanName(n); break }
    }
    const title = sentence.match(ROLE_RE)?.[1] ?? null
    const key = email ?? (phoneRaw ? `tel:${phoneDigits(phoneRaw)}` : li!.toLowerCase().replace(/\/+$/, ''))
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name, title, email, phone: phoneRaw?.trim() ?? null, linkedin: li, key })
  }
  return out
}
