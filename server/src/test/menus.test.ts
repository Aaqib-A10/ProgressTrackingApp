import { describe, it, expect, beforeAll } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'

// Phase 1, step 4 (roles and departments become data): 99 Technologies' people must see exactly
// the menus they saw before. The menus everyone had before step 4 are kept in
// fixtures/menus-before-step4.json (made once, from the code as it was); every combination of
// role, department, Marketing discipline, finance access and developer is checked against it.
// Loaded by path (the server build must not pull in client files).

type U = { role: string; department: string | null; subDepartment: string | null; email: string; isDeveloper: boolean; permissions?: string[]; areasOff?: string[] }
type Group = { title?: string; items: { to: string }[]; subgroups?: { title: string; items: { to: string }[] }[] }
let filterNav: (u: U) => Group[]
let setFlags: (f: Record<string, boolean>) => void

const FINANCE = 'aqibalishehzad3@gmail.com'
const ROLES = ['MEMBER', 'TEAM_LEAD', 'SUB_DEPT_LEAD', 'QA', 'QA_LEAD', 'SUPER_ADMIN']
const DEPTS = [null, 'ITAD', 'LEAD_GEN', 'MARKETING', 'CSR', 'ECOMMERCE', 'INVENTORY']
const SUBS = [null, 'seo', 'social', 'content', 'ads', 'email']

export function people(): U[] {
  const out: U[] = []
  for (const role of ROLES) for (const department of DEPTS) for (const subDepartment of department === 'MARKETING' ? SUBS : [null])
    for (const email of ['someone@99tech.example', FINANCE]) for (const isDeveloper of [false, true])
      out.push({ role, department, subDepartment, email, isDeveloper })
  return out
}
const key = (u: U) => `${u.role}|${u.department}|${u.subDepartment}|${u.email === FINANCE ? 'finance' : '-'}|${u.isDeveloper ? 'dev' : '-'}`
const menu = (g: Group[]) => g.flatMap((x) => [...x.items.map((i) => i.to), ...(x.subgroups ?? []).flatMap((s) => s.items.map((i) => `${s.title}:${i.to}`))])

beforeAll(async () => {
  filterNav = (await import(path.resolve(__dirname, '../../../client/src/components/layout/navConfig.ts'))).filterNav
  setFlags = (await import(path.resolve(__dirname, '../../../client/src/lib/flags.ts'))).setFlagsForTest
})

// The powers 99 Technologies' people have (server lib/permissions powersOf).
const powers = (u: U) => [...(u.email === FINANCE ? ['finance'] : []), ...(u.role === 'SUPER_ADMIN' ? ['company.settings', 'holidays.manage'] : [])]

describe("99 Technologies' menus", () => {
  it('are exactly what everyone had before step 4', () => {
    const file = path.resolve(__dirname, 'fixtures/menus-before-step4.json')
    const now: Record<string, string[]> = {}
    // As 99 Technologies has its switches: the Company settings page starts off for them.
    setFlags({ 'company-settings': false, 'daily-report': false })
    for (const u of people()) now[key(u)] = menu(filterNav({ ...u, permissions: powers(u) }))
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(now, null, 1))
    const before = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string[]>
    expect(Object.keys(now).length).toBe(Object.keys(before).length)
    for (const k of Object.keys(before)) expect(now[k], k).toEqual(before[k])
  })
})

