import type { Response } from 'express'
import { z } from 'zod'
import { IANAZone } from 'luxon'
import { Prisma, type DepartmentType, type Role } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { KIND_INFO, SECTION_KEYS, sectionsOfKind } from '../lib/sections'
import { forgetSections } from '../lib/sectionsOff'
import type { AuthedRequest } from '../middleware/auth'
import { HOME_COMPANY_ID } from '../lib/company'
import { forgetTimeZone } from '../lib/tenancy'
import { AREAS, AREA_KEYS, BUILTIN_POWERS, POWERS, POWER_KEYS, loadPowers, type PowerKey } from '../lib/permissions'
import { usageOf } from '../lib/plans'
import { cleanLayout, readLayout } from '../lib/blocks'
import { cleanDashboard, readDashboard } from '../lib/cards'
import { isOn } from '../lib/flags'

/**
 * Company settings (Phase 1, step 4), for the Super Admin or anyone with the Company settings
 * power: the company's name and time zone, its departments, and its own roles. Everything here
 * is inside the company walls (lib/tenancy), so it only ever touches this company.
 */

const ROLE_LABEL: Record<Role, string> = {
  MEMBER: 'Member', TEAM_LEAD: 'Team Lead', SUB_DEPT_LEAD: 'Sub-department Lead', QA: 'QA', QA_LEAD: 'QA Lead', SUPER_ADMIN: 'Super Admin',
}
const ROLES = Object.keys(ROLE_LABEL) as Role[]
/** Department kinds: the built-in ones come with their own screens; General has the shared tools only. */
export const DEPARTMENT_KINDS: { type: DepartmentType; label: string; description: string }[] = [
  { type: 'GENERAL', label: 'General', description: 'Attendance, projects, chat, to-dos and the daily report. Make as many as you need.' },
  { type: 'ITAD', label: 'Sales calling (ITAD)', description: 'Daily calling log, Lead Dialer, bids and documents.' },
  { type: 'LEAD_GEN', label: 'Lead Generation', description: 'Daily leads by industry and the lead funnel.' },
  { type: 'MARKETING', label: 'Marketing', description: 'Board, calendar, SEO, social media, content, ads and email.' },
  { type: 'ECOMMERCE', label: 'E-commerce', description: 'Listings board, daily log, stock and notes.' },
  { type: 'INVENTORY', label: 'Inventory', description: 'Stock, requests and movements.' },
  { type: 'CSR', label: 'Customer service (CSR)', description: 'Scored by Quality Assurance.' },
]

class Refused extends Error { constructor(public status: number, message: string) { super(message) } }
function send(res: Response, e: unknown): void {
  if (e instanceof Refused) { res.status(e.status).json({ error: e.message }); return }
  if (e instanceof z.ZodError) { res.status(400).json({ error: e.issues[0]?.message ?? 'Invalid input' }); return }
  throw e
}

async function me(req: AuthedRequest) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { id: true, role: true, companyId: true } })
  return { ...u, powers: await loadPowers(u.id) }
}
async function settingsUser(req: AuthedRequest) {
  const u = await me(req)
  if (!u.powers.includes('company.settings')) throw new Refused(403, 'Only the Super Admin (or someone given Company settings) can change this.')
  return u
}

// ------------------------------------------------------------------ the company

/** GET /api/company — the company (everyone sees its name; the settings page needs canEdit). */
export async function getCompany(req: AuthedRequest, res: Response): Promise<void> {
  const u = await me(req)
  const c = await prisma.company.findUniqueOrThrow({ where: { id: u.companyId }, select: { id: true, name: true, kind: true, timeZone: true, plan: true, status: true, createdAt: true, supportAccessUntil: true } })
  res.json({
    company: { ...c, home: c.id === HOME_COMPANY_ID, supportAccessUntil: c.supportAccessUntil && c.supportAccessUntil > new Date() ? c.supportAccessUntil : null },
    usage: u.powers.includes('company.settings') ? await usageOf(c.id) : null,
    canEdit: u.powers.includes('company.settings'),
    // 99 Technologies' time zone is set on the server (APP_TIMEZONE) when it is set there.
    timeZoneLocked: c.id === HOME_COMPANY_ID && !!process.env.APP_TIMEZONE,
  })
}

