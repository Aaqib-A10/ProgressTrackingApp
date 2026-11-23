import { DateTime } from 'luxon'
import type { Args, Column, Ctx, Entry, Flag, Loaded, Row, Table } from './types'

/**
 * The one reader behind `metriq_data`: rows of any data set, filtered and counted here, never by the model.
 *
 * What it guarantees, each learned from a wrong answer on the live site:
 *  - Totals come first and always cover every row, so a filter the model added on its own never hides them.
 *  - A filter value that matches nothing real (a status that does not exist, a person who is not in the data) is left
 *    out and said so, instead of answering "none".
 *  - Dates the model added that leave nothing are dropped, with a note, when there are rows without them.
 *  - Every row has every column of the heading ("-" when empty): a missing field once made the model invent a date.
 *  - "me" is the person asking, matched by id when the data has one.
 */

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')
export const norm = (v: unknown) => String(v ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim()
export const ME_WORDS = /^(me|mine|my|myself|self|i|own|mera|meri|mere|apna|apni|apne|main|mujhe)$/i
const ALL_WORDS = /^(all|any|anyone|everyone|everybody|sab|sabhi|company|(the |our |my |whole |entire )*(team|department|dept))$/i

/** The same person? Every word of the shorter name is a word (or the start of one) of the longer. */
export function sameName(given: string, real: string): boolean {
  const g = norm(given).split(' ').filter(Boolean), r = norm(real).split(' ').filter(Boolean)
  if (!g.length || !r.length) return false
  const inside = (a: string[], b: string[]) => a.every((w) => b.some((x) => x === w || (w.length >= 3 && x.startsWith(w))))
  return inside(g, r) || inside(r, g)
}

/** A day (YYYY-MM-DD) on the company's clock from a date or an ISO time; '' when it is neither. */
export function dayOf(v: unknown, zone: string): string {
  const s = str(v)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) { const d = DateTime.fromISO(s).setZone(zone); return d.isValid ? d.toISODate()! : '' }
  return ''
}

function show(c: Column, v: unknown, t: Table, zone: string, long = 600): string {
  if (v == null || v === '') return '-'
  const word = t.words?.[c.key]?.[String(v)]
  if (word) return word
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (c.kind === 'date') { const d = dayOf(v, zone); return d ? DateTime.fromISO(d).toFormat('ccc d LLL yyyy') : String(v) }
  if (c.kind === 'time') { const d = DateTime.fromISO(String(v)).setZone(zone); return d.isValid ? d.toFormat('ccc d LLL yyyy, h:mm a') : String(v) }
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString('en-US') : v.toLocaleString('en-US', { maximumFractionDigits: 2 })
  const s = String(v).replace(/\s+/g, ' ').trim()
  const max = c.kind === 'long' ? long : 160
  return s.length > max ? `${s.slice(0, max)}…` : s || '-'
}

/** Words split on commas, "and", "or", "|" and "/": "requested and assigned" is two values. */
const several = (s: string) => s.split(/\s*(?:,|\||\/|\band\b|\bor\b|\baur\b|\bya\b)\s*/i).map((x) => x.trim()).filter(Boolean)

