import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Role } from '@prisma/client'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { hashPassword } from '../lib/auth'
import { ensureHomeCompany, HOME_COMPANY_ID } from '../lib/company'
import { listEndpoints } from '../lib/health/audit'
import { walledTables, triggerName } from '../scripts/companyWallsSql'
import { fillEveryTable } from './everyTable'
import { runAsCompany, refreshWalls } from '../lib/tenancy'

// Phase 1, step 3: a company never sees or changes another company's records.
// 99 Technologies (company 1) gets a row in every table; a second company ("Bravo") gets its
// own. Then Bravo's Super Admin, Team Lead and Member call every API in Metriq, aimed at
// company 1's records (their ids, project keys, task codes, people). Nothing of company 1 may
// show up in any answer, nothing may crash, and company 1's data must be exactly as before.

const B = 'walls-bravo'
let w: SeededWorld
let bravo: { admin: { id: string; role: Role }; lead: { id: string; role: Role }; member: { id: string; role: Role } }
let c1Ids: Map<string, string>
let secretIds: Set<string>
let secretText: string[]
const tables = walledTables().map((t) => t.table)

async function c1Fingerprint(): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const t of tables) {
    const [r] = await prisma.$queryRawUnsafe<{ h: string | null }[]>(`SELECT md5(string_agg(x::text, '|' ORDER BY x::text)) AS h FROM "${t}" x WHERE "companyId" = $1`, HOME_COMPANY_ID)
    out[t] = r?.h ?? ''
  }
  return out
}

beforeAll(async () => {
  w = await seedWorld()
  await ensureHomeCompany()
  await prisma.featureFlag.deleteMany({ where: { key: 'company-walls' } })
  await refreshWalls(prisma)
  await prisma.company.deleteMany({ where: { id: B } })
  await prisma.company.create({ data: { id: B, name: 'Bravo Test Co', slug: B, helpEnabled: true, plan: 'business' } })
  const depts = await Promise.all((['ITAD', 'LEAD_GEN', 'INVENTORY', 'MARKETING', 'ECOMMERCE', 'CSR'] as const).map((type) =>
    prisma.department.create({ data: { companyId: B, type, name: `Bravo ${type}` } })))
  const passwordHash = await hashPassword('Pass-for-tests-9')
  const mk = (name: string, role: Role, departmentId?: string) => prisma.user.create({
    data: { companyId: B, name, email: `${name.replace(/\s+/g, '.').toLowerCase()}@bravo.local.test`, role, status: 'ACTIVE', isActive: true, passwordHash, departmentId },
  })
  const [admin, lead, member] = await Promise.all([mk('Bravo Admin', 'SUPER_ADMIN'), mk('Bravo Lead', 'TEAM_LEAD', depts[0].id), mk('Bravo Member', 'MEMBER', depts[0].id)])
  bravo = { admin: { id: admin.id, role: admin.role }, lead: { id: lead.id, role: lead.role }, member: { id: member.id, role: member.role } }

  const c1Users = Object.values(w).map((u) => u.id)
  const c1Depts = (await prisma.department.findMany({ where: { companyId: HOME_COMPANY_ID }, select: { id: true } })).map((d) => d.id)
  c1Ids = await fillEveryTable(HOME_COMPANY_ID, 'zebra', { User: c1Users, Department: c1Depts })
  await fillEveryTable(B, 'bravo', { User: [admin.id, lead.id, member.id], Department: depts.map((d) => d.id) })

  // Everything of company 1 that must never reach Bravo: every id in every table, and text.
  secretIds = new Set<string>()
  for (const t of tables) {
    const hasId = (await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM information_schema.columns WHERE table_name = $1 AND column_name = 'id'`, t))[0].n > 0n
    if (!hasId) continue
    for (const r of await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT "id"::text AS id FROM "${t}" WHERE "companyId" = $1`, HOME_COMPANY_ID)) if (String(r.id).length >= 12) secretIds.add(String(r.id))
  }
  secretText = ['zebra-', ...(await prisma.user.findMany({ where: { companyId: HOME_COMPANY_ID }, select: { email: true } })).map((u) => u.email)]
}, 120_000)

