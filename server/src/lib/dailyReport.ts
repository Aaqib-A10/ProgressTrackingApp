import type { ReportFieldType } from '@prisma/client'

/**
 * The Daily Report builder (Phase 1, step 5): checking answers and adding them up. Kept free of
 * the database so it can be tested on its own.
 */

export type FieldDef = { id: string; label: string; type: ReportFieldType; options: string[]; required: boolean; target: number | null; targetDir: string; archived: boolean }
export type Answer = number | string | string[] | boolean
export type Values = Record<string, Answer>

const URL_RE = /^https?:\/\/[^\s]+$/i

function empty(v: unknown): boolean {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
}

/**
 * Checks a person's answers against the form. Returns the clean answers (unknown and archived
 * questions dropped, text trimmed) or the first problem, in words for the person.
 */
export function checkAnswers(fields: FieldDef[], raw: unknown): { ok: true; values: Values } | { ok: false; error: string } {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const out: Values = {}
  for (const f of fields) {
    if (f.archived) continue
    let v = input[f.id]
    if (typeof v === 'string') v = v.trim()
    if (empty(v)) {
      if (f.required) return { ok: false, error: `"${f.label}" is needed` }
      continue
    }
    switch (f.type) {
      case 'NUMBER': {
        const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
        if (!Number.isFinite(n)) return { ok: false, error: `"${f.label}" must be a number` }
        if (Math.abs(n) > 1e12) return { ok: false, error: `"${f.label}" is too big` }
        out[f.id] = n
        break
      }
      case 'TEXT':
      case 'LONG_TEXT': {
        if (typeof v !== 'string') return { ok: false, error: `"${f.label}" must be text` }
        const max = f.type === 'TEXT' ? 500 : 5000
        if (v.length > max) return { ok: false, error: `"${f.label}" is too long (at most ${max} characters)` }
        out[f.id] = v
        break
      }
      case 'CHOICE': {
        if (typeof v !== 'string' || !f.options.includes(v)) return { ok: false, error: `Pick one of the choices for "${f.label}"` }
        out[f.id] = v
        break
      }
      case 'MULTI_CHOICE': {
        const list = Array.isArray(v) ? v : [v]
        if (!list.every((x) => typeof x === 'string' && f.options.includes(x))) return { ok: false, error: `Pick from the choices for "${f.label}"` }
        out[f.id] = [...new Set(list as string[])]
        break
      }
      case 'YES_NO': {
        if (typeof v !== 'boolean') return { ok: false, error: `Answer yes or no for "${f.label}"` }
        out[f.id] = v
        break
      }
      case 'RATING': {
        const n = Number(v)
        if (!Number.isInteger(n) || n < 1 || n > 5) return { ok: false, error: `"${f.label}" is a rating from 1 to 5` }
        out[f.id] = n
        break
      }
      case 'LINK': {
        if (typeof v !== 'string' || !URL_RE.test(v) || v.length > 1000) return { ok: false, error: `"${f.label}" must be a link starting with http:// or https://` }
        out[f.id] = v
        break
      }
    }
  }
  return { ok: true, values: out }
}

export type Tone = 'success' | 'warning' | 'danger' | 'neutral'

/**
 * How a number compares with its target: on target (green), close (within 20%, amber), or off
 * (red). For "less is better" targets (MAX) the other way round. No target: neutral.
 */
export function targetTone(value: number, target: number | null, dir: string): Tone {
  if (target === null || target === undefined || target <= 0) return 'neutral'
  const ratio = dir === 'MAX' ? (value <= 0 ? 2 : target / value) : value / target
  if (ratio >= 1) return 'success'
  if (ratio >= 0.8) return 'warning'
  return 'danger'
}

/** Adds up the number answers of several entries: total and average per answer, per question. */
export function sumNumbers(fields: FieldDef[], entries: { values: unknown }[]): Record<string, { total: number; count: number; average: number }> {
  const out: Record<string, { total: number; count: number; average: number }> = {}
  for (const f of fields) {
    if (f.type !== 'NUMBER' && f.type !== 'RATING') continue
    let total = 0, count = 0
    for (const e of entries) {
      const v = (e.values as Values | null)?.[f.id]
      if (typeof v === 'number' && Number.isFinite(v)) { total += v; count++ }
    }
    out[f.id] = { total, count, average: count ? total / count : 0 }
  }
  return out
}

/** One CSV cell. */
export function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join('; ') : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)
  // Spreadsheet formula injection: a cell starting with = + - @ is read as text.
  const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}