describe('the Company settings page', () => {
  it('shows for a Super Admin once the owner switches it on for the company, and for nobody else', () => {
    setFlags({ 'company-settings': true })
    const admin: U = { role: 'SUPER_ADMIN', department: null, subDepartment: null, email: 'a@x.example', isDeveloper: false }
    expect(menu(filterNav({ ...admin, permissions: powers(admin) }))).toContain('/app/admin/company')
    const lead: U = { role: 'TEAM_LEAD', department: 'ITAD', subDepartment: null, email: 'b@x.example', isDeveloper: false }
    expect(menu(filterNav({ ...lead, permissions: [] }))).not.toContain('/app/admin/company')
    expect(menu(filterNav({ ...lead, permissions: ['company.settings'] }))).toContain('/app/admin/company')
    setFlags({ 'company-settings': false })
    expect(menu(filterNav({ ...admin, permissions: powers(admin) }))).not.toContain('/app/admin/company')
  })

  it("a company role's switched-off parts disappear from the menu, even for a Super Admin based role", () => {
    const m: U = { role: 'MEMBER', department: 'ITAD', subDepartment: null, email: 'c@x.example', isDeveloper: false }
    const before = menu(filterNav({ ...m, permissions: [] }))
    expect(before).toContain('/app/itad/dialer')
    const after = menu(filterNav({ ...m, permissions: [], areasOff: ['dialer'] } as U))
    expect(after).not.toContain('/app/itad/dialer')
    expect(after).toContain('/app/itad/log')
    const sa: U = { role: 'SUPER_ADMIN', department: null, subDepartment: null, email: 'd@x.example', isDeveloper: false }
    expect(menu(filterNav({ ...sa, permissions: [], areasOff: ['marketing'] } as U)).some((p) => p.includes('/app/marketing'))).toBe(false)
  })

  it("another company's Super Admin does not see System Health", () => {
    const sa = { role: 'SUPER_ADMIN', department: null, subDepartment: null, email: 'e@x.example', isDeveloper: true, permissions: [], company: { id: 'other-co' } }
    expect(menu(filterNav(sa as unknown as U))).not.toContain('/app/admin/health')
  })
})

describe('parts of Metriq a role can switch off', () => {
  it('the app and the server have the same list', async () => {
    const { AREAS } = await import('../lib/permissions')
    const { AREA_APP } = await import(path.resolve(__dirname, '../../../client/src/lib/areas.ts'))
    expect(Object.keys(AREA_APP).sort()).toEqual(AREAS.map((a) => a.key).sort())
    for (const a of AREAS) expect(AREA_APP[a.key], a.key).toEqual([...a.app])
  })
})

describe('the Daily Report', () => {
  it('is in the menu once the owner switches it on: My report for everyone, team and forms for team leads', () => {
    setFlags({ 'daily-report': true })
    const m: U = { role: 'MEMBER', department: 'ITAD', subDepartment: null, email: 'f@x.example', isDeveloper: false }
    const l: U = { role: 'TEAM_LEAD', department: 'ITAD', subDepartment: null, email: 'g@x.example', isDeveloper: false }
    expect(menu(filterNav({ ...m, permissions: [] })).filter((p) => p.startsWith('/app/daily-report'))).toEqual(['/app/daily-report'])
    expect(menu(filterNav({ ...l, permissions: [] })).filter((p) => p.startsWith('/app/daily-report'))).toEqual(['/app/daily-report', '/app/daily-report/team', '/app/daily-report/forms'])
    setFlags({ 'daily-report': false })
    expect(menu(filterNav({ ...l, permissions: [] })).some((p) => p.startsWith('/app/daily-report'))).toBe(false)
  })
})

describe("another company's menu", () => {
  it('leaves out sections for kinds of department the company does not have, and team screens for a personal workspace', () => {
    setFlags({ 'daily-report': true, 'company-settings': true })
    const sa = { role: 'SUPER_ADMIN', department: null, subDepartment: null, email: 'h@x.example', isDeveloper: false, permissions: ['company.settings'], company: { id: 'co-x', kind: 'TEAM', departmentKinds: ['GENERAL'] } }
    const titles = filterNav(sa as unknown as U).map((g) => (g as { title?: string }).title)
    expect(titles).not.toContain('ITAD')
    expect(titles).not.toContain('Marketing')
    expect(titles).toContain('Daily Report')
    const withSales = filterNav({ ...sa, company: { ...sa.company, departmentKinds: ['GENERAL', 'ITAD'] } } as unknown as U).map((g) => (g as { title?: string }).title)
    expect(withSales).toEqual(expect.arrayContaining(['ITAD', 'Quality Assurance']))
    const solo = menu(filterNav({ ...sa, company: { id: 'co-y', kind: 'PERSONAL', departmentKinds: [] } } as unknown as U))
    expect(solo).not.toContain('/app/admin/users')
    expect(solo).not.toContain('/app/daily-report/team')
    expect(solo).toContain('/app/daily-report')
    expect(solo).toContain('/app/billing')
  })
})