const companySchema = z.object({
  name: z.string().trim().min(2, 'Give the company a name').max(80).optional(),
  timeZone: z.string().trim().refine((z) => IANAZone.isValidZone(z), 'Pick a time zone from the list').optional(),
})

/** PATCH /api/company { name?, timeZone? } */
export async function updateCompany(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const u = await settingsUser(req)
    const body = companySchema.parse(req.body)
    if (body.timeZone && u.companyId === HOME_COMPANY_ID && process.env.APP_TIMEZONE && body.timeZone !== process.env.APP_TIMEZONE) throw new Refused(409, "99 Technologies' time zone is set on the server.")
    const c = await prisma.company.update({ where: { id: u.companyId }, data: body, select: { id: true, name: true, kind: true, timeZone: true, plan: true, status: true, createdAt: true } })
    forgetTimeZone(c.id)
    res.json({ company: { ...c, home: c.id === HOME_COMPANY_ID } })
  } catch (e) { send(res, e) }
}

// ------------------------------------------------------------------ departments

async function departmentList() {
  const rows = await prisma.department.findMany({
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, type: true, sectionsOff: true, layout: true, dashboard: true, createdAt: true, _count: { select: { users: true, userMemberships: true } } },
  })
  return rows.map((d) => ({
    id: d.id, name: d.name, type: d.type, kind: DEPARTMENT_KINDS.find((k) => k.type === d.type)?.label ?? d.type, people: Math.max(d._count.users, d._count.userMemberships), createdAt: d.createdAt,
    sectionsOff: d.sectionsOff.filter((k) => SECTION_KEYS.includes(k)),
    // Department Studio: its own member and team lead menus (null: the menu of its kind).
    layout: readLayout(d.layout),
    // Part B: its own member and team lead dashboards (null: the dashboard of its kind).
    dashboard: readDashboard(d.dashboard),
  }))
}

/** Each kind with what it is for and its sections (for the add form and the sections panel). */
function kindsWithSections() {
  return DEPARTMENT_KINDS.map((k) => ({ ...k, sections: sectionsOfKind(k.type).map((s) => ({ key: s.key, label: s.label, description: s.description })) }))
}

/** GET /api/company/departments */
export async function listDepartments(req: AuthedRequest, res: Response): Promise<void> {
  await me(req)
  res.json({ departments: await departmentList(), kinds: kindsWithSections() })
}

const deptSchema = z.object({
  name: z.string().trim().min(2, 'Give the department a name').max(60),
  type: z.enum(DEPARTMENT_KINDS.map((k) => k.type) as [DepartmentType, ...DepartmentType[]]).default('GENERAL'),
  /** Sections of the kind to leave off from the start (all on when left out). */
  sectionsOff: z.array(z.string().max(40)).max(40).optional(),
})

/** Only sections of the department's own kind can be turned off. */
function checkSections(kind: DepartmentType, off: string[]): string[] {
  const mine = sectionsOfKind(kind).map((s) => s.key)
  const bad = off.find((k) => !mine.includes(k))
  if (bad) throw new Refused(400, `"${bad}" is not a section of a ${KIND_INFO[kind].label} department.`)
  return [...new Set(off)]
}

async function nameTaken(name: string, exceptId?: string) {
  return !!(await prisma.department.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } }))
}

/** POST /api/company/departments { name, type } — one of each built-in kind, as many General ones as needed. */
export async function createDepartment(req: AuthedRequest, res: Response): Promise<void> {
  try {
    await settingsUser(req)
    const body = deptSchema.parse(req.body)
    if (await nameTaken(body.name)) throw new Refused(409, 'There is already a department with that name.')
    if (body.type !== 'GENERAL' && (await prisma.department.findFirst({ where: { type: body.type }, select: { id: true } }))) {
      throw new Refused(409, `You already have a ${DEPARTMENT_KINDS.find((k) => k.type === body.type)!.label} department. Make a General one, or rename the one you have.`)
    }
    await prisma.department.create({ data: { name: body.name, type: body.type, sectionsOff: checkSections(body.type, body.sectionsOff ?? []) } })
    forgetSections()
    res.status(201).json({ departments: await departmentList() })
  } catch (e) { send(res, e) }
}

