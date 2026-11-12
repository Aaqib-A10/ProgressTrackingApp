import { describe, it, expect, beforeAll } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import * as server from '../lib/notifyCategories'

// The notification categories (ITAD update 12 Nov, §6) live in one map, copied to the client.
// The client copy is loaded by path (the server build must not pull in client files).
let client: typeof server

beforeAll(async () => {
  client = await import(path.resolve(__dirname, '../../../client/src/lib/notifyCategories.ts'))
})

function enumValues(name: string): string[] {
  const schema = fs.readFileSync(path.resolve(__dirname, '../../prisma/schema.prisma'), 'utf8')
  const m = schema.match(new RegExp(`enum ${name} \\{([\\s\\S]*?)\\}`))
  if (!m) throw new Error(`enum ${name} not found`)
  return m[1].split('\n').map((l) => l.replace(/\/\/.*$/, '').trim()).filter((l) => /^[A-Z][A-Z0-9_]*$/.test(l))
}

describe('notification categories', () => {
  it('the client and the server have the same map', () => {
    expect(client.NOTIFY_CATEGORIES).toEqual(server.NOTIFY_CATEGORIES)
    expect(client.NOTIFY_CATEGORY_KEYS).toEqual(server.NOTIFY_CATEGORY_KEYS)
    expect(client.NOTIFY_TYPE_CATEGORY).toEqual(server.NOTIFY_TYPE_CATEGORY)
    expect(client.NOTIFY_DERIVED_CATEGORY).toEqual(server.NOTIFY_DERIVED_CATEGORY)
    expect([...client.FOLLOW_UP_VALUE_ORDER]).toEqual([...server.FOLLOW_UP_VALUE_ORDER])
    // Byte for byte the same file, so nothing drifts.
    const read = (p: string) => fs.readFileSync(path.resolve(__dirname, p), 'utf8').replace(/\r\n/g, '\n')
    expect(read('../../../client/src/lib/notifyCategories.ts')).toBe(read('../lib/notifyCategories.ts'))
  })

  it('tabs are in order, System collapsed', () => {
    expect(server.NOTIFY_CATEGORIES.map((c) => c.key)).toEqual(['tasks', 'imports', 'ai', 'system'])
    expect(server.NOTIFY_CATEGORIES.map((c) => c.label)).toEqual(['Follow ups and tasks', 'Imports', 'AI insights', 'System'])
    expect(server.NOTIFY_CATEGORIES.filter((c) => c.collapsed).map((c) => c.key)).toEqual(['system'])
  })

  it('every NotificationType in the schema has a category, and nothing else is mapped', () => {
    const values = enumValues('NotificationType')
    expect(values.length).toBeGreaterThan(30)
    for (const v of values) expect(server.NOTIFY_TYPE_CATEGORY[v], v).toBeDefined()
    expect(Object.keys(server.NOTIFY_TYPE_CATEGORY).sort()).toEqual([...values].sort())
    // Every type is in exactly one category.
    const all = server.NOTIFY_CATEGORY_KEYS.flatMap((c) => server.typesOf(c))
    expect(all.sort()).toEqual([...values].sort())
  })

  it('maps the main types where people expect them', () => {
    expect(server.categoryOf('TASK_DUE_SOON')).toBe('tasks')
    expect(server.categoryOf('LEAD_DECISION')).toBe('tasks')
    expect(server.categoryOf('LEAD_NEW')).toBe('imports')
    expect(server.categoryOf('AI_INSIGHT')).toBe('ai')
    expect(server.categoryOf('GRACE_EXCEEDED')).toBe('system')
    expect(server.categoryOf('SOMETHING_NEW')).toBe('system')
    expect(server.categoryOfDerived('reminder-today')).toBe('tasks')
    expect(server.categoryOfDerived('welcome')).toBe('system')
    expect(server.categoryOfDerived('unknown-id')).toBe('system')
  })

  it('isMuted follows the category', () => {
    expect(server.isMuted('GRACE_EXCEEDED', ['system'])).toBe(true)
    expect(server.isMuted('TASK_DUE_SOON', ['system'])).toBe(false)
    expect(server.isMuted('TASK_DUE_SOON', ['tasks', 'ai'])).toBe(true)
    expect(server.isMuted('UNKNOWN_TYPE', ['system'])).toBe(true)
    expect(server.isMuted('AI_INSIGHT', [])).toBe(false)
    expect(server.isMuted('AI_INSIGHT', null)).toBe(false)
    expect(server.isNotifyCategory('ai')).toBe(true)
    expect(server.isNotifyCategory('FOLLOW_UPS')).toBe(false)
  })

  it('follow-ups rank by lead value: Pipeline, Interested, Connected, then the rest', () => {
    expect(server.leadStatusRank('Pipeline')).toBe(0)
    expect(server.leadStatusRank('interested')).toBe(1)
    expect(server.leadStatusRank('Connected')).toBe(2)
    expect(server.leadStatusRank('Voicemail')).toBe(3)
    expect(server.leadStatusRank(null)).toBe(3)
    const sorted = ['Connected', null, 'Pipeline', 'Interested'].sort((a, b) => server.leadStatusRank(a) - server.leadStatusRank(b))
    expect(sorted).toEqual(['Pipeline', 'Interested', 'Connected', null])
  })
})