export function renderTable(e: Entry, d: Loaded, a: Args, ctx: Ctx): string {
  const t = d.table ?? e.table!
  const notes = [...(d.notes ?? [])]
  const [one, many] = t.unit
  const n = (k: number) => `${k.toLocaleString('en-US')} ${k === 1 ? one : many}`
  const colOf = (key: string): Column => t.columns.find((c) => c.key === key) ?? { key, label: key }
  const word = (key: string, v: unknown) => show(colOf(key), v, t, ctx.zone)
  const all = d.rows
  let rows = all
  const applied: string[] = []

  // ---- person
  const p = str(a.person)
  if (p && !ALL_WORDS.test(p)) {
    const isMe = ME_WORDS.test(p) || sameName(p, ctx.me.name) || p === ctx.me.id
    const named = (r: Row, name: string) => (t.people ?? []).some((k) => sameName(name, String(r[k] ?? '')))
    if (!t.mine && !t.people?.length) notes.push('This data is not kept per person, so the person was left out.')
    else if (isMe) {
      rows = rows.filter((r) => (t.mine ? r[t.mine] === ctx.me.id : named(r, ctx.me.name)))
      applied.push(`${ctx.me.name}'s own`)
      if (!rows.length && all.length) notes.push(`None of these ${many} are ${ctx.me.name}'s own. The "All" numbers cover everyone this person can see.`)
    } else if (all.some((r) => named(r, p))) {
      rows = rows.filter((r) => named(r, p))
      applied.push(`person "${p}"`)
    } else {
      const people = [...new Set(all.flatMap((r) => (t.people ?? []).map((k) => String(r[k] ?? '').trim())).filter(Boolean))]
      notes.push(`Nobody called "${p}" is in this data, so that was left out. People here: ${people.slice(0, 40).join(', ') || 'none'}.`)
    }
  }

  // ---- flags ("only") and status; a status word that is really a flag ("low", "overdue") is treated as the flag
  const flags = Object.entries(t.flags ?? {})
  const flagOf = (g: string) => {
    const x = norm(g)
    return flags.find(([k, f]) => norm(k) === x || norm(f.label) === x || f.says.some((s) => norm(s) === x))
      ?? flags.find(([k, f]) => [k, f.label, ...f.says].some((s) => norm(s).includes(x) || x.includes(norm(s))))
  }
  // A condition is applied only when the person asked for it. The model adds conditions of its own ("only: meetings"
  // for "what is on my calendar?", "deadline still ahead" for "our last meeting notes"), and the answer then leaves out
  // what the person wanted (metra:check, 21 Nov 2026). When the question names another condition of this data, that
  // one is used instead ("which items need restocking?" read with "low stock": "needs restocking" is what was asked).
  // The counts of every condition are printed whatever happens, so nothing is lost by not narrowing.
  const said = (phrase: string) => !!ctx.asked && !!norm(phrase) && new RegExp(`(^| )${norm(phrase).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(` ${norm(ctx.asked)}`)
  const asksFor = (f: [string, Flag]) => [f[0], f[1].label, ...f[1].says].some(said)
  const wanted: string[] = []
  for (const g of several(str(a.only))) {
    const f = flagOf(g)
    if (!ctx.asked || !f || asksFor(f)) { wanted.push(g); continue }
    const instead = flags.find((x) => asksFor(x))
    if (instead) { if (!wanted.includes(instead[0])) wanted.push(instead[0]); notes.push(`The question asks for "${instead[1].label}", so that was used instead of "${f[1].label}".`) }
    else notes.push(`The question does not ask for "${f[1].label}", so all ${many} are listed (how many are ${f[1].label} is counted above).`)
  }
  const statuses = new Set<string>()
  const st = str(a.status)
  if (st && !/^(all|any)$/i.test(st)) {
    if (!t.status) { for (const g of several(st)) (flagOf(g) ? wanted.push(g) : notes.push(`This data has no status "${g}", so it was left out.`)) }
    else {
      const known = [...new Set([...all.map((r) => String(r[t.status!] ?? '')), ...Object.keys(t.words?.[t.status] ?? {})].filter(Boolean))]
      const keep = new Set<string>()
      for (const g of several(st)) {
        const x = norm(g)
        const hit = known.filter((v) => norm(v) === x || norm(word(t.status!, v)) === x)
        const loose = hit.length ? hit : known.filter((v) => norm(v).includes(x) || norm(word(t.status!, v)).includes(x))
        if (loose.length) loose.forEach((v) => keep.add(v))
        else if (flagOf(g)) wanted.push(g)
        else notes.push(`There is no status "${g}" here, so it was left out. The statuses are: ${known.map((v) => word(t.status!, v)).join(', ') || 'none'}.`)
      }
      for (const v of keep) statuses.add(v)
    }
  }
  const conditions: string[] = []
  for (const g of wanted) {
    const f = flagOf(g)
    if (f) { rows = rows.filter((r) => f[1].test(r, ctx)); applied.push(f[1].label); conditions.push(f[1].label) }
    else notes.push(`"${g}" is not something this data can be narrowed to, so it was left out.${flags.length ? ` It can be: ${flags.map(([, x]) => x.label).join(', ')}.` : ''}`)
  }
  if (statuses.size && t.status) {
    const narrowed = rows.filter((r) => statuses.has(String(r[t.status!] ?? '')))
    const names = [...statuses].map((v) => word(t.status!, v)).join(' or ')
    // A condition AND a status ("not resolved" + "Requested") is usually the model narrowing twice: "any pending stock
    // requests?" was answered with 2 of the 3 open ones, and then with a made-up third row (metra:check, 15 Nov). So
    // the status does not drop rows the condition kept: all of them are listed, and how many have that status is said.
    if (conditions.length && narrowed.length < rows.length) notes.push(`All ${rows.length} that are ${conditions.join(' and ')} are listed. ${narrowed.length} of them ${narrowed.length === 1 ? 'has' : 'have'} the status ${names} (see the status of each row). Unless the person named that status, the answer to their question is all ${rows.length}.`)
    else { rows = narrowed; applied.push(`status ${names}`) }
  }

  // ---- words
  const q = norm(a.search).split(' ').filter((w) => w.length >= 2)
  if (q.length) {
    const hay = (r: Row) => norm(t.columns.map((c) => `${r[c.key] ?? ''} ${word(c.key, r[c.key])}`).join(' '))
    const every = rows.filter((r) => { const h = hay(r); return q.every((w) => h.includes(w)) })
    const some = every.length ? every : rows.filter((r) => { const h = hay(r); return q.some((w) => h.includes(w)) })
    // Words that are in no row at all ("Vendor" for the rows of the Vendors block, whose name is the data set itself)
    // would leave nothing to answer from: they are dropped, as dates the model added that match nothing are.
    if (!some.length && rows.length) notes.push(`No ${one} contains "${str(a.search)}", so the words were left out: all ${many} are listed.`)
    else {
      if (!every.length) notes.push(`No ${one} has all of the words "${str(a.search)}"; these have some of them.`)
      rows = some
      applied.push(`words "${str(a.search)}"`)
    }
  }

  // ---- dates
  const ymd = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(str(v)) ? str(v) : '')
  const from = ymd(a.from), to = ymd(a.to)
  if ((from || to) && !d.dated) {
    if (!t.date) notes.push('This data has no date to narrow by, so the dates were left out.')
    else {
      const inside = rows.filter((r) => { const day = dayOf(r[t.date!], ctx.zone); return !!day && (!from || day >= from) && (!to || day <= to) })
      // Dates the model added on its own often leave nothing ("pending requests" with today's date): then they are dropped.
      if (!inside.length && rows.length) notes.push(`Nothing has its ${colOf(t.date).label} ${from && to ? `from ${from} to ${to}` : from ? `on or after ${from}` : `on or before ${to}`}, so the dates were left out: what follows is for any date.`)
      else { rows = inside; applied.push(`${colOf(t.date).label} ${from && to ? `${from} to ${to}` : from ? `from ${from}` : `up to ${to}`}`) }
    }
  }

  // ---- counting
  const tally = (rs: Row[], key: string) => {
    const m = new Map<string, number>()
    for (const r of rs) { const v = word(key, r[key]); m.set(v, (m.get(v) ?? 0) + 1) }
    return [...m].sort((x, y) => y[1] - x[1])
  }
  const sum = (rs: Row[], key: string) => rs.reduce((s, r) => s + (typeof r[key] === 'number' ? (r[key] as number) : Number(r[key]) || 0), 0)
  const num = (x: number) => (Number.isInteger(x) ? x.toLocaleString('en-US') : x.toLocaleString('en-US', { maximumFractionDigits: 2 }))
  const summary = (rs: Row[]) => [
    `${n(rs.length)}`,
    ...(t.status && rs.length ? [`by ${colOf(t.status).label}: ${tally(rs, t.status).map(([v, k]) => `${v} ${k}`).join(', ')}`] : []),
    ...(rs.length ? (t.groups ?? []).map((g) => `by ${colOf(g).label}: ${tally(rs, g).slice(0, 15).map(([v, k]) => `${v} ${k}`).join(', ')}`) : []),
    ...(flags.length ? [flags.map(([, f]) => `${f.label} ${rs.filter((r) => f.test(r, ctx)).length}`).join(', ')] : []),
    ...(rs.length ? (t.sums ?? []).map((s) => `total ${colOf(s).label} ${num(sum(rs, s))}`) : []),
  ].join('; ')

  const out: string[] = [`${e.label} (${e.area})${e.app ? `, the screen at ${e.app}` : ''}, read just now as ${ctx.me.name}.`, ...(d.head ?? [])]
  out.push(`All: ${summary(all)}.`)
  if (applied.length) out.push(`Matching (${applied.join(', ')}): ${summary(rows)}.`)

  // ---- grouped
  const g = norm(a.group_by)
  if (g) {
    const alias = g === 'person' || g === 'people' || g === 'agent' || g === 'member' ? t.people?.[0] : g === 'status' ? t.status : undefined
    const by = t.columns.find((c) => c.key === alias) ?? t.columns.find((c) => norm(c.key) === g || norm(c.label) === g) ?? t.columns.find((c) => norm(c.label).includes(g) || g.includes(norm(c.label)))
    if (!by) notes.push(`This data cannot be grouped by "${str(a.group_by)}". It has: ${t.columns.filter((c) => !c.hidden).map((c) => c.label).join(', ')}.`)
    else out.push(`Grouped by ${by.label}: ${tally(rows, by.key).slice(0, 40).map(([v, k]) => `${v} ${k}${(t.sums ?? []).filter((s) => s !== by.key).map((s) => `, ${colOf(s).label} ${num(sum(rows.filter((r) => word(by.key, r[by.key]) === v), s))}`).join('')}`).join('; ') || 'nothing'}.`)
  }

  // ---- the rows: those the question names (a person, an item) come first, so a long list does not cut them off
  if (ctx.asked && rows.length > 5) {
    const said2 = ` ${norm(ctx.asked)} `
    const keys = [...(t.people ?? []), t.columns.find((c) => !c.hidden)?.key].filter((k): k is string => !!k)
    const named = (r: Row) => keys.some((k) => { const v = norm(r[k]); return v.length >= 4 && said2.includes(` ${v} `) })
    if (rows.some(named)) rows = [...rows.filter(named), ...rows.filter((r) => !named(r))]
  }
  const cols = t.columns.filter((c) => !c.hidden)
  let limit = Math.min(60, Math.max(1, Math.round(Number(a.limit)) || 25))
  const line = (r: Row, long: number) => cols.map((c) => show(c, r[c.key], t, ctx.zone, long)).join(' | ')
  const body = (k: number) => rows.slice(0, k).map((r) => line(r, k <= 5 ? 900 : k <= 12 ? 400 : 200))
  let listed = body(limit)
  while (listed.join('\n').length > 6500 && limit > 3) { limit = Math.max(3, Math.floor(limit * 0.7)); listed = body(limit) }
  if (rows.length) {
    out.push(`\n${applied.length ? 'Matching' : 'The'} ${many} (${Math.min(limit, rows.length)} of ${rows.length}${rows.length > limit ? '; the numbers above count all of them, ask with a filter or a bigger limit for the rest' : ''}):`)
    out.push(cols.map((c) => c.label).join(' | '))
    out.push(...listed)
  } else out.push(applied.length ? `\nNo ${many} match.` : `\nThere are no ${many}.`)
  for (const x of notes) out.push(`[Note: ${x}]`)
  out.push('[These numbers were counted by Metriq: use them as they are, do not count the rows yourself.]')
  if (e.tip) out.push(e.tip)
  return out.join('\n')
}