/** PATCH /api/company/departments/:id { name } */
export async function renameDepartment(req: AuthedRequest, res: Response): Promise<void> {
  try {
    await settingsUser(req)
    const { name } = deptSchema.pick({ name: true }).parse(req.body)
    const d = await prisma.department.findUnique({ where: { id: req.params.id }, select: { id: true } })
    if (!d) throw new Refused(404, 'Department not found')
    if (await nameTaken(name, d.id)) throw new Refused(409, 'There is already a department with that name.')
    await prisma.department.update({ where: { id: d.id }, data: { name } })
    res.json({ departments: await departmentList() })
  } catch (e) { send(res, e) }
}

/**
 * PATCH /api/company/departments/:id/sections { sectionsOff } — turn screens of the department's
 * kind on or off. Off: hidden, and nothing new is saved there; everything already there is kept.
 */
export async function setDepartmentSections(req: AuthedRequest, res: Response): Promise<void> {
  try {
    await settingsUser(req)
    const { sectionsOff } = z.object({ sectionsOff: z.array(z.string().max(40)).max(40) }).parse(req.body)
    const d = await prisma.department.findUnique({ where: { id: req.params.id }, select: { id: true, type: true } })
    if (!d) throw new Refused(404, 'Department not found')
    await prisma.department.update({ where: { id: d.id }, data: { sectionsOff: checkSections(d.type, sectionsOff) } })
    forgetSections()
    res.json({ departments: await departmentList() })
  } catch (e) { send(res, e) }
}

/**
 * PUT /api/company/departments/:id/layout { member, lead } | { reset: true } — Department Studio:
 * the blocks in the department's member and team lead menus, in order. Reset goes back to the
 * menu of its kind. Needs the Studio switched on for the company.
 */
export async function setDepartmentLayout(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const u = await settingsUser(req)
    if (!(await isOn('department-studio', u.companyId))) throw new Refused(403, 'The Department Studio is not switched on for your company.')
    const d = await prisma.department.findUnique({ where: { id: req.params.id }, select: { id: true, type: true } })
    if (!d) throw new Refused(404, 'Department not found')
    if (req.body?.reset === true) {
      await prisma.department.update({ where: { id: d.id }, data: { layout: Prisma.DbNull } })
    } else {
      const r = cleanLayout(req.body, d.type, await customIds())
      if ('error' in r) throw new Refused(400, r.error)
      await prisma.department.update({ where: { id: d.id }, data: { layout: r.layout as unknown as Prisma.InputJsonValue } })
    }
    res.json({ departments: await departmentList() })
  } catch (e) { send(res, e) }
}

/** The ids of the blocks the company made itself (part C). */
async function customIds(): Promise<string[]> {
  return (await prisma.customBlock.findMany({ select: { id: true } })).map((b) => b.id)
}

/**
 * PUT /api/company/departments/:id/dashboard { member, lead } | { reset: true } — Department
 * Studio, part B: the cards on the department's member and team lead dashboards.
 */
export async function setDepartmentDashboard(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const u = await settingsUser(req)
    if (!(await isOn('department-studio', u.companyId))) throw new Refused(403, 'The Department Studio is not switched on for your company.')
    const d = await prisma.department.findUnique({ where: { id: req.params.id }, select: { id: true, type: true } })
    if (!d) throw new Refused(404, 'Department not found')
    if (req.body?.reset === true) {
      await prisma.department.update({ where: { id: d.id }, data: { dashboard: Prisma.DbNull } })
    } else {
      const r = cleanDashboard(req.body, d.type, await customIds())
      if ('error' in r) throw new Refused(400, r.error)
      await prisma.department.update({ where: { id: d.id }, data: { dashboard: r.dashboard as unknown as Prisma.InputJsonValue } })
    }
    res.json({ departments: await departmentList() })
  } catch (e) { send(res, e) }
}

