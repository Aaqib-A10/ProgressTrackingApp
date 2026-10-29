import { describe, it, expect, beforeAll } from 'vitest'
import path from 'node:path'
import { BLOCKS, BLOCK_KEYS, blockRefusal, blocksOfPath, cleanLayout, readLayout } from '../lib/blocks'
import { CARDS } from '../lib/cards'

// Department Studio: the app's copy of the blocks matches the server's, every block has a menu
// item, and the starting menus of each kind are what that kind's people already had.

type U = { role: string; department: string | null; subDepartment: string | null; email: string; isDeveloper: boolean; permissions?: string[]; areasOff?: string[]; company?: unknown; blocks?: string[] | null }
type Group = { title?: string; items: { to: string; label: string }[]; subgroups?: { title: string; items: { to: string }[] }[] }
let client: { BLOCKS: typeof BLOCKS }
let clientCards: { CARDS: typeof CARDS }
let nav: {
  filterNav: (u: U) => Group[]
  templateBlocks: (kind: string, role: 'MEMBER' | 'TEAM_LEAD') => string[]
  navItemOfBlock: (k: string) => { to: string; label: string } | null
}
let setFlags: (f: Record<string, boolean>) => void
let access: { canOpen: (u: U, p: string) => boolean }

const KINDS = ['GENERAL', 'ITAD', 'LEAD_GEN', 'MARKETING', 'ECOMMERCE', 'INVENTORY', 'CSR'] as const
const company = (kind: string) => ({ id: 'co', name: '', kind: 'TEAM', plan: 'business', status: 'ACTIVE', timeZone: 'UTC', departmentKinds: [kind] })
const paths = (g: Group[]) => g.flatMap((x) => [...x.items.map((i) => i.to), ...(x.subgroups ?? []).flatMap((s) => s.items.map((i) => i.to))])

beforeAll(async () => {
  const root = path.resolve(__dirname, '../../../client/src')
  client = await import(path.join(root, 'lib/blocks.ts'))
  clientCards = await import(path.join(root, 'lib/cards.ts'))
  nav = await import(path.join(root, 'components/layout/navConfig.ts'))
  access = await import(path.join(root, 'lib/access.ts'))
  setFlags = (await import(path.join(root, 'lib/flags.ts'))).setFlagsForTest
})

describe('blocks', () => {
  it("the app's copy is the same as the server's", () => {
    const shape = (b: (typeof BLOCKS)[number]) => ({ key: b.key, group: b.group, kinds: b.kinds, leadOnly: !!b.leadOnly, fixed: !!b.fixed, app: b.app, api: b.api ?? [] })
    expect(client.BLOCKS.map(shape)).toEqual(BLOCKS.map(shape))
    expect(new Set(BLOCK_KEYS).size).toBe(BLOCK_KEYS.length)
  })

  it("the app's copy of the dashboard cards is the same as the server's", () => {
    const shape = (c: (typeof CARDS)[number]) => ({ key: c.key, kinds: c.kinds, leadOnly: !!c.leadOnly, size: c.size })
    expect(clientCards.CARDS.map(shape)).toEqual(CARDS.map(shape))
  })

  it('every block shows as a menu item', () => {
    for (const b of BLOCKS) expect(nav.navItemOfBlock(b.key), b.key).not.toBeNull()
  })

  it('addresses find their block; the longest wins; "$" is one screen only', () => {
    expect(blocksOfPath('/app/reports/monthly', 'app').map((b) => b.key)).toEqual(['monthly-reports'])
    expect(blocksOfPath('/app/reports', 'app').map((b) => b.key)).toEqual(['my-reports'])
    expect(blocksOfPath('/app/inventory', 'app').map((b) => b.key)).toEqual(['inv-items'])
    expect(blocksOfPath('/app/inventory/team', 'app').map((b) => b.key)).toEqual(['inv-team'])
    expect(blocksOfPath('/app/projects/RTI', 'app').map((b) => b.key)).toEqual(['projects'])
    expect(blocksOfPath('/api/marketing/content/abc', 'api').map((b) => b.key).sort()).toEqual(['mkt-content', 'mkt-content-log'])
    expect(blocksOfPath('/api/itad/team', 'api')).toEqual([])
  })

  it('the rules: team blocks stay with their kind, team lead blocks with team leads, the Dashboard is always in', () => {
    expect(cleanLayout({ member: ['my-reports'], lead: [] }, 'GENERAL')).toEqual({ error: 'My Reports comes with a Sales calling or Lead Generation department.' })
    expect(cleanLayout({ member: ['itad-dialer'], lead: [] }, 'GENERAL')).toEqual({ layout: { member: ['dashboard', 'itad-dialer'], lead: ['dashboard'] } })
    expect(cleanLayout({ member: ['itad-team'], lead: [] }, 'ITAD')).toEqual({ error: 'Team view is for team leads.' })
    expect(cleanLayout({ member: ['nope'], lead: [] }, 'ITAD')).toEqual({ error: 'Unknown block: nope' })
    expect(cleanLayout({ member: ['my-todo', 'my-todo'], lead: ['itad-team'] }, 'ITAD')).toEqual({ layout: { member: ['dashboard', 'my-todo'], lead: ['dashboard', 'itad-team'] } })
    expect(cleanLayout(null, 'ITAD')).toHaveProperty('error')
    expect(readLayout({ member: ['my-todo', 'gone'], lead: [] })).toEqual({ member: ['my-todo'], lead: [] })
    expect(readLayout('junk')).toBeNull()
  })
})

describe('the starting menus of each kind', () => {
  it('are valid layouts, and show the same screens the kind already had', () => {
    setFlags({})
    for (const kind of KINDS) for (const role of ['MEMBER', 'TEAM_LEAD'] as const) {
      const t = nav.templateBlocks(kind, role)
      for (const k of t) expect(blockRefusal(BLOCKS.find((b) => b.key === k)!, kind, role === 'MEMBER' ? 'member' : 'lead'), `${kind} ${role} ${k}`).toBeNull()
      const u: U = { role, department: kind, subDepartment: null, email: 'x@co.example', isDeveloper: false, permissions: [], areasOff: [], company: company(kind) }
      const classic = paths(nav.filterNav(u)).filter((p) => p !== '/app/dashboard')
      const studio = paths(nav.filterNav({ ...u, blocks: t })).filter((p) => p !== '/app/dashboard')
      expect(studio.sort(), `${kind} ${role}`).toEqual(classic.sort())
    }
  })

  it("a saved menu is the person's menu, in its order; screens out of it do not open", () => {
    const u: U = { role: 'MEMBER', department: 'ITAD', subDepartment: null, email: 'x@co.example', isDeveloper: false, permissions: [], areasOff: [], company: company('ITAD'), blocks: ['dashboard', 'itad-dialer', 'my-todo', 'chat'] }
    const m = nav.filterNav(u)
    // Grouped under their headings, headings in the order they first come.
    expect(paths(m)).toEqual(['/app/dashboard', '/app/todo', '/app/itad/dialer', '/app/chat'])
    expect(m.map((g) => g.title ?? '')).toEqual(['', 'ITAD', 'Projects'])
    expect(access.canOpen(u, '/app/itad/dialer')).toBe(true)
    expect(access.canOpen(u, '/app/itad/log')).toBe(false)
    expect(access.canOpen(u, '/app/projects')).toBe(false)
    expect(access.canOpen(u, '/app/settings')).toBe(true)
    // The Super Admin is never limited by a department menu.
    expect(access.canOpen({ ...u, role: 'SUPER_ADMIN' }, '/app/itad/log')).toBe(true)
  })
})
