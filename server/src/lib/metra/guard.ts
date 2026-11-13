/**
 * What the model sends to a tool, made safe before the tool runs.
 *
 * Metra's tools were written for careful callers. A smaller model fills every field it sees: "" for filters it does
 * not want, `type: "deal"` where only RFQ/RFP/BID/PO exist, `status: "active"` in the wrong letter case, the person's
 * own name as the rep, "true" for true. Each of those used to end in "no results" or a refused call, which Metra then
 * reported as a fact ("you have no Interested leads"). Here the arguments are checked against the tool's own schema:
 * fields the tool does not have and empty values are dropped, enum values are matched in any letter case, simple types
 * are fixed, and "me" as a person becomes the asker. Whatever was dropped is told back to the model in a note.
 */

interface Prop { type?: string | string[]; enum?: unknown[] }
type Schema = { properties?: Record<string, Prop> }

const ME = /^(me|mine|my|myself|self|i)$/i
/** Fields that name a person, per tool. "me" there means the asker (by name), since these tools match on names. */
const PERSON_FIELDS = new Set(['agent'])

const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '')

export function cleanArgs(schema: unknown, given: Record<string, unknown>, asker: { name: string }): { args: Record<string, unknown>; notes: string[] } {
  const props = (schema as Schema | undefined)?.properties
  if (!props) return { args: given, notes: [] }
  const args: Record<string, unknown> = {}
  const notes: string[] = []
  for (const [key, raw] of Object.entries(given)) {
    const p = props[key]
    if (!p) { notes.push(`"${key}" is not an option of this tool and was left out.`); continue }
    let v = raw
    if (v == null) continue
    if (typeof v === 'string') { v = v.trim(); if (v === '') continue }
    if (Array.isArray(v) && v.length === 0) continue
    const type = Array.isArray(p.type) ? p.type[0] : p.type
    if (p.enum?.length) {
      const hit = p.enum.find((e) => e === v) ?? p.enum.find((e) => norm(String(e)) === norm(String(v)))
      if (hit === undefined) { notes.push(`${key}: "${String(v)}" is not one of ${p.enum.map(String).join(', ')}, so it was left out.`); continue }
      v = hit
    } else if (type === 'number' || type === 'integer') {
      const n = typeof v === 'number' ? v : Number(v)
      if (!Number.isFinite(n)) continue
      v = n
    } else if (type === 'boolean') {
      if (typeof v !== 'boolean') { if (/^(true|yes|1)$/i.test(String(v))) v = true; else if (/^(false|no|0)$/i.test(String(v))) v = false; else continue }
      // "false" for an optional switch is the same as not asking for it.
      if (v === false) continue
    } else if (type === 'string' && typeof v !== 'string') {
      if (typeof v === 'number' || typeof v === 'boolean') v = String(v); else continue
    }
    if (PERSON_FIELDS.has(key) && typeof v === 'string' && ME.test(v)) v = asker.name
    args[key] = v
  }
  return { args, notes }
}