/** DELETE /api/company/departments/:id — only an empty department (nobody in it). */
export async function deleteDepartment(req: AuthedRequest, res: Response): Promise<void> {
  try {
    await settingsUser(req)
    const d = (await departmentList()).find((x) => x.id === req.params.id)
    if (!d) throw new Refused(404, 'Department not found')
    if (d.people > 0) throw new Refused(409, 'Move its people to another department first.')
    try { await prisma.department.delete({ where: { id: d.id } }) } catch { throw new Refused(409, 'This department still has records (targets, tags or reports), so it cannot be removed.') }
    res.json({ departments: await departmentList() })
  } catch (e) { send(res, e) }
}

// ------------------------------------------------------------------ roles

async function roleList() {
  const roles = await prisma.companyRole.findMany({ orderBy: { createdAt: 'asc' }, include: { _count: { select: { users: true } } } })
  return roles.map((r) => ({ id: r.id, name: r.name, baseRole: r.baseRole, baseLabel: ROLE_LABEL[r.baseRole], areasOff: r.areasOff, powers: r.powers, people: r._count.users }))
}

/** GET /api/company/roles — built-in roles, the company's own, and what can be set. */
export async function listRoles(req: AuthedRequest, res: Response): Promise<void> {
  await me(req)
  res.json({
    builtIn: ROLES.map((r) => ({ role: r, label: ROLE_LABEL[r], powers: BUILTIN_POWERS[r] })),
    roles: await roleList(),
    areas: AREAS.map((a) => ({ key: a.key, label: a.label })),
    powers: POWER_KEYS.map((k) => ({ key: k, ...POWERS[k] })),
  })
}

const roleSchema = z.object({
  name: z.string().trim().min(2, 'Give the role a name').max(40),
  baseRole: z.enum(ROLES as [Role, ...Role[]]),
  areasOff: z.array(z.enum(AREA_KEYS as [string, ...string[]])).max(AREA_KEYS.length).default([]),
  powers: z.array(z.enum(POWER_KEYS as [PowerKey, ...PowerKey[]])).max(POWER_KEYS.length).default([]),
})

/** Nobody can hand out more than they have: finance only by someone with finance; Super Admin roles only by a Super Admin. */
function checkGrant(u: { role: Role; powers: PowerKey[] }, baseRole: Role, powers: string[]) {
  if (baseRole === 'SUPER_ADMIN' && u.role !== 'SUPER_ADMIN') throw new Refused(403, 'Only a Super Admin can make roles from Super Admin.')
  for (const p of powers) if (!u.powers.includes(p as PowerKey)) throw new Refused(403, `You cannot give "${POWERS[p as PowerKey].label}" because you do not have it.`)
}

/** POST /api/company/roles */
export async function createRole(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const u = await settingsUser(req)
    const body = roleSchema.parse(req.body)
    checkGrant(u, body.baseRole, body.powers)
    if (ROLES.some((r) => ROLE_LABEL[r].toLowerCase() === body.name.toLowerCase())) throw new Refused(409, 'That is the name of a built-in role.')
    if (await prisma.companyRole.findFirst({ where: { name: { equals: body.name, mode: 'insensitive' } } })) throw new Refused(409, 'There is already a role with that name.')
    await prisma.companyRole.create({ data: { name: body.name, baseRole: body.baseRole, areasOff: [...new Set(body.areasOff)], powers: [...new Set(body.powers)] } })
    res.status(201).json({ roles: await roleList() })
  } catch (e) { send(res, e) }
}

/** PATCH /api/company/roles/:id { name?, areasOff?, powers? } (the built-in role it starts from stays). */
export async function updateRole(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const u = await settingsUser(req)
    const body = roleSchema.omit({ baseRole: true }).partial().parse(req.body)
    const r = await prisma.companyRole.findUnique({ where: { id: req.params.id } })
    if (!r) throw new Refused(404, 'Role not found')
    // Powers being added must be the giver's own; powers already on the role may stay.
    const added = (body.powers ?? []).filter((p) => !r.powers.includes(p))
    checkGrant(u, r.baseRole, added)
    if (body.name && (await prisma.companyRole.findFirst({ where: { name: { equals: body.name, mode: 'insensitive' }, id: { not: r.id } } }))) throw new Refused(409, 'There is already a role with that name.')
    await prisma.companyRole.update({ where: { id: r.id }, data: { ...(body.name ? { name: body.name } : {}), ...(body.areasOff ? { areasOff: [...new Set(body.areasOff)] } : {}), ...(body.powers ? { powers: [...new Set(body.powers)] } : {}) } })
    res.json({ roles: await roleList() })
  } catch (e) { send(res, e) }
}

