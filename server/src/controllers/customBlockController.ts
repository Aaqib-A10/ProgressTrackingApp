import type { Response } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { loadPowers } from '../lib/permissions'
import { isOn } from '../lib/flags'
import { menuOf } from '../lib/blocks'
import { personBlocks } from '../lib/personBlocks'
import { cleanBlockInput, cleanRecordData, readFields, readSettings, type CustomField } from '../lib/customBlocks'

/**
 * Department Studio, part C: blocks a company makes itself, and their records. The rules are in
 * lib/customBlocks.ts. Everything here is inside the company walls (lib/tenancy).
 */

class Refused extends Error { constructor(public status: number, message: string) { super(message) } }
function send(res: Response, e: unknown): void {
  if (e instanceof Refused) { res.status(e.status).json({ error: e.message }); return }
  throw e
}

type Block = Awaited<ReturnType<typeof prisma.customBlock.findFirstOrThrow>>
function blockView(b: Block & { _count?: { records: number } }) {
  return {
    id: b.id, name: b.name, description: b.description, icon: b.icon, color: b.color,
    fields: readFields(b.fields), settings: readSettings(b.settings),
    records: b._count?.records ?? undefined, updatedAt: b.updatedAt.toISOString(),
  }
}

// ------------------------------------------------------------------ building blocks (Super Admin)

async function builder(req: AuthedRequest) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { id: true, companyId: true } })
  if (!(await loadPowers(u.id)).includes('company.settings')) throw new Refused(403, 'Only the Super Admin (or someone given Company settings) can make blocks.')
  if (!(await isOn('department-studio', u.companyId))) throw new Refused(403, 'The Department Studio is not switched on for your company.')
  return u
}

/** GET /api/company/blocks — the company's own blocks, with how many records each has. */
export async function listBlocks(req: AuthedRequest, res: Response): Promise<void> {
  try {
    await builder(req)
    const rows = await prisma.customBlock.findMany({ orderBy: { createdAt: 'asc' }, include: { _count: { select: { records: true } } } })
    res.json({ blocks: rows.map(blockView) })
  } catch (e) { send(res, e) }
}

/** POST /api/company/blocks { name, description, icon, color, fields, settings } */
export async function createBlock(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const u = await builder(req)
    const r = cleanBlockInput(req.body)
    if ('error' in r) throw new Refused(400, r.error)
    if ((await prisma.customBlock.count()) >= 50) throw new Refused(409, 'A company can have up to 50 blocks of its own.')
    const b = await prisma.customBlock.create({ data: { ...r.block, fields: r.block.fields as unknown as Prisma.InputJsonValue, settings: r.block.settings as unknown as Prisma.InputJsonValue, createdById: u.id } })
    res.status(201).json({ block: blockView(b) })
  } catch (e) { send(res, e) }
}

/** PATCH /api/company/blocks/:id — change it. Records keep the values of fields that are kept. */
export async function updateBlock(req: AuthedRequest, res: Response): Promise<void> {
  try {
    await builder(req)
    const b = await prisma.customBlock.findUnique({ where: { id: req.params.id } })
    if (!b) throw new Refused(404, 'Block not found')
    const r = cleanBlockInput(req.body)
    if ('error' in r) throw new Refused(400, r.error)
    const saved = await prisma.customBlock.update({ where: { id: b.id }, data: { ...r.block, fields: r.block.fields as unknown as Prisma.InputJsonValue, settings: r.block.settings as unknown as Prisma.InputJsonValue } })
    res.json({ block: blockView(saved) })
  } catch (e) { send(res, e) }
}

