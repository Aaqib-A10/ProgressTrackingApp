import { DateTime } from 'luxon'
import type { Role } from '@prisma/client'
import { companyTz } from '../../time'
import type { Asker } from '../access'
import type { Args, Ctx, Entry } from './types'
import { resolvePeriod, type PeriodAsk } from './period'
import { norm, renderTable } from './table'
import { isFollowUp, plainWords } from '../talk'
import { CORE_PERSONAL, CORE_WORK, RANGES_LINE } from './core'
import { CALENDAR } from './calendar'
import { ECOMMERCE } from './ecommerce'
import { INVENTORY } from './inventory'
import { PEOPLE } from './people'
import { NUMBERS } from './numbers'
import { MARKETING } from './marketing'
import { WORK } from './work'
import { MORE } from './more'
import { BUSINESS } from './business'

/**
 * The catalog: every entry, the guide made from it for one person and one question, and the `metriq_data` reader.
 * Order matters for the guide: personal screens, the calendar, then each area.
 */
export const ENTRIES: Entry[] = [...CORE_PERSONAL, ...CALENDAR, ...PEOPLE, ...CORE_WORK, ...NUMBERS, ...MARKETING, ...ECOMMERCE, ...INVENTORY, ...WORK, ...MORE, ...BUSINESS]

export type { Entry, Args, Ctx } from './types'

/** Entries this person can open (the API checks again on every read). */
export const entriesFor = (a: Asker): Entry[] => ENTRIES.filter((e) => e.who(a))
/** Those of them that `metriq_data` reads. */
export const readable = (a: Asker): Entry[] => entriesFor(a).filter((e) => e.load && e.table)

// ------------------------------------------------------------------ which entries fit a question

const STOP = new Set('the a an of in on for to is are my me i do does did how many much what which who whom have has had this that these those and or with at by it be was were we our you your can any there from show give tell list please get see about into out up all some more most now right just also than then their them they he she his her its not no yes ka ki ke ko se hai hain mein kya aur ya ye yeh wo woh kar karo do dikhao batao kitna kitne kitni'.split(' '))

/** How well an entry fits some words: its own phrases found in the text count most, shared plain words a little. */
export function fit(e: Entry, text: string): number {
  const t = ` ${norm(text)} `
  if (t.trim() === '') return 0
  // The longest of its phrases found in the text counts in full; each further one a little. (Adding them all up let an
  // entry with many near-synonyms, "request", "requests", "stock request", outweigh the team named in the question.)
  const found: number[] = []
  for (const phrase of [e.label, ...e.says]) {
    const p = norm(phrase)
    if (p && (t.includes(` ${p} `) || t.includes(` ${p}s `))) found.push(2 * p.split(' ').length + 1)
  }
  found.sort((x, y) => y - x)
  let s = found.length ? found[0] + Math.min(4, found.length - 1) : 0
  // The area named in the question ("e-commerce stock requests", "inventory") says which team's data is meant.
  const area = norm(e.area).replace(/ /g, '')
  if (area.length >= 5 && t.replace(/ /g, '').includes(area)) s += 6
  const own = new Set(norm(`${e.label} ${e.area} ${e.about}`).split(' ').filter((w) => w.length >= 4 && !STOP.has(w)))
  for (const w of new Set(t.trim().split(' '))) if (w.length >= 4 && !STOP.has(w) && (own.has(w) || own.has(w.replace(/s$/, '')))) s += 0.5
  return s
}

/**
 * The readable entries by how well they fit the question, best first. Roman Urdu words are matched through their
 * English meaning. The question before counts at half weight, and at full weight when this one is a follow-up
 * ("and last month?" names nothing itself).
 */
export function rank(a: Asker, question: string, earlier = ''): { e: Entry; s: number }[] {
  const q = plainWords(question), before = plainWords(earlier)
  const weight = isFollowUp(question, earlier) ? 1 : 0.5
  return readable(a)
    .map((e) => ({ e, s: fit(e, q) + fit(e, before) * weight }))
    .filter((x) => x.s >= 2)
    .sort((x, y) => y.s - x.s)
}