/** DELETE /api/company/roles/:id — its people go back to just their built-in role. */
export async function deleteRole(req: AuthedRequest, res: Response): Promise<void> {
  try {
    await settingsUser(req)
    const r = await prisma.companyRole.findUnique({ where: { id: req.params.id }, select: { id: true } })
    if (!r) throw new Refused(404, 'Role not found')
    await prisma.companyRole.delete({ where: { id: r.id } })
    res.json({ roles: await roleList() })
  } catch (e) { send(res, e) }
}

// ------------------------------------------------------------------ people

/** GET /api/company/people — everyone, with their role and extra powers. */
export async function listPeople(req: AuthedRequest, res: Response): Promise<void> {
  try { await settingsUser(req) } catch (e) { send(res, e); return }
  const people = await prisma.user.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, email: true, role: true, customRoleId: true, permissions: true, department: { select: { name: true } } },
  })
  res.json({ people: people.map((p) => ({ ...p, roleLabel: ROLE_LABEL[p.role], department: p.department?.name ?? null })) })
}

const personSchema = z.object({
  customRoleId: z.string().nullable().optional(),
  permissions: z.array(z.enum(POWER_KEYS as [PowerKey, ...PowerKey[]])).max(POWER_KEYS.length).optional(),
})

/**
 * PATCH /api/company/people/:id { customRoleId?, permissions? } — give someone one of the
 * company's roles (made from their own built-in role) and extra powers.
 */
export async function updatePerson(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const u = await settingsUser(req)
    const body = personSchema.parse(req.body)
    const p = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, role: true, permissions: true } })
    if (!p) throw new Refused(404, 'Person not found')
    if (body.customRoleId) {
      const r = await prisma.companyRole.findUnique({ where: { id: body.customRoleId } })
      if (!r) throw new Refused(404, 'Role not found')
      if (r.baseRole !== p.role) throw new Refused(422, `That role is made from ${ROLE_LABEL[r.baseRole]}; this person is a ${ROLE_LABEL[p.role]}. Change their role in Users first.`)
    }
    if (body.permissions) {
      const added = body.permissions.filter((k) => !p.permissions.includes(k))
      const removed = p.permissions.filter((k) => !body.permissions!.includes(k as PowerKey))
      checkGrant(u, 'MEMBER', [...added, ...removed])
    }
    await prisma.user.update({ where: { id: p.id }, data: { ...(body.customRoleId !== undefined ? { customRoleId: body.customRoleId } : {}), ...(body.permissions ? { permissions: [...new Set(body.permissions)] } : {}) } })
    res.json({ ok: true })
  } catch (e) { send(res, e) }
}

// ------------------------------------------------------------------ help sign-in (step 6)

/**
 * POST /api/company/support-access { hours } — let Metriq support sign in as one of your people
 * to help (0 = stop now). Every help sign-in shows in your activity log, and the person sees a
 * banner the whole time.
 */
export const setSupportAccess = async (req: AuthedRequest, res: Response): Promise<void> => {
  try {
    const u = await settingsUser(req)
    const { hours } = z.object({ hours: z.union([z.literal(0), z.literal(24), z.literal(72), z.literal(168)]) }).parse(req.body)
    const until = hours ? new Date(Date.now() + hours * 3600_000) : null
    await prisma.company.update({ where: { id: u.companyId }, data: { supportAccessUntil: until, supportAccessById: hours ? u.id : null } })
    await prisma.auditLog.create({ data: { userId: u.id, action: hours ? 'SUPPORT_ACCESS_ON' : 'SUPPORT_ACCESS_OFF', entityType: 'Company', entityId: u.companyId, after: { until: until?.toISOString() ?? null } } })
    res.json({ supportAccessUntil: until })
  } catch (e) { send(res, e) }
}
