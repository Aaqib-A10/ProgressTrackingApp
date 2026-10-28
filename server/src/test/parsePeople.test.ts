import { describe, it, expect, beforeAll } from 'vitest'
import path from 'node:path'

// Phase 1, step 7: inviting people from pasted lines or a CSV (the setup wizard).
type P = { name?: string; email: string; department?: string; role: string }
let parsePeople: (t: string) => P[]
beforeAll(async () => { parsePeople = (await import(path.resolve(__dirname, '../../../client/src/lib/parsePeople.ts'))).parsePeople })

describe('people from text or a CSV', () => {
  it('takes plain emails, and name, email, department, role in any order; skips the header', () => {
    const out = parsePeople('name,email,department,role\nAmy Desk,Amy@X.example,Front desk,Member\nbob@x.example\n"Lee Park";lee@x.example;Sales;Team Lead\nnot an email')
    expect(out).toEqual([
      { email: 'amy@x.example', name: 'Amy Desk', department: 'Front desk', role: 'MEMBER' },
      { email: 'bob@x.example', name: undefined, department: undefined, role: 'MEMBER' },
      { email: 'lee@x.example', name: 'Lee Park', department: 'Sales', role: 'TEAM_LEAD' },
    ])
  })
})
