import { DateTime } from 'luxon'
import { apiAs, apiError } from '../../mcp/api'
import { fixRange } from '../../mcp/departmentTools'
import type { Args, Column, Ctx, Loaded, Row, Table } from './types'

/**
 * How catalog entries read Metriq: the app's own API, as the person (lib/mcp/api.ts), so every check the screen makes
 * is made again. A screen the person may not open answers "not open to you", never data.
 */

export type Got<T> = { body: T; error?: undefined } | { error: string; body?: undefined }

/** When set (by npm run metra:coverage), every address read is written here: the gate checks an entry reads what it says it stands for. */
let trace: string[] | null = null
export function traceCalls(on: boolean): string[] { const got = trace ?? []; trace = on ? [] : null; return got }

export async function get<T>(ctx: Ctx, path: string, query: Record<string, string> = {}): Promise<Got<T>> {
  trace?.push(path)
  const r = await apiAs(ctx.me, 'GET', path, { query })
  if (r.status === 403) return { error: `That screen is not open to ${ctx.me.name} (${apiError(r)}).` }
  if (r.status >= 400) return { error: `${path}: ${apiError(r)}` }
  return { body: r.body as T }
}

const YMD = /^\d{4}-\d{2}-\d{2}$/
export const ymd = (v: unknown): string => (typeof v === 'string' && YMD.test(v.trim()) ? v.trim() : '')

/**
 * The period for a screen that takes range=today|week|month|rolling3m|custom. Two dates win over a range word; one
 * date runs to today (or from it). Other words ("year", "last month", "yesterday") become the dates they mean.
 */
export function period(a: Args, ctx: Ctx, fallback = 'month'): { query: Record<string, string>; notes: string[] } {
  const from = ymd(a.from), to = ymd(a.to)
  // One day asked for ("on 12 November"): that day alone.
  if (!from && !to && ymd(a.date)) return { query: { range: 'custom', start: ymd(a.date), end: ymd(a.date) }, notes: [] }
  if (from || to) {
    const start = from || to, end = to || (from > ctx.today ? from : ctx.today)
    return { query: { range: 'custom', start: start <= end ? start : end, end: start <= end ? end : start }, notes: [] }
  }
  const query: Record<string, string> = { range: (typeof a.range === 'string' && a.range.trim()) || fallback }
  const note = fixRange(query, DateTime.fromJSDate(ctx.now).setZone(ctx.zone))
  return { query, notes: note ? [note] : [] }
}

/** A window of days for screens that take two dates: the given ones, else `days` from today. */
export function span(a: Args, ctx: Ctx, days: number, back = 0): { from: string; to: string; asked: boolean } {
  const today = DateTime.fromISO(ctx.today, { zone: ctx.zone })
  let from = ymd(a.from) || ymd(a.date), to = ymd(a.to) || ymd(a.date)
  const asked = !!(from || to)
  if (!from && !to) { from = today.minus({ days: back }).toISODate()!; to = today.plus({ days }).toISODate()! }
  else if (!to) to = DateTime.fromISO(from, { zone: ctx.zone }).plus({ days }).toISODate()!
  else if (!from) from = today.toISODate()! <= to ? today.toISODate()! : to
  if (from > to) [from, to] = [to, from]
  return { from, to, asked }
}

/**
 * The usual shape of an entry's `load`: one screen address, its options from the model's arguments, the rows taken
 * out of the answer, and the lines to print first. Keeps an entry to what is particular about its screen.
 */
export function reader<B>(path: string, o: {
  query?: (a: Args, ctx: Ctx) => { query: Record<string, string>; notes?: string[] }
  rows: (b: B, ctx: Ctx, a: Args) => Row[]
  head?: (b: B, ctx: Ctx, a: Args) => (string | false | null | undefined)[]
  dated?: boolean
}): (ctx: Ctx, a: Args) => Promise<Loaded | { error: string }> {
  return async (ctx, a) => {
    const q = o.query?.(a, ctx) ?? { query: {} }
    const r = await get<B>(ctx, path, q.query)
    if (r.error !== undefined) return { error: r.error }
    return { rows: o.rows(r.body, ctx, a), head: (o.head?.(r.body, ctx, a) ?? []).filter((x): x is string => typeof x === 'string' && !!x), notes: q.notes ?? [], dated: o.dated }
  }
}

export const words = (k: string) => k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase()

/**
 * Rows of a screen whose fields are not fixed in code (a form, a block, or a list read as it comes): each row is made
 * flat (a nested person or brand becomes its name, a list its names), ids are dropped, and the table is built from the
 * fields that are there. Used for the long tail of screens; the main ones name their columns themselves.
 */
