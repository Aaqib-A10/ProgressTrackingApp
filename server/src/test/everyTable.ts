import { Prisma } from '@prisma/client'
import { prisma } from './helpers'
import { walledTables } from '../scripts/companyWallsSql'

/**
 * Test helper for the company walls: puts one made-up row in every company table for one
 * company (made from the schema, so a new table is covered without touching this file). Every
 * text value carries `marker`, so a page that shows another company's data is easy to spot.
 * Returns the id of each row by table.
 */

const enums = new Map(Prisma.dmmf.datamodel.enums.map((e) => [e.name, e.values.map((v) => v.name)]))
const models = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]))
const delegate = (model: string) => (prisma as unknown as Record<string, { create: (a: unknown) => Promise<{ id?: string }> }>)[model[0].toLowerCase() + model.slice(1)]

let n = 0
function value(field: Prisma.DMMF.Field, marker: string, model: string): unknown {
  n++
  if (field.kind === 'enum') return enums.get(field.type)![0]
  switch (field.type) {
    case 'String': {
      const f = field.name
      // Text in a fixed format is made in that format, so pages can read it.
      if (/zone/i.test(f)) return 'Asia/Karachi'
      if (/month|period$/i.test(f)) return '2026-10'
      if (/colou?r/i.test(f)) return '#4F46E5'
      if (/(time|At)$/.test(f) || /^(start|end)$/i.test(f)) return '09:00'
      if (/date|day$/i.test(f)) return '2026-10-20'
      if (/email/i.test(f)) return `${marker}-${n}@example.test`
      if (/url|link|href/i.test(f)) return `https://example.test/${marker}-${n}`
      if (/cidr/i.test(f)) return '10.9.9.0/24'
      return `${marker}-${model}-${f}-${n}`
    }
    case 'Int': return n
    case 'Float': return 1.5
    case 'Decimal': return '1.50'
    case 'Boolean': return false
    case 'DateTime': return new Date(Date.UTC(2026, 9, 1 + (n % 27), 10, 0, 0))
    case 'Json': return { marker }
    default: return null
  }
}

export async function fillEveryTable(companyId: string, marker: string, existing: Record<string, string[]>): Promise<Map<string, string>> {
  const ids = new Map<string, string>(Object.entries(existing).map(([k, v]) => [k, v[0]]))
  const todo = walledTables().map((t) => t.table).filter((t) => !ids.has(t))
  const failures: string[] = []
  for (let pass = 0; pass < 8 && todo.length; pass++) {
    for (const model of [...todo]) {
      const m = models.get(model)!
      const data: Record<string, unknown> = { companyId }
      let ready = true
      for (const f of m.fields) {
        if (f.kind === 'object') {
          const from = f.relationFromFields?.[0]
          if (!from || f.type === 'Company') continue
          const parent = ids.get(f.type)
          if (parent) data[from] = parent
          else if (f.isRequired) ready = false
          continue
        }
        if (f.name === 'companyId' || f.isList || f.hasDefaultValue || f.isUpdatedAt || data[f.name] !== undefined) continue
        if (m.fields.some((o) => o.kind === 'object' && o.relationFromFields?.includes(f.name))) continue
        if (f.isRequired) data[f.name] = value(f, marker, model)
        else if (f.type === 'String' && f.kind === 'scalar') data[f.name] = value(f, marker, model)
      }
      if (!ready) continue
      try {
        const row = await delegate(model).create({ data })
        if (row.id) ids.set(model, row.id)
        else ids.set(model, `${model}-no-id`)
        todo.splice(todo.indexOf(model), 1)
      } catch (e) {
        if (pass === 7) failures.push(`${model}: ${(e as Error).message.split('\n').slice(-2).join(' ')}`)
      }
    }
  }
  if (todo.length) throw new Error(`Could not fill: ${todo.join(', ')}\n${failures.join('\n')}`)
  return ids
}