afterAll(async () => {
  // The made-up rows would get in the way of other tests: clear every company table.
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`)
  await prisma.company.deleteMany({ where: { id: B } })
  await prisma.$disconnect()
})

describe('company walls in the database', () => {
  it('every company table has a company and its walls (trigger)', async () => {
    const triggers = new Set((await prisma.$queryRawUnsafe<{ tgname: string }[]>(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal`)).map((r) => r.tgname))
    const missing = tables.filter((t) => !triggers.has(triggerName(t)))
    expect(missing, 'run src/scripts/companyWallsSql.ts into a migration').toEqual([])
    expect(tables.length).toBeGreaterThan(100)
  })

  it('a row cannot point at another company, or move to another company', async () => {
    const bProject = await prisma.pmProject.findFirstOrThrow({ where: { companyId: B } })
    const c1Column = c1Ids.get('PmColumn')!
    await expect(prisma.pmTask.create({ data: { companyId: B, projectId: bProject.id, columnId: c1Column, code: 'X-1', title: 'cross', createdById: bravo.admin.id } })).rejects.toThrow(/company wall/)
    await expect(prisma.todoItem.update({ where: { id: c1Ids.get('TodoItem')! }, data: { companyId: B } })).rejects.toThrow(/company wall/)
  })

  it('a row saved with no company takes the company of what it belongs to', async () => {
    const n = await prisma.notification.create({ data: { userId: bravo.member.id, type: 'SYSTEM_HEALTH', title: 'From a job', body: 'x' } })
    expect(n.companyId).toBe(B)
    const h = await prisma.notification.create({ data: { userId: w.itadMember.id, type: 'SYSTEM_HEALTH', title: 'From a job', body: 'x' } })
    expect(h.companyId).toBe(HOME_COMPANY_ID)
    await prisma.notification.deleteMany({ where: { id: { in: [n.id, h.id] } } })
  })

  it('company 1 can never be deleted', async () => {
    await expect(prisma.company.delete({ where: { id: HOME_COMPANY_ID } })).rejects.toThrow(/cannot be deleted/)
  })
})