export function loose(list: unknown[], unit: [string, string], o: { people?: string[]; status?: string; date?: string; sums?: string[]; groups?: string[]; mine?: (x: Record<string, unknown>) => string; drop?: RegExp } = {}): { rows: Row[]; table: Table } {
  const rows: Row[] = []
  const kinds = new Map<string, Set<string>>()
  for (const item of list) {
    const x = (item && typeof item === 'object' ? item : { value: item }) as Record<string, unknown>
    const r: Row = {}
    for (const [k, v] of Object.entries(x)) {
      if (/^(id|companyId|order|position)$|Id$|Ids$|^can[A-Z]|^unread$|^presence$|token|secret|password/i.test(k) || o.drop?.test(k)) continue
      let val: string | number | boolean | null = null
      if (v == null) val = null
      else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') val = v
      else if (Array.isArray(v)) val = v.map((y) => (y && typeof y === 'object' ? nameOf(y) || String((y as { title?: unknown; label?: unknown }).title ?? (y as { label?: unknown }).label ?? '') : String(y))).filter(Boolean).join(', ') || null
      else val = nameOf(v) || (typeof (v as { title?: unknown }).title === 'string' ? ((v as { title: string }).title) : null)
      r[k] = val
      if (val != null && val !== '') { const s = kinds.get(k) ?? new Set<string>(); s.add(typeof val === 'number' ? 'number' : typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val) ? 'date' : 'text'); kinds.set(k, s) }
      else if (!kinds.has(k)) kinds.set(k, new Set())
    }
    if (o.mine) r.__mine = o.mine(x)
    rows.push(r)
  }
  const cols: Column[] = [...kinds].map(([k, s]) => ({ key: k, label: words(k), kind: /^(description|body|note|notes|text|comment|details|agenda|summary|content)$/i.test(k) ? 'long' as const : s.size === 1 && s.has('number') ? 'number' as const : s.size === 1 && s.has('date') ? 'date' as const : 'text' as const }))
  const has = (k?: string) => !!k && kinds.has(k)
  const status = has(o.status) ? o.status : has('status') ? 'status' : undefined
  return {
    rows,
    table: {
      unit, columns: [...(o.mine ? [{ key: '__mine', label: 'id', hidden: true }] : []), ...(cols.length ? cols : [{ key: 'value', label: unit[0] }])],
      people: (o.people ?? []).filter(has), mine: o.mine ? '__mine' : undefined, status, date: has(o.date) ? o.date : undefined,
      sums: (o.sums ?? []).filter(has), groups: (o.groups ?? []).filter((g) => has(g) && g !== status),
    },
  }
}

/**
 * A whole screen read as it comes: its single numbers and small groups of numbers are said first (they are the
 * screen's own totals), its longest list becomes the rows, and its other lists are named. For screens whose shape is
 * not written down in code; the main ones name their rows and columns themselves.
 */
export function auto(body: unknown, unit: [string, string], o: Parameters<typeof loose>[2] & { rows?: string; skip?: RegExp } = {}): Loaded {
  if (Array.isArray(body)) return loose(body, unit, o)
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const plain = (v: unknown) => typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && v.length > 0 && v.length <= 90)
  const quiet = (k: string) => /^(id|companyId|page|pageSize)$|Id$|^can[A-Z]|token|secret|password|^me$/i.test(k) || !!o.skip?.test(k)
  const show = (v: unknown) => (typeof v === 'boolean' ? (v ? 'yes' : 'no') : typeof v === 'number' ? (Number.isInteger(v) ? v : Math.round(v * 1000) / 1000) : (v as string))
  const lists = Object.entries(b).filter(([k, v]) => !quiet(k) && Array.isArray(v) && (v as unknown[]).every((x) => x && typeof x === 'object' && !Array.isArray(x))) as [string, unknown[]][]
  const main = (o.rows ? lists.find(([k]) => k === o.rows) : undefined) ?? (o.rows ? undefined : [...lists].sort((x, y) => y[1].length - x[1].length)[0])
  const singles = Object.entries(b).filter(([k, v]) => plain(v) && !quiet(k))
  // Groups of figures, two levels down (summary > totals > dials), each said with the names that lead to it.
  const groups: [string, [string, unknown][]][] = []
  const walk = (k: string, v: unknown, depth: number): void => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return
    const inner = Object.entries(v as Record<string, unknown>).filter(([kk, x]) => plain(x) && !quiet(kk))
    if (inner.length) groups.push([k, inner])
    if (depth < 2) for (const [kk, x] of Object.entries(v as Record<string, unknown>)) if (!quiet(kk)) walk(`${k} ${kk}`, x, depth + 1)
  }
  for (const [k, v] of Object.entries(b)) if (!quiet(k)) walk(k, v, 0)
  const head: string[] = []
  for (const [k, v] of lists) {
    if ((main && k === main[0]) || !v.length) continue
    const names = v.slice(0, 15).map((x) => { const r = x as Record<string, unknown>; const n = nameOf(r) || String(r.title ?? r.label ?? r.stage ?? r.status ?? r.segment ?? ''); const val = Object.entries(r).find(([kk, y]) => typeof y === 'number' && !quiet(kk)); return n ? `${n}${val ? ` ${val[1]}` : ''}` : '' }).filter(Boolean)
    head.push(`Also on the screen, ${words(k)} (${v.length}): ${names.join(', ') || 'see the screen'}${v.length > 15 ? ', and more' : ''}.`)
  }
  // A screen of figures only (cards, no list): each figure is a row, so it is listed and never read as "nothing there".
  if (!main) {
    const figures = [...singles.filter(([, v]) => typeof v === 'number').map(([k, v]) => ({ figure: words(k), value: show(v) })), ...groups.flatMap(([k, inner]) => inner.map(([kk, v]) => ({ figure: `${words(k)}: ${words(kk)}`, value: show(v) })))]
    const said = singles.filter(([, v]) => typeof v !== 'number').map(([k, v]) => `${words(k)} ${show(v)}`)
    if (figures.length) return { rows: figures, table: { unit: ['figure', 'figures'], columns: [{ key: 'figure', label: 'figure' }, { key: 'value', label: 'value' }] }, head: [said.length ? `${said.join('; ')}.` : '', ...head].filter(Boolean) }
  }
  const top: string[] = []
  if (singles.length) top.push(`${singles.map(([k, v]) => `${words(k)} ${show(v)}`).join('; ')}.`)
  for (const [k, inner] of groups) top.push(`${words(k).replace(/^./, (c) => c.toUpperCase())}: ${inner.map(([kk, v]) => `${words(kk)} ${show(v)}`).join(', ')}.`)
  const d = loose(main ? main[1] : [], unit, o)
  // The screen gives one page of a longer list: say so, so the page is never taken for the whole.
  const total = typeof b.total === 'number' ? b.total : null
  return { ...d, head: [...top, ...head], notes: total != null && main && total > main[1].length ? [`Only ${main[1].length} of the ${total} ${unit[1]} are listed here (the newest page); the total above counts all of them.`] : [] }
}

