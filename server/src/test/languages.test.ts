import { describe, it, expect, beforeAll } from 'vitest'
import path from 'node:path'

// Languages (plan 2026-11, stage 4): every word of the side menu has an Urdu and an Arabic translation, so a person
// who picks a language never sees a menu half in English. Loaded by path (the server build must not pull in client files).

type Item = { label: string }
type Group = { title?: string; items: Item[]; subgroups?: { title: string; items: Item[] }[] }
let groups: Group[]
let i18n: { DICT: Record<'ur' | 'ar', Record<string, string>>; t: (s: string) => string; setLang: (l: 'en' | 'ur' | 'ar') => void; getLang: () => string }

beforeAll(async () => {
  groups = (await import(path.resolve(__dirname, '../../../client/src/components/layout/navConfig.ts'))).NAV_GROUPS
  i18n = await import(path.resolve(__dirname, '../../../client/src/lib/i18n.ts'))
})

describe('languages', () => {
  it('every menu item, heading and sub-heading has an Urdu and an Arabic translation', () => {
    const words = new Set<string>()
    for (const g of groups) {
      if (g.title) words.add(g.title)
      for (const i of g.items) words.add(i.label)
      for (const s of g.subgroups ?? []) { words.add(s.title); for (const i of s.items) words.add(i.label) }
    }
    expect(words.size).toBeGreaterThan(60)
    for (const lang of ['ur', 'ar'] as const) {
      const missing = [...words].filter((w) => !i18n.DICT[lang][w])
      expect(missing, `${lang} is missing`).toEqual([])
    }
  })

  it('translates when there is a translation, and keeps the English otherwise', () => {
    i18n.setLang('ur')
    expect(i18n.t('My Tasks')).toBe('میرے کام')
    expect(i18n.t('A sentence nobody translated')).toBe('A sentence nobody translated')
    i18n.setLang('ar')
    expect(i18n.t('My Tasks')).toBe('مهامي')
    i18n.setLang('en')
    expect(i18n.t('My Tasks')).toBe('My Tasks')
    expect(i18n.getLang()).toBe('en')
  })
})