/** DELETE /api/company/blocks/:id — only when it has no records, and it comes out of every menu and dashboard. */
export async function deleteBlock(req: AuthedRequest, res: Response): Promise<void> {
  try {
    await builder(req)
    const b = await prisma.customBlock.findUnique({ where: { id: req.params.id }, include: { _count: { select: { records: true } } } })
    if (!b) throw new Refused(404, 'Block not found')
    if (b._count.records > 0 && req.query.withRecords !== 'yes') throw new Refused(409, `It has ${b._count.records} record${b._count.records === 1 ? '' : 's'}. Remove it anyway to delete them too.`)
    const key = `custom:${b.id}`
    const depts = await prisma.department.findMany({ select: { id: true, layout: true, dashboard: true } })
    for (const d of depts) {
      const l = d.layout as { member?: string[]; lead?: string[] } | null
      const db = d.dashboard as { member?: { key: string }[]; lead?: { key: string }[] } | null
      const data: Prisma.DepartmentUpdateInput = {}
      if (l && (l.member?.includes(key) || l.lead?.includes(key))) data.layout = { member: (l.member ?? []).filter((k) => k !== key), lead: (l.lead ?? []).filter((k) => k !== key) }
      if (db && (db.member?.some((c) => c.key === key) || db.lead?.some((c) => c.key === key))) data.dashboard = { member: (db.member ?? []).filter((c) => c.key !== key), lead: (db.lead ?? []).filter((c) => c.key !== key) } as unknown as Prisma.InputJsonValue
      if (Object.keys(data).length) await prisma.department.update({ where: { id: d.id }, data })
    }
    await prisma.customBlock.delete({ where: { id: b.id } })
    res.status(204).end()
  } catch (e) { send(res, e) }
}

// ------------------------------------------------------------------ using a block (its menu's people)

/** What this person may do with this block. Refused when the block is not in their menu. */
async function access(req: AuthedRequest, blockId: string) {
  const me = await prisma.user.findUniqueOrThrow({
    where: { id: req.user!.id },
    select: { id: true, role: true, companyId: true, departmentId: true, department: { select: { type: true, layout: true } } },
  })
  const block = await prisma.customBlock.findUnique({ where: { id: blockId } })
  if (!block) throw new Refused(404, 'Block not found')
  const settings = readSettings(block.settings)
  const admin = me.role === 'SUPER_ADMIN'
  if (!admin) {
    const mine = await personBlocks(me)
    if (!mine?.includes(`custom:${block.id}`)) throw new Refused(403, `${block.name} is not in your department's menu.`)
  }
  const lead = !admin && menuOf(me.role) === 'lead'
  return {
    me, block, fields: readFields(block.fields), settings, admin, lead,
    /** Which records they see. */
    where: (admin ? {} : lead || settings.membersSee === 'all' ? { departmentId: me.departmentId ?? '__none__' } : { createdById: me.id }) as Prisma.CustomRecordWhereInput,
    canAdd: admin || lead || settings.membersAdd,
    /** May they change or remove this record? */
    canChange: (r: { createdById: string | null; departmentId: string | null }) => admin || (lead && r.departmentId === me.departmentId) || r.createdById === me.id,
  }
}

type Rec = Awaited<ReturnType<typeof prisma.customRecord.findFirstOrThrow>> & { createdBy: { id: string; name: string } | null; department: { name: string } | null }
function recordView(r: Rec, can: (r: Rec) => boolean) {
  return { id: r.id, data: r.data as Record<string, unknown>, createdBy: r.createdBy, department: r.department?.name ?? null, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), canChange: can(r) }
}
const REC_INCLUDE = { createdBy: { select: { id: true, name: true } }, department: { select: { name: true } } } as const

/** GET /api/custom/:id — the block, what this person may do, and the people a person field can pick. */
export async function getBlock(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const a = await access(req, req.params.id)
    const hasPerson = a.fields.some((f) => f.type === 'person')
    const people = hasPerson
      ? await prisma.user.findMany({ where: { isActive: true, status: 'ACTIVE', ...(a.admin ? {} : { departmentId: a.me.departmentId ?? '__none__' }) }, select: { id: true, name: true }, orderBy: { name: 'asc' } })
      : []
    res.json({ block: blockView(a.block), canAdd: a.canAdd, lead: a.lead || a.admin, people })
  } catch (e) { send(res, e) }
}