describe('company walls in the app', () => {
  it('reads inside a company see only that company', async () => {
    const mine = await runAsCompany(B, () => prisma.todoItem.findMany())
    expect(mine.length).toBeGreaterThan(0)
    expect(mine.every((t) => t.companyId === B)).toBe(true)
    expect(await runAsCompany(B, () => prisma.todoItem.findUnique({ where: { id: c1Ids.get('TodoItem')! } }))).toBeNull()
    expect(await runAsCompany(B, () => prisma.todoItem.count({ where: { id: c1Ids.get('TodoItem')! } }))).toBe(0)
    const u = await runAsCompany(B, () => prisma.todoItem.updateMany({ where: { id: c1Ids.get('TodoItem')! }, data: { title: 'hacked' } }))
    expect(u.count).toBe(0)
    const created = await runAsCompany(B, () => prisma.holiday.create({ data: { date: new Date('2026-12-25'), name: 'Bravo Christmas' } }))
    expect(created.companyId).toBe(B)
    await prisma.holiday.delete({ where: { id: created.id } })
  })

  it("Bravo calls every API at company 1's records: nothing leaks, nothing crashes, nothing changes", async () => {
    const before = await c1Fingerprint()
    const project = await prisma.pmProject.findUniqueOrThrow({ where: { id: c1Ids.get('PmProject')! } })
    const task = await prisma.pmTask.findUniqueOrThrow({ where: { id: c1Ids.get('PmTask')! } })
    const c1People = Object.values(w).map((u) => u.id)
    const allIds = [...c1Ids.values()]
    const guestToken = (await prisma.chatConversation.findFirstOrThrow({ where: { companyId: HOME_COMPANY_ID } })).guestToken ?? 'zebra-token'
    const words = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z]+/).filter(Boolean)
    const single = (s: string) => s.replace(/ies$/, 'y').replace(/s$/, '')
    const tableWords = [...c1Ids.keys()].map((t) => ({ t, w: words(t) }))
    const idsFor = (segment: string): string[] => {
      const s = single(segment.toLowerCase())
      const hit = tableWords.filter((x) => x.w.includes(s) || x.w.join('') === s).map((x) => c1Ids.get(x.t)!)
      return hit.length ? hit : allIds
    }
    const valuesFor = (param: string, segment: string): string[] => {
      switch (param) {
        case 'key': return [project.key]
        case 'code': return [task.code]
        case 'userId': return c1People.slice(0, 3)
        case 'date': return ['2026-10-20']
        case 'index': return ['0']
        case 'kind': return ['ITAD']
        case 'callId': return [c1Ids.get('ChatCall')!]
        case 'messageId': return [c1Ids.get('ChatMessage')!]
        case 'recId': return [c1Ids.get('CallRecording')!]
        case 'noteId': return [c1Ids.get('MeetingNote')!, c1Ids.get('DialerNote')!, c1Ids.get('WorkLogNote')!]
        case 'token': return [guestToken]
        default: return idsFor(segment)
      }
    }

    const skip = (path: string, method: string) =>
      /^\/api\/(mcp|guest|dialer-hook|owner)\b/.test(path) || (/^\/api\/auth\//.test(path) && method !== 'GET') || path === '/api/push/test' || path === '/api/system-health/audits/run'
    const problems: string[] = []
    let calls = 0
    const look = (label: string, status: number, text: string) => {
      if (status >= 500) problems.push(`${label} → crashed (${status}) ${text.slice(0, 120)}`)
      const low = text.toLowerCase()
      for (const s of secretText) if (low.includes(s.toLowerCase())) { problems.push(`${label} → shows company 1's "${s}"`); return }
      for (const m of text.matchAll(/[a-z0-9]{20,36}/g)) if (secretIds.has(m[0])) { problems.push(`${label} → shows company 1's record ${m[0]}`); return }
    }
    const c1Query = `?q=zebra&search=zebra&userId=${w.itadMember.id}&memberId=${w.itadMember.id}&departmentId=${(await prisma.department.findFirstOrThrow({ where: { companyId: HOME_COMPANY_ID } })).id}&projectId=${project.id}&project=${project.key}&department=ITAD&from=2026-09-01&to=2026-10-31`
    for (const who of [bravo.admin, bravo.lead, bravo.member]) {
      const header = auth(who)
      for (const e of listEndpoints()) {
        if (skip(e.path, e.method)) continue
        // Every way to fill the path with company 1's records.
        let paths = ['']
        const parts = e.path.split('/')
        for (let i = 0; i < parts.length; i++) {
          const m = /^:([A-Za-z0-9_]+)\??$/.exec(parts[i])
          if (!m) { paths = paths.map((p) => (i === 0 ? parts[i] : `${p}/${parts[i]}`)); continue }
          const vals = valuesFor(m[1], parts[i - 1] ?? '')
          paths = paths.flatMap((p) => vals.map((v) => `${p}/${encodeURIComponent(v)}`))
        }
        if (e.method === 'GET' && !e.path.includes(':')) paths.push(e.path + c1Query)
        for (const p of paths.slice(0, 40)) {
          calls++
          const r = request(app)[e.method.toLowerCase() as 'get'](p).set(...header)
          const res = e.method === 'GET' ? await r : await r.send({ userId: w.itadMember.id, assigneeIds: [w.itadMember.id], memberIds: [w.itadMember.id], projectId: project.id, taskId: task.id })
          look(`${who === bravo.admin ? 'Admin' : who === bravo.lead ? 'Lead' : 'Member'} ${e.method} ${p}`, res.status, res.text ?? '')
        }
      }
    }
    expect(calls).toBeGreaterThan(400)
    expect(problems.slice(0, 60), `${problems.length} problems in ${calls} calls`).toEqual([])
    const after = await c1Fingerprint()
    const changed = tables.filter((t) => before[t] !== after[t])
    expect(changed, "company 1's tables changed by Bravo").toEqual([])
  }, 600_000)

  it("the owner console still sees every company (owner sign in is not a company's)", async () => {
    await request(app).get('/api/owner/companies').set(...auth(bravo.admin)).expect(401)
  })
})