/** The readable entries that fit the question best. */
export function pick(a: Asker, question: string, earlier = '', max = 4): Entry[] {
  return rank(a, question, earlier).slice(0, max).map((x) => x.e)
}

/**
 * Two data sets of different areas that fit a question equally well ("stock" is both the e-commerce team's stock
 * requests and the warehouse stock list): the model is told so, to read both or ask, instead of guessing one.
 */
export function unclear(a: Asker, question: string, earlier = ''): [Entry, Entry] | null {
  const [x, y] = rank(a, question, earlier)
  if (!x || !y || x.e.area === y.e.area) return null
  return x.s >= 3 && y.s >= x.s * 0.55 ? [x.e, y.e] : null
}

/**
 * The one data set a question is plainly about ("what is in my notes?" is Notes): the model is told to read it first.
 * It went to the search or another tool instead (notes, a colleague's email, the e-commerce board; metra:check,
 * 21 Nov 2026) although the guide ranked the right data set first.
 */
export function clear(a: Asker, question: string, earlier = ''): Entry | null {
  const [x, y] = rank(a, question, earlier)
  // Alone, even a weak fit is the one ("what is X's email?" fits only the directory); with others, a clear lead.
  if (!x || x.s < (y ? 5 : 3)) return null
  return !y || y.s < x.s * 0.55 ? x.e : null
}

// ------------------------------------------------------------------ the guide

/** One guide line for an entry read by metriq_data, made from its table: what it is and how it can be narrowed. */
export function lineOf(e: Entry): string {
  const t = e.table!
  const flags = Object.values(t.flags ?? {}).map((f) => f.label)
  const own = [
    flags.length ? `only: ${flags.join(' / ')}` : '',
    e.takes?.includes('range') ? 'range (today, week, month, rolling3m) or from and to' : '',
    e.takes?.includes('date') ? 'date' : '',
    e.takes?.includes('item') ? 'item (its name)' : '',
  ].filter(Boolean)
  return `${e.label.toUpperCase()} (${e.area}): ${e.about} → metriq_data what="${e.key}"${own.length ? ` [${own.join('; ')}]` : ''}.`
}

/** Said once, above the data sets: what every metriq_data call gives and how any of them is narrowed. */
export const DATA_LINE = 'DATA SETS read with metriq_data (below): one call gives the totals, the count for each status and each condition, and the rows, all counted by Metriq. Any of them can be narrowed with person (a name, or "me"), status, search (words), from and to (dates) and group_by; the options in [brackets] belong to that one data set ("only" takes one of the conditions named).'

/**
 * The guide for this person and this question: every hand-written line they are entitled to (as before the catalog),
 * the full line of each data set that is their own team's or fits the question, and the rest by name only.
 */
export function guideFor(a: Asker, question = '', earlier = '', page = ''): string[] {
  const chosen = new Set(pick(a, question, earlier).map((e) => e.key))
  // The data sets of the screen the person is looking at are always given in full.
  if (page) for (const e of readable(a)) if (e.app && (e.app === page || page.startsWith(`${e.app}/`))) chosen.add(e.key)
  const two = unclear(a, question, earlier)
  const lines: string[] = []
  const rest: Entry[] = []
  let said = false
  for (const e of entriesFor(a)) {
    if (e.guide) { const l = e.guide(a); if (l) lines.push(l); continue }
    if (!e.load || !e.table) continue
    if (e.pin?.(a) || chosen.has(e.key)) { if (!said) { lines.push(DATA_LINE); said = true } lines.push(lineOf(e)) } else rest.push(e)
  }
  if (rest.length) lines.push(`More data sets read the same way (metriq_data with what = the name in quotes): ${rest.map((e) => `"${e.key}" = ${e.label} (${e.area})`).join('; ')}.`)
  const one = clear(a, question, earlier)
  if (one && !two) lines.push(`THIS QUESTION is answered by "${one.key}" (${one.label}, ${one.area}): read it first with metriq_data what="${one.key}", before search_metriq or any other tool, and answer from what it gives. Search is for words inside records, not for this.`)
  if (two) lines.push(`THIS QUESTION fits two data sets about equally: "${two[0].key}" (${two[0].label}, ${two[0].area}) and "${two[1].key}" (${two[1].label}, ${two[1].area}). If the person's words or the screen they are on do not say which, read both in the same round and answer for each under its own name; ask one short question only if the two answers would contradict each other.`)
  lines.push(RANGES_LINE)
  return lines
}

