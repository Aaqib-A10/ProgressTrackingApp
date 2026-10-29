/**
 * Department Studio, part C: blocks a company makes itself. A block is a list of fields (text,
 * number, date, a choice, a person, a tick box, a link); its records show as a table, a board
 * (by a choice field) or a calendar (by a date field), and as a card on the dashboard. The Super
 * Admin puts a block in any department's menu like the built-in ones.
 *
 * Who sees what (the server checks it on every request):
 * - Only people whose menu has the block open it (the Super Admin always can).
 * - Records stay with the department of the person who added them: each department that uses
 *   the block has its own records. The Super Admin sees every department's.
 * - Team leads see and change every record of their department.
 * - Members add records (unless the block says only team leads add), change and remove their
 *   own, and see either their own or their whole department's (the block decides).
 */

export const FIELD_TYPES = ['text', 'longtext', 'number', 'date', 'select', 'checkbox', 'person', 'url'] as const
export type FieldType = (typeof FIELD_TYPES)[number]
export interface CustomField { key: string; label: string; type: FieldType; options?: string[]; required?: boolean }
export interface CustomSettings { membersSee: 'own' | 'all'; membersAdd: boolean; boardField: string | null; dateField: string | null }
export interface CustomBlockInput { name: string; description: string | null; icon: string; color: string; fields: CustomField[]; settings: CustomSettings }

/** Icons the builder offers (lucide names; the app has the same list). */
export const BLOCK_ICONS = [
  'LayoutGrid', 'ClipboardList', 'ListChecks', 'KanbanSquare', 'CalendarDays', 'FileText', 'Users', 'Truck', 'Package', 'Wrench', 'Receipt',
  'DollarSign', 'Phone', 'Mail', 'Star', 'Flag', 'Heart', 'Briefcase', 'Building2', 'GraduationCap', 'ShoppingCart', 'Megaphone', 'Lightbulb', 'Shield',
] as const
const HEX = /^#[0-9a-fA-F]{6}$/

const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'field'

/** Check what the builder sent. Field keys are kept when given (so records keep their values), made from the label when new. */
export function cleanBlockInput(input: unknown): { block: CustomBlockInput } | { error: string } {
  const x = (input ?? {}) as Record<string, unknown>
  const name = typeof x.name === 'string' ? x.name.trim() : ''
  if (name.length < 2 || name.length > 60) return { error: 'Give the block a name (2 to 60 letters).' }
  const description = typeof x.description === 'string' && x.description.trim() ? x.description.trim().slice(0, 300) : null
  const icon = typeof x.icon === 'string' && (BLOCK_ICONS as readonly string[]).includes(x.icon) ? x.icon : 'LayoutGrid'
  const color = typeof x.color === 'string' && HEX.test(x.color) ? x.color : '#6366F1'
  if (!Array.isArray(x.fields) || x.fields.length === 0) return { error: 'Add at least one field.' }
  if (x.fields.length > 30) return { error: 'A block can have up to 30 fields.' }
  const fields: CustomField[] = []
  for (const raw of x.fields as Record<string, unknown>[]) {
    const label = typeof raw?.label === 'string' ? raw.label.trim() : ''
    if (!label || label.length > 60) return { error: 'Every field needs a name (up to 60 letters).' }
    const type = raw.type as FieldType
    if (!FIELD_TYPES.includes(type)) return { error: `"${label}" needs a type.` }
    let key = typeof raw.key === 'string' && /^[a-z0-9_]{1,40}$/.test(raw.key) ? raw.key : slug(label)
    if (fields.some((f) => f.key === key)) { let n = 2; while (fields.some((f) => f.key === `${key}_${n}`)) n++; key = `${key}_${n}` }
    const f: CustomField = { key, label, type, required: raw.required === true }
    if (type === 'select') {
      const opts = Array.isArray(raw.options) ? [...new Set((raw.options as unknown[]).filter((o): o is string => typeof o === 'string').map((o) => o.trim()).filter(Boolean))] : []
      if (opts.length < 1) return { error: `"${label}" needs at least one choice.` }
      if (opts.length > 30 || opts.some((o) => o.length > 40)) return { error: `"${label}" can have up to 30 choices of up to 40 letters.` }
      f.options = opts
    }
    fields.push(f)
  }
  const s = (x.settings ?? {}) as Record<string, unknown>
  const boardField = typeof s.boardField === 'string' && fields.some((f) => f.key === s.boardField && f.type === 'select') ? s.boardField : null
  const dateField = typeof s.dateField === 'string' && fields.some((f) => f.key === s.dateField && f.type === 'date') ? s.dateField : null
  return {
    block: {
      name, description, icon, color, fields,
      settings: { membersSee: s.membersSee === 'own' ? 'own' : 'all', membersAdd: s.membersAdd !== false, boardField, dateField },
    },
  }
}

/** Read stored fields and settings (old or broken data counts as empty). */
export function readFields(v: unknown): CustomField[] {
  return Array.isArray(v) ? (v as CustomField[]).filter((f) => f && typeof f.key === 'string' && FIELD_TYPES.includes(f.type)) : []
}
export function readSettings(v: unknown): CustomSettings {
  const s = (v ?? {}) as Partial<CustomSettings>
  return { membersSee: s.membersSee === 'own' ? 'own' : 'all', membersAdd: s.membersAdd !== false, boardField: s.boardField ?? null, dateField: s.dateField ?? null }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Check one record against the block's fields. Fields the block no longer has are dropped. */
export function cleanRecordData(fields: CustomField[], input: unknown, partial = false): { data: Record<string, unknown> } | { error: string } {
  const x = (input ?? {}) as Record<string, unknown>
  const data: Record<string, unknown> = {}
  for (const f of fields) {
    if (!(f.key in x)) {
      if (!partial && f.required) return { error: `Fill in "${f.label}".` }
      continue
    }
    const v = x[f.key]
    const empty = v === null || v === undefined || v === ''
    if (empty) {
      if (f.required) return { error: `Fill in "${f.label}".` }
      data[f.key] = null
      continue
    }
    switch (f.type) {
      case 'text': if (typeof v !== 'string' || v.length > 500) return { error: `"${f.label}" is too long (500 letters at most).` }; data[f.key] = v.trim(); break
      case 'longtext': if (typeof v !== 'string' || v.length > 5000) return { error: `"${f.label}" is too long (5000 letters at most).` }; data[f.key] = v; break
      case 'number': { const n = typeof v === 'number' ? v : Number(v); if (!Number.isFinite(n) || Math.abs(n) > 1e12) return { error: `"${f.label}" needs a number.` }; data[f.key] = n; break }
      case 'date': if (typeof v !== 'string' || !DATE.test(v)) return { error: `"${f.label}" needs a date.` }; data[f.key] = v; break
      case 'select': if (typeof v !== 'string' || !f.options?.includes(v)) return { error: `Pick one of the choices for "${f.label}".` }; data[f.key] = v; break
      case 'checkbox': data[f.key] = v === true; break
      case 'person': if (typeof v !== 'string' || v.length > 40) return { error: `Pick a person for "${f.label}".` }; data[f.key] = v; break
      case 'url': if (typeof v !== 'string' || v.length > 500 || !/^https?:\/\/\S+$/i.test(v.trim())) return { error: `"${f.label}" needs a link starting with http:// or https://` }; data[f.key] = v.trim(); break
    }
  }
  return { data }
}
