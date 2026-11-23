import type { Response } from 'express'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { recordActivity } from '../lib/audit'
import { companyToday, dateStringFromDb, dbDateFromString } from '../lib/time'
import { COUNTED_LEAVE, leaveBalance, leaveDefaults } from '../lib/approvals'

/**
 * People records (plan 2026-11, 2.2): what a company keeps about each person beyond their sign-in (job title,
 * dates, manager, contacts, an emergency contact) and their leave for the year. Everyone sees the directory;
 * the private parts are seen by the person, their team lead and the admins.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/
const EMPLOYMENT = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'] as const
type Who = { id: string; role: string; departmentId: string | null }

const loadMe = (req: AuthedRequest) => prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { id: true, role: true, departmentId: true, companyId: true } })

/** Team leads look after the members of their own team; admins look after everyone. */
const manages = (me: Who, them: Who) => me.role === 'SUPER_ADMIN' || (me.role === 'TEAM_LEAD' && !!me.departmentId && me.departmentId === them.departmentId && them.role !== 'TEAM_LEAD' && them.role !== 'SUPER_ADMIN' && me.id !== them.id)
const seesPrivate = (me: Who, them: Who) => me.id === them.id || manages(me, them)

const PERSON = {
  id: true, name: true, email: true, role: true, isActive: true, departmentId: true, createdAt: true,
  department: { select: { name: true } },
  personRecord: { include: { manager: { select: { id: true, name: true } } } },
} satisfies Prisma.UserSelect
type PersonRow = Prisma.UserGetPayload<{ select: typeof PERSON }>

const day = (d: Date | null | undefined) => (d ? dateStringFromDb(d) : null)

function view(u: PersonRow, me: Who) {
  const r = u.personRecord
  const open = seesPrivate(me, u)
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    active: u.isActive,
    department: u.department?.name ?? null,
    jobTitle: r?.jobTitle ?? null,
    phone: r?.phone ?? null,
    manager: r?.manager ? { id: r.manager.id, name: r.manager.name } : null,
    // The private parts: the person, their team lead and admins.
    private: open ? {
      employeeCode: r?.employeeCode ?? null,
      employmentType: r?.employmentType ?? null,
      joinedOn: day(r?.joinedOn) ?? dateStringFromDb(u.createdAt),
      joinedOnSet: !!r?.joinedOn,
      leftOn: day(r?.leftOn),
      birthday: day(r?.birthday),
      address: r?.address ?? null,
      emergencyName: r?.emergencyName ?? null,
      emergencyPhone: r?.emergencyPhone ?? null,
      ...(manages(me, u) ? { notes: r?.notes ?? null } : {}),
    } : null,
    canEdit: open,
    canManage: manages(me, u),
  }
}

/** GET /api/people: the directory. */
export async function listPeople(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadMe(req)
  const users = await prisma.user.findMany({ where: { isActive: true }, select: PERSON, orderBy: { name: 'asc' } })
  res.json({ people: users.map((u) => view(u, me)) })
}

/** GET /api/people/:id: one person, with their leave for the year when the viewer may see it. */
export async function getPerson(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadMe(req)
  const u = await prisma.user.findUnique({ where: { id: req.params.id }, select: PERSON })
  if (!u) { res.status(404).json({ error: 'Person not found' }); return }
  const year = Number(companyToday().slice(0, 4))
  const leave = seesPrivate(me, u) ? { year, balance: await leaveBalance({ id: u.id, companyId: me.companyId }, year), own: (await prisma.leaveAllowance.findMany({ where: { userId: u.id, year } })).map((a) => ({ kind: a.kind, days: a.days })) } : null
  res.json({ person: view(u, me), leave })
}

const text = (max: number) => z.string().trim().max(max).nullable().optional()
const date = z.string().regex(DATE).nullable().optional()
const ownSchema = z.object({ phone: text(40), address: text(300), emergencyName: text(120), emergencyPhone: text(40), birthday: date })
const managedSchema = ownSchema.extend({
  employeeCode: text(40), jobTitle: text(120), employmentType: z.enum(EMPLOYMENT).nullable().optional(),
  joinedOn: date, leftOn: date, managerId: z.string().min(1).nullable().optional(), notes: text(2000),
})