// ------------------------------------------------------------------ metriq_data

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')

/** The entry the model means: its key, its name on the sidebar, or the words that fit it best. */
export function entryOf(a: Asker, what: unknown): Entry | null {
  const list = readable(a)
  const w = str(what)
  if (!w) return null
  const x = norm(w)
  return list.find((e) => e.key === w) ?? list.find((e) => norm(e.key) === x || norm(e.label) === x || norm(`${e.area} ${e.label}`) === x)
    ?? list.map((e) => ({ e, s: fit(e, w) })).filter((y) => y.s >= 2).sort((p, q) => q.s - p.s)[0]?.e ?? null
}

export function ctxOf(a: Asker, me: { id: string; role: Role; name: string }, now = new Date(), asked?: string, ask?: PeriodAsk | null): Ctx {
  const zone = companyTz()
  const today = DateTime.fromJSDate(now).setZone(zone).toISODate()!
  return { me, asker: a, zone, now, today, ...(asked ? { asked } : {}), ...(ask ? { period: resolvePeriod(ask, today, zone) } : {}) }
}

/** The question is about the asker themself ("my attendance", "was I late"), not their team or another person. */
// Not "me" or "mujhe": "tell me Ali's hours" / "mujhe batao" are about someone else as often as not.
const ABOUT_ME = /\b(my|mine|myself|i|i'm|im|meri|mera|mere|main)\b/i
const ABOUT_OTHERS = /\b(team|team's|teams|everyone|everybody|all|who|whose|whom|people|staff|members?|employees|agents|reps|others|each|sab|sabki|kaun|kis|log|department|dept)\b/i
export function aboutMe(asked: string, person?: string, myName?: string): boolean {
  if (person && !/^(me|my|mine|myself|i|self)$/i.test(person.trim()) && !(myName && person.trim().toLowerCase() === myName.trim().toLowerCase())) return false
  return ABOUT_ME.test(asked) && !ABOUT_OTHERS.test(asked)
}

/** The words a read is judged against: the question (Roman Urdu also in English) and, for a follow-up, the one it continues. */
export function askedWords(question: string, earlier = ''): string {
  return [plainWords(question), isFollowUp(question, earlier) ? plainWords(earlier) : ''].filter(Boolean).join(' ')
}

/** Read one data set as the person: filtered and counted by Metriq, as text for the model. */
export async function readData(a: Asker, me: { id: string; role: Role; name: string }, given: Record<string, unknown>, asked?: string, ask?: PeriodAsk | null): Promise<{ ok: boolean; text: string }> {
  let e = entryOf(a, given.what)
  // A question about the asker themself is read from their own data set, even when the model picked the team's.
  const switched: string[] = []
  if (e?.personal && asked && aboutMe(asked, str(given.person) || undefined, me.name)) {
    const own = entryOf(a, e.personal)
    if (own) { switched.push(`The person asked about themself, so this is ${own.label} (their own), not ${e.label}.`); e = own; given = { ...given, person: undefined } }
  }
  if (!e) {
    const open = readable(a)
    return { ok: false, text: `There is no data set "${str(given.what)}" for this person. The ones they can read: ${open.map((x) => `"${x.key}" (${x.label}, ${x.area})`).join('; ') || 'none'}. Other screens are read with the tools named in the guide.` }
  }
  const args: Args = {
    person: str(given.person) || undefined, status: str(given.status) || undefined, only: str(given.only) || undefined, search: str(given.search) || undefined,
    from: str(given.from) || undefined, to: str(given.to) || undefined, range: str(given.range) || undefined, date: str(given.date) || undefined,
    item: str(given.item) || undefined, group_by: str(given.group_by) || undefined, limit: Number(given.limit) || undefined,
  }
  const ctx = ctxOf(a, me, new Date(), asked, ask)
  // The period named in the person's words wins over the dates the model sent (period.ts).
  const p = ctx.period
  if (p) {
    const fromWas = args.from, toWas = args.to, dateWas = args.date, rangeWas = args.range
    args.from = p.from; args.to = p.to; args.date = p.from === p.to ? p.from : undefined; args.range = undefined
    if ((fromWas && fromWas !== p.from) || (toWas && toWas !== p.to) || (dateWas && dateWas !== args.date) || (rangeWas && p.from !== p.to)) switched.push(`The dates sent (${[rangeWas && `range ${rangeWas}`, dateWas && `date ${dateWas}`, fromWas && `from ${fromWas}`, toWas && `to ${toWas}`].filter(Boolean).join(', ')}) were replaced by the period the person named.`)
  }
  // An entry that breaks on data it did not expect says so; it never takes the whole answer down.
  try {
    const got = await e.load!(ctx, args)
    // "Nothing here: ..." is an answer (there is none), not a failed lookup.
    if ('error' in got) return { ok: got.error.startsWith('Nothing here:'), text: got.error }
    const usesDates = !!got.dated || !!(got.table ?? e.table)?.date || (e.takes ?? []).some((t) => t !== 'item')
    const period = p && usesDates ? [`THE PERIOD ASKED: ${p.label}${p.current ? ', up to today' : ''}. Every number below is for this period. Name exactly this period in the answer; never call it anything else.`] : []
    got.head = [...period, ...switched, ...(got.head ?? [])]
    return { ok: true, text: renderTable(e, got, args, ctx) }
  } catch (err) {
    return { ok: false, text: `${e.label} could not be read just now (${(err as Error).message.slice(0, 160)}). Say that this part of Metriq could not be read; do not guess its numbers.` }
  }
}

/** The tool as the model sees it: `what` can only be a data set this person can open. */
export function dataTool(a: Asker): { name: string; description: string; parameters: Record<string, unknown> } | null {
  const open = readable(a)
  if (!open.length) return null
  return {
    name: 'metriq_data',
    description: 'Read one Metriq data set, already counted by Metriq: totals, the count for each status, and the rows. Use it for every data set the guide gives with metriq_data (calendar, e-commerce, inventory...). One call gives all the counts; add options only to narrow the rows.',
    parameters: {
      type: 'object',
      properties: {
        what: { type: 'string', enum: open.map((e) => e.key), description: 'The data set, exactly as named in the guide.' },
        only: { type: 'string', description: 'Narrow to one condition the guide names for this data set, e.g. "low stock", "overdue", "not resolved".' },
        status: { type: 'string', description: 'Narrow to a status of this data set.' },
        person: { type: 'string', description: 'A person\'s name, or "me" for the person asking. Leave out for everyone.' },
        search: { type: 'string', description: 'Words to find in the rows (an item, a title, a name).' },
        from: { type: 'string', description: 'YYYY-MM-DD. ONLY when the person names a period.' },
        to: { type: 'string', description: 'YYYY-MM-DD (inclusive).' },
        range: { type: 'string', enum: ['today', 'week', 'month', 'rolling3m'], description: 'For data sets that take a range, instead of from/to.' },
        date: { type: 'string', description: 'YYYY-MM-DD, for data sets that are about one day.' },
        item: { type: 'string', description: 'The name of one item, for data sets about one item.' },
        group_by: { type: 'string', description: 'Count the rows per value of a column, e.g. "category", "person", "marketplace".' },
        limit: { type: 'number', description: 'How many rows to list (default 25, max 60). Counts always cover every row.' },
      },
      required: ['what'],
      additionalProperties: false,
    },
  }
}
