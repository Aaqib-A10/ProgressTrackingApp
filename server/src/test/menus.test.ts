import { describe, it, expect, beforeAll } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'

// Phase 1, step 4 (roles and departments become data): 99 Technologies' people must see exactly
// the menus they saw before. The menus everyone had before step 4 are kept in
// fixtures/menus-before-step4.json (made once, from the code as it was); every combination of
// role, department, Marketing discipline, finance access and developer is checked against it.
// Loaded by path (the server build must not pull in client files).

type U = { role: string; department: string | null; subDepartment: string | null; email: string; isDeveloper: boolean; permissions?: string[] }
type Group = { title?: string; items: { to: string }[]; subgroups?: { title: string; items: { to: string }[] }[] }
let filterNav: (u: U) => Group[]

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
})

describe("99 Technologies' menus", () => {
  it('are exactly what everyone had before step 4', () => {
    const file = path.resolve(__dirname, 'fixtures/menus-before-step4.json')
    const now: Record<string, string[]> = {}
    // 99 Technologies' finance person has the finance permission (step 4 turns the email list into a permission).
    for (const u of people()) now[key(u)] = menu(filterNav({ ...u, permissions: u.email === FINANCE ? ['finance'] : [] }))
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(now, null, 1))
    const before = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string[]>
    expect(Object.keys(now).length).toBe(Object.keys(before).length)
    for (const k of Object.keys(before)) expect(now[k], k).toEqual(before[k])
  })
})