/** GET /api/custom/:id/records?q= — newest first, up to 2000. */
export async function listRecords(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const a = await access(req, req.params.id)
    const rows = await prisma.customRecord.findMany({ where: { blockId: a.block.id, ...a.where }, orderBy: { createdAt: 'desc' }, take: 2001, include: REC_INCLUDE })
    res.json({ records: rows.slice(0, 2000).map((r) => recordView(r, a.canChange)), more: rows.length > 2000 })
  } catch (e) { send(res, e) }
}

/** POST /api/custom/:id/records { data } */
export async function createRecord(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const a = await access(req, req.params.id)
    if (!a.canAdd) throw new Refused(403, `Only team leads add to ${a.block.name}.`)
    const r = cleanRecordData(a.fields, req.body?.data)
    if ('error' in r) throw new Refused(400, r.error)
    const rec = await prisma.customRecord.create({
      data: { blockId: a.block.id, departmentId: a.me.departmentId, createdById: a.me.id, data: r.data as Prisma.InputJsonValue },
      include: REC_INCLUDE,
    })
    res.status(201).json({ record: recordView(rec, a.canChange) })
  } catch (e) { send(res, e) }
}

async function findRecord(a: Awaited<ReturnType<typeof access>>, id: string) {
  const r = await prisma.customRecord.findFirst({ where: { id, blockId: a.block.id, ...a.where }, include: REC_INCLUDE })
  if (!r) throw new Refused(404, 'Record not found')
  if (!a.canChange(r)) throw new Refused(403, 'You can change only your own records.')
  return r
}

/** PATCH /api/custom/:id/records/:rid { data } — only the fields sent change. */
export async function updateRecord(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const a = await access(req, req.params.id)
    const r = await findRecord(a, req.params.rid)
    const c = cleanRecordData(a.fields, req.body?.data, true)
    if ('error' in c) throw new Refused(400, c.error)
    const merged = { ...(r.data as Record<string, unknown>), ...c.data }
    for (const f of a.fields) if (f.required && (merged[f.key] === null || merged[f.key] === undefined || merged[f.key] === '')) throw new Refused(400, `Fill in "${f.label}".`)
    const saved = await prisma.customRecord.update({ where: { id: r.id }, data: { data: merged as Prisma.InputJsonValue }, include: REC_INCLUDE })
    res.json({ record: recordView(saved, a.canChange) })
  } catch (e) { send(res, e) }
}

/** DELETE /api/custom/:id/records/:rid */
export async function deleteRecord(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const a = await access(req, req.params.id)
    const r = await findRecord(a, req.params.rid)
    await prisma.customRecord.delete({ where: { id: r.id } })
    res.status(204).end()
  } catch (e) { send(res, e) }
}

/** GET /api/custom/:id/summary — for its dashboard card: how many, by the board's choice field, and the latest few. */
export async function summary(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const a = await access(req, req.params.id)
    const rows = await prisma.customRecord.findMany({ where: { blockId: a.block.id, ...a.where }, orderBy: { createdAt: 'desc' }, take: 5000, select: { id: true, data: true, createdAt: true } })
    const by: CustomField | undefined = a.fields.find((f) => f.key === a.settings.boardField) ?? a.fields.find((f) => f.type === 'select')
    const counts = by ? (by.options ?? []).map((o) => ({ label: o, count: rows.filter((r) => (r.data as Record<string, unknown>)[by.key] === o).length })) : []
    const title = a.fields.find((f) => f.type === 'text') ?? a.fields[0]
    const weekAgo = Date.now() - 7 * 86400_000
    res.json({
      block: { id: a.block.id, name: a.block.name, icon: a.block.icon, color: a.block.color },
      total: rows.length, thisWeek: rows.filter((r) => r.createdAt.getTime() >= weekAgo).length,
      by: by ? { label: by.label, counts } : null,
      latest: rows.slice(0, 5).map((r) => ({ id: r.id, title: String((r.data as Record<string, unknown>)[title?.key ?? ''] ?? '—'), createdAt: r.createdAt.toISOString() })),
    })
  } catch (e) { send(res, e) }
}