/** PUT /api/people/:id: the person changes their own contacts; a lead or an admin changes the rest too. */
export async function savePerson(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadMe(req)
  const u = await prisma.user.findUnique({ where: { id: req.params.id }, select: PERSON })
  if (!u) { res.status(404).json({ error: 'Person not found' }); return }
  if (!seesPrivate(me, u)) { res.status(403).json({ error: 'You cannot change this person’s record.' }); return }
  const full = manages(me, u)
  const p = (full ? managedSchema : ownSchema.strict()).safeParse(req.body)
  if (!p.success) { res.status(full ? 400 : 403).json({ error: full ? 'Check the record.' : 'Only your team lead or an admin changes that part.' }); return }
  const d = p.data as z.infer<typeof managedSchema>
  if (d.managerId) {
    if (d.managerId === u.id) { res.status(400).json({ error: 'A person cannot be their own manager.' }); return }
    if (!(await prisma.user.findFirst({ where: { id: d.managerId, isActive: true }, select: { id: true } }))) { res.status(400).json({ error: 'That manager is not an active person in your company.' }); return }
  }
  const data: Prisma.PersonRecordUncheckedUpdateInput = {}
  const put = <K extends keyof typeof d>(k: K, v: unknown) => { if (d[k] !== undefined) (data as Record<string, unknown>)[k] = v }
  for (const k of ['phone', 'address', 'emergencyName', 'emergencyPhone', 'employeeCode', 'jobTitle', 'employmentType', 'managerId', 'notes'] as const) put(k, d[k] || null)
  for (const k of ['birthday', 'joinedOn', 'leftOn'] as const) put(k, d[k] ? dbDateFromString(d[k]!) : null)
  await prisma.personRecord.upsert({ where: { userId: u.id }, update: data, create: { ...(data as Prisma.PersonRecordUncheckedCreateInput), userId: u.id } })
  if (me.id !== u.id) await recordActivity(me.id, 'UPDATE', 'PersonRecord', u.id, { after: { summary: `Changed ${u.name}'s record (${Object.keys(data).join(', ')})` } })
  const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: PERSON })
  res.json({ person: view(after, me) })
}

const leaveNumber = z.number().min(0).max(366).nullable()

/** PUT /api/people/:id/leave { year, days: { ANNUAL, SICK, CASUAL } }: a person's own numbers (null: the company's). Admins. */
export async function savePersonLeave(req: AuthedRequest, res: Response): Promise<void> {
  if (req.user!.role !== 'SUPER_ADMIN') { res.status(403).json({ error: 'Only an admin sets leave days.' }); return }
  const p = z.object({ year: z.number().int().min(2020).max(2100), days: z.object({ ANNUAL: leaveNumber.optional(), SICK: leaveNumber.optional(), CASUAL: leaveNumber.optional() }) }).safeParse(req.body)
  if (!p.success) { res.status(400).json({ error: 'Give a number of days for each kind of leave.' }); return }
  const u = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, name: true } })
  if (!u) { res.status(404).json({ error: 'Person not found' }); return }
  for (const kind of COUNTED_LEAVE) {
    const v = p.data.days[kind]
    if (v === undefined) continue
    const key = { userId_year_kind: { userId: u.id, year: p.data.year, kind } }
    if (v === null) await prisma.leaveAllowance.deleteMany({ where: { userId: u.id, year: p.data.year, kind } })
    else await prisma.leaveAllowance.upsert({ where: key, update: { days: v }, create: { userId: u.id, year: p.data.year, kind, days: v } })
  }
  await recordActivity(req.user!.id, 'UPDATE', 'LeaveAllowance', u.id, { after: { summary: `Set ${u.name}'s leave days for ${p.data.year}` } })
  res.json({ year: p.data.year, balance: await leaveBalance({ id: u.id, companyId: req.user!.companyId }, p.data.year) })
}

/** GET /api/people/leave-defaults: the company's leave days per year (not set: no limit is shown). */
export async function getLeaveDefaults(req: AuthedRequest, res: Response): Promise<void> {
  const d = await leaveDefaults(req.user!.companyId)
  res.json({ days: { ANNUAL: d.ANNUAL ?? null, SICK: d.SICK ?? null, CASUAL: d.CASUAL ?? null } })
}

/** PUT /api/people/leave-defaults { days }: admins. */
export async function saveLeaveDefaults(req: AuthedRequest, res: Response): Promise<void> {
  if (req.user!.role !== 'SUPER_ADMIN') { res.status(403).json({ error: 'Only an admin sets leave days.' }); return }
  const p = z.object({ days: z.object({ ANNUAL: leaveNumber, SICK: leaveNumber, CASUAL: leaveNumber }) }).safeParse(req.body)
  if (!p.success) { res.status(400).json({ error: 'Give a number of days for each kind of leave, or leave it empty.' }); return }
  const days = Object.fromEntries(Object.entries(p.data.days).filter(([, v]) => v !== null))
  await prisma.company.update({ where: { id: req.user!.companyId }, data: { leaveAllowances: Object.keys(days).length ? days : Prisma.DbNull } })
  await recordActivity(req.user!.id, 'UPDATE', 'Company', req.user!.companyId, { after: { summary: 'Changed the leave days people get in a year' } })
  await getLeaveDefaults(req, res)
}