/** The figures of an object as short phrases ("open 5", "summary totals: dials 120"); rates kept as shares are said as percentages. */
export function figures(obj: unknown, skip?: RegExp): string[] {
  const d = auto(obj, ['figure', 'figures'], { rows: '-', skip })
  return d.rows.map((r) => { const v = r.value; return `${String(r.figure)} ${typeof v === 'number' && /rate|conversion|\bto\b|share/i.test(String(r.figure)) && v <= 1 ? pct(v) || 0 : v}` })
}

/** One day's own log (a daily form): each thing entered is a row; a day with nothing entered is said in words. */
export function dayLog(name: string, date: string, entry: unknown, skip?: RegExp): Loaded {
  const table: Table = { unit: ['field', 'fields'], columns: [{ key: 'field', label: 'field' }, { key: 'value', label: 'value' }] }
  if (!entry || typeof entry !== 'object') return { rows: [], table, head: [`${name}: nothing was logged for ${date}.`], dated: true }
  const quiet = (k: string) => /^(id|companyId|date|createdAt|updatedAt|submittedAt)$|Id$/i.test(k) || !!skip?.test(k)
  const scalar = (v: unknown): v is string | number | boolean => typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && v !== '')
  const say = (v: string | number | boolean) => (typeof v === 'boolean' ? (v ? 'yes' : 'no') : v)
  const rows: Row[] = []
  for (const [k, v] of Object.entries(entry as Record<string, unknown>)) {
    if (quiet(k) || v == null) continue
    if (scalar(v)) rows.push({ field: words(k), value: say(v) })
    else if (Array.isArray(v)) for (const x of v) {
      if (scalar(x)) { rows.push({ field: words(k), value: say(x) }); continue }
      if (!x || typeof x !== 'object') continue
      const r = x as Record<string, unknown>
      const label = [nameOf(r), ...Object.values(r).filter((y) => y && typeof y === 'object').map((y) => nameOf(y))].filter(Boolean).join(' / ')
      const vals = Object.entries(r).filter(([kk, y]) => !quiet(kk) && kk !== 'name' && scalar(y)).map(([kk, y]) => `${words(kk)} ${say(y as string)}`)
      rows.push({ field: `${words(k)}${label ? `: ${label}` : ''}`, value: vals.join(', ') })
    }
    else for (const [kk, y] of Object.entries(v as Record<string, unknown>)) if (!quiet(kk) && scalar(y)) rows.push({ field: `${words(k)} ${words(kk)}`, value: say(y) })
  }
  return { rows, table, head: [`${name}, as logged for ${date}.`], dated: true }
}

/** Minutes as hours and minutes: 495 -> "8 h 15 min". */
export const hours = (min: unknown): string => { const m = Math.round(Number(min) || 0); return m ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : '' }
/** A share as a percentage: 0.1479 -> "14.8%". */
export const pct = (x: unknown): string => (typeof x === 'number' && Number.isFinite(x) ? `${Math.round(x * 1000) / 10}%` : '')

export const nameOf = (v: unknown): string => (v && typeof v === 'object' && typeof (v as { name?: unknown }).name === 'string' ? (v as { name: string }).name : typeof v === 'string' ? v : '')
export const idOf = (v: unknown): string => (v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string' ? (v as { id: string }).id : '')
